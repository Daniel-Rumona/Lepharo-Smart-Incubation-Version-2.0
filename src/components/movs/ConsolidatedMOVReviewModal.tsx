import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Modal,
    Table,
    Tag,
    Typography,
    theme
} from 'antd'
import type { TableProps } from 'antd'
import {
    ArrowRightOutlined,
    CheckCircleFilled,
    ClockCircleOutlined,
    FileProtectOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'

const { Text } = Typography

export type ConsolidatedMovReviewRow = {
    id?: string
    docId?: string
    departmentName?: string
    smmeCompanyName?: string
    interventionTitle?: string
    interventionDate?: any
}

export type ConsolidatedMovSummaryItem = {
    label: React.ReactNode
    value: React.ReactNode
}

export type ConsolidatedMovSignatureItem = {
    label: React.ReactNode
    name: React.ReactNode
    signatureUrl?: string | null
    signatureAlt?: string
    emptySignatureText?: React.ReactNode
    align?: React.CSSProperties['textAlign']
}

export type ConsolidatedMovRowTone = 'success' | 'warning' | 'error' | 'processing' | 'default'

type ConsolidatedMOVReviewModalProps = {
    open: boolean
    pack: any | null
    onClose: () => void
    columns: TableProps<any>['columns']
    footer: React.ReactNode
    warningMessage?: React.ReactNode
    summaryItems: ConsolidatedMovSummaryItem[]
    summaryAlerts?: React.ReactNode
    signatureItems?: ConsolidatedMovSignatureItem[]
    title?: React.ReactNode
    logoSrc?: string
    logoAlt?: string
    funderLogoSrc?: string
    funderLogoAlt?: string
    width?: number | string
    zIndex?: number
    tablePageSize?: number
    tableScrollX?: number
    monthFormatter?: (value: any) => React.ReactNode
    hideSignatureColumns?: boolean
    getRowTone?: (row: any) => ConsolidatedMovRowTone
}

const defaultMonthFormatter = (value: any) => {
    const raw = String(value ?? '').trim()
    if (!raw) return '—'

    const yyyyMm = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
    if (yyyyMm) {
        const parsed = dayjs(`${yyyyMm[1]}-${yyyyMm[2]}-01`)
        return parsed.isValid() ? parsed.format('MMM YYYY') : raw
    }

    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('MMM YYYY') : raw
}

const getNodeText = (node: React.ReactNode) => {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    return ''
}

const isPendingText = (value: React.ReactNode) => {
    const text = getNodeText(value).toLowerCase()
    return text.includes('pending') || text.includes('awaiting')
}

const isCompleteRatio = (value: React.ReactNode) => {
    const text = getNodeText(value).trim()
    const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
    if (!match) return null

    const completed = Number(match[1])
    const required = Number(match[2])
    return required === 0 || completed >= required
}

const isSignatureColumn = (column: any) => {
    const title = getNodeText(column?.title).toLowerCase()
    const dataIndex = Array.isArray(column?.dataIndex)
        ? column.dataIndex.join('.').toLowerCase()
        : String(column?.dataIndex || '').toLowerCase()

    return title.includes('signature') || dataIndex.includes('signature')
}

const compactColumnTitle = (title: React.ReactNode) => {
    if (typeof title !== 'string') return title
    if (title === 'Beneficiary') return 'SME'
    if (title === 'Date Completed') return 'Completed'
    return title
}

const getWorkflowOrder = (label: React.ReactNode) => {
    const text = getNodeText(label).toLowerCase()
    if (text.includes('hod')) return 0
    if (text.includes('center coordinator') || text.includes('cc')) return 1
    if (text.includes('m&e') || text.includes('monitoring')) return 2
    if (text.includes('poe')) return 3
    return 10
}

const sortWorkflowItems = <T extends { label: React.ReactNode }>(items: T[]) =>
    [...items].sort((a, b) => getWorkflowOrder(a.label) - getWorkflowOrder(b.label))

const getPackStage = (summaryItems: ConsolidatedMovSummaryItem[], pack: any) => {
    if (pack?.invoiceRedeemable) {
        return { label: 'Invoice Redeemable', color: 'green' as const }
    }

    const cc = summaryItems.find(item =>
        getNodeText(item.label).toLowerCase().includes('center coordinator')
    )
    const me = summaryItems.find(item =>
        getNodeText(item.label).toLowerCase().includes('m&e')
    )

    if (cc && isPendingText(cc.value)) {
        return { label: 'Awaiting Center Coordinator', color: 'blue' as const }
    }

    if (me && isPendingText(me.value)) {
        return { label: 'Awaiting M&E Validation', color: 'orange' as const }
    }

    if (me && getNodeText(me.value) && getNodeText(me.value) !== '—') {
        return { label: 'M&E Validated', color: 'green' as const }
    }

    const rawStatus = String(pack?.status || '').trim()
    if (rawStatus) {
        return {
            label: rawStatus.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
            color: 'default' as const
        }
    }

    return { label: 'Under Review', color: 'default' as const }
}

export function ConsolidatedMOVReviewModal({
    open,
    pack,
    onClose,
    columns,
    footer,
    warningMessage,
    summaryItems,
    summaryAlerts,
    signatureItems = [],
    title = 'Review Consolidated MOV',
    logoSrc = '/assets/images/lepharo.png',
    logoAlt = 'Company Logo',
    funderLogoSrc,
    funderLogoAlt = 'Funder Logo',
    width = 1120,
    zIndex,
    tablePageSize = 5,
    tableScrollX,
    monthFormatter = defaultMonthFormatter,
    hideSignatureColumns = true,
    getRowTone
}: ConsolidatedMOVReviewModalProps) {
    const { token } = theme.useToken()
    const programId = pack?.programId ? String(pack.programId) : null
    const [programFunderLogo, setProgramFunderLogo] = useState<string | null>(null)

    useEffect(() => {
        setProgramFunderLogo(null)
        if (funderLogoSrc || !open || !programId) return
        let mounted = true

        getDoc(doc(db, 'programs', programId))
            .then(snap => {
                if (!mounted) return
                const data = (snap.exists() ? snap.data() : {}) as any
                setProgramFunderLogo(
                    (typeof data.funderLogoUrl === 'string' && data.funderLogoUrl) ||
                    (typeof data.logoUrl === 'string' && data.logoUrl) ||
                    null
                )
            })
            .catch(error => {
                console.error('Failed to load program funder logo', error)
                if (mounted) setProgramFunderLogo(null)
            })

        return () => {
            mounted = false
        }
    }, [funderLogoSrc, open, programId])

    const resolvedFunderLogo = funderLogoSrc || programFunderLogo

    const groupedRows = useMemo(() => {
        const interventions = Array.isArray(pack?.interventions)
            ? (pack.interventions as ConsolidatedMovReviewRow[])
            : []

        return interventions.reduce<Record<string, ConsolidatedMovReviewRow[]>>((groups, row) => {
            const department = row?.departmentName || pack?.department || 'Department'
            if (!groups[department]) groups[department] = []
            groups[department].push(row)
            return groups
        }, {})
    }, [pack?.interventions, pack?.department])

    const visibleColumns = useMemo(() => {
        const source = Array.isArray(columns) ? columns : []

        return source
            .filter(column => !hideSignatureColumns || !isSignatureColumn(column))
            .map((column: any) => ({
                ...column,
                title: compactColumnTitle(column?.title)
            }))
    }, [columns, hideSignatureColumns])

    const orderedSummaryItems = useMemo(
        () => sortWorkflowItems(summaryItems),
        [summaryItems]
    )

    const orderedSignatureItems = useMemo(
        () => sortWorkflowItems(signatureItems),
        [signatureItems]
    )

    const stage = useMemo(
        () => getPackStage(orderedSummaryItems, pack),
        [orderedSummaryItems, pack]
    )

    const summaryCardStyle = (item: ConsolidatedMovSummaryItem): React.CSSProperties => {
        const label = getNodeText(item.label).toLowerCase()
        const ratioComplete = label.includes('poe') ? isCompleteRatio(item.value) : null
        const pending = isPendingText(item.value) || ratioComplete === false
        const workflowItem =
            label.includes('approval') ||
            label.includes('confirmation') ||
            label.includes('validation')

        if (pending) {
            return {
                background: token.colorWarningBg,
                borderColor: token.colorWarningBorder
            }
        }

        if (workflowItem || ratioComplete === true) {
            return {
                background: token.colorSuccessBg,
                borderColor: token.colorSuccessBorder
            }
        }

        return {
            background: token.colorFillAlter,
            borderColor: token.colorBorderSecondary
        }
    }

    const summaryIcon = (item: ConsolidatedMovSummaryItem) => {
        const label = getNodeText(item.label).toLowerCase()
        const ratioComplete = label.includes('poe') ? isCompleteRatio(item.value) : null
        const pending = isPendingText(item.value) || ratioComplete === false

        if (pending) {
            return <ClockCircleOutlined style={{ color: token.colorWarning, fontSize: 16 }} />
        }

        return <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 16 }} />
    }

    const isStepDone = (item: ConsolidatedMovSummaryItem) => {
        const text = getNodeText(item.value).trim()
        return !isPendingText(item.value) && text !== '—'
    }

    const renderLogo = (src: string, alt: string) => (
        <div
            style={{
                width: 92,
                minWidth: 92,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: token.borderRadius,
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.08)',
                padding: '3px 7px'
            }}
        >
            <img
                src={src}
                alt={alt}
                style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: 32,
                    objectFit: 'contain'
                }}
            />
        </div>
    )

    const sectionStyle: React.CSSProperties = {
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer
    }

    return (
        <Modal
            centered
            open={open}
            title={title}
            onCancel={onClose}
            width={width}
            zIndex={zIndex}
            footer={footer}
            styles={{
                content: {
                    padding: '16px 18px 12px'
                },
                body: {
                    maxHeight: 'calc(100vh - 170px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingTop: 6
                },
                footer: {
                    display: 'flex',
                    width: '100%',
                    gap: 8,
                    paddingTop: 12,
                    borderTop: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgElevated
                }
            }}
        >
            <div className="consolidated-mov-review">
                <div
                    className="consolidated-mov-review__pack-header"
                    style={{
                        ...sectionStyle,
                        padding: '8px 12px',
                        marginBottom: 10
                    }}
                >
                    <div className="consolidated-mov-review__pack-logo">
                        {resolvedFunderLogo ? renderLogo(resolvedFunderLogo, funderLogoAlt) : null}
                    </div>

                    <div
                        className="consolidated-mov-review__pack-title"
                        style={{ minWidth: 0, textAlign: 'center' }}
                    >
                        <Text
                            strong
                            style={{
                                display: 'block',
                                fontSize: 16,
                                lineHeight: 1.25,
                                color: token.colorText
                            }}
                        >
                            {pack?.department || 'Department'}
                        </Text>
                        <Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
                            {pack?.month ? monthFormatter(pack.month) : '—'}
                        </Text>
                    </div>

                    <div className="consolidated-mov-review__pack-stage">
                        <Tag
                            color={stage.color}
                            style={{
                                margin: 0,
                                borderRadius: 999,
                                paddingInline: 10,
                                lineHeight: '24px',
                                whiteSpace: 'nowrap',
                                fontWeight: 600
                            }}
                        >
                            {stage.label}
                        </Tag>
                        {renderLogo(logoSrc, logoAlt)}
                    </div>
                </div>

                {warningMessage ? (
                    <Alert
                        type="warning"
                        message={warningMessage}
                        showIcon
                        style={{
                            marginBottom: 12,
                            borderRadius: token.borderRadiusLG,
                            paddingBlock: 8
                        }}
                    />
                ) : null}

                <div
                    className="consolidated-mov-review__flow"
                    style={{ marginBottom: summaryAlerts ? 10 : 14 }}
                >
                    {orderedSummaryItems.map((item, index) => {
                        const previous = index > 0 ? orderedSummaryItems[index - 1] : null
                        const linksWorkflow =
                            previous !== null &&
                            getWorkflowOrder(previous.label) < 3 &&
                            getWorkflowOrder(item.label) < 3
                        const linkMade = previous !== null && isStepDone(previous)
                        const stepOrder = getWorkflowOrder(item.label)
                        const signature = stepOrder < 3
                            ? orderedSignatureItems.find(sig => getWorkflowOrder(sig.label) === stepOrder)
                            : undefined

                        return (
                            <React.Fragment key={index}>
                                {linksWorkflow ? (
                                    <div className="consolidated-mov-review__flow-arrow">
                                        <div
                                            style={{
                                                width: 26,
                                                height: 26,
                                                borderRadius: 999,
                                                display: 'grid',
                                                placeItems: 'center',
                                                background: linkMade ? token.colorSuccess : 'transparent',
                                                border: `1.5px ${linkMade ? 'solid' : 'dashed'} ${linkMade ? token.colorSuccess : token.colorBorder}`,
                                                transition: 'background .2s ease, border-color .2s ease'
                                            }}
                                        >
                                            <ArrowRightOutlined
                                                style={{
                                                    fontSize: 12,
                                                    color: linkMade ? '#fff' : token.colorTextQuaternary
                                                }}
                                            />
                                        </div>
                                    </div>
                                ) : null}
                                <div className="consolidated-mov-review__flow-step">
                                    <div
                                        style={{
                                            ...sectionStyle,
                                            ...summaryCardStyle(item),
                                            height: '100%',
                                            minHeight: 64,
                                            padding: '8px 10px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 8
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div
                                                style={{
                                                    width: 28,
                                                    height: 28,
                                                    minWidth: 28,
                                                    borderRadius: 999,
                                                    display: 'grid',
                                                    placeItems: 'center',
                                                    background: token.colorBgContainer
                                                }}
                                            >
                                                {summaryIcon(item)}
                                            </div>

                                            <div style={{ minWidth: 0 }}>
                                                <Text
                                                    type="secondary"
                                                    style={{
                                                        display: 'block',
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        textTransform: 'uppercase',
                                                        letterSpacing: 0.25,
                                                        lineHeight: 1.2
                                                    }}
                                                >
                                                    {item.label}
                                                </Text>
                                                <Text
                                                    strong
                                                    style={{
                                                        display: 'block',
                                                        marginTop: 3,
                                                        fontSize: 14,
                                                        lineHeight: 1.3,
                                                        color: token.colorText,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}
                                                >
                                                    {item.value}
                                                </Text>
                                            </div>

                                            {signature ? (
                                                <Tag
                                                    color={signature.signatureUrl ? 'green' : isPendingText(signature.name) ? 'orange' : 'default'}
                                                    style={{ margin: '0 0 0 auto', borderRadius: 999, flexShrink: 0 }}
                                                >
                                                    {signature.signatureUrl
                                                        ? 'Signed'
                                                        : isPendingText(signature.name)
                                                            ? 'Pending'
                                                            : 'Unsigned'}
                                                </Tag>
                                            ) : null}
                                        </div>

                                        {signature ? (
                                            signature.signatureUrl ? (
                                                <div
                                                    style={{
                                                        marginTop: 'auto',
                                                        height: 56,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        padding: '6px 10px',
                                                        borderRadius: 8,
                                                        background: '#fff',
                                                        border: '1px solid rgba(0,0,0,0.12)'
                                                    }}
                                                >
                                                    <img
                                                        src={signature.signatureUrl}
                                                        alt={signature.signatureAlt || `${getNodeText(signature.label) || 'Approval'} signature`}
                                                        style={{
                                                            display: 'block',
                                                            maxWidth: '100%',
                                                            maxHeight: 42,
                                                            objectFit: 'contain'
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <div
                                                    style={{
                                                        marginTop: 'auto',
                                                        height: 56,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        borderRadius: 8,
                                                        border: `1px dashed ${token.colorBorder}`,
                                                        background: token.colorFillAlter,
                                                        padding: 8,
                                                        textAlign: 'center'
                                                    }}
                                                >
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {signature.emptySignatureText ?? 'No signature captured'}
                                                    </Text>
                                                </div>
                                            )
                                        ) : null}
                                    </div>
                                </div>
                            </React.Fragment>
                        )
                    })}
                </div>

                {summaryAlerts ? (
                    <div
                        className="consolidated-mov-review__notes"
                        style={{
                            ...sectionStyle,
                            padding: '9px 10px 10px',
                            marginBottom: 12
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                marginBottom: 7
                            }}
                        >
                            <FileProtectOutlined style={{ color: token.colorWarning }} />
                            <Text strong>Review notes</Text>
                        </div>
                        <div className="consolidated-mov-review__notes-grid">
                            {summaryAlerts}
                        </div>
                    </div>
                ) : null}

                {Object.entries(groupedRows).map(([departmentName, rows]) => (
                    <div key={departmentName} style={{ marginBottom: 18 }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                marginBottom: 8
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <Text strong style={{ fontSize: 14 }}>
                                    Interventions
                                </Text>
                                {Object.keys(groupedRows).length > 1 ? (
                                    <Text type="secondary" style={{ marginLeft: 8 }}>
                                        {departmentName}
                                    </Text>
                                ) : null}
                            </div>
                            <Tag style={{ margin: 0, borderRadius: 999 }}>
                                {rows.length} {rows.length === 1 ? 'item' : 'items'}
                            </Tag>
                        </div>

                        <div style={{ ...sectionStyle, overflowX: 'auto', overflowY: 'hidden' }}>
                            <Table
                                size="small"
                                pagination={{
                                    pageSize: tablePageSize,
                                    showSizeChanger: false,
                                    position: ['bottomCenter']
                                }}
                                scroll={
                                    tableScrollX && visibleColumns.length > 6
                                        ? { x: tableScrollX }
                                        : undefined
                                }
                                dataSource={rows}
                                rowClassName={(row) => {
                                    const tone = getRowTone?.(row) || 'default'
                                    return `consolidated-mov-review__row consolidated-mov-review__row--${tone}`
                                }}
                                rowKey={(row) =>
                                    row.id ||
                                    row.docId ||
                                    `${row.smmeCompanyName || 'beneficiary'}-${row.interventionTitle || 'intervention'}-${String(row.interventionDate || '')}`
                                }
                                columns={visibleColumns}
                            />
                        </div>
                    </div>
                ))}
            </div>

            <style>{`
                .consolidated-mov-review__pack-header {
                    display: grid;
                    grid-template-columns: minmax(110px, 1fr) auto minmax(110px, 1fr);
                    align-items: center;
                    column-gap: 12px;
                }

                .consolidated-mov-review__pack-logo {
                    justify-self: start;
                    min-width: 0;
                }

                .consolidated-mov-review__pack-title {
                    justify-self: center;
                    max-width: 620px;
                }

                .consolidated-mov-review__pack-stage {
                    justify-self: end;
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .consolidated-mov-review__flow {
                    display: flex;
                    align-items: stretch;
                    gap: 6px;
                }

                .consolidated-mov-review__flow-step {
                    flex: 1 1 0;
                    min-width: 0;
                }

                .consolidated-mov-review__flow-arrow {
                    flex: 0 0 auto;
                    display: grid;
                    place-items: center;
                }

                .consolidated-mov-review__notes-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                    gap: 8px;
                    align-items: stretch;
                }

                .consolidated-mov-review__notes-grid > .ant-alert {
                    height: 100%;
                    margin: 0 !important;
                    border-radius: ${token.borderRadius}px;
                    padding: 8px 10px;
                }

                .consolidated-mov-review .ant-table-wrapper .ant-table {
                    border-radius: ${token.borderRadiusLG}px;
                }

                .consolidated-mov-review .ant-table-wrapper .ant-table-thead > tr > th {
                    white-space: nowrap;
                }

                .consolidated-mov-review .ant-table-wrapper .ant-table-pagination {
                    margin-block: 10px;
                }

                .consolidated-mov-review .ant-table-wrapper .consolidated-mov-review__row > td {
                    transition: background-color .18s ease, box-shadow .18s ease;
                }

                .consolidated-mov-review .ant-table-wrapper .consolidated-mov-review__row--success > td {
                    background: ${token.colorSuccessBg};
                }

                .consolidated-mov-review .ant-table-wrapper .consolidated-mov-review__row--warning > td {
                    background: ${token.colorWarningBg};
                }

                .consolidated-mov-review .ant-table-wrapper .consolidated-mov-review__row--error > td {
                    background: ${token.colorErrorBg};
                }

                .consolidated-mov-review .ant-table-wrapper .consolidated-mov-review__row--processing > td {
                    background: ${token.colorInfoBg};
                }

                .consolidated-mov-review .ant-table-wrapper .consolidated-mov-review__row:hover > td {
                    filter: brightness(0.985);
                }

                @media (max-width: 760px) {
                    .consolidated-mov-review__pack-header {
                        grid-template-columns: auto 1fr;
                        row-gap: 8px;
                    }

                    .consolidated-mov-review__pack-title {
                        grid-column: 2;
                        grid-row: 1;
                        justify-self: center;
                        width: 100%;
                    }

                    .consolidated-mov-review__pack-stage {
                        grid-column: 1 / -1;
                        grid-row: 2;
                        justify-self: center;
                    }

                    .consolidated-mov-review__flow {
                        flex-direction: column;
                    }

                    .consolidated-mov-review__flow-arrow {
                        transform: rotate(90deg);
                    }

                    .consolidated-mov-review__notes-grid {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </Modal>
    )
}

export default ConsolidatedMOVReviewModal
