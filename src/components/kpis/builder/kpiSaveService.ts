import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    getDocs,
    query,
    updateDoc,
    where,
    writeBatch
} from 'firebase/firestore'
import type { Dayjs } from 'dayjs'
import { db } from '@/firebase'
import {
    SOURCE_CONFIGS,
    buildPeriodKey,
    parsePeriodKeyToDayjs,
    type KPI,
    type SourceType,
    type TargetPeriodType,
    type Unit
} from './kpiModel'
import { draftToPayload, type DraftContext, type KpiDraft } from './kpiDraft'

/**
 * Writes for the KPI create/edit modal: one KPI from the builder (with its
 * first target and audit entry), and a batch of KPIs from the assistant.
 */

type AuditParams = {
    action: 'created' | 'updated' | 'revised' | 'deleted'
    kpi: Pick<KPI, 'id' | 'kpiLabel' | 'department' | 'leadDepartmentId'>
    targetDocId?: string
    periodType: TargetPeriodType
    periodKey: string
    oldTarget: number | null
    newTarget: number | null
    changeReason?: string
    revisionId?: string
}

const auditRecord = (p: AuditParams, uid: string) => ({
    kpiId: p.kpi.id,
    targetDocId: p.targetDocId || null,
    kpiLabel: p.kpi.kpiLabel,
    departmentId: p.kpi.leadDepartmentId || null,
    department: p.kpi.department,
    periodType: p.periodType,
    periodKey: p.periodKey,
    action: p.action,
    oldTarget: p.oldTarget,
    newTarget: p.newTarget,
    changeReason: p.changeReason || '',
    changedAt: new Date(),
    changedBy: uid,
    revisionId: p.revisionId || null,
    approvedBy: p.action === 'revised' ? uid : null,
    approvedAt: p.action === 'revised' ? new Date() : null
})

export const writeTargetAuditLog = (p: AuditParams, uid: string) =>
    addDoc(collection(db, 'kpiTargetAuditLogs'), auditRecord(p, uid))

/** Keeps interventions' kpiIds in step with the KPIs that measure them. */
export const syncKpiLinksOnInterventions = async (kpiId: string, next: string[], prev: string[]) => {
    const nextSet = new Set(next || [])
    const prevSet = new Set(prev || [])
    await Promise.all([
        ...[...nextSet].filter(id => !prevSet.has(id)).map(id =>
            updateDoc(doc(db, 'interventions', id), { kpiIds: arrayUnion(kpiId), updatedAt: new Date() })),
        ...[...prevSet].filter(id => !nextSet.has(id)).map(id =>
            updateDoc(doc(db, 'interventions', id), { kpiIds: arrayRemove(kpiId), updatedAt: new Date() }))
    ])
}

/** Creates (or, for an edit, updates) a KPI from the builder. Returns the KPI id. */
export const saveKpiFromDraft = async (params: {
    draft: KpiDraft
    ctx: DraftContext
    editing?: KPI | null
    uid: string
}): Promise<string> => {
    const { draft, ctx, editing, uid } = params
    const payload = draftToPayload(draft, ctx, editing)

    if (editing) {
        await updateDoc(doc(db, 'kpiDefinitions', editing.id), payload)
        await syncKpiLinksOnInterventions(editing.id, payload.interventionIds || [], editing.interventionIds || [])
        return editing.id
    }

    const ref = await addDoc(collection(db, 'kpiDefinitions'), payload)
    if (payload.interventionIds?.length) await syncKpiLinksOnInterventions(ref.id, payload.interventionIds, [])

    // The first target (numbers only — deliverables are checked off, not targeted).
    if (draft.kpiKind === 'numeric' && draft.periodKey && draft.target) {
        const periodKey = buildPeriodKey(draft.periodType, draft.periodKey)
        const existing = await getDocs(query(collection(db, 'kpiTargets'), where('kpiId', '==', ref.id), where('periodKey', '==', periodKey)))
        if (existing.empty) {
            const targetRef = await addDoc(collection(db, 'kpiTargets'), {
                kpiId: ref.id,
                kpiLabel: payload.kpiLabel,
                departmentId: payload.leadDepartmentId || null,
                department: payload.department,
                periodType: draft.periodType,
                periodKey,
                periodStartAt: parsePeriodKeyToDayjs(draft.periodType, periodKey).toDate(),
                target: draft.target,
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: uid,
                updatedBy: uid
            })
            await writeTargetAuditLog({
                action: 'created',
                kpi: { id: ref.id, kpiLabel: payload.kpiLabel, department: payload.department, leadDepartmentId: payload.leadDepartmentId },
                targetDocId: targetRef.id,
                periodType: draft.periodType,
                periodKey,
                oldTarget: null,
                newTarget: draft.target,
                changeReason: 'Initial target set when the KPI was created'
            }, uid)
        }
    }

    return ref.id
}

