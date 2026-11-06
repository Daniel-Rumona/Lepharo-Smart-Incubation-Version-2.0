import { resolveAssignmentLifecycle, type AssignmentLifecycleKey } from '../assignmentLifecycleService'
import { MOV_STAGE_ORDER, MOV_STAGE_META, resolveMovPosition } from '../movPipeline'
import { indexPacksByMovId } from '../interventionTower'

export type TwinRow = Record<string, any> & { id: string }
export const TWIN_COLLECTIONS = ['assignedInterventions', 'movDocuments', 'consolidatedMOVs', 'appointments', 'appointmentSessions', 'inquiries', 'outcomeFollowUps', 'outcomeAssessments', 'syntheticHistory'] as const
export type TwinCollection = typeof TWIN_COLLECTIONS[number]
export type TwinSources = Record<TwinCollection, TwinRow[]>
export const emptySources = (): TwinSources => Object.fromEntries(TWIN_COLLECTIONS.map(k => [k, [] as TwinRow[]])) as TwinSources
export type TwinAccess = { allowed: boolean; branchId: string; centreOnly: boolean }
/** `departmentRole` is the role of the user's department (see departmentRoles); ROM and M&E see the whole programme. */
export function twinAccess(user: any, departmentRole?: string | null): TwinAccess {
    const role = String(user?.role || '').toLowerCase()
    const branchId = typeof user?.assignedBranch === 'string' ? user.assignedBranch : String(user?.assignedBranch?.id || '')
    if (role === 'projectadmin') return { allowed: !!branchId, branchId, centreOnly: true }
    return { allowed: role === 'system_admin' || (role === 'operations' && (departmentRole === 'rom' || departmentRole === 'monitoring')), branchId: '', centreOnly: false }
}
export function millis(value: any): number | null {
    const n = typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : typeof value?.seconds === 'number' ? value.seconds * 1000 : typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isFinite(n) ? n : null
}
export type TwinItem = {
    key: string; collection: TwinCollection; id: string; assignmentId: string
    title: string; participant: string; owner: string; state: string; stage: string
    enteredAt: number | null; synthetic: boolean; raw: TwinRow
}
export type TwinStage = { key: string; label: string; items: TwinItem[] }
export type TwinIssue = { collection: string; id: string; reason: string; /** Who and what the record is about, when known. */ label?: string }
export type ProcessModel = ReturnType<typeof buildProcessTwin>
const deliveryOrder: AssignmentLifecycleKey[] = ['assigned', 'awaiting-participant-acceptance', 'in-delivery', 'awaiting-participant-confirmation', 'completed', 'needs-reassignment', 'participant-declined', 'participant-rejected', 'cancelled']
const deliveryLabels = ['Assigned', 'Appointment response', 'In delivery', 'SME confirmation', 'Completed', 'Reassignment', 'Declined', 'Completion rejected', 'Cancelled']
const outcomeLabels: Record<string, string> = { scheduled: 'Not yet due', due: 'Due / unanswered', achieved: 'Reported achieved', partial: 'Reported partial', not_yet: 'Reported not achieved', disputed: 'Disputed reports', unknown: 'Unknown' }
const synthetic = (r: TwinRow) => r.dataOrigin === 'synthetic' || r.id.startsWith('dtseed_')
const participant = (r: TwinRow) => String(r.participantName || r.smmeCompanyName || r.smmeName || r.smeName || r.contactInfo?.company || 'Unnamed SME')

