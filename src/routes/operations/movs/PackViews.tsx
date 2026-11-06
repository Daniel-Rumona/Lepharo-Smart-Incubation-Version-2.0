import React, { useEffect, useState } from 'react'
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Table, Upload } from 'antd'
import { CheckOutlined, DownloadOutlined, FileTextOutlined, QuestionCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, UploadOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { hasPreIncAgreementEvidence } from '@/services/movService'
import {
    PACK_STAGE_META,
    buildPoeList,
    fmtDate,
    isPackLocked,
    monthLabel,
    packInvoice,
    packItems,
    packStage,
    resolveMovCompletionDate,
    type Mov,
    type Pack
} from './movData'
import { PoeButton, StatusPill } from './movParts'
import { QueryThread, RaiseQueryModal } from './MovQueries'
import { PackMovModal } from './PackMovModal'
import { ROLE_CONFIG, queryStage, type MovRole } from './roles'
import { downloadPackDoc } from './movDownloads'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useSigningCeremony } from '@/components/shared/SignatureAnimation'
import type { MovWorkspace, QueryCounts } from './useMovWorkspace'

const STEPS = [
    { step: 'hod_submission', label: 'Submitted by HOD' },
    { step: 'final_confirmation', label: 'Confirmed by CC' },
    { step: 'validation', label: 'Validated by M&E' }
]

/** HOD → CC → M&E as three dots (compact) or a labelled tracker. */
export const StageTracker: React.FC<{ pack: Pack; compact?: boolean }> = ({ pack, compact }) => {
    const approvals: any[] = pack.approvals || []
    return (
        <ol className={`mv-stages${compact ? ' is-compact' : ''}`} aria-label='Pack stages'>
            {STEPS.map(s => {
                const done = approvals.find(a => a?.step === s.step)
                return (
                    <li key={s.step} className={done ? 'is-done' : ''}>
                        <span className='mv-stage-dot' aria-hidden='true' />
                        {!compact && (
                            <span className='mv-stage-text'>
                                <span className='mv-stage-label'>{s.label}</span>
                                <span className='mv-stage-who'>{done ? [done.name, fmtDate(done.date)].filter(v => v && v !== '—').join(' · ') : 'Pending'}</span>
                            </span>
                        )}
                        {compact && <span className='mv-sr'>{s.label}: {done ? 'done' : 'pending'}</span>}
                    </li>
                )
            })}
        </ol>
    )
}

