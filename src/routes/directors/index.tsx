import React, { useEffect, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Statistic,
    Typography,
    List,
    Tag,
    Space,
    Progress,
    Button,
    Table,
    Drawer,
    message,
    Spin,
    Input,
    Empty
} from 'antd'
import {
    BarChartOutlined,
    TeamOutlined,
    RiseOutlined,
    CheckCircleOutlined,
    FundOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    updateDoc
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/firebase'

const { Text } = Typography

const tsToDate = (ts: any): Date | null => {
    if (!ts) return null
    if (typeof ts?.toDate === 'function') return ts.toDate()
    if (ts instanceof Date) return ts
    return null
}

const pickDepartment = (i: any): string =>
    i?.department || i?.assignedDepartment || i?.areaOfSupport || 'Unknown'

export default function DirectorDashboard() {
    const [programs, setPrograms] = useState<any[]>([])
    const [incubatees, setIncubatees] = useState<any[]>([])
    const [complianceRecords] = useState<any[]>([])
    const [overdueInterventions, setOverdueInterventions] = useState<any[]>([])
    const [invoicesNeedingApproval, setInvoicesNeedingApproval] = useState<any[]>(
        []
    )
    const [invoiceViewer, setInvoiceViewer] = useState<{
        open: boolean
        url?: string
        title?: string
    }>({ open: false })
    const [notifications, setNotifications] = useState<any[]>([])
    const [notificationDrawerVisible, setNotificationDrawerVisible] =
        useState(false)
    const [loading, setLoading] = useState(false)
    const auth = getAuth()
    const currentUser = auth.currentUser

    // helpers
    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR',
            minimumFractionDigits: 0
        }).format(value)

    const getOverallComplianceRate = () => {
        if (incubatees.length === 0) return 0
        const total = incubatees.reduce(
            (sum, p) => sum + (p.complianceRate || 0),
            0
        )
        return Math.round(total / incubatees.length)
    }

    const overallCompliance = () => {
        if (!complianceRecords.length) return getOverallComplianceRate()
        const avg =
            complianceRecords.reduce((acc, r) => acc + (r.complianceRate || 0), 0) /
            complianceRecords.length
        return Math.round(avg)
    }

    const getInvoiceUrl = (item: any) =>
        item.invoiceFile ||
        item.invoiceUrl ||
        item?.invoiceAttachment?.url ||
        item?.invoiceAttachement?.url

    // programs
    useEffect(() => {

        ; (async () => {
            const q = query(
                collection(db, 'programs'),

            )
            const snap = await getDocs(q)
            setPrograms(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        })()
    }, [])

    // incubatees (accepted applications)
    useEffect(() => {
        ; (async () => {
            const q = query(
                collection(db, 'applications'),
                where('applicationStatus', '==', 'accepted'),

            )
            const s = await getDocs(q)
            setIncubatees(
                s.docs.map(doc => {
                    const data = doc.data() as any
                    const docs = data.complianceDocuments || []
                    const validDocs = docs.filter((d: any) => d.status === 'valid')
                    const totalTypes = 7
                    const complianceRate = Math.round(
                        (validDocs.length / totalTypes) * 100
                    )
                    return { id: doc.id, ...data, complianceRate }
                })
            )
        })()
    }, [])

    // invoices needing approval (resourceRequests + consolidatedMOVs)
    useEffect(() => {
        if (!currentUser?.email) return
            ; (async () => {
                try {
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
                    const movWithInvoice = movAll.filter((m: any) =>
                        Boolean(m.invoiceAttachment || m.invoiceAttachement)
                    )

                    const merged = [...rr, ...movWithInvoice].sort((a: any, b: any) => {
                        const aTime = tsToDate(a.createdAt)?.getTime() || 0
                        const bTime = tsToDate(b.createdAt)?.getTime() || 0
                        return bTime - aTime
                    })

                    setInvoicesNeedingApproval(merged)
                } catch (e) {
                    console.error(e)
                }
            })()
    }, [currentUser])

    // overdue interventions
    useEffect(() => {
        ; (async () => {
            setLoading(true)
            try {
                const email = currentUser?.email
                if (!email) return

                const coordinatorSnap = await getDocs(
                    query(
                        collection(db, 'coordinators'),

                    )
                )
                const coordinatorIds = coordinatorSnap.docs.map(d => d.id)

                const aiSnap = await getDocs(collection(db, 'assignedInterventions'))
                const all = aiSnap.docs.map(d => ({ id: d.id, ...d.data() }))

                const now = new Date()
                const overdue = all
                    .filter((i: any) => {
                        const belongsToCoordinatorPool = i.assigneeId && coordinatorIds.includes(i.assigneeId)
                        const due = tsToDate(i.dueDate)
                        const notDone = i.assigneeCompletionStatus !== 'completed'
                        return belongsToCoordinatorPool && !!due && due < now && notDone
                    })
                    .map((i: any) => ({ ...i, department: pickDepartment(i) }))

                setOverdueInterventions(overdue)
            } finally {
                setLoading(false)
            }
        })()
    }, [currentUser])

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
            const payload = {
                status: 'invoice_rejected',
                ceoRejectedAt: now,
                ceoRejectedBy: by,
                ceoRejectReason: reason || ''
            }
            if (item.source === 'resourceRequests')
                await updateDoc(doc(db, 'resourceRequests', item.id), payload)
            else if (item.source === 'consolidatedMOVs')
                await updateDoc(doc(db, 'consolidatedMOVs', item.id), payload)
            message.success('Invoice rejected.')
            setInvoicesNeedingApproval(prev => prev.filter(x => x.id !== item.id))
        } catch (e) {
            console.error(e)
            message.error('Failed to reject invoice.')
        }
    }

    const promptReject = (item: any) => {
        let input = ''
        Modal.confirm({
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

    // ---- UI (Overview only) ----
    return (
        <>
            <Helmet>
                <title>Director Dashboard | Overview</title>
            </Helmet>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} md={8} lg={6}>
                    <Card style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
                        <Statistic
                            title='Total Incubatees'
                            value={incubatees.length}
                            prefix={<TeamOutlined />}
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                    <Card style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
                        <Statistic
                            title='Active Programs'
                            value={programs.filter(p => p.status === 'Active').length}
                            prefix={<BarChartOutlined />}
                            valueStyle={{ color: '#3f8600' }}
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                    <Card style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
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
                    <Card style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
                        <Statistic
                            title='Average Progress'
                            value={72}
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
                            title='🔴 Overdue Interventions'
                            style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}
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
                                            flexWrap: 'wrap',
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
                                                    ? dayjs(tsToDate(item.dueDate)!).format('YYYY-MM-DD')
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
                            title='🧾 Invoices Needing Approval'
                            style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}
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
                                    const url = getInvoiceUrl(item)
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
                                            <div style={{ flex: 1, minWidth: 220 }}>
                                                <Text strong>{primary}</Text>
                                                <br />
                                                <Text type='secondary'>
                                                    Requested By: {requestedBy}
                                                </Text>
                                            </div>

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
                                                        type='primary'
                                                        onClick={() => approveInvoice(item)}
                                                    >
                                                        Approve
                                                    </Button>
                                                    <Button danger onClick={() => promptReject(item)}>
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

            {/* Drawers */}
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
                    renderItem={(item: any) => (
                        <List.Item>
                            <List.Item.Meta
                                title={item.message?.director || 'Untitled'}
                                description={
                                    item.createdAt?.seconds
                                        ? new Date(item.createdAt.seconds * 1000).toLocaleString()
                                        : ''
                                }
                            />
                        </List.Item>
                    )}
                />
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
