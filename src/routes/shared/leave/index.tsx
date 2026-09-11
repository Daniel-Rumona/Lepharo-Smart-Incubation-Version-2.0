import { useState, useEffect, useMemo } from 'react'
import {
    Table,
    Tag,
    Select,
    Button,
    Space,
    Row,
    Col,
    Typography,
    Input,
    Progress,
    message,
    Alert,
    Modal,
    DatePicker,
} from 'antd'
import {
    CalendarOutlined,
    PlusOutlined,
    EyeOutlined,
    EditOutlined,
    SearchOutlined,
    FileTextOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import {
    collection,
    addDoc,
    updateDoc,
    onSnapshot,
    query,
    where,
    doc,
    getDoc,
    getDocs,
    setDoc
} from 'firebase/firestore'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { Text } = Typography
const { Option } = Select
const { TextArea } = Input
const { RangePicker } = DatePicker

const EmployeeLeave = () => {
    const { user, isViewingAs } = useFullIdentity()
    const [requestModalOpen, setRequestModalOpen] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [requestSearch, setRequestSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const [typeFilter, setTypeFilter] = useState<string | undefined>()
    const [filterDateRange, setFilterDateRange] = useState<
        [Dayjs | null, Dayjs | null] | null
    >(null)
    const [selectedLeaveType, setSelectedLeaveType] = useState('')
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([
        null,
        null
    ])
    const [reason, setReason] = useState('')
    const [viewModal, setViewModal] = useState<{
        visible: boolean
        data: any | null
    }>({
        visible: false,
        data: null
    })
    const [addedByName, setAddedByName] = useState<string | null>(null)
    const [leaveRequests, setLeaveRequests] = useState<any[]>([])
    const [leaveBalance, setLeaveBalance] = useState<any | null>(null)
    const [loading, setLoading] = useState(true)

    // Edit (self-service correction of a mistake, pending requests only)
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [editingRequest, setEditingRequest] = useState<any | null>(null)
    const [editSubmitting, setEditSubmitting] = useState(false)
    const [editLeaveType, setEditLeaveType] = useState('')
    const [editDateRange, setEditDateRange] = useState<
        [Dayjs | null, Dayjs | null]
    >([null, null])
    const [editReason, setEditReason] = useState('')

    const requestedDays =
        dateRange[0] && dateRange[1]
            ? dateRange[1].diff(dateRange[0], 'day') + 1
            : 0

    const editRequestedDays =
        editDateRange[0] && editDateRange[1]
            ? editDateRange[1].diff(editDateRange[0], 'day') + 1
            : 0

    const requestMetrics = {
        total: leaveRequests.length,
        pending: leaveRequests.filter(request => request.status === 'pending').length,
        approved: leaveRequests.filter(request => request.status === 'approved').length,
        rejected: leaveRequests.filter(request => request.status === 'rejected').length
    }

    const formatLeaveDate = (value: unknown) => {
        const parsed = dayjs(value as any)
        return parsed.isValid() ? parsed.format('DD MMM YYYY') : '—'
    }

    const addedByAnotherPerson = (request: any) => {
        const addedBy = String(request?.putByEmail || request?.createdByEmail || '').trim()
        const employeeEmail = String(user?.email || request?.employeeEmail || '').trim()
        return Boolean(addedBy) && addedBy.toLowerCase() !== employeeEmail.toLowerCase()
    }

    useEffect(() => {
        const request = viewModal.data
        const addedByEmail = String(request?.putByEmail || request?.createdByEmail || '').trim()
        if (!viewModal.visible || !addedByAnotherPerson(request) || !addedByEmail) {
            setAddedByName(null)
            return
        }

        let cancelled = false
        setAddedByName(null)
        getDocs(query(collection(db, 'users'), where('email', '==', addedByEmail)))
            .then(snapshot => {
                if (cancelled) return
                const profile = snapshot.docs[0]?.data() as any
                setAddedByName(String(profile?.name || profile?.fullName || profile?.displayName || 'A staff member'))
            })
            .catch(error => {
                console.error('[Leave] Could not resolve leave creator name:', error)
                if (!cancelled) setAddedByName('A staff member')
            })

        return () => { cancelled = true }
    }, [viewModal.data, viewModal.visible, user?.email])

    // The leave balance document supplies entitlement totals only. Used days
    // are always derived from the employee's approved leave records so the
    // displayed balance cannot lag behind HR approvals.
    const calculatedLeaveBalance = useMemo(() => {
        const base = leaveBalance || {
            annual: { total: 25 },
            sick: { total: 12 },
            personal: { total: 5 }
        }
        const result: Record<string, { total: number; used: number }> = {}
        Object.entries(base).forEach(([type, value]: [string, any]) => {
            result[type] = { total: Number(value?.total || 0), used: 0 }
        })
        leaveRequests
            .filter(request => String(request.status || '').toLowerCase() === 'approved')
            .forEach(request => {
                const type = String(request.type || '')
                if (!result[type]) return
                const recordedDays = Number(request.days)
                const derivedDays = dayjs(request.to).diff(dayjs(request.from), 'day') + 1
                result[type].used += Number.isFinite(recordedDays) && recordedDays > 0
                    ? recordedDays
                    : Math.max(derivedDays, 0)
            })
        return result
    }, [leaveBalance, leaveRequests])

    const filteredLeaveRequests = leaveRequests.filter(request => {
        const searchValue = requestSearch.trim().toLowerCase()
        const matchesSearch =
            !searchValue ||
            getLeaveTypeLabel(request.type).toLowerCase().includes(searchValue) ||
            String(request.reason || '').toLowerCase().includes(searchValue) ||
            String(request.from || '').includes(searchValue) ||
            String(request.to || '').includes(searchValue)
        const matchesStatus = !statusFilter || request.status === statusFilter
        const matchesType = !typeFilter || request.type === typeFilter
        const requestStart = dayjs(request.from)
        const requestEnd = dayjs(request.to)
        const matchesDateRange =
            !filterDateRange?.[0] ||
            !filterDateRange?.[1] ||
            (!requestEnd.isBefore(filterDateRange[0], 'day') &&
                !requestStart.isAfter(filterDateRange[1], 'day'))

        return matchesSearch && matchesStatus && matchesType && matchesDateRange
    })

    const resetRequestForm = () => {
        setSelectedLeaveType('')
        setDateRange([null, null])
        setReason('')
    }

    const getStatusTag = (status: string) => {
        switch (status) {
            case 'approved':
                return <Tag color='green'>Approved</Tag>
            case 'pending':
                return <Tag color='orange'>Pending</Tag>
            case 'rejected':
                return <Tag color='red'>Rejected</Tag>
            default:
                return <Tag>{status}</Tag>
        }
    }

    function getLeaveTypeLabel(type: string) {
        switch (type) {
            case 'annual':
                return 'Annual Leave'
            case 'sick':
                return 'Sick Leave'
            case 'personal':
                return 'Personal Leave'
            default:
                return type
        }
    }


    /** Fetch leave balances from Firestore */
    const fetchLeaveBalance = async () => {
        if (!user?.uid) return
        const docRef = doc(db, 'leaveBalances', user.uid)
        const defaultBalance = {
            annual: { used: 0, total: 25 },
            sick: { used: 0, total: 12 },
            personal: { used: 0, total: 5 }
        }
        try {
            const snap = await getDoc(docRef)
            if (snap.exists()) {
                console.info('[Leave] Balance loaded', { employeeId: user.uid, isViewingAs })
                setLeaveBalance(snap.data())
            } else {
                console.info('[Leave] Balance missing; using default', { employeeId: user.uid, isViewingAs })
                if (!isViewingAs) await setDoc(docRef, defaultBalance)
                setLeaveBalance(defaultBalance)
            }
        } catch (error) {
            console.error('[Leave] Balance read failed; using default', {
                employeeId: user.uid,
                isViewingAs,
                code: (error as any)?.code,
                message: (error as Error)?.message
            })
            setLeaveBalance(defaultBalance)
        }
    }

    /** Submit leave request */
    const handleSubmitLeave = async () => {
        if (
            !selectedLeaveType ||
            !dateRange[0] ||
            !dateRange[1] ||
            !reason.trim()
        ) {
            message.error('Please fill in all required fields.')
            return
        }

        const balance = calculatedLeaveBalance[selectedLeaveType]
        if (balance.used + requestedDays > balance.total) {
            message.error(
                `You only have ${balance.total - balance.used} ${getLeaveTypeLabel(
                    selectedLeaveType
                ).toLowerCase()} days remaining.`
            )
            return
        }

        try {
            setSubmitting(true)
            await addDoc(collection(db, 'leaveRequests'), {
                employeeId: user?.uid,
                employeeEmail: user?.email || '',
                employeeName: user?.name || user?.email || '',
                type: selectedLeaveType,
                reason,
                from: dateRange[0]?.format('YYYY-MM-DD'),
                to: dateRange[1]?.format('YYYY-MM-DD'),
                days: requestedDays,
                status: 'pending',
                appliedDate: dayjs().format('YYYY-MM-DD'),
                approvedBy: '',
                approvedDate: '',
                rejectionReason: ''
            })

            message.success(
                `Your ${getLeaveTypeLabel(
                    selectedLeaveType
                ).toLowerCase()} request for ${requestedDays} day(s) has been submitted.`
            )

            resetRequestForm()
            setRequestModalOpen(false)
        } catch (err) {
            console.error(err)
            message.error('Failed to submit leave request. Try again.')
        } finally {
            setSubmitting(false)
        }
    }

    /** Open the edit modal for one of my own pending requests */
    const openEditModal = (record: any) => {
        setEditingRequest(record)
        setEditLeaveType(record.type)
        setEditDateRange([dayjs(record.from), dayjs(record.to)])
        setEditReason(record.reason || '')
        setEditModalOpen(true)
    }

    /** Remaining days for a type, excluding the request being edited so it isn't double-counted */
    const remainingForEdit = (type: string) => {
        const balance = calculatedLeaveBalance?.[type]
        if (!balance) return 0
        const usedExcludingThis =
            balance.used - (editingRequest?.type === type ? editingRequest.days || 0 : 0)
        return balance.total - usedExcludingThis
    }

    /** Save a correction to my own pending leave request */
    const handleUpdateLeave = async () => {
        if (
            !editingRequest ||
            !editLeaveType ||
            !editDateRange[0] ||
            !editDateRange[1] ||
            !editReason.trim()
        ) {
            message.error('Please fill in all required fields.')
            return
        }

        const remaining = remainingForEdit(editLeaveType)
        if (editRequestedDays > remaining) {
            message.error(
                `You only have ${remaining} ${getLeaveTypeLabel(
                    editLeaveType
                ).toLowerCase()} days remaining.`
            )
            return
        }

        try {
            setEditSubmitting(true)
            await updateDoc(doc(db, 'leaveRequests', editingRequest.id), {
                type: editLeaveType,
                reason: editReason,
                from: editDateRange[0]?.format('YYYY-MM-DD'),
                to: editDateRange[1]?.format('YYYY-MM-DD'),
                days: editRequestedDays
            })

            message.success('Your leave request has been updated.')
            setEditModalOpen(false)
            setEditingRequest(null)
        } catch (err) {
            console.error(err)
            message.error('Failed to update leave request. Try again.')
        } finally {
            setEditSubmitting(false)
        }
    }

    /** Listen to leave requests in real-time */
    useEffect(() => {
        if (!user?.uid) {
            console.warn('[Leave] No effective identity was available for the leave query.')
            setLeaveRequests([])
            setLoading(false)
            return
        }
        setLoading(true)
        console.info('[Leave] Starting listeners', {
            isViewingAs,
            effectiveEmployeeId: user.uid,
            effectiveEmployeeEmail: user.email || null
        })
        fetchLeaveBalance()

        // In View As, Firestore evaluates permissions using the real actor,
        // not the displayed employee.
        const uidQuery = query(
            collection(db, 'leaveRequests'),
            where('employeeId', '==', user.uid)
        )
        const email = String(user.email || '').trim()
        let uidRows: any[] = []
        let emailRows: any[] = []
        const publish = () => {
            const rows = new Map<string, any>()
                ;[...uidRows, ...emailRows].forEach(row => rows.set(row.id, row))
            setLeaveRequests([...rows.values()])
            setLoading(false)
        }
        const onError = (error: Error) => {
            console.error('[Leave] Listener failed', {
                effectiveEmployeeId: user.uid,
                effectiveEmployeeEmail: email || null,
                code: (error as any)?.code,
                message: error.message
            })
            setLoading(false)
            message.error('Your leave requests could not be loaded. Please try again.')
        }
        const unsubscribeUid = onSnapshot(uidQuery, snapshot => {
            uidRows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
            console.info('[Leave] employeeId listener snapshot', {
                targetEmployeeId: user.uid,
                count: uidRows.length,
                ids: uidRows.map(row => row.id)
            })
            publish()
        }, onError)
        const unsubscribeEmail = email
            ? onSnapshot(
                query(
                    collection(db, 'leaveRequests'),
                    where('employeeEmail', '==', email)
                ),
                snapshot => {
                    emailRows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
                    console.info('[Leave] employeeEmail listener snapshot', {
                        targetEmail: email,
                        count: emailRows.length,
                        ids: emailRows.map(row => row.id)
                    })
                    publish()
                },
                onError
            )
            : () => undefined
        return () => {
            unsubscribeUid()
            unsubscribeEmail()
        }
    }, [isViewingAs, user?.email, user?.uid])

    const columns = [
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type',
            render: (t: string) => getLeaveTypeLabel(t)
        },
        {
            title: 'Dates',
            key: 'dates',
            render: (_: any, record: any) => `${formatLeaveDate(record.from)} to ${formatLeaveDate(record.to)}`
        },
        { title: 'Days', dataIndex: 'days', key: 'days' },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (s: string) => getStatusTag(s)
        },
        {
            title: 'Applied',
            dataIndex: 'appliedDate',
            key: 'appliedDate',
            render: (value: unknown) => formatLeaveDate(value)
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: any) => (
                <Space size='small'>
                    <Button
                        icon={<EyeOutlined />}
                        size='small'
                        onClick={() => setViewModal({ visible: true, data: record })}
                    />
                    {record.status === 'pending' && (
                        <Button
                            icon={<EditOutlined />}
                            size='small'
                            onClick={() => openEditModal(record)}
                        />
                    )}
                </Space>
            )
        }
    ]

    if (loading || !leaveBalance)
        return (
            <div style={{ minHeight: '100vh' }}>
                <LoadingOverlay tip='Loading details' />
            </div>
        )

    return (
        <div
            style={{
                margin: '0 auto',
                padding: '24px',
                minHeight: '100vh'
            }}
        >
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            title='Total Requests'
                            value={requestMetrics.total}
                            subtitle='All leave applications'
                            icon={<FileTextOutlined style={{ color: '#1677ff' }} />}
                            iconBg='rgba(22,119,255,.12)'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            title='Pending'
                            value={requestMetrics.pending}
                            subtitle='Awaiting a decision'
                            icon={<ClockCircleOutlined style={{ color: '#faad14' }} />}
                            iconBg='rgba(250,173,20,.14)'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            title='Approved'
                            value={requestMetrics.approved}
                            subtitle='Requests approved'
                            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                            iconBg='rgba(82,196,26,.12)'
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard>
                        <MotionCard.Metric
                            title='Rejected'
                            value={requestMetrics.rejected}
                            subtitle='Requests declined'
                            icon={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
                            iconBg='rgba(255,77,79,.12)'
                        />
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]} align='top'>
                <Col xs={24} xl={16}>
                    <MotionCard
                        filterBar={
                            <Row gutter={[10, 10]} align='middle'>
                                <Col xs={24} lg={7}>
                                    <Input
                                        allowClear
                                        prefix={<SearchOutlined />}
                                        placeholder='Search requests'
                                        value={requestSearch}
                                        onChange={event => setRequestSearch(event.target.value)}
                                    />
                                </Col>
                                <Col xs={12} sm={8} lg={4}>
                                    <Select
                                        allowClear
                                        placeholder='Status'
                                        value={statusFilter}
                                        onChange={setStatusFilter}
                                        style={{ width: '100%' }}
                                        options={[
                                            { value: 'pending', label: 'Pending' },
                                            { value: 'approved', label: 'Approved' },
                                            { value: 'rejected', label: 'Rejected' }
                                        ]}
                                    />
                                </Col>
                                <Col xs={12} sm={8} lg={4}>
                                    <Select
                                        allowClear
                                        placeholder='Leave type'
                                        value={typeFilter}
                                        onChange={setTypeFilter}
                                        style={{ width: '100%' }}
                                        options={[
                                            { value: 'annual', label: 'Annual Leave' },
                                            { value: 'sick', label: 'Sick Leave' },
                                            { value: 'personal', label: 'Personal Leave' }
                                        ]}
                                    />
                                </Col>
                                <Col xs={24} sm={8} lg={6}>
                                    <RangePicker
                                        allowClear
                                        placeholder={['From date', 'To date']}
                                        value={filterDateRange}
                                        onChange={value =>
                                            setFilterDateRange(
                                                value as [Dayjs | null, Dayjs | null] | null
                                            )
                                        }
                                        style={{ width: '100%' }}
                                    />
                                </Col>
                                <Col xs={24} lg={3}>
                                    <Button
                                        type='primary'
                                        block
                                        icon={<PlusOutlined />}
                                        onClick={() => setRequestModalOpen(true)}
                                    >
                                        Request
                                    </Button>
                                </Col>
                            </Row>
                        }
                    >
                        <Table
                            columns={columns}
                            dataSource={filteredLeaveRequests}
                            rowKey='id'
                            pagination={{ pageSize: 5, position: ['bottomCenter'] }}
                            scroll={{ x: 700 }}
                            locale={{ emptyText: 'No leave requests match these filters.' }}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} xl={8}>
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <MotionCard title='Leave Balance'>
                            {Object.entries(calculatedLeaveBalance).map(([type, balance]: any) => {
                                const remaining = balance.total - balance.used
                                const percentage = balance.total > 0
                                    ? Math.round((balance.used / balance.total) * 100)
                                    : 0
                                return (
                                    <div key={type} style={{ marginBottom: 16 }}>
                                        <Row justify='space-between' gutter={8}>
                                            <Text strong>{getLeaveTypeLabel(type)}</Text>
                                            <Text type='secondary'>{remaining} left</Text>
                                        </Row>
                                        <Progress percent={percentage} size='small' />
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            Used {balance.used} of {balance.total} days
                                        </Text>
                                    </div>
                                )
                            })}
                        </MotionCard>

                        <MotionCard title='Upcoming Leaves'>
                            {leaveRequests.filter(req =>
                                String(req.status || '').toLowerCase() === 'approved' &&
                                !dayjs(req.to).isBefore(dayjs(), 'day')
                            ).length > 0 ? (
                                leaveRequests
                                    .filter(req =>
                                        String(req.status || '').toLowerCase() === 'approved' &&
                                        !dayjs(req.to).isBefore(dayjs(), 'day')
                                    )
                                    .sort((left, right) => dayjs(left.from).valueOf() - dayjs(right.from).valueOf())
                                    .map(req => (
                                        <div
                                            key={req.id}
                                            style={{
                                                padding: '8px 0',
                                                borderBottom: '1px solid #f0f0f0'
                                            }}
                                        >
                                            <Text strong>{getLeaveTypeLabel(req.type)}</Text>
                                            <br />
                                            <Text type='secondary'>
                                                {formatLeaveDate(req.from)} to {formatLeaveDate(req.to)}
                                            </Text>
                                        </div>
                                    ))
                            ) : (
                                <div
                                    style={{
                                        textAlign: 'center',
                                        color: '#999',
                                        padding: 24
                                    }}
                                >
                                    <CalendarOutlined
                                        style={{ fontSize: 30, marginBottom: 4 }}
                                    />
                                    <p style={{ marginBottom: 0 }}>No upcoming leaves</p>
                                </div>
                            )}
                        </MotionCard>
                    </Space>
                </Col>
            </Row>

            {/* NEW REQUEST MODAL */}
            <Modal
                title='New Leave Request'
                open={requestModalOpen}
                onCancel={() => setRequestModalOpen(false)}
                footer={null}
                width={680}
                centered
                destroyOnClose
            >
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                            <Text strong>Leave Type *</Text>
                            <Select
                                value={selectedLeaveType || undefined}
                                onChange={setSelectedLeaveType}
                                placeholder='Select leave type'
                                style={{ width: '100%', marginTop: 4 }}
                            >
                                <Option value='annual'>Annual Leave</Option>
                                <Option value='sick'>Sick Leave</Option>
                                <Option value='personal'>Personal Leave</Option>
                            </Select>
                        </Col>
                        <Col xs={24} md={12}>
                            <Text strong>Requested Days</Text>
                            <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                                {requestedDays > 0 ? requestedDays : '-'}
                            </div>
                        </Col>
                    </Row>

                    <div>
                        <Text strong>Date Range *</Text>
                        <RangePicker
                            style={{ width: '100%', marginTop: 4 }}
                            value={dateRange}
                            onChange={val =>
                                setDateRange(val as [Dayjs | null, Dayjs | null])
                            }
                        />
                    </div>

                    <div>
                        <Text strong>Reason *</Text>
                        <TextArea
                            rows={3}
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder='Please provide a reason...'
                            style={{ marginTop: 4 }}
                        />
                    </div>

                    {selectedLeaveType && requestedDays > 0 && (
                        <Alert
                            type={
                                calculatedLeaveBalance[selectedLeaveType].used + requestedDays <=
                                    calculatedLeaveBalance[selectedLeaveType].total
                                    ? 'success'
                                    : 'error'
                            }
                            message={`Available: ${calculatedLeaveBalance[selectedLeaveType].total -
                                calculatedLeaveBalance[selectedLeaveType].used
                                } days | After request: ${calculatedLeaveBalance[selectedLeaveType].total -
                                calculatedLeaveBalance[selectedLeaveType].used -
                                requestedDays
                                } days`}
                        />
                    )}

                    <Button
                        type='primary'
                        block
                        icon={<PlusOutlined />}
                        onClick={handleSubmitLeave}
                        loading={submitting}
                        disabled={
                            !selectedLeaveType ||
                            !dateRange[0] ||
                            !dateRange[1] ||
                            !reason.trim()
                        }
                    >
                        Submit Leave Request
                    </Button>
                </Space>
            </Modal>

            {/* VIEW REQUEST MODAL */}
            <Modal
                title='Leave Request Details'
                open={viewModal.visible}
                onCancel={() => setViewModal({ visible: false, data: null })}
                footer={null}
                width={560}
                centered
            >
                {viewModal.data && (
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <div style={{ padding: 16, borderRadius: 12, background: '#f6faff', border: '1px solid #d6e4ff' }}>
                            <Row justify='space-between' align='middle' gutter={[12, 12]}>
                                <Col>
                                    <Text type='secondary'>Leave request</Text>
                                    <br />
                                    <Text strong style={{ fontSize: 18 }}>{getLeaveTypeLabel(viewModal.data.type)}</Text>
                                </Col>
                                <Col>{getStatusTag(viewModal.data.status)}</Col>
                            </Row>
                        </div>

                        <Row gutter={[12, 12]}>
                            <Col span={12}>
                                <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
                                    <Text type='secondary'>From</Text>
                                    <br />
                                    <Text strong>{formatLeaveDate(viewModal.data.from)}</Text>
                                </div>
                            </Col>
                            <Col span={12}>
                                <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
                                    <Text type='secondary'>To</Text>
                                    <br />
                                    <Text strong>{formatLeaveDate(viewModal.data.to)}</Text>
                                </div>
                            </Col>
                            <Col span={12}>
                                <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
                                    <Text type='secondary'>Requested days</Text>
                                    <br />
                                    <Text strong>{viewModal.data.days || 0} days</Text>
                                </div>
                            </Col>
                            <Col span={12}>
                                <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
                                    <Text type='secondary'>Applied</Text>
                                    <br />
                                    <Text strong>{formatLeaveDate(viewModal.data.appliedDate)}</Text>
                                </div>
                            </Col>
                        </Row>

                        <div style={{ padding: 14, borderRadius: 10, background: '#fafafa' }}>
                            <Text type='secondary'>Reason</Text>
                            <br />
                            <Text>{viewModal.data.reason || 'No reason provided.'}</Text>
                        </div>

                        {addedByAnotherPerson(viewModal.data) && (
                            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fffbe6', border: '1px solid #ffe58f' }}>
                                <Text type='secondary'>Added by</Text>
                                <br />
                                <Text strong>{addedByName || 'Loading…'}</Text>
                            </div>
                        )}

                        {String(viewModal.data.status || '').toLowerCase() === 'rejected' && (
                            <Alert
                                type='error'
                                showIcon
                                message='Request declined'
                                description={viewModal.data.rejectionReason || 'No rejection reason was provided.'}
                            />
                        )}
                    </Space>
                )}
            </Modal>

            {/* EDIT REQUEST MODAL */}
            <Modal
                title='Edit Leave Request'
                open={editModalOpen}
                onCancel={() => {
                    setEditModalOpen(false)
                    setEditingRequest(null)
                }}
                footer={null}
                width={680}
                centered
                destroyOnClose
            >
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                            <Text strong>Leave Type *</Text>
                            <Select
                                value={editLeaveType || undefined}
                                onChange={setEditLeaveType}
                                placeholder='Select leave type'
                                style={{ width: '100%', marginTop: 4 }}
                            >
                                <Option value='annual'>Annual Leave</Option>
                                <Option value='sick'>Sick Leave</Option>
                                <Option value='personal'>Personal Leave</Option>
                            </Select>
                        </Col>
                        <Col xs={24} md={12}>
                            <Text strong>Requested Days</Text>
                            <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                                {editRequestedDays > 0 ? editRequestedDays : '-'}
                            </div>
                        </Col>
                    </Row>

                    <div>
                        <Text strong>Date Range *</Text>
                        <RangePicker
                            style={{ width: '100%', marginTop: 4 }}
                            value={editDateRange}
                            onChange={val =>
                                setEditDateRange(val as [Dayjs | null, Dayjs | null])
                            }
                        />
                    </div>

                    <div>
                        <Text strong>Reason *</Text>
                        <TextArea
                            rows={3}
                            value={editReason}
                            onChange={e => setEditReason(e.target.value)}
                            placeholder='Please provide a reason...'
                            style={{ marginTop: 4 }}
                        />
                    </div>

                    {editLeaveType && editRequestedDays > 0 && (
                        <Alert
                            type={
                                editRequestedDays <= remainingForEdit(editLeaveType)
                                    ? 'success'
                                    : 'error'
                            }
                            message={`Available: ${remainingForEdit(editLeaveType)} days | After update: ${remainingForEdit(editLeaveType) - editRequestedDays
                                } days`}
                        />
                    )}

                    <Button
                        type='primary'
                        block
                        icon={<EditOutlined />}
                        onClick={handleUpdateLeave}
                        loading={editSubmitting}
                        disabled={
                            !editLeaveType ||
                            !editDateRange[0] ||
                            !editDateRange[1] ||
                            !editReason.trim()
                        }
                    >
                        Save Changes
                    </Button>
                </Space>
            </Modal>
        </div>
    )
}

export default EmployeeLeave
