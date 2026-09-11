// FinanceRequests.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Table,
    Tag,
    Button,
    Modal,
    Form,
    Input,
    message,
    Space,
    Typography,
    Row,
    Col,
    Select,
    Card,
    Statistic,
    Tooltip,
    Empty,
    Spin,
    Upload
} from 'antd'
import {
    FileDoneOutlined,
    CloseCircleOutlined,
    CheckSquareOutlined,
    ClockCircleOutlined,
    DollarOutlined,
    FileTextOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    collection,
    onSnapshot,
    query,
    where,
    doc,
    updateDoc,
    Timestamp,
    addDoc
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { motion } from 'framer-motion'

const { Title, Text } = Typography
const { Option } = Select

type StageKey =
    | 'pending_purchase_approval'
    | 'awaiting_purchase_approval'
    | 'pending_quotation'
    | 'quotation_submitted'
    | 'quotation_approved'
    | 'invoice_requested'
    | 'invoice_uploaded'
    | 'invoice_approved'
    | 'ceo_approval'
    | 'completed'
    | 'rejected'

type StageEntry = { actor?: string; stage: string; timestamp?: any }

type ResourceRow = {
    id: string
    branch?: string
    requestType?: string
    resourceName?: string
    description?: string
    quantity?: number
    progress: StageEntry[]
    status: string
    createdAt?: any
    updatedAt?: any
    quotationUrl?: string
    invoiceUrl?: string
    popUrl?: string
}

const STAGE_COLORS: Record<string, string> = {
    awaiting_purchase_approval: 'default',
    pending_purchase_approval: 'default',
    pending_quotation: 'gold',
    quotation_submitted: 'processing',
    quotation_approved: 'green',
    invoice_requested: 'orange',
    invoice_uploaded: 'blue',
    invoice_approved: 'geekblue',
    ceo_approval: 'purple',
    completed: 'success',
    rejected: 'red'
}

const STAGE_LABELS: Record<string, string> = {
    awaiting_purchase_approval: 'Awaiting Purchase Approval',
    pending_purchase_approval: 'Awaiting Purchase Approval',
    pending_quotation: 'Pending Quotation',
    quotation_submitted: 'Quotation Submitted',
    quotation_approved: 'Quotation Approved',
    invoice_requested: 'Invoice Requested',
    invoice_uploaded: 'Invoice Uploaded',
    invoice_approved: 'Invoice Approved',
    ceo_approval: 'Pending CEO Approval',
    completed: 'Completed',
    rejected: 'Rejected'
}
const startCase = (s: string) =>
    s
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace(/\bCeo\b/g, 'CEO')
const formatStage = (s?: string) => (s ? STAGE_LABELS[s] ?? startCase(s) : '—')
const colorKey = (s?: string) =>
    s === 'pending_purchase_approval' ? 'awaiting_purchase_approval' : s || ''
const statusColor = (s?: string) => STAGE_COLORS[colorKey(s)] || 'default'

const FinanceRequests: React.FC = () => {
    const { user } = useFullIdentity() || {}
    const [rows, setRows] = useState<ResourceRow[]>([])
    const [loading, setLoading] = useState(true)

    const [stageFilter, setStageFilter] = useState<string | undefined>()
    const [form] = Form.useForm()

    // Doc viewer
    const [docUrl, setDocUrl] = useState<string | null>(null)

    // Approve / Reject modal
    const [actionModalVisible, setActionModalVisible] = useState(false)
    const [actionType, setActionType] = useState<'approve' | 'reject' | null>(
        null
    )
    const [selected, setSelected] = useState<ResourceRow | null>(null)
    const [popFile, setPopFile] = useState<File | null>(null)
    const [submitting, setSubmitting] = useState(false)

    // ---- Firestore subscription
    useEffect(() => {
        setLoading(true)

        const qBase = query(
            collection(db, 'resourceRequests')
        )

        const unsub = onSnapshot(
            qBase,
            snap => {
                const items: ResourceRow[] = snap.docs.map(d => {
                    const data: any = d.data()
                    const progress: StageEntry[] = Array.isArray(data.progress)
                        ? data.progress
                        : []
                    const last = progress.length ? progress[progress.length - 1] : null
                    return {
                        id: d.id,
                        branch: data.branch ?? '',
                        requestType: data.requestType ?? '',
                        resourceName: data.resourceName ?? data.resource ?? '',
                        description: data.purpose ?? data.description ?? '',
                        quantity: data.quantity ?? 0,
                        progress,
                        status:
                            data.status ??
                            (last?.stage as string) ??
                            'pending_purchase_approval',
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt ?? last?.timestamp ?? data.createdAt,
                        quotationUrl: data.quotationUrl ?? data.quotationFile ?? '',
                        invoiceUrl: data.invoiceUrl ?? data.invoiceFile ?? '',
                        popUrl: data.popUrl ?? data.popFile ?? ''
                    }
                })

                items.sort((a, b) => {
                    const am = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0
                    const bm = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0
                    return bm - am
                })

                setRows(items)
                setLoading(false)
            },
            err => {
                console.error('resourceRequests onSnapshot error:', err)
                message.error(
                    err.code === 'failed-precondition'
                        ? 'Firestore index required.'
                        : `Failed to load: ${err.code || err.message}`
                )
                setLoading(false)
            }
        )

        return () => unsub()
    }, [])

    // ---- Derived metrics
    const metrics = useMemo(() => {
        const awaitingFinance = rows.filter(r =>
            ['quotation_submitted', 'invoice_uploaded'].includes(r.status)
        )
        const approvedByFinance = rows.filter(r =>
            ['quotation_approved', 'invoice_approved'].includes(r.status)
        )
        const rejected = rows.filter(r => r.status === 'rejected')

        return {
            total: rows.length,
            awaitingCount: awaitingFinance.length,
            approvedCount: approvedByFinance.length,
            rejectedCount: rejected.length
        }
    }, [rows])

    // ---- Actions
    const openAction = (rec: ResourceRow, type: 'approve' | 'reject') => {
        setSelected(rec)
        setActionType(type)
        setPopFile(null)
        form.resetFields()
        setActionModalVisible(true)
    }

    const uploadPOPIfAny = async (file: File | null, pathBase: string) => {
        if (!file) return null
        const storage = getStorage()
        const safe = file.name.replace(/\s+/g, '_')
        const rf = ref(storage, `${pathBase}/${Date.now()}_${safe}`)
        await uploadBytes(rf, file)
        const url = await getDownloadURL(rf)
        return { name: file.name, url, path: rf.fullPath }
    }

    const handleActionSubmit = async () => {
        if (!selected || !actionType) return
        setSubmitting(true)
        try {
            const id = selected.id
            const now = Timestamp.now()

            let nextStatus = selected.status
            const approvingQuotation =
                selected.status === 'quotation_submitted' && actionType === 'approve'
            const approvingInvoice =
                selected.status === 'invoice_uploaded' && actionType === 'approve'

            // Validate / collect form values
            let values: any = {}
            if (actionType === 'reject') {
                values = await form.validateFields()
            } else if (approvingInvoice) {
                // POP is required when approving an uploaded invoice
                values = await form.validateFields()
                if (!popFile && !selected.popUrl) {
                    message.error('Please upload a Proof of Payment (POP).')
                    setSubmitting(false)
                    return
                }
            }

            if (actionType === 'approve') {
                if (approvingQuotation) nextStatus = 'quotation_approved'
                else if (approvingInvoice) nextStatus = 'invoice_approved'
            } else {
                nextStatus = 'rejected'
            }

            // Upload POP if provided
            let popUrl: string | null = selected.popUrl || null
            if (approvingInvoice && popFile) {
                const meta = await uploadPOPIfAny(
                    popFile,
                    `invoices/${selected.branch || 'branch'
                    }/${dayjs().format('YYYY-MM')}`
                )
                popUrl = meta?.url || popUrl
            }

            // Build progress entry
            const progressEntry: StageEntry = {
                stage: nextStatus,
                timestamp: now,
                actor: (user as any)?.fullName || 'Finance'
            }

            // Update request
            const payload: any = {
                status: nextStatus,
                updatedAt: now,
                progress: [...(selected.progress || []), progressEntry]
            }
            if (actionType === 'reject') payload.rejectionReason = values.reason
            if (popUrl && approvingInvoice) payload.popUrl = popUrl

            await updateDoc(doc(db, 'resourceRequests', id), payload)

            // If approving an invoice → create an `invoices` record
            if (approvingInvoice) {
                const invoiceRecord = {
                    invoiceType: 'resource_request', // <-- type for later consolidated views
                    branch: selected.branch || null,
                    requestType: selected.requestType || null,
                    resourceName: selected.resourceName || null,
                    description: selected.description || null,
                    quantity: selected.quantity ?? null,
                    source: { collection: 'resourceRequests', id },
                    invoiceUrl: selected.invoiceUrl || null,
                    popUrl: popUrl || null,
                    amount: values.amount || null, // optional free text/number
                    notes: values.notes || null,
                    status: 'approved',
                    month: dayjs().format('YYYY-MM'),
                    approvedAt: now,
                    approvedBy: {
                        uid: (user as any)?.uid || '',
                        name: (user as any)?.fullName || (user as any)?.name || '',
                        role: (user as any)?.role || '',
                        email: (user as any)?.email || ''
                    }
                }
                await addDoc(collection(db, 'invoices'), invoiceRecord)
            }

            message.success(
                actionType === 'approve'
                    ? 'Approved successfully'
                    : 'Rejected successfully'
            )
            setActionModalVisible(false)
            form.resetFields()
        } catch (e: any) {
            console.error(e)
            message.error(e?.message || 'Action failed')
        } finally {
            setSubmitting(false)
        }
    }

    // ---- Filters
    const filtered = useMemo(() => {
        if (!stageFilter) return rows
        return rows.filter(r => r.status === stageFilter)
    }, [rows, stageFilter])

    // ---- Columns
    const columns = [
        { title: 'Branch', dataIndex: 'branch', key: 'branch' },
        { title: 'Resource', dataIndex: 'resourceName', key: 'resourceName' },
        { title: 'Description', dataIndex: 'description', key: 'description' },
        { title: 'Quantity', dataIndex: 'quantity', key: 'quantity' },
        {
            title: 'Stage',
            key: 'stage',
            render: (_: any, rec: ResourceRow) => (
                <Tag color={statusColor(rec.status)} style={{ textTransform: 'none' }}>
                    {formatStage(rec.status)}
                </Tag>
            )
        },
        {
            title: 'Files',
            key: 'files',
            render: (_: any, rec: ResourceRow) => {
                const files = [
                    rec.quotationUrl && { label: 'Quotation', url: rec.quotationUrl },
                    rec.invoiceUrl && { label: 'Invoice', url: rec.invoiceUrl },
                    rec.popUrl && { label: 'POP', url: rec.popUrl }
                ].filter(Boolean) as { label: string; url: string }[]

                return files.length ? (
                    <Space size='small' wrap>
                        {files.map((f, i) => (
                            <Button
                                key={i}
                                size='small'
                                icon={<FileTextOutlined />}
                                onClick={() => setDocUrl(f.url)}
                            >
                                {f.label}
                            </Button>
                        ))}
                    </Space>
                ) : (
                    <Text type='secondary'>—</Text>
                )
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, rec: ResourceRow) => {
                const canApprove = ['quotation_submitted', 'invoice_uploaded'].includes(
                    rec.status
                )
                return canApprove ? (
                    <Space>
                        <Button
                            size='small'
                            type='primary'
                            icon={<CheckSquareOutlined />}
                            onClick={() => openAction(rec, 'approve')}
                        >
                            Approve
                        </Button>
                        <Button
                            size='small'
                            danger
                            icon={<CloseCircleOutlined />}
                            onClick={() => openAction(rec, 'reject')}
                        >
                            Reject
                        </Button>
                    </Space>
                ) : (
                    '-'
                )
            }
        }
    ]

    return (
        <div style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
            {/* Metrics */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={6}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Total Requests'
                                value={metrics.total}
                                prefix={<FileDoneOutlined />}
                            />
                        </Card>
                    </motion.div>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Awaiting Finance Decision'
                                value={metrics.awaitingCount}
                                prefix={<ClockCircleOutlined />}
                            />
                        </Card>
                    </motion.div>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Approved by Finance'
                                value={metrics.approvedCount}
                                prefix={<CheckSquareOutlined />}
                            />
                        </Card>
                    </motion.div>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Statistic
                                title='Rejected'
                                value={metrics.rejectedCount}
                                prefix={<CloseCircleOutlined />}
                            />
                        </Card>
                    </motion.div>
                </Col>
            </Row>

            <Row justify='space-between' style={{ marginBottom: 16 }}>
                <Col>
                    <Select
                        allowClear
                        placeholder='Filter by stage'
                        style={{ width: 240 }}
                        value={stageFilter}
                        onChange={v => setStageFilter(v)}
                    >
                        {[
                            'quotation_submitted',
                            'quotation_approved',
                            'invoice_uploaded',
                            'invoice_approved',
                            'completed',
                            'rejected'
                        ].map(s => (
                            <Option key={s} value={s}>
                                {formatStage(s)}
                            </Option>
                        ))}
                    </Select>
                </Col>
            </Row>

            {loading ? (
                <Spin />
            ) : filtered.length ? (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <Card
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        <Table
                            columns={columns as any}
                            dataSource={filtered}
                            rowKey='id'
                            pagination={{ pageSize: 10, showSizeChanger: true }}
                        />
                    </Card>
                </motion.div>
            ) : (
                <Empty description='No requests found' />
            )}

            {/* Approve / Reject Modal */}
            <Modal
                title={actionType === 'approve' ? 'Approve Request' : 'Reject Request'}
                open={actionModalVisible}
                onCancel={() => {
                    setActionModalVisible(false)
                    form.resetFields()
                    setPopFile(null)
                }}
                onOk={handleActionSubmit}
                okText={actionType === 'approve' ? 'Approve' : 'Reject'}
                confirmLoading={submitting}
            >
                {actionType === 'approve' ? (
                    <>
                        {selected?.status === 'invoice_uploaded' ? (
                            <Form form={form} layout='vertical'>
                                <Form.Item name='amount' label='Amount (optional)'>
                                    <Input
                                        prefix={<DollarOutlined />}
                                        placeholder='e.g. 12500.00'
                                    />
                                </Form.Item>
                                <Form.Item name='notes' label='Notes (optional)'>
                                    <Input.TextArea rows={3} placeholder='Any finance notes…' />
                                </Form.Item>
                                <Form.Item
                                    label='Proof of Payment (POP) — required for invoice approval'
                                    required
                                    tooltip='PDF or image'
                                >
                                    <Upload
                                        beforeUpload={file => {
                                            setPopFile(file)
                                            return false
                                        }}
                                        maxCount={1}
                                        accept='.pdf,.png,.jpg,.jpeg,.webp'
                                    >
                                        <Button>Select POP</Button>
                                    </Upload>
                                    {selected?.popUrl ? (
                                        <div style={{ marginTop: 6 }}>
                                            <Text type='secondary'>
                                                Existing POP on record will be kept if you don’t upload
                                                a new one.
                                            </Text>
                                        </div>
                                    ) : null}
                                </Form.Item>
                            </Form>
                        ) : (
                            <p>Are you sure you want to approve this request?</p>
                        )}
                    </>
                ) : (
                    <Form form={form} layout='vertical'>
                        <Form.Item
                            name='reason'
                            label='Rejection Reason'
                            rules={[{ required: true, message: 'This field is required' }]}
                        >
                            <Input.TextArea rows={3} placeholder='Enter details…' />
                        </Form.Item>
                    </Form>
                )}
            </Modal>

            {/* Supporting Doc Viewer */}
            <Modal
                title='Supporting Document'
                open={!!docUrl}
                onCancel={() => setDocUrl(null)}
                footer={null}
                width={900}
                bodyStyle={{ height: '70vh', padding: 0 }}
            >
                {docUrl ? (
                    <iframe
                        title='supporting-doc'
                        src={docUrl}
                        style={{ width: '100%', height: '100%', border: 0 }}
                    />
                ) : null}
            </Modal>
        </div>
    )
}

export default FinanceRequests
