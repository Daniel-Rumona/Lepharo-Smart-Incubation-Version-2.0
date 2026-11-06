import { millis, type ProcessModel, type TwinRow } from './processTwin'

export const HISTORY_NODES = ['assigned', 'attended', 'delivery', 'confirmed', 'approved', 'validated', 'outcome'] as const
export type HistoryNode = typeof HISTORY_NODES[number]
/** Steps that do not follow the one before them in the list. The outcome assessment is made about the delivered intervention, not about M&E validation, so its timing runs from the SME's confirmation. */
export const HISTORY_PARENT: Partial<Record<HistoryNode, HistoryNode>> = { outcome: 'confirmed' }
export const HISTORY_LABELS: Record<HistoryNode, string> = {assigned:'Assigned', attended:'Session attended', delivery:'Delivery recorded', confirmed:'SME confirmed', approved:'HOD approved', validated:'M&E validated', outcome:'Outcome assessed'}
export const CHANNELS = ['in_person', 'virtual', 'telephonic'] as const
export type Channel = typeof CHANNELS[number] | 'other'
export const CHANNEL_LABELS: Record<Channel, string> = {in_person:'In person', virtual:'Virtual', telephonic:'Telephonic', other:'Other / not recorded'}
export type HistoryEvent = {channel?:Channel; id:string; assignmentId:string; node:HistoryNode; at:number; label:string; participant:string; intervention:string; source:string; synthetic:boolean}

const deliveryLabel = (raw:any):string => {
    const v = String(raw||'').toLowerCase().replace(/[\s_-]+/g,'')
    return v==='inperson'?'in person':v==='online'||v==='virtual'?'virtual':v==='telephonic'||v==='telephone'||v==='telephonically'||v==='phone'?'telephonic':v==='hybrid'?'hybrid':''
}

const channelOf = (label:string):Channel => label==='in person'?'in_person':label==='virtual'?'virtual':label==='telephonic'?'telephonic':'other'

/** Observed milestones only. Never reconstruct earlier states from today's status or updatedAt. */
export function buildHistory(model: ProcessModel, authored: TwinRow[], now: number) {
    const assignments = new Map(model.assignments.map(a => [a.id,a]))
    const events = new Map<string, HistoryEvent>()
    let invalid = 0, future = 0
    const add = (assignmentId:string, node:HistoryNode, date:any, label:string, row:TwinRow, collection:string, distinct = '', channel?:Channel) => {
        const assignment = assignments.get(assignmentId)
        if (!assignment || date == null) return
        const at = millis(date)
        if (at === null) {invalid++; return}
        if (at > now) {future++; return}
        const id = `${assignmentId}:${node}:${at}:${distinct}`
        // Same milestone imported through multiple sources is counted once.
        if (!events.has(id)) events.set(id, {id,assignmentId,node,at,label,participant:assignment.participantName || 'Unnamed SME',intervention:assignment.interventionTitle || 'Intervention',channel,source:`${collection}/${row.id}`,synthetic:row.dataOrigin === 'synthetic' || row.id.startsWith('dtseed_')})
    }
    for (const row of authored) {
        const mapping:Record<string,HistoryNode> = {assigned:'assigned',delivered:'delivery',confirmed:'confirmed'}
        if (mapping[row.eventType] && row.dataOrigin === 'synthetic') add(row.entityId,mapping[row.eventType],row.occurredAt,HISTORY_LABELS[mapping[row.eventType]],row,'syntheticHistory')
    }
    for (const a of model.assignments) {
        add(a.id,'assigned',a.assignedAt,'Assignment recorded',a,'assignedInterventions')
        add(a.id,'delivery',a.assigneeCompletedAt,'Facilitator recorded completion',a,'assignedInterventions')
        add(a.id,'confirmed',a.participantConfirmedAt,'SME confirmed completion',a,'assignedInterventions')
    }
    // Attendance is recorded on the invitation whatever the delivery method (in person, virtual, telephonic, hybrid).
    // Walk-in inquiries are a subset of these, so they are not a separate source and cannot double-count.
    const sessions = new Map(model.sessions.map(s => [s.id, s]))
    let attendedUndated = 0
    for (const inv of model.appointments) {
        if (inv.attendance?.status !== 'attended') continue
        if (inv.attendance.checkedInAt == null) {attendedUndated++; continue}
        const method = deliveryLabel(inv.deliveryMethod || inv.delivery?.mode || sessions.get(inv.appointmentSessionId)?.deliveryMethod || sessions.get(inv.appointmentSessionId)?.delivery?.mode)
        add(inv.assignedInterventionId,'attended',inv.attendance.checkedInAt,method?'Attended ('+method+')':'Session attended',inv,'appointments',inv.id,channelOf(method))
    }
    for (const mov of model.movs) {
        add(mov.assignedInterventionId,'approved',mov.hodApprovedAt,'HOD approved evidence',mov,'movDocuments',mov.id)
        add(mov.assignedInterventionId,'validated',mov.monitoringApprovedAt || mov.monitoringValidation?.validatedAt,'M&E validated evidence',mov,'movDocuments',mov.id)
    }
    for (const assessment of model.assessments) add(assessment.assignedInterventionId,'outcome',assessment.at,`${assessment.byRole || 'Assessor'}: ${assessment.assessment || 'Unknown result'}`,assessment,'outcomeAssessments',assessment.id)
    const ordered = [...events.values()].sort((a,b) => a.at-b.at || HISTORY_NODES.indexOf(a.node)-HISTORY_NODES.indexOf(b.node) || a.id.localeCompare(b.id))
    return {events:ordered,invalid,future,attendedUndated,coveredAssignments:new Set(ordered.map(e=>e.assignmentId)).size,totalAssignments:assignments.size}
}

