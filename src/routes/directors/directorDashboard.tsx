import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Empty,
    Input,
    List,
    Modal,
    Progress,
    Row,
    Space,
    Tag,
    Typography,
    message
} from 'antd'
import {
    BarChartOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    CloseOutlined,
    FileTextOutlined,
    RiseOutlined,
    TeamOutlined,
    EyeOutlined
} from '@ant-design/icons'
import {
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Text, Title } = Typography

type DashboardInvoice = {
    id: string
    source: 'resourceRequests' | 'consolidatedMOVs'
    title?: string
    resourceName?: string
    department?: string
    departmentName?: string
    requestedBy?: string
    requesterName?: string
    createdBy?: string
    createdAt?: any
    invoiceFile?: string
    invoiceUrl?: string
    invoiceAttachment?: any
    invoiceAttachement?: any
    invoiceNumber?: string
    supplier?: string
    amount?: number
    description?: string
    demo?: boolean
    [key: string]: any
}

type DepartmentOverdueRow = {
    key: string
    department: string
    count: number
}

const DEMO_INVOICES: DashboardInvoice[] = [
    {
        id: 'demo-invoice-001',
        source: 'resourceRequests',
        resourceName: 'QMS Certification Support',
        departmentName: 'Training Academy',
        requestedBy: 'Nomsa Dlamini',
        supplier: 'Quality Systems Africa',
        invoiceNumber: 'QSA-INV-2084',
        amount: 48500,
        description: 'QMS certification training and assessment support for the current SME cohort.',
        createdAt: '2026-09-12T10:30:00+02:00',
        demo: true
    },
    {
        id: 'demo-invoice-002',
        source: 'consolidatedMOVs',
        title: 'Monthly Bookkeeping Intervention',
        departmentName: 'Financial Compliance',
        requestedBy: 'Thabo Molefe',
        supplier: 'Mahlangu Advisory Services',
        invoiceNumber: 'MAS-0914-44',
        amount: 32750,
        description: 'Monthly bookkeeping and financial compliance interventions completed for participating SMEs.',
        createdAt: '2026-09-11T14:10:00+02:00',
        demo: true
    },
    {
        id: 'demo-invoice-003',
        source: 'resourceRequests',
        resourceName: 'Marketing-in-a-Box Production',
        departmentName: 'Marketing and Communication',
        requestedBy: 'Kagiso Mokoena',
        supplier: 'Brandworks Studio',
        invoiceNumber: 'BWS-7781',
        amount: 61400,
        description: 'Design and production costs for SME marketing collateral and branded materials.',
        createdAt: '2026-09-10T09:20:00+02:00',
        demo: true
    },
    {
        id: 'demo-invoice-004',
        source: 'consolidatedMOVs',
        title: 'HSE Compliance Workshop',
        departmentName: 'HSE and Labour Compliance',
        requestedBy: 'Lerato Nkosi',
        supplier: 'SafeWork Consulting',
        invoiceNumber: 'SWC-2609-18',
        amount: 28900,
        description: 'HSE and labour compliance workshop delivery with supporting intervention evidence.',
        createdAt: '2026-09-09T16:45:00+02:00',
        demo: true
    }
]

const DEMO_DEPARTMENT_OVERDUE: DepartmentOverdueRow[] = [
    { key: 'hse', department: 'HSE and Labour Compliance', count: 7 },
    { key: 'training', department: 'Training Academy', count: 6 },
    { key: 'finance', department: 'Financial Compliance', count: 5 },
    { key: 'market', department: 'Market Linkages', count: 4 },
    { key: 'marketing', department: 'Marketing and Communication', count: 3 },
    { key: 'pds', department: 'Personal Development Services', count: 3 },
    { key: 'rom', department: 'ROM', count: 2 },
    { key: 'legal', department: 'Legal Advisory Services', count: 2 },
    { key: 'wellness', department: 'Wellness Services', count: 1 }
]

const tsToDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase()

const getInvoiceUrl = (item: DashboardInvoice): string | undefined => {
    const attachment = item.invoiceAttachment || item.invoiceAttachement

    return (
        item.invoiceFile ||
        item.invoiceUrl ||
        (typeof attachment === 'string' ? attachment : attachment?.url)
    )
}

const getInvoiceTitle = (item: DashboardInvoice) =>
    item.resourceName ||
    item.title ||
    item.departmentName ||
    item.department ||
    `Invoice ${item.id}`

