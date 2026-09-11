import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Button,
    Space,
    Typography,
    Tag,
    Modal,
    message,
    Input,
    Select,
    DatePicker,
    Empty,
    Tooltip,
    Form,
    Switch,
    Dropdown,
    Alert
} from 'antd'
import {
    UserAddOutlined,
    MailOutlined,
    TeamOutlined,
    FileTextOutlined,
    CloudDownloadOutlined,
    ReloadOutlined,
    CalendarOutlined,
    ApartmentOutlined,
    IdcardOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    EditOutlined,
    KeyOutlined,
    StopOutlined,
    PlayCircleOutlined,
    DeleteOutlined,
    SwapOutlined,
    UserOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    QueryConstraint,
    doc,
    updateDoc,
    setDoc,
    writeBatch,
    serverTimestamp
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { branchService } from '@/services/branchService'

dayjs.extend(isBetween)

const { Title, Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

type EmployeeWorkerType = 'intern' | 'permanent'

type EmployeeRow = {
    id: string
    authUid?: string
    name?: string
    email?: string
    role?: string
    position?: string
    workerType?: EmployeeWorkerType
    startDate?: string
    endDate?: string | null
    department?: string
    departmentId?: string | null
    branch?: string
    branchId?: string | null
    status?: 'Active' | 'Inactive'
}

type DepartmentOption = {
    id: string
    name: string
}

type BranchOption = {
    id: string
    name: string
}

type TimesheetEntry = {
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
}

const EmployeeRegistration: React.FC<{
    form: ReturnType<typeof Form.useForm>[0]
    mode: 'create' | 'edit'
    initialEmployee?: EmployeeRow | null
    onSubmit: (employee: any) => Promise<void>
    departments: DepartmentOption[]
    branches: BranchOption[]
    positionOptions: string[]
}> = ({ form, mode, initialEmployee, onSubmit, departments, branches, positionOptions }) => {
    const workerType = Form.useWatch('workerType', form)
    const selectedRoleDisplay = Form.useWatch('role', form)

    const effectiveRole =
        mode === 'edit' ? initialEmployee?.role : backendRoleFromDisplay(selectedRoleDisplay)
    const showBranch = roleNeedsBranch(effectiveRole)
    const showDepartment = roleNeedsDepartment(effectiveRole)

    useEffect(() => {
        if (mode === 'edit' && initialEmployee) {
            form.setFieldsValue({
                name: initialEmployee.name,
                email: initialEmployee.email,
                role: displayRole(initialEmployee.role),
                position: initialEmployee.position,
                workerType: initialEmployee.workerType || 'permanent',
                departmentId:
                    initialEmployee.departmentId ||
                    departments.find(dep => dep.name === initialEmployee.department)?.id,
                branchId:
                    initialEmployee.branchId ||
                    branches.find(branch => branch.name === initialEmployee.branch)?.id,
                startDate: initialEmployee.startDate ? dayjs(initialEmployee.startDate) : null,
                endDate: initialEmployee.endDate ? dayjs(initialEmployee.endDate) : null,
                status: initialEmployee.status !== 'Inactive'
            })
        } else {
            form.resetFields()
            form.setFieldsValue({
                workerType: 'permanent',
                status: true
            })
        }
    }, [mode, initialEmployee, departments, branches, form])

    useEffect(() => {
        if (workerType !== 'intern') {
            form.setFieldsValue({ endDate: null })
        }
    }, [workerType, form])

    useEffect(() => {
        if (!showBranch) form.setFieldsValue({ branchId: undefined })
    }, [showBranch, form])

    useEffect(() => {
        if (!showDepartment) form.setFieldsValue({ departmentId: undefined })
    }, [showDepartment, form])

    const onFinish = async (values: any) => {
        await onSubmit(values)

        if (mode === 'create') {
            form.resetFields()
            form.setFieldsValue({
                workerType: 'permanent',
                status: true
            })
        }
    }

    return (
        <Form form={form} layout='vertical' onFinish={onFinish}>
            <Row gutter={[12, 0]}>
                <Col xs={24} md={12}>
                    <Form.Item
                        label='Full Name'
                        name='name'
                        rules={[{ required: true, message: 'Please enter employee name' }]}
                    >
                        <Input placeholder='Employee full name' />
                    </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                    <Form.Item
                        label='Email'
                        name='email'
                        rules={[
                            { required: true, message: 'Please enter employee email' },
                            { type: 'email', message: 'Please enter a valid email address' }
                        ]}
                    >
                        <Input
                            placeholder='Employee email address'
                            disabled={mode === 'edit'}
                        />
                    </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                    {mode === 'create' ? (
                        <Form.Item
                            label='System Role'
                            name='role'
                            rules={[{ required: true, message: 'Please select system role' }]}
                        >
                            <Select placeholder='Select system role'>
                                {STAFF_ROLES.map(role => (
                                    <Select.Option key={role} value={role}>
                                        {role}
                                    </Select.Option>
                                ))}
                            </Select>
                        </Form.Item>
                    ) : (
                        <Form.Item label='System Role'>
                            <Input value={displayRole(initialEmployee?.role)} disabled />
                        </Form.Item>
                    )}
                </Col>

                <Col xs={24} md={12}>
                    <Form.Item
                        label='HR Position'
                        name='position'
                        rules={[{ required: true, message: 'Please select or enter HR position' }]}
                    >
                        <Select
                            showSearch
                            placeholder='Select or type HR position'
                            optionFilterProp='label'
                            dropdownRender={menu => menu}
                            options={positionOptions.map(position => ({
                                value: position,
                                label: position
                            }))}
                            onSearch={value => {
                                if (value?.trim()) {
                                    form.setFieldValue('position', normalizePositionLabel(value))
                                }
                            }}
                            onInputKeyDown={e => {
                                if (e.key === 'Enter') {
                                    const input = (e.target as HTMLInputElement).value
                                    if (input?.trim()) {
                                        e.preventDefault()
                                        form.setFieldValue('position', normalizePositionLabel(input))
                                    }
                                }
                            }}
                        />
                    </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                    <Form.Item
                        label='Worker Type'
                        name='workerType'
                        rules={[{ required: true, message: 'Please select worker type' }]}
                    >
                        <Select placeholder='Select worker type'>
                            <Select.Option value='permanent'>Permanent Worker</Select.Option>
                            <Select.Option value='intern'>Intern</Select.Option>
                        </Select>
                    </Form.Item>
                </Col>

                {showBranch && (
                    <Col xs={24} md={12}>
                        <Form.Item
                            label='Branch'
                            name='branchId'
                            rules={[{ required: true, message: 'Please select a branch' }]}
                        >
                            <Select
                                showSearch
                                placeholder='Select branch'
                                optionFilterProp='label'
                                options={branches.map(branch => ({
                                    value: branch.id,
                                    label: branch.name
                                }))}
                            />
                        </Form.Item>
                    </Col>
                )}

                {showDepartment && (
                    <Col xs={24} md={12}>
                        <Form.Item
                            label='Department'
                            name='departmentId'
                            rules={[{ required: true, message: 'Please select a department' }]}
                        >
                            <Select
                                showSearch
                                placeholder='Select department'
                                optionFilterProp='label'
                                options={departments.map(dep => ({
                                    value: dep.id,
                                    label: dep.name
                                }))}
                            />
                        </Form.Item>
                    </Col>
                )}

                <Col xs={24} md={12}>
                    <Form.Item
                        label='Start Date'
                        name='startDate'
                        rules={[{ required: true, message: 'Please select a start date' }]}
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                </Col>

                {workerType === 'intern' && (
                    <Col xs={24} md={12}>
                        <Form.Item
                            label='Intern End Date'
                            name='endDate'
                            dependencies={['startDate']}
                            tooltip='Required for interns.'
                            rules={[
                                { required: true, message: 'Please select the internship end date' },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        const startDate = getFieldValue('startDate')
                                        if (!value || !startDate || value.isAfter(startDate, 'day')) {
                                            return Promise.resolve()
                                        }
                                        return Promise.reject(
                                            new Error('Intern end date must be after the start date')
                                        )
                                    }
                                })
                            ]}
                        >
                            <DatePicker style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                )}

                <Col span={24}>
                    <Form.Item name='status' label='Status' valuePropName='checked'>
                        <Switch checkedChildren='Active' unCheckedChildren='Inactive' />
                    </Form.Item>
                </Col>
            </Row>
        </Form>
    )
}

