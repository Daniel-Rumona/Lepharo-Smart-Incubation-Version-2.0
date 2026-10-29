import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    Descriptions,
    Grid,
    Input,
    List,
    Modal,
    Result,
    Row,
    Segmented,
    Select,
    Space,
    Tag,
    Steps,
    Tooltip,
    Typography,
    message,
    theme
} from 'antd'
import {
    CheckOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    CloseOutlined,
    DollarOutlined,
    EyeOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    SearchOutlined,
    ShoppingOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { collection, onSnapshot, query } from 'firebase/firestore'
import { db } from '@/firebase'
import { isSmeRequest } from '@/lib/resourceRequests'
import { useBranchNames } from '@/lib/useBranchNames'
import {
    FINANCE_STEP_LABEL,
    PAID_STAGES,
    QUOTE_STAGES,
    financeStepFor
} from '@/lib/financeActions'
import FinanceActionModal from '../FinanceActionModal'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
const { Text } = Typography

type StageEntry = { actor?: string; stage: string; timestamp?: any }

type ResourceRow = {
    id: string
    branch?: string
    department?: string
    // Requesting branch id on internal requests
    requestedFrom?: string
    requestType?: string
    resourceName?: string
    description?: string
    quantity?: number
    amount?: number
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

// What finance has to do at this stage, if anything (see lib/financeActions)
const financeLabel = (status?: string) => {
    const step = financeStepFor(status)
    return step ? FINANCE_STEP_LABEL[step] : undefined
}
const needsAction = (row: ResourceRow) => Boolean(financeStepFor(row.status))

type StatusFilter = 'all' | 'action' | 'paid' | 'rejected'
const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'action', label: 'Needs action' },
    { value: 'paid', label: 'Paid' },
    { value: 'rejected', label: 'Rejected' }
]

