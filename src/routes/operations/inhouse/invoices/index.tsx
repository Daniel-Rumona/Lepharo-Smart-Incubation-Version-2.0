// ConsolidatedInvoicePacks.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    DatePicker,
    Grid,
    List,
    Modal,
    Result,
    Row,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    message,
    theme
} from 'antd'
import {
    CheckCircleOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    CloseOutlined,
    EyeOutlined,
    EyeInvisibleOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    WarningOutlined,
    SendOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import FinanceActionModal, { FinanceActionTarget } from '../FinanceActionModal'
import { requestPackInvoice } from '@/lib/financeActions'

const { Title, Text } = Typography

type MovDoc = {
    id?: string
    smmeCompanyName?: string
    smmeName?: string
    smmeSignatureUrl?: string
    smmeDigitalSignature?: string
    facilitatorName?: string
    facilitatorSignatureUrl?: string
    facilitatorDigitalSignature?: string
    signatureURL?: string
    digitalSignature?: string
    interventionTitle?: string
    interventionDate?: any
    interventionsList?: Array<{ title: string; date: any; signature?: string }>
    departmentName?: string
}

type Approval = { step: string; name?: string; role?: string; date?: any }

type ConsolidatedPack = {
    id: string
    department: string
    month: string
    range?: { from: any; to: any }
    totalItems?: number
    approvals?: Approval[]
    createdAt?: any
    invoiceAttachment?: { name?: string; url?: string } | string | null
    interventions?: MovDoc[]
    interventionsSnapshot?: MovDoc[]
    hodName?: string
    hodSignatureUrl?: string
    hodDigitalSignature?: string
    // The head of department who submitted it, asked for the invoice if missing
    hodUid?: string
    // When finance last asked for the invoice
    invoiceRequestedAt?: any
}

type InvoiceDecision = {
    id: string
    packId?: string
    decision?: 'approved' | 'rejected'
    decidedAt?: any
    amount?: number
    reason?: string
    popAttachment?: { name?: string; url?: string }
    invoice?: { name?: string; url?: string } | null
}

type StatusFilter = 'all' | 'awaiting' | 'approved' | 'rejected'
const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'awaiting', label: 'Awaiting' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' }
]

const clip = (s?: string) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—')
const isPdf = (url?: string) => !!url && /\.pdf($|\?)/i.test(url)
const isImage = (url?: string) => !!url && /\.(png|jpe?g|gif|webp)($|\?)/i.test(url)