export function historyFrame(events:HistoryEvent[], position:number) {
    const count = Math.min(events.length,Math.max(0,Math.floor(position)))
    const observed = events.slice(0,count)
    const current = observed.at(-1) || null
    const previous = current ? observed.slice(0,-1).reverse().find(e=>e.assignmentId===current.assignmentId) || null : null
    const counts = Object.fromEntries(HISTORY_NODES.map(node=>[node,new Set(observed.filter(e=>e.node===node).map(e=>e.assignmentId)).size])) as Record<HistoryNode,number>
    const channels = Object.fromEntries((Object.keys(CHANNEL_LABELS) as Channel[]).map(c=>[c,new Set(observed.filter(e=>e.node==='attended'&&(e.channel||'other')===c).map(e=>e.assignmentId)).size])) as Record<Channel,number>
    return {current,previous,counts,channels,recent:observed.slice(-5).reverse(),position:count}
}

export type StepDuration = {medianDays:number;n:number}
/**
 * Typical days from the previous step to this one, over assignments that reached both (earliest evidence per step).
 * Pairs where the later step is dated before the earlier one are ignored; fewer than 3 pairs is reported as unknown.
 */
export function stepDurations(events:HistoryEvent[]):Partial<Record<HistoryNode,StepDuration>> {
    const first=new Map<string,Partial<Record<HistoryNode,number>>>()
    for(const e of events){const m=first.get(e.assignmentId)||{};if(m[e.node]===undefined||e.at<m[e.node]!)m[e.node]=e.at;first.set(e.assignmentId,m)}
    const result:Partial<Record<HistoryNode,StepDuration>>={}
    HISTORY_NODES.forEach((node,i)=>{
        if(i===0)return
        const prev=HISTORY_PARENT[node]??HISTORY_NODES[i-1],days:number[]=[]
        for(const m of first.values())if(m[node]!==undefined&&m[prev]!==undefined&&m[node]!>=m[prev]!)days.push((m[node]!-m[prev]!)/86400000)
        if(days.length<3)return
        days.sort((a,b)=>a-b);const mid=days.length>>1
        result[node]={medianDays:Math.round(days.length%2?days[mid]:(days[mid-1]+days[mid])/2),n:days.length}
    })
    return result
}
