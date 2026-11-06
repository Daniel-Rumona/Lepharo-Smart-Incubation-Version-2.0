import React from 'react'
import { Space, Tag, Empty, Skeleton, Alert, Button, message } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { COMPLIANCE_BUCKETS, ComplianceBucket, ComplianceDoc, ComplianceStats, SmeRow, canonicalComplianceId, complianceBucket, formatDateTime, resolveDocumentUrl, toDateSafe } from './participantsData'
import { SummaryStrip } from './SummaryStrip'

type ComplianceSectionProps = {
    row: SmeRow | null
    loading: boolean
    stats: ComplianceStats | null
    documents: ComplianceDoc[]
    filter: ComplianceBucket | null
    onFilterChange: (bucket: ComplianceBucket | null) => void
    /** The selected SME's application document; decides whether generated agreement viewers apply. */
    applicationData: any
    hasOnboardingAccess: boolean
    agreementViewerLoading: boolean
    /** Opens the built-in viewer for a signed generated agreement; resolves false when none applies. */
    onOpenGeneratedAgreement: (record: ComplianceDoc) => Promise<boolean>
    isPhone: boolean
}

/** Compliance summary and the list of uploaded documents and agreements for the selected SME. */
export const ComplianceSection: React.FC<ComplianceSectionProps> = ({
    row: selectedRow,
    loading: complianceLoading,
    stats: complianceStats,
    documents: complianceDocuments,
    filter: complianceFilter,
    onFilterChange: setComplianceFilter,
    applicationData: selectedApplicationData,
    hasOnboardingAccess,
    agreementViewerLoading,
    onOpenGeneratedAgreement: openGeneratedAgreement,
    isPhone
}) => {
    const navigate = useNavigate()

    if (!selectedRow) return <Empty description='Select an SME to view compliance' />
    if (complianceLoading) return <Skeleton active paragraph={{ rows: 8 }} />

    if (!complianceStats || complianceStats.total === 0) {
        return <Space direction='vertical' style={{ width: '100%' }}>
            <Alert type='warning' showIcon message='No compliance documents found for this SME yet.' />
            {hasOnboardingAccess && <Button
                data-guide='sme-manage-compliance'
                type='primary'
                size='middle'
                shape='round'
                onClick={() => navigate('/compliance')}
            >Manage Compliance</Button>}
        </Space>
    }

    const complianceCounts: Record<ComplianceBucket, number> = { valid: 0, expired: 0, attention: 0, pending: 0 }
    complianceDocuments.forEach(record => { complianceCounts[complianceBucket(record)] += 1 })
    const visibleComplianceDocuments = complianceFilter
        ? complianceDocuments.filter(record => complianceBucket(record) === complianceFilter)
        : complianceDocuments

    return (
        <Space direction='vertical' style={{ width: '100%' }} size='middle'>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                    <SummaryStrip<ComplianceBucket>
                        total={complianceDocuments.length}
                        totalLabel={complianceDocuments.length === 1 ? 'document' : 'documents'}
                        active={complianceFilter}
                        onToggle={setComplianceFilter}
                        segments={(Object.keys(COMPLIANCE_BUCKETS) as ComplianceBucket[]).map(key => ({
                            key,
                            label: COMPLIANCE_BUCKETS[key].label,
                            color: COMPLIANCE_BUCKETS[key].color,
                            count: complianceCounts[key]
                        }))}
                    />
                </div>
                {hasOnboardingAccess && <Button
                    data-guide='sme-manage-compliance'
                    size='middle'
                    shape='round'
                    type='primary'
                    onClick={() => navigate('/compliance')}
                >Manage Compliance</Button>}
            </div>
            <ul data-guide='sme-compliance-documents' className='ptx-docs'>
                        {visibleComplianceDocuments.map(record => {
                            const hasFile = Boolean(record.url || record.storagePath)
                            const agreementId = canonicalComplianceId(`${record.id} ${record.title}`)
                            const hasGeneratedViewer =
                                selectedApplicationData?.manuallyCreated !== true &&
                                record.signed === true &&
                                ['pre-incubation-contract', 'moa', 'gap-analysis'].includes(agreementId)
                            const status = record.signed
                                ? 'Signed'
                                : record.status.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
                            // Phones get a date-only form so the whole row can stay on one line.
                            const shortDate = (value: any) => {
                                const parsed = toDateSafe(value)
                                return parsed ? dayjs(parsed).format('D MMM YY') : '—'
                            }
                            const date = record.acceptedAt
                                ? `Signed ${isPhone ? shortDate(record.acceptedAt) : formatDateTime(record.acceptedAt)}`
                                : record.expiryDate
                                    ? `Expires ${isPhone ? shortDate(record.expiryDate) : formatDateTime(record.expiryDate)}`
                                    : isPhone ? 'No date' : 'No date recorded'

                            // Status drives the icon tint and the tag; the row itself stays neutral.
                            const statusTone = record.signed || record.status === 'valid' ? { tag: 'success', tone: 'success' }
                                : record.status === 'expired' ? { tag: 'error', tone: 'danger' }
                                    : record.status === 'queried' || record.status === 'invalid' ? { tag: 'warning', tone: 'warning' }
                                        : { tag: 'default', tone: 'neutral' }
                            const kind = record.kind === 'agreement' ? 'Agreement' : 'Compliance document'

                            return (
                                <li key={canonicalComplianceId(record.title || record.id)} className='ptx-doc'>
                                    <span className={`ptx-doc-icon qtx-tone-${statusTone.tone}`} aria-hidden='true'>
                                        <FileTextOutlined />
                                    </span>
                                    <div className='ptx-doc-main'>
                                        <div className='ptx-doc-title' title={record.title}>{record.title}</div>
                                        <div className='ptx-doc-meta'>{kind} · {date}</div>
                                    </div>
                                    <Tag color={statusTone.tag} bordered={false} className='ptx-doc-status'>{status}</Tag>
                                    {hasFile || hasGeneratedViewer ? (
                                        <Button
                                            size='small'
                                            loading={agreementViewerLoading && hasGeneratedViewer}
                                            onClick={async () => {
                                                if (hasGeneratedViewer && await openGeneratedAgreement(record)) return
                                                const url = await resolveDocumentUrl(record)
                                                if (!url) {
                                                    message.warning('The document file could not be opened.')
                                                    return
                                                }
                                                window.open(url, '_blank', 'noopener,noreferrer')
                                            }}
                                        >
                                            View
                                        </Button>
                                    ) : (
                                        <span className='ptx-doc-nofile'>No file</span>
                                    )}
                                </li>
                            )
                        })}
            </ul>
        </Space>
    )
}
