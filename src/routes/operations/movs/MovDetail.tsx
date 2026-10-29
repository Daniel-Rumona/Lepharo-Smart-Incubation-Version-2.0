import React, { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Modal, Skeleton } from 'antd'
import { CheckOutlined, DownloadOutlined, ExpandOutlined, FileSearchOutlined, InboxOutlined, PaperClipOutlined, QuestionCircleOutlined, RollbackOutlined } from '@ant-design/icons'
import ResolveQueryModal from '@/components/modals/ResolveQueryModal'
import ManageEvidenceModal from '@/components/evidence/ManageEvidenceModal'
import { ROLE_CONFIG } from './roles'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { LightSurface } from '@/components/shared/LightSurface'
import { MovDocumentView } from '@/components/movs/MovDocumentView'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { hasPreIncAgreementEvidence } from '@/services/movService'
import {
    MOV_STATUS_META,
    buildPoeList,
    isPackLocked,
    enrichMov,
    fmtDate,
    hasMovEvidence,
    monthLabel,
    movStatus,
    resolveMovCompletionDate,
    type Mov
} from './movData'
import { PoeButton, StatusPill } from './movParts'
import { QueryThread, RaiseQueryModal } from './MovQueries'
import { DisputePanel } from './MovDispute'
import { downloadMovDoc } from './movDownloads'
import type { MovWorkspace } from './useMovWorkspace'

type Props = {
    mov: Mov
    ws: MovWorkspace
    canApprove: boolean
    currentUid?: string
    activeProgramId?: string | null
    /** After an approval or query: move on to the next MOV to review. */
    onDecided: (movId: string) => void
    /** Bring an MOV back into view (after undoing its approval). */
    onReselect?: (movId: string) => void
}