const getRequestedBy = (item: DashboardInvoice) =>
    item.requestedBy || item.requesterName || item.createdBy || 'Unknown'

const getDepartmentName = (
    intervention: any,
    departmentNamesById: Record<string, string>
) => {
    return (
        intervention?.snapshot?.departmentName ||
        intervention?.departmentName ||
        departmentNamesById[String(intervention?.departmentId || '')] ||
        intervention?.department ||
        intervention?.assignedDepartment ||
        intervention?.areaOfSupport ||
        'Unknown Department'
    )
}

const getProgressPercentage = (intervention: any) => {
    const raw = intervention?.progress?.percentage ?? intervention?.progressPercentage ?? 0
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0
}

const formatCurrency = (value?: number) =>
    new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency: 'ZAR',
        maximumFractionDigits: 0
    }).format(Number(value || 0))

const sectionCardStyle: React.CSSProperties = {
    height: '100%',
    borderRadius: 14,
    border: '1px solid #e6efff',
    boxShadow: '0 12px 32px rgba(0,0,0,0.08)'
}

const metricCardStyle: React.CSSProperties = {
    minHeight: 112,
    padding: 20,
    borderRadius: 14,
    border: '1px solid #e6efff',
    background: '#fff',
    boxShadow: '0 12px 32px rgba(0,0,0,0.08)'
}

