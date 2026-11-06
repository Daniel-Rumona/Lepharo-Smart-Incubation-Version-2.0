import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Tag,
    Typography,
    Space,
    Tooltip,
    Empty,
    Spin,
    message,
    List,
    theme,
    Button
} from 'antd'
import {
    FileDoneOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DollarOutlined,
    ArrowRightOutlined,
    CheckOutlined,
    SendOutlined,
    HistoryOutlined,
    ShoppingOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import {
    collection,
    onSnapshot,
    query,
    where,
    Timestamp,
    DocumentData
} from 'firebase/firestore'
import { db } from '@/firebase'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { useBranchNames } from '@/lib/useBranchNames'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import {
    FINANCE_ACTION_STAGES,
    FINANCE_STEP_LABEL,
    PAID_STAGES,
    QUOTE_STAGES,
    financeStepFor,
    requestPackInvoice
} from '@/lib/financeActions'
import FinanceActionModal, { FinanceActionTarget } from './FinanceActionModal'

const { Text } = Typography

type StageKey =
    | 'awaiting_purchase_approval'
    | 'pending_quotation'
    | 'quotation_submitted'
    | 'quotation_approved'
    | 'invoice_requested'
    | 'invoice_uploaded'
    | 'invoice_approved'
    | 'ceo_approval'
    | 'completed'

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

const startCase = (value: string) =>
    value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase())
        .replace(/\bCeo\b/g, 'CEO')

const formatStage = (stage?: string) =>
    stage
        ? STAGE_LABELS[stage] ?? startCase(stage)
        : '—'

const colorKey = (stage?: string) =>
    stage === 'pending_purchase_approval'
        ? 'awaiting_purchase_approval'
        : stage || ''

type StageEntry = {
    actor?: string
    stage: StageKey | string
    timestamp?: Timestamp
}

type ResourceRequest = {
    id: string

    department?: string
    branch?: string
    requestedFrom?: string

    requestType?: string

    resourceName?: string
    description?: string

    quantity?: number
    amount?: number

    neededBy?: any

    status?: string

    stageHistory?: StageEntry[]
    progress?: StageEntry[]

    createdAt?: Timestamp
    updatedAt?: Timestamp

    requesterEmail?: string
    requesterName?: string

    quotationUrl?: string
    invoiceUrl?: string
    popUrl?: string
}

type MovAttachment = {
    name?: string
    url: string
}

// A department's consolidated MOV pack once it has final confirmation, with
// finance's invoice decision (none yet = waiting on finance)
type MovPack = {
    id: string
    department?: string
    month?: string
    totalItems?: number
    confirmedAt?: Date
    invoice?: MovAttachment
    decision?: 'approved' | 'rejected'
    // Who submitted it (asked for the invoice if missing) and when finance last asked
    hodUid?: string
    invoiceRequestedAt?: Date
}

const STAGE_COLORS: Record<string, string> = {
    awaiting_purchase_approval: 'default',
    pending_quotation: 'gold',
    quotation_submitted: 'processing',
    quotation_approved: 'green',
    invoice_requested: 'orange',
    invoice_uploaded: 'blue',
    invoice_approved: 'geekblue',
    ceo_approval: 'purple',
    completed: 'success',
    rejected: 'error'
}

const formatMoney = (value?: number) =>
    typeof value === 'number'
        ? `R ${value.toLocaleString(undefined, {
            maximumFractionDigits: 2
        })}`
        : '—'

const getLatestStage = (
    history?: StageEntry[]
): StageEntry | undefined => {
    if (!history?.length) {
        return undefined
    }

    return [...history].sort((first, second) => {
        const firstTime =
            first.timestamp?.toMillis?.() ?? 0

        const secondTime =
            second.timestamp?.toMillis?.() ?? 0

        return secondTime - firstTime
    })[0]
}

const stageToColor = (stage?: string) =>
    STAGE_COLORS[colorKey(stage)] ||
    'default'

const getRequestWorkflowHistory = (
    request: ResourceRequest
) =>
    Array.isArray(request.stageHistory) &&
        request.stageHistory.length
        ? request.stageHistory
        : request.progress