function mapRoleToPosition(role?: string, fallback?: string): string {
    const r = (role || '').toLowerCase()
    if (r === 'operations') return 'Head Of Department'
    if (r === 'projectadmin') return 'Centre Coordinator'
    if (r === 'coordinator' || r === 'consultant') return 'Coordinator'
    if (r === 'employee' || r === 'auxiliary') return 'Employee'
    if (fallback && fallback.trim()) return fallback
    if (role && role.trim()) {
        return role
            .split(/[\s_-]+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
    }
    return '—'
}

const ROLE_DISPLAY_MAP: Record<string, string> = {
    projectadmin: 'Center Coordinator',
    operations: 'Head Of Department',
    coordinator: 'Coordinator',
    consultant: 'Coordinator',
    receptionist: 'Receptionist',
    employee: 'Employee',
    auxiliary: 'Employee',
    director: 'Director'
}

const ROLE_BACKEND_MAP: Record<string, string> = {
    'Center Coordinator': 'projectadmin',
    'Head Of Department': 'operations',
    Coordinator: 'coordinator',
    Receptionist: 'receptionist',
    Employee: 'employee',
    Director: 'director'
}

const STAFF_ROLES = [
    'Head Of Department',
    'Center Coordinator',
    'Coordinator',
    'Receptionist',
    'Employee'
]

function displayRole(role?: string) {
    const key = String(role || '').toLowerCase()
    return ROLE_DISPLAY_MAP[key] || role || '—'
}

function backendRoleFromDisplay(role?: string) {
    return ROLE_BACKEND_MAP[String(role || '')] || String(role || '').toLowerCase()
}

const BRANCH_ROLES = ['employee', 'auxiliary', 'projectadmin', 'coordinator', 'consultant']
const DEPARTMENT_ROLES = ['operations', 'coordinator', 'consultant']

function roleNeedsBranch(role?: string): boolean {
    return BRANCH_ROLES.includes(String(role || '').toLowerCase())
}

function roleNeedsDepartment(role?: string): boolean {
    return DEPARTMENT_ROLES.includes(String(role || '').toLowerCase())
}

function resolveEmployeePosition(role?: string, position?: string, jobTitle?: string): string {
    if (position && position.trim()) return position.trim()
    if (jobTitle && jobTitle.trim()) return jobTitle.trim()
    return mapRoleToPosition(role)
}

function formatWorkerType(workerType?: string) {
    if (workerType === 'intern') return 'Intern'
    if (workerType === 'permanent') return 'Permanent Worker'
    return '—'
}

function normalizePositionKey(position: string) {
    return position
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function normalizePositionLabel(position: string) {
    return position.trim().replace(/\s+/g, ' ')
}

function isControlEmail(email?: string): boolean {
    if (!email) return false
    return email.toLowerCase().endsWith('@quantilytix.co.za')
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size))
    }
    return chunks
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
    return [...new Set(values.filter(Boolean).map(v => String(v)))]
}

function sumTime(values: string[] = []) {
    let totalMin = 0

    values.forEach(s => {
        if (!s) return
        const match = /(\d+)h\s+(\d+)m/.exec(s)
        const h = match ? Number(match[1]) : 0
        const m = match ? Number(match[2]) : 0
        totalMin += h * 60 + m
    })

    const H = Math.floor(totalMin / 60)
    const M = totalMin % 60
    return `${H}h ${M}m`
}

