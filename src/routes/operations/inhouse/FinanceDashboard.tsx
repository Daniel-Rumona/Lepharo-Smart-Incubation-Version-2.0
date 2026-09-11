import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Statistic,
    Table,
    Tag,
    Typography,
    Space,
    Select,
    Tooltip,
    Empty,
    Spin,
    message
} from 'antd'
import {
    FileDoneOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DollarOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import {
    collection,
    onSnapshot,
    query,
    where,
    orderBy,
    Timestamp,
    DocumentData
} from 'firebase/firestore'
import { db } from '@/firebase'

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

type ConsolidatedMov = {
    id: string

    status:
    | 'approved'
    | 'pending'
    | 'rejected'

    programName?: string

    department?: string

    beneficiaryName?: string
    participantId?: string

    periodKey?: string

    approvedAt?: Timestamp

    invoiceAttachments?: MovAttachment[]
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
        requests,
        setRequests
    ] = useState<ResourceRequest[]>([])

    const [
        movs,
        setMovs
    ] = useState<ConsolidatedMov[]>([])

    const [
        stageFilter,
        setStageFilter
    ] = useState<string | undefined>(
        undefined
    )

    const [
        typeFilter,
        setTypeFilter
    ] = useState<string | undefined>(
        undefined
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

                                    branch:
                                        data.branch ??
                                        data.branchName ??
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
     * APPROVED CONSOLIDATED MOVS
     * ---------------------------------------------------------
     */
    useEffect(() => {
        setLoadingMovs(true)

        const movQuery = query(
            collection(
                db,
                'consolidatedMovs'
            ),
            where(
                'status',
                '==',
                'approved'
            ),
            orderBy(
                'approvedAt',
                'desc'
            )
        )

        const unsubscribe =
            onSnapshot(
                movQuery,

                snapshot => {
                    const rows:
                        ConsolidatedMov[] =
                        snapshot.docs.map(
                            documentSnapshot => {
                                const data =
                                    documentSnapshot.data() as DocumentData

                                return {
                                    id:
                                        documentSnapshot.id,

                                    status:
                                        data.status,

                                    programName:
                                        data.programName,

                                    department:
                                        data.department ??
                                        data.departmentName,

                                    beneficiaryName:
                                        data.beneficiaryName,

                                    participantId:
                                        data.participantId,

                                    periodKey:
                                        data.periodKey,

                                    approvedAt:
                                        data.approvedAt,

                                    invoiceAttachments:
                                        Array.isArray(
                                            data.invoiceAttachments
                                        )
                                            ? data.invoiceAttachments.filter(
                                                (
                                                    attachment:
                                                        any
                                                ) =>
                                                    Boolean(
                                                        attachment?.url
                                                    )
                                            )
                                            : []
                                }
                            }
                        )

                    setMovs(
                        rows
                    )

                    setLoadingMovs(
                        false
                    )
                },

                error => {
                    console.error(
                        'consolidatedMovs onSnapshot error:',
                        error
                    )

                    message.error(
                        'Failed to load approved consolidated MOVs.'
                    )

                    setLoadingMovs(
                        false
                    )
                }
            )

        return () =>
            unsubscribe()
    }, [])

    /*
     * ---------------------------------------------------------
     * METRICS
     * ---------------------------------------------------------
     */
    const {
        totalAmount,
        totalApproved,
        totalPending,
        totalRejected
    } =
        useMemo(() => {
            const amount =
                requests.reduce(
                    (
                        total,
                        request
                    ) =>
                        total +
                        (
                            request.amount ??
                            0
                        ),
                    0
                )

            const approved =
                requests.filter(
                    request => {
                        const stage =
                            getRequestStage(
                                request
                            )

                        return (
                            stage ===
                            'invoice_approved' ||
                            stage ===
                            'completed'
                        )
                    }
                ).length

            const pending =
                requests.filter(
                    request => {
                        const stage =
                            getRequestStage(
                                request
                            )

                        return ![
                            'invoice_approved',
                            'completed',
                            'rejected'
                        ].includes(
                            stage
                        )
                    }
                ).length

            const rejected =
                requests.filter(
                    request =>
                        getRequestStage(
                            request
                        ) ===
                        'rejected'
                ).length

            return {
                totalAmount:
                    amount,

                totalApproved:
                    approved,

                totalPending:
                    pending,

                totalRejected:
                    rejected
            }
        }, [
            requests
        ])

    /*
     * ---------------------------------------------------------
     * FILTERS
     * ---------------------------------------------------------
     */
    const filteredRequests =
        useMemo(() => {
            return requests.filter(
                request => {
                    const stage =
                        getRequestStage(
                            request
                        )

                    const stageMatches =
                        stageFilter
                            ? stage ===
                            stageFilter
                            : true

                    const typeMatches =
                        typeFilter
                            ? request.requestType ===
                            typeFilter
                            : true

                    return (
                        stageMatches &&
                        typeMatches
                    )
                }
            )
        }, [
            requests,
            stageFilter,
            typeFilter
        ])

    /*
     * ---------------------------------------------------------
     * RESOURCE REQUEST TABLE
     * ---------------------------------------------------------
     */
    const requestColumns =
        [
            {
                title:
                    'Branch',

                dataIndex:
                    'branch',

                key:
                    'branch',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Resource',

                dataIndex:
                    'resourceName',

                key:
                    'resourceName',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Type',

                dataIndex:
                    'requestType',

                key:
                    'requestType',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Quantity',

                dataIndex:
                    'quantity',

                key:
                    'quantity',

                render:
                    (
                        value:
                            number
                    ) =>
                        Number.isFinite(
                            value
                        )
                            ? value
                            : '—'
            },

            {
                title:
                    'Stage',

                key:
                    'stage',

                render:
                    (
                        _:
                            any,
                        record:
                            ResourceRequest
                    ) => {
                        const history =
                            getRequestWorkflowHistory(
                                record
                            )

                        const latest =
                            getLatestStage(
                                history
                            )

                        const stage =
                            String(
                                latest?.stage ||
                                record.status ||
                                '—'
                            )

                        const when =
                            latest?.timestamp
                                ? dayjs(
                                    latest.timestamp.toDate()
                                ).format(
                                    'DD MMM YYYY HH:mm'
                                )
                                : undefined

                        const actor =
                            latest?.actor

                        const hasTooltip =
                            Boolean(
                                actor ||
                                when
                            )

                        return (
                            <Tooltip
                                title={
                                    hasTooltip ? (
                                        <div>
                                            {actor && (
                                                <div>
                                                    Actor:{' '}
                                                    {
                                                        actor
                                                    }
                                                </div>
                                            )}

                                            {when && (
                                                <div>
                                                    At:{' '}
                                                    {
                                                        when
                                                    }
                                                </div>
                                            )}
                                        </div>
                                    ) : null
                                }
                            >
                                <Tag
                                    color={
                                        stageToColor(
                                            stage
                                        )
                                    }
                                    style={{
                                        textTransform:
                                            'none'
                                    }}
                                >
                                    {formatStage(
                                        stage
                                    )}
                                </Tag>
                            </Tooltip>
                        )
                    }
            },

            {
                title:
                    'Files',

                key:
                    'files',

                render:
                    (
                        _:
                            any,
                        record:
                            ResourceRequest
                    ) => (
                        <Space
                            size='small'
                            wrap
                        >
                            {record.quotationUrl && (
                                <a
                                    href={
                                        record.quotationUrl
                                    }
                                    target='_blank'
                                    rel='noreferrer'
                                >
                                    Quotation
                                </a>
                            )}

                            {record.invoiceUrl && (
                                <a
                                    href={
                                        record.invoiceUrl
                                    }
                                    target='_blank'
                                    rel='noreferrer'
                                >
                                    Invoice
                                </a>
                            )}

                            {record.popUrl && (
                                <a
                                    href={
                                        record.popUrl
                                    }
                                    target='_blank'
                                    rel='noreferrer'
                                >
                                    POP
                                </a>
                            )}

                            {!record.quotationUrl &&
                                !record.invoiceUrl &&
                                !record.popUrl && (
                                    <Text type='secondary'>
                                        —
                                    </Text>
                                )}
                        </Space>
                    )
            }
        ]

    /*
     * ---------------------------------------------------------
     * CONSOLIDATED MOV TABLE
     * ---------------------------------------------------------
     */
    const movColumns =
        [
            {
                title:
                    'MOV ID',

                dataIndex:
                    'id',

                key:
                    'id',

                width:
                    160
            },

            {
                title:
                    'Beneficiary',

                dataIndex:
                    'beneficiaryName',

                key:
                    'beneficiaryName',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Program',

                dataIndex:
                    'programName',

                key:
                    'programName',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Department',

                dataIndex:
                    'department',

                key:
                    'department',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Period',

                dataIndex:
                    'periodKey',

                key:
                    'periodKey',

                render:
                    (
                        value:
                            string
                    ) =>
                        value ||
                        '—'
            },

            {
                title:
                    'Approved At',

                key:
                    'approvedAt',

                render:
                    (
                        _:
                            any,
                        record:
                            ConsolidatedMov
                    ) =>
                        record.approvedAt
                            ? dayjs(
                                record.approvedAt.toDate()
                            ).format(
                                'YYYY-MM-DD'
                            )
                            : '—'
            },

            {
                title:
                    'Invoice Attachments',

                key:
                    'invoiceAttachments',

                render:
                    (
                        _:
                            any,
                        record:
                            ConsolidatedMov
                    ) =>
                        record
                            .invoiceAttachments
                            ?.length ? (
                            <Space
                                size='small'
                                wrap
                            >
                                {record.invoiceAttachments.map(
                                    (
                                        file,
                                        index
                                    ) => (
                                        <a
                                            key={`${file.url}-${index}`}
                                            href={
                                                file.url
                                            }
                                            target='_blank'
                                            rel='noreferrer'
                                        >
                                            {file.name ||
                                                `Invoice ${index +
                                                1
                                                }`}
                                        </a>
                                    )
                                )}
                            </Space>
                        ) : (
                            <Text type='secondary'>
                                —
                            </Text>
                        )
            }
        ]

    return (
        <div
            style={{
                padding:
                    24,

                background:
                    '#fff',

                minHeight:
                    '100vh'
            }}
        >
            <Helmet>
                <title>
                    In-house Finance Dashboard | Smart Incubator
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
                <Col
                    xs={24}
                    sm={12}
                    md={6}
                >
                    <Card
                        style={{
                            boxShadow:
                                '0 12px 32px rgba(0,0,0,0.12)',

                            borderRadius:
                                12,

                            border:
                                '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Total Requests Amount'
                            prefix={
                                <DollarOutlined
                                    style={{
                                        color:
                                            '#1890ff'
                                    }}
                                />
                            }
                            value={
                                formatMoney(
                                    totalAmount
                                )
                            }
                        />
                    </Card>
                </Col>

                <Col
                    xs={24}
                    sm={12}
                    md={6}
                >
                    <Card
                        style={{
                            boxShadow:
                                '0 12px 32px rgba(0,0,0,0.12)',

                            borderRadius:
                                12,

                            border:
                                '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Approved/Completed'
                            value={
                                totalApproved
                            }
                            prefix={
                                <FileDoneOutlined
                                    style={{
                                        color:
                                            'green'
                                    }}
                                />
                            }
                        />
                    </Card>
                </Col>

                <Col
                    xs={24}
                    sm={12}
                    md={6}
                >
                    <Card
                        style={{
                            boxShadow:
                                '0 12px 32px rgba(0,0,0,0.12)',

                            borderRadius:
                                12,

                            border:
                                '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Pending'
                            value={
                                totalPending
                            }
                            prefix={
                                <ClockCircleOutlined
                                    style={{
                                        color:
                                            'orange'
                                    }}
                                />
                            }
                        />
                    </Card>
                </Col>

                <Col
                    xs={24}
                    sm={12}
                    md={6}
                >
                    <Card
                        style={{
                            boxShadow:
                                '0 12px 32px rgba(0,0,0,0.12)',

                            borderRadius:
                                12,

                            border:
                                '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Rejected'
                            value={
                                totalRejected
                            }
                            prefix={
                                <CloseCircleOutlined
                                    style={{
                                        color:
                                            'red'
                                    }}
                                />
                            }
                        />
                    </Card>
                </Col>
            </Row>

            <Card
                style={{
                    boxShadow:
                        '0 12px 32px rgba(0,0,0,0.12)',

                    borderRadius:
                        12,

                    border:
                        '1px solid #d6e4ff',

                    marginBottom:
                        24
                }}
                title='Resource Requests'
                extra={
                    <Space>
                        <Select
                            allowClear
                            placeholder='Filter by stage'
                            style={{
                                width:
                                    220
                            }}
                            value={
                                stageFilter
                            }
                            onChange={
                                setStageFilter
                            }
                            options={Object.keys(
                                STAGE_COLORS
                            ).map(
                                stage => ({
                                    label:
                                        formatStage(
                                            stage
                                        ),

                                    value:
                                        stage
                                })
                            )}
                        />

                        <Select
                            allowClear
                            placeholder='Filter by type'
                            style={{
                                width:
                                    160
                            }}
                            value={
                                typeFilter
                            }
                            onChange={
                                setTypeFilter
                            }
                            options={[
                                {
                                    label:
                                        'Goods',
                                    value:
                                        'Goods'
                                },
                                {
                                    label:
                                        'Finance',
                                    value:
                                        'Finance'
                                },
                                {
                                    label:
                                        'Service',
                                    value:
                                        'Service'
                                }
                            ]}
                        />
                    </Space>
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
                    <Table
                        columns={
                            requestColumns as any
                        }
                        dataSource={
                            filteredRequests
                        }
                        rowKey='id'
                        pagination={{
                            pageSize:
                                10,

                            showSizeChanger:
                                true
                        }}
                        scroll={{
                            x:
                                850
                        }}
                    />
                ) : (
                    <Empty description='No resource requests found' />
                )}
            </Card>

            <Card
                style={{
                    boxShadow:
                        '0 12px 32px rgba(0,0,0,0.12)',

                    borderRadius:
                        12,

                    border:
                        '1px solid #d6e4ff'
                }}
                title='Approved Consolidated MOVs'
            >
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
                ) : movs.length ? (
                    <Table
                        columns={
                            movColumns as any
                        }
                        dataSource={
                            movs
                        }
                        rowKey='id'
                        pagination={{
                            pageSize:
                                10,

                            showSizeChanger:
                                true
                        }}
                        scroll={{
                            x:
                                1000
                        }}
                    />
                ) : (
                    <Empty description='No approved consolidated MOVs found' />
                )}
            </Card>
        </div>
    )
}

export default InhouseFinanceDashboard
