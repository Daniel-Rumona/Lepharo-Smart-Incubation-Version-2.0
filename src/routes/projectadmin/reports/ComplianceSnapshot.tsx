import React from 'react'
import { Empty, Skeleton } from 'antd'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import type { ComplianceModel } from './complianceModel'
import { FigureBar, Legend, pct, type Status } from './FigureBar'

const ONBOARDING_STATUSES: Status[] = [
    { key: 'complete', label: 'Complete', tone: 'done' },
    { key: 'awaitingRom', label: 'Awaiting ROM', tone: 'waiting' },
    { key: 'notSigned', label: 'Not signed', tone: 'gap' }
]

const DOCUMENT_STATUSES: Status[] = [
    { key: 'valid', label: 'Valid', tone: 'done' },
    { key: 'expiring', label: 'Expiring soon', tone: 'expiring' },
    { key: 'pending', label: 'Awaiting verification', tone: 'waiting' },
    { key: 'attention', label: 'Expired or queried', tone: 'attention' },
    { key: 'missing', label: 'Not uploaded', tone: 'gap' }
]

/**
 * Compliance in figures: onboarding documents (GAP Analysis, pre-incubation
 * contract, MOA) and the documents each programme requires.
 */
const ComplianceSnapshot: React.FC<{
    model: ComplianceModel | null
    loading?: boolean
    /** The monthly chart, shown small underneath. */
    trend?: React.ReactNode
}> = ({ model, loading, trend }) => {
    if (loading || !model) {
        return (
            <MotionCard>
                <Skeleton active paragraph={{ rows: 6 }} />
            </MotionCard>
        )
    }

    if (!model.onboarded) {
        return (
            <MotionCard>
                <Empty description="No SMEs were onboarded in this period." />
            </MotionCard>
        )
    }

    const multipleProgrammes = model.programmes.length > 1

    return (
        <div className="cs">
            <MotionCard title="Onboarding compliance">
                <div className="ds">
                    <div className="ds-summary">
                        <div className="ds-stat">
                            <span className="ds-stat-value">{model.onboarded}</span>
                            <span className="ds-stat-label">SMEs onboarded</span>
                        </div>
                        <div className="ds-stat">
                            <span className="ds-stat-value is-done">{model.fullyOnboarded}</span>
                            <span className="ds-stat-label">
                                fully onboarded ({pct(model.fullyOnboarded, model.onboarded)}%)
                            </span>
                        </div>
                        <div className="ds-stat">
                            <span className="ds-stat-value is-gap">{model.onboarded - model.fullyOnboarded}</span>
                            <span className="ds-stat-label">still missing a document</span>
                        </div>
                    </div>
                    <Legend statuses={ONBOARDING_STATUSES} />
                    <div className="cs-rows" role="list">
                        {model.onboarding.map(row =>
                            row.required ? (
                                <FigureBar
                                    key={row.id}
                                    title={row.label}
                                    total={row.required}
                                    statuses={ONBOARDING_STATUSES}
                                    counts={row}
                                    note={row.notDue ? <span className="cs-note">{row.notDue} not due yet</span> : null}
                                />
                            ) : (
                                <div key={row.id} className="cs-row" role="listitem">
                                    <div className="cs-row-head">
                                        <span className="cs-row-title">{row.label}</span>
                                        <span className="ds-muted">
                                            {row.notDue ? `Not due yet for ${row.notDue} SME${row.notDue === 1 ? '' : 's'}` : 'Not required by these programmes'}
                                        </span>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </div>
            </MotionCard>

            <MotionCard title="Programme compliance">
                <div className="ds">
                    <Legend statuses={DOCUMENT_STATUSES} />
                    {model.programmes.map(programme => (
                        <section key={programme.id} className="cs-programme">
                            <div className="ds-summary">
                                {multipleProgrammes ? <span className="cs-programme-name">{programme.name}</span> : null}
                                <div className="ds-stat">
                                    <span className="ds-stat-value">{programme.documents.length}</span>
                                    <span className="ds-stat-label">required documents</span>
                                </div>
                                <div className="ds-stat">
                                    <span className="ds-stat-value is-done">{programme.fullyCompliant}</span>
                                    <span className="ds-stat-label">
                                        of {programme.smes} SMEs fully compliant ({pct(programme.fullyCompliant, programme.smes)}%)
                                    </span>
                                </div>
                            </div>
                            {programme.documents.length ? (
                                <div className="cs-rows" role="list">
                                    {programme.documents.map(row => (
                                        <FigureBar
                                            key={row.key}
                                            title={row.title}
                                            total={row.required}
                                            statuses={DOCUMENT_STATUSES}
                                            counts={row}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <span className="ds-muted">This programme doesn't list any required documents yet. Add them on the Programmes page.</span>
                            )}
                        </section>
                    ))}
                </div>
            </MotionCard>

            {trend ? <MotionCard title="Onboarding documents by month">{trend}</MotionCard> : null}
        </div>
    )
}

export default ComplianceSnapshot