const getRequestStage = (
    request: ResourceRequest
) => {
    const latest =
        getLatestStage(
            getRequestWorkflowHistory(request)
        )

    return (
        String(
            latest?.stage ||
            request.status ||
            ''
        ).trim() ||
        'unknown'
    )
}

const InhouseFinanceDashboard: React.FC = () => {
    const [
        loadingReq,
        setLoadingReq
    ] = useState(true)

    const [
        loadingMovs,
        setLoadingMovs
    ] = useState(true)

    const [
        liveRequests,
        setRequests
    ] = useState<ResourceRequest[]>([])

    const [
        movPacks,
        setMovs
    ] = useState<MovPack[]>([])

    const [
        decisionsByPack,
        setDecisionsByPack
    ] = useState<Record<string, 'approved' | 'rejected' | undefined>>({})

    const { token } = theme.useToken()
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    // The item open in the quick approve/reject modal
    const [actionTarget, setActionTarget] = useState<FinanceActionTarget | null>(null)

    const branchNames = useBranchNames()

    const requests = useMemo(() => {
        // Requests only store the branch id (requestedFrom); show its name
        return liveRequests.map(r => ({
            ...r,
            branch: (r.requestedFrom && branchNames[r.requestedFrom]) || ''
        }))
    }, [liveRequests, branchNames])

    const movs = useMemo(
        () => movPacks.map(pack => ({ ...pack, decision: decisionsByPack[pack.id] })),
        [movPacks, decisionsByPack]
    )

    /*
     * ---------------------------------------------------------
     * RESOURCE REQUESTS
     * ---------------------------------------------------------
     *
     * Internal finance requests are selected by request type.
     */
    useEffect(() => {
        setLoadingReq(true)

        const requestQuery = query(
            collection(
                db,
                'resourceRequests'
            ),
            where(
                'requestType',
                '==',
                'internal'
            )
        )

        const unsubscribe =
            onSnapshot(
                requestQuery,

                snapshot => {
                    const rows:
                        ResourceRequest[] =
                        snapshot.docs.map(
                            documentSnapshot => {
                                const data =
                                    documentSnapshot.data() as any

                                const progress:
                                    StageEntry[] =
                                    Array.isArray(
                                        data.progress
                                    )
                                        ? data.progress
                                        : []

                                const stageHistory:
                                    StageEntry[] =
                                    Array.isArray(
                                        data.stageHistory
                                    )
                                        ? data.stageHistory
                                        : progress

                                const lastTimestamp =
                                    stageHistory.length
                                        ? stageHistory[
                                            stageHistory.length -
                                            1
                                        ]?.timestamp
                                        : undefined

                                const rawAmount =
                                    data.amount ??
                                    data.totalAmount ??
                                    data.estimatedAmount ??
                                    data.cost ??
                                    0

                                return {
                                    id:
                                        documentSnapshot.id,

                                    department:
                                        data.department ??
                                        data.departmentName ??
                                        '',

                                    // Requests store only the branch id; its
                                    // name is looked up when rows are built
                                    requestedFrom:
                                        data.requestedFrom ??
                                        '',

                                    requestType:
                                        data.requestType ??
                                        '',

                                    resourceName:
                                        data.resourceName ??
                                        data.resource ??
                                        '',

                                    description:
                                        data.purpose ??
                                        data.description ??
                                        '',

                                    neededBy:
                                        data.neededBy ??
                                        null,

                                    quantity:
                                        Number(
                                            data.quantity ??
                                            0
                                        ),

                                    amount:
                                        Number(
                                            rawAmount ||
                                            0
                                        ),

                                    status:
                                        data.status ??
                                        'pending_purchase_approval',

                                    progress,

                                    stageHistory,

                                    createdAt:
                                        data.createdAt,

                                    updatedAt:
                                        data.updatedAt ??
                                        lastTimestamp ??
                                        data.createdAt,

                                    requesterEmail:
                                        data.requesterEmail ??
                                        data.requestedFrom ??
                                        '',

                                    requesterName:
                                        data.requesterName ??
                                        data.requestedBy ??
                                        '',

                                    quotationUrl:
                                        data.quotationUrl ??
                                        data.quotationFile ??
                                        '',

                                    invoiceUrl:
                                        data.invoiceUrl ??
                                        data.invoiceFile ??
                                        '',

                                    popUrl:
                                        data.popUrl ??
                                        data.popFile ??
                                        ''
                                }
                            }
                        )

                    rows.sort(
                        (
                            first,
                            second
                        ) => {
                            const firstTime =
                                first.updatedAt
                                    ?.toMillis?.() ??
                                first.createdAt
                                    ?.toMillis?.() ??
                                0

                            const secondTime =
                                second.updatedAt
                                    ?.toMillis?.() ??
                                second.createdAt
                                    ?.toMillis?.() ??
                                0

                            return (
                                secondTime -
                                firstTime
                            )
                        }
                    )

                    setRequests(
                        rows
                    )

                    setLoadingReq(
                        false
                    )
                },

                error => {
                    console.error(
                        'resourceRequests onSnapshot error:',
                        error
                    )

                    message.error(
                        error.code ===
                            'failed-precondition'
                            ? 'A Firestore index is required for the resource request query.'
                            : `Failed to load requests: ${error.code ||
                            error.message
                            }`
                    )

                    setLoadingReq(
                        false
                    )
                }
            )

        return () =>
            unsubscribe()
    }, [])

    /*
     * ---------------------------------------------------------
     * MOV PACKS AWAITING FINANCE
     * ---------------------------------------------------------
     * Mirrors the Departmental Invoices page: a department's pack reaches
     * finance once it has final confirmation, and finance's approve/reject
     * decision is recorded in `invoices` against the pack id. No decision yet
     * means it needs finance's action.
     */
    useEffect(() => {
        setLoadingMovs(true)
        const unsubscribe = onSnapshot(
            collection(db, 'consolidatedMOVs'),
            snapshot => {
                const rows: MovPack[] = []
                snapshot.docs.forEach(d => {
                    const data = d.data() as DocumentData
                    const approvals: Array<{ step?: string; date?: any; at?: any; timestamp?: any }> =
                        Array.isArray(data.approvals) ? data.approvals : []
                    const final = approvals.find(a =>
                        ['final_submission', 'final_confirmation'].includes(
                            String(a.step || '').toLowerCase()
                        )
                    )
                    if (!final) return
                    // Packs store the approval time in `date`; older entries may use at/timestamp
                    const finalAt = final.date || final.at || final.timestamp
                    const invoice =
                        typeof data.invoiceAttachment === 'string'
                            ? { url: data.invoiceAttachment }
                            : data.invoiceAttachment?.url
                              ? data.invoiceAttachment
                              : undefined
                    rows.push({
                        id: d.id,
                        department: data.department ?? data.departmentName,
                        month: data.month,
                        totalItems: Number.isFinite(data.totalItems)
                            ? data.totalItems
                            : (data.interventions || data.interventionsSnapshot || []).length,
                        confirmedAt:
                            finalAt?.toDate?.() ?? (finalAt ? new Date(finalAt) : undefined),
                        invoice,
                        hodUid: data.hodUid,
                        invoiceRequestedAt: data.invoiceRequestedAt?.toDate?.()
                    })
                })
                setMovs(rows)
                setLoadingMovs(false)
            },
            error => {
                console.error('consolidatedMOVs onSnapshot error:', error)
                message.error('Failed to load MOV packs.')
                setLoadingMovs(false)
            }
        )
        return () => unsubscribe()
    }, [])

    // Latest finance decision per pack
    useEffect(() => {
        const unsubscribe = onSnapshot(
            collection(db, 'invoices'),
            snapshot => {
                const latest: Record<string, { decision?: 'approved' | 'rejected'; at: number }> =
                    {}
                snapshot.forEach(d => {
                    const data = d.data() as DocumentData
                    if (!data.packId) return
                    const at = data.decidedAt?.toMillis?.() || 0
                    if (!latest[data.packId] || at >= latest[data.packId].at) {
                        latest[data.packId] = { decision: data.decision, at }
                    }
                })
                setDecisionsByPack(
                    Object.fromEntries(Object.entries(latest).map(([id, v]) => [id, v.decision]))
                )
            },
            error => console.error('invoices onSnapshot error:', error)
        )
        return () => unsubscribe()
    }, [])

    /*
     * ---------------------------------------------------------
     * METRICS
     * ---------------------------------------------------------
     */
    // Finance's own steps and the paid stages come from lib/financeActions,
    // shared with the Resource Requests page

    const metrics = useMemo(() => {
        const sum = (list: ResourceRequest[]) =>
            list.reduce((total, request) => total + (request.amount ?? 0), 0)
        const byStage = (stages: string[]) =>
            requests.filter(request => stages.includes(getRequestStage(request)))

        const action = byStage(FINANCE_ACTION_STAGES)
        const paid = byStage(PAID_STAGES)
        const rejected = byStage(['rejected'])
        const open = requests.filter(
            request =>
                ![...PAID_STAGES, 'rejected'].includes(getRequestStage(request))
        )

        return {
            actionCount: action.length,
            quotationsToApprove: action.filter(
                request => QUOTE_STAGES.includes(getRequestStage(request))
            ).length,
            invoicesToApprove: action.filter(
                request => getRequestStage(request) === 'invoice_uploaded'
            ).length,
            paidAmount: sum(paid),
            paidCount: paid.length,
            openAmount: sum(open),
            openCount: open.length,
            rejectedCount: rejected.length,
            rejectedAmount: sum(rejected)
        }
    }, [requests])

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

    // Card header with how many items in it are waiting on finance
    const panelTitle = (label: string, actionCount: number) => (
        <Space size={8}>
            {label}
            {actionCount > 0 && (
                <Tag color='orange' style={{ marginInlineEnd: 0, fontWeight: 400 }}>
                    {actionCount} need{actionCount === 1 ? 's' : ''} action
                </Tag>
            )}
        </Space>
    )

    /*
     * ---------------------------------------------------------
     * THIS MONTH'S CARDS
     * ---------------------------------------------------------
     * The panels show this month's items plus anything older that is still
     * waiting on finance (so outstanding work never drops off the dashboard).
     * Everything else lives on the full pages behind "View All".
     */
    const monthStart = dayjs().startOf('month').valueOf()
    const monthLabel = dayjs().format('MMMM')

    const requestNeedsAction = (request: ResourceRequest) =>
        FINANCE_ACTION_STAGES.includes(getRequestStage(request))
    const requestIsOlder = (request: ResourceRequest) =>
        (request.createdAt?.toMillis?.() ?? 0) < monthStart
    const packIsOlder = (pack: MovPack) => (pack.confirmedAt?.getTime() ?? 0) < monthStart

    // Finance's own to-do comes first; within each group, newest first
    const filteredRequests = useMemo(
        () =>
            requests
                .filter(request => !requestIsOlder(request) || requestNeedsAction(request))
                .sort(
                    (a, b) =>
                        Number(requestNeedsAction(b)) - Number(requestNeedsAction(a)) ||
                        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
                ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [requests, monthStart]
    )

    // Packs without a finance decision first; then most recently confirmed
    const sortedMovs = useMemo(
        () =>
            movs
                // Only packs confirmed this month; older ones awaiting a decision are summarised in one card
                .filter(pack => !packIsOlder(pack))
                .sort(
                    (a, b) =>
                        Number(!b.decision) - Number(!a.decision) ||
                        (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0)
                ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [movs, monthStart]
    )

    const requestActionCount = filteredRequests.filter(requestNeedsAction).length
    const movActionCount = movs.filter(pack => !pack.decision).length

    // Older packs still waiting on a decision, shown as one summary card
    const carriedOverPacks = movs.filter(pack => packIsOlder(pack) && !pack.decision)

    // For a pack with no invoice: ask its head of department to attach one
    const [requestingId, setRequestingId] = useState<string | null>(null)
    const requestInvoiceButton = (pack: MovPack) => {
        const asked = pack.invoiceRequestedAt
            ? `Requested ${dayjs(pack.invoiceRequestedAt).format('D MMM')}; ask again`
            : 'Request invoice from the department'
        return (
            <Tooltip title={asked}>
                <Button
                    shape='circle'
                    type='primary'
                    aria-label='Request invoice'
                    icon={<SendOutlined />}
                    loading={requestingId === pack.id}
                    onClick={async () => {
                        setRequestingId(pack.id)
                        try {
                            await requestPackInvoice(pack, user as any)
                            message.success('Invoice requested')
                        } catch (error: any) {
                            message.error(error?.message || 'Could not request the invoice')
                        } finally {
                            setRequestingId(null)
                        }
                    }}
                />
            </Tooltip>
        )
    }

    // Round button that opens the quick approve/reject modal for one item
    const quickButton = (onClick: () => void, label: string) => (
        <Tooltip title={label}>
            <Button
                shape='circle'
                type='primary'
                aria-label={label}
                icon={<CheckOutlined />}
                onClick={onClick}
            />
        </Tooltip>
    )

    // Round arrow button that opens the page where the item is actioned
    const goButton = (path: string, label: string) => (
        <Tooltip title={label}>
            <Button
                shape='circle'
                type='primary'
                aria-label={label}
                icon={<ArrowRightOutlined />}
                onClick={() => navigate(path)}
            />
        </Tooltip>
    )

    /*
     * ---------------------------------------------------------
     * CARDS (same two-line design as the Resources page)
     * ---------------------------------------------------------
     */
    // Items waiting on finance get a warning-coloured edge and tinted
    // background so they stand out from ones waiting on someone else
    const actionStyle = (needsAction: boolean): React.CSSProperties =>
        needsAction
            ? {
                borderColor: token.colorWarningBorder,
                borderLeft: `4px solid ${token.colorWarning}`,
                background: token.colorWarningBg
            }
            : {}

    const iconCircle = (icon: React.ReactNode, needsAction = false) => (
        <div
            style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 16,
                flexShrink: 0,
                background: needsAction ? token.colorWarningBgHover : token.colorPrimaryBg,
                color: needsAction ? token.colorWarning : token.colorPrimary
            }}
        >
            {icon}
        </div>
    )

    const renderRequestCard = (request: ResourceRequest) => {
        const latest = getLatestStage(getRequestWorkflowHistory(request))
        const stage = String(latest?.stage || request.status || '—')
        const step = financeStepFor(getRequestStage(request))
        const actionLabel = step ? FINANCE_STEP_LABEL[step] : undefined
        const needsAction = Boolean(actionLabel)
        const when = latest?.timestamp
            ? dayjs(latest.timestamp.toDate()).format('DD MMM YYYY HH:mm')
            : undefined
        const requestedOn = request.createdAt
            ? dayjs(request.createdAt.toDate()).format('D MMM YYYY')
            : undefined
        const details = [
            // Older than this month: only here because it still needs action
            requestIsOlder(request) && 'Carried over',
            request.branch,
            request.department,
            Number.isFinite(request.quantity) ? `×${request.quantity}` : undefined,
            requestedOn && `Requested ${requestedOn}`
        ].filter(Boolean)

        return (
            <Card
                size='small'
                style={{ width: '100%', borderRadius: 12, ...actionStyle(needsAction) }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {iconCircle(<ShoppingOutlined />, needsAction)}
                    {/* Two lines: what and where it's at, then who and when */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Text strong ellipsis style={{ minWidth: 0 }}>
                                {request.resourceName || 'Unnamed request'}
                            </Text>
                            {needsAction ? (
                                <Tag color='orange' style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                    {actionLabel}
                                </Tag>
                            ) : (
                                <Tooltip
                                    title={
                                        latest?.actor || when
                                            ? [latest?.actor, when].filter(Boolean).join(' · ')
                                            : undefined
                                    }
                                >
                                    <Tag
                                        color={stageToColor(stage)}
                                        style={{ marginInlineEnd: 0, flexShrink: 0 }}
                                    >
                                        {formatStage(stage)}
                                    </Tag>
                                </Tooltip>
                            )}
                            {request.requestType && (
                                <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                    {request.requestType}
                                </Tag>
                            )}
                        </div>
                        <Text type='secondary' ellipsis style={{ fontSize: 12, display: 'block' }}>
                            {details.join(' · ') || '—'}
                        </Text>
                    </div>
                    <Space size={8} style={{ flexShrink: 0 }}>
                        {typeof request.amount === 'number' && (
                            <Text strong>{formatMoney(request.amount)}</Text>
                        )}
                        {needsAction && (
                            quickButton(
                                () =>
                                    setActionTarget({
                                        kind: 'request',
                                        // The trail decides the stage, so pass it as the status
                                        request: { ...request, status: getRequestStage(request) }
                                    }),
                                actionLabel || 'Review'
                            )
                        )}
                    </Space>
                </div>
            </Card>
        )
    }

    const renderMovCard = (pack: MovPack) => {
        const needsAction = !pack.decision
        const month = pack.month ? dayjs(pack.month, ['YYYY-MM', 'YYYY-MM-DD']) : null
        const details = [
            Number.isFinite(pack.totalItems) && `${pack.totalItems} interventions`,
            pack.confirmedAt && `Confirmed ${dayjs(pack.confirmedAt).format('D MMM YYYY')}`,
            !pack.invoice &&
                pack.invoiceRequestedAt &&
                `Invoice requested ${dayjs(pack.invoiceRequestedAt).format('D MMM')}`
        ].filter(Boolean)

        return (
            <Card
                size='small'
                style={{ width: '100%', borderRadius: 12, ...actionStyle(needsAction) }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {iconCircle(<FileDoneOutlined />, needsAction)}
                    {/* Two lines: whose pack and its invoice status, then its contents */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Text strong ellipsis style={{ minWidth: 0 }}>
                                {pack.department || 'Unassigned department'}
                            </Text>
                            {month?.isValid() && (
                                <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                    {month.format('MMM YYYY')}
                                </Tag>
                            )}
                            {needsAction ? (
                                <Tag color='orange' style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                    {pack.invoice ? 'Decide on invoice' : 'Needs invoice'}
                                </Tag>
                            ) : (
                                <Tag
                                    color={pack.decision === 'approved' ? 'green' : 'red'}
                                    style={{ marginInlineEnd: 0, flexShrink: 0 }}
                                >
                                    Invoice {pack.decision}
                                </Tag>
                            )}
                        </div>
                        <Text type='secondary' ellipsis style={{ fontSize: 12, display: 'block' }}>
                            {details.join(' · ') || '—'}
                            {pack.invoice?.url && (
                                <>
                                    {details.length > 0 && ' · '}
                                    <a href={pack.invoice.url} target='_blank' rel='noreferrer'>
                                        {pack.invoice.name || 'Invoice'}
                                    </a>
                                </>
                            )}
                        </Text>
                    </div>
                    {needsAction &&
                        (pack.invoice
                            ? quickButton(
                                  () => setActionTarget({ kind: 'pack', pack }),
                                  'Decide on invoice'
                              )
                            : // No invoice yet: nothing to decide, so ask for it
                              requestInvoiceButton(pack))}
                </div>
            </Card>
        )
    }

    const listProps = {
        rowKey: 'id',
        split: false,
        pagination: { pageSize: 8, hideOnSinglePage: true }
    } as const

    return (
        <div
            style={{
                padding:
                    24,
                minHeight:
                    '100vh'
            }}
        >
            <Helmet>
                <title>
                    In-house Finance Dashboard
                </title>
            </Helmet>

            <Row
                gutter={[
                    16,
                    16
                ]}
                style={{
                    marginBottom:
                        24
                }}
            >
                {/* Two metrics fit side by side on mobile: what finance must do, and what's been paid */}
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<ClockCircleOutlined />}
                        tone='warning'
                        title='Needs Finance Action'
                        value={metrics.actionCount + movActionCount}
                        subtitle={[
                            plural(metrics.quotationsToApprove, 'quotation'),
                            plural(metrics.invoicesToApprove, 'invoice'),
                            plural(movActionCount, 'MOV pack')
                        ].join(' · ')}
                        loading={loadingReq}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<DollarOutlined />}
                        tone='success'
                        title='Paid'
                        value={formatMoney(metrics.paidAmount)}
                        subtitle={plural(metrics.paidCount, 'request')}
                        loading={loadingReq}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<FileDoneOutlined />}
                        tone='info'
                        title='In Pipeline'
                        value={formatMoney(metrics.openAmount)}
                        subtitle={`${plural(metrics.openCount, 'open request')}, not yet paid`}
                        loading={loadingReq}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<CloseCircleOutlined />}
                        tone='danger'
                        title='Rejected'
                        value={metrics.rejectedCount}
                        subtitle={`${formatMoney(metrics.rejectedAmount)} not spent`}
                        loading={loadingReq}
                    />
                </Col>
            </Row>

            {/* Requests and MOVs side by side on wide screens, stacked below that */}
            <Row gutter={[16, 16]} align="stretch">
                <Col xs={24} xl={12}>
                    <Card
                        style={{
                            boxShadow:
                                '0 12px 32px rgba(0,0,0,0.12)',

                            borderRadius:
                                12,

                            border:
                                '1px solid #d6e4ff',

                            // Same height as the MOVs card beside it
                            height:
                                '100%'
                        }}
                        title={panelTitle(`Resource Requests · ${monthLabel}`, requestActionCount)}
                        extra={
                            <Button type='link' onClick={() => navigate('/operations/inhouse/requested')}>
                                View All
                            </Button>
                        }
                    >
                        {loadingReq ? (
                            <div
                                style={{
                                    minHeight:
                                        180,

                                    display:
                                        'flex',

                                    alignItems:
                                        'center',

                                    justifyContent:
                                        'center'
                                }}
                            >
                                <Spin />
                            </div>
                        ) : filteredRequests.length ? (
                            <List
                                {...listProps}
                                dataSource={filteredRequests}
                                // Five per page with simple prev/next; no page-size picker
                                pagination={{
                                    pageSize: 5,
                                    showSizeChanger: false,
                                    hideOnSinglePage: true
                                }}
                                renderItem={request => (
                                    <List.Item style={{ padding: '6px 0' }}>
                                        {renderRequestCard(request)}
                                    </List.Item>
                                )}
                            />
                        ) : (
                            <Empty description='No requests this month' />
                        )}
                    </Card>
                </Col>

                <Col xs={24} xl={12}>
                    <Card
                        style={{
                            boxShadow:
                                '0 12px 32px rgba(0,0,0,0.12)',

                            borderRadius:
                                12,

                            border:
                                '1px solid #d6e4ff',

                            height:
                                '100%'
                        }}
                        title={panelTitle(`MOV Packs · ${monthLabel}`, movActionCount)}
                        extra={
                            <Button type='link' onClick={() => navigate('/operations/inhouse/invoices')}>
                                View All
                            </Button>
                        }
                    >
                        {carriedOverPacks.length > 0 && (
                            <Card
                                size='small'
                                style={{
                                    width: '100%',
                                    borderRadius: 12,
                                    marginBottom: 6,
                                    ...actionStyle(true)
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {iconCircle(<HistoryOutlined />, true)}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Text strong style={{ display: 'block' }}>
                                            {plural(carriedOverPacks.length, 'pack')} carried over
                                        </Text>
                                        <Text
                                            type='secondary'
                                            ellipsis
                                            style={{ fontSize: 12, display: 'block' }}
                                        >
                                            From earlier months, still awaiting an invoice decision
                                            {' · '}
                                            {Array.from(
                                                new Set(
                                                    carriedOverPacks.map(
                                                        pack => pack.department || 'Unassigned'
                                                    )
                                                )
                                            ).join(', ')}
                                        </Text>
                                    </div>
                                    {goButton(
                                        '/operations/inhouse/invoices',
                                        'View carried-over packs'
                                    )}
                                </div>
                            </Card>
                        )}
                        {loadingMovs ? (
                            <div
                                style={{
                                    minHeight:
                                        180,

                                    display:
                                        'flex',

                                    alignItems:
                                        'center',

                                    justifyContent:
                                        'center'
                                }}
                            >
                                <Spin />
                            </div>
                        ) : sortedMovs.length ? (
                            <List
                                {...listProps}
                                dataSource={sortedMovs}
                                renderItem={mov => (
                                    <List.Item style={{ padding: '6px 0' }}>
                                        {renderMovCard(mov)}
                                    </List.Item>
                                )}
                            />
                        ) : (
                            <Empty description='No MOV packs this month' />
                        )}
                    </Card>
                </Col>
            </Row>

            {/* Quick approve / reject for requests and MOV packs */}
            <FinanceActionModal
                target={actionTarget}
                user={user as any}
                onClose={() => setActionTarget(null)}
            />
        </div>
    )
}

export default InhouseFinanceDashboard
