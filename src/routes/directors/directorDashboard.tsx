import React, { useState } from 'react'
import {
    Card,
    Row,
    Col,
    Statistic,
    Typography,
    List,
    Tag,
    Space,
    Tabs,
    Progress,
    Button,
    Table,
    Avatar,
    Drawer,
    message,
    Spin,
    Input,
    Modal,
    Empty
} from 'antd'
import {
    BarChartOutlined,
    TeamOutlined,
    RiseOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    WarningOutlined,
    DollarOutlined,
    FundOutlined,
    PieChartOutlined,
    ProjectOutlined,
    FileTextOutlined,
    CloseCircleOutlined,
    CalendarOutlined,
    ApartmentOutlined,
    BellOutlined,
    AreaChartOutlined
} from '@ant-design/icons'
import { useEffect } from 'react'
// Collection-aware approve/reject updaters
import {
    addDoc,
    collection,
    getDocs,
    query,
    where,
    doc,
    updateDoc
} from 'firebase/firestore'
import { db } from '@/firebase'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import SectorAnalysis from '@/components/dashboards/director/charts/SectorAnalysis'
import PortfolioCompanies from '@/components/dashboards/director/charts/PortfolioCompanies'

const { Title, Text, Paragraph } = Typography
const { TabPane } = Tabs

const sampleFinancialData = [
    {
        category: 'Project Management',
        allocated: 120000,
        spent: 95000,
        remaining: 25000
    },
    {
        category: 'Facilities',
        allocated: 200000,
        spent: 170000,
        remaining: 30000
    },
    {
        category: 'Program Marketing',
        allocated: 80000,
        spent: 65000,
        remaining: 15000
    },
    { category: 'Events', allocated: 50000, spent: 42000, remaining: 8000 },
    {
        category: 'Technology',
        allocated: 150000,
        spent: 110000,
        remaining: 40000
    },
    {
        category: 'General Admin',
        allocated: 180000,
        spent: 160000,
        remaining: 20000
    }
]

const sampleKPIData = [
    {
        metric: 'Revenue Growth',
        target: 25,
        actual: 32,
        unit: '%',
        status: 'Exceeding'
    },
    {
        metric: 'Funding Secured',
        target: 5000000,
        actual: 4200000,
        unit: '$',
        status: 'On Track'
    },
    {
        metric: 'Job Creation',
        target: 120,
        actual: 97,
        unit: 'jobs',
        status: 'At Risk'
    },
    {
        metric: 'Market Expansion',
        target: 3,
        actual: 4,
        unit: 'markets',
        status: 'Exceeding'
    },
    {
        metric: 'Product Launches',
        target: 12,
        actual: 10,
        unit: 'products',
        status: 'On Track'
    }
]

const sampleResourcesData = [
    { resource: 'Mentors', allocated: 45, utilized: 38, utilization: 84 },
    { resource: 'Meeting Rooms', allocated: 8, utilized: 7, utilization: 92 },
    { resource: 'Event Spaces', allocated: 3, utilized: 2, utilization: 65 },
    { resource: 'Lab Equipment', allocated: 12, utilized: 8, utilization: 72 },
    {
        resource: 'Software Licenses',
        allocated: 200,
        utilized: 185,
        utilization: 93
    }
]

const sampleAnalytics = {
    totalIncubatees: 35,
    activeProjects: 28,
    complianceRate: 84,
    averageProgress: 72,
    pendingApprovals: 7,
    upcomingDeadlines: 12,
    successRate: 76,
    avgFundingSecured: 850000,
    activeMentors: 42,
    resourceUtilization: 78,
    totalBudget: 1500000,
    budgetUtilized: 1150000,
    roi: 2.4
}

