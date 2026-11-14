import React, { useEffect, useState } from 'react'
import { Alert, Empty, Progress, Skeleton, Steps, Tag } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { STAGES, formatRand, getSupplierPassport, stageMeta, type Passport } from '@/services/marketLinkage'
import type { SmeRow } from './participantsData'

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
    valid: { label: 'Valid', color: 'success' },
    captured: { label: 'Number captured', color: 'success' },
    'expiring-soon': { label: 'Expiring soon', color: 'warning' },
    expired: { label: 'Expired', color: 'error' },
    missing: { label: 'Missing', color: 'default' },
    pending: { label: 'Awaiting review', color: 'processing' },
    queried: { label: 'Queried', color: 'warning' },
    rejected: { label: 'Rejected', color: 'error' },
    invalid: { label: 'Rejected', color: 'error' }
}

const Check: React.FC<{ ok: boolean | null; label: string; detail?: string }> = ({ ok, label, detail }) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {ok === null ? (
            <MinusCircleOutlined className='ws-muted' />
        ) : ok ? (
            <CheckCircleFilled style={{ color: 'var(--ant-color-success, #52c41a)' }} />
        ) : (
            <CloseCircleFilled style={{ color: 'var(--ant-color-error, #ff4d4f)' }} />
        )}
        <span>
            {label}
            {detail && <span className='ws-muted'> · {detail}</span>}
        </span>
    </div>
)

const money = (value: number | null) =>
    value === null ? '—' : `R ${Math.round(value).toLocaleString('en-ZA')}`

