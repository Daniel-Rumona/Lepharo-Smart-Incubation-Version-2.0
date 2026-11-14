import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'

// What the assistant's answer cards show. Each part loads on its own under the
// viewer's Firestore permissions, so a part they can't read simply doesn't appear.

export type AnswerCard = { type: 'sme' | 'intervention'; id: string }

const settle = async <T,>(work: () => Promise<T>): Promise<T | null> => {
    try {
        return await work()
    } catch {
        return null
    }
}

const toDate = (value: any): Date | null => {
    const date = value?.toDate?.() ?? (value ? new Date(value) : null)
    return date && !Number.isNaN(date.getTime()) ? date : null
}

const DONE = ['completed', 'complete', 'confirmed', 'done']
const isDone = (row: any) =>
    DONE.includes(String(row?.participantCompletionStatus || '').toLowerCase()) ||
    String(row?.assignmentStatus || '').toLowerCase() === 'completed'

export type SmeCardData = {
    id: string
    name: string
    sector: string
    place: string
    programme: string
    risk: { level: string; trend: string; reasons: string[] } | null
    business: { month: string; revenue: number | null; jobs: number | null } | null
    interventions: { active: number; completed: number } | null
}

export async function loadSmeCard(id: string): Promise<SmeCardData | null> {
    const [participant, risk, metrics, assignments] = await Promise.all([
        settle(() => getDoc(doc(db, 'participants', id))),
        settle(() => getDoc(doc(db, 'smeRiskSnapshots', id))),
        settle(() => getDocs(query(collection(db, 'participantMonthlyMetrics'), where('participantId', '==', id)))),
        settle(() => getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', id))))
    ])
    const p = participant?.exists() ? participant.data() as any : null
    if (!p) return null

    const riskData = risk?.exists() ? risk.data() as any : null
    const rows = (metrics?.docs || []).map(d => d.data() as any)
        .map(row => ({ month: String(row.sourceMonth || row.month || ''), row }))
        .filter(item => /^\d{4}-\d{2}$/.test(item.month))
        .sort((a, b) => b.month.localeCompare(a.month))
    const latest = rows[0]
    const number = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value))
    const jobsOf = (row: any) => {
        const permanent = number(row.headcountPermanent), temporary = number(row.headcountTemporary)
        return permanent === null && temporary === null ? null : (permanent || 0) + (temporary || 0)
    }
    const all = (assignments?.docs || []).map(d => d.data() as any)

    return {
        id,
        name: String(p.beneficiaryName || p.companyName || p.participantName || p.businessName || 'SME'),
        sector: String(p.sector || p.industry || ''),
        place: [p.branchName, p.province].filter(Boolean).join(' · '),
        programme: String(p.programName || ''),
        risk: riskData?.level
            ? {
                level: String(riskData.level),
                trend: String(riskData.trend || ''),
                reasons: (riskData.reasons || []).map((r: any) => String(r?.label || '')).filter(Boolean).slice(0, 2)
            }
            : null,
        business: latest
            ? { month: latest.month, revenue: number(latest.row.monthlyRevenue ?? latest.row.revenue), jobs: jobsOf(latest.row) }
            : null,
        interventions: assignments
            ? { active: all.filter(row => !isDone(row)).length, completed: all.filter(isDone).length }
            : null
    }
}

export type TimelineEvent = {
    key: string
    label: string
    at: Date | null
    tone: 'done' | 'missed' | 'waiting' | 'planned'
}

export type InterventionCardData = {
    id: string
    title: string
    smeName: string
    participantId: string
    facilitator: string
    dueDate: Date | null
    progress: number | null
    events: TimelineEvent[]
    evidence: string | null
}

export async function loadInterventionCard(id: string): Promise<InterventionCardData | null> {
    const assignment = await settle(() => getDoc(doc(db, 'assignedInterventions', id)))
    const a = assignment?.exists() ? assignment.data() as any : null
    if (!a) return null

    const [appointments, mov] = await Promise.all([
        settle(() => getDocs(query(collection(db, 'appointments'), where('assignedInterventionId', '==', id)))),
        settle(() => (a.movDocumentId
            ? getDoc(doc(db, 'movDocuments', String(a.movDocumentId))).then(snap => (snap.exists() ? snap.data() as any : null))
            : getDocs(query(collection(db, 'movDocuments'), where('assignedInterventionId', '==', id))).then(snap => (snap.docs[0]?.data() as any) || null)))
    ])
    const sessionIds = Array.from(new Set((appointments?.docs || []).map(d => String((d.data() as any).appointmentSessionId || '')).filter(Boolean)))
    const sessions: any[] = []
    for (let at = 0; at < sessionIds.length; at += 30) {
        const batch = await settle(() => getDocs(query(collection(db, 'appointmentSessions'), where(documentId(), 'in', sessionIds.slice(at, at + 30)))))
        batch?.docs.forEach(d => sessions.push(d.data()))
    }

    const now = Date.now()
    const events: TimelineEvent[] = []
    const assignedAt = toDate(a.createdAt)
    if (assignedAt) events.push({ key: 'assigned', label: `Assigned${a.assigneeName ? ` to ${a.assigneeName}` : ''}`, at: assignedAt, tone: 'done' })
    sessions
        .map(s => ({ s, at: toDate(s.startAt) }))
        .sort((x, y) => (x.at?.getTime() ?? 0) - (y.at?.getTime() ?? 0))
        .forEach(({ s, at }, index) => {
            const held = s.coverage?.held
            events.push({
                key: `session-${index}`,
                label: held === true ? 'Session held' : held === false ? 'Session not held' : at && at.getTime() > now ? 'Session planned' : 'Session not recorded',
                at,
                tone: held === true ? 'done' : held === false ? 'missed' : at && at.getTime() > now ? 'planned' : 'waiting'
            })
        })
    const deliveredAt = toDate(a.assigneeCompletedAt)
    if (deliveredAt) events.push({ key: 'delivered', label: 'Marked delivered', at: deliveredAt, tone: 'done' })
    const confirmedAt = toDate(a.participantConfirmedAt)
    if (confirmedAt) events.push({ key: 'confirmed', label: 'SME confirmed', at: confirmedAt, tone: 'done' })
    else if (deliveredAt) events.push({ key: 'confirm', label: 'Waiting for the SME to confirm', at: null, tone: 'waiting' })
    if (mov) {
        const approvedAt = toDate(mov.hodApprovedAt)
        events.push(mov.approvedByHod
            ? { key: 'mov', label: 'MOV approved', at: approvedAt, tone: 'done' }
            : { key: 'mov', label: String(mov.status || '').toLowerCase() === 'queried' ? 'MOV queried' : 'MOV waiting for approval', at: null, tone: 'waiting' })
    }

    const verdict = String(mov?.evidenceCheck?.verdict || '')
    return {
        id,
        title: String(a.interventionTitle || 'Intervention'),
        smeName: String(a.participantName || a.beneficiaryName || ''),
        participantId: String(a.participantId || ''),
        facilitator: String(a.assigneeName || ''),
        dueDate: toDate(a.dueDate),
        progress: a.computedProgress === undefined || a.computedProgress === null ? null : Number(a.computedProgress),
        events,
        evidence: verdict || null
    }
}
