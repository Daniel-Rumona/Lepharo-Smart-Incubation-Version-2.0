// Read-only model behind the Interventions Control Tower: turns raw
// assignedInterventions, movDocuments and consolidatedMOVs into
//   - a stuck queue (what is waiting on someone, and for how long), and
//   - coverage rows (delivery and evidence progress per department/intervention).
// No Firestore access here, so it can be tested and reused by other views.

import { resolveAssignmentLifecycle, assignmentAssignedDate } from './assignmentLifecycleService'
import { summariseDelivery, type DeliverySummary } from './interventionDeliverySummary'
import { resolveMovPosition, daysInStage, MOV_STAGE_META, type MovPosition, type MovOwner } from './movPipeline'

const DAY_MS = 86_400_000

const clean = (value: unknown) => String(value ?? '').trim()

const millis = (value: any): number => {
    if (!value) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    return 0
}

export type StuckKind = 'delivery' | 'evidence'

export type ReminderTarget = {
    collection: 'movDocuments' | 'consolidatedMOVs' | 'assignedInterventions'
    id: string
    /** Assignments only: which stall this is, so the server picks the right people. */
    state?: 'awaiting-acceptance' | 'awaiting-confirmation' | 'in-delivery' | 'declined' | 'rejected' | 'needs-reassignment'
    /** Who it will reach, for the button label: "SME", "Facilitator + HOD", ... */
    audience: string
}

export type StuckItem = {
    id: string
    kind: StuckKind
    /** Short reason, e.g. "Awaiting SME confirmation". */
    reason: string
    /** Who has to act next. */
    owner: string
    days: number
    /** days / threshold - lets the table sort worst-first across different stages. */
    severity: number
    departmentId: string
    departmentName: string
    interventionTitle: string
    participantName: string
    assigneeName: string
    branchId: string
    /** The source record, for drill-down. */
    assignmentId?: string
    movId?: string
    /** Raw records behind the row, so a detail view can show more than the table does. */
    raw: Record<string, any>
    pack?: Record<string, any> | null
    /** MOV chain position (evidence rows only). */
    position?: MovPosition
    /** When the item entered its current state, in ms (0 = unknown). */
    enteredAt: number
    /**
     * The document a reminder is recorded against, and who it goes to. `state`
     * tells the server which kind of delivery stall an assignment is in.
     */
    reminderTarget?: ReminderTarget
}

export type CoverageRow = {
    key: string
    departmentId: string
    departmentName: string
    interventionId?: string
    interventionTitle?: string
    summary: DeliverySummary
    stuck: number
    /** Evidence chain counts, per MOV. */
    mov: { total: number; awaitingHod: number; queried: number; inPack: number; awaitingMe: number; validated: number }
}

type StuckRule = { reason: string; owner: string; threshold: number }

// How long each state may reasonably sit before it counts as stuck. 0 = always
// needs attention (someone has to re-plan it).
const ASSIGNMENT_RULES: Record<string, StuckRule> = {
    'needs-reassignment': { reason: 'Needs reassignment', owner: 'HOD', threshold: 0 },
    'participant-declined': { reason: 'SME declined the appointment', owner: 'Facilitator', threshold: 0 },
    'participant-rejected': { reason: 'SME rejected completion', owner: 'Facilitator', threshold: 0 },
    'awaiting-participant-acceptance': { reason: 'Awaiting SME response to appointment', owner: 'SME', threshold: 3 },
    'awaiting-participant-confirmation': { reason: 'Awaiting SME confirmation', owner: 'SME', threshold: 3 },
    'in-delivery': { reason: 'In delivery', owner: 'Facilitator', threshold: 30 }
}

const MOV_THRESHOLD: Partial<Record<MovPosition['stage'], number>> = {
    awaiting_smme: 3,
    awaiting_hod: 3,
    queried: 0,
    rejected: 0,
    hod_approved: 7,
    in_pack: 3,
    cc_confirmed: 3,
    // 'unrecognised' is deliberately absent: it is reported as a data problem, not chased.
}

const ownerLabel = (owner: MovOwner) => owner ?? '-'

/** Assignment fields vary by writer; take the first that is present. */
const participantNameOf = (row: any) =>
    clean(row.beneficiaryName || row.participantName || row.smmeCompanyName || row.companyName) || 'Unknown participant'

const ASSIGNMENT_REMINDER: Record<string, Pick<ReminderTarget, 'state' | 'audience'>> = {
    'needs-reassignment': { state: 'needs-reassignment', audience: 'HOD' },
    'participant-declined': { state: 'declined', audience: 'Facilitator + HOD' },
    'participant-rejected': { state: 'rejected', audience: 'Facilitator + HOD' },
    'awaiting-participant-acceptance': { state: 'awaiting-acceptance', audience: 'SME' },
    'awaiting-participant-confirmation': { state: 'awaiting-confirmation', audience: 'SME' },
    'in-delivery': { state: 'in-delivery', audience: 'Facilitator' }
}

