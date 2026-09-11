// InvoicesView.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Table,
    Card,
    Row,
    Col,
    Typography,
    Tag,
    Space,
    Button,
    Modal,
    Alert,
    message,
    Select,
    DatePicker,
    Statistic,
    Empty,
    Spin,
    Tooltip
} from 'antd'
import {
    FileDoneOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    FileTextOutlined,
    DollarOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { motion } from 'framer-motion'

const { Title, Text } = Typography
const { Option } = Select
const { MonthPicker } = DatePicker

type InvoiceDoc = {
    id: string
    type?: 'resource_request' | 'department_invoice' | 'consolidated_mov' | string

    branch?: string
    requestType?: string
    resourceName?: string
    description?: string
    quantity?: number | string
    // various shapes we normalize below:
    invoiceUrl?: string
    invoice?: { name?: string; url?: string }
    popUrl?: string
    popAttachment?: { name?: string; url?: string; path?: string }
    popAttachement?: { name?: string; url?: string; path?: string } // common typo
    amount?: number | string | null
    notes?: string
    status?: string // 'approved' | 'paid' | 'rejected' | ...
    month?: string // 'YYYY-MM'
    approvedAt?: any
    approvedBy?: { uid?: string; name?: string; role?: string; email?: string }
    decidedBy?: { decision?: string }
    createdAt?: any
    updatedAt?: any
    source?: { collection?: string; id?: string } // no longer shown in UI
}

// helper
const orgUnitValue = (rec: any) =>
    rec?.type === 'resource_request' ? rec.branch || '—' : rec.department || '—' // default to department for consolidated/others

const orgUnitLabel = (rec: any) =>
    rec?.type === 'resource_request' ? 'Branch' : 'Department'

// ---------- helpers (labels/colors/formatters)
const TYPE_LABELS: Record<string, string> = {
    resource_request: 'Resource Request',
    department_invoice: 'Department Invoice',
    consolidated_mov: 'Consolidated MOV',
    other: 'Other'
}
const TYPE_COLORS: Record<string, string> = {
    resource_request: 'geekblue',
    department_invoice: 'volcano',
    consolidated_mov: 'purple',
    other: 'cyan'
}
const typeColor = (t?: string) => TYPE_COLORS[t || 'other'] || 'cyan'
const typeLabel = (t?: string) => TYPE_LABELS[t || 'other'] || 'Other'

const cardStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 12,
    border: '1px solid #d6e4ff'
}
const Motion: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
    >
        {children}
    </motion.div>
)
const money = (v?: number | string | null) => {
    if (v === null || v === undefined || v === '') return '—'
    const n = typeof v === 'string' ? parseFloat(v) : v
    if (!Number.isFinite(n as number)) return String(v)
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'ZAR',
        maximumFractionDigits: 2
    }).format(n as number)
}