const EmployeesPage: React.FC = () => {
    const [loading, setLoading] = useState(true)
    const [employees, setEmployees] = useState<EmployeeRow[]>([])
    const [search, setSearch] = useState('')
    const [positionFilter, setPositionFilter] = useState<string | undefined>()
    const [departmentFilter, setDepartmentFilter] = useState<string | undefined>()

    const [metricsLoading, setMetricsLoading] = useState(false)
    const [metrics, setMetrics] = useState({
        totalStaff: 0,
        departments: 0,
        positions: 0,
        pendingLeave: 0,
        onLeaveToday: 0,
        checkedInToday: 0
    })

    const [addOpen, setAddOpen] = useState(false)
    const [addForm] = Form.useForm()
    const [savingEmployee, setSavingEmployee] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [editForm] = Form.useForm()
    const [editingEmployee, setEditingEmployee] = useState<EmployeeRow | null>(null)
    const [departments, setDepartments] = useState<DepartmentOption[]>([])
    const [departmentsLoading, setDepartmentsLoading] = useState(false)
    const [branches, setBranches] = useState<BranchOption[]>([])
    const [branchesLoading, setBranchesLoading] = useState(false)
    const [savedPositions, setSavedPositions] = useState<string[]>([])
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<React.Key[]>([])
    const [bulkPositionOpen, setBulkPositionOpen] = useState(false)
    const [bulkSaving, setBulkSaving] = useState(false)
    const [bulkForm] = Form.useForm()
    const [accountEmployee, setAccountEmployee] = useState<EmployeeRow | null>(null)
    const [emailOpen, setEmailOpen] = useState(false)
    const [accountBusyId, setAccountBusyId] = useState<string | null>(null)
    const [emailForm] = Form.useForm()

    const [timesheetOpen, setTimesheetOpen] = useState(false)
    const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null)
    const [sheetLoading, setSheetLoading] = useState(false)
    const [timesheet, setTimesheet] = useState<TimesheetEntry[]>([])
    const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => {
        const end = dayjs().endOf('day')
        const start = dayjs().subtract(6, 'day').startOf('day')
        return [start, end]
    })

    const [leaveOpen, setLeaveOpen] = useState(false)
    const [leaveForm] = Form.useForm()

    const saveHrPositionOption = async (position: string) => {

        const label = normalizePositionLabel(position)
        if (!label) return

        const key = normalizePositionKey(label)
        if (!key) return

        await setDoc(
            doc(db, 'hrPositions', key),
            {
                key,
                label,
                active: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            },
            { merge: true }
        )

        setSavedPositions(prev => {
            const next = new Set([...prev, label])
            return [...next].sort()
        })
    }

    const loadHrPositions = async () => {
        try {
            const snap = await getDocs(
                query(collection(db, 'hrPositions'), where('active', '==', true))
            )

            setSavedPositions(
                snap.docs
                    .map(d => String((d.data() as any).label || '').trim())
                    .filter(Boolean)
                    .sort()
            )
        } catch (error) {
            console.warn('[EmployeesPage] HR positions skipped:', error)
            setSavedPositions([])
        }
    }

    useEffect(() => {
        loadHrPositions()
    }, [])

    const loadDepartments = async () => {
        setDepartmentsLoading(true)
        try {
            const snap = await getDocs(collection(db, 'departments'))
            setDepartments(
                snap.docs
                    .map(departmentDoc => {
                        const data = departmentDoc.data() as any
                        return {
                            id: departmentDoc.id,
                            name: String(data.name || data.departmentName || '').trim(),
                            active: data.isActive !== false
                        }
                    })
                    .filter(dep => dep.active && dep.name)
                    .map(({ id, name }) => ({ id, name }))
                    .sort((a, b) => a.name.localeCompare(b.name))
            )
        } catch (error) {
            console.error('[EmployeesPage] Failed to load departments:', error)
            setDepartments([])
            message.error('Could not load departments.')
        } finally {
            setDepartmentsLoading(false)
        }
    }

    useEffect(() => {
        loadDepartments()
    }, [])

    const loadBranches = async () => {
        setBranchesLoading(true)
        try {
            const branchesData = await branchService.getAllBranches()
            setBranches(
                branchesData
                    .map(branch => ({ id: branch.id, name: String((branch as any).name || '').trim() }))
                    .filter(branch => branch.name)
                    .sort((a, b) => a.name.localeCompare(b.name))
            )
        } catch (error) {
            console.error('[EmployeesPage] Failed to load branches:', error)
            setBranches([])
            message.error('Could not load branches.')
        } finally {
            setBranchesLoading(false)
        }
    }

    useEffect(() => {
        loadBranches()
    }, [])

    const loadEmployees = async () => {
        setLoading(true)

        try {
            const qUsers = query(
                collection(db, 'users'),
                where('role', 'not-in', [
                    'incubatee',
                    'Incubatee',
                    'funder',
                    'admin',
                    'system_admin',
                    'director'
                ])
            )

            const snap = await getDocs(qUsers)

            const list: EmployeeRow[] = snap.docs
                .map(d => {
                    const data: any = d.data()
                    const role: string | undefined = data.role
                    const assignedBranch =
                        typeof data.assignedBranch === 'string'
                            ? data.assignedBranch
                            : null

                    return {
                        id: d.id,
                        authUid:
                            data.uid ||
                            data.authUid ||
                            data.userId ||
                            d.id,
                        name:
                            data.name ||
                            data.fullName ||
                            data.email?.split('@')[0],
                        email: data.email,
                        role,
                        position: resolveEmployeePosition(
                            role,
                            data.position,
                            data.jobTitle
                        ),
                        workerType:
                            data.workerType ||
                            data.employmentType ||
                            'permanent',
                        startDate: data.startDate,
                        endDate:
                            data.endDate ||
                            data.internEndDate ||
                            null,
                        department:
                            data.department ||
                            data.departmentName,
                        departmentId:
                            data.departmentId ||
                            null,

                        branchId: assignedBranch,
                        branch: assignedBranch
                            ? branchNameById[assignedBranch] || assignedBranch
                            : '',

                        status: data.status || 'Active'
                    }
                })
                .filter(e => !isControlEmail(e.email))

            setEmployees(list)
        } catch (error) {
            console.error(error)
            message.error('Failed to load employees.')
        } finally {
            setLoading(false)
        }
    }

    const branchNameById = useMemo(
        () =>
            Object.fromEntries(
                branches.map(branch => [
                    branch.id,
                    branch.name
                ])
            ) as Record<string, string>,
        [branches]
    )

    useEffect(() => {
        if (branchesLoading) return

        loadEmployees()
    }, [branchesLoading, branchNameById])

    const basicMetrics = useMemo(() => {
        const totalStaff = employees.length

        const departments = new Set(
            employees
                .map(e => (e.department || '').trim())
                .filter(Boolean)
        ).size

        const positions = new Set(
            employees
                .map(e => (e.position || '').trim())
                .filter(Boolean)
        ).size

        return { totalStaff, departments, positions }
    }, [employees])

    useEffect(() => {
        setMetrics(prev => ({
            ...prev,
            totalStaff: basicMetrics.totalStaff,
            departments: basicMetrics.departments,
            positions: basicMetrics.positions
        }))
    }, [basicMetrics])

    const loadExtraMetrics = async (staffRows: EmployeeRow[]) => {
        setMetricsLoading(true)

        try {
            const today = dayjs().format('YYYY-MM-DD')

            let pendingLeave = 0
            let onLeaveToday = 0

            try {
                const leavesSnap = await getDocs(collection(db, 'leaveRequests'))

                const leaves = leavesSnap.docs.map(d => d.data() as any)

                pendingLeave = leaves.filter(
                    l => (l.status || '').toLowerCase() === 'pending'
                ).length

                onLeaveToday = leaves.filter(l => {
                    const status = (l.status || '').toLowerCase()
                    if (status !== 'approved') return false

                    const from = l.from ? dayjs(l.from) : null
                    const to = l.to ? dayjs(l.to) : null
                    if (!from || !to) return false

                    return dayjs(today).isBetween(from, to, 'day', '[]')
                }).length
            } catch (e) {
                console.warn('[EmployeesPage] leaveRequests metrics skipped:', e)
            }

            let checkedInToday = 0

            try {
                const candidateUserIds = uniqueStrings(
                    staffRows.flatMap(emp => [emp.authUid, emp.id])
                )

                if (candidateUserIds.length > 0) {
                    const chunks = chunkArray(candidateUserIds, 10)
                    const docs: TimesheetEntry[] = []

                    for (const ids of chunks) {
                        const constraints: QueryConstraint[] = [
                            where('date', '==', today),
                            where('userId', 'in', ids)
                        ]

                        const snap = await getDocs(
                            query(collection(db, 'timesheets'), ...constraints)
                        )

                        snap.docs.forEach(d => {
                            docs.push({
                                id: d.id,
                                ...(d.data() as any)
                            })
                        })
                    }

                    const uniqueUsers = new Set(
                        docs
                            .filter(d => !!d.checkIn && d.checkIn !== '-')
                            .map(d => String(d.userId))
                    )

                    checkedInToday = uniqueUsers.size
                }
            } catch (e) {
                console.warn('[EmployeesPage] checked-in metrics skipped:', e)
            }

            setMetrics(prev => ({
                ...prev,
                pendingLeave,
                onLeaveToday,
                checkedInToday
            }))
        } finally {
            setMetricsLoading(false)
        }
    }

    useEffect(() => {
        if (!loading) {
            loadExtraMetrics(employees)
        }
    }, [employees, loading])

    const filtered = useMemo(() => {
        let rows = [...employees]

        if (search) {
            const needle = search.toLowerCase()
            rows = rows.filter(
                r =>
                    (r.name || '').toLowerCase().includes(needle) ||
                    (r.email || '').toLowerCase().includes(needle) ||
                    (r.position || '').toLowerCase().includes(needle) ||
                    (r.department || '').toLowerCase().includes(needle) ||
                    (r.branch || '').toLowerCase().includes(needle)
            )
        }

        if (positionFilter) {
            rows = rows.filter(
                r => (r.position || '').toLowerCase() === positionFilter.toLowerCase()
            )
        }

        if (departmentFilter) {
            rows = rows.filter(
                r => (r.department || '').toLowerCase() === departmentFilter.toLowerCase()
            )
        }

        return rows
    }, [employees, search, positionFilter, departmentFilter])

    const positionOptions = useMemo(() => {
        const fromEmployees = employees
            .map(e => e.position)
            .filter(Boolean)
            .map(p => normalizePositionLabel(p as string))

        const fromSaved = savedPositions.map(normalizePositionLabel)

        return [...new Set([...fromSaved, ...fromEmployees])]
            .filter(Boolean)
            .sort()
    }, [employees, savedPositions])

    const departmentOptions = useMemo(
        () => departments.map(department => department.name),
        [departments]
    )

    const onAddEmployee = async (employee: any) => {
        const idToken = await auth.currentUser?.getIdToken()

        if (!idToken) {
            message.error('You are not signed in. Please sign in and try again.')
            return
        }

        setSavingEmployee(true)

        try {
            const startDate = employee.startDate?.format
                ? employee.startDate.format('YYYY-MM-DD')
                : employee.startDate || null

            const endDate = employee.endDate?.format
                ? employee.endDate.format('YYYY-MM-DD')
                : employee.endDate || null

            const position = normalizePositionLabel(employee.position || '')
            const backendRole = backendRoleFromDisplay(employee.role)
            const needsDepartment = roleNeedsDepartment(backendRole)
            const needsBranch = roleNeedsBranch(backendRole)

            const selectedDepartment = needsDepartment
                ? departments.find(department => department.id === employee.departmentId)
                : null

            if (needsDepartment && !selectedDepartment) {
                message.error('Please select a valid department.')
                return
            }

            const selectedBranch = needsBranch
                ? branches.find(branch => branch.id === employee.branchId)
                : null

            if (needsBranch && !selectedBranch) {
                message.error('Please select a valid branch.')
                return
            }

            const payload = {
                email: String(employee.email || '').trim().toLowerCase(),
                name: String(employee.name || '').trim(),
                role: backendRole,

                position,
                jobTitle: position,

                workerType: employee.workerType || 'permanent',
                employmentType: employee.workerType || 'permanent',

                startDate,
                endDate: employee.workerType === 'intern' ? endDate : null,
                internEndDate: employee.workerType === 'intern' ? endDate : null,

                departmentId: selectedDepartment?.id || null,
                department: selectedDepartment?.name || null,
                departmentName: selectedDepartment?.name || null,

                assignedBranch: selectedBranch?.id || null,

                status: employee.status ? 'Active' : 'Inactive',

                mustRegister: false,
                sendEmail: true,
                sendResetLink: true,
                allowExisting: false
            }

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

            const data = await resp.json().catch(() => null)

            if (!resp.ok || !data?.ok) {
                const rawError = data?.error || data?.code || data?.message

                if (rawError === 'email_already_exists' || rawError === 'auth/email-already-exists') {
                    message.error('This email is already registered on the platform.')
                    return
                }

                if (rawError === 'invalid_role' || rawError === 'invalid_role_for_creator') {
                    message.error('You are not allowed to assign that system role.')
                    return
                }

                message.error('Could not create employee. Please check the details and try again.')
                return
            }

            setAddOpen(false)
            await saveHrPositionOption(position)
            await loadEmployees()

            message.success('Employee created successfully. A password setup email has been sent.')
        } catch (error: any) {
            console.error(error)
            message.error(
                error?.message?.includes('Failed to fetch')
                    ? 'Could not reach the server. Please check your connection and try again.'
                    : 'Could not create employee.'
            )
        } finally {
            setSavingEmployee(false)
        }
    }

    const onUpdateEmployee = async (employee: any) => {
        if (!editingEmployee) return

        setSavingEmployee(true)

        try {
            const startDate = employee.startDate?.format
                ? employee.startDate.format('YYYY-MM-DD')
                : employee.startDate || null

            const endDate = employee.endDate?.format
                ? employee.endDate.format('YYYY-MM-DD')
                : employee.endDate || null

            const position = normalizePositionLabel(employee.position || '')
            const needsDepartment = roleNeedsDepartment(editingEmployee.role)
            const needsBranch = roleNeedsBranch(editingEmployee.role)

            const selectedDepartment = needsDepartment
                ? departments.find(department => department.id === employee.departmentId)
                : null

            if (needsDepartment && !selectedDepartment) {
                message.error('Please select a valid department.')
                return
            }

            const selectedBranch = needsBranch
                ? branches.find(branch => branch.id === employee.branchId)
                : null

            if (needsBranch && !selectedBranch) {
                message.error('Please select a valid branch.')
                return
            }

            const patch = {
                name: String(employee.name || '').trim(),

                // System role intentionally not editable here.
                position,
                jobTitle: position,

                workerType: employee.workerType || 'permanent',
                employmentType: employee.workerType || 'permanent',

                startDate,
                endDate: employee.workerType === 'intern' ? endDate : null,
                internEndDate: employee.workerType === 'intern' ? endDate : null,

                departmentId: selectedDepartment?.id || null,
                department: selectedDepartment?.name || null,
                departmentName: selectedDepartment?.name || null,

                assignedBranch: selectedBranch?.id || null,

                status: employee.status ? 'Active' : 'Inactive',
                updatedAt: new Date().toISOString()
            }

            await updateDoc(doc(db, 'users', editingEmployee.id), patch)
            await saveHrPositionOption(position)

            setEditOpen(false)
            setEditingEmployee(null)
            await loadEmployees()

            message.success('Employee updated successfully.')
        } catch (error) {
            console.error(error)
            message.error('Could not update employee.')
        } finally {
            setSavingEmployee(false)
        }
    }


    const onBulkUpdatePosition = async (values: { position: string }) => {
        if (!selectedEmployeeIds.length) {
            message.warning('Select at least one employee.')
            return
        }

        const position = normalizePositionLabel(values.position || '')

        if (!position) {
            message.warning('Select a valid HR position.')
            return
        }

        setBulkSaving(true)

        try {
            const batch = writeBatch(db)

            selectedEmployeeIds.forEach(id => {
                batch.update(doc(db, 'users', String(id)), {
                    position,
                    jobTitle: position,
                    updatedAt: new Date().toISOString()
                })
            })

            await batch.commit()
            await saveHrPositionOption(position)

            setBulkPositionOpen(false)
            bulkForm.resetFields()
            setSelectedEmployeeIds([])
            await loadEmployees()

            message.success(`Updated HR position for ${selectedEmployeeIds.length} employee(s).`)
        } catch (error) {
            console.error(error)
            message.error('Could not update selected employees.')
        } finally {
            setBulkSaving(false)
        }
    }

    const loadTimesheet = async (
        emp: EmployeeRow | null,
        selectedRange: [dayjs.Dayjs, dayjs.Dayjs]
    ) => {
        if (!emp) {
            setTimesheet([])
            return
        }

        setSheetLoading(true)

        try {
            const [start, end] = selectedRange
            const startKey = start.format('YYYY-MM-DD')
            const endKey = end.format('YYYY-MM-DD')

            const candidateUserIds = uniqueStrings([emp.authUid, emp.id])
            const merged = new Map<string, TimesheetEntry>()

            for (const userId of candidateUserIds) {
                const constraints: QueryConstraint[] = [
                    where('userId', '==', userId),
                    where('date', '>=', startKey),
                    where('date', '<=', endKey),
                    orderBy('date', 'desc')
                ]

                const snap = await getDocs(query(collection(db, 'timesheets'), ...constraints))

                snap.docs.forEach(d => {
                    const row = {
                        id: d.id,
                        ...(d.data() as any)
                    } as TimesheetEntry

                    const key = row.id || `${row.userId}_${row.date}_${row.checkIn || ''}`
                    merged.set(key, row)
                })
            }

            const rows = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date))
            setTimesheet(rows)
        } catch (error) {
            console.error(error)
            message.error('Failed to load timesheet.')
            setTimesheet([])
        } finally {
            setSheetLoading(false)
        }
    }

    useEffect(() => {
        if (timesheetOpen) {
            loadTimesheet(selectedEmployee, range)
        }
    }, [timesheetOpen, selectedEmployee?.id, selectedEmployee?.authUid, range])

    const weeklySummary = useMemo(() => {
        const hours = sumTime(timesheet.map(t => t.hoursWorked || '0h 0m'))
        const overtime = sumTime(timesheet.map(t => t.overtime || '0h 0m'))
        const lateMins = timesheet.reduce(
            (acc, t) => acc + (parseInt((t.lateBy || '0m').replace(/\D/g, '')) || 0),
            0
        )
        return { hours, overtime, late: `${lateMins}m` }
    }, [timesheet])

    const openLeaveFor = (emp: EmployeeRow) => {
        setSelectedEmployee(emp)
        leaveForm.resetFields()
        leaveForm.setFieldsValue({
            type: 'annual',
            dates: [dayjs().add(1, 'day'), dayjs().add(1, 'day')],
            reason: ''
        })
        setLeaveOpen(true)
    }

    const submitLeave = async (vals: {
        type: 'annual' | 'sick' | 'personal'
        dates: dayjs.Dayjs[]
        reason: string
    }) => {
        if (!selectedEmployee) return

        const [from, to] = vals.dates || []

        const payload = {
            employeeId: selectedEmployee.authUid || selectedEmployee.id,
            employeeEmail: selectedEmployee.email || '',
            employeeName: selectedEmployee.name || '',
            employeePhoto: '',
            type: vals.type,
            reason: vals.reason,
            from: from?.format('YYYY-MM-DD'),
            to: to?.format('YYYY-MM-DD'),
            days: from && to ? to.diff(from, 'day') + 1 : 1,
            status: 'pending' as const,
            appliedDate: dayjs().format('YYYY-MM-DD')
        }

        try {
            await addDoc(collection(db, 'leaveRequests'), payload)
            message.success('Leave request submitted')
            setLeaveOpen(false)
        } catch (error) {
            console.error(error)
            message.warning('Saved locally (Firestore unavailable)')
            setLeaveOpen(false)
        }
    }

    const exportTimesheetCSV = () => {
        if (!selectedEmployee) return

        const header = [
            'Date,Check In,Check Out,Hours Worked,Late By,Overtime,Status,Location'
        ]

        const lines = timesheet
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(t =>
                [
                    t.date,
                    t.checkIn || '-',
                    t.checkOut || '-',
                    t.hoursWorked || '0h 0m',
                    t.lateBy || '0m',
                    t.overtime || '0h 0m',
                    t.status,
                    `"${t.locationLabel || t.location || ''}"`
                ].join(',')
            )

        const csv = header.concat(lines).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `timesheet_${selectedEmployee.name || selectedEmployee.id}_${range[0].format('YYYYMMDD')}_${range[1].format('YYYYMMDD')}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const sendPasswordReset = async (employee: EmployeeRow) => {
        if (!employee.email) {
            message.error('This employee does not have an email address.')
            return
        }

        setAccountBusyId(employee.id)
        try {
            const sendReset = httpsCallable(functions, 'sendLoggedPasswordResetEmail')
            await sendReset({ email: employee.email })
            message.success(`Password reset email sent to ${employee.email}.`)
        } catch (error) {
            console.error(error)
            message.error('Could not send the password reset email.')
        } finally {
            setAccountBusyId(null)
        }
    }

    const resendAccountSetupEmail = async (employee: EmployeeRow) => {
        if (!employee.email) {
            message.error('This employee does not have an email address.')
            return
        }

        setAccountBusyId(employee.id)
        try {
            const resendWelcome = httpsCallable(functions, 'resendWelcomeEmail')
            await resendWelcome({ uid: employee.authUid || employee.id })
            message.success(`Account setup email resent to ${employee.email}.`)
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Could not resend the account setup email.')
        } finally {
            setAccountBusyId(null)
        }
    }

    const setAccountStatus = async (employee: EmployeeRow, active: boolean) => {
        setAccountBusyId(employee.id)
        try {
            const updateStatus = httpsCallable(functions, 'setEmployeeAccountStatus')
            await updateStatus({
                uid: employee.authUid || employee.id,
                active
            })
            await loadEmployees()
            message.success(
                active
                    ? 'Employee account reactivated.'
                    : 'Employee account disabled. HR records were retained.'
            )
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Could not update the employee account.')
        } finally {
            setAccountBusyId(null)
        }
    }

    const openEmailChange = (employee: EmployeeRow) => {
        setAccountEmployee(employee)
        emailForm.setFieldsValue({ email: employee.email })
        setEmailOpen(true)
    }

    const changeEmployeeEmail = async (values: { email: string }) => {
        if (!accountEmployee) return

        setAccountBusyId(accountEmployee.id)
        try {
            const updateEmail = httpsCallable(functions, 'updateUserEmailCascade')
            await updateEmail({
                uid: accountEmployee.authUid || accountEmployee.id,
                newEmail: String(values.email || '').trim().toLowerCase()
            })
            setEmailOpen(false)
            setAccountEmployee(null)
            emailForm.resetFields()
            await loadEmployees()
            message.success('Login email and linked document references were updated.')
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Could not change the employee email.')
        } finally {
            setAccountBusyId(null)
        }
    }

    const permanentlyDeleteEmployee = async (employee: EmployeeRow) => {
        setAccountBusyId(employee.id)
        try {
            const cascadeDelete = httpsCallable(functions, 'deleteUserCascade')
            const preview = await cascadeDelete({
                uid: employee.authUid || employee.id,
                dryRun: true
            })
            const impact = (preview.data as any)?.impact
            const documentCount = Number(impact?.totalDocs || 0)

            Modal.confirm({
                title: `Permanently remove ${employee.name || employee.email || 'employee'}?`,
                icon: <DeleteOutlined style={{ color: '#dc2626' }} />,
                width: 560,
                okText: 'Permanently delete',
                okButtonProps: { danger: true },
                content: (
                    <Space direction='vertical' style={{ width: '100%' }}>
                        <Alert
                            type='error'
                            showIcon
                            message='This cannot be undone'
                            description={`Authentication access and ${documentCount} linked document(s) will be removed. Use Disable Account when employment has merely ended.`}
                        />
                        <Text>
                            Payroll, attendance, leave and performance history may be affected by
                            permanent removal.
                        </Text>
                    </Space>
                ),
                onOk: async () => {
                    try {
                        await cascadeDelete({
                            uid: employee.authUid || employee.id,
                            confirm: true
                        })
                        await loadEmployees()
                        message.success(
                            'Employee authentication account and linked documents removed.'
                        )
                    } catch (error: any) {
                        console.error(error)
                        message.error(error?.message || 'Permanent account removal failed.')
                        throw error
                    }
                }
            })
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Could not prepare permanent account removal.')
        } finally {
            setAccountBusyId(null)
        }
    }

    const employeeColumns = [
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            render: (v: string) => (
                <Space>
                    <TeamOutlined />
                    <span>{v || '—'}</span>
                </Space>
            )
        },
        {
            title: 'Email',
            dataIndex: 'email',
            key: 'email',
            render: (v: string) => (
                <Space>
                    <MailOutlined />
                    <span>{v || '—'}</span>
                </Space>
            )
        },
        {
            title: 'Position',
            dataIndex: 'position',
            key: 'position',
            render: (v: string) => v || '—'
        },
        {
            title: 'Worker Type',
            dataIndex: 'workerType',
            key: 'workerType',
            render: (v: string) => (
                <Tag color={v === 'intern' ? 'gold' : 'green'} style={{ borderRadius: 999 }}>
                    {formatWorkerType(v)}
                </Tag>
            )
        },
        {
            title: 'Branch / Department',
            key: 'branchDepartment',
            render: (_: any, r: EmployeeRow) => {
                const needsBranch = roleNeedsBranch(r.role)
                const needsDepartment = roleNeedsDepartment(r.role)

                if (needsBranch && needsDepartment) {
                    return (
                        <Space direction='vertical' size={0}>
                            <span>Branch: {r.branch || '—'}</span>
                            <span>Dept: {r.department || '—'}</span>
                        </Space>
                    )
                }

                if (needsBranch) return r.branch || '—'
                if (needsDepartment) return r.department || '—'
                return '—'
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, r: EmployeeRow) => (
                <Space wrap>
                    <Button
                        shape='round'
                        icon={<EditOutlined />}
                        onClick={() => {
                            setEditingEmployee(r)
                            setEditOpen(true)
                        }}
                    >
                        Edit
                    </Button>

                    <Button
                        shape='round'
                        icon={<FileTextOutlined />}
                        onClick={() => {
                            setSelectedEmployee(r)
                            setTimesheetOpen(true)
                        }}
                    >
                        View Timesheet
                    </Button>

                    <Button
                        shape='round'
                        icon={<CalendarOutlined />}
                        onClick={() => openLeaveFor(r)}
                    >
                        Put on Leave
                    </Button>

                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                {
                                    key: 'email',
                                    icon: <SwapOutlined />,
                                    label: 'Change login email',
                                    onClick: () => openEmailChange(r)
                                },
                                {
                                    key: 'password',
                                    icon: <KeyOutlined />,
                                    label: 'Send password reset',
                                    onClick: () => sendPasswordReset(r)
                                },
                                {
                                    key: 'resendWelcome',
                                    icon: <MailOutlined />,
                                    label: 'Resend account setup email',
                                    onClick: () => resendAccountSetupEmail(r)
                                },
                                {
                                    key: 'status',
                                    icon:
                                        r.status === 'Inactive'
                                            ? <PlayCircleOutlined />
                                            : <StopOutlined />,
                                    label:
                                        r.status === 'Inactive'
                                            ? 'Reactivate account'
                                            : 'Disable account',
                                    onClick: () =>
                                        setAccountStatus(r, r.status === 'Inactive')
                                },
                                { type: 'divider' },
                                {
                                    key: 'delete',
                                    danger: true,
                                    icon: <DeleteOutlined />,
                                    label: 'Permanently delete',
                                    onClick: () => permanentlyDeleteEmployee(r)
                                }
                            ]
                        }}
                    >
                        <Button
                            shape='round'
                            icon={<UserOutlined />}
                            loading={accountBusyId === r.id}
                        >
                            Account
                        </Button>
                    </Dropdown>
                </Space>
            )
        }
    ]

    const rowSelection = {
        selectedRowKeys: selectedEmployeeIds,
        onChange: (keys: React.Key[]) => setSelectedEmployeeIds(keys)
    }

    if (loading) {
        return (
            <div style={{ minHeight: '100vh' }}>
                <LoadingOverlay tip='Loading employees' />
            </div>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} md={8} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<TeamOutlined />}
                            iconBg='rgba(22,119,255,.12)'
                            title='Total Staff'
                            value={metrics.totalStaff}
                            subtitle='Active visible staff'
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={8} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<ApartmentOutlined />}
                            iconBg='rgba(82,196,26,.12)'
                            title='Departments'
                            value={metrics.departments}
                            subtitle='Distinct departments'
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={8} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<IdcardOutlined />}
                            iconBg='rgba(250,173,20,.12)'
                            title='Positions'
                            value={metrics.positions}
                            subtitle='Distinct positions'
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={8} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<CalendarOutlined />}
                            iconBg='rgba(114,46,209,.12)'
                            title='Leave Pending'
                            value={metricsLoading ? '...' : metrics.pendingLeave}
                            subtitle='Awaiting action'
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={8} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<CalendarOutlined />}
                            iconBg='rgba(19,194,194,.12)'
                            title='On Leave Today'
                            value={metricsLoading ? '...' : metrics.onLeaveToday}
                            subtitle='Approved leave'
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={8} lg={4}>
                    <MotionCard>
                        <MotionCard.Metric
                            icon={<CheckCircleOutlined />}
                            iconBg='rgba(82,196,26,.12)'
                            title='Checked-in Today'
                            value={metricsLoading ? '...' : metrics.checkedInToday}
                            subtitle='Timesheet activity today'
                        />
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard
                style={{ marginTop: 16 }}
                filterBar={
                    <Row gutter={[12, 12]} align='middle'>
                        <Col xs={24} md={8} lg={7}>
                            <Input.Search
                                placeholder='Search name, email, position, department, branch'
                                allowClear
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </Col>

                        <Col xs={24} sm={12} md={6} lg={5}>
                            <Select
                                placeholder='Filter position'
                                allowClear
                                style={{ width: '100%' }}
                                value={positionFilter}
                                onChange={v => setPositionFilter(v)}
                            >
                                {positionOptions.map(p => (
                                    <Option key={p} value={p}>
                                        {p}
                                    </Option>
                                ))}
                            </Select>
                        </Col>

                        <Col xs={24} sm={12} md={6} lg={5}>
                            <Select
                                placeholder='Filter department'
                                allowClear
                                style={{ width: '100%' }}
                                value={departmentFilter}
                                onChange={v => setDepartmentFilter(v)}
                            >
                                {departmentOptions.map(dep => (
                                    <Option key={dep} value={dep}>
                                        {dep}
                                    </Option>
                                ))}
                            </Select>
                        </Col>

                        <Col xs={24} md={4} lg={7}>
                            <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
                                <Button
                                    shape='round'
                                    disabled={!selectedEmployeeIds.length}
                                    onClick={() => setBulkPositionOpen(true)}
                                >
                                    Bulk Edit Position ({selectedEmployeeIds.length})
                                </Button>

                                <Button
                                    shape='round'
                                    icon={<ReloadOutlined />}
                                    onClick={loadEmployees}
                                >
                                    Refresh
                                </Button>

                                <Button
                                    type='primary'
                                    shape='round'
                                    icon={<UserAddOutlined />}
                                    onClick={() => setAddOpen(true)}
                                    disabled={
                                        (departmentsLoading || branchesLoading) ||
                                        (!departments.length && !branches.length)
                                    }
                                >
                                    Add Employee
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                }
                filterBarProps={{
                    background: '#f8fafc',
                    borderColor: '#d9e8ff',
                    borderRadius: 14,
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)'
                }}
            >
                <Table
                    rowKey='id'
                    rowSelection={rowSelection}
                    dataSource={filtered}
                    columns={employeeColumns as any}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                />
            </MotionCard>

            <Modal
                open={addOpen}
                onCancel={() => setAddOpen(false)}
                onOk={() => addForm.submit()}
                okText='Add Employee'
                confirmLoading={savingEmployee}
                cancelButtonProps={{ disabled: savingEmployee }}
                width={800}
                destroyOnClose
                title='Add New Employee'
            >
                <EmployeeRegistration
                    form={addForm}
                    mode='create'
                    onSubmit={onAddEmployee}
                    departments={departments}
                    branches={branches}
                    positionOptions={positionOptions}
                />
            </Modal>

            <Modal
                open={editOpen}
                onCancel={() => {
                    setEditOpen(false)
                    setEditingEmployee(null)
                }}
                onOk={() => editForm.submit()}
                okText='Update Employee'
                confirmLoading={savingEmployee}
                cancelButtonProps={{ disabled: savingEmployee }}
                width={800}
                destroyOnClose
                title='Edit Employee'
            >
                <EmployeeRegistration
                    form={editForm}
                    mode='edit'
                    initialEmployee={editingEmployee}
                    onSubmit={onUpdateEmployee}
                    departments={departments}
                    branches={branches}
                    positionOptions={positionOptions}
                />
            </Modal>

            <Modal
                open={emailOpen}
                title={`Change login email${accountEmployee?.name ? ` — ${accountEmployee.name}` : ''}`}
                onCancel={() => {
                    setEmailOpen(false)
                    setAccountEmployee(null)
                    emailForm.resetFields()
                }}
                onOk={() => emailForm.submit()}
                okText='Update Email'
                confirmLoading={accountBusyId === accountEmployee?.id}
                destroyOnClose
            >
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='The employee will use the new email at their next sign-in.'
                />
                <Form form={emailForm} layout='vertical' onFinish={changeEmployeeEmail}>
                    <Form.Item
                        name='email'
                        label='New login email'
                        rules={[
                            { required: true, message: 'Enter the new email address' },
                            { type: 'email', message: 'Enter a valid email address' }
                        ]}
                    >
                        <Input autoComplete='off' />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                open={bulkPositionOpen}
                onCancel={() => {
                    setBulkPositionOpen(false)
                    bulkForm.resetFields()
                }}
                onOk={() => bulkForm.submit()}
                okText='Update Selected'
                confirmLoading={bulkSaving}
                cancelButtonProps={{ disabled: bulkSaving }}
                title={`Bulk Edit HR Position (${selectedEmployeeIds.length})`}
                destroyOnClose
            >
                <Form form={bulkForm} layout='vertical' onFinish={onBulkUpdatePosition}>
                    <Form.Item
                        name='position'
                        label='HR Position'
                        rules={[{ required: true, message: 'Please select or enter HR position' }]}
                    >
                        <Select
                            showSearch
                            placeholder='Select or type HR position'
                            optionFilterProp='label'
                            options={positionOptions.map(position => ({
                                value: position,
                                label: position
                            }))}
                            onSearch={value => {
                                if (value?.trim()) {
                                    bulkForm.setFieldValue('position', normalizePositionLabel(value))
                                }
                            }}
                            onInputKeyDown={e => {
                                if (e.key === 'Enter') {
                                    const input = (e.target as HTMLInputElement).value
                                    if (input?.trim()) {
                                        e.preventDefault()
                                        bulkForm.setFieldValue('position', normalizePositionLabel(input))
                                    }
                                }
                            }}
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                open={timesheetOpen}
                onCancel={() => setTimesheetOpen(false)}
                footer={[
                    <Button key='close' onClick={() => setTimesheetOpen(false)}>
                        Close
                    </Button>
                ]}
                width={1000}
                destroyOnClose
                title={selectedEmployee ? `Timesheet — ${selectedEmployee.name}` : 'Timesheet'}
            >
                {!selectedEmployee ? (
                    <Empty description='No employee selected.' />
                ) : (
                    <>
                        <Row justify='space-between' align='middle' style={{ marginBottom: 12 }}>
                            <Col>
                                <Space wrap>
                                    <RangePicker
                                        value={range as any}
                                        onChange={v => v && setRange(v as any)}
                                        allowClear={false}
                                    />
                                    <Tooltip title='Export CSV'>
                                        <Button
                                            icon={<CloudDownloadOutlined />}
                                            onClick={exportTimesheetCSV}
                                        >
                                            Export
                                        </Button>
                                    </Tooltip>
                                </Space>
                            </Col>
                        </Row>

                        <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
                            <Col xs={24} md={8}>
                                <MotionCard>
                                    <MotionCard.Metric
                                        icon={<ClockCircleOutlined />}
                                        iconBg='rgba(22,119,255,.12)'
                                        title='Total Hours'
                                        value={weeklySummary.hours}
                                    />
                                </MotionCard>
                            </Col>

                            <Col xs={24} md={8}>
                                <MotionCard>
                                    <MotionCard.Metric
                                        icon={<CheckCircleOutlined />}
                                        iconBg='rgba(82,196,26,.12)'
                                        title='Overtime'
                                        value={weeklySummary.overtime}
                                    />
                                </MotionCard>
                            </Col>

                            <Col xs={24} md={8}>
                                <MotionCard>
                                    <MotionCard.Metric
                                        icon={<CalendarOutlined />}
                                        iconBg='rgba(250,173,20,.12)'
                                        title='Late Total'
                                        value={weeklySummary.late}
                                    />
                                </MotionCard>
                            </Col>
                        </Row>

                        <Table<TimesheetEntry>
                            rowKey={r => r.id || `${r.userId}_${r.date}`}
                            loading={sheetLoading}
                            dataSource={timesheet}
                            pagination={{ pageSize: 8 }}
                            columns={[
                                { title: 'Date', dataIndex: 'date', key: 'date' },
                                {
                                    title: 'Check In',
                                    dataIndex: 'checkIn',
                                    key: 'checkIn',
                                    render: v => v || '-'
                                },
                                {
                                    title: 'Check Out',
                                    dataIndex: 'checkOut',
                                    key: 'checkOut',
                                    render: v => v || '-'
                                },
                                {
                                    title: 'Hours Worked',
                                    dataIndex: 'hoursWorked',
                                    key: 'hoursWorked',
                                    render: v => v || '0h 0m'
                                },
                                {
                                    title: 'Late By',
                                    dataIndex: 'lateBy',
                                    key: 'lateBy',
                                    render: l =>
                                        l && l !== '0m' ? (
                                            <Tag color='orange'>Late {l}</Tag>
                                        ) : (
                                            <Tag>On Time</Tag>
                                        )
                                },
                                {
                                    title: 'Overtime',
                                    dataIndex: 'overtime',
                                    key: 'overtime',
                                    render: o =>
                                        o && o !== '0h 0m' ? (
                                            <Tag color='blue'>+{o}</Tag>
                                        ) : (
                                            <Tag>-</Tag>
                                        )
                                },
                                {
                                    title: 'Status',
                                    key: 'status',
                                    render: (_: any, record: TimesheetEntry) => (
                                        <Space wrap>
                                            {record.status === 'checked_in' ? (
                                                <Tag color='green'>Checked In</Tag>
                                            ) : record.status === 'on_break' ? (
                                                <Tag color='gold'>On Break</Tag>
                                            ) : (
                                                <Tag>Checked Out</Tag>
                                            )}

                                            {record.autoClockedOut ? (
                                                <Tag color='orange'>Auto</Tag>
                                            ) : null}
                                        </Space>
                                    )
                                },
                                {
                                    title: 'Location',
                                    key: 'location',
                                    render: (_: any, record: TimesheetEntry) => (
                                        <Space direction='vertical' size={2}>
                                            <Text>{record.locationLabel || record.location || '-'}</Text>
                                            {typeof record.locationAccuracy === 'number' ? (
                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                    Accuracy: {Math.round(record.locationAccuracy)}m
                                                </Text>
                                            ) : null}
                                        </Space>
                                    )
                                }
                            ]}
                        />
                    </>
                )}
            </Modal>

            <Modal
                open={leaveOpen}
                onCancel={() => setLeaveOpen(false)}
                onOk={() => selectedEmployee && leaveForm.submit()}
                okText='Submit'
                title={
                    selectedEmployee
                        ? `Put ${selectedEmployee.name} on Leave`
                        : 'Put on Leave'
                }
                destroyOnClose
            >
                {!selectedEmployee ? (
                    <Empty description='Select an employee first' />
                ) : (
                    <Form form={leaveForm} layout='vertical' onFinish={submitLeave}>
                        <Form.Item label='Employee'>
                            <Input
                                value={`${selectedEmployee.name} (${selectedEmployee.email || 'no email'})`}
                                disabled
                            />
                        </Form.Item>

                        <Form.Item
                            name='type'
                            label='Leave Type'
                            rules={[{ required: true, message: 'Select a leave type' }]}
                            initialValue='annual'
                        >
                            <Select placeholder='Select type'>
                                <Select.Option value='annual'>Annual Leave</Select.Option>
                                <Select.Option value='sick'>Sick Leave</Select.Option>
                                <Select.Option value='personal'>Personal Leave</Select.Option>
                            </Select>
                        </Form.Item>

                        <Form.Item
                            name='dates'
                            label='Dates'
                            rules={[{ required: true, message: 'Select a date range' }]}
                        >
                            <RangePicker allowClear={false} />
                        </Form.Item>

                        <Form.Item
                            name='reason'
                            label='Reason'
                            rules={[{ required: true, message: 'Provide a reason' }]}
                        >
                            <Input.TextArea rows={4} placeholder='Reason for leave' />
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </div>
    )
}

export default EmployeesPage