export const DirectorDashboard: React.FC = () => {
    const { user: currentUser } = useFullIdentity()

    const demoMode = useMemo(() => {
        if (typeof window === 'undefined') return false
        return new URLSearchParams(window.location.search).get('demo') === '1'
    }, [])

    const [loading, setLoading] = useState(true)
    const [programs, setPrograms] = useState<any[]>([])
    const [incubatees, setIncubatees] = useState<any[]>([])
    const [assignedInterventions, setAssignedInterventions] = useState<any[]>([])
    const [departmentOverdue, setDepartmentOverdue] = useState<DepartmentOverdueRow[]>([])
    const [invoicesNeedingApproval, setInvoicesNeedingApproval] = useState<DashboardInvoice[]>([])
    const [invoiceViewer, setInvoiceViewer] = useState<{
        open: boolean
        item?: DashboardInvoice
    }>({ open: false })

    useEffect(() => {
        const loadDashboard = async () => {
            if (demoMode) {
                setPrograms([
                    { id: 'demo-program-1', status: 'Active' },
                    { id: 'demo-program-2', status: 'Active' },
                    { id: 'demo-program-3', status: 'Active' }
                ])
                setIncubatees(
                    Array.from({ length: 42 }, (_, index) => ({
                        id: `demo-sme-${index + 1}`,
                        complianceRate: index % 5 === 0 ? 72 : 89
                    }))
                )
                setAssignedInterventions(
                    Array.from({ length: 56 }, (_, index) => ({
                        id: `demo-intervention-${index + 1}`,
                        progress: { percentage: 58 + (index % 35) }
                    }))
                )
                setDepartmentOverdue(DEMO_DEPARTMENT_OVERDUE)
                setInvoicesNeedingApproval(DEMO_INVOICES)
                setLoading(false)
                return
            }

            setLoading(true)

            try {
                const [
                    programSnap,
                    participantSnap,
                    departmentSnap,
                    interventionSnap,
                    resourceRequestSnap,
                    movSnap
                ] = await Promise.all([
                    getDocs(collection(db, 'programs')),
                    getDocs(
                        query(
                            collection(db, 'applications'),
                            where('applicationStatus', '==', 'accepted')
                        )
                    ),
                    getDocs(collection(db, 'departments')),
                    getDocs(collection(db, 'assignedInterventions')),
                    getDocs(
                        query(
                            collection(db, 'resourceRequests'),
                            where('status', '==', 'pending_ceo_approval')
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'consolidatedMOVs'),
                            where('status', '==', 'pending_ceo_approval')
                        )
                    )
                ])

                const nextPrograms = programSnap.docs.map(programDoc => ({
                    id: programDoc.id,
                    ...programDoc.data()
                }))

                const nextIncubatees = participantSnap.docs.map(participantDoc => {
                    const data = participantDoc.data() as any
                    const documents = Array.isArray(data.complianceDocuments)
                        ? data.complianceDocuments
                        : []
                    const validDocuments = documents.filter(
                        (item: any) => normalizeText(item?.status) === 'valid'
                    )
                    const complianceRate = Number.isFinite(Number(data.complianceRate))
                        ? Number(data.complianceRate)
                        : Math.round((validDocuments.length / 7) * 100)

                    return {
                        id: participantDoc.id,
                        ...data,
                        complianceRate
                    }
                })

                const departmentNamesById = departmentSnap.docs.reduce<Record<string, string>>(
                    (acc, departmentDoc) => {
                        const data = departmentDoc.data() as any
                        acc[departmentDoc.id] =
                            data.name || data.departmentName || data.title || 'Unnamed Department'
                        return acc
                    },
                    {}
                )

                const nextAssignedInterventions = interventionSnap.docs.map(interventionDoc => ({
                    id: interventionDoc.id,
                    ...interventionDoc.data()
                }))

                const overdueCounts = new Map<string, number>()

                Object.entries(departmentNamesById).forEach(([departmentId, name]) => {
                    overdueCounts.set(`${departmentId}:${name}`, 0)
                })

                const now = new Date()

                nextAssignedInterventions.forEach(intervention => {
                    const dueDate = tsToDate(intervention.dueDate)
                    const status = normalizeText(intervention.status)
                    const completionStatus = normalizeText(
                        intervention.completionStatus || intervention.assigneeCompletionStatus
                    )

                    const isComplete =
                        status === 'completed' ||
                        status === 'cancelled' ||
                        completionStatus === 'confirmed'

                    if (!dueDate || dueDate >= now || isComplete) return

                    const departmentName = getDepartmentName(intervention, departmentNamesById)
                    const departmentId = String(intervention.departmentId || departmentName)
                    const key = `${departmentId}:${departmentName}`

                    overdueCounts.set(key, (overdueCounts.get(key) || 0) + 1)
                })

                const nextDepartmentOverdue = Array.from(overdueCounts.entries())
                    .map(([key, count]) => ({
                        key,
                        department: key.split(':').slice(1).join(':') || 'Unknown Department',
                        count
                    }))
                    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department))

                const resourceRequests = resourceRequestSnap.docs.map(invoiceDoc => ({
                    id: invoiceDoc.id,
                    source: 'resourceRequests' as const,
                    ...invoiceDoc.data()
                }))

                const consolidatedMovInvoices = movSnap.docs
                    .map(invoiceDoc => ({
                        id: invoiceDoc.id,
                        source: 'consolidatedMOVs' as const,
                        ...invoiceDoc.data()
                    }))
                    .filter(item => Boolean(getInvoiceUrl(item)))

                const mergedInvoices = [...resourceRequests, ...consolidatedMovInvoices].sort(
                    (a, b) => {
                        const aTime = tsToDate(a.createdAt)?.getTime() || 0
                        const bTime = tsToDate(b.createdAt)?.getTime() || 0
                        return bTime - aTime
                    }
                )

                setPrograms(nextPrograms)
                setIncubatees(nextIncubatees)
                setAssignedInterventions(nextAssignedInterventions)
                setDepartmentOverdue(nextDepartmentOverdue)
                setInvoicesNeedingApproval(mergedInvoices)
            } catch (error) {
                console.error('Failed to load director dashboard:', error)
                message.error('Could not load the director dashboard.')
            } finally {
                setLoading(false)
            }
        }

        loadDashboard()
    }, [demoMode])

    const totalIncubatees = incubatees.length

    const activePrograms = useMemo(
        () =>
            programs.filter(program => {
                if (program?.isActive === true) return true
                return normalizeText(program?.status) === 'active'
            }).length,
        [programs]
    )

    const overallComplianceRate = useMemo(() => {
        if (!incubatees.length) return 0

        const total = incubatees.reduce(
            (sum, incubatee) => sum + Number(incubatee.complianceRate || 0),
            0
        )

        return Math.round(total / incubatees.length)
    }, [incubatees])

    const averageProgress = useMemo(() => {
        if (!assignedInterventions.length) return 0

        const total = assignedInterventions.reduce(
            (sum, intervention) => sum + getProgressPercentage(intervention),
            0
        )

        return Math.round(total / assignedInterventions.length)
    }, [assignedInterventions])

    const totalOverdue = useMemo(
        () => departmentOverdue.reduce((sum, item) => sum + item.count, 0),
        [departmentOverdue]
    )

    const maxDepartmentOverdue = useMemo(
        () => Math.max(1, ...departmentOverdue.map(item => item.count)),
        [departmentOverdue]
    )

    const removeInvoiceLocally = (item: DashboardInvoice) => {
        setInvoicesNeedingApproval(previous =>
            previous.filter(
                current => !(current.id === item.id && current.source === item.source)
            )
        )

        setInvoiceViewer(current =>
            current.item?.id === item.id && current.item?.source === item.source
                ? { open: false }
                : current
        )
    }

    const approveInvoice = async (item: DashboardInvoice) => {
        if (demoMode || item.demo) {
            removeInvoiceLocally(item)
            message.success('Demo invoice approved.')
            return
        }

        try {
            const approvedBy = currentUser?.email || currentUser?.uid || 'unknown'

            await updateDoc(doc(db, item.source, item.id), {
                status: 'invoice_approved',
                ceoApprovedAt: serverTimestamp(),
                ceoApprovedBy: approvedBy
            })

            removeInvoiceLocally(item)
            message.success('Invoice approved.')
        } catch (error) {
            console.error('Failed to approve invoice:', error)
            message.error('Failed to approve invoice.')
        }
    }

    const rejectInvoice = async (item: DashboardInvoice, reason: string) => {
        if (demoMode || item.demo) {
            removeInvoiceLocally(item)
            message.success('Demo invoice rejected.')
            return
        }

        try {
            const rejectedBy = currentUser?.email || currentUser?.uid || 'unknown'

            await updateDoc(doc(db, item.source, item.id), {
                status: 'invoice_rejected',
                ceoRejectedAt: serverTimestamp(),
                ceoRejectedBy: rejectedBy,
                ceoRejectReason: reason.trim()
            })

            removeInvoiceLocally(item)
            message.success('Invoice rejected.')
        } catch (error) {
            console.error('Failed to reject invoice:', error)
            message.error('Failed to reject invoice.')
        }
    }

    const promptReject = (item: DashboardInvoice) => {
        let reason = ''

        Modal.confirm({
            title: 'Reject invoice',
            content: (
                <Input.TextArea
                    rows={3}
                    placeholder='Reason for rejection'
                    onChange={event => {
                        reason = event.target.value
                    }}
                />
            ),
            okText: 'Reject invoice',
            okButtonProps: { danger: true, shape: 'round' },
            cancelButtonProps: { shape: 'round' },
            cancelText: 'Cancel',
            onOk: () => rejectInvoice(item, reason)
        })
    }

    const renderDemoInvoicePreview = (item: DashboardInvoice) => (
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <div
                style={{
                    padding: 24,
                    border: '1px solid #e8e8e8',
                    borderRadius: 14,
                    background: '#fff'
                }}
            >
                <Row justify='space-between' align='top' gutter={[16, 16]}>
                    <Col>
                        <Title level={4} style={{ margin: 0 }}>
                            Invoice
                        </Title>
                        <Text type='secondary'>{item.invoiceNumber}</Text>
                    </Col>
                    <Col>
                        <Tag color='gold'>Awaiting Director Approval</Tag>
                    </Col>
                </Row>

                <div style={{ marginTop: 28 }}>
                    <Text type='secondary'>Supplier</Text>
                    <div>
                        <Text strong>{item.supplier || 'Demo Supplier'}</Text>
                    </div>
                </div>

                <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
                    <Col xs={24} sm={12}>
                        <Text type='secondary'>Department</Text>
                        <div>
                            <Text strong>{item.departmentName || item.department || 'Unknown'}</Text>
                        </div>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Text type='secondary'>Requested by</Text>
                        <div>
                            <Text strong>{getRequestedBy(item)}</Text>
                        </div>
                    </Col>
                </Row>

                <div
                    style={{
                        marginTop: 24,
                        padding: 18,
                        borderRadius: 12,
                        background: '#fafafa',
                        border: '1px solid #f0f0f0'
                    }}
                >
                    <Text type='secondary'>Description</Text>
                    <div style={{ marginTop: 4 }}>
                        <Text>{item.description || getInvoiceTitle(item)}</Text>
                    </div>
                </div>

                <Row justify='space-between' align='bottom' style={{ marginTop: 28 }}>
                    <Col>
                        <Text type='secondary'>Submitted</Text>
                        <div>
                            <Text strong>
                                {item.createdAt
                                    ? dayjs(tsToDate(item.createdAt)).format('DD MMM YYYY, HH:mm')
                                    : 'Not available'}
                            </Text>
                        </div>
                    </Col>
                    <Col style={{ textAlign: 'right' }}>
                        <Text type='secondary'>Total</Text>
                        <Title level={3} style={{ margin: 0 }}>
                            {formatCurrency(item.amount)}
                        </Title>
                    </Col>
                </Row>
            </div>
        </div>
    )

    return (
        <>
            <Helmet>
                <title>Director Dashboard | Incubation Platform</title>
            </Helmet>

            <div style={{ padding: 24, minHeight: '100vh' }}>
                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            loading={loading}
                            icon={<TeamOutlined />}
                            iconBg='rgba(22,119,255,.12)'
                            title='Total SMEs'
                            value={totalIncubatees}
                            subtitle='Accepted into programmes'
                        />
                    </Col>

                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            loading={loading}
                            icon={<BarChartOutlined />}
                            iconBg='rgba(82,196,26,.12)'
                            title='Active Programmes'
                            value={activePrograms}
                            subtitle='Currently running'
                        />
                    </Col>

                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            loading={loading}
                            icon={<CheckCircleOutlined />}
                            iconBg='rgba(19,194,194,.12)'
                            title='Compliance Rate'
                            value={`${overallComplianceRate}%`}
                            subtitle='Average across SMEs'
                        />
                    </Col>

                    <Col xs={24} sm={12} xl={6}>
                        <MotionCard.Metric
                            loading={loading}
                            icon={<RiseOutlined />}
                            iconBg='rgba(114,46,209,.12)'
                            title='Average Progress'
                            value={`${averageProgress}%`}
                            subtitle='Across assigned interventions'
                        />
                    </Col>
                </Row>

                <Row gutter={[16, 16]}>
                    <Col xs={24} xl={11}>
                        <MotionCard
                            title={
                                <Space size={8}>
                                    <BarChartOutlined />
                                    <span>Overdue Interventions by Department</span>
                                </Space>
                            }
                            extra={
                                <Space size={6}>
                                    <Text type='secondary'>Total overdue</Text>
                                    <Tag color={totalOverdue > 0 ? 'red' : 'green'}>
                                        {totalOverdue}
                                    </Tag>
                                </Space>
                            }
                            loading={loading}
                            style={sectionCardStyle}
                        >
                            {departmentOverdue.length === 0 ? (
                                <Empty description='No department data available' />
                            ) : (
                                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                                    {departmentOverdue.map(item => {
                                        const relativePercent = Math.round(
                                            (item.count / maxDepartmentOverdue) * 100
                                        )

                                        return (
                                            <div key={item.key} style={{ width: '100%' }}>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        gap: 12,
                                                        marginBottom: 6
                                                    }}
                                                >
                                                    <Text
                                                        ellipsis={{ tooltip: item.department }}
                                                        style={{ minWidth: 0, flex: 1 }}
                                                    >
                                                        {item.department}
                                                    </Text>
                                                    <Text strong>{item.count}</Text>
                                                </div>
                                                <Progress
                                                    percent={relativePercent}
                                                    showInfo={false}
                                                    size='small'
                                                    status={item.count > 0 ? 'exception' : 'success'}
                                                />
                                            </div>
                                        )
                                    })}
                                </Space>
                            )}

                            <Text
                                type='secondary'
                                style={{ display: 'block', marginTop: 16, fontSize: 12 }}
                            >
                                Bar length is relative to the department with the highest overdue count.
                            </Text>
                        </MotionCard>
                    </Col>

                    <Col xs={24} xl={13}>
                        <MotionCard
                            title={
                                <Space size={8}>
                                    <FileTextOutlined />
                                    <span>Invoices Awaiting Approval</span>
                                </Space>
                            }
                            extra={<Tag color='gold'>{invoicesNeedingApproval.length} pending</Tag>}
                            loading={loading}
                            style={sectionCardStyle}
                        >
                            <List
                                dataSource={invoicesNeedingApproval}
                                locale={{ emptyText: 'No invoices awaiting approval' }}
                                pagination={
                                    invoicesNeedingApproval.length > 5
                                        ? {
                                            pageSize: 5,
                                            showSizeChanger: false,
                                            position: 'bottom',
                                            align: 'center'
                                        }
                                        : false
                                }
                                renderItem={item => {
                                    const url = getInvoiceUrl(item)
                                    const department =
                                        item.departmentName || item.department || 'Department not set'

                                    return (
                                        <List.Item
                                            style={{
                                                paddingInline: 0,
                                                alignItems: 'center',
                                                gap: 16
                                            }}
                                            actions={[
                                                <Button
                                                    shape='round'
                                                    key='view'
                                                    size='small'
                                                    icon={<EyeOutlined />}
                                                    onClick={() => {
                                                        if (!item.demo && !url) {
                                                            message.warning('No invoice attachment is available.')
                                                            return
                                                        }
                                                        setInvoiceViewer({ open: true, item })
                                                    }}
                                                >
                                                    View
                                                </Button>,
                                                <Button
                                                    shape='round'
                                                    key='approve'
                                                    size='small'
                                                    type='primary'
                                                    icon={<CheckOutlined />}
                                                    onClick={() => approveInvoice(item)}
                                                >
                                                    Approve
                                                </Button>,
                                                <Button
                                                    shape='round'
                                                    key='reject'
                                                    size='small'
                                                    danger
                                                    icon={<CloseOutlined />}
                                                    onClick={() => promptReject(item)}
                                                >
                                                    Reject
                                                </Button>
                                            ]}
                                        >
                                            <List.Item.Meta
                                                title={
                                                    <Space size={8} wrap>
                                                        <Text strong>{getInvoiceTitle(item)}</Text>
                                                        <Tag
                                                            color={
                                                                item.source === 'resourceRequests'
                                                                    ? 'blue'
                                                                    : 'purple'
                                                            }
                                                        >
                                                            {item.source === 'resourceRequests'
                                                                ? 'Resource Request'
                                                                : 'MOV'}
                                                        </Tag>
                                                    </Space>
                                                }
                                                description={
                                                    <Space size={[8, 4]} wrap>
                                                        <Text type='secondary'>{department}</Text>
                                                        <Text type='secondary'>•</Text>
                                                        <Text type='secondary'>
                                                            Requested by {getRequestedBy(item)}
                                                        </Text>
                                                        {item.amount ? (
                                                            <>
                                                                <Text type='secondary'>•</Text>
                                                                <Text strong>{formatCurrency(item.amount)}</Text>
                                                            </>
                                                        ) : null}
                                                    </Space>
                                                }
                                            />
                                        </List.Item>
                                    )
                                }}
                            />
                        </MotionCard>
                    </Col>
                </Row>
            </div>

            <Modal
                title={invoiceViewer.item ? getInvoiceTitle(invoiceViewer.item) : 'Invoice'}
                open={invoiceViewer.open}
                onCancel={() => setInvoiceViewer({ open: false })}
                width={900}
                centered
                destroyOnHidden
                styles={{
                    body: {
                        maxHeight: '72vh',
                        overflowY: 'auto'
                    },
                    footer: {
                        marginTop: 18
                    }
                }}
                footer={
                    invoiceViewer.item ? (
                        <Row gutter={12}>
                            <Col span={12}>
                                <Button
                                    shape='round'
                                    danger
                                    block
                                    size='large'
                                    icon={<CloseOutlined />}
                                    onClick={() =>
                                        promptReject(invoiceViewer.item as DashboardInvoice)
                                    }
                                >
                                    Reject
                                </Button>
                            </Col>

                            <Col span={12}>
                                <Button
                                    shape='round'
                                    type='primary'
                                    block
                                    size='large'
                                    icon={<CheckOutlined />}
                                    onClick={() =>
                                        approveInvoice(invoiceViewer.item as DashboardInvoice)
                                    }
                                >
                                    Approve
                                </Button>
                            </Col>
                        </Row>
                    ) : null
                }
            >
                {invoiceViewer.item ? (
                    invoiceViewer.item.demo ? (
                        renderDemoInvoicePreview(invoiceViewer.item)
                    ) : getInvoiceUrl(invoiceViewer.item) ? (
                        <iframe
                            title='Invoice preview'
                            src={getInvoiceUrl(invoiceViewer.item)}
                            style={{
                                width: '100%',
                                height: '62vh',
                                border: 0,
                                borderRadius: 10
                            }}
                        />
                    ) : (
                        <Empty description='No invoice attachment available' />
                    )
                ) : (
                    <Empty description='No invoice selected' />
                )}
            </Modal>
        </>
    )
}
