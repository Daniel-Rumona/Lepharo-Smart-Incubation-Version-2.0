import React, { useCallback, useMemo, useState } from 'react'
import { Alert, Avatar, Badge, Button, Drawer, Dropdown, Grid, Input, Modal, Popover, Select, Space, Table, Tag, Tooltip, Typography, message, theme } from 'antd'
import type { MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    ApartmentOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    FilterOutlined,
    FileTextOutlined,
    KeyOutlined,
    MailOutlined,
    MoreOutlined,
    PlayCircleOutlined,
    ReloadOutlined,
    StopOutlined,
    SwapOutlined,
    TeamOutlined,
    UserAddOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '@/firebase'
import { functionsBaseUrl } from '@/firebaseConfig'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { MobileCardList } from '@/components/shared/MobileCardList'
import '@/components/shared/setup-segmented.css'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { EmployeeFormModal } from './EmployeeFormModal'
import { TimesheetModal } from './TimesheetModal'
import { BulkPositionModal, ChangeEmailModal } from './EmployeeDialogs'
import { useEmployeesData } from './useEmployeesData'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import {
    errorMessage,
    formatWorkerType,
    normalizePositionLabel,
    roleLabel,
    roleNeedsBranch,
    roleNeedsDepartment,
    toIsoDate,
    type EmployeeFormValues,
    type EmployeeRow
} from './employeeShared'

const { Text } = Typography

type Focus = 'all' | 'interns' | 'disabled'

const FOCUS_LABELS: Record<Exclude<Focus, 'all'>, string> = { interns: 'Interns', disabled: 'Disabled logins' }

const FOCUS_OPTIONS: { value: Focus; label: string }[] = [
    { value: 'all', label: 'All staff' },
    { value: 'interns', label: FOCUS_LABELS.interns },
    { value: 'disabled', label: FOCUS_LABELS.disabled }
]

const CREATE_ERRORS: Record<string, string> = {
    email_already_exists: 'This email is already registered on the platform.',
    'auth/email-already-exists': 'This email is already registered on the platform.',
    invalid_role: 'You are not allowed to assign that system role.',
    invalid_role_for_creator: 'You are not allowed to assign that system role.'
}

const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('')

const EmployeesPage: React.FC = () => {
    const { user } = useFullIdentity()
    const isMobile = useIsMobile()
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()
    const navigate = useNavigate()
    const { hasRole } = useDepartmentRoles()
    const userRole = String(user?.role || '').toLowerCase().trim()
    // Mirrors the recalculateLineManagers callable: HR (by role or department) and the CEO.
    const canEditLineManager =
        ['director', 'hr', 'system_admin', 'superadmin'].includes(userRole) ||
        hasRole(String(user?.departmentId || ''), 'hr')
    // Mirrors adminTools: only directors and admins delete permanently or change HR managers' logins.
    const isDirector = ['director', 'system_admin', 'superadmin'].includes(userRole)
    const isHrManager = useCallback(
        (r: EmployeeRow) => {
            const role = String(r.role || '').toLowerCase().trim()
            return role === 'hr' || (role === 'operations' && hasRole(String(r.departmentId || ''), 'hr'))
        },
        [hasRole]
    )
    const loginLocked = (r: EmployeeRow) => !isDirector && isHrManager(r)

    const data = useEmployeesData()
    const { employees, directors, departments, branches } = data

    const [search, setSearch] = useState('')
    const [focus, setFocus] = useState<Focus>('all')
    const [positionFilter, setPositionFilter] = useState<string>()
    const [departmentFilter, setDepartmentFilter] = useState<string>()
    const [branchFilter, setBranchFilter] = useState<string>()
    const [selectedIds, setSelectedIds] = useState<React.Key[]>([])

    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<EmployeeRow | null>(null)
    const [saving, setSaving] = useState(false)
    const [bulkOpen, setBulkOpen] = useState(false)
    const [emailFor, setEmailFor] = useState<EmployeeRow | null>(null)
    const [timesheetFor, setTimesheetFor] = useState<EmployeeRow | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [recalculating, setRecalculating] = useState(false)
    const [filtersOpen, setFiltersOpen] = useState(false)

    const departmentName = useMemo(() => new Map(departments.map(d => [d.id, d.name])), [departments])
    const branchName = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches])

    // Names come from the live lists by id; the stored name is only a fallback.
    const placement = useCallback(
        (r: EmployeeRow) => ({
            branch: roleNeedsBranch(r.role) ? (r.branchId && branchName.get(r.branchId)) || undefined : undefined,
            department: roleNeedsDepartment(r.role)
                ? (r.departmentId && departmentName.get(r.departmentId)) || r.storedDepartmentName
                : undefined
        }),
        [branchName, departmentName]
    )
    const placementText = useCallback(
        (r: EmployeeRow) => {
            const { branch, department } = placement(r)
            return [branch, department].filter(Boolean).join(' · ') || '—'
        },
        [placement]
    )

    const managerName = (id?: string | null) => (id ? data.personNames.get(id) || 'Unknown user' : null)

    const lineManagerOptions = useMemo(
        () =>
            [
                ...directors.map(d => ({ value: d.id, label: `${d.name} (CEO)` })),
                ...employees
                    .filter(e => e.status === 'Active')
                    .map(e => ({ value: e.id, label: `${e.name} (${roleLabel(e.role)})` }))
            ].sort((a, b) => a.label.localeCompare(b.label)),
        [directors, employees]
    )

    // The edited person's current manager may be someone the list hides; keep them pickable by name.
    const formManagerOptions = useMemo(() => {
        const current = editing?.lineManagerId
        if (!current || lineManagerOptions.some(option => option.value === current)) return lineManagerOptions
        return [...lineManagerOptions, { value: current, label: data.personNames.get(current) || 'Unknown user' }]
    }, [editing, lineManagerOptions, data.personNames])

    const positionOptions = useMemo(
        () =>
            [...new Set([...data.savedPositions, ...employees.map(e => normalizePositionLabel(e.position))])]
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b)),
        [data.savedPositions, employees]
    )

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return employees.filter(r => {
            if (focus === 'interns' && r.workerType !== 'intern') return false
            if (focus === 'disabled' && r.status !== 'Inactive') return false
            if (positionFilter && r.position.toLowerCase() !== positionFilter.toLowerCase()) return false
            if (departmentFilter && r.departmentId !== departmentFilter) return false
            // Same rule as placement(): only roles that sit at a branch count as being there.
            if (branchFilter && !(roleNeedsBranch(r.role) && r.branchId === branchFilter)) return false
            if (!needle) return true
            return [r.name, r.email, r.position, placementText(r)].some(v => String(v || '').toLowerCase().includes(needle))
        })
    }, [employees, search, focus, positionFilter, departmentFilter, branchFilter, placementText])

    // Bulk edits only ever touch rows the filters still show.
    const visibleSelected = useMemo(() => {
        const visible = new Set(filtered.map(r => r.id))
        return selectedIds.filter(id => visible.has(String(id)))
    }, [filtered, selectedIds])

    const metrics = useMemo(
        () => ({
            active: employees.filter(e => e.status === 'Active').length,
            interns: employees.filter(e => e.workerType === 'intern' && e.status === 'Active').length,
            disabled: employees.filter(e => e.status === 'Inactive').length
        }),
        [employees]
    )

    const setAccountStatus = async (uid: string, active: boolean, reason?: string) => {
        await httpsCallable(functions, 'setEmployeeAccountStatus')({ uid, active, reason })
    }

    const lineManagerPatch = (values: EmployeeFormValues) => {
        if (!canEditLineManager) return {}
        // Default leaves the id for the lineManagers function to fill in.
        return values.lineManagerId
            ? { lineManagerId: values.lineManagerId, lineManagerSource: 'manual' }
            : { lineManagerSource: 'default' }
    }

    const createEmployee = async (values: EmployeeFormValues): Promise<boolean> => {
        const idToken = await auth.currentUser?.getIdToken()
        if (!idToken) {
            message.error('You are signed out. Sign in and try again.')
            return false
        }
        const role = values.role || ''
        const department = roleNeedsDepartment(role) ? departments.find(d => d.id === values.departmentId) : undefined
        const branch = roleNeedsBranch(role) ? branches.find(b => b.id === values.branchId) : undefined
        const position = normalizePositionLabel(values.position)
        const endDate = values.workerType === 'intern' ? toIsoDate(values.endDate) : null

        const resp = await fetch(`${functionsBaseUrl}/createPlatformUser`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
                email: values.email.trim().toLowerCase(),
                name: values.name.trim(),
                role,
                position,
                jobTitle: position,
                workerType: values.workerType,
                employmentType: values.workerType,
                startDate: toIsoDate(values.startDate),
                endDate,
                internEndDate: endDate,
                departmentId: department?.id || null,
                department: department?.name || null,
                departmentName: department?.name || null,
                assignedBranch: branch?.id || null,
                status: 'Active',
                mustRegister: false,
                sendEmail: true,
                sendResetLink: true,
                allowExisting: false
            })
        })
        const body = await resp.json().catch(() => null)
        if (!resp.ok || !body?.ok) {
            const code = String(body?.error || body?.code || '')
            message.error(CREATE_ERRORS[code] || 'Could not add the employee. Check the details and try again.')
            return false
        }

        await data.savePosition(position)
        if (!values.active && body.uid) await setAccountStatus(String(body.uid), false, 'Created without login access')
        message.success(`${values.name.trim()} was added and sent a password setup email.`)
        return true
    }

    const updateEmployee = async (employee: EmployeeRow, values: EmployeeFormValues): Promise<boolean> => {
        const department = roleNeedsDepartment(employee.role) ? departments.find(d => d.id === values.departmentId) : undefined
        const branch = roleNeedsBranch(employee.role) ? branches.find(b => b.id === values.branchId) : undefined
        const position = normalizePositionLabel(values.position)
        const endDate = values.workerType === 'intern' ? toIsoDate(values.endDate) : null

        await updateDoc(doc(db, 'users', employee.id), {
            name: values.name.trim(),
            position,
            jobTitle: position,
            workerType: values.workerType,
            employmentType: values.workerType,
            startDate: toIsoDate(values.startDate),
            endDate,
            internEndDate: endDate,
            departmentId: department?.id || null,
            department: department?.name || null,
            departmentName: department?.name || null,
            assignedBranch: branch?.id || null,
            updatedAt: serverTimestamp(),
            ...lineManagerPatch(values)
        })
        await data.savePosition(position)

        // Login access goes through the callable so Auth is disabled too, not just the profile.
        const wasActive = employee.status === 'Active'
        if (values.active !== wasActive) {
            try {
                await setAccountStatus(employee.authUid, values.active, values.active ? undefined : values.disableReason)
            } catch (error) {
                message.warning(`Details saved, but login access was not changed: ${errorMessage(error, 'unknown error')}`)
                return true
            }
        }
        message.success(`${values.name.trim()} was updated.`)
        return true
    }

    const submitEmployee = async (values: EmployeeFormValues) => {
        setSaving(true)
        try {
            const saved = editing ? await updateEmployee(editing, values) : await createEmployee(values)
            if (saved) await data.reload()
            return saved
        } catch (error) {
            console.error('[EmployeesPage] save failed:', error)
            message.error(
                errorMessage(error, '').includes('Failed to fetch')
                    ? 'Could not reach the server. Check your connection and try again.'
                    : 'Could not save the employee.'
            )
            return false
        } finally {
            setSaving(false)
        }
    }

    const submitBulkPosition = async (raw: string) => {
        const position = normalizePositionLabel(raw)
        setSaving(true)
        try {
            const batch = writeBatch(db)
            visibleSelected.forEach(id =>
                batch.update(doc(db, 'users', String(id)), { position, jobTitle: position, updatedAt: serverTimestamp() })
            )
            await batch.commit()
            await data.savePosition(position)
            message.success(`Position set to ${position} for ${visibleSelected.length} employee${visibleSelected.length === 1 ? '' : 's'}.`)
            setSelectedIds([])
            await data.reload()
            return true
        } catch (error) {
            console.error('[EmployeesPage] bulk position failed:', error)
            message.error('Could not update the selected employees.')
            return false
        } finally {
            setSaving(false)
        }
    }

    const submitEmail = async (email: string) => {
        if (!emailFor) return false
        setSaving(true)
        try {
            await httpsCallable(functions, 'updateUserEmailCascade')({ uid: emailFor.authUid, newEmail: email })
            message.success(`Login email changed to ${email}.`)
            await data.reload()
            return true
        } catch (error) {
            console.error('[EmployeesPage] email change failed:', error)
            message.error(errorMessage(error, 'Could not change the login email.'))
            return false
        } finally {
            setSaving(false)
        }
    }

    /** Runs a per-row account action with the row's busy spinner. */
    const runAccountAction = async (employee: EmployeeRow, action: () => Promise<void>, fallback: string) => {
        setBusyId(employee.id)
        try {
            await action()
        } catch (error) {
            console.error('[EmployeesPage] account action failed:', error)
            message.error(errorMessage(error, fallback))
        } finally {
            setBusyId(null)
        }
    }

    const sendPasswordReset = (employee: EmployeeRow) =>
        runAccountAction(
            employee,
            async () => {
                await httpsCallable(functions, 'sendLoggedPasswordResetEmail')({ email: employee.email })
                message.success(`Password reset email sent to ${employee.email}.`)
            },
            'Could not send the password reset email.'
        )

    const resendSetupEmail = (employee: EmployeeRow) =>
        Modal.confirm({
            title: `Resend account setup email to ${employee.name}?`,
            content:
                'Their password is reset to a temporary one and emailed to them. They must change it at their next sign-in, so only do this if they cannot get in.',
            okText: 'Reset and resend',
            className: 'split-confirm',
            onOk: () =>
                runAccountAction(
                    employee,
                    async () => {
                        await httpsCallable(functions, 'resendWelcomeEmail')({ uid: employee.authUid })
                        message.success(`Account setup email resent to ${employee.email}.`)
                    },
                    'Could not resend the account setup email.'
                )
        })

    const toggleAccess = (employee: EmployeeRow) => {
        const enable = employee.status === 'Inactive'
        const run = (reason?: string) =>
            runAccountAction(
                employee,
                async () => {
                    await setAccountStatus(employee.authUid, enable, reason)
                    message.success(enable ? `${employee.name} can sign in again.` : `${employee.name} can no longer sign in. HR records were kept.`)
                    await data.reload()
                },
                'Could not change login access.'
            )
        if (enable) return run()
        // The reason is required and goes to the audit log; OK stays disabled until one is typed.
        let reason = ''
        const okButtonProps = (valid: boolean) => ({ danger: true, disabled: !valid })
        const confirm = Modal.confirm({
            title: `Disable ${employee.name}'s login?`,
            content: (
                <Space direction='vertical' size={8} style={{ width: '100%' }}>
                    <span>They will not be able to sign in. Their HR, attendance, leave and performance records are kept, and you can reactivate them later.</span>
                    <Input.TextArea
                        aria-label='Reason for disabling'
                        placeholder='Reason for disabling (required)'
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        maxLength={500}
                        onChange={e => {
                            reason = e.target.value
                            confirm.update({ okButtonProps: okButtonProps(reason.trim().length >= 3) })
                        }}
                    />
                </Space>
            ),
            okText: 'Disable login',
            okButtonProps: okButtonProps(false),
            className: 'split-confirm',
            onOk: () => run(reason.trim())
        })
    }

    const deletePermanently = (employee: EmployeeRow) =>
        runAccountAction(
            employee,
            async () => {
                const cascadeDelete = httpsCallable<{ uid: string; dryRun?: boolean; confirm?: boolean }, { impact?: { totalDocs?: number } }>(
                    functions,
                    'deleteUserCascade'
                )
                const preview = await cascadeDelete({ uid: employee.authUid, dryRun: true })
                const documentCount = Number(preview.data?.impact?.totalDocs || 0)
                Modal.confirm({
                    title: `Permanently delete ${employee.name}?`,
                    icon: <DeleteOutlined style={{ color: '#dc2626' }} />,
                    width: 520,
                    okText: 'Delete permanently',
                    okButtonProps: { danger: true },
                    className: 'split-confirm',
                    content: (
                        <Alert
                            type='error'
                            showIcon
                            message='This cannot be undone'
                            description={`Their login and ${documentCount} linked record${documentCount === 1 ? '' : 's'} (payroll, attendance, leave, performance) will be removed. If they have left, disable their login instead.`}
                        />
                    ),
                    onOk: async () => {
                        try {
                            await cascadeDelete({ uid: employee.authUid, confirm: true })
                            message.success(`${employee.name} was permanently deleted.`)
                            await data.reload()
                        } catch (error) {
                            message.error(errorMessage(error, 'Permanent deletion failed.'))
                            throw error
                        }
                    }
                })
            },
            'Could not prepare the deletion.'
        )

    const recalculateLineManagers = () =>
        Modal.confirm({
            title: 'Recalculate default line managers?',
            content: 'Everyone on a default line manager is re-matched to the current structure, and open performance records are updated. Managers set by HR are not changed.',
            okText: 'Recalculate',
            className: 'split-confirm',
            onOk: async () => {
                setRecalculating(true)
                try {
                    const result = await httpsCallable<object, { usersUpdated?: number; recordsUpdated?: number }>(
                        functions,
                        'recalculateLineManagers'
                    )({})
                    const { usersUpdated = 0, recordsUpdated = 0 } = result.data || {}
                    message.success(
                        `Line managers recalculated: ${usersUpdated} employee${usersUpdated === 1 ? '' : 's'} and ${recordsUpdated} performance record${recordsUpdated === 1 ? '' : 's'} updated.`
                    )
                    await data.reload()
                } catch (error) {
                    message.error(errorMessage(error, 'Could not recalculate line managers.'))
                } finally {
                    setRecalculating(false)
                }
            }
        })

    const isSelf = (r: EmployeeRow) => r.authUid === user?.uid || r.id === user?.uid

    /** Desktop has its own timesheet button; phones get it in this menu. */
    const rowMenu = (r: EmployeeRow, withTimesheet: boolean): MenuProps['items'] => [
        ...(withTimesheet
            ? [{ key: 'timesheet', icon: <FileTextOutlined />, label: 'View timesheet', onClick: () => setTimesheetFor(r) }]
            : []),
        {
            key: 'leave',
            icon: <CalendarOutlined />,
            label: 'Put on leave',
            // The Leave page's wizard approves it and applies the leave policy limits.
            disabled: r.status === 'Inactive',
            onClick: () => navigate(`/operations/hr/leave?assign=${encodeURIComponent(r.id)}`)
        },
        { type: 'divider' },
        { key: 'email', icon: <SwapOutlined />, label: 'Change login email', onClick: () => setEmailFor(r) },
        { key: 'password', icon: <KeyOutlined />, label: 'Send password reset', disabled: !r.email, onClick: () => sendPasswordReset(r) },
        { key: 'setup', icon: <MailOutlined />, label: 'Resend account setup email', onClick: () => resendSetupEmail(r) },
        {
            key: 'access',
            icon: r.status === 'Inactive' ? <PlayCircleOutlined /> : <StopOutlined />,
            label: loginLocked(r) ? (
                <Tooltip title='Only a director can change this login'>
                    <span>{r.status === 'Inactive' ? 'Reactivate login' : 'Disable login'}</span>
                </Tooltip>
            ) : r.status === 'Inactive' ? 'Reactivate login' : 'Disable login',
            disabled: isSelf(r) || loginLocked(r),
            onClick: () => toggleAccess(r)
        },
        ...(isDirector ? deleteItems(r) : [])
    ]

    const deleteItems = (r: EmployeeRow): NonNullable<MenuProps['items']> => [
        { type: 'divider' },
        { key: 'delete', danger: true, icon: <DeleteOutlined />, label: 'Delete permanently', disabled: isSelf(r), onClick: () => deletePermanently(r) }
    ]

    const openEdit = (r: EmployeeRow) => {
        setEditing(r)
        setFormOpen(true)
    }
    const openAdd = () => {
        setEditing(null)
        setFormOpen(true)
    }

    const statusTag = (r: EmployeeRow) =>
        r.status === 'Inactive' ? (
            <Tag color='default' style={{ borderRadius: 999, margin: 0 }}>Login disabled</Tag>
        ) : r.workerType === 'intern' ? (
            <Tag color='gold' style={{ borderRadius: 999, margin: 0 }}>Intern</Tag>
        ) : null

    const managerCell = (r: EmployeeRow) => {
        const name = managerName(r.lineManagerId)
        if (!name) return <Text type='secondary'>Not set</Text>
        return (
            <Space direction='vertical' size={0}>
                <span>{name}</span>
                <Text type='secondary' style={{ fontSize: 12 }}>
                    {r.lineManagerSource === 'manual' ? 'Set by HR' : 'Default'}
                </Text>
            </Space>
        )
    }

    const columns: ColumnsType<EmployeeRow> = [
        {
            title: 'Employee',
            key: 'employee',
            width: 260,
            sorter: (a, b) => a.name.localeCompare(b.name),
            render: (_, r) => (
                <Space size={12} style={{ opacity: r.status === 'Inactive' ? 0.6 : 1 }}>
                    <Avatar style={{ background: token.colorFillSecondary, color: token.colorText, fontWeight: 600, flexShrink: 0 }}>{initials(r.name)}</Avatar>
                    <Space direction='vertical' size={0} style={{ minWidth: 0 }}>
                        <Space size={6} wrap>
                            <Text strong>{r.name}</Text>
                            {statusTag(r)}
                        </Space>
                        <Text type='secondary' style={{ fontSize: 12 }}>{r.email || 'No email'}</Text>
                    </Space>
                </Space>
            )
        },
        {
            title: 'Position',
            key: 'position',
            sorter: (a, b) => a.position.localeCompare(b.position),
            render: (_, r) => (
                <Space direction='vertical' size={0}>
                    <span>{r.position}</span>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {roleLabel(r.role)} · {formatWorkerType(r.workerType)}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Branch / Department',
            key: 'placement',
            render: (_, r) => {
                const { branch, department } = placement(r)
                if (!branch && !department) return <Text type='secondary'>—</Text>
                return (
                    <Space direction='vertical' size={0}>
                        {department ? <span>{department}</span> : null}
                        {branch ? <Text type={department ? 'secondary' : undefined} style={department ? { fontSize: 12 } : undefined}>{branch}</Text> : null}
                    </Space>
                )
            }
        },
        { title: 'Line manager', key: 'lineManager', render: (_, r) => managerCell(r) },
        {
            title: 'Actions',
            key: 'actions',
            align: 'right',
            width: 150,
            render: (_, r) => (
                <Space size={4}>
                    <Button size='small' icon={<EditOutlined />} onClick={() => openEdit(r)}>
                        Edit
                    </Button>
                    <Tooltip title='Timesheet'>
                        <Button size='small' icon={<FileTextOutlined />} onClick={() => setTimesheetFor(r)} aria-label={`Timesheet for ${r.name}`} />
                    </Tooltip>
                    <Dropdown trigger={['click']} menu={{ items: rowMenu(r, false) }}>
                        <Button size='small' icon={<MoreOutlined />} loading={busyId === r.id} aria-label={`More actions for ${r.name}`} />
                    </Dropdown>
                </Space>
            )
        }
    ]

    const activityValue = (key: 'pendingLeave' | 'onLeaveToday' | 'checkedInToday') => (data.activity ? data.activity[key] : '—')

    // Below xxl the four filters don't fit beside search and the actions, so they move behind a Filters button.
    const filtersInline = Boolean(screens.xxl)
    const activeFilterCount =
        Number(focus !== 'all') + Number(Boolean(departmentFilter)) + Number(Boolean(branchFilter)) + Number(Boolean(positionFilter))
    const departmentIdByName = new Map(departments.map(d => [d.name, d.id]))
    const branchIdByName = new Map(branches.map(b => [b.name, b.id]))
    const filterPanel = (
        <FilterPanel
            canReset={activeFilterCount > 0}
            onReset={() => {
                setFocus('all')
                setDepartmentFilter(undefined)
                setBranchFilter(undefined)
                setPositionFilter(undefined)
            }}
        >
            <ChoiceFilter
                id='emp-show'
                label='Show'
                allLabel='All staff'
                value={focus === 'all' ? 'all' : FOCUS_LABELS[focus]}
                values={[FOCUS_LABELS.interns, FOCUS_LABELS.disabled]}
                onChange={value => setFocus(value === FOCUS_LABELS.interns ? 'interns' : value === FOCUS_LABELS.disabled ? 'disabled' : 'all')}
            />
            <ChoiceFilter
                id='emp-department'
                label='Department'
                allLabel='All departments'
                value={(departmentFilter && departmentName.get(departmentFilter)) || 'all'}
                values={departments.map(d => d.name)}
                onChange={value => setDepartmentFilter(departmentIdByName.get(value))}
            />
            <ChoiceFilter
                id='emp-branch'
                label='Branch'
                allLabel='All branches'
                value={(branchFilter && branchName.get(branchFilter)) || 'all'}
                values={branches.map(b => b.name)}
                onChange={value => setBranchFilter(branchIdByName.get(value))}
            />
            <ChoiceFilter
                id='emp-position'
                label='Position'
                allLabel='All positions'
                value={positionFilter || 'all'}
                values={positionOptions}
                onChange={value => setPositionFilter(value === 'all' ? undefined : value)}
            />
        </FilterPanel>
    )

    return (
        <div style={{ padding: isMobile ? '5px 12px 16px' : 24, minHeight: '100vh' }}>
            <MetricsGrid
                metrics={[
                    {
                        key: 'active',
                        important: true,
                        loading: data.loading,
                        icon: <TeamOutlined />,
                        tone: 'accent',
                        title: 'Active Staff',
                        mobileTitle: 'Staff',
                        value: metrics.active,
                        subtitle: `${metrics.interns} intern${metrics.interns === 1 ? '' : 's'} · ${metrics.disabled} disabled`,
                        mobileSubtitle: `${metrics.interns} interns`
                    },
                    {
                        key: 'pendingLeave',
                        important: true,
                        loading: data.loading || data.activityLoading,
                        icon: <CalendarOutlined />,
                        tone: 'warning',
                        title: 'Leave Pending',
                        mobileTitle: 'Leave',
                        value: activityValue('pendingLeave'),
                        subtitle: 'Open the Leave page',
                        mobileSubtitle: 'Pending',
                        onClick: () => navigate('/operations/hr/leave')
                    },
                    {
                        key: 'onLeave',
                        loading: data.loading || data.activityLoading,
                        icon: <CalendarOutlined />,
                        tone: 'info',
                        title: 'On Leave Today',
                        value: activityValue('onLeaveToday'),
                        subtitle: 'Approved leave'
                    },
                    {
                        key: 'checkedIn',
                        loading: data.loading || data.activityLoading,
                        icon: <CheckCircleOutlined />,
                        tone: 'success',
                        title: 'Checked In Today',
                        value: activityValue('checkedInToday'),
                        subtitle: 'Clocked in today'
                    }
                ]}
            />

            <MotionCard
                style={{ marginTop: 16 }}
                loading={data.loading}
                skeleton={isMobile ? 'list' : 'table'}
                skeletonRows={8}
                skeletonColumns={5}
                filterBar={
                    <div className='setup-toolbar'>
                        <div className='setup-toolbar-search' style={{ display: 'flex', gap: 8 }}>
                            <Input.Search
                                allowClear
                                placeholder='Search name, email, position, branch'
                                aria-label='Search staff'
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ flex: 1, minWidth: 0 }}
                            />
                            {filtersInline ? null : isMobile ? (
                                // A popover is too wide for a phone, so filters open as a bottom sheet there.
                                <Badge count={activeFilterCount} size='small' offset={[-4, 4]}>
                                    <Button icon={<FilterOutlined />} onClick={() => setFiltersOpen(true)}>
                                        Filters
                                    </Button>
                                </Badge>
                            ) : (
                                <Popover content={filterPanel} trigger='click' placement='bottomRight' title='Filters'>
                                    <Badge count={activeFilterCount} size='small' offset={[-4, 4]}>
                                        <Button icon={<FilterOutlined />}>Filters</Button>
                                    </Badge>
                                </Popover>
                            )}
                        </div>
                        {filtersInline ? (
                            <>
                                <div className='setup-toolbar-filter'>
                                    <Select<Focus> aria-label='Show' value={focus} onChange={setFocus} options={FOCUS_OPTIONS} style={{ width: '100%' }} />
                                </div>
                                <div className='setup-toolbar-filter'>
                                    <Select
                                        allowClear
                                        showSearch
                                        aria-label='Department'
                                        placeholder='Department'
                                        optionFilterProp='label'
                                        value={departmentFilter}
                                        onChange={setDepartmentFilter}
                                        options={departments.map(d => ({ value: d.id, label: d.name }))}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div className='setup-toolbar-filter'>
                                    <Select
                                        allowClear
                                        showSearch
                                        aria-label='Branch'
                                        placeholder='Branch'
                                        optionFilterProp='label'
                                        value={branchFilter}
                                        onChange={setBranchFilter}
                                        options={branches.map(b => ({ value: b.id, label: b.name }))}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div className='setup-toolbar-filter'>
                                    <Select
                                        allowClear
                                        showSearch
                                        aria-label='Position'
                                        placeholder='Position'
                                        value={positionFilter}
                                        onChange={setPositionFilter}
                                        options={positionOptions.map(p => ({ value: p, label: p }))}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </>
                        ) : null}
                        <div className='setup-toolbar-action'>
                            <Space wrap>
                                {!isMobile && visibleSelected.length > 0 ? (
                                    <Button onClick={() => setBulkOpen(true)}>Set position ({visibleSelected.length})</Button>
                                ) : null}
                                <Tooltip title='Refresh'>
                                    <Button
                                        shape={isMobile ? 'default' : 'circle'}
                                        icon={<ReloadOutlined />}
                                        loading={data.refreshing && !data.loading}
                                        onClick={() => void data.reload()}
                                        aria-label='Refresh'
                                    />
                                </Tooltip>
                                {canEditLineManager ? (
                                    <Tooltip title='Recalculate default line managers'>
                                        <Button
                                            shape={isMobile ? 'default' : 'circle'}
                                            icon={<ApartmentOutlined />}
                                            loading={recalculating}
                                            onClick={recalculateLineManagers}
                                            aria-label='Recalculate line managers'
                                        />
                                    </Tooltip>
                                ) : null}
                                <Button type='primary' icon={<UserAddOutlined />} onClick={openAdd} disabled={data.lookupsLoading}>
                                    {isMobile ? 'Add' : 'Add employee'}
                                </Button>
                            </Space>
                        </div>
                    </div>
                }
            >
                {data.error ? (
                    <Alert
                        type='error'
                        showIcon
                        message={data.error}
                        action={<Button size='small' onClick={() => void data.reload()}>Retry</Button>}
                        style={{ marginBottom: 12 }}
                    />
                ) : null}

                {isMobile ? (
                    <MobileCardList
                        data={filtered}
                        loading={data.refreshing && !employees.length}
                        getKey={r => r.id}
                        emptyText={employees.length ? 'No staff match these filters.' : 'No staff yet.'}
                        renderCard={r => ({
                            title: r.name,
                            subtitle: r.position,
                            badge: statusTag(r) ?? undefined,
                            fields: [
                                { label: 'Branch / Dept', value: placementText(r) },
                                { label: 'Line manager', value: managerName(r.lineManagerId) || 'Not set' }
                            ],
                            note: r.email ? <Text type='secondary' style={{ fontSize: 12 }}>{r.email}</Text> : undefined,
                            actions: [
                                <Button key='edit' icon={<EditOutlined />} onClick={() => openEdit(r)}>
                                    Edit
                                </Button>,
                                <Dropdown key='more' trigger={['click']} menu={{ items: rowMenu(r, true) }}>
                                    <Button icon={<MoreOutlined />} loading={busyId === r.id}>
                                        More
                                    </Button>
                                </Dropdown>
                            ]
                        })}
                    />
                ) : (
                    <Table<EmployeeRow>
                        rowKey='id'
                        size='middle'
                        loading={data.refreshing}
                        rowSelection={{ selectedRowKeys: visibleSelected, onChange: setSelectedIds }}
                        dataSource={filtered}
                        columns={columns}
                        pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                        locale={{ emptyText: employees.length ? 'No staff match these filters.' : 'No staff yet.' }}
                    />
                )}
            </MotionCard>

            <EmployeeFormModal
                open={formOpen}
                employee={editing}
                saving={saving}
                departments={departments}
                branches={branches}
                positions={positionOptions}
                lineManagerOptions={formManagerOptions}
                canEditLineManager={canEditLineManager}
                loginLocked={editing ? loginLocked(editing) || isSelf(editing) : false}
                onSubmit={submitEmployee}
                onClose={() => {
                    setFormOpen(false)
                    setEditing(null)
                }}
            />
            <BulkPositionModal
                open={bulkOpen}
                count={visibleSelected.length}
                positions={positionOptions}
                saving={saving}
                onSubmit={submitBulkPosition}
                onClose={() => setBulkOpen(false)}
            />
            <ChangeEmailModal employee={emailFor} saving={saving} onSubmit={submitEmail} onClose={() => setEmailFor(null)} />
            <TimesheetModal employee={timesheetFor} onClose={() => setTimesheetFor(null)} />
            {isMobile ? (
                <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} placement='bottom' height='auto' title='Filters'>
                    {filterPanel}
                </Drawer>
            ) : null}
        </div>
    )
}

export default EmployeesPage