/** One MOV: what it is, the decision on it, its queries and the confirmation sheet itself. */
export const MovDetail: React.FC<Props> = ({ mov, ws, canApprove, currentUid, activeProgramId, onDecided, onReselect }) => {
    const { message, modal } = App.useApp()
    const reduceMotion = useReducedMotion()
    const enter = reduceMotion ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.24, ease: 'easeOut' as const } }

    const [full, setFull] = useState<Mov | null>(null)
    const [queries, setQueries] = useState<any[]>([])
    const [busy, setBusy] = useState<'approve' | 'download' | 'pack' | null>(null)
    const [raiseOpen, setRaiseOpen] = useState(false)
    const [undoOpen, setUndoOpen] = useState(false)
    const [undoReason, setUndoReason] = useState('')
    const [undoing, setUndoing] = useState(false)
    const [expanded, setExpanded] = useState(false)

    const loadQueries = () => ws.listMovQueries(mov.id).then(setQueries).catch(() => setQueries([]))

    // The full MOV (participant, application, appointments, evidence) loads once it's opened.
    useEffect(() => {
        let cancelled = false
        setFull(null)
        setQueries([])
        enrichMov(mov, activeProgramId)
            .then(m => !cancelled && setFull(m))
            .catch(error => {
                console.error('Failed to load MOV details', error)
                if (!cancelled) setFull(mov)
            })
        loadQueries()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mov.id])

    const current = full ? { ...full, _dispute: mov._dispute } : mov
    const status = ws.role === 'facilitator' ? ws.statusOf(mov) : movStatus(current)
    const isFacilitator = ws.role === 'facilitator'
    const [answering, setAnswering] = useState<any | null>(null)
    // The same Manage evidence dialog as the interventions page: POE beside the signed MOV.
    const [evidenceOpen, setEvidenceOpen] = useState(false)
    const inPackId = ws.packIndex.movToPack[mov.id]
    const inPack = inPackId ? ws.packs.find(p => p.id === inPackId) : null
    const late = status === 'approved' && ws.isLate(current) ? ws.packMonthFor(current) : null
    const poeList = full ? buildPoeList(full) : []
    const openPack = ws.openPackFor(current)
    const sub = [current.interventionTitle, current.facilitatorName].filter(Boolean).join(' · ')

    const approve = async () => {
        const open = queries.filter(q => String(q.status || 'open').toLowerCase() !== 'resolved')
        const mine = open.filter(q => String(q.raisedByUser || '') === String(currentUid || ''))
        const others = open.length - mine.length
        const noEvidence = !hasMovEvidence(current)
        if (open.length || noEvidence) {
            const notes = [
                mine.length ? `Your ${mine.length === 1 ? 'open query' : `${mine.length} open queries`} on this MOV will be marked resolved.` : null,
                others ? `${others === 1 ? 'One query' : `${others} queries`} raised by someone else will stay open until they resolve ${others === 1 ? 'it' : 'them'}.` : null,
                noEvidence ? 'It has no evidence (POE), so it can’t go into a monthly pack until evidence is added.' : null
            ].filter(Boolean) as string[]
            const ok = await modal.confirm({
                centered: true,
                title: 'Approve this MOV?',
                content: <ul className='mv-confirm-list'>{notes.map(n => <li key={n}>{n}</li>)}</ul>,
                okText: 'Approve'
            })
            if (!ok) return
        }
        setBusy('approve')
        try {
            await ws.approve(current, mine.map(q => q.id))
            // A slip of the finger can be taken back straight away, from the message itself.
            const toastKey = `approved-${mov.id}`
            const approvedMov = { ...current, approvedByHod: true }
            message.open({
                key: toastKey,
                type: 'success',
                duration: 10,
                content: (
                    <span className='mv-toast'>
                        MOV approved.
                        <Button
                            size='small'
                            type='link'
                            onClick={async () => {
                                message.destroy(toastKey)
                                try {
                                    await ws.undoApproval(approvedMov, 'Undone straight after approving.')
                                    message.info('Approval undone. The MOV is back in To review.')
                                    await ws.reload()
                                    onReselect?.(mov.id)
                                } catch (error) {
                                    console.error(error)
                                    message.error('The approval couldn’t be undone. Try again from the MOV.')
                                }
                            }}
                        >
                            Undo
                        </Button>
                    </span>
                )
            })
            const openPack = hasMovEvidence(current) ? ws.openPackFor({ ...current, approvedByHod: true }) : null
            await ws.reload()
            if (openPack) {
                // The message's Undo wouldn't know about the pack: from here on, it's the Undo approval button.
                message.destroy(toastKey)
                const add = await modal.confirm({
                    centered: true,
                    title: `Add it to the ${monthLabel(openPack.month)} pack?`,
                    content: `That pack was already submitted and is still waiting for the Center Coordinator. Adding it now updates the pack and lets the CC know.`,
                    okText: 'Add to pack',
                    cancelText: 'Later'
                })
                if (add) await addToPack(openPack)
            }
            onDecided(mov.id)
        } catch (error) {
            console.error(error)
            message.error('The MOV couldn’t be approved. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const sendQuery = async (values: { queryType: string; message: string }) => {
        if (!current.facilitatorId) {
            message.error('This MOV has no facilitator on record, so a query can’t be sent. Ask the ROM team to repair the MOV first.')
            setRaiseOpen(false)
            return
        }
        try {
            await ws.raiseQuery(current, values)
            message.success('Query sent to the facilitator.')
            setRaiseOpen(false)
            await ws.reload()
            onDecided(mov.id)
        } catch (error: any) {
            console.error(error)
            message.error(error?.message === 'approved'
                ? 'This MOV is already approved, so it can’t be queried.'
                : 'The query couldn’t be sent. Nothing was changed; try again.')
        }
    }

    const undo = async () => {
        if (!undoReason.trim()) {
            message.warning('Say why the approval is being undone.')
            return
        }
        setUndoing(true)
        try {
            const { removedFromPack } = await ws.undoApproval(current, undoReason.trim())
            message.success(removedFromPack
                ? `Approval undone and the MOV taken out of the ${monthLabel(removedFromPack)} pack. The Center Coordinator has been notified.`
                : 'Approval undone. The MOV is back in To review.')
            setUndoOpen(false)
            setUndoReason('')
            await ws.reload()
            onReselect?.(mov.id)
        } catch (error: any) {
            console.error(error)
            message.error(error?.message === 'locked'
                ? 'The Center Coordinator has already confirmed the pack this MOV is in, so the approval can’t be undone.'
                : 'The approval couldn’t be undone. Try again.')
        } finally {
            setUndoing(false)
        }
    }

    const resolve = async (q: any, notes: string, file: File | null) => {
        try {
            await ws.resolveQuery(q.id, notes, file)
            message.success('Query resolved.')
            await Promise.all([loadQueries(), ws.reload()])
        } catch (error) {
            console.error(error)
            message.error('The query couldn’t be resolved. Try again.')
        }
    }

    /** Adds an approved MOV to its month's still-open pack; the CC is notified by the pack update. */
    const addToPack = async (pack: any) => {
        setBusy('pack')
        try {
            const added = await ws.addToPack(pack)
            message.success(added > 0 ? `Added to the ${monthLabel(pack.month)} pack. The Center Coordinator has been notified.` : `The ${monthLabel(pack.month)} pack is up to date.`)
            await ws.reload()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message === 'locked' ? 'The Center Coordinator has just confirmed that pack, so it will go into the next month instead.' : 'The pack couldn’t be updated. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const download = async () => {
        setBusy('download')
        try {
            await downloadMovDoc(full || (await enrichMov(mov, activeProgramId)), activeProgramId)
            message.success('Confirmation sheet downloaded.')
        } catch (error) {
            console.error('MOV download failed', error)
            message.error('The confirmation sheet couldn’t be generated. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const evidenceAction = !full ? null : poeList.length ? (
        <PoeButton list={poeList} />
    ) : hasPreIncAgreementEvidence(full) ? (
        <PreIncPoeButton mov={full} />
    ) : full.evidenceNotes ? (
        <Button icon={<FileSearchOutlined />} onClick={() => modal.info({ centered: true, width: 640, title: 'Evidence notes', content: <div style={{ whiteSpace: 'pre-wrap' }}>{full.evidenceNotes}</div> })}>
            Notes
        </Button>
    ) : null

    const document = (
        <LightSurface className='mov-document-preview-surface' style={{ background: '#fff' }}>
            <MovDocumentView mov={current} />
        </LightSurface>
    )

    return (
        <div className='ws-detail' data-guide='mov-detail'>
            <MotionCard>
                <motion.header key={`h-${mov.id}`} className='ws-detail-head' {...enter}>
                    <EntityAvatar name={current.smmeCompanyName || 'SME'} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{current.smmeCompanyName || current.smmeName || 'SME'}</h2>
                        {sub && <div className='ws-detail-sub'>{sub}</div>}
                        <div className='ws-detail-tags'>
                            <StatusPill tone={MOV_STATUS_META[status].tone}>{ROLE_CONFIG[ws.role].movLabels[status] || MOV_STATUS_META[status].label}</StatusPill>
                            {inPack && <StatusPill tone='neutral'>In {monthLabel(inPack.month, 'MMM YYYY')} pack</StatusPill>}
                            {late && <StatusPill tone='warning' title='Its own month’s pack is already confirmed'>Late · goes into {monthLabel(late, 'MMM YYYY')}</StatusPill>}
                            {full && !hasMovEvidence(full) && <StatusPill tone='danger'>No evidence</StatusPill>}
                        </div>
                    </div>
                </motion.header>

                <div className='mv-detail-body'>
                    <div className='mv-actions' data-guide='mov-preview-actions'>
                        {canApprove && status !== 'approved' && status !== 'disputed' && (
                            <Button data-guide='mov-approve-action' type='primary' icon={<CheckOutlined />} loading={busy === 'approve'} disabled={!full} onClick={approve}>
                                {/* "Re-approve" only when it really was approved before. */}
                                {current.hodApprovedAt ? 'Re-approve' : 'Approve'}
                            </Button>
                        )}
                        {canApprove && status === 'approved' && !(inPack && isPackLocked(inPack)) && (
                            <Button icon={<RollbackOutlined />} onClick={() => setUndoOpen(true)}>
                                Undo approval
                            </Button>
                        )}
                        {/* Once approved, an MOV is final for the HOD: later issues go through the CC / M&E pack queries. */}
                        {!isFacilitator && status !== 'approved' && status !== 'disputed' && (
                            <Button data-guide='mov-query-action' danger icon={<QuestionCircleOutlined />} disabled={!full} onClick={() => setRaiseOpen(true)}>
                                Query
                            </Button>
                        )}
                        {isFacilitator && (
                            <Button type='primary' icon={<PaperClipOutlined />} onClick={() => setEvidenceOpen(true)}>
                                {poeList.length ? 'Manage evidence' : 'Add evidence'}
                            </Button>
                        )}
                        {evidenceAction}
                        {status === 'approved' && openPack && full && hasMovEvidence(full) && (
                            <Button type='primary' icon={<InboxOutlined />} loading={busy === 'pack'} onClick={() => addToPack(openPack)}>
                                Add to {monthLabel(openPack.month, 'MMM')} pack
                            </Button>
                        )}
                        <Button icon={<DownloadOutlined />} loading={busy === 'download'} onClick={download}>
                            Download
                        </Button>
                    </div>

                    {status === 'approved' && inPack && isPackLocked(inPack) && (
                        <Alert
                            type='info'
                            showIcon
                            message={`In the ${monthLabel(inPack.month)} pack, which the Center Coordinator has confirmed. Corrections now go through the CC or M&E.`}
                        />
                    )}

                    {status === 'disputed' && (
                        <DisputePanel
                            dispute={mov._dispute}
                            smeName={current.smmeCompanyName || current.smmeName || 'The SME'}
                            facilitatorName={current.facilitatorName || 'The facilitator'}
                            movEvidence={poeList}
                            canDecide={canApprove}
                            onDecide={async (decision, notes) => {
                                try {
                                    await ws.decideDeliveryDispute(mov, decision, notes)
                                    message.success(decision === 'facilitator' ? 'Delivery confirmed by your decision. It’s now in To review.' : 'Sent back to the facilitator.')
                                    await ws.reload()
                                    if (decision === 'facilitator') onReselect?.(mov.id)
                                    else onDecided(mov.id)
                                } catch (error) {
                                    console.error(error)
                                    message.error('The decision couldn’t be saved. Try again.')
                                    throw error
                                }
                            }}
                        />
                    )}

                    <dl className='mv-facts'>
                        <div><dt>Due</dt><dd>{fmtDate(current.dueDate)}</dd></div>
                        {current.confirmationOverride ? (
                            <div><dt>Confirmed by HOD decision</dt><dd>{fmtDate(current.confirmationOverride.at)}</dd></div>
                        ) : (
                            <div><dt>Confirmed by SME</dt><dd>{status === 'disputed' ? 'Disputed' : fmtDate(resolveMovCompletionDate(current))}</dd></div>
                        )}
                        <div><dt>Facilitator</dt><dd>{current.facilitatorName || '—'}</dd></div>
                        <div><dt>Department</dt><dd>{current.departmentName || '—'}</dd></div>
                    </dl>

                    {Array.isArray(current.approvalHistory) && current.approvalHistory.length > 0 && (
                        <section>
                            <h3 className='ws-section-title'>Approval history</h3>
                            <ul className='mv-history'>
                                {[...current.approvalHistory].reverse().map((h: any, i: number) => (
                                    <li key={i}>
                                        <span className='mv-history-what'>{h.action === 'undone' ? 'Approval undone' : 'Approved'}</span>
                                        <span className='mv-muted'>{[h.byName, fmtDate(h.at)].filter(v => v && v !== '—').join(' · ')}</span>
                                        {h.reason && <span className='mv-history-why'>{h.reason}</span>}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {queries.length > 0 && (
                        <section>
                            <h3 className='ws-section-title'>Queries</h3>
                            <QueryThread
                                queries={queries}
                                currentUid={currentUid}
                                readOnly={isFacilitator}
                                onAnswer={isFacilitator ? setAnswering : undefined}
                                onResolve={resolve}
                                onAccept={async q => {
                                    try {
                                        await ws.acceptAnswer(q.id, current)
                                        message.success('Answer accepted.')
                                        await Promise.all([loadQueries(), ws.reload()])
                                    } catch (error) {
                                        console.error(error)
                                        message.error('That couldn’t be saved. Try again.')
                                    }
                                }}
                                onSendBack={async (q, notes) => {
                                    try {
                                        await ws.sendBackAnswer(q.id, notes)
                                        message.success('Sent back to the facilitator.')
                                        await Promise.all([loadQueries(), ws.reload()])
                                    } catch (error) {
                                        console.error(error)
                                        message.error('That couldn’t be sent. Try again.')
                                    }
                                }}
                            />
                        </section>
                    )}

                    <section>
                        <div className='mv-doc-head'>
                            <h3 className='ws-section-title'>Confirmation sheet</h3>
                            <Button size='small' type='text' icon={<ExpandOutlined />} onClick={() => setExpanded(true)} disabled={!full}>
                                Full size
                            </Button>
                        </div>
                        <div data-guide='mov-document-ready'>
                            {full ? <div className='mv-doc-frame'>{document}</div> : <Skeleton active paragraph={{ rows: 10 }} />}
                        </div>
                    </section>
                </div>
            </MotionCard>

            <Modal
                open={undoOpen}
                onCancel={() => setUndoOpen(false)}
                centered
                width={520}
                title='Undo this approval?'
                footer={
                    <Button block type='primary' icon={<RollbackOutlined />} loading={undoing} onClick={undo}>
                        Undo approval
                    </Button>
                }
                destroyOnClose
            >
                <p className='mv-muted'>
                    {inPack
                        ? `It goes back to To review and is taken out of the ${monthLabel(inPack.month)} pack, which is still waiting for the Center Coordinator; they’ll be notified.`
                        : 'It goes back to To review. Nothing is sent to the facilitator; query it afterwards if they need to fix something.'}
                </p>
                <label className='ws-filter-label' htmlFor='mv-undo-reason'>Why?</label>
                <Input.TextArea id='mv-undo-reason' autoSize={{ minRows: 2, maxRows: 4 }} value={undoReason} onChange={e => setUndoReason(e.target.value)} placeholder='e.g. Approved the wrong SME’s MOV.' />
            </Modal>

            {isFacilitator && (
                <ManageEvidenceModal
                    open={evidenceOpen}
                    assignedInterventionId={current.assignedInterventionId || null}
                    companyName={current.smmeCompanyName || current.smmeName}
                    participantId={current.participantId || current.beneficiaryId || null}
                    programId={current.programId || activeProgramId || null}
                    interventionTitle={current.interventionTitle}
                    onClose={() => setEvidenceOpen(false)}
                    onChanged={() => {
                        void ws.reload()
                        enrichMov(mov, activeProgramId).then(setFull).catch(() => undefined)
                    }}
                />
            )}

            {isFacilitator && (
                <ResolveQueryModal
                    open={!!answering}
                    query={answering}
                    actor={{ ...ws.actor, role: ws.actor.role || 'coordinator' }}
                    onClose={() => setAnswering(null)}
                    onResolved={() => { void Promise.all([loadQueries(), ws.reload()]) }}
                />
            )}

            <RaiseQueryModal open={raiseOpen} inPack={!!inPack} facilitatorName={current.facilitatorName} onCancel={() => setRaiseOpen(false)} onSend={sendQuery} />

            <Modal
                open={expanded}
                onCancel={() => setExpanded(false)}
                footer={null}
                centered
                width='min(1180px, calc(100vw - 24px))'
                title={current.smmeCompanyName || 'MOV'}
                destroyOnClose
            >
                <div className='mv-doc-full'>{document}</div>
            </Modal>
        </div>
    )
}