/** Read-only current projection. No inferred history and no operational mutations. */
export function buildProcessTwin(source: TwinSources, scope: { programId: string; branchId?: string; department?: string }, now: number) {
    const issues: TwinIssue[] = []
    const inScope = (r: TwinRow) => r.programId === scope.programId && (!scope.branchId || r.branchId === scope.branchId)
    const assignments = source.assignedInterventions.filter(inScope).filter(r => !scope.department || scope.department === 'all' || r.departmentId === scope.department)
    const assignmentById = new Map(assignments.map(r => [r.id, r]))
    const byAssignment = (rows: TwinRow[], collection: TwinCollection) => rows.filter(r => {
        if (r.programId !== scope.programId) return false
        const a = assignmentById.get(r.assignedInterventionId)
        if (!a) {
            if (!source.assignedInterventions.some(x => x.id === r.assignedInterventionId)) issues.push({ collection, id: r.id, reason: 'Missing linked assignment; excluded from map' })
            return false
        }
        if (r.branchId && r.branchId !== a.branchId) { issues.push({ collection, id: r.id, reason: 'Branch contradicts assignment; excluded from map' }); return false }
        return true
    })
    const movs = byAssignment(source.movDocuments, 'movDocuments')
    const appointments = byAssignment(source.appointments, 'appointments')
    const followUps = byAssignment(source.outcomeFollowUps, 'outcomeFollowUps')
    const assessments = byAssignment(source.outcomeAssessments, 'outcomeAssessments')
    const packIndex = indexPacksByMovId(source.consolidatedMOVs.filter(r => r.programId === scope.programId))
    const sessionById = new Map(source.appointmentSessions.filter(inScope).map(r => [r.id, r]))
    const validAppointments = appointments.filter(a => {
        if (sessionById.has(a.appointmentSessionId)) return true
        issues.push({collection: 'appointments', id: a.id, reason: 'Missing or out-of-scope session; excluded from attendance'})
        return false
    })
    const appointmentById = new Map(validAppointments.map(r => [r.id, r]))
    const inquiries = byAssignment(source.inquiries.filter(r => r.source === 'Walk-in'), 'inquiries').filter(r => {
        const a = appointmentById.get(r.appointmentId)
        if (a && a.smeId === r.participantId && a.appointmentSessionId === r.appointmentSessionId && a.attendance?.status === 'attended') return true
        issues.push({collection: 'inquiries', id: r.id, reason: 'Walk-in does not match an attended invitation; excluded'})
        return false
    })
    const makeItem = (r: TwinRow, collection: TwinCollection, stage: string, state: string, owner: string, enteredAt: number | null): TwinItem => {
        const a = assignmentById.get(r.assignedInterventionId)
        return {key: `${collection}/${r.id}`, collection, id: r.id, assignmentId: collection === 'assignedInterventions' ? r.id : r.assignedInterventionId,
            title: String(r.interventionTitle || a?.interventionTitle || 'Intervention'), participant: participant(a || r), owner, state, stage, enteredAt, synthetic: synthetic(r), raw: r}
    }
    const delivery = deliveryOrder.map((key, i): TwinStage => ({key, label: deliveryLabels[i], items: []}))
    for (const r of assignments) {
        const l = resolveAssignmentLifecycle(r)
        // Invitation creation starts the response wait; the scheduled session date
        // and generic updatedAt do not. Prefer the explicitly linked current invite.
        const pendingInvites = validAppointments.filter(a => a.assignedInterventionId === r.id && a.smeConfirmation === 'pending' && a.status !== 'cancelled' && sessionById.get(a.appointmentSessionId)?.status !== 'cancelled')
        const responseInvite = r.lastAppointmentId
            ? pendingInvites.find(a => a.id === r.lastAppointmentId)
            : pendingInvites.length === 1 ? pendingInvites[0] : undefined
        // Only explicit stage transitions can establish stage age; updatedAt is not a transition.
        const field: Partial<Record<AssignmentLifecycleKey, any>> = {assigned: r.assignedAt, 'needs-reassignment': r.assigneeDeclinedAt, 'participant-declined': r.participantDeclinedAt, 'participant-rejected': r.participantCompletionRejectedAt, 'awaiting-participant-acceptance': responseInvite?.createdAt, completed: r.participantConfirmedAt || r.completedAt, 'awaiting-participant-confirmation': r.assigneeCompletedAt, 'in-delivery': r.participantAcceptedAt, cancelled: r.cancelledAt}
        delivery.find(s => s.key === l.key)!.items.push(makeItem(r, 'assignedInterventions', l.key, l.label, l.key === 'needs-reassignment' ? 'HOD' : l.waitingOn === 'participant' ? 'SME' : l.waitingOn === 'assignee' ? 'Facilitator' : 'None', millis(field[l.key])))
    }
    const evidenceOrder = [...MOV_STAGE_ORDER.filter(key => key !== 'queried' && key !== 'rejected' && key !== 'unrecognised'), 'queried', 'rejected'] as typeof MOV_STAGE_ORDER
    const evidence = evidenceOrder.map((key): TwinStage => ({key, label: MOV_STAGE_META[key].label, items: []}))
    for (const r of movs) {
        const pack = packIndex.get(r.id), p = resolveMovPosition(r, pack)
        // A MOV only exists once the facilitator has completed the intervention, so it always starts awaiting the SME. The shared resolver reports anything it does not recognise as 'unrecognised'; that is a data problem, not a stage.
        if (p.stage === 'unrecognised') { issues.push({ collection: 'movDocuments', id: r.id, reason: 'MOV status is missing or not recognised; excluded from the evidence stages', label: `${participant(assignmentById.get(r.assignedInterventionId) || r)} · ${r.interventionTitle || assignmentById.get(r.assignedInterventionId)?.interventionTitle || 'Intervention'}` }); continue }
        // The legacy resolver sometimes falls back to updatedAt. Keep stage classification,
        // but show age only where an explicit transition timestamp exists.
        const times: Record<string, any> = {awaiting_smme:r.submittedAt || r.createdAt, awaiting_hod:r.smmeSignedAt, queried:r.queriedAt, rejected:r.rejectedAt, hod_approved:r.hodApprovedAt, in_pack:pack?.submittedAt || pack?.createdAt, cc_confirmed:pack?.ccConfirmedAt || [...(pack?.approvals || [])].reverse().find((a: any) => a.step === 'final_confirmation')?.date, me_validated:r.monitoringApprovedAt || r.monitoringValidation?.validatedAt, invoice_redeemable:pack?.invoiceRedeemableAt}
        evidence.find(s => s.key === p.stage)!.items.push(makeItem(r, 'movDocuments', p.stage, p.label, p.owner || 'None', millis(times[p.stage])))
    }
    const outcomes = Object.entries(outcomeLabels).map(([key, label]): TwinStage => ({key, label, items: []}))
    for (const r of followUps) {
        const valid = ['achieved', 'partial', 'not_yet']
        const stage = valid.includes(r.answer) ? valid.includes(r.smeAnswer) && r.answer !== r.smeAnswer ? 'disputed' : r.answer : r.answer || r.status === 'answered' ? 'unknown' : millis(r.dueAt) === null ? 'unknown' : millis(r.dueAt)! <= now ? 'due' : 'scheduled'
        outcomes.find(s => s.key === stage)!.items.push(makeItem(r, 'outcomeFollowUps', stage, outcomeLabels[stage], r.answer || stage === 'scheduled' ? 'None' : 'Facilitator / SME', millis(stage === 'due' ? r.dueAt : r.answeredAt)))
    }
    const lanes = [{key:'delivery', label:'Delivery', unit:'assignments', stages:delivery}, {key:'evidence', label:'Evidence approval', unit:'individual MOVs', stages:evidence}, {key:'outcomes', label:'Outcomes', unit:'follow-ups', stages:outcomes}]
    const items = lanes.flatMap(l => l.stages.flatMap(s => s.items))
    const sessions = [...new Set(validAppointments.map(a => a.appointmentSessionId))].map(id => sessionById.get(id)!)
    return {lanes, items, issues, assignments, appointments:validAppointments, sessions, inquiries, assessments, followUps, movs, packIndex,
        syntheticCount: items.filter(i => i.synthetic).length, unknownAge: items.filter(i => i.owner !== 'None' && i.enteredAt === null).length,
        attended: validAppointments.filter(a => a.attendance?.status === 'attended').length}
}
