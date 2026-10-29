import React, { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, Skeleton, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import {
    CommentOutlined,
    EyeOutlined,
    FileAddOutlined,
    InboxOutlined,
    RedoOutlined,
    TeamOutlined,
    UserOutlined,
    SafetyCertificateOutlined,
    SendOutlined,
    ToolOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { collection, doc, getDoc, getDocs, query as fsQuery, where } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db } from '@/firebase'
import { workflowQueryService } from '@/services/workflowQueryService'
import {
    DISPUTE_OUTCOMES,
    disputeCategoryLabel,
    isDisputeQuery,
    respondToDispute,
    type DisputeOutcome,
    type RedeliveryScope
} from '@/services/deliveryDisputeService'
import {
    collectPoeUrlsFromRecord,
    findAssignedInterventionForMov,
    findAssignedInterventionRecordForMov,
    resolveInterventionRecords,
    syncUploadedPoesToIntervention,
    syncUploadedPoesToMov,
    type PoeResource,
    type UploadedPoe
} from '@/services/poeSyncService'
import { ChoiceCards } from '@/components/queries/ChoiceCards'
import '@/components/queries/choice-cards.css'

// Narrow, structural shape covering every page-local `QueryDoc` type in the
// app (they all differ slightly - flattened aliases vs. nested target/context)
// so this modal can accept any of them without callers needing to cast.
export type ResolvableQuery = {
    id: string
    programId?: string | null
    type?: string | null
    queryType?: string | null
    message?: string | null
    queryMessage?: string | null
    targetType?: string | null
    movId?: string | null
    interventionId?: string | null
    target?: {
        type?: string | null
        id?: string | null
        parentType?: string | null
        parentId?: string | null
    } | null
}

/** Query types that ask for evidence: answered with a file, or with an explanation marked "no new evidence". */
const EVIDENCE_TYPES = new Set(['poe-request', 'mov-request', 'me-query', 'cc-poe-query', 'cc-pack-query'])
const isEvidenceQuery = (q?: any) => {
    const type = String(q?.queryType || q?.type || '').trim().toLowerCase()
    if (EVIDENCE_TYPES.has(type)) return true
    if (['mov-issue', 'general-query'].includes(type) || isDisputeQuery(q)) return false
    const targetType = String(q?.targetType || q?.target?.type || '').trim().toLowerCase()
    return /(poe|proof|evidence|document|attachment|file)/.test(`${type} ${targetType}`)
}

const TYPE_LABELS: Record<string, string> = {
    'poe-request': 'Evidence (POE)',
    'mov-request': 'MOV request',
    'mov-issue': 'Session details',
    'general-query': 'Other',
    'me-query': 'M&E query',
    'cc-poe-query': 'Center Coordinator query',
    'cc-pack-query': 'Center Coordinator query',
    'completion-rejected': 'SME delivery dispute',
    'completion-rejection': 'SME delivery dispute',
    'delivery-query': 'SME delivery dispute'
}
const ROLE_LABELS: Record<string, string> = {
    incubatee: 'SME', beneficiary: 'SME', coordinator: 'Facilitator', operations: 'HOD', projectadmin: 'Center Coordinator'
}

const normalizePoeResources = (record: any): PoeResource[] => {
    if (!record) return []
    if (Array.isArray(record.resources) && record.resources.length) {
        return record.resources.filter((resource: any) => resource?.link)
    }
    return collectPoeUrlsFromRecord(record).map((link, index) => ({ type: 'poe', label: `POE ${index + 1}`, link }))
}

// Uploaded POEs commonly end up on the linked assignedIntervention record
// rather than the MOV doc itself, so the "current evidence" preview unions them.
const mergePoeResourceLists = (records: any[]): PoeResource[] => {
    const byLink = new Map<string, PoeResource>()
    records.forEach(record => normalizePoeResources(record).forEach(resource => {
        if (resource?.link) byLink.set(resource.link, resource)
    }))
    return Array.from(byLink.values())
}

type EvidenceContext =
    | { kind: 'mov'; mov: any; existingPoes: PoeResource[] }
    | { kind: 'intervention'; assignedInterventionId: string; existingPoes: PoeResource[] }
    | { kind: 'none' }

const loadEvidenceContext = async (q: ResolvableQuery): Promise<EvidenceContext> => {
    const targetType = String((q as any).target?.type || (q as any).targetType || '').trim()
    const parentType = String((q as any).target?.parentType || '').trim()

    if (targetType === 'mov' || targetType === 'mov-pack' || (targetType === 'poe' && parentType !== 'intervention')) {
        const movId = String((targetType === 'mov' || targetType === 'poe' ? (q as any).target?.id : '') || (q as any).movId || '').trim()
        if (movId) {
            const snap = await getDoc(doc(db, 'movDocuments', movId))
            if (snap.exists()) {
                const mov = { id: snap.id, ...(snap.data() as any) }
                const programId = (q as any).programId || mov.programId || null
                const assignment = await findAssignedInterventionForMov(mov, programId)
                const deliveryRecord = await findAssignedInterventionRecordForMov({
                    mov,
                    assignedInterventionId: assignment?.record?.id || mov?.assignedInterventionId || null,
                    programId
                })
                return { kind: 'mov', mov, existingPoes: mergePoeResourceLists([mov, assignment?.record, deliveryRecord?.record]) }
            }
        }
        return { kind: 'none' }
    }

    if (['assigned-intervention', 'intervention', 'completion'].includes(targetType)) {
        const assignedInterventionId = String((q as any).target?.id || (q as any).interventionId || '').trim()
        if (assignedInterventionId) {
            const { assignmentRecord, deliveryRecord } = await resolveInterventionRecords(assignedInterventionId)
            if (assignmentRecord) {
                return { kind: 'intervention', assignedInterventionId, existingPoes: mergePoeResourceLists([assignmentRecord, deliveryRecord]) }
            }
        }
    }
    return { kind: 'none' }
}

export type ResolveQueryModalActor = {
    id: string
    name?: string | null
    email?: string | null
    role?: string | null
    departmentName?: string | null
    departmentId?: string | null
}

export type ResolveQueryModalProps = {
    open: boolean
    query: ResolvableQuery | null
    actor: ResolveQueryModalActor
    onClose: () => void
    /** Called after the answer (or closing) is saved. */
    onResolved?: (queryId: string) => void
    width?: number | string
}

type AnswerMode = 'evidence' | 'explain'

const fmt = (v: any) => {
    const d = v?.toDate ? v.toDate() : typeof v?.seconds === 'number' ? new Date(v.seconds * 1000) : v ? new Date(v) : null
    return d && !isNaN(+d) ? dayjs(d).format('D MMM YYYY') : ''
}

/**
 * Answering a query, for the person it was raised for (usually the facilitator):
 *  - any query: an explanation, with evidence when it helps;
 *  - evidence queries: attach evidence, or explain why there is none ("no new evidence");
 *  - SME delivery disputes: correct and resend, deliver what's missing, or stand by
 *    the record and let the HOD decide.
 * The answer goes back to whoever raised the query, who accepts it or sends it back.
 * If the person who raised it opens this themselves, it closes the query instead.
 */
const ResolveQueryModal: React.FC<ResolveQueryModalProps> = ({ open, query, actor, onClose, onResolved, width }) => {
    const q = query as any
    const [files, setFiles] = useState<UploadFile[]>([])
    const [answer, setAnswer] = useState('')
    const [replaceExisting, setReplaceExisting] = useState(false)
    const [standsOnExisting, setStandsOnExisting] = useState(false)
    const [mode, setMode] = useState<AnswerMode>('evidence')
    const [outcome, setOutcome] = useState<DisputeOutcome>('corrected')
    const [submitting, setSubmitting] = useState(false)
    const [contextLoading, setContextLoading] = useState(false)
    const [evidenceContext, setEvidenceContext] = useState<EvidenceContext>({ kind: 'none' })
    // A dispute on a grouped intervention: redeliver to this SME alone, or to the whole group.
    const [scope, setScope] = useState<RedeliveryScope>('member')
    const [groupInfo, setGroupInfo] = useState<{ sme: string; size: number; disputing: number } | null>(null)

    useEffect(() => {
        if (!open || !query) return
        setFiles([])
        setAnswer('')
        setReplaceExisting(false)
        setStandsOnExisting(false)
        setMode('evidence')
        setOutcome('corrected')
        setScope('member')
        setGroupInfo(null)
        setEvidenceContext({ kind: 'none' })
        let cancelled = false
        if (isDisputeQuery(query)) {
            const assignmentId = String((query as any).target?.id || '')
            ;(async () => {
                const record = assignmentId ? (await getDoc(doc(db, 'assignedInterventions', assignmentId))).data() as any : null
                const groupKey = String(record?.groupKey || '').trim()
                if (!groupKey || cancelled) return
                const members = await getDocs(fsQuery(collection(db, 'assignedInterventions'), where('groupKey', '==', groupKey)))
                if (cancelled || members.size < 2) return
                setGroupInfo({
                    sme: String(record?.participantName || record?.beneficiaryName || 'this SME'),
                    size: members.size,
                    disputing: members.docs.filter(m => String((m.data() as any).participantCompletionStatus || '').toLowerCase() === 'rejected').length
                })
            })().catch(() => undefined)
        }
        setContextLoading(true)
        loadEvidenceContext(query)
            .then(ctx => !cancelled && setEvidenceContext(ctx))
            .catch(() => !cancelled && setEvidenceContext({ kind: 'none' }))
            .finally(() => !cancelled && setContextLoading(false))
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, query?.id])

    const isRaiser = !!q && String(q.raisedById || q.raisedByUser || '') === String(actor.id || '')
    const dispute = isDisputeQuery(q)
    const evidenceQuery = !dispute && isEvidenceQuery(q)
    const existingPoes = evidenceContext.kind !== 'none' ? evidenceContext.existingPoes : []
    const raiserName = String(q?.raisedByName || q?.raisedBy?.name || '').trim() || ROLE_LABELS[String(q?.raisedByRole || q?.raisedBy?.role || '')] || 'whoever raised it'
    const raiserRole = ROLE_LABELS[String(q?.raisedByRole || q?.raisedBy?.role || '').toLowerCase()] || ''
    const sentBack = String(q?.sentBackNotes || q?.lastSentBack?.notes || '').trim()
    const category = disputeCategoryLabel(q?.context?.disputeCategory)

    const showUpload = isRaiser || dispute || !evidenceQuery || mode === 'evidence'
    // Standing by the record needs proof: new files, or the evidence already on file.
    const proofNeeded = !isRaiser && dispute && outcome === 'delivered-as-recorded'
    const prompt = isRaiser
        ? { label: 'Closing note', placeholder: 'e.g. Sorted: the register was re-uploaded.' }
        : dispute
            ? outcome === 'corrected'
                ? { label: 'What did you correct?', placeholder: 'e.g. Fixed the session date to 5 Sep and attached the signed register.' }
                : outcome === 'redeliver'
                    ? { label: 'What will you deliver, and when?', placeholder: 'e.g. The remaining two sessions are booked for 14 and 21 Oct.' }
                    : { label: 'Why do you stand by the record?', placeholder: 'e.g. The SME attended on 12 Aug; the signed register and photos are attached.' }
            : evidenceQuery && mode === 'explain'
                ? { label: 'Why is there no new evidence?', placeholder: 'e.g. The register was signed on paper; I’ll upload the scan on Monday.' }
                : { label: 'Your answer', placeholder: 'Explain what was corrected or supplied.' }

    const uploadEvidence = async (file: File): Promise<UploadedPoe> => {
        const safeName = String(file.name || 'evidence').replace(/\s+/g, '_')
        const rf = storageRef(getStorage(), `workflowQueries/${q?.programId || 'no-program'}/${q?.id}/${Date.now()}_${safeName}`)
        await uploadBytes(rf, file)
        return { name: file.name || 'Evidence', link: await getDownloadURL(rf) }
    }

    const submit = async () => {
        if (!query) return
        const text = answer.trim()
        if (!text) {
            message.warning(isRaiser ? 'Add a short closing note.' : 'Write your answer first.')
            return
        }
        if (!isRaiser && !dispute && evidenceQuery && mode === 'evidence' && !files.length) {
            message.warning('Attach the evidence, or choose “Explain only”.')
            return
        }
        if (proofNeeded && !files.length && !(standsOnExisting && existingPoes.length)) {
            message.warning(existingPoes.length
                ? 'Attach proof, or confirm the current evidence shows it was delivered.'
                : 'Attach proof that it was delivered. There’s none on file yet.')
            return
        }
        setSubmitting(true)
        try {
            const uploaded: UploadedPoe[] = []
            for (const file of showUpload ? files : []) {
                const raw = file.originFileObj as File | undefined
                if (raw) uploaded.push(await uploadEvidence(raw))
            }
            if (uploaded.length) {
                if (evidenceContext.kind === 'mov') {
                    await syncUploadedPoesToMov({ mov: evidenceContext.mov, programId: q?.programId || null, uploaded, replaceExisting })
                } else if (evidenceContext.kind === 'intervention') {
                    await syncUploadedPoesToIntervention({ assignedInterventionId: evidenceContext.assignedInterventionId, uploaded, replaceExisting })
                }
            }
            const actorInput = { name: actor.name || null, email: actor.email || null, role: actor.role || null, departmentName: actor.departmentName || null, departmentId: actor.departmentId || null }
            const links = uploaded.map(u => u.link)

            if (isRaiser) {
                await workflowQueryService.resolve(query.id, { notes: text, attachmentUrl: links[0] || null, actorId: actor.id, actor: actorInput })
                message.success('Query closed.')
            } else if (dispute) {
                await respondToDispute({
                    query,
                    outcome,
                    message: text,
                    attachmentUrls: links,
                    existingEvidenceUrls: proofNeeded && standsOnExisting ? existingPoes.map(r => r.link) : [],
                    scope: groupInfo ? scope : 'member',
                    actor: { id: actor.id, ...actorInput }
                })
                message.success(
                    outcome === 'delivered-as-recorded'
                        ? 'Sent to the HOD to decide.'
                        : outcome === 'redeliver'
                            ? groupInfo && scope === 'group'
                                ? 'The whole group is back in delivery. SMEs who already confirmed keep their confirmation.'
                                : groupInfo
                                    ? `${groupInfo.sme} is in catch-up. Complete it for them when it’s done; the rest of the group is unaffected.`
                                    : 'Back in delivery. Complete it again when it’s done and the SME will be asked to confirm.'
                            : 'Sent. The SME has been asked to confirm again.'
                )
            } else {
                await workflowQueryService.answer(query.id, {
                    message: text,
                    attachmentUrls: links,
                    noNewEvidence: evidenceQuery && !links.length,
                    actorId: actor.id,
                    actor: actorInput
                })
                message.success(`Answer sent to ${raiserName}.`)
            }
            onResolved?.(query.id)
            onClose()
        } catch (error) {
            console.error(error)
            message.error('That couldn’t be saved. Nothing was sent; try again.')
        } finally {
            setSubmitting(false)
        }
    }

    const title = isRaiser ? 'Close this query' : dispute ? 'Respond to the SME’s dispute' : 'Answer this query'
    const sendLabel = isRaiser
        ? 'Close query'
        : dispute
            ? outcome === 'delivered-as-recorded' ? 'Send to the HOD to decide' : outcome === 'redeliver' ? 'Back to delivery' : 'Send to the SME to confirm'
            : `Send answer to ${raiserName}`

    return (
        <Modal
            open={open}
            onCancel={onClose}
            centered
            title={title}
            width={width ?? 680}
            footer={
                <div className='qc-footer'>
                    {!isRaiser && q && (
                        <p className='qc-footer-note'>
                            {dispute
                                ? outcome === 'delivered-as-recorded'
                                    ? 'The HOD sees the SME’s complaint and your answer, then decides.'
                                    : 'The SME is told and, once it’s sorted, asked to confirm again.'
                                : `${raiserName} reviews your answer and accepts it or sends it back.`}
                        </p>
                    )}
                    <Button block type='primary' icon={<SendOutlined />} loading={submitting} disabled={contextLoading} onClick={submit}>
                        {sendLabel}
                    </Button>
                </div>
            }
            destroyOnClose
        >
            {!q ? null : (
                <>
                    {/* The query being answered. */}
                    <div className='qc-quote'>
                        <div className='qc-quote-head'>
                            <span className='qc-quote-who'>{raiserName}</span>
                            {raiserRole && raiserRole !== raiserName && <span>{raiserRole}</span>}
                            <span>·</span>
                            <span>{TYPE_LABELS[String(q.queryType || q.type || '')] || 'Query'}</span>
                            {category && <><span>·</span><span>{category}</span></>}
                            {fmt(q.createdAt) && <><span>·</span><span>{fmt(q.createdAt)}</span></>}
                        </div>
                        <p className='qc-quote-text'>{String(q.queryMessage || q.message || 'No details provided.').replace(category ? `${category}: ` : /^$/, '')}</p>
                        {sentBack && (
                            <div className='qc-sentback'>
                                <strong>Sent back — still needed</strong>
                                {sentBack}
                            </div>
                        )}
                    </div>

                    {existingPoes.length > 0 && (
                        <div className='qc-section'>
                            <h4 className='qc-section-title'>Current evidence</h4>
                            <div className='qc-evidence'>
                                {existingPoes.map((r, i) => (
                                    <Button key={`${r.link}-${i}`} size='small' icon={<EyeOutlined />} onClick={() => window.open(r.link, '_blank', 'noopener')}>
                                        {r.label || `Evidence ${i + 1}`}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                    {contextLoading && <Skeleton active paragraph={{ rows: 1 }} title={false} style={{ marginTop: 12 }} />}

                    {!isRaiser && dispute && (
                        <div className='qc-section'>
                            <ChoiceCards
                                compact
                                label='How are you responding?'
                                value={outcome}
                                onChange={setOutcome}
                                options={DISPUTE_OUTCOMES.map(o => ({
                                    ...o,
                                    icon: o.value === 'corrected' ? <ToolOutlined /> : o.value === 'redeliver' ? <RedoOutlined /> : <SafetyCertificateOutlined />
                                }))}
                            />
                        </div>
                    )}

                    {!isRaiser && dispute && outcome === 'redeliver' && groupInfo && (
                        <div className='qc-section'>
                            <ChoiceCards
                                compact
                                columns={2}
                                label='Who is it redelivered to?'
                                value={scope}
                                onChange={setScope}
                                options={[
                                    { value: 'member', label: `Just ${groupInfo.sme}`, detail: 'A catch-up for them; the group stays delivered', icon: <UserOutlined /> },
                                    { value: 'group', label: `The whole group (${groupInfo.size})`, detail: 'Shared progress goes back; confirmed SMEs keep theirs', icon: <TeamOutlined /> }
                                ]}
                            />
                            {groupInfo.disputing > 1 && (
                                <p className='qc-hint'>{groupInfo.disputing} SMEs in this group dispute the completion — it may not be specific to one person.</p>
                            )}
                        </div>
                    )}

                    {!isRaiser && evidenceQuery && (
                        <div className='qc-section'>
                            <ChoiceCards
                                compact
                                label='How are you answering?'
                                columns={2}
                                value={mode}
                                onChange={setMode}
                                options={[
                                    { value: 'evidence', label: 'Add evidence', detail: 'Attach the document or proof that was asked for', icon: <FileAddOutlined /> },
                                    { value: 'explain', label: 'Explain only', detail: 'There’s no new evidence; say why. They decide whether that’s enough', icon: <CommentOutlined /> }
                                ]}
                            />
                        </div>
                    )}

                    <div className='qc-section'>
                        <label className='qc-section-title' htmlFor='query-answer' style={{ display: 'block' }}>{prompt.label}</label>
                        <Input.TextArea id='query-answer' autoSize={{ minRows: 2, maxRows: 6 }} value={answer} onChange={e => setAnswer(e.target.value)} placeholder={prompt.placeholder} />
                    </div>

                    {showUpload && (
                        <div className='qc-section'>
                            <h4 className='qc-section-title'>
                                {proofNeeded ? 'Proof it was delivered' : !isRaiser && !dispute && evidenceQuery ? 'Evidence' : 'Evidence (optional)'}
                            </h4>
                            {proofNeeded && existingPoes.length > 0 && (
                                <Checkbox style={{ marginBottom: 8 }} checked={standsOnExisting} onChange={e => setStandsOnExisting(e.target.checked)}>
                                    The current evidence above shows it was delivered
                                </Checkbox>
                            )}
                            {proofNeeded && (
                                <p className='qc-hint'>
                                    {existingPoes.length
                                        ? 'Tick the box, attach new proof, or both. The HOD sees all of it.'
                                        : 'Required: there’s no evidence on file. Attach a signed register, photos or similar.'}
                                </p>
                            )}
                            <Upload.Dragger
                                className='qc-drop'
                                multiple
                                maxCount={10}
                                beforeUpload={() => false}
                                fileList={files}
                                onChange={({ fileList }) => setFiles(fileList)}
                                accept='image/*,.pdf,.doc,.docx,.xls,.xlsx'
                            >
                                <p className='qc-drop-line'>
                                    <InboxOutlined />
                                    <span>Drop files or click to choose <small>· PDF, image, Word or Excel</small></span>
                                </p>
                            </Upload.Dragger>
                            {existingPoes.length > 0 && files.length > 0 && (
                                <Checkbox style={{ marginTop: 8 }} checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)}>
                                    Replace the current evidence instead of adding to it
                                </Checkbox>
                            )}
                        </div>
                    )}

                </>
            )}
        </Modal>
    )
}

export default ResolveQueryModal