const formatMoney = (value?: number) =>
    typeof value === 'number'
        ? `R ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : '—'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const toRow = (id: string, data: any): ResourceRow => {
    const progress: StageEntry[] = Array.isArray(data.progress) ? data.progress : []
    const last = progress.length ? progress[progress.length - 1] : null
    return {
        id,
        // The requesting branch's id; its name is looked up when rows are built
        requestedFrom: data.requestedFrom ?? '',
        department: data.department ?? '',
        requestType: data.requestType ?? '',
        resourceName: data.resourceName ?? data.resource ?? '',
        description: data.purpose ?? data.description ?? '',
        quantity: data.quantity ?? 0,
        amount: typeof data.amount === 'number' ? data.amount : undefined,
        progress,
        status: data.status ?? (last?.stage as string) ?? 'pending_purchase_approval',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt ?? last?.timestamp ?? data.createdAt,
        quotationUrl: data.quotationUrl ?? data.quotationFile ?? '',
        invoiceUrl: data.invoiceUrl ?? data.invoiceFile ?? '',
        popUrl: data.popUrl ?? data.popFile ?? ''
    }
}

const FinanceRequests: React.FC = () => {
    const { user } = useFullIdentity() || {}
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()
    const isDesktop = screens.sm !== false
    // Below md, modals become bottom sheets (index.css) and the filter bar stacks
    const isMobile = screens.md === false
    const barCol = (flex: string) => (isMobile ? { span: 24 } : { flex })

    const [liveRows, setRows] = useState<ResourceRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [branchFilter, setBranchFilter] = useState<string | undefined>()


    const [viewing, setViewing] = useState<ResourceRow | null>(null)
    const [docUrl, setDocUrl] = useState<string | null>(null)

    // The request being approved or rejected in the quick modal
    const [actionTarget, setActionTarget] = useState<{
        row: ResourceRow
        mode: 'approve' | 'reject'
    } | null>(null)

    // ---- Firestore subscription
    useEffect(() => {
        setLoading(true)
        const unsub = onSnapshot(
            query(collection(db, 'resourceRequests')),
            snap => {
                // SME booking requests share this collection but aren't purchases
                setRows(
                    snap.docs.filter(d => !isSmeRequest(d.data())).map(d => toRow(d.id, d.data()))
                )
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

    const branchNames = useBranchNames()

    const rows = useMemo(() => {
        // Requests only store the branch id (requestedFrom); show its name
        return liveRows.map(r => ({
            ...r,
            branch: (r.requestedFrom && branchNames[r.requestedFrom]) || ''
        }))
    }, [liveRows, branchNames])

    // ---- Metrics (all requests)
    const metrics = useMemo(() => {
        const sum = (list: ResourceRow[]) => list.reduce((t, r) => t + (r.amount ?? 0), 0)
        const paid = rows.filter(r => PAID_STAGES.includes(r.status))
        const rejected = rows.filter(r => r.status === 'rejected')
        const open = rows.filter(r => !PAID_STAGES.includes(r.status) && r.status !== 'rejected')
        return {
            actionCount: rows.filter(needsAction).length,
            quotations: rows.filter(r => QUOTE_STAGES.includes(r.status)).length,
            invoices: rows.filter(r => r.status === 'invoice_uploaded').length,
            paidAmount: sum(paid),
            paidCount: paid.length,
            openAmount: sum(open),
            openCount: open.length,
            rejectedCount: rejected.length,
            rejectedAmount: sum(rejected)
        }
    }, [rows])

    const branches = useMemo(
        () => Array.from(new Set(rows.map(r => r.branch).filter(Boolean))).sort() as string[],
        [rows]
    )

    // ---- Filters: finance's to-do first, then most recently updated
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        const time = (r: ResourceRow) =>
            r.updatedAt?.toMillis?.() ?? r.createdAt?.toMillis?.() ?? 0
        return rows
            .filter(r => {
                const statusMatch =
                    statusFilter === 'all' ||
                    (statusFilter === 'action' && needsAction(r)) ||
                    (statusFilter === 'paid' && PAID_STAGES.includes(r.status)) ||
                    (statusFilter === 'rejected' && r.status === 'rejected')
                const searchMatch =
                    !q ||
                    [r.resourceName, r.description, r.branch, r.department].some(v =>
                        (v || '').toLowerCase().includes(q)
                    )
                return statusMatch && searchMatch && (!branchFilter || r.branch === branchFilter)
            })
            .sort((a, b) => Number(needsAction(b)) - Number(needsAction(a)) || time(b) - time(a))
    }, [rows, search, statusFilter, branchFilter])

    const hasFilters = !!search || statusFilter !== 'all' || !!branchFilter

    // ---- Actions: approving and rejecting happen in the shared quick modal
    const openAction = (rec: ResourceRow, mode: 'approve' | 'reject') => {
        setViewing(null)
        setActionTarget({ row: rec, mode })
    }

    // ---- Cards
    // Items waiting on finance get a warning-coloured edge and tinted background
    const actionStyle = (on: boolean): React.CSSProperties =>
        on
            ? {
                borderColor: token.colorWarningBorder,
                borderLeft: `4px solid ${token.colorWarning}`,
                background: token.colorWarningBg
            }
            : {}

    const iconCircle = (on: boolean, size = 36) => (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: size / 2.2,
                flexShrink: 0,
                background: on ? token.colorWarningBgHover : token.colorPrimaryBg,
                color: on ? token.colorWarning : token.colorPrimary
            }}
        >
            <ShoppingOutlined />
        </div>
    )

    const renderCard = (row: ResourceRow) => {
        const action = financeLabel(row.status)
        const requestedOn = row.createdAt?.toDate
            ? dayjs(row.createdAt.toDate()).format('D MMM YYYY')
            : undefined
        const details = [
            row.branch,
            row.department,
            row.quantity ? `×${row.quantity}` : undefined,
            requestedOn && `Requested ${requestedOn}`
        ].filter(Boolean)

        return (
            <Card
                size='small'
                hoverable
                style={{ width: '100%', borderRadius: 12, ...actionStyle(!!action) }}
                onClick={() => setViewing(row)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {iconCircle(!!action)}
                    {/* Two lines: what and where it's at, then who and when */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Text strong ellipsis style={{ minWidth: 0 }}>
                                {row.resourceName || 'Unnamed request'}
                            </Text>
                            <Tag
                                color={action ? 'orange' : statusColor(row.status)}
                                style={{ marginInlineEnd: 0, flexShrink: 0 }}
                            >
                                {action || formatStage(row.status)}
                            </Tag>
                        </div>
                        <Text type='secondary' ellipsis style={{ fontSize: 12, display: 'block' }}>
                            {details.join(' · ') || row.description || '—'}
                        </Text>
                    </div>
                    <Space
                        size={8}
                        style={{ flexShrink: 0 }}
                        // The buttons mustn't also open the details
                        onClick={e => e.stopPropagation()}
                    >
                        {typeof row.amount === 'number' && isDesktop && (
                            <Text strong>{formatMoney(row.amount)}</Text>
                        )}
                        {action && (
                            <>
                                <Tooltip title={action}>
                                    <Button
                                        shape='circle'
                                        type='primary'
                                        aria-label={action}
                                        icon={<CheckOutlined />}
                                        onClick={() => openAction(row, 'approve')}
                                    />
                                </Tooltip>
                                <Tooltip title='Reject'>
                                    <Button
                                        shape='circle'
                                        danger
                                        aria-label='Reject'
                                        icon={<CloseOutlined />}
                                        onClick={() => openAction(row, 'reject')}
                                    />
                                </Tooltip>
                            </>
                        )}
                    </Space>
                </div>
            </Card>
        )
    }

    const viewingAction = viewing ? financeLabel(viewing.status) : undefined

    // The progress trail split into rows (4 per row, 2 on phones) so it reads
    // left to right without scrolling sideways
    const perRow = isMobile ? 2 : 4
    const progressEntries = viewing?.progress || []
    const progressCurrent = Math.max(0, progressEntries.length - 1)
    const progressRows = Array.from(
        { length: Math.ceil(progressEntries.length / perRow) },
        (_, i) => ({
            start: i * perRow,
            entries: progressEntries.slice(i * perRow, (i + 1) * perRow)
        })
    )
    const files = viewing
        ? ([
            viewing.quotationUrl && { label: 'Quotation', url: viewing.quotationUrl },
            viewing.invoiceUrl && { label: 'Invoice', url: viewing.invoiceUrl },
            viewing.popUrl && { label: 'Proof of payment', url: viewing.popUrl }
        ].filter(Boolean) as { label: string; url: string }[])
        : []

    return (
        <div style={{ padding: isDesktop ? 24 : 12, minHeight: '100vh' }}>
            {/* Metrics: two side by side on mobile */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<ClockCircleOutlined />}
                        tone='warning'
                        title='Needs Finance Action'
                        value={metrics.actionCount}
                        subtitle={`${plural(metrics.quotations, 'quotation')} · ${plural(
                            metrics.invoices,
                            'invoice'
                        )}`}
                        loading={loading}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<DollarOutlined />}
                        tone='success'
                        title='Paid'
                        value={formatMoney(metrics.paidAmount)}
                        subtitle={plural(metrics.paidCount, 'request')}
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<FileDoneOutlined />}
                        tone='info'
                        title='In Pipeline'
                        value={formatMoney(metrics.openAmount)}
                        subtitle={`${plural(metrics.openCount, 'open request')}, not yet paid`}
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<CloseCircleOutlined />}
                        tone='danger'
                        title='Rejected'
                        value={metrics.rejectedCount}
                        subtitle={`${formatMoney(metrics.rejectedAmount)} not spent`}
                        loading={loading}
                    />
                </Col>
            </Row>

            <DashboardFilterBar>
                <Row gutter={[12, 12]} align='middle'>
                    <Col {...barCol('2 1 220px')}>
                        <Input
                            placeholder='Search resource, branch or purpose...'
                            prefix={<SearchOutlined />}
                            allowClear
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </Col>
                    <Col {...barCol('2 1 360px')}>
                        <Segmented
                            block
                            value={statusFilter}
                            onChange={value => setStatusFilter(value as StatusFilter)}
                            options={STATUS_OPTIONS}
                        />
                    </Col>
                    <Col {...barCol('1 1 180px')}>
                        <Select
                            allowClear
                            placeholder='All branches'
                            value={branchFilter}
                            onChange={setBranchFilter}
                            options={branches.map(b => ({ value: b, label: b }))}
                            style={{ width: '100%' }}
                        />
                    </Col>
                </Row>
            </DashboardFilterBar>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <List
                    dataSource={filtered}
                    rowKey='id'
                    loading={loading}
                    split={false}
                    pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                    locale={{
                        emptyText: hasFilters ? (
                            <Result
                                icon={<SearchOutlined />}
                                title='No requests found'
                                subTitle='Nothing matches your search or filters.'
                                extra={
                                    <Button
                                        onClick={() => {
                                            setSearch('')
                                            setStatusFilter('all')
                                            setBranchFilter(undefined)
                                        }}
                                    >
                                        Clear filters
                                    </Button>
                                }
                            />
                        ) : (
                            <Result
                                icon={<ShoppingOutlined />}
                                title='No resource requests yet'
                                subTitle='Requests from branches will appear here as they move through purchasing.'
                            />
                        )
                    }}
                    renderItem={row => (
                        <List.Item style={{ padding: '6px 0' }}>{renderCard(row)}</List.Item>
                    )}
                />
            </motion.div>

            {/* Read-only details: files and the stage history */}
            <Modal
                open={!!viewing}
                onCancel={() => setViewing(null)}
                title='Request Details'
                // Wide enough for four progress stages per row
                width={760}
                destroyOnClose
                footer={
                    viewing && viewingAction ? (
                        <Row gutter={8}>
                            <Col span={12}>
                                <Button
                                    block
                                    type='primary'
                                    icon={<CheckOutlined />}
                                    onClick={() => openAction(viewing, 'approve')}
                                >
                                    {viewingAction}
                                </Button>
                            </Col>
                            <Col span={12}>
                                <Button
                                    block
                                    danger
                                    icon={<CloseOutlined />}
                                    onClick={() => openAction(viewing, 'reject')}
                                >
                                    Reject
                                </Button>
                            </Col>
                        </Row>
                    ) : null
                }
            >
                {viewing && (
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {iconCircle(!!viewingAction, 44)}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Text strong style={{ fontSize: 16, display: 'block' }} ellipsis>
                                    {viewing.resourceName || 'Unnamed request'}
                                </Text>
                                <Text type='secondary'>
                                    {[viewing.branch, viewing.department].filter(Boolean).join(' · ') ||
                                        '—'}
                                </Text>
                            </div>
                            <Tag
                                color={statusColor(viewing.status)}
                                style={{ marginInlineEnd: 0 }}
                            >
                                {formatStage(viewing.status)}
                            </Tag>
                        </div>

                        {/* Amount and quantity share a row; one column on phones */}
                        <Descriptions column={{ xs: 1, sm: 2 }} size='small' bordered>
                            <Descriptions.Item label='Amount'>
                                {formatMoney(viewing.amount)}
                            </Descriptions.Item>
                            <Descriptions.Item label='Quantity'>
                                {viewing.quantity || '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Purpose' span={2}>
                                {viewing.description || '—'}
                            </Descriptions.Item>
                        </Descriptions>

                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                Files
                            </Text>
                            {files.length ? (
                                <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                    {files.map(file => (
                                        <div
                                            key={file.label}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                padding: '8px 12px',
                                                borderRadius: token.borderRadiusLG,
                                                border: `1px solid ${token.colorBorderSecondary}`,
                                                background: token.colorFillQuaternary
                                            }}
                                        >
                                            <FileTextOutlined
                                                style={{ fontSize: 16, color: token.colorTextSecondary }}
                                            />
                                            <Text style={{ flex: 1, minWidth: 0 }} ellipsis>
                                                {file.label}
                                            </Text>
                                            <Tooltip title={`View ${file.label.toLowerCase()}`}>
                                                <Button
                                                    shape='circle'
                                                    size='small'
                                                    aria-label={`View ${file.label}`}
                                                    icon={<EyeOutlined />}
                                                    onClick={() => setDocUrl(file.url)}
                                                />
                                            </Tooltip>
                                        </div>
                                    ))}
                                </Space>
                            ) : (
                                <Text type='secondary'>No files yet</Text>
                            )}
                        </div>

                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 12 }}>
                                Progress
                            </Text>
                            {/* Horizontal, wrapping onto further rows instead of scrolling */}
                            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                                {progressRows.map(({ start, entries }) => (
                                    <Steps
                                        key={start}
                                        size='small'
                                        progressDot
                                        responsive={false}
                                        initial={start}
                                        current={progressCurrent}
                                        status={viewing.status === 'rejected' ? 'error' : 'process'}
                                        items={entries.map(entry => ({
                                            title: (
                                                <Text style={{ fontSize: 12 }}>
                                                    {formatStage(entry.stage)}
                                                </Text>
                                            ),
                                            description: (
                                                <Text type='secondary' style={{ fontSize: 11 }}>
                                                    {entry.timestamp?.toDate
                                                        ? dayjs(entry.timestamp.toDate()).format(
                                                            'D MMM, HH:mm'
                                                        )
                                                        : '—'}
                                                    {entry.actor && (
                                                        <>
                                                            <br />
                                                            {entry.actor}
                                                        </>
                                                    )}
                                                </Text>
                                            )
                                        }))}
                                    />
                                ))}
                            </Space>
                        </div>
                    </Space>
                )}
            </Modal>

            {/* Quick approve / reject, shared with the In-house Finance Dashboard */}
            <FinanceActionModal
                target={actionTarget ? { kind: 'request', request: actionTarget.row } : null}
                initialMode={actionTarget?.mode}
                user={user as any}
                onClose={() => setActionTarget(null)}
            />

            {/* Supporting document viewer */}
            <Modal
                title='Supporting Document'
                open={!!docUrl}
                onCancel={() => setDocUrl(null)}
                footer={null}
                width={900}
                styles={{ body: { height: '70vh', padding: 0 } }}
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