const formatMoney = (value?: number) =>
    typeof value === 'number'
        ? `R ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : '—'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const toDate = (value: any): Date | undefined => {
    if (!value) return undefined
    const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
}

// Packs reach finance once they have final admin confirmation
const finalApproval = (pack: ConsolidatedPack) =>
    (pack.approvals || []).find(a =>
        ['final_submission', 'final_confirmation'].includes(String(a.step || '').toLowerCase())
    )

const invoiceOf = (pack: ConsolidatedPack) => {
    const inv = pack.invoiceAttachment
    const url = typeof inv === 'string' ? inv : inv?.url
    return url ? { url, name: (typeof inv === 'string' ? '' : inv?.name) || 'Invoice' } : undefined
}

const itemCount = (pack: ConsolidatedPack) =>
    (pack.interventions || pack.interventionsSnapshot || []).length || pack.totalItems || 0

const monthLabel = (m?: string) =>
    m && dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid() ? dayjs(m).format('MMMM YYYY') : m || ''

// ---------- Component ----------
const ConsolidatedInvoicePacks: React.FC = () => {
    const { user } = useFullIdentity()
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()
    const isDesktop = screens.sm !== false
    // Below md, modals become bottom sheets (index.css) and the filter bar stacks
    const isMobile = screens.md === false
    const barCol = (flex: string) => (isMobile ? { span: 24 } : { flex })

    const [livePacks, setAllPacks] = useState<ConsolidatedPack[]>([])
    const [loading, setLoading] = useState(true)
    const [liveDecisions, setDecisionsByPack] = useState<Record<string, InvoiceDecision>>({})

    // filters
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [dept, setDept] = useState<string | undefined>()
    const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(null)

    // modals
    const [activePack, setActivePack] = useState<ConsolidatedPack | null>(null)
    // The invoice preview inside the pack modal, collapsed for each newly opened pack
    const [invoicePreviewOpen, setInvoicePreviewOpen] = useState(false)
    useEffect(() => setInvoicePreviewOpen(false), [activePack?.id])
    const [actionTarget, setActionTarget] = useState<{
        target: FinanceActionTarget
        mode: 'approve' | 'reject'
    } | null>(null)

    // Live packs (previously a one-off fetch with a Refresh button)
    useEffect(() => {
        const unsub = onSnapshot(
            collection(db, 'consolidatedMOVs'),
            snap => {
                setAllPacks(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                setLoading(false)
            },
            error => {
                console.error('consolidatedMOVs onSnapshot error:', error)
                setLoading(false)
            }
        )
        return () => unsub()
    }, [])

    // finance decisions index: packId -> latest decision
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'invoices'), snap => {
            const map: Record<string, InvoiceDecision> = {}
            snap.forEach(d => {
                const data = d.data() as any
                const pid = data.packId
                if (!pid) return
                const prev = map[pid]
                const currTime = data.decidedAt?.toMillis?.() || 0
                const prevTime = prev?.decidedAt?.toMillis?.() || 0
                if (!prev || currTime >= prevTime) {
                    map[pid] = {
                        id: d.id,
                        packId: pid,
                        decision: data.decision,
                        decidedAt: data.decidedAt,
                        amount: data.amount,
                        reason: data.reason,
                        popAttachment: data.popAttachment || undefined,
                        invoice: data.invoice || null
                    }
                }
            })
            setDecisionsByPack(map)
        })
        return () => unsub()
    }, [])

    const allPacks = livePacks
    const decisionsByPack = liveDecisions

    // Only packs that have final admin confirmation
    const confirmedPacks = useMemo(() => allPacks.filter(p => finalApproval(p)), [allPacks])

    const uniqueDepartments = useMemo(
        () =>
            Array.from(new Set(confirmedPacks.map(p => p.department).filter(Boolean))).sort(
                (a, b) => String(a).localeCompare(String(b))
            ),
        [confirmedPacks]
    )

    const decisionOf = (pack: ConsolidatedPack) => decisionsByPack[pack.id]?.decision

    // ---------- metrics (all confirmed packs) ----------
    const metrics = useMemo(() => {
        const awaiting = confirmedPacks.filter(p => !decisionOf(p))
        const approved = confirmedPacks.filter(p => decisionOf(p) === 'approved')
        return {
            awaiting: awaiting.length,
            awaitingMissingInvoice: awaiting.filter(p => !invoiceOf(p)).length,
            approved: approved.length,
            approvedAmount: approved.reduce(
                (t, p) => t + (decisionsByPack[p.id]?.amount ?? 0),
                0
            ),
            rejected: confirmedPacks.filter(p => decisionOf(p) === 'rejected').length,
            missingInvoice: confirmedPacks.filter(p => !invoiceOf(p)).length,
            total: confirmedPacks.length
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmedPacks, decisionsByPack])

    // ---------- filtered list: undecided first, then newest ----------
    const filtered = useMemo(() => {
        const time = (p: ConsolidatedPack) =>
            toDate(finalApproval(p)?.date)?.getTime() ?? toDate(p.createdAt)?.getTime() ?? 0
        return confirmedPacks
            .filter(p => {
                const decision = decisionOf(p)
                const statusMatch =
                    statusFilter === 'all' ||
                    (statusFilter === 'awaiting' && !decision) ||
                    statusFilter === decision
                const month = dayjs(p.month, ['YYYY-MM', 'YYYY-MM-DD'])
                const monthMatch =
                    !selectedMonth || (month.isValid() && month.isSame(selectedMonth, 'month'))
                return statusMatch && monthMatch && (!dept || p.department === dept)
            })
            .sort((a, b) => Number(!decisionOf(b)) - Number(!decisionOf(a)) || time(b) - time(a))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmedPacks, decisionsByPack, statusFilter, dept, selectedMonth])

    const hasFilters = statusFilter !== 'all' || !!dept || !!selectedMonth

    // When finance last asked for this pack's invoice, e.g. '14 Oct'
    const requestedOn = (pack: ConsolidatedPack) => {
        const at = toDate(pack.invoiceRequestedAt)
        return at ? dayjs(at).format('D MMM') : undefined
    }

    const [requestingId, setRequestingId] = useState<string | null>(null)

    const requestInvoice = async (pack: ConsolidatedPack) => {
        setRequestingId(pack.id)
        try {
            await requestPackInvoice(
                { id: pack.id, department: pack.department, month: pack.month, hodUid: pack.hodUid },
                user as any
            )
            message.success(`Invoice requested from ${pack.hodName || 'the head of department'}`)
        } catch (error: any) {
            console.error('Failed to request invoice:', error)
            message.error(error?.message || 'Could not request the invoice')
        } finally {
            setRequestingId(null)
        }
    }

    const openAction = (pack: ConsolidatedPack, mode: 'approve' | 'reject') => {
        setActivePack(null)
        setActionTarget({
            mode,
            target: {
                kind: 'pack',
                pack: {
                    id: pack.id,
                    department: pack.department,
                    month: pack.month,
                    totalItems: itemCount(pack),
                    invoice: invoiceOf(pack)
                }
            }
        })
    }

    // ---------- cards (same design as Resource Requests) ----------
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
            <FileDoneOutlined />
        </div>
    )

    const statusTag = (pack: ConsolidatedPack) => {
        const decision = decisionOf(pack)
        if (!decision)
            return (
                <Tag color='orange' style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                    {invoiceOf(pack) ? 'Decide on invoice' : 'Needs invoice'}
                </Tag>
            )
        return (
            <Tag
                color={decision === 'approved' ? 'green' : 'red'}
                style={{ marginInlineEnd: 0, flexShrink: 0 }}
            >
                Invoice {decision}
            </Tag>
        )
    }

    const renderCard = (pack: ConsolidatedPack) => {
        const awaiting = !decisionOf(pack)
        const invoice = invoiceOf(pack)
        const confirmed = toDate(finalApproval(pack)?.date)
        const amount = decisionsByPack[pack.id]?.amount
        const details = [
            plural(itemCount(pack), 'intervention'),
            confirmed && `Confirmed ${dayjs(confirmed).format('D MMM YYYY')}`,
            typeof amount === 'number' && formatMoney(amount)
        ].filter(Boolean)

        return (
            <Card
                size='small'
                hoverable
                style={{ width: '100%', borderRadius: 12, ...actionStyle(awaiting) }}
                onClick={() => setActivePack(pack)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {iconCircle(awaiting)}
                    {/* Two lines: whose pack and its status, then its contents */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Text strong ellipsis style={{ minWidth: 0 }}>
                                {pack.department || 'Unassigned department'}
                            </Text>
                            <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                {dayjs(pack.month, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                                    ? dayjs(pack.month).format('MMM YYYY')
                                    : pack.month}
                            </Tag>
                            {statusTag(pack)}
                            {!invoice && requestedOn(pack) && (
                                <Tag color='gold' style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                    Requested {requestedOn(pack)}
                                </Tag>
                            )}
                        </div>
                        <Text type='secondary' ellipsis style={{ fontSize: 12, display: 'block' }}>
                            {details.join(' · ')}
                        </Text>
                    </div>
                    <Space
                        size={8}
                        style={{ flexShrink: 0 }}
                        // The buttons mustn't also open the pack
                        onClick={e => e.stopPropagation()}
                    >
                        <Tooltip title='View pack'>
                            <Button
                                shape='circle'
                                aria-label='View pack'
                                icon={<EyeOutlined />}
                                onClick={() => setActivePack(pack)}
                            />
                        </Tooltip>
                        {awaiting && invoice && (
                            <>
                                <Tooltip title='Approve invoice'>
                                    <Button
                                        shape='circle'
                                        type='primary'
                                        aria-label='Approve invoice'
                                        icon={<CheckOutlined />}
                                        onClick={() => openAction(pack, 'approve')}
                                    />
                                </Tooltip>
                                <Tooltip title='Reject'>
                                    <Button
                                        shape='circle'
                                        danger
                                        aria-label='Reject'
                                        icon={<CloseOutlined />}
                                        onClick={() => openAction(pack, 'reject')}
                                    />
                                </Tooltip>
                            </>
                        )}
                        {/* No invoice yet: nothing to approve, so ask for it instead */}
                        {awaiting && !invoice && (
                            <Tooltip
                                title={
                                    requestedOn(pack)
                                        ? `Requested ${requestedOn(pack)}; ask again`
                                        : 'Ask the department for its invoice'
                                }
                            >
                                <Button
                                    type='primary'
                                    shape={isDesktop ? 'round' : 'circle'}
                                    icon={<SendOutlined />}
                                    loading={requestingId === pack.id}
                                    onClick={() => requestInvoice(pack)}
                                >
                                    {isDesktop && 'Request invoice'}
                                </Button>
                            </Tooltip>
                        )}
                    </Space>
                </div>
            </Card>
        )
    }

    const activeInvoice = activePack ? invoiceOf(activePack) : undefined
    const activeDecision = activePack ? decisionsByPack[activePack.id] : undefined

    // ---------- Render ----------
    return (
        <div style={{ padding: isDesktop ? 24 : 12, minHeight: '100vh' }}>
            {/* Metrics: two side by side on mobile */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<ClockCircleOutlined />}
                        tone='warning'
                        title='Awaiting Decision'
                        value={metrics.awaiting}
                        subtitle={
                            metrics.awaitingMissingInvoice
                                ? `${metrics.awaitingMissingInvoice} without an invoice`
                                : 'All have invoices'
                        }
                        loading={loading}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<CheckCircleOutlined />}
                        tone='success'
                        title='Approved'
                        value={metrics.approved}
                        subtitle={`${formatMoney(metrics.approvedAmount)} paid`}
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<CloseCircleOutlined />}
                        tone='danger'
                        title='Rejected'
                        value={metrics.rejected}
                        subtitle={`of ${plural(metrics.total, 'confirmed pack')}`}
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<WarningOutlined />}
                        tone='warning'
                        title='Missing Invoice'
                        value={metrics.missingInvoice}
                        subtitle='Departments still to attach one'
                        loading={loading}
                    />
                </Col>
            </Row>

            <DashboardFilterBar>
                <Row gutter={[12, 12]} align='middle'>
                    <Col {...barCol('2 1 360px')}>
                        <Segmented
                            block
                            value={statusFilter}
                            onChange={value => setStatusFilter(value as StatusFilter)}
                            options={STATUS_OPTIONS}
                        />
                    </Col>
                    <Col {...barCol('1 1 200px')}>
                        <Select
                            allowClear
                            placeholder='All departments'
                            value={dept}
                            onChange={setDept}
                            options={uniqueDepartments.map(d => ({ value: d, label: d }))}
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col {...barCol('1 1 180px')}>
                        <DatePicker
                            picker='month'
                            placeholder='Any month'
                            value={selectedMonth}
                            onChange={setSelectedMonth}
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
                                icon={<FileDoneOutlined />}
                                title='No packs found'
                                subTitle='Nothing matches your filters.'
                                extra={
                                    <Button
                                        onClick={() => {
                                            setStatusFilter('all')
                                            setDept(undefined)
                                            setSelectedMonth(null)
                                        }}
                                    >
                                        Clear filters
                                    </Button>
                                }
                            />
                        ) : (
                            <Result
                                icon={<FileDoneOutlined />}
                                title='No confirmed MOV packs yet'
                                subTitle='Department packs appear here once they have final confirmation.'
                            />
                        )
                    }}
                    renderItem={pack => (
                        <List.Item style={{ padding: '6px 0' }}>{renderCard(pack)}</List.Item>
                    )}
                />
            </motion.div>

            {/* PACK MODAL — document style */}
            <Modal
                open={!!activePack}
                onCancel={() => setActivePack(null)}
                width={1100}
                title={
                    activePack
                        ? `Consolidated MOV • ${activePack.department} • ${monthLabel(activePack.month)}`
                        : 'Pack'
                }
                footer={
                    activePack && !activeDecision?.decision ? (
                        activeInvoice ? (
                            <Row gutter={8}>
                                <Col span={12}>
                                    <Button
                                        block
                                        type='primary'
                                        icon={<CheckOutlined />}
                                        onClick={() => openAction(activePack, 'approve')}
                                    >
                                        Approve invoice
                                    </Button>
                                </Col>
                                <Col span={12}>
                                    <Button
                                        block
                                        danger
                                        icon={<CloseOutlined />}
                                        onClick={() => openAction(activePack, 'reject')}
                                    >
                                        Reject
                                    </Button>
                                </Col>
                            </Row>
                        ) : (
                            // Nothing to decide on until the department attaches an invoice
                            <Button
                                block
                                type='primary'
                                icon={<SendOutlined />}
                                loading={requestingId === activePack.id}
                                onClick={() => requestInvoice(activePack)}
                            >
                                {requestedOn(activePack) ? 'Request invoice again' : 'Request invoice'}
                            </Button>
                        )
                    ) : null
                }
            >
                {activePack && (
                    <div
                        style={{
                            background: token.colorBgContainer,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: 8,
                            padding: 16
                        }}
                    >
                        {/* Header 3 cols */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 2fr 1fr',
                                alignItems: 'center',
                                marginBottom: 12
                            }}
                        >
                            <div style={{ textAlign: 'left' }}>
                                <img
                                    src='/assets/images/Sibanye-brand-logo.png'
                                    alt='Sibanye'
                                    style={{ height: 120, objectFit: 'contain' }}
                                />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <Text type='secondary' style={{ fontSize: 12 }}>
                                    {activePack.department} • {monthLabel(activePack.month)}
                                </Text>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <img
                                    src='/assets/images/lepharo.png'
                                    alt='Lepharo'
                                    style={{ height: 42, objectFit: 'contain' }}
                                />
                            </div>
                        </div>

                        <div
                            style={{
                                borderTop: `1px solid ${token.colorBorderSecondary}`,
                                margin: '6px 0 12px'
                            }}
                        />

                        <Table
                            size='small'
                            bordered
                            pagination={{ pageSize: 8, showSizeChanger: false, hideOnSinglePage: true }}
                            scroll={{ x: 720 }}
                            rowKey={(x: any, i) =>
                                x.id ||
                                `${x.smmeCompanyName}-${x.interventionTitle}-${x.interventionDate}-${i}`
                            }
                            dataSource={(
                                activePack.interventions ||
                                activePack.interventionsSnapshot ||
                                []
                            ).map(x => ({ ...x }))}
                            columns={[
                                { title: 'Beneficiary', dataIndex: 'smmeCompanyName' },
                                { title: 'Intervention', dataIndex: 'interventionTitle' },
                                { title: 'Facilitator', dataIndex: 'facilitatorName' },
                                {
                                    title: 'Date Completed',
                                    dataIndex: 'interventionDate',
                                    render: (val: any) => {
                                        const d = toDate(val)
                                        return d ? dayjs(d).format('YYYY-MM-DD') : '—'
                                    }
                                },
                                {
                                    title: 'Facilitator Signature',
                                    render: (_: any, mov: MovDoc) => {
                                        const img = mov.facilitatorSignatureUrl || mov.signatureURL
                                        const crypto =
                                            mov.facilitatorDigitalSignature || mov.digitalSignature
                                        return img ? (
                                            <img
                                                src={img}
                                                alt='Facilitator signature'
                                                style={{ height: 36 }}
                                            />
                                        ) : (
                                            <span style={{ fontFamily: 'monospace' }}>
                                                {clip(crypto)}
                                            </span>
                                        )
                                    }
                                }
                            ]}
                        />

                        {/* Invoice and finance status */}
                        <div
                            style={{
                                marginTop: 12,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                flexWrap: 'wrap'
                            }}
                        >
                            {activeInvoice ? (
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        flex: '1 1 280px',
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
                                        {activeInvoice.name}
                                    </Text>
                                    <Tooltip title={invoicePreviewOpen ? 'Hide invoice' : 'View invoice'}>
                                        <Button
                                            shape='circle'
                                            size='small'
                                            aria-label={invoicePreviewOpen ? 'Hide invoice' : 'View invoice'}
                                            icon={invoicePreviewOpen ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                            onClick={() => setInvoicePreviewOpen(open => !open)}
                                        />
                                    </Tooltip>
                                </div>
                            ) : (
                                <Tag color='volcano'>No invoice attached</Tag>
                            )}
                            {statusTag(activePack)}
                            {activeDecision?.decision === 'rejected' && activeDecision.reason && (
                                <Text type='danger' style={{ fontSize: 12 }}>
                                    {activeDecision.reason}
                                </Text>
                            )}
                        </div>

                        {/* Invoice preview opens in place rather than in a second modal */}
                        {activeInvoice && invoicePreviewOpen && (
                            <div
                                style={{
                                    marginTop: 12,
                                    borderRadius: token.borderRadiusLG,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    overflow: 'hidden'
                                }}
                            >
                                {isPdf(activeInvoice.url) ? (
                                    <embed
                                        src={activeInvoice.url}
                                        type='application/pdf'
                                        style={{ width: '100%', height: 560, border: 0, display: 'block' }}
                                    />
                                ) : isImage(activeInvoice.url) ? (
                                    <img
                                        src={activeInvoice.url}
                                        alt='Invoice'
                                        style={{
                                            width: '100%',
                                            maxHeight: 560,
                                            objectFit: 'contain',
                                            display: 'block'
                                        }}
                                    />
                                ) : (
                                    // Other file types can't be shown inline
                                    <div style={{ padding: 16 }}>
                                        <a href={activeInvoice.url} target='_blank' rel='noreferrer'>
                                            Open invoice in a new tab
                                        </a>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Signatures bottom */}
                        <div
                            style={{
                                borderTop: `1px solid ${token.colorBorderSecondary}`,
                                margin: '14px 0 10px'
                            }}
                        />
                        <Title level={5} style={{ margin: '0 0 8px' }}>
                            Signatures
                        </Title>
                        <Row gutter={[24, 16]}>
                            <Col xs={24} md={12}>
                                {(() => {
                                    const first = (activePack.interventions ||
                                        activePack.interventionsSnapshot ||
                                        [])[0] as MovDoc | undefined
                                    const smmeName =
                                        first?.smmeName || first?.smmeCompanyName || '—'
                                    const smmeSig = first?.smmeSignatureUrl
                                    const smmeCrypto = first?.smmeDigitalSignature
                                    return (
                                        <div>
                                            <div style={{ marginBottom: 4 }}>
                                                <Text strong>Client (SMME) Name: </Text>
                                                <Text>{smmeName}</Text>
                                            </div>
                                            <div style={{ marginBottom: 4 }}>
                                                <Text strong>Signature: </Text>
                                                {smmeSig ? (
                                                    <img
                                                        src={smmeSig}
                                                        alt='SMME signature'
                                                        style={{
                                                            height: 48,
                                                            border: `1px dashed ${token.colorBorder}`,
                                                            padding: 4
                                                        }}
                                                    />
                                                ) : (
                                                    <em>—</em>
                                                )}
                                            </div>
                                            <Text type='secondary'>
                                                Cryptographic: {clip(smmeCrypto)}
                                            </Text>
                                        </div>
                                    )
                                })()}
                            </Col>
                            <Col xs={24} md={12}>
                                <div>
                                    <div style={{ marginBottom: 4 }}>
                                        <Text strong>HOD Name: </Text>
                                        <Text>{activePack.hodName || '—'}</Text>
                                    </div>
                                    <div style={{ marginBottom: 4 }}>
                                        <Text strong>Signature: </Text>
                                        {activePack.hodSignatureUrl ? (
                                            <img
                                                src={activePack.hodSignatureUrl}
                                                alt='HOD signature'
                                                style={{
                                                    height: 48,
                                                    border: `1px dashed ${token.colorBorder}`,
                                                    padding: 4
                                                }}
                                            />
                                        ) : (
                                            <em>—</em>
                                        )}
                                    </div>
                                    <Text type='secondary'>
                                        Cryptographic: {clip(activePack.hodDigitalSignature)}
                                    </Text>
                                </div>
                            </Col>
                        </Row>
                    </div>
                )}
            </Modal>

            {/* Quick approve / reject, shared with the dashboard and Resource Requests */}
            <FinanceActionModal
                target={actionTarget?.target ?? null}
                initialMode={actionTarget?.mode}
                user={user as any}
                onClose={() => setActionTarget(null)}
            />
        </div>
    )
}

export default ConsolidatedInvoicePacks
