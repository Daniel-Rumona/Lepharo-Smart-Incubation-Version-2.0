import React, { useEffect, useMemo, useState } from 'react'
import { Button, Modal, message } from 'antd'
import {
    CheckOutlined,
    InboxOutlined,
    LeftOutlined,
    MessageOutlined,
    RightOutlined,
    SaveOutlined,
    ToolOutlined
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { nextTargetPeriodStart, type KPI } from './kpiModel'
import {
    emptyDraft,
    draftFromKpi,
    interventionLabel,
    periodStarted,
    validateStep,
    type Calc,
    type Department,
    type DraftContext,
    type KpiDraft
} from './kpiDraft'
import { saveKpiFromDraft } from './kpiSaveService'
import { BUILDER_STEPS, KpiBuilder } from './KpiBuilder'
import { KpiAssistant, type AssistantMode, type ReviewRow } from './KpiAssistant'
import './kpi-builder.css'

type View = 'entry' | 'builder' | 'assistant'

type Props = {
    open: boolean
    /** Set to edit an existing KPI (opens straight in the builder). */
    editingKpi?: KPI | null
    onClose: () => void
    /** After anything is created or updated: refresh the register. */
    onSaved: () => void
    /** Edit mode: open the audited targets workspace for this KPI. */
    onManageTargets?: (kpi: KPI) => void
    departments: Department[]
    interventions: any[]
    uid: string
    userDepartmentId?: string | null
    userDepartmentName?: string | null
    canControlContributors: boolean
    /** Monitoring and main departments set KPIs for any department in the assistant. */
    canChooseDepartment: boolean
    activeProgramId?: string | null
    isAllPrograms: boolean
}

const ENTRY_OPTIONS: { key: 'upload' | 'chat' | 'build'; title: string; detail: string; icon: React.ReactNode; tone: string }[] = [
    { key: 'upload', title: 'Upload a letter', detail: 'Draft every KPI from a PDF, Word document or photo of the KPI letter.', icon: <InboxOutlined />, tone: 'accent' },
    { key: 'chat', title: 'Describe them', detail: 'No letter handy? Answer a few questions and the assistant drafts them.', icon: <MessageOutlined />, tone: 'info' },
    { key: 'build', title: 'Build one yourself', detail: 'Set up a single KPI step by step: basics, measurement, target.', icon: <ToolOutlined />, tone: 'neutral' }
]

/** Turn an assistant row into a builder draft, so it can be fine-tuned there. */
const draftFromRow = (row: ReviewRow, fyStart: Dayjs, departmentId: string, ctx: DraftContext): KpiDraft => {
    const base = emptyDraft(ctx)
    const live = row.trackingMode === 'computed' && !!row.sourceType
    const calc: Calc | null = !live ? null : row.calculationType === 'sum' ? 'total' : row.calculationType === 'average' ? 'average' : 'count'
    // Intervention matches arrive as a title filter; the builder picks interventions directly.
    const titleMatch = row.filters.find(f => f.field === 'interventionTitle')?.value
    const interventionIds = live && row.sourceType === 'interventions' && titleMatch
        ? ctx.interventions.filter(iv => interventionLabel(iv).toLowerCase() === String(titleMatch).toLowerCase()).map(iv => iv.id)
        : []
    // The first quarter that hasn't started yet carries the first target.
    const firstOpen = [0, 1, 2, 3].find(i => !periodStarted('quarterly', fyStart.add(i * 3, 'month')))
    const periodKey = firstOpen != null ? fyStart.add(firstOpen * 3, 'month').startOf('quarter') : nextTargetPeriodStart('quarterly')
    return {
        ...base,
        kpiLabel: row.kpiName,
        departmentId: departmentId || base.departmentId,
        tracking: live ? 'live' : 'manual',
        manualUnit: row.unit,
        sourceType: live ? row.sourceType || null : null,
        calc,
        field: row.field || null,
        filters: row.filters.filter(f => f.field !== 'interventionTitle'),
        interventionIds,
        countMode: row.countMode || 'records',
        periodType: 'quarterly',
        periodKey,
        target: firstOpen != null ? row.quarters[firstOpen] || null : null
    }
}

/**
 * Add or edit KPIs in one window: upload a letter or describe them to the
 * assistant (which drafts several at once for review), or build one yourself
 * in three steps with a live summary. Editing an existing KPI opens the same
 * builder.
 */
export const KpiCreateModal: React.FC<Props> = props => {
    const {
        open, editingKpi, onClose, onSaved, onManageTargets, departments, interventions, uid,
        userDepartmentId, userDepartmentName, canControlContributors, canChooseDepartment, activeProgramId, isAllPrograms
    } = props

    // Profiles don't always store the department's name, only its id; resolve it from the list.
    const resolvedDepartmentName = userDepartmentName
        || departments.find(d => d.id === userDepartmentId)?.name
        || null

    // The active programme is only known by id; load its name for "Applies to".
    const [activeProgramName, setActiveProgramName] = useState<string | null>(null)
    useEffect(() => {
        let cancelled = false
        setActiveProgramName(null)
        if (!open || !activeProgramId || isAllPrograms) return
        getDoc(doc(db, 'programs', activeProgramId))
            .then(snap => {
                const data = snap.data() as any
                if (!cancelled) setActiveProgramName(String(data?.name || data?.programName || data?.title || '').trim() || null)
            })
            .catch(() => undefined)
        return () => {
            cancelled = true
        }
    }, [open, activeProgramId, isAllPrograms])

    const ctx = useMemo<DraftContext>(() => ({
        departments,
        interventions,
        userDepartmentId,
        userDepartmentName: resolvedDepartmentName,
        canControlContributors,
        activeProgramId,
        activeProgramName,
        isAllPrograms
    }), [departments, interventions, userDepartmentId, resolvedDepartmentName, canControlContributors, activeProgramId, activeProgramName, isAllPrograms])

    const [view, setView] = useState<View>('entry')
    const [assistantMode, setAssistantMode] = useState<AssistantMode>('upload')
    const [assistantActive, setAssistantActive] = useState(false)
    const [assistantDepartmentId, setAssistantDepartmentId] = useState<string | undefined>()
    const [origin, setOrigin] = useState<'entry' | 'assistant' | 'edit'>('entry')
    const [rowDone, setRowDone] = useState<((created: boolean) => void) | null>(null)
    const [draft, setDraft] = useState<KpiDraft>(() => emptyDraft(ctx))
    const [step, setStep] = useState(0)
    const [showErrors, setShowErrors] = useState(false)
    const [saving, setSaving] = useState(false)
    // Edit mode: the KPI as it opened, so Save only appears once something changed.
    const [openedAs, setOpenedAs] = useState('')

    // Fresh state each time the window opens.
    useEffect(() => {
        if (!open) return
        setStep(0)
        setShowErrors(false)
        setRowDone(null)
        setAssistantActive(false)
        setAssistantDepartmentId(userDepartmentId || undefined)
        if (editingKpi) {
            const opened = draftFromKpi(editingKpi, ctx)
            setDraft(opened)
            setOpenedAs(JSON.stringify(opened))
            setOrigin('edit')
            setView('builder')
        } else {
            setDraft(emptyDraft(ctx))
            setOrigin('entry')
            setView('entry')
        }
        // ctx is read once on open; later data loads don't reset work in progress.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editingKpi])

    const isNew = origin !== 'edit'
    const hasChanges = isNew || JSON.stringify(draft) !== openedAs
    const errors = validateStep(step, draft, ctx, isNew)
    const patch = (p: Partial<KpiDraft>) => setDraft(current => ({ ...current, ...p }))

    const goTo = (target: number) => {
        setShowErrors(false)
        setStep(target)
    }

    const next = () => {
        if (errors.length) {
            setShowErrors(true)
            return
        }
        goTo(step + 1)
    }

    const back = () => {
        if (step > 0) return goTo(step - 1)
        if (origin === 'assistant') {
            rowDone?.(false)
            setRowDone(null)
            setView('assistant')
            return
        }
        if (origin === 'edit') return onClose()
        setView('entry')
    }

    const save = async () => {
        // Check every step; land on the first one that still needs something.
        const lastStep = isNew ? 2 : 1
        for (let s = 0; s <= lastStep; s++) {
            if (validateStep(s, draft, ctx, isNew).length) {
                setStep(s)
                setShowErrors(true)
                return
            }
        }
        setSaving(true)
        try {
            await saveKpiFromDraft({ draft, ctx, editing: editingKpi, uid })
            message.success(isNew ? `“${draft.kpiLabel.trim()}” created` : 'KPI updated')
            onSaved()
            if (origin === 'assistant') {
                rowDone?.(true)
                setRowDone(null)
                setView('assistant')
            } else {
                onClose()
            }
        } catch (error: any) {
            message.error(error?.message || 'Could not save the KPI.')
        } finally {
            setSaving(false)
        }
    }

    const choose = (key: 'upload' | 'chat' | 'build') => {
        if (key === 'build') {
            setDraft(emptyDraft(ctx))
            setOrigin('entry')
            goTo(0)
            setView('builder')
            return
        }
        setAssistantMode(key)
        setAssistantActive(true)
        setView('assistant')
    }

    const title = view === 'entry'
        ? 'Add KPIs'
        : view === 'assistant'
            ? assistantMode === 'upload' ? 'Add KPIs from a letter' : 'Describe your KPIs'
            : origin === 'edit' ? 'Edit KPI' : 'New KPI'
    // No stepper: the step's name sits quietly beside the title instead.
    const titleNode = view === 'builder'
        ? <span className='kb-title'>{title}<span className='kb-title-step'>{BUILDER_STEPS[step]} · {step + 1} of {BUILDER_STEPS.length}</span></span>
        : title

    return (
        <Modal
            title={titleNode}
            open={open}
            onCancel={onClose}
            footer={null}
            maskClosable={false}
            width={view === 'builder' ? 1000 : 820}
            destroyOnClose
            className='kb-modal'
        >
            {view === 'entry' && (
                <div className='kb-entry'>
                    <p className='kb-entry-lead'>How would you like to add them?</p>
                    <div className='kb-entry-options'>
                        {ENTRY_OPTIONS.map(option => (
                            <button key={option.key} type='button' className='kb-entry-option' onClick={() => choose(option.key)}>
                                <span className={`kb-entry-icon qtx-tone-${option.tone}`} aria-hidden='true'>{option.icon}</span>
                                <span className='kb-entry-text'>
                                    <span className='kb-entry-title'>{option.title}</span>
                                    <span className='kb-entry-detail'>{option.detail}</span>
                                </span>
                                <RightOutlined className='kb-entry-chevron' aria-hidden='true' />
                            </button>
                        ))}
                    </div>
                    <p className='kb-muted kb-entry-foot'>
                        Every KPI is checked against live data: one that matches is tracked automatically; one that doesn’t is recorded manually with reminders.
                    </p>
                </div>
            )}

            {/* Kept mounted while a drafted row is open in the builder, so the review survives the round trip. */}
            {assistantActive && (
                <div style={{ display: view === 'assistant' ? 'block' : 'none' }}>
                    <KpiAssistant
                        mode={assistantMode}
                        departments={departments}
                        departmentId={assistantDepartmentId}
                        onDepartmentChange={setAssistantDepartmentId}
                        canChooseDepartment={canChooseDepartment}
                        activeProgramId={activeProgramId}
                        activeProgramName={activeProgramName}
                        isAllPrograms={isAllPrograms}
                        uid={uid}
                        onExit={() => {
                            setAssistantActive(false)
                            setView('entry')
                        }}
                        onCreated={count => {
                            message.success(`${count} KPI${count === 1 ? '' : 's'} created`)
                            onSaved()
                            onClose()
                        }}
                        onEditInBuilder={(row, fyStart, done) => {
                            setDraft(draftFromRow(row, fyStart, assistantDepartmentId || userDepartmentId || '', ctx))
                            setOrigin('assistant')
                            setRowDone(() => done)
                            setStep(0)
                            setShowErrors(false)
                            setView('builder')
                        }}
                    />
                </div>
            )}

            {view === 'builder' && (
                <>
                    <KpiBuilder
                        draft={draft}
                        onChange={patch}
                        step={step}
                        ctx={ctx}
                        isNew={isNew}
                        editing={editingKpi}
                        errors={showErrors ? errors : []}
                        onManageTargets={editingKpi && onManageTargets ? () => onManageTargets(editingKpi) : undefined}
                    />
                    <div className='kb-actions'>
                        <Button icon={<LeftOutlined />} onClick={back} disabled={saving}>
                            {step === 0 && origin === 'edit' ? 'Cancel' : 'Back'}
                        </Button>
                        {origin === 'edit' ? (
                            <>
                                {step < 2 && <Button icon={<RightOutlined />} onClick={next}>Next</Button>}
                                {hasChanges && <Button type='primary' icon={<SaveOutlined />} loading={saving} onClick={save}>Save changes</Button>}
                            </>
                        ) : step < 2 ? (
                            <Button type='primary' icon={<RightOutlined />} iconPosition='end' onClick={next}>Next</Button>
                        ) : (
                            <Button type='primary' icon={<CheckOutlined />} loading={saving} onClick={save}>Create KPI</Button>
                        )}
                    </div>
                </>
            )}
        </Modal>
    )
}

