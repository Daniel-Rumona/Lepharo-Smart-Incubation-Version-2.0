import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, DatePicker, Input, InputNumber, Modal, Segmented, Select, Spin, Tag, Tooltip, Upload, message } from 'antd'
import {
    CheckCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    InboxOutlined,
    LeftOutlined,
    SaveOutlined,
    SendOutlined,
    UndoOutlined,
    WarningOutlined
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { KpiCandidate, KpiCandidateChatMessage, KpiCandidateDraft } from '@/types/kpiCandidate'
import { extractKpiCandidates, sendKpiCandidateChatTurn } from '@/services/kpiCandidateService'
import { recordAiFeedback, type AiFeedbackItem } from '@/services/aiFeedbackService'
import type { SourceType, Unit } from './kpiModel'
import { createKpisFromCandidates } from './kpiSaveService'
import { DepartmentSelect } from './DepartmentSelect'
import type { Department } from './kpiDraft'

const FEEDBACK_FEATURE = 'kpi_source_mapping'

export type AssistantMode = 'upload' | 'chat'

/** A drafted KPI under review. `id` is stable, so editing a name never remounts the row. */
export interface ReviewRow {
    id: string
    kpiName: string
    kpiArea: string
    annual: number
    quarters: [number, number, number, number]
    /** The letter gave only an annual figure; the quarters were split from it. */
    splitFromAnnual: boolean
    include: boolean
    trackingMode: 'computed' | 'manual'
    unit: Unit
    sourceType?: SourceType
    field?: string | null
    calculationType?: 'count' | 'sum' | 'average'
    countMode?: 'records'
    filters: { field: string; op: '==' | '!=' | 'in'; value: any }[]
    aiMapping: KpiCandidate['mapping']
}

/** metrics/interventions/applications mapping → the stored computed shape, independent of the model's free text. */
const resolveComputed = (mapping: KpiCandidate['mapping']) => {
    if (!mapping?.sourceType) return null
    if (mapping.sourceType === 'metrics' && mapping.field) {
        return {
            sourceType: 'metrics' as const,
            field: mapping.field,
            calculationType: mapping.calculationType === 'average' ? ('average' as const) : ('sum' as const),
            unit: (mapping.field === 'monthlyRevenue' ? 'ZAR' : 'count') as Unit,
            filters: []
        }
    }
    if (mapping.sourceType === 'interventions' && mapping.interventionTitleMatch) {
        return {
            sourceType: 'interventions' as const,
            field: null,
            calculationType: 'count' as const,
            countMode: 'records' as const,
            unit: 'count' as Unit,
            filters: [{ field: 'interventionTitle', op: '==' as const, value: mapping.interventionTitleMatch }]
        }
    }
    if (mapping.sourceType === 'applications') {
        return { sourceType: 'applications' as const, field: null, calculationType: 'count' as const, unit: 'count' as Unit, filters: [] }
    }
    return null
}

/** Split a whole number into four quarters that add back up to it. */
const splitAnnual = (annual: number): [number, number, number, number] => {
    const base = Math.floor(annual / 4)
    const rest = annual - base * 4
    return [base, base, base, base + rest]
}

const guessUnit = (candidate: KpiCandidate): Unit => {
    const text = `${candidate.kpiName} ${candidate.mapping?.unit || ''}`.toLowerCase()
    if (/%|percent|rate/.test(text)) return 'percent'
    if (/\br\b|rand|zar|revenue|turnover|sales|income|value/.test(text)) return 'ZAR'
    return 'count'
}

let rowSeq = 0
const toRow = (candidate: KpiCandidate): ReviewRow => {
    const computed = resolveComputed(candidate.mapping)
    const given: [number, number, number, number] = [candidate.q1 || 0, candidate.q2 || 0, candidate.q3 || 0, candidate.q4 || 0]
    const onlyAnnual = given.every(v => !v) && candidate.annual > 0
    return {
        id: `row-${++rowSeq}`,
        kpiName: candidate.kpiName,
        kpiArea: candidate.kpiArea,
        annual: candidate.annual || given.reduce((a, b) => a + b, 0),
        quarters: onlyAnnual ? splitAnnual(candidate.annual) : given,
        splitFromAnnual: onlyAnnual,
        include: true,
        trackingMode: computed ? 'computed' : 'manual',
        aiMapping: candidate.mapping,
        ...(computed || {}),
        unit: computed?.unit || guessUnit(candidate),
        filters: computed?.filters || []
    }
}

/**
 * The financial year's first month. Taken from the letter's FY label when it
 * names a year ("2026-27" → April 2026), otherwise the April that started the
 * current South African financial year. Always the first month of a calendar
 * quarter, so each of the letter's quarters maps onto exactly one period.
 */
const fyStartFrom = (fyLabel: string) => {
    const year = Number(fyLabel.match(/(20\d{2})/)?.[1])
    if (year) return dayjs(`${year}-04-01`)
    const today = dayjs()
    return dayjs(`${today.month() >= 3 ? today.year() : today.year() - 1}-04-01`)
}

/** April 2026 → "2026-27 financial year". */
const fyLabelOf = (fyStart: Dayjs) => `${fyStart.year()}-${String((fyStart.year() + 1) % 100).padStart(2, '0')} financial year`

const quarterLabel = (fyStart: Dayjs, offset: number) => fyStart.add(offset * 3, 'month').format('MMM YY')

type Props = {
    mode: AssistantMode
    departments: Department[]
    departmentId?: string
    onDepartmentChange: (id: string | undefined) => void
    /** Monitoring departments set KPIs for any department; others only for their own. */
    canChooseDepartment: boolean
    activeProgramId?: string | null
    activeProgramName?: string | null
    isAllPrograms: boolean
    uid: string
    /** Leave the assistant (to the entry screen). */
    onExit: () => void
    onCreated: (count: number) => void
    /** Open a drafted row in the full builder; call `done(true)` once it has been created there. */
    onEditInBuilder: (row: ReviewRow, fyStart: Dayjs, done: (created: boolean) => void) => void
}

export const KpiAssistant: React.FC<Props> = ({
    mode,
    departments,
    departmentId,
    onDepartmentChange,
    canChooseDepartment,
    activeProgramId,
    activeProgramName,
    isAllPrograms,
    uid,
    onExit,
    onCreated,
    onEditInBuilder
}) => {
    const [phase, setPhase] = useState<'start' | 'review'>('start')
    const [extracting, setExtracting] = useState(false)
    const [saving, setSaving] = useState(false)
    const [warnings, setWarnings] = useState<string[]>([])
    const [fyLabel, setFyLabel] = useState('')
    const [fyStart, setFyStart] = useState<Dayjs>(fyStartFrom(''))
    const programAvailable = !!activeProgramId && !isAllPrograms
    const [scope, setScope] = useState<'program' | 'all'>(programAvailable ? 'program' : 'all')
    const [rows, setRows] = useState<ReviewRow[]>([])
    const [messages, setMessages] = useState<KpiCandidateChatMessage[]>([])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const chatEnd = useRef<HTMLDivElement>(null)
    const department = departments.find(d => d.id === departmentId)
    // Hook-based confirm so the dialog picks up the app theme.
    const [modal, modalHolder] = Modal.useModal()

    useEffect(() => {
        chatEnd.current?.scrollIntoView({ block: 'nearest' })
    }, [messages.length, sending])

    // The chat opens on the KPIs themselves, written here so it shows at once.
    // The financial year defaults to the current one (changeable on review),
    // so it is never the first thing asked.
    const opener: KpiCandidateChatMessage = {
        role: 'assistant',
        content: `Let's set up ${department?.name || 'this department'}'s KPIs for the ${fyLabelOf(fyStartFrom(''))}, one at a time. ` +
            'What is the first KPI called, and what is it about? For example "SMEs onboarded: new SMEs accepted into the programme". ' +
            "I'll ask about the target and how it's measured next."
    }
    const conversation = messages.length ? messages : [opener]

    const applyDraft = (draft: KpiCandidateDraft) => {
        setFyLabel(draft.fyLabel || '')
        setFyStart(fyStartFrom(draft.fyLabel || ''))
        setWarnings(draft.warnings || [])
        setRows(draft.candidates.map(toRow))
        setPhase('review')
    }

    const extract = async (file: File) => {
        if (!departmentId) {
            message.warning('Choose a department first.')
            return
        }
        setExtracting(true)
        try {
            applyDraft(await extractKpiCandidates(file, departmentId))
        } catch (error: any) {
            message.error(error?.message || 'Could not read that document.')
        } finally {
            setExtracting(false)
        }
    }

    const send = async () => {
        const text = input.trim()
        if (!text || sending || !departmentId) return
        const next: KpiCandidateChatMessage[] = [...conversation, { role: 'user', content: text }]
        setMessages(next)
        setInput('')
        setSending(true)
        try {
            const result = await sendKpiCandidateChatTurn(next, departmentId)
            setMessages([...next, { role: 'assistant', content: result.message }])
            if (result.done && result.draft) applyDraft(result.draft)
        } catch (error: any) {
            message.error(error?.message || 'The assistant is unavailable right now.')
        } finally {
            setSending(false)
        }
    }

    const update = (id: string, patch: Partial<ReviewRow>) =>
        setRows(current => current.map(r => (r.id === id ? { ...r, ...patch } : r)))

    const included = rows.filter(r => r.include)
    const liveCount = included.filter(r => r.trackingMode === 'computed').length

    const confirmLeaveReview = (then: () => void) => {
        if (!rows.length) return then()
        modal.confirm({
            title: 'Discard this draft?',
            content: `${rows.length} drafted KPI${rows.length === 1 ? '' : 's'} will be lost.`,
            okText: 'Discard draft',
            okButtonProps: { danger: true },
            cancelText: 'Keep reviewing',
            onOk: then
        })
    }

    const back = () => {
        if (phase === 'review') {
            confirmLeaveReview(() => {
                setRows([])
                setWarnings([])
                // From a chat, return to the conversation; it's still there.
                if (mode === 'chat') setPhase('start')
                else onExit()
            })
            return
        }
        onExit()
    }

    const recordFeedback = () => {
        const items: AiFeedbackItem[] = []
        rows.forEach(r => {
            if (!r.aiMapping) return
            if (!r.include) {
                items.push({ entityType: 'mapping', suggested: r.aiMapping, final: null, action: 'declined' })
                return
            }
            items.push({
                entityType: 'mapping',
                suggested: r.aiMapping,
                final: { trackingMode: r.trackingMode, sourceType: r.sourceType || null, field: r.field || null },
                action: !!r.aiMapping.sourceType === (r.trackingMode === 'computed') ? 'accepted' : 'edited'
            })
        })
        if (items.length) recordAiFeedback(FEEDBACK_FEATURE, items).catch(() => {})
    }

    const problems = useMemo(() => {
        const list: string[] = []
        if (!department) list.push('Choose a department.')
        if (!included.length) list.push('Include at least one KPI.')
        if (included.some(r => !r.kpiName.trim())) list.push('Every included KPI needs a name.')
        if (scope === 'program' && !programAvailable) list.push('Select a single programme first, or apply these KPIs to all programmes.')
        return list
    }, [department, included, scope, programAvailable])

    const create = async () => {
        if (problems.length || !department) {
            message.warning(problems[0])
            return
        }
        setSaving(true)
        try {
            await createKpisFromCandidates({
                candidates: included.map(r => ({
                    kpiName: r.kpiName,
                    quarters: r.quarters,
                    unit: r.unit,
                    trackingMode: r.trackingMode,
                    sourceType: r.sourceType,
                    field: r.field,
                    calculationType: r.calculationType,
                    countMode: r.countMode,
                    filters: r.filters
                })),
                departmentId: department.id,
                departmentName: department.name,
                fyLabel,
                fyStart,
                scope,
                activeProgramId,
                uid
            })
            recordFeedback()
            onCreated(included.length)
        } catch (error: any) {
            // Nothing was written: the KPIs are created together or not at all.
            message.error(error?.message || 'Could not create the KPIs. Nothing was saved — try again.')
        } finally {
            setSaving(false)
        }
    }

    const departmentPicker = canChooseDepartment ? (
        <div className='kb-field'>
            <label className='kb-label' htmlFor='kb-assistant-dept'>Department</label>
            <DepartmentSelect
                id='kb-assistant-dept'
                departments={departments}
                placeholder='Which department are these KPIs for?'
                value={departmentId}
                disabled={phase === 'review' || messages.length > 0}
                onChange={onDepartmentChange}
            />
        </div>
    ) : null

    /* --- Start: upload or chat --- */
    if (phase === 'start') {
        return (
            <div className='kb-assistant'>
                {modalHolder}
                {departmentPicker}
                {!canChooseDepartment && !departmentId && (
                    <Alert type='warning' showIcon message='Your account isn’t linked to a department, so the assistant can’t draft KPIs for you.' />
                )}

                {mode === 'upload' ? (
                    <Upload.Dragger
                        accept='.pdf,.docx,.png,.jpg,.jpeg,.txt'
                        multiple={false}
                        showUploadList={false}
                        disabled={!departmentId || extracting}
                        beforeUpload={file => {
                            void extract(file)
                            return false
                        }}
                        className='kb-dropzone'
                    >
                        {extracting ? (
                            <div className='kb-dropzone-busy'><Spin /> <span>Reading the letter…</span></div>
                        ) : (
                            <>
                                <p className='ant-upload-drag-icon'><InboxOutlined /></p>
                                <p className='ant-upload-text'>Drop the KPI letter here, or click to choose it</p>
                                <p className='ant-upload-hint'>PDF, Word (.docx), image or text. Each KPI is matched to live data where possible.</p>
                            </>
                        )}
                    </Upload.Dragger>
                ) : (
                    <>
                        <div className='kb-chat' role='log' aria-live='polite'>
                            {!departmentId ? (
                                <span className='kb-muted'>Choose a department to start the conversation.</span>
                            ) : (
                                <>
                                    {conversation.map((m, i) => (
                                        <div key={i} className={`kb-bubble is-${m.role}`}>{m.content}</div>
                                    ))}
                                    {sending && <div className='kb-bubble is-assistant'><Spin size='small' /></div>}
                                    <div ref={chatEnd} />
                                </>
                            )}
                        </div>
                        <div className='kb-chat-input'>
                            <Input
                                placeholder='Type your answer…'
                                value={input}
                                disabled={sending || !departmentId}
                                onChange={e => setInput(e.target.value)}
                                onPressEnter={send}
                                aria-label='Message the assistant'
                            />
                            <Button type='primary' icon={<SendOutlined />} loading={sending} disabled={!departmentId || !input.trim()} onClick={send}>
                                Send
                            </Button>
                        </div>
                    </>
                )}

                <div className='kb-actions'>
                    <Button icon={<LeftOutlined />} onClick={back}>Back</Button>
                </div>
            </div>
        )
    }

    /* --- Review --- */
    return (
        <div className='kb-assistant'>
            {modalHolder}
            {warnings.length > 0 && (
                <Alert
                    type='warning'
                    showIcon
                    message='Some parts of the letter needed attention'
                    description={<ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                />
            )}

            <div className='kb-review-bar'>
                <div className='kb-field'>
                    <label className='kb-label' htmlFor='kb-fy'>Financial year</label>
                    <Input id='kb-fy' value={fyLabel} onChange={e => setFyLabel(e.target.value)} placeholder='e.g. 2026-27' />
                </div>
                <div className='kb-field'>
                    <label className='kb-label' htmlFor='kb-fy-start'>Q1 starts</label>
                    <DatePicker
                        id='kb-fy-start'
                        picker='month'
                        style={{ width: '100%' }}
                        value={fyStart}
                        allowClear={false}
                        // Q1 must open a calendar quarter so each quarter is exactly one period.
                        disabledDate={d => !!d && d.month() % 3 !== 0}
                        onChange={v => v && setFyStart(v.startOf('month'))}
                    />
                </div>
                <div className='kb-field'>
                    <span className='kb-label'>Applies to</span>
                    <Segmented
                        block
                        value={scope}
                        onChange={v => setScope(v as 'program' | 'all')}
                        options={[
                            { value: 'program', label: activeProgramName || 'This programme', disabled: !programAvailable },
                            { value: 'all', label: 'All programmes' }
                        ]}
                    />
                </div>
            </div>

            <div className='kb-review-counts'>
                <Tag bordered={false} color='processing'>{department?.name || 'No department'}</Tag>
                <span>{included.length} of {rows.length} included · {liveCount} tracked live · {included.length - liveCount} recorded manually</span>
            </div>

            <ul className='kb-review-list'>
                {rows.map(row => {
                    const sum = row.quarters.reduce((a, b) => a + b, 0)
                    const mismatch = row.annual > 0 && sum !== row.annual
                    return (
                        <li key={row.id} className={`kb-review-row${row.include ? '' : ' is-skipped'}`}>
                            <div className='kb-review-head'>
                                <Input
                                    value={row.kpiName}
                                    disabled={!row.include}
                                    onChange={e => update(row.id, { kpiName: e.target.value })}
                                    aria-label='KPI name'
                                />
                                <div className='kb-review-actions'>
                                    <Tooltip title='Open in the full builder to fine-tune it'>
                                        <Button
                                            size='small'
                                            icon={<EditOutlined />}
                                            disabled={!row.include}
                                            onClick={() => onEditInBuilder(row, fyStart, created => {
                                                if (created) setRows(current => current.filter(r => r.id !== row.id))
                                            })}
                                        >
                                            Builder
                                        </Button>
                                    </Tooltip>
                                    <Button
                                        size='small'
                                        type='text'
                                        danger={row.include}
                                        icon={row.include ? <DeleteOutlined /> : <UndoOutlined />}
                                        onClick={() => update(row.id, { include: !row.include })}
                                    >
                                        {row.include ? 'Skip' : 'Restore'}
                                    </Button>
                                </div>
                            </div>

                            <div className='kb-review-meta'>
                                {row.trackingMode === 'computed' ? (
                                    <Tooltip title={row.aiMapping?.rationale}>
                                        <Tag bordered={false} color={row.aiMapping?.confidence === 'high' ? 'success' : 'warning'} icon={<CheckCircleOutlined />}>
                                            Tracked live
                                            {row.field ? ` · ${row.field}` : row.filters[0] ? ` · ${row.filters[0].value}` : ''}
                                        </Tag>
                                    </Tooltip>
                                ) : (
                                    <Tag bordered={false}>Recorded manually</Tag>
                                )}
                                {row.aiMapping?.sourceType && (
                                    <Segmented
                                        size='small'
                                        value={row.trackingMode}
                                        disabled={!row.include}
                                        onChange={v => update(row.id, { trackingMode: v as ReviewRow['trackingMode'] })}
                                        options={[{ value: 'computed', label: 'Live' }, { value: 'manual', label: 'Manual' }]}
                                    />
                                )}
                                {row.trackingMode === 'manual' ? (
                                    <Select<Unit>
                                        size='small'
                                        value={row.unit}
                                        disabled={!row.include}
                                        style={{ width: 120 }}
                                        onChange={unit => update(row.id, { unit })}
                                        options={[{ value: 'count', label: 'Count' }, { value: 'ZAR', label: 'Rand' }, { value: 'percent', label: 'Percent' }]}
                                        aria-label='Unit'
                                    />
                                ) : (
                                    <span className='kb-muted'>Unit: {row.unit === 'ZAR' ? 'Rand' : row.unit === 'percent' ? 'Percent' : 'Count'}</span>
                                )}
                            </div>

                            <div className='kb-review-targets'>
                                <div className='kb-field'>
                                    <span className='kb-label'>Annual</span>
                                    <InputNumber
                                        min={0}
                                        style={{ width: '100%' }}
                                        value={row.annual}
                                        disabled={!row.include}
                                        onChange={v => update(row.id, { annual: Number(v || 0), splitFromAnnual: false })}
                                    />
                                </div>
                                {row.quarters.map((q, i) => (
                                    <div className='kb-field' key={i}>
                                        <span className='kb-label'>Q{i + 1} · {quarterLabel(fyStart, i)}</span>
                                        <InputNumber
                                            min={0}
                                            style={{ width: '100%' }}
                                            value={q}
                                            disabled={!row.include}
                                            onChange={v => {
                                                const quarters = [...row.quarters] as ReviewRow['quarters']
                                                quarters[i] = Number(v || 0)
                                                update(row.id, { quarters, splitFromAnnual: false })
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>

                            {row.include && row.splitFromAnnual && (
                                <div className='kb-review-note'>
                                    The letter only gave an annual target, so it was split evenly across the quarters.
                                </div>
                            )}
                            {row.include && mismatch && (
                                <div className='kb-review-note is-warning'>
                                    <WarningOutlined /> Quarters add up to {sum}, not the annual {row.annual}.
                                    <Button size='small' type='link' onClick={() => update(row.id, { quarters: splitAnnual(row.annual) })}>Split annual evenly</Button>
                                    <Button size='small' type='link' onClick={() => update(row.id, { annual: sum })}>Use quarter total</Button>
                                </div>
                            )}
                        </li>
                    )
                })}
                {!rows.length && <li className='kb-muted'>Nothing was drafted. Go back and try again.</li>}
            </ul>

            <div className='kb-actions'>
                <Button icon={<LeftOutlined />} onClick={back}>Back</Button>
                <Tooltip title={problems[0]}>
                    <Button type='primary' icon={<SaveOutlined />} loading={saving} disabled={problems.length > 0} onClick={create}>
                        Create {included.length || ''} KPI{included.length === 1 ? '' : 's'}
                    </Button>
                </Tooltip>
            </div>
        </div>
    )
}