// Sample portfolio data
const samplePortfolioData = [
    {
        id: 1,
        name: 'TechInnovate',
        sector: 'FinTech',
        stage: 'Growth',
        valuation: 4500000,
        investment: 750000,
        progress: 72,
        metrics: {
            revenue: 1200000,
            customers: 5800,
            employees: 32,
            growthRate: 68
        },
        status: 'Active',
        risk: 'Low'
    },
    {
        id: 2,
        name: 'GreenSolutions',
        sector: 'CleanEnergy',
        stage: 'Early Growth',
        valuation: 2800000,
        investment: 500000,
        progress: 56,
        metrics: {
            revenue: 840000,
            customers: 1200,
            employees: 18,
            growthRate: 42
        },
        status: 'Active',
        risk: 'Medium'
    },
    {
        id: 3,
        name: 'HealthPlus',
        sector: 'HealthTech',
        stage: 'Seed',
        valuation: 1200000,
        investment: 300000,
        progress: 45,
        metrics: {
            revenue: 320000,
            customers: 1500,
            employees: 12,
            growthRate: 85
        },
        status: 'Warning',
        risk: 'High'
    },
    {
        id: 4,
        name: 'EduConnect',
        sector: 'EdTech',
        stage: 'Growth',
        valuation: 3800000,
        investment: 650000,
        progress: 81,
        metrics: {
            revenue: 950000,
            customers: 8500,
            employees: 27,
            growthRate: 74
        },
        status: 'Active',
        risk: 'Low'
    },
    {
        id: 5,
        name: 'AgriTech Systems',
        sector: 'Agriculture',
        stage: 'Seed',
        valuation: 950000,
        investment: 250000,
        progress: 38,
        metrics: {
            revenue: 180000,
            customers: 450,
            employees: 8,
            growthRate: 28
        },
        status: 'Warning',
        risk: 'High'
    }
]

const sampleSectorData = [
    {
        sector: 'FinTech',
        companies: 8,
        totalInvestment: 3200000,
        averageValuation: 4100000,
        performance: 72
    },
    {
        sector: 'HealthTech',
        companies: 6,
        totalInvestment: 2400000,
        averageValuation: 2800000,
        performance: 65
    },
    {
        sector: 'CleanEnergy',
        companies: 5,
        totalInvestment: 2100000,
        averageValuation: 3100000,
        performance: 58
    },
    {
        sector: 'EdTech',
        companies: 7,
        totalInvestment: 2800000,
        averageValuation: 3600000,
        performance: 81
    },
    {
        sector: 'Agriculture',
        companies: 4,
        totalInvestment: 1500000,
        averageValuation: 1200000,
        performance: 42
    },
    {
        sector: 'E-commerce',
        companies: 5,
        totalInvestment: 1900000,
        averageValuation: 2500000,
        performance: 63
    }
]


const tsToDate = (ts: any): Date | null => {
    // Firestore Timestamp or already a Date
    if (!ts) return null
    if (typeof ts?.toDate === 'function') return ts.toDate()
    if (ts instanceof Date) return ts
    return null
}

const pickDepartment = (i: any): string =>
    i?.department || i?.assignedDepartment || i?.areaOfSupport || 'Unknown'