const assignmentEnteredAt = (row: any, lifecycleKey: string): number => {
    if (lifecycleKey === 'awaiting-participant-confirmation') {
        return millis(row.assigneeCompletedAt) || millis(row.updatedAt) || millis(assignmentAssignedDate(row))
    }
    return millis(row.updatedAt) || millis(assignmentAssignedDate(row))
}

/** MOV id -> the monthly pack it was rolled into, via the pack's interventions[]. */
export function indexPacksByMovId(packs: Array<Record<string, any>>): Map<string, Record<string, any>> {
    const index = new Map<string, Record<string, any>>()
    for (const pack of packs) {
        const rows: any[] = Array.isArray(pack.interventions) ? pack.interventions : []
        for (const row of rows) {
            const id = clean(row?.id)
            if (!id) continue
            const existing = index.get(id)
            // A MOV re-submitted in a later pack: the latest pack is where it now lives.
            if (!existing || millis(pack.createdAt) >= millis(existing.createdAt)) index.set(id, pack)
        }
    }
    return index
}

/**
 * Where a reminder for this MOV is recorded and who it reaches. SME, HOD and
 * facilitator stages live on the MOV itself; CC and M&E stages are chased on
 * the monthly pack. A draft has no one to chase yet.
 */
function reminderTargetFor(position: MovPosition, mov: Record<string, any>, pack?: Record<string, any> | null): ReminderTarget | undefined {
    const movId = clean(mov.id)
    switch (position.stage) {
        case 'awaiting_smme':
            return { collection: 'movDocuments', id: movId, audience: 'SME' }
        case 'awaiting_hod':
        case 'hod_approved':
            return { collection: 'movDocuments', id: movId, audience: 'HOD' }
        case 'queried':
        case 'rejected':
            return { collection: 'movDocuments', id: movId, audience: 'Facilitator + HOD' }
        case 'in_pack':
            return pack?.id ? { collection: 'consolidatedMOVs', id: clean(pack.id), audience: 'CC' } : undefined
        case 'cc_confirmed':
            return pack?.id ? { collection: 'consolidatedMOVs', id: clean(pack.id), audience: 'M&E' } : undefined
        default:
            return undefined
    }
}

export type TowerInput = {
    assignments: Array<Record<string, any>>
    movs: Array<Record<string, any>>
    packs: Array<Record<string, any>>
    now?: number
    /** Resolves a department id to its current name; falls back to the record's display copy. */
    nameOf?: (departmentId: string) => string
}

export type TowerModel = {
    stuck: StuckItem[]
    coverage: CoverageRow[]
    totals: {
        assignments: number
        stuck: number
        stuckDelivery: number
        stuckEvidence: number
        unassigned: number
        /** MOVs whose status is missing or not recognised; left out of every count above. */
        unrecognisedMovs: number
    }
    /** Open MOVs per pipeline stage, for the evidence funnel. */
    pipeline: Array<{ stage: MovPosition['stage']; label: string; count: number }>
}

