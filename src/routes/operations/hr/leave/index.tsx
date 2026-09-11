import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
    Table,
    Tag,
    Space,
    Button,
    Modal,
    Form,
    Input,
    Select,
    DatePicker,
    message,
    Card,
    Typography,
    Divider,
    Statistic,
    Row,
    Col,
    Empty,
    Steps,
    Progress,
    Popconfirm,
    Descriptions,
    Tooltip,
    Segmented
} from 'antd'
import {
    EyeOutlined,
    CheckOutlined,
    CloseOutlined,
    BarChartOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    PlusOutlined,
    UserOutlined,
    TeamOutlined,
    FilterOutlined,
    EditOutlined,
    StopOutlined,
    SettingOutlined,
    UnorderedListOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import {
    collection,
    query,
    onSnapshot,
    updateDoc,
    doc,
    getDoc,
    setDoc,
    where,
    addDoc,
    serverTimestamp,
    getDocs,
    limit as qLimit
} from 'firebase/firestore'
import { db, auth } from '@/firebase'
import TextArea from 'antd/es/input/TextArea'
import { motion } from 'framer-motion'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LeaveCalendar } from './LeaveCalendar'
import {
    LeaveType,
    LeaveStatus,
    LeaveRequest,
    LeaveSettings,
    Employee,
    countDaysInclusive,
    typeLabel
} from './types'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)
dayjs.extend(isoWeek)

const { Text, Title } = Typography
const { Option } = Select
const { RangePicker } = DatePicker
const { Step } = Steps

// ───────── Defaults
const POLICY_DEFAULTS: LeaveSettings = {
    type: 'leave',
    caps: {
        annual: 21,
        sick: { per12: 15, per24: 30 },
        family: 3,
        study: 5,
        maternity: 80,
        parental: 10
    },
    sickProofAfterDays: 2,
    autoApproveHalfDay: false,
    blackoutDates: []
}