export const DirectorDashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState('overview')
    const [programs, setPrograms] = useState<any[]>([])
    const [incubatees, setIncubatees] = useState<any[]>([])
    const [invoicesNeedingApproval, setInvoicesNeedingApproval] = useState<any[]>(
        []
    )
    const [invoiceViewer, setInvoiceViewer] = useState<{
        open: boolean
        url?: string
        title?: string
    }>({ open: false })

    const [complianceRecords, setComplianceRecords] = useState<any[]>([])
    const [drawerVisible, setDrawerVisible] = useState(false)
    const [drawerContent, setDrawerContent] = useState<React.ReactNode>(null)
    const [notifications, setNotifications] = useState<any[]>([])
    const [notificationDrawerVisible, setNotificationDrawerVisible] =
        useState(false)
    const [overdueInterventions, setOverdueInterventions] = useState<any[]>([])
    const [pendingApplications, setPendingApplications] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const { user: currentUser } = useFullIdentity()
    const [requestsNeedingCEOApproval, setRequestsNeedingCEOApproval] = useState<
        any[]
    >([])

    useEffect(() => {
        if (!currentUser?.email) return

        const fetchInvoicesNeedingApproval = async () => {
            try {
                // 1) resourceRequests with status pending_ceo_approval
                const rrSnap = await getDocs(
                    query(
                        collection(db, 'resourceRequests'),

                        where('status', '==', 'pending_ceo_approval')
                    )
                )
                const rr = rrSnap.docs.map(d => ({
                    id: d.id,
                    source: 'resourceRequests',
                    ...d.data()
                }))

                // 2) consolidatedMOVs with same status AND has invoiceAttachment (or invoiceAttachement)
                const movSnap = await getDocs(
                    query(
                        collection(db, 'consolidatedMOVs'),

                        where('status', '==', 'pending_ceo_approval')
                    )
                )
                const movAll = movSnap.docs.map(d => ({
                    id: d.id,
                    source: 'consolidatedMOVs',
                    ...d.data()
                }))

                const movWithInvoice = movAll.filter(m =>
                    Boolean(m.invoiceAttachment || m.invoiceAttachement)
                )

                // Merge & sort (optional: newest first if you have createdAt)
                const merged = [...rr, ...movWithInvoice].sort((a, b) => {
                    const aTime = tsToDate(a.createdAt)?.getTime() || 0
                    const bTime = tsToDate(b.createdAt)?.getTime() || 0
                    return bTime - aTime
                })

                setInvoicesNeedingApproval(merged)
            } catch (err) {
                console.error('Failed to fetch invoices needing approval:', err)
            }
        }

        fetchInvoicesNeedingApproval()
    }, [currentUser])

    // PROGRAMS
    useEffect(() => {

        const fetchPrograms = async () => {
            const q = query(
                collection(db, 'programs')
            )
            const programSnap = await getDocs(q)
            setPrograms(programSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })))
        }
        fetchPrograms()
    }, [])

    // PARTICIPANTS
    useEffect(() => {
        const fetchParticipants = async () => {
            const q = query(
                collection(db, 'applications'),
                where('applicationStatus', '==', 'accepted'),
            )
            const participantSnap = await getDocs(q)
            setIncubatees(
                participantSnap.docs.map(doc => {
                    const data = doc.data()
                    const docs = data.complianceDocuments || []
                    const validDocs = docs.filter(doc => doc.status === 'valid')
                    const totalTypes = 7
                    const complianceRate = Math.round(
                        (validDocs.length / totalTypes) * 100
                    )
                    return {
                        id: doc.id,
                        ...data,
                        complianceRate
                    }
                })
            )
        }
        fetchParticipants()
    }, [])

    // Load notifications on mount
    useEffect(() => {
        if (!currentUser?.uid) return
        const fetchNotifications = async () => {
            const q = query(
                collection(db, 'notifications'),
                where('recipientIds', 'array-contains', currentUser.uid)
            )
            const snapshot = await getDocs(q)
            setNotifications(
                snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            )
        }
        fetchNotifications()
    }, [currentUser])

    useEffect(() => {
        const fetchApplications = async () => {
            setLoading(true)
            try {
                const applicationSnap = await getDocs(collection(db, 'applications'))

                const now = dayjs()

                const pendingApps = applicationSnap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(app => app.applicationStatus?.toLowerCase() === 'pending')

                setPendingApplications(pendingApps)
                setPendingApplications(pendingApps)
            } catch (err) {
                console.error('Failed to fetch overview data:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchApplications()
    }, [])

    useEffect(() => {
        const fetchOverdueInterventions = async () => {
            setLoading(true)
            try {
                const email = currentUser?.email
                if (!email) return


                // 1) Get consultant ids for this company (fallback to empty)
                const consultantSnap = await getDocs(
                    query(
                        collection(db, 'coordinators'),

                    )
                )
                const consultantIds = consultantSnap.docs.map(d => d.id)

                // 3) Pull assignedInterventions
                const aiSnap = await getDocs(collection(db, 'assignedInterventions'))
                const all = aiSnap.docs.map(d => ({ id: d.id, ...d.data() }))

                const now = new Date()
                const overdue = all
                    .filter(i => {
                        // consultant/company filter
                        const belongsToCompany = i.assigneeId && consultantIds.includes(i.assigneeId)

                        const due = tsToDate(i.dueDate)
                        const notDone = i.assigneeCompletionStatus !== 'completed'
                        return belongsToCompany && !!due && due < now && notDone
                    })
                    .map(i => ({
                        ...i,
                        department: pickDepartment(i) // <- enrich
                    }))

                setOverdueInterventions(overdue)
            } catch (err) {
                console.error('Failed to fetch overdue interventions:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchOverdueInterventions()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Safely pick an invoice URL from either collection shape
    const getInvoiceUrl = (item: any): string | undefined => {
        return (
            item.invoiceFile || // resourceRequests
            item.invoiceUrl || // fallback
            item?.invoiceAttachment?.url || // consolidatedMOVs
            item?.invoiceAttachement?.url // misspelling safeguard
        )
    }

    const approveInvoice = async (item: any) => {
        try {
            const by = currentUser?.email || 'unknown'
            const now = new Date()

            if (item.source === 'resourceRequests') {
                await updateDoc(doc(db, 'resourceRequests', item.id), {
                    status: 'invoice_approved',
                    ceoApprovedAt: now,
                    ceoApprovedBy: by
                })
            } else if (item.source === 'consolidatedMOVs') {
                await updateDoc(doc(db, 'consolidatedMOVs', item.id), {
                    status: 'invoice_approved',
                    ceoApprovedAt: now,
                    ceoApprovedBy: by
                })
            }

            message.success('Invoice approved.')
            // remove from local list
            setInvoicesNeedingApproval(prev => prev.filter(x => x.id !== item.id))
        } catch (e) {
            console.error(e)
            message.error('Failed to approve invoice.')
        }
    }

    const rejectInvoice = async (item: any, reason: string) => {
        try {
            const by = currentUser?.email || 'unknown'
            const now = new Date()

            if (item.source === 'resourceRequests') {
                await updateDoc(doc(db, 'resourceRequests', item.id), {
                    status: 'invoice_rejected',
                    ceoRejectedAt: now,
                    ceoRejectedBy: by,
                    ceoRejectReason: reason || ''
                })
            } else if (item.source === 'consolidatedMOVs') {
                await updateDoc(doc(db, 'consolidatedMOVs', item.id), {
                    status: 'invoice_rejected',
                    ceoRejectedAt: now,
                    ceoRejectedBy: by,
                    ceoRejectReason: reason || ''
                })
            }

            message.success('Invoice rejected.')
            setInvoicesNeedingApproval(prev => prev.filter(x => x.id !== item.id))
        } catch (e) {
            console.error(e)
            message.error('Failed to reject invoice.')
        }
    }

    const promptReject = (item: any) => {
        let input = ''
        const modal = Modal.confirm({
            title: 'Reject Invoice',
            content: (
                <Input.TextArea
                    rows={3}
                    placeholder='Reason (optional)'
                    onChange={e => (input = e.target.value)}
                />
            ),
            okText: 'Reject',
            okButtonProps: { danger: true },
            onOk: () => rejectInvoice(item, input)
        })
    }

    const getRelevantOpsUsers = async () => {
        const opsSnap = await getDocs(
            query(
                collection(db, 'users'),
                where('role', '==', 'operations'),
            )
        )
        return opsSnap.docs.map(doc => doc.id) // these are user IDs
    }

    const getOverallComplianceRate = () => {
        if (incubatees.length === 0) return 0
        const total = incubatees.reduce(
            (sum, p) => sum + (p.complianceRate || 0),
            0
        )
        return Math.round(total / incubatees.length)
    }

    const getComplianceRate = (participant: any): number => {
        const docs = participant.complianceDocuments || []
        const totalRequired = 7 // adjust to match your required doc count
        const validDocs = docs.filter(doc => doc.status === 'valid')
        return Math.round((validDocs.length / totalRequired) * 100)
    }

    const sendNotification = async (payload: any) => {
        console.log('[🔔 Sending Notification]', payload) // ✅ Add this

        try {
            await addDoc(collection(db, 'notifications'), {
                ...payload,
                createdAt: new Date(),
                readBy: {}
            })
            message.success('Reminder sent.')
        } catch (err) {
            console.error('[❌ Failed to send notification]', err)
            message.error('Could not send notification.')
        }
    }

    const remindUser = (intervention: any) => {
        if (!intervention.assignedRole || !intervention.assignedTo) {
            console.warn('[⚠️ Missing assignment info] intervention:', intervention)
            return message.warning(
                'intervention must have an assigned user and role.'
            )
        }

        const isOverdue = dayjs(intervention.dueDate.toDate()).isBefore(
            dayjs(),
            'day'
        )
        const formattedDate = dayjs(intervention.dueDate.toDate()).format(
            'YYYY-MM-DD'
        )

        const role = intervention.assignedRole
        const messageText = isOverdue
            ? `🚨 Your intervention "${intervention.title}" is OVERDUE (was due ${formattedDate}). Please take action.`
            : `⏳ Reminder: Your intervention "${intervention.title}" is due on ${formattedDate}.`

        sendNotification({
            message: {
                [role]: messageText
            },
            recipientRoles: [role],
            recipientIds: [intervention.assignedTo]
        })
    }

    const overallCompliance = () => {
        if (!complianceRecords.length) return 0
        const avg =
            complianceRecords.reduce((acc, r) => acc + (r.complianceRate || 0), 0) /
            complianceRecords.length
        return Math.round(avg)
    }

    // Format currency values
    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value)
    }

    // Main Dashboard Overview
    const renderDashboardOverview = () => {
        return (
            <>
                <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
                    <Col xs={24} sm={12} md={8} lg={6}>
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Total Incubatees'
                                value={incubatees.length}
                                prefix={<TeamOutlined />}
                            />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} md={8} lg={6}>
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Active Programs'
                                value={programs.filter(p => p.status === 'Active').length}
                                prefix={<BarChartOutlined />}
                                valueStyle={{ color: '#3f8600' }}
                            />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} md={8} lg={6}>
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Compliance Rate'
                                value={overallCompliance()}
                                suffix='%'
                                prefix={<CheckCircleOutlined />}
                                valueStyle={{
                                    color: overallCompliance() > 80 ? '#3f8600' : '#cf1322'
                                }}
                            />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} md={8} lg={6}>
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Average Progress'
                                value={sampleAnalytics.averageProgress}
                                suffix='%'
                                prefix={<RiseOutlined />}
                            />
                        </Card>
                    </Col>
                </Row>
                <Spin spinning={loading}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                            <Card
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    transition: 'all 0.3s ease',
                                    borderRadius: 12,
                                    border: '1px solid #d6e4ff'
                                }}
                                title='🔴 Overdue Interventions'
                            >
                                <List
                                    dataSource={overdueInterventions}
                                    locale={{ emptyText: 'No overdue interventions 🎉' }}
                                    pagination={{
                                        pageSize: 5,
                                        responsive: true,
                                        showSizeChanger: false
                                    }}
                                    renderItem={(item: any) => (
                                        <List.Item
                                            style={{
                                                display: 'flex',
                                                flexWrap: 'wrap', // ✅ ensures responsiveness on small screens
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <div style={{ flex: 1, minWidth: 200 }}>
                                                <Text strong>
                                                    {item.interventionTitle ||
                                                        item.title ||
                                                        'Untitled Intervention'}
                                                </Text>
                                                <br />
                                                <Text type='secondary'>
                                                    Due:{' '}
                                                    {tsToDate(item.dueDate)
                                                        ? dayjs(tsToDate(item.dueDate)!).format(
                                                            'YYYY-MM-DD'
                                                        )
                                                        : 'Unknown'}
                                                </Text>
                                            </div>

                                            <Space wrap style={{ marginTop: 8 }}>
                                                <Tag color='red'>Overdue</Tag>
                                                {item.beneficiaryName && (
                                                    <Tag>{item.beneficiaryName}</Tag>
                                                )}
                                                <Tag color='geekblue'>{pickDepartment(item)}</Tag>
                                            </Space>
                                        </List.Item>
                                    )}
                                />
                            </Card>
                        </Col>

                        <Col xs={24} md={12}>
                            <Card
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    transition: 'all 0.3s ease',
                                    borderRadius: 12,
                                    border: '1px solid #d6e4ff'
                                }}
                                title='🧾 Invoices Needing Approval'
                            >
                                <List
                                    dataSource={invoicesNeedingApproval}
                                    locale={{ emptyText: 'No invoices awaiting CEO approval 🎉' }}
                                    pagination={{
                                        pageSize: 5,
                                        responsive: true,
                                        showSizeChanger: false
                                    }}
                                    renderItem={(item: any) => {
                                        const hasAttachment = Boolean(
                                            item.invoiceAttachment || item.invoiceAttachement
                                        )

                                        const url =
                                            item.invoiceFile ||
                                            item.invoiceUrl ||
                                            item?.invoiceAttachment?.url ||
                                            item?.invoiceAttachement?.url

                                        const primary =
                                            item.resourceName ||
                                            item.title ||
                                            item.department ||
                                            `Invoice ${item.id}`

                                        const requestedBy =
                                            item.requestedBy ||
                                            item.requesterName ||
                                            item.createdBy ||
                                            'Unknown'

                                        return (
                                            <List.Item
                                                style={{
                                                    display: 'flex',
                                                    flexWrap: 'wrap',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}
                                            >
                                                {/* LEFT SIDE: Text */}
                                                <div style={{ flex: 1, minWidth: 220 }}>
                                                    <Text strong>{primary}</Text>
                                                    <br />
                                                    <Text type='secondary'>
                                                        Requested By: {requestedBy}
                                                    </Text>
                                                </div>

                                                {/* RIGHT SIDE: Tags + Buttons */}
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'flex-end',
                                                        gap: 8,
                                                        minWidth: 240
                                                    }}
                                                >
                                                    <Space wrap>
                                                        <Tag color='volcano'>Awaiting Approval</Tag>
                                                        <Tag
                                                            color={
                                                                item.source === 'resourceRequests'
                                                                    ? 'blue'
                                                                    : 'purple'
                                                            }
                                                        >
                                                            {item.source === 'resourceRequests'
                                                                ? 'Resource'
                                                                : 'MOV'}
                                                        </Tag>
                                                        <Tag color={hasAttachment ? 'green' : 'red'}>
                                                            {hasAttachment
                                                                ? 'Invoice Attached'
                                                                : 'Missing Invoice'}
                                                        </Tag>
                                                    </Space>

                                                    <Space>
                                                        <Button
                                                            key='view'
                                                            type='link'
                                                            onClick={() => {
                                                                if (!url)
                                                                    return message.warning('No invoice attached.')
                                                                setInvoiceViewer({
                                                                    open: true,
                                                                    url,
                                                                    title: primary
                                                                })
                                                            }}
                                                        >
                                                            View
                                                        </Button>
                                                        <Button
                                                            key='approve'
                                                            type='primary'
                                                            onClick={() => approveInvoice(item)}
                                                        >
                                                            Approve
                                                        </Button>
                                                        <Button
                                                            key='reject'
                                                            danger
                                                            onClick={() => promptReject(item)}
                                                        >
                                                            Reject
                                                        </Button>
                                                    </Space>
                                                </div>
                                            </List.Item>
                                        )
                                    }}
                                />
                            </Card>
                        </Col>
                    </Row>
                </Spin>
            </>
        )
    }

    return (
        <>
            <Helmet>
                <title>Director Dashboard | Incubation Platform</title>
            </Helmet>
            <div style={{ padding: '24px', minHeight: '100vh' }}>
                {renderDashboardOverview()}
            </div>
            <Drawer
                title='Director Notifications'
                placement='right'
                width={400}
                onClose={() => setNotificationDrawerVisible(false)}
                open={notificationDrawerVisible}
            >
                <List
                    itemLayout='horizontal'
                    dataSource={notifications}
                    renderItem={item => (
                        <List.Item>
                            <List.Item.Meta
                                title={item.message?.director || 'Untitled'}
                                description={new Date(
                                    item.createdAt?.seconds * 1000
                                ).toLocaleString()}
                            />
                        </List.Item>
                    )}
                />
            </Drawer>

            <Drawer
                title='Details'
                placement='bottom'
                height={320}
                onClose={() => setDrawerVisible(false)}
                open={drawerVisible}
            >
                {drawerContent}
            </Drawer>

            <Drawer
                title={invoiceViewer.title || 'Invoice'}
                placement='right'
                width={720}
                onClose={() => setInvoiceViewer({ open: false })}
                open={invoiceViewer.open}
            >
                {invoiceViewer.url ? (
                    <iframe
                        title='invoice'
                        src={invoiceViewer.url}
                        style={{ width: '100%', height: '80vh', border: 0 }}
                    />
                ) : (
                    <Empty description='No invoice attached' />
                )}
            </Drawer>
        </>
    )
}