export function buildTowerModel({ assignments, movs, packs, now = Date.now(), nameOf }: TowerInput): TowerModel {
    const departmentNameFor = (record: Record<string, any>) => {
        const id = clean(record.departmentId)
        return (id && nameOf ? clean(nameOf(id)) : '') || clean(record.departmentName) || 'Unassigned department'
    }
    const packByMovId = indexPacksByMovId(packs)
    const stuck: StuckItem[] = []

    for (const row of assignments) {
        const lifecycle = resolveAssignmentLifecycle(row)
        const rule = ASSIGNMENT_RULES[lifecycle.key]
        if (!rule || row.supportClosedAt) continue
        const entered = assignmentEnteredAt(row, lifecycle.key)
        const days = entered ? Math.max(0, Math.floor((now - entered) / DAY_MS)) : 0
        if (days < rule.threshold) continue
        stuck.push({
            id: `a:${row.id}`,
            kind: 'delivery',
            reason: rule.reason,
            owner: rule.owner,
            days,
            severity: rule.threshold ? days / rule.threshold : 1 + days,
            departmentId: clean(row.departmentId),
            departmentName: departmentNameFor(row),
            interventionTitle: clean(row.interventionTitle) || 'Intervention',
            participantName: participantNameOf(row),
            assigneeName: clean(row.assigneeName),
            branchId: clean(row.branchId || row.assignedBranch),
            assignmentId: clean(row.id),
            raw: row,
            enteredAt: entered,
            reminderTarget: ASSIGNMENT_REMINDER[lifecycle.key] ? { collection: 'assignedInterventions', id: clean(row.id), ...ASSIGNMENT_REMINDER[lifecycle.key] } : undefined
        })
    }

    const positions = new Map<string, MovPosition>()
    const pipelineCounts = new Map<MovPosition['stage'], number>()
    for (const mov of movs) {
        const position = resolveMovPosition(mov, packByMovId.get(clean(mov.id)) ?? null)
        positions.set(clean(mov.id), position)
        if (position.isOpen) pipelineCounts.set(position.stage, (pipelineCounts.get(position.stage) ?? 0) + 1)

        if (!position.isOpen) continue
        const threshold = MOV_THRESHOLD[position.stage]
        if (threshold === undefined) continue
        const days = daysInStage(position, now)
        if (days < threshold) continue
        stuck.push({
            id: `m:${mov.id}`,
            kind: 'evidence',
            reason: `MOV: ${position.label}`,
            owner: ownerLabel(position.owner),
            days,
            severity: threshold ? days / threshold : 1 + days,
            departmentId: clean(mov.departmentId),
            departmentName: departmentNameFor(mov),
            interventionTitle: clean(mov.interventionTitle) || 'Intervention',
            participantName: participantNameOf(mov),
            assigneeName: clean(mov.facilitatorName),
            branchId: clean(mov.branchId || mov.assignedBranch),
            movId: clean(mov.id),
            assignmentId: clean(mov.assignedInterventionId) || undefined,
            raw: mov,
            pack: packByMovId.get(clean(mov.id)) ?? null,
            position,
            enteredAt: position.enteredAt,
            reminderTarget: reminderTargetFor(position, mov, packByMovId.get(clean(mov.id)))
        })
    }

    stuck.sort((a, b) => b.severity - a.severity || b.days - a.days)

    // Coverage: group by department and intervention.
    const groups = new Map<string, { dept: { id: string; name: string }; title: string; interventionId: string; assignments: any[]; movs: any[] }>()
    const groupFor = (departmentId: string, departmentName: string, interventionId: string, title: string) => {
        const key = `${departmentId || departmentName}|${interventionId || title}`
        let group = groups.get(key)
        if (!group) {
            group = { dept: { id: departmentId, name: departmentName }, title, interventionId, assignments: [], movs: [] }
            groups.set(key, group)
        }
        return group
    }
    for (const row of assignments) {
        groupFor(
            clean(row.departmentId),
            departmentNameFor(row),
            clean(row.interventionId),
            clean(row.interventionTitle) || 'Intervention'
        ).assignments.push(row)
    }
    for (const mov of movs) {
        groupFor(
            clean(mov.departmentId),
            departmentNameFor(mov),
            clean(mov.interventionId),
            clean(mov.interventionTitle) || 'Intervention'
        ).movs.push(mov)
    }

    const stuckByAssignment = new Set(stuck.filter(s => s.assignmentId).map(s => s.assignmentId))
    const byIntervention: CoverageRow[] = []
    for (const [key, group] of groups) {
        const counts = { total: group.movs.length, awaitingHod: 0, queried: 0, inPack: 0, awaitingMe: 0, validated: 0 }
        for (const mov of group.movs) {
            const stage = positions.get(clean(mov.id))?.stage
            if (stage === 'awaiting_hod') counts.awaitingHod += 1
            else if (stage === 'queried') counts.queried += 1
            else if (stage === 'in_pack' || stage === 'hod_approved') counts.inPack += 1
            else if (stage === 'cc_confirmed') counts.awaitingMe += 1
            else if (stage === 'me_validated' || stage === 'invoice_redeemable') counts.validated += 1
        }
        byIntervention.push({
            key,
            departmentId: group.dept.id,
            departmentName: group.dept.name,
            interventionId: group.interventionId,
            interventionTitle: group.title,
            summary: summariseDelivery(group.assignments, group.movs),
            stuck: group.assignments.filter(a => stuckByAssignment.has(clean(a.id))).length,
            mov: counts
        })
    }
    byIntervention.sort((a, b) =>
        a.departmentName.localeCompare(b.departmentName) || (a.interventionTitle ?? '').localeCompare(b.interventionTitle ?? '')
    )

    const pipeline = (['awaiting_smme', 'awaiting_hod', 'queried', 'hod_approved', 'in_pack', 'cc_confirmed'] as const).map(stage => ({
        stage,
        label: MOV_STAGE_META[stage].label,
        count: pipelineCounts.get(stage) ?? 0
    }))

    return {
        stuck,
        coverage: byIntervention,
        totals: {
            assignments: assignments.length,
            stuck: stuck.length,
            stuckDelivery: stuck.filter(s => s.kind === 'delivery').length,
            stuckEvidence: stuck.filter(s => s.kind === 'evidence').length,
            unassigned: assignments.filter(a => !clean(a.assigneeId) && resolveAssignmentLifecycle(a).key !== 'cancelled').length,
            unrecognisedMovs: [...positions.values()].filter(p => p.stage === 'unrecognised').length
        },
        pipeline
    }
}

/** Roll intervention-level coverage rows up to one row per department. */
export function rollUpByDepartment(rows: CoverageRow[]): CoverageRow[] {
    const byDept = new Map<string, CoverageRow>()
    for (const row of rows) {
        const key = row.departmentId || row.departmentName
        const current = byDept.get(key)
        if (!current) {
            byDept.set(key, {
                key: `dept:${key}`,
                departmentId: row.departmentId,
                departmentName: row.departmentName,
                summary: { ...row.summary },
                stuck: row.stuck,
                mov: { ...row.mov }
            })
            continue
        }
        for (const field of Object.keys(current.summary) as Array<keyof DeliverySummary>) current.summary[field] += row.summary[field]
        current.stuck += row.stuck
        for (const field of Object.keys(current.mov) as Array<keyof CoverageRow['mov']>) current.mov[field] += row.mov[field]
    }
    return [...byDept.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName))
}