// ───────── Component
const AdminLeaveManagement: React.FC = () => {
    // lookups
    const [branches, setBranches] = useState<Record<string, string>>({})
    const [departments, setDepartments] = useState<Record<string, string>>({})

    // settings
    const [settings, setSettings] = useState<LeaveSettings | null>(null)
    const [settingsLoading, setSettingsLoading] = useState(true)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settingsForm] = Form.useForm()

    // requests
    const [requests, setRequests] = useState<LeaveRequest[]>([])
    const [loading, setLoading] = useState(true)

    // table filters
    const [searchTerm, setSearchTerm] = useState('')
    const [typeFilter, setTypeFilter] = useState<LeaveType | undefined>()
    const [statusFilter, setStatusFilter] = useState<LeaveStatus | undefined>()
    const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [filtered, setFiltered] = useState<LeaveRequest[]>([])
    const [view, setView] = useState<'list' | 'calendar' | 'balances'>('list')

    // detail modal (existing)
    const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(
        null
    )
    const [isDetailsOpen, setIsDetailsOpen] = useState(false)

    // reject modal (existing)
    const [isRejectOpen, setIsRejectOpen] = useState(false)
    const [rejectForm] = Form.useForm()

    // wizard
    const [wizardOpen, setWizardOpen] = useState(false)
    const [step, setStep] = useState(0)
    const [leaveForm] = Form.useForm()

    // employees (step 1)
    const [employees, setEmployees] = useState<Employee[]>([])
    const [empLoading, setEmpLoading] = useState(true)
    const [empSearch, setEmpSearch] = useState('')

    // either branch or department filter
    const [branchFilter, setBranchFilter] = useState<string | undefined>()
    const [deptFilter, setDeptFilter] = useState<string | undefined>()

    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

    // on-leave view
    const todayISO = dayjs().format('YYYY-MM-DD')
    const onLeaveNow = useMemo(
        () =>
            requests.filter(
                r =>
                    r.status === 'approved' &&
                    !dayjs(todayISO).isBefore(dayjs(r.from), 'day') && // same or after start
                    !dayjs(todayISO).isAfter(dayjs(r.to), 'day') // same or before end
            ),
        [requests, todayISO]
    )

    // employee summary modal
    const [summaryOpen, setSummaryOpen] = useState(false)
    const [summaryEmployee, setSummaryEmployee] = useState<Employee | null>(null)

    // edit leave modal
    const [editOpen, setEditOpen] = useState(false)
    const [editForm] = Form.useForm()
    const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(
        null
    )

    // ── scope (company)
    useEffect(() => {
        const run = async () => {
            try {
                const user = auth.currentUser
                if (!user) return
                const uref = doc(db, 'users', user.uid)
                const snap = await getDoc(uref)
            } catch {
            }
        }
        run()
    }, [])

    // ── lookups: branches & departments
    useEffect(() => {
        // branches
        const unsubA = onSnapshot(collection(db, 'branches'), s => {
            const map: Record<string, string> = {}
            s.docs.forEach(d => {
                const n = (d.data() as any)?.name || (d.data() as any)?.title || d.id
                map[d.id] = String(n)
            })
            setBranches(map)
        })
        // departments
        const unsubB = onSnapshot(collection(db, 'departments'), s => {
            const map: Record<string, string> = {}
            s.docs.forEach(d => {
                const n = (d.data() as any)?.name || (d.data() as any)?.title || d.id
                map[d.id] = String(n)
            })
            setDepartments(map)
        })
        return () => {
            unsubA()
            unsubB()
        }
    }, [])

    // ── settings from system_settings (type: 'leave')
    useEffect(() => {
        const fetchPolicy = async () => {
            setSettingsLoading(true)
            try {
                const base = collection(db, 'system_settings')
                const sq = query(base, where('type', '==', 'leave'), qLimit(1))
                const snap = await getDocs(sq)

                if (!snap.empty) {
                    const data = snap.docs[0].data() as Partial<LeaveSettings>
                    const merged: LeaveSettings = {
                        ...POLICY_DEFAULTS,
                        ...data,
                        caps: { ...POLICY_DEFAULTS.caps, ...(data.caps || {}) }
                    }
                    setSettings(merged)
                    settingsForm.setFieldsValue({
                        annual: merged.caps.annual,
                        sick12: merged.caps.sick.per12,
                        sick24: merged.caps.sick.per24,
                        family: merged.caps.family,
                        study: merged.caps.study,
                        maternity: merged.caps.maternity,
                        parental: merged.caps.parental,
                        sickProofAfterDays: merged.sickProofAfterDays,
                        autoApproveHalfDay: merged.autoApproveHalfDay,
                        blackoutDates: (merged.blackoutDates || []).map(d => dayjs(d))
                    })
                } else {
                    const payload: LeaveSettings = {
                        ...POLICY_DEFAULTS
                    }
                    await addDoc(base, payload)
                    setSettings(payload)
                    settingsForm.setFieldsValue({
                        annual: payload.caps.annual,
                        sick12: payload.caps.sick.per12,
                        sick24: payload.caps.sick.per24,
                        family: payload.caps.family,
                        study: payload.caps.study,
                        maternity: payload.caps.maternity,
                        parental: payload.caps.parental,
                        sickProofAfterDays: payload.sickProofAfterDays,
                        autoApproveHalfDay: payload.autoApproveHalfDay,
                        blackoutDates: []
                    })
                }
            } catch (e) {
                console.error(e)
                setSettings({
                    ...POLICY_DEFAULTS,
                })
            } finally {
                setSettingsLoading(false)
            }
        }
        fetchPolicy()
    }, [settingsForm])

    // ── employees (exclude incubatees, quantilytix emails and my email)
    useEffect(() => {
        setEmpLoading(true)

        const usersRef = collection(db, 'users')

        const unsub = onSnapshot(
            usersRef,
            snapshot => {
                const rows: Employee[] = snapshot.docs
                    .map(document => {
                        const user = document.data() as any

                        const branchId: string | undefined =
                            user.branchId || undefined

                        const departmentId: string | undefined = branchId
                            ? undefined
                            : user.departmentId || undefined

                        const branchName = branchId
                            ? branches[branchId] || branchId
                            : ''

                        const departmentName = departmentId
                            ? departments[departmentId] || departmentId
                            : ''

                        return {
                            id: document.id,
                            name:
                                user.name ||
                                user.displayName ||
                                user.fullName ||
                                '',
                            email: user.email || '',
                            role: user.role || '',
                            branchId,
                            departmentId,
                            branchName,
                            departmentName,
                            photoURL: user.photoURL || '',
                            active: user.active !== false
                        } as Employee
                    })
                    .filter(employee => {
                        const email = employee.email.trim().toLowerCase()
                        const role = employee.role.trim().toLowerCase()

                        const isQuantilytixEmail =
                            email.endsWith('@quantilytix.co.za')

                        const isExcludedEmail =
                            email === 'danielrumona@gmail.com'

                        return (
                            employee.active !== false &&
                            role !== 'incubatee' &&
                            !isQuantilytixEmail &&
                            !isExcludedEmail
                        )
                    })

                setEmployees(rows)
                setEmpLoading(false)
            },
            error => {
                console.error('Failed to load employees:', error)
                setEmployees([])
                setEmpLoading(false)
            }
        )

        return unsub
    }, [branches, departments])

    // ── live leave requests
    useEffect(() => {
        setLoading(true)

        const leaveRequestsRef = collection(db, 'leaveRequests')

        const unsub = onSnapshot(
            leaveRequestsRef,
            snap => {
                const data: LeaveRequest[] = snap.docs
                    .map(document => ({
                        id: document.id,
                        ...(document.data() as Omit<LeaveRequest, 'id'>)
                    }))
                    .filter(request => {
                        const email = String(
                            request.employeeEmail ||
                            request.email ||
                            ''
                        )
                            .trim()
                            .toLowerCase()

                        const isQuantilytixEmail =
                            email.endsWith('@quantilytix.co.za')

                        const isExcludedEmail =
                            email === 'danielrumona@gmail.com'

                        return !isQuantilytixEmail && !isExcludedEmail
                    })
                    .sort((a, b) =>
                        (b.appliedDate || '').localeCompare(
                            a.appliedDate || ''
                        )
                    )

                setRequests(data)
                setLoading(false)
            },
            error => {
                console.error('Failed to load leave requests:', error)
                setRequests([])
                setLoading(false)
            }
        )

        return unsub
    }, [])

    // ── filters for All Requests tab
    useEffect(() => {
        const next = requests.filter(r => {
            if (range) {
                const [start, end] = range
                const f = dayjs(r.from)
                const t = dayjs(r.to)
                const overlaps =
                    f.isBefore(end.add(1, 'day')) &&
                    t.isAfter(start.subtract(1, 'day'))
                if (!overlaps) return false
            }
            if (typeFilter && r.type !== typeFilter) return false
            if (statusFilter && r.status !== statusFilter) return false
            if (searchTerm) {
                const hay = `${r.employeeName || ''} ${r.employeeEmail || ''}`.toLowerCase()
                if (!hay.includes(searchTerm.toLowerCase().trim())) return false
            }
            return true
        })
        setFiltered(next)
    }, [requests, range, typeFilter, statusFilter, searchTerm])

    // ── usage helpers
    // How many approved days of a type the user has used in the last X days
    const sumApprovedForTypeWithin = (
        userId: string,
        type: LeaveType,
        sinceDays: number
    ) => {
        const since = dayjs().subtract(sinceDays, 'day')
        return requests
            .filter(
                r =>
                    r.employeeId === userId &&
                    r.status === 'approved' &&
                    r.type === type &&
                    dayjs(r.from).isAfter(since)
            )
            .reduce((acc, r) => acc + (r.days || countDaysInclusive(r.from, r.to)), 0)
    }
    const isOnNow = (fromISO: string, toISO: string) => {
        const t = dayjs()
        return !t.isBefore(dayjs(fromISO), 'day') && !t.isAfter(dayjs(toISO), 'day')
    }
    const affOf = (e: { branchName?: string; departmentName?: string }) =>
        e.branchName
            ? { kind: 'Branch', name: e.branchName }
            : e.departmentName
                ? { kind: 'Department', name: e.departmentName }
                : { kind: '', name: '—' }

    const blackoutOverlap = useCallback(
        (fromISO: string, toISO: string) => {
            const set = settings?.blackoutDates || []
            if (!set.length) return false
            const f = dayjs(fromISO)
            const t = dayjs(toISO)
            for (let d = f.clone(); !d.isAfter(t); d = d.add(1, 'day')) {
                if (set.includes(d.format('YYYY-MM-DD'))) return true
            }
            return false
        },
        [settings]
    )

    const validateForUser = useCallback(
        (
            userId: string,
            type: LeaveType,
            fromISO: string,
            toISO: string
        ): { ok: boolean; reason?: string } => {
            if (!settings) return { ok: false, reason: 'Leave policy not loaded.' }
            if (blackoutOverlap(fromISO, toISO)) {
                return { ok: false, reason: 'Dates overlap a blackout period.' }
            }
            const days = countDaysInclusive(fromISO, toISO)

            switch (type) {
                case 'annual': {
                    const used12 = sumApprovedForTypeWithin(userId, 'annual', 365)
                    if (used12 + days > settings.caps.annual) {
                        return {
                            ok: false,
                            reason: `Annual cap exceeded (${used12}/${settings.caps.annual} used in 12 months).`
                        }
                    }
                    return { ok: true }
                }
                case 'sick': {
                    const used12 = sumApprovedForTypeWithin(userId, 'sick', 365)
                    const used24 = sumApprovedForTypeWithin(userId, 'sick', 730)
                    if (used12 + days > settings.caps.sick.per12) {
                        return {
                            ok: false,
                            reason: `Sick 12-month cap exceeded (${used12}/${settings.caps.sick.per12}).`
                        }
                    }
                    if (used24 + days > settings.caps.sick.per24) {
                        return {
                            ok: false,
                            reason: `Sick 24-month cap exceeded (${used24}/${settings.caps.sick.per24}).`
                        }
                    }
                    return { ok: true }
                }
                case 'family': {
                    const used12 = sumApprovedForTypeWithin(userId, 'family', 365)
                    if (used12 + days > settings.caps.family) {
                        return {
                            ok: false,
                            reason: `Family Responsibility cap exceeded (${used12}/${settings.caps.family}).`
                        }
                    }
                    return { ok: true }
                }
                case 'study': {
                    const used12 = sumApprovedForTypeWithin(userId, 'study', 365)
                    if (used12 + days > settings.caps.study) {
                        return {
                            ok: false,
                            reason: `Study leave cap exceeded (${used12}/${settings.caps.study}).`
                        }
                    }
                    return { ok: true }
                }
                case 'maternity': {
                    const used24 = sumApprovedForTypeWithin(userId, 'maternity', 730)
                    if (used24 + days > settings.caps.maternity) {
                        return {
                            ok: false,
                            reason: `Maternity cap exceeded (${used24}/${settings.caps.maternity} in 24 months).`
                        }
                    }
                    return { ok: true }
                }
                case 'parental': {
                    const used12 = sumApprovedForTypeWithin(userId, 'parental', 365)
                    if (used12 + days > settings.caps.parental) {
                        return {
                            ok: false,
                            reason: `Parental cap exceeded (${used12}/${settings.caps.parental}).`
                        }
                    }
                    return { ok: true }
                }
                default:
                    return { ok: true }
            }
        },
        [settings, sumApprovedForTypeWithin, blackoutOverlap]
    )

    // Remaining allowance for one user for a given type (policy from system_settings)
    const remainingForType = (userId: string, type: LeaveType) => {
        if (!settings) return 0
        switch (type) {
            case 'annual':
                return Math.max(
                    0,
                    settings.caps.annual - sumApprovedForTypeWithin(userId, 'annual', 365)
                )
            case 'family':
                return Math.max(
                    0,
                    settings.caps.family - sumApprovedForTypeWithin(userId, 'family', 365)
                )
            case 'study':
                return Math.max(
                    0,
                    settings.caps.study - sumApprovedForTypeWithin(userId, 'study', 365)
                )
            case 'parental':
                return Math.max(
                    0,
                    settings.caps.parental -
                    sumApprovedForTypeWithin(userId, 'parental', 365)
                )
            case 'maternity': {
                const used24 = sumApprovedForTypeWithin(userId, 'maternity', 730)
                return Math.max(0, settings.caps.maternity - used24)
            }
            case 'sick': {
                const rem12 = Math.max(
                    0,
                    settings.caps.sick.per12 -
                    sumApprovedForTypeWithin(userId, 'sick', 365)
                )
                const rem24 = Math.max(
                    0,
                    settings.caps.sick.per24 -
                    sumApprovedForTypeWithin(userId, 'sick', 730)
                )
                return Math.min(rem12, rem24)
            }
            default:
                return 0
        }
    }

    // For multiple employees, the wizard should cap by the most-constrained one
    const maxSpanForSelected = (
        type: LeaveType | undefined,
        selectedUserIds: string[]
    ) => {
        if (!type || !settings || selectedUserIds.length === 0) return 0
        const perUserRemaining = selectedUserIds.map(uid =>
            remainingForType(uid, type)
        )
        return Math.max(0, Math.min(...perUserRemaining))
    }
    // walk days between two ISO dates (inclusive)
    const iterDays = (fromISO: string, toISO: string) => {
        const out: string[] = []
        for (
            let d = dayjs(fromISO);
            !d.isAfter(dayjs(toISO));
            d = d.add(1, 'day')
        ) {
            out.push(d.format('YYYY-MM-DD'))
        }
        return out
    }

    // check if any blackout day falls within range
    const rangeHasBlackout = (
        fromISO: string,
        toISO: string,
        blackout: string[] = []
    ) => iterDays(fromISO, toISO).some(d => blackout.includes(d))

    // update onLeave in consultants/operationsStaff if a doc exists for the user
    const updateOnLeaveInRoleCollections = async (
        userId: string,
        payload: Record<string, any>
    ) => {
        const cols = ['consultants', 'operationsStaff'] as const
        await Promise.all(
            cols.map(async c => {
                const ref = doc(db, c, userId)
                const snap = await getDoc(ref)
                if (snap.exists()) {
                    await setDoc(ref, payload, { merge: true })
                }
            })
        )
    }

    // recompute today's onLeave flag (after approve/edit/end)
    const recomputeOnLeaveFlags = async (userId: string) => {
        const today = dayjs().format('YYYY-MM-DD')
        const qy = query(
            collection(db, 'leaveRequests'),
            where('employeeId', '==', userId),
            where('status', '==', 'approved')
        )
        const s = await getDocs(qy)
        let onNow = false
        let nextFrom: string | undefined
        let nextTo: string | undefined

        s.forEach(d => {
            const r = d.data() as LeaveRequest
            if (
                dayjs(today).isSameOrAfter(dayjs(r.from), 'day') &&
                dayjs(today).isSameOrBefore(dayjs(r.to), 'day')
            )
                onNow = true

            if (dayjs(r.from).isAfter(today)) {
                if (!nextFrom || dayjs(r.from).isBefore(nextFrom)) {
                    nextFrom = r.from
                    nextTo = r.to
                }
            }
        })

        await updateOnLeaveInRoleCollections(userId, {
            onLeave: onNow,
            onLeaveScheduled: !!(onNow || nextFrom),
            nextLeaveFrom: nextFrom || null,
            nextLeaveTo: nextTo || null,
            onLeaveUpdatedAt: serverTimestamp()
        })
    }

    // ── approve / reject
    const handleApprove = async (id: string) => {
        const req = requests.find(r => r.id === id)
        if (!req) return
        const check = validateForUser(req.employeeId, req.type, req.from, req.to)
        if (!check.ok)
            return message.error(check.reason || 'Policy prevents approval.')

        try {
            await updateDoc(doc(db, 'leaveRequests', id), {
                status: 'approved',
                approvedBy: auth.currentUser?.email || 'system',
                approvedDate: dayjs().format('YYYY-MM-DD'),
                putByEmail: auth.currentUser?.email || 'system'
            })
            message.success('Leave request approved')
        } catch (e) {
            console.error(e)
            message.error('Failed to approve')
        }
    }

    const handleReject = async (vals: { rejectionReason: string }) => {
        if (!selectedRequest) return
        try {
            await updateDoc(doc(db, 'leaveRequests', selectedRequest.id), {
                status: 'rejected',
                rejectionReason: vals.rejectionReason,
                approvedBy: auth.currentUser?.email || 'system',
                approvedDate: dayjs().format('YYYY-MM-DD')
            })
            message.success('Leave request rejected')
            setIsRejectOpen(false)
            setSelectedRequest(null)
            rejectForm.resetFields()
        } catch (e) {
            console.error(e)
            message.error('Failed to reject')
        }
    }

    // ── metrics
    const stats = useMemo(
        () => ({
            pending: requests.filter(r => r.status === 'pending').length,
            approved: requests.filter(r => r.status === 'approved').length,
            rejected: requests.filter(r => r.status === 'rejected').length,
            total: requests.length
        }),
        [requests]
    )

    // ── table columns
    const getStatusTag = (status: LeaveStatus) =>
        status === 'approved' ? (
            <Tag color='green'>APPROVED</Tag>
        ) : status === 'pending' ? (
            <Tag color='orange'>PENDING</Tag>
        ) : (
            <Tag color='red'>REJECTED</Tag>
        )

    const columns = [
        {
            title: 'Employee',
            dataIndex: 'employeeName',
            key: 'employeeName',
            render: (_: string, r: LeaveRequest) => (
                <Space>
                    <div>
                        <div>{r.employeeName || '—'}</div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {r.employeeEmail || '—'}
                        </Text>
                    </div>
                </Space>
            )
        },
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type',
            render: (t: LeaveType) => typeLabel(t)
        },
        {
            title: 'Dates',
            key: 'dates',
            render: (_: any, r: LeaveRequest) => (
                <div>
                    {dayjs(r.from).format('MMM D')} - {dayjs(r.to).format('MMM D, YYYY')}
                    <div style={{ fontSize: 12, color: '#888' }}>
                        {r.days} day{r.days > 1 ? 's' : ''}
                    </div>
                </div>
            )
        },
        { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (s: LeaveStatus, r: LeaveRequest) => (
                <Space size={4}>
                    {getStatusTag(s)}
                    {s === 'approved' && isOnNow(r.from, r.to) && (
                        <Tag color='green'>ON NOW</Tag>
                    )}
                </Space>
            )
        },
        {
            title: 'Applied On',
            dataIndex: 'appliedDate',
            key: 'appliedDate',
            render: (d: string) => (d ? dayjs(d).format('MMM D, YYYY') : '—')
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, r: LeaveRequest) => {
                const emp =
                    employees.find(e => e.id === r.employeeId) ||
                    ({
                        id: r.employeeId,
                        name: r.employeeName,
                        email: r.employeeEmail,
                        photoURL: r.employeePhoto
                    } as Employee)

                return (
                    <Space size='small' wrap>
                        <Button
                            icon={<EyeOutlined />}
                            shape='circle'
                            size='middle'
                            onClick={() => {
                                setSelectedRequest(r)
                                setIsDetailsOpen(true)
                            }}
                        />
                        {r.status === 'pending' && (
                            <>
                                <Button
                                    shape='circle'
                                    size='middle'
                                    variant='outlined'
                                    color='green'
                                    icon={<CheckOutlined style={{ color: '#52c41a' }} />}
                                    onClick={() => handleApprove(r.id)}
                                />
                                <Button
                                    shape='circle'
                                    size='middle'
                                    danger
                                    icon={<CloseOutlined style={{ color: '#f5222d' }} />}
                                    onClick={() => {
                                        setSelectedRequest(r)
                                        setIsRejectOpen(true)
                                    }}
                                />
                                <Tooltip title='Fix a mistake in this request'>
                                    <Button
                                        color='orange'
                                        shape='circle'
                                        variant='outlined'
                                        size='middle'
                                        icon={<EditOutlined />}
                                        onClick={() => openEdit(r)}
                                    />
                                </Tooltip>
                            </>
                        )}

                        {r.status === 'approved' && (
                            <>
                                <Button
                                    size='small'
                                    icon={<BarChartOutlined />}
                                    onClick={() => openSummaryFor(emp)}
                                >
                                    Summary
                                </Button>
                                <Button
                                    size='small'
                                    icon={<EditOutlined />}
                                    onClick={() => openEdit(r)}
                                >
                                    Edit
                                </Button>

                                {isOnNow(r.from, r.to) && (
                                    <Popconfirm
                                        title='End leave today?'
                                        onConfirm={() => endLeaveToday(r)}
                                        okText='Yes, end now'
                                    >
                                        <Button size='small' danger icon={<StopOutlined />}>
                                            End Today
                                        </Button>
                                    </Popconfirm>
                                )}
                            </>
                        )}
                    </Space>
                )
            }
        }
    ]

    // ── calendar (rendered separately via <LeaveCalendar>, see LeaveCalendar.tsx)

    // ── Wizard steps
    const uniqueBranches = useMemo(
        () =>
            Array.from(
                new Set(employees.map(e => e.branchId).filter(Boolean) as string[])
            ),
        [employees]
    )
    const uniqueDepts = useMemo(
        () =>
            Array.from(
                new Set(employees.map(e => e.departmentId).filter(Boolean) as string[])
            ),
        [employees]
    )

    // enforce "either branch or department"
    useEffect(() => {
        if (branchFilter) setDeptFilter(undefined)
    }, [branchFilter])
    useEffect(() => {
        if (deptFilter) setBranchFilter(undefined)
    }, [deptFilter])

    const filteredEmployees = useMemo(() => {
        const q = empSearch.toLowerCase().trim()
        return employees.filter(e => {
            if (branchFilter && e.branchId !== branchFilter) return false
            if (deptFilter && e.departmentId !== deptFilter) return false
            if (!q) return true
            const hay = `${e.name || ''} ${e.email || ''}`.toLowerCase()
            return hay.includes(q)
        })
    }, [employees, empSearch, branchFilter, deptFilter])

    const EmployeeStep = () => {
        const rowSelection = {
            selectedRowKeys: selectedUserIds,
            onChange: (keys: React.Key[]) => setSelectedUserIds(keys as string[])
        }
        const cols: any[] = [
            {
                title: 'Employee',
                key: 'name',
                render: (_: any, r: Employee) => (
                    <Space>
                        <div>
                            <div>{r.name || '—'}</div>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                {r.email || '—'}
                            </Text>
                        </div>
                    </Space>
                )
            },
            {
                title: 'Affiliation',
                render: (_: any, r: Employee) => {
                    const a = affOf(r)
                    return a.kind ? (
                        <Space>
                            <Tag>{a.kind}</Tag>
                            <span>{a.name}</span>
                        </Space>
                    ) : (
                        '—'
                    )
                }
            }
        ]

        return (
            <Card>
                <Row gutter={12} style={{ marginBottom: 12 }}>
                    <Col xs={24} md={8}>
                        <Input
                            allowClear
                            prefix={<FilterOutlined />}
                            placeholder='Search by name or email'
                            value={empSearch}
                            onChange={e => setEmpSearch(e.target.value)}
                        />
                    </Col>
                    <Col xs={24} md={8}>
                        <Select
                            allowClear
                            style={{ width: '100%' }}
                            placeholder='Filter by branch'
                            value={branchFilter}
                            onChange={v => setBranchFilter(v)}
                        >
                            {uniqueBranches.map(id => (
                                <Option key={id} value={id}>
                                    {branches[id] || id}
                                </Option>
                            ))}
                        </Select>
                    </Col>
                    <Col xs={24} md={8}>
                        <Select
                            allowClear
                            style={{ width: '100%' }}
                            placeholder='Filter by department'
                            value={deptFilter}
                            onChange={v => setDeptFilter(v)}
                        >
                            {uniqueDepts.map(id => (
                                <Option key={id} value={id}>
                                    {departments[id] || id}
                                </Option>
                            ))}
                        </Select>
                    </Col>
                </Row>

                <Table
                    size='middle'
                    rowKey='id'
                    loading={empLoading}
                    dataSource={filteredEmployees}
                    columns={cols}
                    rowSelection={{ type: 'checkbox', ...rowSelection }}
                    pagination={{ pageSize: 5, position: ['bottomCenter'], showSizeChanger: false }}
                    locale={{ emptyText: <Empty description='No employees' /> }}
                />
            </Card>
        )
    }

    const LeaveDetailsStep = () => {
        const typeWatch = Form.useWatch('type', leaveForm) as LeaveType | undefined
        const startWatch = Form.useWatch('startDate', leaveForm) as
            | Dayjs
            | undefined

        const maxSpan = useMemo(
            () => maxSpanForSelected(typeWatch, selectedUserIds),
            [typeWatch, selectedUserIds, requests, settings]
        )

        // block blackout days and (for end) anything beyond start + (maxSpan - 1)
        const disableStart = useCallback(
            (current: Dayjs) =>
                !!settings?.blackoutDates?.includes(current.format('YYYY-MM-DD')),
            [settings?.blackoutDates]
        )

        const disableEnd = useCallback(
            (current: Dayjs) => {
                const iso = current.format('YYYY-MM-DD')
                if (settings?.blackoutDates?.includes(iso)) return true
                if (!startWatch) return true // require start first
                if (current.isBefore(startWatch, 'day')) return true
                if (typeWatch && maxSpan) {
                    const maxEnd = startWatch.add(maxSpan - 1, 'day')
                    if (current.isAfter(maxEnd, 'day')) return true
                }
                return false
            },
            [settings?.blackoutDates, startWatch, typeWatch, maxSpan]
        )

        // auto-suggest end when start/type changes
        const onValuesChange = (changed: any, all: any) => {
            if ((changed.startDate || changed.type) && all.startDate && maxSpan) {
                const suggested = (all.startDate as Dayjs).add(maxSpan - 1, 'day')
                const end: Dayjs | undefined = all.endDate
                if (!end || end.isAfter(suggested)) {
                    leaveForm.setFieldsValue({ endDate: suggested })
                }
            }
        }

        return (
            <Card>
                <Form
                    form={leaveForm}
                    layout='vertical'
                    preserve
                    initialValues={{
                        type: undefined,
                        startDate: undefined,
                        endDate: undefined,
                        reason: ''
                    }}
                    onValuesChange={onValuesChange}
                >
                    <Form.Item
                        name='type'
                        label='Leave Type'
                        rules={[{ required: true, message: 'Select a leave type' }]}
                    >
                        <Select placeholder='Select type'>
                            <Option value='annual'>
                                Annual ({settings?.caps.annual} / 12m)
                            </Option>
                            <Option value='sick'>
                                Sick ({settings?.caps.sick.per12}/12m &{' '}
                                {settings?.caps.sick.per24}/24m)
                            </Option>
                            <Option value='family'>
                                Family ({settings?.caps.family} / 12m)
                            </Option>
                            <Option value='study'>
                                Study ({settings?.caps.study} / 12m)
                            </Option>
                            <Option value='maternity'>
                                Maternity ({settings?.caps.maternity} / 24m)
                            </Option>
                            <Option value='parental'>
                                Parental ({settings?.caps.parental} / 12m)
                            </Option>
                        </Select>
                    </Form.Item>

                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='startDate'
                                label='Start date'
                                rules={[{ required: true, message: 'Pick a start date' }]}
                                extra={
                                    typeWatch && maxSpan
                                        ? `Max duration from start: ${maxSpan} day(s)` +
                                        (settings?.blackoutDates?.length
                                            ? ` • Blackout: ${settings.blackoutDates.join(', ')}`
                                            : '')
                                        : 'Pick a type to see the maximum allowed span'
                                }
                            >
                                <DatePicker disabledDate={disableStart} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='endDate'
                                label='End date'
                                dependencies={['startDate', 'type']}
                                rules={[
                                    { required: true, message: 'Pick an end date' },
                                    ({ getFieldValue }) => ({
                                        async validator(_, value: Dayjs) {
                                            const start: Dayjs | undefined =
                                                getFieldValue('startDate')
                                            const lt: LeaveType | undefined = getFieldValue('type')
                                            if (!start || !value)
                                                return Promise.reject(new Error('Select start and end'))
                                            if (value.isBefore(start, 'day'))
                                                return Promise.reject(
                                                    new Error('End must be on/after start')
                                                )
                                            const fromISO = start.format('YYYY-MM-DD')
                                            const toISO = value.format('YYYY-MM-DD')
                                            // cap
                                            const cap = maxSpanForSelected(lt, selectedUserIds)
                                            const days = countDaysInclusive(fromISO, toISO)
                                            if (cap && days > cap)
                                                return Promise.reject(
                                                    new Error(`Exceeds max of ${cap} day(s)`)
                                                )
                                            // blackout inside range
                                            if (
                                                rangeHasBlackout(
                                                    fromISO,
                                                    toISO,
                                                    settings?.blackoutDates
                                                )
                                            ) {
                                                return Promise.reject(
                                                    new Error('Range hits a blackout day')
                                                )
                                            }
                                            return Promise.resolve()
                                        }
                                    })
                                ]}
                            >
                                <DatePicker disabledDate={disableEnd} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        name='reason'
                        label='Reason'
                        rules={[{ required: true, message: 'Provide a reason' }]}
                    >
                        <TextArea rows={4} placeholder='Reason for leave' />
                    </Form.Item>
                </Form>
            </Card>
        )
    }

    // review rows
    type ReviewRow = {
        user: Employee
        type: LeaveType
        from: string
        to: string
        days: number
        ok: boolean
        reason?: string
    }
    const [reviewRows, setReviewRows] = useState<ReviewRow[]>([])
    const allOk = useMemo(
        () => reviewRows.length > 0 && reviewRows.every(r => r.ok),
        [reviewRows]
    )

    const ReviewStep = () => (
        <Card>
            <Table<ReviewRow>
                size='small'
                rowKey={r => r.user.id + r.from + r.to + r.type}
                dataSource={reviewRows}
                pagination={false}
                columns={[
                    {
                        title: 'Employee',
                        render: (_: any, r) => (
                            <Space>
                                <div>
                                    <div>{r.user.name}</div>
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {r.user.email}
                                    </Text>
                                </div>
                            </Space>
                        )
                    },
                    {
                        title: 'Affiliation',
                        render: (_: any, r) => {
                            const a = affOf(r.user)
                            return a.kind ? (
                                <Space>
                                    <Tag>{a.kind}</Tag>
                                    <span>{a.name}</span>
                                </Space>
                            ) : (
                                '—'
                            )
                        }
                    },
                    { title: 'Type', render: (_: any, r) => typeLabel(r.type) },
                    {
                        title: 'Dates',
                        render: (_: any, r) =>
                            `${dayjs(r.from).format('MMM D')} – ${dayjs(r.to).format(
                                'MMM D, YYYY'
                            )}`
                    },
                    { title: 'Days', dataIndex: 'days' },
                    {
                        title: 'Validation',
                        render: (_: any, r) =>
                            r.ok ? (
                                <Tag color='green'>OK</Tag>
                            ) : (
                                <Space>
                                    <Tag color='red'>BLOCK</Tag>
                                    <Text type='danger'>{r.reason}</Text>
                                </Space>
                            )
                    }
                ]}
                locale={{ emptyText: <Empty description='Nothing to review' /> }}
            />
            <Divider />
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Text strong>
                    {reviewRows.filter(r => r.ok).length} ready •{' '}
                    {reviewRows.filter(r => !r.ok).length} blocked
                </Text>
                {!allOk && (
                    <Text type='secondary'>Fix issues or go back to adjust.</Text>
                )}
            </Space>
        </Card>
    )

    // wizard next/back
    const nextFromStep1 = () => {
        if (selectedUserIds.length === 0) {
            message.warning('Select at least one employee.')
            return
        }
        setStep(1)
    }

    const nextFromStep2 = () => {
        leaveForm.validateFields().then(vals => {
            const type = vals.type as LeaveType
            const fromISO = (vals.startDate as Dayjs).format('YYYY-MM-DD')
            const toISO = (vals.endDate as Dayjs).format('YYYY-MM-DD')
            const days = countDaysInclusive(fromISO, toISO)

            const maxSpan = maxSpanForSelected(type, selectedUserIds)
            if (maxSpan && days > maxSpan) {
                message.error(
                    `Selected range exceeds the maximum of ${maxSpan} day(s) for the selection.`
                )
                return
            }

            const selected = employees.filter(e => selectedUserIds.includes(e.id))
            const rows = selected.map(u => {
                const check = validateForUser(u.id, type, fromISO, toISO)
                return {
                    user: u,
                    type,
                    from: fromISO,
                    to: toISO,
                    days,
                    ok: check.ok,
                    reason: check.reason
                }
            })
            setReviewRows(rows)
            setStep(2)
        })
    }

    const submitAll = async () => {
        if (!settings) return message.error('Leave policy not loaded.')

        // read from store (includes unmounted fields)
        const { type, startDate, endDate, reason } = leaveForm.getFieldsValue(true)

        if (!type || !startDate || !endDate) {
            message.error('Leave details are incomplete. Please fill Step 2.')
            setStep(1)
            return
        }

        const fromISO = (startDate as Dayjs).format('YYYY-MM-DD')
        const toISO = (endDate as Dayjs).format('YYYY-MM-DD')
        const days = countDaysInclusive(fromISO, toISO)
        const batch = employees.filter(e => selectedUserIds.includes(e.id))
        const byEmail = auth.currentUser?.email || 'system'

        try {
            await Promise.all(
                batch.map(async u => {
                    await addDoc(collection(db, 'leaveRequests'), {
                        employeeId: u.id,
                        employeeEmail: u.email || '',
                        employeeName: u.name || '',
                        employeePhoto: u.photoURL || '',
                        type,
                        reason: (reason as string) || '',
                        from: fromISO,
                        to: toISO,
                        days,
                        status: 'approved',
                        appliedDate: dayjs().format('YYYY-MM-DD'),
                        approvedBy: byEmail,
                        approvedDate: dayjs().format('YYYY-MM-DD'),
                        putByEmail: byEmail,
                        createdAt: serverTimestamp()
                    } as Omit<LeaveRequest, 'id'>)

                    const today = dayjs().format('YYYY-MM-DD')
                    const onNow =
                        !dayjs(today).isBefore(fromISO, 'day') &&
                        !dayjs(today).isAfter(toISO, 'day')

                    await updateOnLeaveInRoleCollections(u.id, {
                        onLeave: onNow,
                        onLeaveScheduled: true,
                        nextLeaveFrom: fromISO,
                        nextLeaveTo: toISO,
                        onLeaveUpdatedAt: serverTimestamp()
                    })
                })
            )

            message.success(`Leave submitted for ${batch.length} employee(s).`)
            setWizardOpen(false)
            setStep(0)
            setSelectedUserIds([])
            leaveForm.resetFields()
            setReviewRows([])
        } catch (e) {
            console.error(e)
            message.error('Failed to submit leave requests.')
        }
    }

    // ── Employee Summary (progress bars)
    const computeUsage = (uid: string) => {
        if (!settings) return null
        const caps = settings.caps
        const used = {
            annual: sumApprovedForTypeWithin(uid, 'annual', 365),
            sick12: sumApprovedForTypeWithin(uid, 'sick', 365),
            sick24: sumApprovedForTypeWithin(uid, 'sick', 730),
            family: sumApprovedForTypeWithin(uid, 'family', 365),
            study: sumApprovedForTypeWithin(uid, 'study', 365),
            maternity: sumApprovedForTypeWithin(uid, 'maternity', 730),
            parental: sumApprovedForTypeWithin(uid, 'parental', 365)
        }
        const rem = {
            annual: Math.max(0, caps.annual - used.annual),
            sick12: Math.max(0, caps.sick.per12 - used.sick12),
            sick24: Math.max(0, caps.sick.per24 - used.sick24),
            family: Math.max(0, caps.family - used.family),
            study: Math.max(0, caps.study - used.study),
            maternity: Math.max(0, caps.maternity - used.maternity),
            parental: Math.max(0, caps.parental - used.parental)
        }
        return { used, rem, caps }
    }

    const openSummaryFor = (emp: Employee) => {
        const branchName = emp.branchId
            ? branches[emp.branchId] || emp.branchName || ''
            : ''
        const departmentName =
            !branchName && emp.departmentId
                ? departments[emp.departmentId] || emp.departmentName || ''
                : ''

        setSummaryEmployee({ ...emp, branchName, departmentName })
        setSummaryOpen(true)
    }

    // ── Balances view: every employee's leave usage, computed from leaveRequests
    const LeaveBalancesTable = () => {
        const rows = useMemo(
            () =>
                employees.map(emp => ({
                    emp,
                    usage: computeUsage(emp.id)
                })),
            [employees, requests, settings]
        )

        const cols = [
            {
                title: 'Employee',
                key: 'name',
                render: (_: any, r: { emp: Employee }) => (
                    <div>
                        <div>{r.emp.name || '—'}</div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {r.emp.email || '—'}
                        </Text>
                    </div>
                )
            },
            {
                title: 'Affiliation',
                render: (_: any, r: { emp: Employee }) => {
                    const a = affOf(r.emp)
                    return a.kind ? (
                        <Space>
                            <Tag>{a.kind}</Tag>
                            <span>{a.name}</span>
                        </Space>
                    ) : (
                        '—'
                    )
                }
            },
            {
                title: 'Annual remaining',
                render: (_: any, r: { usage: ReturnType<typeof computeUsage> }) =>
                    r.usage ? `${r.usage.rem.annual}/${r.usage.caps.annual}` : '—'
            },
            {
                title: 'Sick remaining (12m)',
                render: (_: any, r: { usage: ReturnType<typeof computeUsage> }) =>
                    r.usage ? `${r.usage.rem.sick12}/${r.usage.caps.sick.per12}` : '—'
            },
            {
                title: 'Family remaining',
                render: (_: any, r: { usage: ReturnType<typeof computeUsage> }) =>
                    r.usage ? `${r.usage.rem.family}/${r.usage.caps.family}` : '—'
            },
            {
                title: 'Study remaining',
                render: (_: any, r: { usage: ReturnType<typeof computeUsage> }) =>
                    r.usage ? `${r.usage.rem.study}/${r.usage.caps.study}` : '—'
            },
            {
                title: 'Actions',
                key: 'actions',
                render: (_: any, r: { emp: Employee }) => (
                    <Button size='middle' icon={<BarChartOutlined />} onClick={() => openSummaryFor(r.emp)}>
                        Details
                    </Button>
                )
            }
        ]

        return (
            <MotionCard>
                <Table
                    size='middle'
                    rowKey={r => r.emp.id}
                    loading={empLoading}
                    dataSource={rows}
                    columns={cols}
                    pagination={{ pageSize: 10, position: ['bottomCenter'], showSizeChanger: false }}
                    locale={{ emptyText: <Empty description='No employees' /> }}
                />
            </MotionCard>
        )
    }

    const EmployeeSummaryModal = () => {
        if (!summaryEmployee || !settings) return null
        const u = summaryEmployee
        const usage = computeUsage(u.id)!
        const blocks: Array<{
            key: LeaveType
            title: string
            used: number
            cap: number
            note?: string
        }> = [
                {
                    key: 'annual',
                    title: 'Annual',
                    used: usage.used.annual,
                    cap: usage.caps.annual
                },
                {
                    key: 'sick',
                    title: 'Sick',
                    used: usage.used.sick12,
                    cap: usage.caps.sick.per12,
                    note: `Also ${usage.used.sick24}/${usage.caps.sick.per24} in 24m`
                },
                {
                    key: 'family',
                    title: 'Family',
                    used: usage.used.family,
                    cap: usage.caps.family
                },
                {
                    key: 'study',
                    title: 'Study',
                    used: usage.used.study,
                    cap: usage.caps.study
                },
                {
                    key: 'maternity',
                    title: 'Maternity',
                    used: usage.used.maternity,
                    cap: usage.caps.maternity
                },
                {
                    key: 'parental',
                    title: 'Parental',
                    used: usage.used.parental,
                    cap: usage.caps.parental
                }
            ]

        return (
            <Modal
                title='Employee Leave Summary'
                open={summaryOpen}
                onCancel={() => setSummaryOpen(false)}
                footer={
                    <Button block onClick={() => setSummaryOpen(false)}>
                        Close
                    </Button>
                }
                width={900}
                destroyOnClose
            >
                <Descriptions
                    bordered
                    size='middle'
                    column={{ xs: 1, sm: 1, md: 2 }}
                    labelStyle={{ width: 130 }}
                >
                    <Descriptions.Item label='Employee' span={2}>
                        <Space direction='vertical' size={0}>
                            <Text strong>{u.name || '—'}</Text>
                            <Text type='secondary'>{u.email || '—'}</Text>
                        </Space>
                    </Descriptions.Item>
                    {(u.branchName || u.departmentName) && (
                        <Descriptions.Item label='Affiliation' span={2}>
                            {u.branchName
                                ? `Branch: ${u.branchName}`
                                : `Department: ${u.departmentName}`}
                        </Descriptions.Item>
                    )}
                    {blocks.map(b => {
                        const pct =
                            b.cap > 0 ? Math.min(100, Math.round((b.used / b.cap) * 100)) : 0
                        return (
                            <Descriptions.Item label={b.title} key={b.key}>
                                <div>
                                    <Text>{b.used}/{b.cap} days used</Text>
                                    <Progress
                                        percent={pct}
                                        size='small'
                                        status={pct >= 100 ? 'exception' : 'normal'}
                                        style={{ marginBottom: 0 }}
                                    />
                                    {b.note && (
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {b.note}
                                        </Text>
                                    )}
                                </div>
                            </Descriptions.Item>
                        )
                    })}
                </Descriptions>
            </Modal>
        )
    }

    // ── Edit Leave
    const openEdit = (req: LeaveRequest) => {
        setEditingRequest(req)
        editForm.setFieldsValue({
            type: req.type,
            dates: [dayjs(req.from), dayjs(req.to)],
            reason: req.reason
        })
        setEditOpen(true)
    }

    const editMaxSpan = useMemo(() => {
        if (!editingRequest) return 0
        return remainingForType(
            editingRequest.employeeId,
            editForm.getFieldValue('type') || editingRequest.type
        )
    }, [editingRequest, editForm, requests, settings])

    const editDisabledDate = (current: Dayjs) => {
        if (settings?.blackoutDates?.includes(current.format('YYYY-MM-DD')))
            return true
        const dates = editForm.getFieldValue('dates') as [Dayjs, Dayjs] | undefined
        const start = dates?.[0]
        if (start && editMaxSpan) {
            const maxEnd = start.add(editMaxSpan - 1, 'day')
            if (current.isAfter(maxEnd, 'day')) return true
        }
        return false
    }

    const submitEdit = async () => {
        const vals = await editForm.validateFields()
        if (!editingRequest) return
        const [from, to] = vals.dates as [Dayjs, Dayjs]
        const fromISO = from.format('YYYY-MM-DD')
        const toISO = to.format('YYYY-MM-DD')
        const type = vals.type as LeaveType
        const days = countDaysInclusive(fromISO, toISO)

        const check = validateForUser(editingRequest.employeeId, type, fromISO, toISO)
        if (!check.ok)
            return message.error(check.reason || 'Policy prevents update.')

        try {
            await updateDoc(doc(db, 'leaveRequests', editingRequest.id), {
                type,
                reason: vals.reason,
                from: fromISO,
                to: toISO,
                days
            })
            message.success('Leave updated.')
            setEditOpen(false)
            setEditingRequest(null)
            editForm.resetFields()
        } catch (e) {
            console.error(e)
            message.error('Failed to update leave.')
        }
    }

    const endLeaveToday = async (req: LeaveRequest) => {
        const today = dayjs().format('YYYY-MM-DD')
        if (dayjs(today).isBefore(dayjs(req.from), 'day')) {
            return message.warning('Leave has not started yet.')
        }
        if (dayjs(today).isAfter(dayjs(req.to), 'day')) {
            return message.info('Leave already ended.')
        }
        try {
            const newDays = countDaysInclusive(req.from, today)
            await updateDoc(doc(db, 'leaveRequests', req.id), {
                to: today,
                days: newDays
            })
            message.success('Leave ended today.')
        } catch (e) {
            console.error(e)
            message.error('Failed to end leave.')
        }
    }

    // ── Render
    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>

            <Row style={{ marginBottom: 16 }}>
                <Col xs={24}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12} md={6}>
                            <MotionCard>
                                <MotionCard.Metric
                                    icon={<ClockCircleOutlined style={{ color: '#faad14', fontSize: 18 }} />}
                                    iconBg="rgba(250,173,20,0.14)"
                                    title="Pending"
                                    value={stats.pending}
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <MotionCard>
                                <MotionCard.Metric
                                    icon={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />}
                                    iconBg="rgba(82,196,26,0.12)"
                                    title="Approved"
                                    value={stats.approved}
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <MotionCard>
                                <MotionCard.Metric
                                    icon={<CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />}
                                    iconBg="rgba(255,77,79,0.12)"
                                    title="Rejected"
                                    value={stats.rejected}
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <MotionCard>
                                <MotionCard.Metric
                                    icon={<BarChartOutlined style={{ color: '#1890ff', fontSize: 18 }} />}
                                    iconBg="rgba(24,144,255,0.12)"
                                    title="Total"
                                    value={stats.total}
                                />
                            </MotionCard>
                        </Col>
                    </Row>
                </Col>
            </Row>

            {/* Filters */}
            <MotionCard
                filterBar={
                    <Row
                        gutter={12}
                        align='middle'
                        wrap={false}
                        style={{
                            width: '100%',
                            overflowX: 'auto',
                            paddingBottom: 4
                        }}
                    >
                        <Col flex='1 1 260px' style={{ minWidth: 240 }}>
                            <Input.Search
                                placeholder='Search by employee name or email'
                                allowClear
                                value={searchTerm}
                                onSearch={value => setSearchTerm(value)}
                                onChange={event => setSearchTerm(event.target.value)}
                            />
                        </Col>

                        <Col flex='0 0 160px'>
                            <Select
                                placeholder='Filter by type'
                                style={{ width: '100%' }}
                                allowClear
                                value={typeFilter}
                                onChange={value => setTypeFilter(value)}
                            >
                                <Option value='annual'>Annual</Option>
                                <Option value='sick'>Sick</Option>
                                <Option value='family'>Family</Option>
                                <Option value='study'>Study</Option>
                                <Option value='maternity'>Maternity</Option>
                                <Option value='parental'>Parental</Option>
                                <Option value='personal'>Personal</Option>
                            </Select>
                        </Col>

                        <Col flex='0 0 160px'>
                            <Select
                                placeholder='Filter by status'
                                style={{ width: '100%' }}
                                allowClear
                                value={statusFilter}
                                onChange={value => setStatusFilter(value)}
                            >
                                <Option value='pending'>Pending</Option>
                                <Option value='approved'>Approved</Option>
                                <Option value='rejected'>Rejected</Option>
                            </Select>
                        </Col>

                        <Col flex='0 0 280px'>
                            <RangePicker
                                value={range as any}
                                onChange={value => setRange(value as any)}
                                allowClear
                                placeholder={['From date', 'To date']}
                                style={{ width: '100%' }}
                            />
                        </Col>

                        <Col flex='none'>
                            <Segmented
                                value={view}
                                onChange={value =>
                                    setView(value as 'list' | 'balances')
                                }
                                options={[
                                    {
                                        label: 'Requests',
                                        value: 'list',
                                        icon: <UnorderedListOutlined />
                                    },
                                    {
                                        label: 'Balances',
                                        value: 'balances',
                                        icon: <BarChartOutlined />
                                    }
                                ]}
                            />
                        </Col>

                        <Col flex='none'>
                            <Button
                                icon={<SettingOutlined />}
                                onClick={() => setSettingsOpen(true)}
                                style={{ whiteSpace: 'nowrap' }}
                            >
                                Settings
                            </Button>
                        </Col>

                        <Col flex='none'>
                            <Button
                                type='primary'
                                icon={<PlusOutlined />}
                                style={{ whiteSpace: 'nowrap' }}
                                onClick={() => {
                                    setWizardOpen(true)
                                    setStep(0)
                                }}
                            >
                                Assign Leave
                            </Button>
                        </Col>

                    </Row>
                }
                filterBarProps={{ marginBottom: 0 }}
                style={{ marginBottom: 12 }}
            >
            </MotionCard>

            {view === 'list' && (
                <MotionCard>
                    <Table
                        columns={columns}
                        dataSource={filtered}
                        rowKey='id'
                        loading={loading}
                        pagination={{ pageSize: 10, position: ['bottomCenter'] }}
                        scroll={{ x: true }}
                        locale={{ emptyText: <Empty description='No requests' /> }}
                        style={{ marginTop: 12 }}
                    />
                </MotionCard>
            )}

            {view === 'balances' && <LeaveBalancesTable />}

            <Modal
                title='Leave Settings'
                open={settingsOpen}
                onCancel={() => setSettingsOpen(false)}
                footer={null}
                width={900}
                destroyOnClose={false}
            >
                <Form
                    form={settingsForm}
                    layout='vertical'
                    onFinish={async vals => {
                        try {
                            const base = collection(db, 'system_settings')
                            const sq = query(base, where('type', '==', 'leave'), qLimit(1))
                            const snap = await getDocs(sq)
                            const payload: LeaveSettings = {
                                type: 'leave',
                                caps: {
                                    annual: Number(vals.annual),
                                    sick: {
                                        per12: Number(vals.sick12),
                                        per24: Number(vals.sick24)
                                    },
                                    family: Number(vals.family),
                                    study: Number(vals.study),
                                    maternity: Number(vals.maternity),
                                    parental: Number(vals.parental)
                                },
                                sickProofAfterDays: Number(vals.sickProofAfterDays),
                                autoApproveHalfDay: Boolean(vals.autoApproveHalfDay),
                                blackoutDates: (vals.blackoutDates || []).map((d: Dayjs) =>
                                    d.format('YYYY-MM-DD')
                                )
                            }
                            if (!snap.empty) {
                                await setDoc(
                                    doc(db, 'system_settings', snap.docs[0].id),
                                    payload,
                                    { merge: true }
                                )
                            } else {
                                await addDoc(base, payload)
                            }
                            setSettings(payload)
                            message.success('Leave policy saved')
                            setSettingsOpen(false)
                        } catch (e) {
                            console.error(e)
                            message.error('Failed to save leave policy')
                        }
                    }}
                >
                    <Row gutter={16}>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='annual'
                                label='Annual (days / 12m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='sick12'
                                label='Sick (days / 12m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='sick24'
                                label='Sick (days / 24m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={16}>
                        <Col xs={24} md={6}>
                            <Form.Item
                                name='family'
                                label='Family (days / 12m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item
                                name='study'
                                label='Study (days / 12m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item
                                name='maternity'
                                label='Maternity (days / 24m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item
                                name='parental'
                                label='Parental (days / 12m)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={16}>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='sickProofAfterDays'
                                label='Medical proof required after (days)'
                                rules={[{ required: true }]}
                            >
                                <Input type='number' min={0} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='autoApproveHalfDay'
                                label='Auto-approve half-day sick leave'
                            >
                                <Select
                                    options={[
                                        { value: true, label: 'Enabled' },
                                        { value: false, label: 'Disabled' }
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name='blackoutDates' label='Blackout dates'>
                                <DatePicker.RangePicker format='YYYY-MM-DD' />
                                <div style={{ marginTop: 8 }}>
                                    <Text type='secondary'>
                                        Pick ranges and save — we store days.
                                    </Text>
                                </div>
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item style={{ marginBottom: 0 }}>
                        <Row gutter={8}>
                            <Col span={12}>
                                <Button block onClick={() => setSettingsOpen(false)}>
                                    Cancel
                                </Button>
                            </Col>
                            <Col span={12}>
                                <Button block type='primary' htmlType='submit'>
                                    Save Policy
                                </Button>
                            </Col>
                        </Row>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Put On Leave Wizard */}
            <Modal
                title='Put Employee(s) On Leave'
                open={wizardOpen}
                onCancel={() => setWizardOpen(false)}
                width={900}
                footer={
                    <Row gutter={8} style={{ width: '100%' }}>
                        {step > 0 && (
                            <Col span={12}>
                                <Button
                                    block
                                    onClick={() => setStep(s => s - 1)}
                                >
                                    Back
                                </Button>
                            </Col>
                        )}
                        <Col span={step > 0 ? 12 : 24}>
                            {step === 0 && (
                                <Button block type='primary' onClick={nextFromStep1}>
                                    Next
                                </Button>
                            )}
                            {step === 1 && (
                                <Button block type='primary' onClick={nextFromStep2}>
                                    Review
                                </Button>
                            )}
                            {step === 2 && (
                                <Button block type='primary' disabled={!allOk} onClick={submitAll}>
                                    Submit
                                </Button>
                            )}
                        </Col>
                    </Row>
                }
                destroyOnClose
            >
                <Steps current={step} style={{ marginBottom: 16 }}>
                    <Step title='Select Employees' icon={<TeamOutlined />} />
                    <Step title='Leave Details' icon={<UserOutlined />} />
                    <Step title='Review & Submit' icon={<CheckCircleOutlined />} />
                </Steps>

                {step === 0 && <EmployeeStep />}
                {step === 1 && <LeaveDetailsStep />}
                {step === 2 && <ReviewStep />}
            </Modal>

            {/* Existing details modal */}
            <Modal
                title='Leave Request Details'
                open={isDetailsOpen}
                onCancel={() => setIsDetailsOpen(false)}
                footer={null}
                width={1000}
                destroyOnClose
            >
                {selectedRequest ? (
                    <div>
                        <Descriptions
                            bordered
                            size='middle'
                            column={{ xs: 1, sm: 1, md: 2 }}
                            labelStyle={{ width: 160 }}
                        >
                            <Descriptions.Item label='Employee' span={2}>
                                <Space direction='vertical' size={0}>
                                    <Text strong>{selectedRequest.employeeName || '—'}</Text>
                                    <Text type='secondary'>
                                        {selectedRequest.employeeEmail || '—'}
                                    </Text>
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label='Type'>
                                {typeLabel(selectedRequest.type)}
                            </Descriptions.Item>

                            <Descriptions.Item label='Status'>
                                <Space size={6}>
                                    {selectedRequest.status === 'approved' ? (
                                        <Tag color='green'>APPROVED</Tag>
                                    ) : selectedRequest.status === 'pending' ? (
                                        <Tag color='orange'>PENDING</Tag>
                                    ) : (
                                        <Tag color='red'>REJECTED</Tag>
                                    )}
                                    {/* Optional live flag if you kept isOnNow() */}
                                    {selectedRequest.status === 'approved' &&
                                        isOnNow(selectedRequest.from, selectedRequest.to) && (
                                            <Tag color='green'>ON NOW</Tag>
                                        )}
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label='Duration'>
                                {selectedRequest.days} day{selectedRequest.days > 1 ? 's' : ''}
                            </Descriptions.Item>

                            <Descriptions.Item label='Dates' span={2}>
                                {dayjs(selectedRequest.from).format('MMMM D, YYYY')} –{' '}
                                {dayjs(selectedRequest.to).format('MMMM D, YYYY')}
                            </Descriptions.Item>

                            {/* Affiliation (Branch OR Department, never both) */}
                            <Descriptions.Item label='Affiliation'>
                                {(() => {
                                    const emp = employees.find(
                                        e => e.id === selectedRequest.employeeId
                                    )
                                    if (!emp) return '—'
                                    if (emp.branchName) return <>Branch: {emp.branchName}</>
                                    if (emp.departmentName)
                                        return <>Department: {emp.departmentName}</>
                                    return '—'
                                })()}
                            </Descriptions.Item>

                            <Descriptions.Item label='Applied On'>
                                {selectedRequest.appliedDate
                                    ? dayjs(selectedRequest.appliedDate).format('MMMM D, YYYY')
                                    : '—'}
                            </Descriptions.Item>

                            <Descriptions.Item label='Reason' span={2}>
                                {selectedRequest.reason || '—'}
                            </Descriptions.Item>

                            {selectedRequest.status !== 'pending' && (
                                <>
                                    <Descriptions.Item
                                        label={
                                            selectedRequest.status === 'approved'
                                                ? 'Approved By'
                                                : 'Rejected By'
                                        }
                                    >
                                        {selectedRequest.approvedBy || '—'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label='Decision Date'>
                                        {selectedRequest.approvedDate
                                            ? dayjs(selectedRequest.approvedDate).format(
                                                'MMMM D, YYYY'
                                            )
                                            : '—'}
                                    </Descriptions.Item>

                                    {selectedRequest.status === 'rejected' && (
                                        <Descriptions.Item label='Rejection Reason' span={2}>
                                            {selectedRequest.rejectionReason || '—'}
                                        </Descriptions.Item>
                                    )}
                                </>
                            )}
                        </Descriptions>

                        <div style={{ marginTop: 16 }}>
                            <Button block onClick={() => setIsDetailsOpen(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>

            {/* Reject modal */}
            <Modal
                title='Reject Leave Request'
                open={isRejectOpen}
                onCancel={() => setIsRejectOpen(false)}
                footer={null}
                destroyOnClose
            >
                <Form form={rejectForm} onFinish={handleReject} layout='vertical'>
                    <Form.Item
                        name='rejectionReason'
                        label='Reason for Rejection'
                        rules={[{ required: true, message: 'Please provide a reason' }]}
                    >
                        <TextArea
                            rows={4}
                            placeholder='Enter the reason for rejecting this leave request'
                        />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                        <Row gutter={8}>
                            <Col span={12}>
                                <Button block onClick={() => setIsRejectOpen(false)}>
                                    Cancel
                                </Button>
                            </Col>
                            <Col span={12}>
                                <Button block type='primary' htmlType='submit'>
                                    Confirm Rejection
                                </Button>
                            </Col>
                        </Row>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Employee Summary modal */}
            <EmployeeSummaryModal />

            {/* Edit leave modal */}
            <Modal
                title='Edit Leave'
                open={editOpen}
                onCancel={() => setEditOpen(false)}
                footer={null}
                destroyOnClose
            >
                <Form form={editForm} layout='vertical'>
                    <Form.Item
                        name='type'
                        label='Leave Type'
                        rules={[{ required: true }]}
                    >
                        <Select>
                            <Option value='annual'>Annual</Option>
                            <Option value='sick'>Sick</Option>
                            <Option value='family'>Family</Option>
                            <Option value='study'>Study</Option>
                            <Option value='maternity'>Maternity</Option>
                            <Option value='parental'>Parental</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name='dates' label='Dates' rules={[{ required: true }]}>
                        <RangePicker disabledDate={editDisabledDate} allowClear={false} />
                    </Form.Item>
                    <Form.Item name='reason' label='Reason' rules={[{ required: true }]}>
                        <TextArea rows={3} />
                    </Form.Item>
                    <Row gutter={8}>
                        <Col span={12}>
                            <Button block onClick={() => setEditOpen(false)}>
                                Cancel
                            </Button>
                        </Col>
                        <Col span={12}>
                            <Button block type='primary' onClick={submitEdit}>
                                Save
                            </Button>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </div>
    )
}

export default AdminLeaveManagement