/* --- Assistant batch --------------------------------------------------------------- */

export interface CandidateKpi {
    kpiName: string
    /** Quarter targets, already resolved from the annual figure where the letter only gave that. */
    quarters: [number, number, number, number]
    unit: Unit
    trackingMode: 'computed' | 'manual'
    sourceType?: SourceType
    field?: string | null
    calculationType?: 'count' | 'sum' | 'average'
    countMode?: 'records'
    filters: { field: string; op: '==' | '!=' | 'in'; value: any }[]
}

/**
 * Creates the assistant's KPIs and their quarterly targets in one atomic
 * write, so a failure part-way leaves nothing behind and retrying can't
 * duplicate. Very large drafts (over ~50 KPIs) fall back to several batches.
 */
export const createKpisFromCandidates = async (params: {
    candidates: CandidateKpi[]
    departmentId: string
    departmentName: string
    fyLabel: string
    /** First month of the financial year's Q1 — always the first month of a calendar quarter. */
    fyStart: Dayjs
    scope: 'program' | 'all'
    activeProgramId?: string | null
    uid: string
}) => {
    const { candidates, departmentId, departmentName, fyLabel, fyStart, scope, activeProgramId, uid } = params
    const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = []

    for (const c of candidates) {
        const computed = c.trackingMode === 'computed' && !!c.sourceType
        const defRef = doc(collection(db, 'kpiDefinitions'))
        const definition = {
            programId: scope === 'all' ? null : activeProgramId || null,
            appliesToAllPrograms: scope === 'all',
            belongsToMe: true,
            sharedKpiMode: null,
            leadDepartmentId: departmentId,
            leadDepartmentName: departmentName,
            department: departmentName,
            kpiLabel: c.kpiName.trim(),
            unit: c.unit,
            kpiKind: 'numeric',
            description: '',
            // Manual KPIs carry no live source, so nothing ever tries to compute them.
            sourceType: computed ? c.sourceType : null,
            sourceCollection: computed ? SOURCE_CONFIGS[c.sourceType as SourceType].collection : null,
            countMode: computed && c.calculationType === 'count' ? c.countMode || 'records' : null,
            dateField: computed ? 'createdAt' : null,
            displayKpiType: computed
                ? c.calculationType === 'sum' ? (c.unit === 'ZAR' ? 'total_amount' : 'total_number') : c.calculationType === 'average' ? 'average' : 'total_number'
                : null,
            calculationType: computed ? c.calculationType : 'count',
            filters: computed ? c.filters : [],
            field: computed ? c.field || null : null,
            numerator: null,
            denominator: null,
            contributorDepartmentIds: [departmentId],
            contributorDepartmentNames: [departmentName],
            sharedContributors: [],
            interventionIds: [],
            trackingMode: computed ? 'computed' : 'manual',
            reminderCadence: computed ? null : 'quarterly',
            createdAt: new Date(),
            updatedAt: new Date(),
            active: true
        }
        ops.push(batch => batch.set(defRef, definition))

        c.quarters.forEach((value, offset) => {
            if (!value) return
            const periodKey = buildPeriodKey('quarterly', fyStart.add(offset * 3, 'month'))
            const targetRef = doc(collection(db, 'kpiTargets'))
            const auditRef = doc(collection(db, 'kpiTargetAuditLogs'))
            ops.push(batch => batch.set(targetRef, {
                kpiId: defRef.id,
                kpiLabel: definition.kpiLabel,
                departmentId,
                department: departmentName,
                periodType: 'quarterly',
                periodKey,
                periodStartAt: parsePeriodKeyToDayjs('quarterly', periodKey).toDate(),
                target: value,
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: uid,
                updatedBy: uid
            }))
            ops.push(batch => batch.set(auditRef, auditRecord({
                action: 'created',
                kpi: { id: defRef.id, kpiLabel: definition.kpiLabel, department: departmentName, leadDepartmentId: departmentId },
                targetDocId: targetRef.id,
                periodType: 'quarterly',
                periodKey,
                oldTarget: null,
                newTarget: value,
                changeReason: `Imported from KPI letter${fyLabel ? ` (${fyLabel})` : ''}`
            }, uid)))
        })
    }

    // Firestore batches cap at 500 writes; 450 leaves headroom.
    for (let i = 0; i < ops.length; i += 450) {
        const batch = writeBatch(db)
        ops.slice(i, i + 450).forEach(op => op(batch))
        await batch.commit()
    }
}