export const PackList: React.FC<{
    packs: Pack[]
    loading: boolean
    selectedId: string | null
    onSelect: (pack: Pack) => void
    queryIndex: Record<string, QueryCounts>
    emptyText: string
    role?: MovRole
}> = ({ packs, loading, selectedId, onSelect, queryIndex, emptyText, role = 'hod' }) => {
    const reduceMotion = useReducedMotion()
    return (
        <div data-guide='mov-main-table'>
            <MotionCard loading={loading} skeleton='list' skeletonRows={5}>
                {packs.length === 0 ? (
                    <Empty className='ws-list-empty' description={emptyText} />
                ) : (
                    <div className='ws-rows' role='listbox' aria-label='Monthly packs'>
                        {packs.map((pack, index) => {
                            const stage = packStage(pack)
                            const queries = queryIndex[pack.id]
                            const count = packItems(pack).length || pack.totalItems || 0
                            return (
                                <motion.button
                                    key={pack.id}
                                    data-guide={index === 0 ? 'view-pack-action' : undefined}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.03, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={pack.id === selectedId}
                                    className={`ws-row${pack.id === selectedId ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(pack)}
                                >
                                    <span className='mv-month' aria-hidden='true'>
                                        <span>{monthLabel(pack.month, 'MMM')}</span>
                                        <small>{monthLabel(pack.month, 'YYYY')}</small>
                                    </span>
                                    <div className='ws-row-main'>
                                        {/* The CC and M&E see every department's packs: name the department. */}
                                        <div className='ws-row-name'>{role === 'cc' || role === 'me' ? pack.department || 'Department' : monthLabel(pack.month)}</div>
                                        <div className='ws-row-meta'>
                                            {count} MOV{count === 1 ? '' : 's'}
                                            {packInvoice(pack) ? ' · Invoice attached' : ' · No invoice'}
                                        </div>
                                        <div className='mv-row-flags'>
                                            <StageTracker pack={pack} compact />
                                            {queries?.open ? <span className='mv-flag is-warning'>{queries.open} open {queries.open === 1 ? 'query' : 'queries'}</span> : null}
                                        </div>
                                    </div>
                                    <div className='ws-row-side'>
                                        <StatusPill tone={PACK_STAGE_META[stage].tone}>{ROLE_CONFIG[role].packLabels[stage] || PACK_STAGE_META[stage].label}</StatusPill>
                                    </div>
                                </motion.button>
                            )
                        })}
                    </div>
                )}
            </MotionCard>
        </div>
    )
}

/** One monthly pack: its stages, MOVs, invoice and queries, with what this role does next. */
export const PackDetail: React.FC<{
    pack: Pack
    ws: MovWorkspace
    canEdit: boolean
    currentUid?: string
    activeProgramId?: string | null
}> = ({ pack, ws, canEdit, currentUid, activeProgramId }) => {
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const ceremony = useSigningCeremony()
    const role = ws.role
    const [queries, setQueries] = useState<any[]>([])
    const [busy, setBusy] = useState<'refresh' | 'download' | 'invoice' | 'confirm' | 'validate' | string | null>(null)
    const [openItem, setOpenItem] = useState<Mov | null>(null)
    const [raiseOpen, setRaiseOpen] = useState(false)
    const [onBehalfOpen, setOnBehalfOpen] = useState(false)
    const [onBehalfReason, setOnBehalfReason] = useState('')
    const items = packItems(pack)
    const stage = packStage(pack)
    const locked = isPackLocked(pack)
    const inv = packInvoice(pack)
    // Only offer Update when it would change something: new approved MOVs, or ones queried since.
    const changes = role === 'hod' ? ws.pendingChanges(pack) : { add: 0, remove: 0 }
    const updatable = canEdit && !locked && (changes.add > 0 || changes.remove > 0)

    const reviews: Record<string, any> = (pack as any).decisionReviews || {}
    const checks: Record<string, any> = (pack as any).poeValidations || {}
    const decided = ws.decidedItems(pack)
    const openQueries = (s: 'cc' | 'me') => queries.filter(q => String(q.status || 'open').toLowerCase() !== 'resolved' && queryStage(q, ws.isMonitoringDepartment) === s)
    const queriesFor = (id: string) => queries.filter(q => String(q.context?.movId || q.movId || q.context?.movRowId || '') === id)

    // Who acts now, and what's still in the way.
    const ccTurn = stage === 'cc' && (role === 'cc' || role === 'me')
    const meTurn = stage === 'me' && role === 'me'
    const unreviewed = decided.filter(m => !reviews[m.id]).length
    const unchecked = items.filter(m => checks[m.id]?.status !== 'validated').length
    const ccBlockers = [
        openQueries('cc').length ? `${openQueries('cc').length} open CC ${openQueries('cc').length === 1 ? 'query' : 'queries'}` : null,
        unreviewed ? `${unreviewed} MOV${unreviewed === 1 ? '' : 's'} confirmed by HOD decision to open first` : null
    ].filter(Boolean) as string[]
    const meBlockers = [
        openQueries('me').length ? `${openQueries('me').length} open M&E ${openQueries('me').length === 1 ? 'query' : 'queries'}` : null,
        unchecked ? `${unchecked} of ${items.length} MOVs still to check` : null
    ].filter(Boolean) as string[]

    const loadQueries = () => ws.listPackQueries(pack.id).then(setQueries).catch(() => setQueries([]))
    useEffect(() => {
        setQueries([])
        loadQueries()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pack.id])

    const changed = async () => {
        await Promise.all([loadQueries(), ws.reload()])
    }

    const run = async (key: string, action: () => Promise<void>, done: string, errors: Record<string, string> = {}) => {
        setBusy(key)
        try {
            await action()
            if (done) message.success(done)
            await changed()
        } catch (error: any) {
            console.error(error)
            message.error(errors[error?.message] || 'That couldn’t be saved. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const refresh = async () => {
        setBusy('refresh')
        try {
            const { items: next, difference } = await ws.refreshPreview(pack)
            if (!next.length) {
                message.warning('No approved MOVs with evidence were found for this month.')
                return
            }
            const ok = await modal.confirm({
                centered: true,
                title: 'Update this pack?',
                content: `${difference > 0 ? `${difference} MOV${difference === 1 ? '' : 's'} will be added.` : difference < 0 ? `${-difference} MOV${difference === -1 ? '' : 's'} will be removed (no longer approved or without evidence).` : 'Its MOVs will be refreshed.'} The Center Coordinator will be notified.`,
                okText: 'Update pack'
            })
            if (!ok) return
            await ws.applyRefresh(pack, next, null)
            message.success('Pack updated. The Center Coordinator has been notified.')
            await ws.reload()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message === 'locked' ? 'The Center Coordinator has already confirmed this pack.' : 'The pack couldn’t be updated. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const replaceInvoice = (file: File) => run('invoice', () => ws.replaceInvoice(pack, file), 'Invoice updated.')

    const download = () => run('download', () => downloadPackDoc(pack, activeProgramId), 'Pack downloaded.', {})

    // Confirming and validating sign the pack with the user's saved signature.
    const confirm = () => run('confirm', () => ceremony.sign(user?.signatureURL, () => ws.confirmPack(pack), 'Signing the pack', `${monthLabel(pack.month)} pack · confirmed by the Center Coordinator`), 'Pack confirmed. M&E can now validate it.', {
        'open-queries': 'Your queries on this pack must be resolved first.',
        'unreviewed-decisions': 'Open each MOV confirmed by HOD decision first.',
        'already-confirmed': 'This pack has already been confirmed.'
    })

    const confirmOnBehalf = async () => {
        if (onBehalfReason.trim().length < 10) {
            message.warning('Say why you’re confirming for the Center Coordinator (at least 10 characters).')
            return
        }
        await run('confirm', () => ws.confirmPack(pack, onBehalfReason), 'Confirmed on behalf of the Center Coordinator.', {
            'open-queries': 'The CC’s queries on this pack must be resolved first.',
            'unreviewed-decisions': 'Open each MOV confirmed by HOD decision first.',
            'already-confirmed': 'This pack has already been confirmed.'
        })
        setOnBehalfOpen(false)
        setOnBehalfReason('')
    }

    const validate = () => run('validate', () => ceremony.sign(user?.signatureURL, () => ws.validatePack(pack), 'Signing the pack', `${monthLabel(pack.month)} pack · validated by M&E`), 'Pack validated. The invoice is now redeemable.', {
        'open-queries': 'Your queries on this pack must be resolved first.',
        unchecked: 'Check every MOV first.',
        'no-signature': 'Save your signature in your profile first; it goes on the pack and each MOV.',
        'not-confirmed': 'The Center Coordinator hasn’t confirmed this pack yet.',
        'already-validated': 'This pack has already been validated.'
    })

    const canQueryPack = (role === 'cc' && stage === 'cc') || (role === 'me' && stage !== 'verified')

    return (
        <div className='ws-detail' data-guide='mov-pack-detail'>
            <MotionCard>
                <header className='ws-detail-head'>
                    <span className='mv-month is-large' aria-hidden='true'>
                        <span>{monthLabel(pack.month, 'MMM')}</span>
                        <small>{monthLabel(pack.month, 'YYYY')}</small>
                    </span>
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{monthLabel(pack.month)} pack</h2>
                        <div className='ws-detail-sub'>{[pack.department, `${items.length || pack.totalItems || 0} MOVs`].filter(Boolean).join(' · ')}</div>
                        <div className='ws-detail-tags'>
                            <StatusPill tone={PACK_STAGE_META[stage].tone}>{ROLE_CONFIG[role].packLabels[stage] || PACK_STAGE_META[stage].label}</StatusPill>
                            {decided.length > 0 && <StatusPill tone='warning'>{decided.length} by HOD decision</StatusPill>}
                        </div>
                    </div>
                </header>

                <div className='mv-detail-body'>
                    {/* What this role does next, and what's in the way. */}
                    {(ccTurn || meTurn || canQueryPack) && (
                        <div className='mv-actions'>
                            {role === 'cc' && ccTurn && (
                                <Button type='primary' icon={<CheckOutlined />} loading={busy === 'confirm'} disabled={ccBlockers.length > 0} onClick={confirm}>
                                    Confirm pack
                                </Button>
                            )}
                            {role === 'me' && ccTurn && (
                                <Button icon={<CheckOutlined />} disabled={ccBlockers.length > 0} onClick={() => setOnBehalfOpen(true)}>
                                    Confirm for the CC
                                </Button>
                            )}
                            {meTurn && (
                                <Button type='primary' icon={<SafetyCertificateOutlined />} loading={busy === 'validate'} disabled={meBlockers.length > 0} onClick={validate}>
                                    Validate pack
                                </Button>
                            )}
                            {canQueryPack && (
                                <Button danger icon={<QuestionCircleOutlined />} onClick={() => setRaiseOpen(true)}>
                                    Query the HOD
                                </Button>
                            )}
                        </div>
                    )}
                    {ccTurn && ccBlockers.length > 0 && <p className='mv-muted mv-blockers'>Before confirming: {ccBlockers.join(' · ')}.</p>}
                    {meTurn && meBlockers.length > 0 && <p className='mv-muted mv-blockers'>Before validating: {meBlockers.join(' · ')}.</p>}
                    {decided.length > 0 && (
                        <Alert
                            type='warning'
                            showIcon
                            message={`${decided.length} MOV${decided.length === 1 ? ' was' : 's were'} confirmed by the HOD’s dispute decision, not the SME’s signature`}
                            description={role === 'cc' && stage === 'cc' ? 'Open each one to see the SME’s complaint and the HOD’s reason, then mark it reviewed. Query it if you don’t agree.' : 'Each is marked below; open it to see the SME’s complaint and the HOD’s reason.'}
                        />
                    )}

                    <StageTracker pack={pack} />

                    {updatable && (
                        <section className='mv-update'>
                            <h3 className='ws-section-title'>This pack can be updated</h3>
                            <p className='mv-muted'>
                                {[
                                    changes.add ? `${changes.add} approved MOV${changes.add === 1 ? '' : 's'} can be added` : null,
                                    changes.remove ? `${changes.remove} MOV${changes.remove === 1 ? ' was' : 's were'} queried since and will be taken out` : null
                                ].filter(Boolean).join(' · ')}. The Center Coordinator is notified when you update it.
                            </p>
                            <div className='mv-actions'>
                                <Button type='primary' icon={<ReloadOutlined />} loading={busy === 'refresh'} onClick={refresh}>
                                    Update pack
                                </Button>
                            </div>
                        </section>
                    )}
                    {role === 'hod' && locked && stage === 'me' && (
                        <Alert type='info' showIcon message='Confirmed by the Center Coordinator, so it can no longer change. MOVs confirmed late go into the next open month.' />
                    )}

                    <dl className='mv-facts'>
                        <div>
                            <dt>Invoice</dt>
                            <dd className='mv-invoice-fact'>
                                {inv ? <a href={inv.url} target='_blank' rel='noreferrer'><FileTextOutlined /> {inv.name}</a> : 'None'}
                                {canEdit && !locked && (
                                    <Upload maxCount={1} showUploadList={false} beforeUpload={f => { void replaceInvoice(f); return Upload.LIST_IGNORE }}>
                                        <Button size='small' type='link' icon={<UploadOutlined />} loading={busy === 'invoice'}>{inv ? 'Replace' : 'Add'}</Button>
                                    </Upload>
                                )}
                            </dd>
                        </div>
                        <div><dt>Prepared by</dt><dd>{pack.hodName || '—'}</dd></div>
                        <div><dt>Submitted</dt><dd>{fmtDate(pack.createdAt)}</dd></div>
                    </dl>

                    {stage === 'verified' && (
                        <div className='mv-actions'>
                            <Button type='primary' icon={<DownloadOutlined />} loading={busy === 'download'} onClick={download}>
                                Download pack
                            </Button>
                        </div>
                    )}

                    {queries.length > 0 && (
                        <section>
                            <h3 className='ws-section-title'>Queries</h3>
                            <QueryThread
                                queries={queries}
                                currentUid={currentUid}
                                readOnly={role === 'hod' || role === 'facilitator'}
                                onAccept={async q => {
                                    await run(`q-${q.id}`, () => ws.acceptPackAnswer(q.id).then(() => undefined), 'Answer accepted.')
                                }}
                                onSendBack={async (q, notes) => {
                                    await run(`q-${q.id}`, () => ws.sendBackAnswer(q.id, notes).then(() => undefined), 'Sent back.')
                                }}
                            />
                        </section>
                    )}

                    <section>
                        <h3 className='ws-section-title'>MOVs in this pack</h3>
                        <Table
                            size='small'
                            rowKey={(m: Mov, i) => m.id || `${m.smmeCompanyName}-${i}`}
                            dataSource={items}
                            pagination={items.length > 10 ? { pageSize: 10, size: 'small', showSizeChanger: false } : false}
                            scroll={{ x: 680 }}
                            onRow={(m: Mov) => ({ onClick: () => setOpenItem(m), style: { cursor: 'pointer' } })}
                            columns={[
                                {
                                    title: 'SME',
                                    ellipsis: true,
                                    render: (_: any, m: any) => (
                                        <span className='mv-pack-sme'>
                                            {m.smmeCompanyName || '—'}
                                            {m.confirmationOverride && <StatusPill tone='warning' title='Confirmed by the HOD’s dispute decision'>HOD decision</StatusPill>}
                                            {queriesFor(m.id).some(q => String(q.status || '').toLowerCase() !== 'resolved') && <StatusPill tone='danger'>Queried</StatusPill>}
                                        </span>
                                    )
                                },
                                { title: 'Intervention', dataIndex: 'interventionTitle', ellipsis: true },
                                { title: 'Facilitator', dataIndex: 'facilitatorName', ellipsis: true },
                                { title: 'Confirmed', width: 110, render: (_: any, m: Mov) => fmtDate(resolveMovCompletionDate(m)) },
                                {
                                    title: 'Evidence',
                                    width: 120,
                                    render: (_: any, m: Mov) => {
                                        const list = buildPoeList(m)
                                        const content = !list.length && hasPreIncAgreementEvidence(m)
                                            ? <PreIncPoeButton mov={m} compact />
                                            : list.length ? <PoeButton list={list} type='link' /> : <span className='mv-muted'>None</span>
                                        return <span onClick={e => e.stopPropagation()}>{content}</span>
                                    }
                                },
                                // The role's own tick: the CC reviews HOD decisions; M&E checks every MOV.
                                ...(role === 'cc' && stage === 'cc' && decided.length
                                    ? [{
                                        title: 'Reviewed',
                                        width: 100,
                                        render: (_: any, m: any) => m.confirmationOverride ? (
                                            <span onClick={e => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={!!reviews[m.id]}
                                                    disabled={busy === `r-${m.id}`}
                                                    onChange={e => run(`r-${m.id}`, () => ws.reviewDecision(pack, m.id, e.target.checked), '')}
                                                />
                                            </span>
                                        ) : null
                                    }]
                                    : []),
                                ...(role === 'me' && stage !== 'verified'
                                    ? [{
                                        title: 'Checked',
                                        width: 90,
                                        render: (_: any, m: Mov) => (
                                            <span onClick={e => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={checks[m.id]?.status === 'validated'}
                                                    disabled={busy === `c-${m.id}` || stage !== 'me'}
                                                    onChange={e => run(`c-${m.id}`, () => ws.setChecked(pack, m, e.target.checked), '')}
                                                />
                                            </span>
                                        )
                                    }]
                                    : [])
                            ]}
                        />
                        <p className='mv-muted mv-pack-hint'>Select an MOV to see its confirmation sheet{canQueryPack ? ' or query it' : ''}.</p>
                    </section>
                </div>
            </MotionCard>

            {openItem && (
                <PackMovModal
                    pack={pack}
                    item={openItem}
                    ws={ws}
                    queries={queriesFor(openItem.id)}
                    canQuery={canQueryPack}
                    currentUid={currentUid}
                    activeProgramId={activeProgramId}
                    onClose={() => setOpenItem(null)}
                    onChanged={() => { void changed() }}
                />
            )}

            <RaiseQueryModal
                open={raiseOpen}
                inPack
                title='Query the pack'
                recipientName={pack.hodName || 'the HOD'}
                note={`It goes to ${pack.hodName || 'the department’s HOD'}. To query one MOV, open it from the list instead.`}
                onCancel={() => setRaiseOpen(false)}
                onSend={async values => {
                    await run('query', () => ws.raisePackQuery(pack, null, values), `Query sent to ${pack.hodName || 'the HOD'}.`, {
                        'no-recipient': 'This pack has no HOD on record to send it to.'
                    })
                    setRaiseOpen(false)
                }}
            />

            <Modal
                open={onBehalfOpen}
                onCancel={() => setOnBehalfOpen(false)}
                centered
                width={520}
                title='Confirm for the Center Coordinator?'
                footer={
                    <Button block type='primary' loading={busy === 'confirm'} onClick={confirmOnBehalf}>
                        Confirm for the CC
                    </Button>
                }
                destroyOnClose
            >
                <p className='mv-muted'>Use this only when the Center Coordinator can’t. Your name and reason are recorded on the pack.</p>
                <label className='ws-filter-label' htmlFor='mv-onbehalf'>Why?</label>
                <Input.TextArea id='mv-onbehalf' autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} value={onBehalfReason} onChange={e => setOnBehalfReason(e.target.value)} placeholder='e.g. The CC is on leave until the end of the month.' />
            </Modal>
            {ceremony.element}
        </div>
    )
}