/** The supplier readiness passport: stage, what would move it on, and the evidence behind it. */
export const ReadinessSection: React.FC<{ row: SmeRow }> = ({ row }) => {
    const participantId = String(row.participantId || '').trim()
    const [state, setState] = useState<{ id: string; passport: Passport | null; error: string }>({ id: '', passport: null, error: '' })

    useEffect(() => {
        if (!participantId) return
        let cancelled = false
        getSupplierPassport(participantId)
            .then(passport => !cancelled && setState({ id: participantId, passport, error: '' }))
            .catch(e => !cancelled && setState({ id: participantId, passport: null, error: e?.message || 'Could not load the passport.' }))
        return () => {
            cancelled = true
        }
    }, [participantId])

    if (!participantId) return <Empty description='This SME has no participant record yet' />
    if (state.id !== participantId) return <Skeleton active paragraph={{ rows: 6 }} />
    if (state.error || !state.passport) return <Alert type='warning' showIcon message={state.error || 'No passport available.'} />

    const p = state.passport
    const stageIndex = STAGES.findIndex(stage => stage.key === p.stage)
    const { input } = p
    const yesNo = (value: boolean | null) => value

    return (
        <div className='ws-detail-body'>
            <section>
                <h4 className='ws-section-title'>Supplier readiness</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Tag color={stageMeta(p.stage).color} style={{ fontSize: 14, padding: '2px 10px' }}>{p.stageLabel}</Tag>
                </div>
                <Steps size='small' current={stageIndex} items={STAGES.map(stage => ({ title: stage.label }))} responsive />
                {p.nextSteps.length > 0 ? (
                    <Alert
                        style={{ marginTop: 12 }}
                        type='info'
                        showIcon
                        message={`To reach ${STAGES[Math.min(stageIndex + 1, STAGES.length - 1)].label}`}
                        description={<ul style={{ margin: 0, paddingLeft: 18 }}>{p.nextSteps.map(step => <li key={step}>{step}</li>)}</ul>}
                    />
                ) : (
                    <Alert style={{ marginTop: 12 }} type='success' showIcon message='Meets every readiness check.' />
                )}
            </section>

            <section>
                <h4 className='ws-section-title'>Registrations</h4>
                <div style={{ display: 'grid', gap: 6 }}>
                    <Check ok={p.checks.tax} label='Tax compliance' detail={input.registrations.taxCompliancePin ? 'PIN on file' : undefined} />
                    <Check ok={p.checks.csd} label='Central Supplier Database' detail={input.registrations.csdNumber || undefined} />
                    <Check ok={p.checks.bbbee} label='B-BBEE' detail={input.beeLevel ? `Level ${input.beeLevel}` : undefined} />
                    <Check ok={p.checks.cipc} label='CIPC registration' />
                    <Check ok={input.registrations.vatNumber ? true : null} label='VAT' detail={input.registrations.vatNumber || 'Not registered or not captured'} />
                </div>
            </section>

            <section>
                <h4 className='ws-section-title'>
                    Compliance documents ({p.compliance.current} of {p.compliance.required} current)
                </h4>
                {p.compliance.required > 0 && (
                    <Progress percent={Math.round((p.compliance.current / p.compliance.required) * 100)} size='small' style={{ marginBottom: 8 }} />
                )}
                {p.compliance.items.length ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                        {p.compliance.items.map(item => {
                            const meta = STATUS_LABEL[item.status] || { label: item.status, color: 'default' }
                            return (
                                <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                    <span>{item.title}</span>
                                    <span>
                                        {item.expires && <span className='ws-muted' style={{ marginRight: 6 }}>to {dayjs(item.expires).format('D MMM YYYY')}</span>}
                                        <Tag color={meta.color} bordered={false}>{meta.label}</Tag>
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <span className='ws-muted'>The programme has no document requirements set up.</span>
                )}
            </section>

            <section>
                <h4 className='ws-section-title'>Capability and track record</h4>
                <dl className='ws-facts'>
                    <div><dt>Risk</dt><dd>{input.risk ? `${input.risk.level} (${input.risk.score})` : <span className='ws-muted'>Not scored yet</span>}</dd></div>
                    <div><dt>Interventions completed</dt><dd>{input.interventions.completed} of {input.interventions.total}</dd></div>
                    <div><dt>Revenue (last {input.performance.monthsReported || 0} months)</dt><dd>{money(input.performance.annualRevenue)}</dd></div>
                    <div><dt>Employees</dt><dd>{input.performance.employees ?? '—'}</dd></div>
                </dl>
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    <Check ok={yesNo(input.capability.capacity)} label='Capacity and equipment to deliver' />
                    <Check ok={yesNo(input.capability.tradeReferences)} label='Trade references' />
                    <Check ok={yesNo(input.capability.clientList)} label='List of target clients' />
                </div>
                <div className='ws-muted' style={{ fontSize: 12, marginTop: 6 }}>From the gap analysis market-linkage answers; grey means not answered.</div>
            </section>

            {p.bids && p.bids.invited > 0 && (
                <section>
                    <h4 className='ws-section-title'>Market record</h4>
                    <dl className='ws-facts'>
                        <div><dt>Opportunities invited to</dt><dd>{p.bids.invited}</dd></div>
                        <div><dt>Bids submitted</dt><dd>{p.bids.submitted}</dd></div>
                        <div><dt>Won / lost</dt><dd>{p.bids.won} / {p.bids.lost}{p.bids.winRate !== null && <span className='ws-muted'> · {p.bids.winRate}% win rate</span>}</dd></div>
                        {p.contracts && p.contracts.count > 0 && (
                            <>
                                <div><dt>Contracts won</dt><dd>{p.contracts.count} · {formatRand(p.contracts.value)}</dd></div>
                                <div><dt>Paid so far</dt><dd>{formatRand(p.contracts.paid)}</dd></div>
                            </>
                        )}
                    </dl>
                    {p.contracts && p.contracts.overdueMilestones > 0 && (
                        <Alert style={{ marginTop: 8 }} type='warning' showIcon message={`${p.contracts.overdueMilestones} contract milestone${p.contracts.overdueMilestones === 1 ? ' is' : 's are'} overdue`} />
                    )}
                    {p.bids.lostReasons.length > 0 && (
                        <Alert
                            style={{ marginTop: 8 }}
                            type='info'
                            showIcon
                            message='Why bids were lost, and what would help'
                            description={
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    {p.bids.lostReasons.map(r => (
                                        <li key={r.key}>{r.label} ({r.count}): {r.support}</li>
                                    ))}
                                </ul>
                            }
                        />
                    )}
                </section>
            )}
        </div>
    )
}