const InvoicesView: React.FC = () => {
    const { user } = useFullIdentity()
    const [invoices, setInvoices] = useState<InvoiceDoc[]>([])
    const [loading, setLoading] = useState(true)

    // filters
    const [typeFilter, setTypeFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [branchFilter, setBranchFilter] = useState<string>('all')
    const [popFilter, setPopFilter] = useState<'all' | 'with' | 'without'>('all')
    const [monthFilter, setMonthFilter] = useState<Dayjs | null>(null)

    // doc viewer
    const [viewerUrl, setViewerUrl] = useState<string | null>(null)
    const [viewerTitle, setViewerTitle] = useState<string>('Document')

    // subscribe
    useEffect(() => {
        setLoading(true)
        const qy = query(
            collection(db, 'invoices')
        )
        const unsub = onSnapshot(
            qy,
            snap => {
                const list = snap.docs.map(d => {
                    const raw = { id: d.id, ...(d.data() as any) } as InvoiceDoc

                    // ---- normalize type
                    let type =
                        raw.type ||
                        (raw.source?.collection === 'resourceRequests'
                            ? 'resource_request'
                            : undefined) ||
                        'other'

                    // ---- normalize urls (support both shapes + typo)
                    const invoiceUrl = raw.invoiceUrl || raw.invoice?.url || undefined
                    const popUrl =
                        raw.popUrl ||
                        raw.popAttachment?.url ||
                        raw.popAttachement?.url || // typo support
                        undefined

                    // ---- normalize status
                    const status =
                        raw.status ||
                        raw.decidedBy?.decision || // department_invoice
                        'approved'

                    return {
                        ...raw,
                        type,
                        invoiceUrl,
                        popUrl,
                        status
                    }
                })
                // sort by updated/approved/created desc
                const sorted = list.sort((a: any, b: any) => {
                    const at =
                        a.updatedAt?.toMillis?.() ||
                        a.approvedAt?.toMillis?.() ||
                        a.createdAt?.toMillis?.() ||
                        0
                    const bt =
                        b.updatedAt?.toMillis?.() ||
                        b.approvedAt?.toMillis?.() ||
                        b.createdAt?.toMillis?.() ||
                        0
                    return bt - at
                })
                setInvoices(sorted)
                setLoading(false)
            },
            e => {
                console.error(e)
                message.error('Failed to load invoices')
                setLoading(false)
            }
        )
        return () => unsub()
    }, [])

    // uniques for filters (use normalized values)
    const uniqueTypes = useMemo(
        () => Array.from(new Set(invoices.map(i => i.type || 'other'))).sort(),
        [invoices]
    )
    const uniqueStatuses = useMemo(
        () =>
            Array.from(
                new Set(invoices.map(i => (i.status || 'approved').toLowerCase()))
            ).sort(),
        [invoices]
    )
    const uniqueBranches = useMemo(
        () =>
            Array.from(
                new Set(invoices.map(i => i.branch).filter(Boolean) as string[])
            ).sort(),
        [invoices]
    )

    // filtered
    const filtered = useMemo(() => {
        return invoices.filter(i => {
            const tMatch = typeFilter === 'all' || (i.type || 'other') === typeFilter
            const sMatch =
                statusFilter === 'all' || (i.status || 'approved') === statusFilter
            const bMatch = branchFilter === 'all' || (i.branch || '') === branchFilter
            const pMatch =
                popFilter === 'all' || (popFilter === 'with' ? !!i.popUrl : !i.popUrl)
            const mMatch =
                !monthFilter ||
                (i.month && dayjs(i.month, 'YYYY-MM').isSame(monthFilter, 'month')) ||
                (i.approvedAt &&
                    dayjs(i.approvedAt?.toDate?.() || i.approvedAt).isSame(
                        monthFilter,
                        'month'
                    ))
            return tMatch && sMatch && bMatch && pMatch && mMatch
        })
    }, [invoices, typeFilter, statusFilter, branchFilter, popFilter, monthFilter])

    // metrics
    const metrics = useMemo(() => {
        const total = filtered.length
        const withPOP = filtered.filter(i => !!i.popUrl).length
        const withoutPOP = total - withPOP
        const totalAmt = filtered.reduce((s, i) => {
            const n =
                typeof i.amount === 'string'
                    ? parseFloat(i.amount)
                    : (i.amount as number | undefined)
            return s + (Number.isFinite(n as number) ? (n as number) : 0)
        }, 0)
        return { total, withPOP, withoutPOP, totalAmt }
    }, [filtered])

    // columns (NOTE: Source column REMOVED)
    const columns = [
        {
            title: 'Invoice Type',
            dataIndex: 'type',
            render: (t: string) => <Tag color={typeColor(t)}>{typeLabel(t)}</Tag>
        },
        {
            title: 'Department / Branch',
            key: 'orgUnit',
            render: (_: any, rec: any) => (
                <span>
                    <Typography.Text type='secondary'>
                        {orgUnitLabel(rec)}:{' '}
                    </Typography.Text>
                    {orgUnitValue(rec)}
                </span>
            )
        },

        {
            title: 'Amount',
            dataIndex: 'amount',
            render: (v: any) => (
                <span>
                    <DollarOutlined style={{ marginRight: 6 }} />
                    {money(v)}
                </span>
            )
        },
        {
            title: 'Month',
            render: (r: InvoiceDoc) => {
                if (r.month && dayjs(r.month, 'YYYY-MM').isValid())
                    return dayjs(r.month).format('MMM YYYY')
                const dt = r.approvedAt?.toDate?.() || r.approvedAt
                return dt ? dayjs(dt).format('MMM YYYY') : '—'
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            render: (s: string) => (
                <Tag
                    color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'blue'}
                >
                    {(s || 'approved').toUpperCase()}
                </Tag>
            )
        },
        {
            title: 'Files',
            render: (r: InvoiceDoc) => (
                <Space size='small' wrap>
                    {r.invoiceUrl ? (
                        <Button
                            size='small'
                            icon={<FileTextOutlined />}
                            onClick={() => {
                                setViewerTitle('Invoice')
                                setViewerUrl(r.invoiceUrl!)
                            }}
                        >
                            Invoice
                        </Button>
                    ) : null}
                    {r.popUrl ? (
                        <Button
                            size='small'
                            icon={<FileTextOutlined />}
                            onClick={() => {
                                setViewerTitle('Proof of Payment (POP)')
                                setViewerUrl(r.popUrl!)
                            }}
                        >
                            POP
                        </Button>
                    ) : (
                        <Tag color='volcano'>No POP</Tag>
                    )}
                </Space>
            )
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Motion>
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='Invoices — Consolidated View'
                    description='Browse invoices from Resource Requests and Department Invoices. Filter by month, POP, status, and more; open the Invoice or POP inline.'
                />
            </Motion>

            {/* KPI Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
                <Col xs={24} sm={6}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <Statistic
                                title='Total Invoices'
                                value={metrics.total}
                                prefix={<FileDoneOutlined />}
                            />
                        </Card>
                    </Motion>
                </Col>
                <Col xs={24} sm={6}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <Statistic
                                title='With POP'
                                value={metrics.withPOP}
                                prefix={<CheckCircleOutlined />}
                            />
                        </Card>
                    </Motion>
                </Col>
                <Col xs={24} sm={6}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <Statistic
                                title='Missing POP'
                                value={metrics.withoutPOP}
                                prefix={<ExclamationCircleOutlined />}
                            />
                        </Card>
                    </Motion>
                </Col>
                <Col xs={24} sm={6}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <Statistic
                                title='Total Amount (shown)'
                                value={money(metrics.totalAmt)}
                            />
                        </Card>
                    </Motion>
                </Col>
            </Row>

            {/* Filters */}
            <Motion>
                <Card hoverable style={cardStyle}>
                    <Row gutter={[12, 12]}>
                        <Col xs={24} sm={8} md={6}>
                            <Select
                                style={{ width: '100%' }}
                                value={typeFilter}
                                onChange={setTypeFilter}
                            >
                                <Option value='all'>All Types</Option>
                                {uniqueTypes.map(t => (
                                    <Option key={t} value={t}>
                                        {typeLabel(t)}
                                    </Option>
                                ))}
                            </Select>
                        </Col>
                        <Col xs={24} sm={8} md={6}>
                            <Select
                                style={{ width: '100%' }}
                                value={statusFilter}
                                onChange={setStatusFilter}
                            >
                                <Option value='all'>All Statuses</Option>
                                {uniqueStatuses.map(s => (
                                    <Option key={s} value={s}>
                                        {s.toUpperCase()}
                                    </Option>
                                ))}
                            </Select>
                        </Col>
                        <Col xs={24} sm={8} md={6}>
                            <Select
                                style={{ width: '100%' }}
                                value={branchFilter}
                                onChange={setBranchFilter}
                            >
                                <Option value='all'>All Branches</Option>
                                {Array.from(
                                    new Set(
                                        invoices.map(i => i.branch).filter(Boolean) as string[]
                                    )
                                )
                                    .sort()
                                    .map(b => (
                                        <Option key={b} value={b}>
                                            {b}
                                        </Option>
                                    ))}
                            </Select>
                        </Col>
                        <Col xs={24} sm={8} md={6}>
                            <Select
                                style={{ width: '100%' }}
                                value={popFilter}
                                onChange={setPopFilter}
                            >
                                <Option value='all'>POP: All</Option>
                                <Option value='with'>POP: With</Option>
                                <Option value='without'>POP: Without</Option>
                            </Select>
                        </Col>
                        <Col xs={24} sm={8} md={6}>
                            <MonthPicker
                                style={{ width: '100%' }}
                                value={monthFilter as any}
                                onChange={setMonthFilter as any}
                            />
                        </Col>
                        <Col xs={24} sm={8} md={6}>
                            <Space wrap>
                                <Button onClick={() => setMonthFilter(null)}>
                                    Clear Month
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </Card>
            </Motion>

            {/* Table */}
            <Motion>
                <Card hoverable style={{ ...cardStyle, marginTop: 12 }}>
                    {loading ? (
                        <Spin />
                    ) : filtered.length ? (
                        <Table
                            rowKey='id'
                            dataSource={filtered}
                            columns={columns as any}
                            pagination={{ pageSize: 10 }}
                            size='middle'
                        />
                    ) : (
                        <Empty description='No invoices found' />
                    )}
                </Card>
            </Motion>

            {/* Document Viewer */}
            <Modal
                open={!!viewerUrl}
                title={viewerTitle}
                onCancel={() => setViewerUrl(null)}
                footer={null}
                width={900}
                bodyStyle={{ height: '70vh', padding: 0 }}
            >
                {viewerUrl ? (
                    <iframe
                        title='invoice-doc'
                        src={viewerUrl}
                        style={{ width: '100%', height: '100%', border: 0 }}
                    />
                ) : null}
            </Modal>
        </div>
    )
}

export default InvoicesView
