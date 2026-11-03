import { getAuth } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import {
    addDoc,
    collection,
    doc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    Timestamp,
    writeBatch,
    updateDoc,
    where
} from 'firebase/firestore'
import { db, functions } from '@/firebase'

/**
 * Market linkage, phase 1. The passport and matching are worked out by Cloud
 * Functions (functions/src/marketLinkage.ts) from the same records the
 * compliance reminders use; capture is drafted by the AI backend
 * (ai-backend/opportunity_capture.py) and saved here only after review.
 */

export const STAGES = [
    { key: 'entry', label: 'Entry', color: 'default' },
    { key: 'developing', label: 'Developing', color: 'gold' },
    { key: 'market_ready', label: 'Market Ready', color: 'blue' },
    { key: 'preferred', label: 'Preferred Supplier', color: 'green' }
] as const

export type StageKey = typeof STAGES[number]['key']
export const stageMeta = (key?: string) => STAGES.find(stage => stage.key === key) || STAGES[0]

export const SA_PROVINCES = [
    'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga',
    'North West', 'Northern Cape', 'Western Cape'
]

/* ---------------------------------------------------------------- passport */

export type PassportComplianceItem = { key: string; title: string; status: string; expires: string | null; current: boolean }

export type Passport = {
    participantId: string
    name: string
    stage: StageKey
    stageLabel: string
    nextSteps: string[]
    compliance: { current: number; required: number; items: PassportComplianceItem[] }
    checks: { tax: boolean; csd: boolean; bbbee: boolean; cipc: boolean }
    input: {
        sector: string
        province: string
        town: string
        beeLevel: number | null
        ownership: { black: number | null; women: number | null; youth: number | null }
        registrations: { incomeTaxNumber: string; vatNumber: string; csdNumber: string; taxCompliancePin: string }
        risk: { score: number; level: string } | null
        interventions: { completed: number; total: number }
        performance: { annualRevenue: number | null; employees: number | null; monthsReported: number }
        capability: { csdRegistered: boolean | null; capacity: boolean | null; tradeReferences: boolean | null; clientList: boolean | null }
    }
    /** Across every opportunity the SME was invited to. */
    bids?: {
        invited: number
        interested: number
        submitted: number
        won: number
        lost: number
        winRate: number | null
        lostReasons: Array<{ key: string; label: string; support: string; count: number }>
    }
    contracts?: { count: number; value: number; paid: number; overdueMilestones: number }
}

export const getSupplierPassport = async (participantId: string) =>
    (await httpsCallable(functions, 'getSupplierPassport')({ participantId })).data as Passport

/* ----------------------------------------------------------- opportunities */

export type OpportunityRequirements = {
    sectors: string[]
    provinces: string[]
    documents: string[]
    maxBeeLevel: number | null
    ownership: { black?: number | null; women?: number | null; youth?: number | null }
    requireCsd: boolean
    minStage: StageKey | null
}

export type MatchResult = {
    participantId: string
    name: string
    stage: StageKey
    eligible: boolean
    score: number
    /** Missing on matches saved before the breakdown existed; run the match again. */
    scoreParts?: Array<{ label: string; points: number }>
    gaps: string[]
    strengths: string[]
}

export type Opportunity = {
    id: string
    title: string
    buyer: string
    reference: string
    summary: string
    location: string
    value: string
    closingDate: Date | null
    status: 'open' | 'closed'
    requirements: OpportunityRequirements
    matches: MatchResult[]
    matchSummary: { considered: number; eligible: number } | null
    matchedAt: Date | null
    invitedCount: number
    createdAt: Date | null
    programId: string | null
}

export type OpportunityInput = Omit<Opportunity, 'id' | 'matches' | 'matchSummary' | 'matchedAt' | 'invitedCount' | 'createdAt' | 'status' | 'programId'>

const toDate = (value: any): Date | null =>
    value?.toDate ? value.toDate() : value ? new Date(value) : null

const fromDoc = (id: string, data: any): Opportunity => ({
    id,
    title: data.title || 'Untitled opportunity',
    buyer: data.buyer || '',
    reference: data.reference || '',
    summary: data.summary || '',
    location: data.location || '',
    value: data.value || '',
    closingDate: toDate(data.closingDate),
    status: data.status === 'closed' ? 'closed' : 'open',
    requirements: {
        sectors: data.requirements?.sectors || [],
        provinces: data.requirements?.provinces || [],
        documents: data.requirements?.documents || [],
        maxBeeLevel: data.requirements?.maxBeeLevel ?? null,
        ownership: data.requirements?.ownership || {},
        requireCsd: data.requirements?.requireCsd === true,
        minStage: data.requirements?.minStage || null
    },
    matches: Array.isArray(data.matches) ? data.matches : [],
    matchSummary: data.matchSummary || null,
    matchedAt: toDate(data.matchedAt),
    invitedCount: Number(data.invitedCount) || 0,
    createdAt: toDate(data.createdAt),
    programId: data.programId || null
})

/** The programme's opportunities, newest first; 'all' lists every programme's. */
export const listOpportunities = async (programId: string): Promise<Opportunity[]> => {
    const snap = await getDocs(query(collection(db, 'marketOpportunities'), orderBy('createdAt', 'desc')))
    return snap.docs
        .map(d => fromDoc(d.id, d.data()))
        .filter(o => programId === 'all' || o.programId === programId)
}

const toRecord = (input: OpportunityInput) => ({
    title: input.title.trim(),
    buyer: input.buyer.trim(),
    reference: input.reference.trim(),
    summary: input.summary.trim(),
    location: input.location.trim(),
    value: input.value.trim(),
    closingDate: input.closingDate ? Timestamp.fromDate(input.closingDate) : null,
    requirements: input.requirements
})

/** Matching only considers SMEs accepted into this programme. */
export const createOpportunity = async (input: OpportunityInput, uid: string, programId: string | null) =>
    (await addDoc(collection(db, 'marketOpportunities'), {
        ...toRecord(input),
        programId,
        status: 'open',
        invitedCount: 0,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })).id

// Changing the requirements makes the saved matches stale, so they are cleared.
export const updateOpportunity = (id: string, input: OpportunityInput) =>
    updateDoc(doc(db, 'marketOpportunities', id), {
        ...toRecord(input),
        matches: [],
        matchSummary: null,
        matchedAt: null,
        updatedAt: serverTimestamp()
    })

export const setOpportunityStatus = (id: string, status: 'open' | 'closed') =>
    updateDoc(doc(db, 'marketOpportunities', id), { status, updatedAt: serverTimestamp() })

export const matchOpportunity = async (opportunityId: string) =>
    ((await httpsCallable(functions, 'matchMarketOpportunity')({ opportunityId })).data as { matches: MatchResult[] }).matches

export type InviteResult = { participantId: string; status: 'invited' | 'already-invited'; whatsapp: boolean; email: boolean }

export const inviteToOpportunity = async (opportunityId: string, participantIds: string[]) =>
    ((await httpsCallable(functions, 'inviteToMarketOpportunity')({ opportunityId, participantIds })).data as { results: InviteResult[] }).results

/* ---------------------------------------------------------------- interests */

/** Bid stages; mirrors BID_STAGES and canMove in functions/src/bidPipelineLogic.ts (firestore.rules enforces the moves). */
export type InterestStatus = 'invited' | 'interested' | 'declined' | 'shortlisted' | 'submitted' | 'awarded' | 'lost' | 'withdrawn'

export const BID_STAGE_META: Record<InterestStatus, { label: string; color: string; smeLabel: string }> = {
    invited: { label: 'Invited', color: 'processing', smeLabel: 'Waiting for your answer' },
    interested: { label: 'Interested', color: 'cyan', smeLabel: 'You are interested' },
    declined: { label: 'Not interested', color: 'default', smeLabel: 'Not this time' },
    shortlisted: { label: 'Shortlisted', color: 'blue', smeLabel: 'Shortlisted' },
    submitted: { label: 'Bid submitted', color: 'purple', smeLabel: 'Bid submitted' },
    awarded: { label: 'Awarded', color: 'success', smeLabel: 'You won this' },
    lost: { label: 'Lost', color: 'error', smeLabel: 'Not successful' },
    withdrawn: { label: 'Withdrawn', color: 'default', smeLabel: 'Withdrawn' }
}

/** The next moves Market Linkages can make from each stage (the SME answers invited ones itself). */
export const BID_NEXT: Record<InterestStatus, InterestStatus[]> = {
    invited: ['withdrawn'],
    interested: ['shortlisted', 'submitted', 'lost', 'withdrawn'],
    declined: [],
    shortlisted: ['submitted', 'lost', 'withdrawn'],
    submitted: ['awarded', 'lost', 'withdrawn'],
    awarded: [],
    lost: [],
    withdrawn: []
}

/** Mirrors LOST_REASONS in functions/src/bidPipelineLogic.ts. */
export const LOST_REASONS = [
    { key: 'price', label: 'Price too high', support: 'Tender pricing and costing support' },
    { key: 'compliance', label: 'Compliance documents missing or expired', support: 'Bring compliance documents up to date before the next bid' },
    { key: 'bbbee', label: 'B-BBEE level or ownership', support: 'B-BBEE rating support' },
    { key: 'capacity', label: 'Not enough capacity or equipment', support: 'Capacity building: equipment funding or a joint venture' },
    { key: 'experience', label: 'Not enough track record or references', support: 'Build a track record with smaller contracts and trade references' },
    { key: 'quality', label: 'Quality or technical standard', support: 'Quality management (QMS) support' },
    { key: 'late', label: 'Late or incomplete submission', support: 'Bid preparation support: checklists and earlier submission' },
    { key: 'other', label: 'Other', support: "Discuss the buyer's feedback with the Market Linkages team" }
] as const

export type LostReasonKey = typeof LOST_REASONS[number]['key']
export const lostReasonMeta = (key?: string | null) => LOST_REASONS.find(r => r.key === key) || null

export type OpportunityInterest = {
    id: string
    opportunityId: string
    participantId: string
    participantName: string
    status: InterestStatus
    responseNote: string
    invitedAt: Date | null
    respondedAt: Date | null
    stageChangedAt: Date | null
    lostReason: LostReasonKey | null
    lostNote: string
    contractId: string | null
    opportunity: {
        title: string
        buyer: string | null
        summary: string | null
        closingDate: Date | null
        value: string | null
        location: string | null
        documents: string[]
    }
    match: { eligible: boolean; gaps: string[] } | null
}

const interestFromDoc = (id: string, data: any): OpportunityInterest => ({
    id,
    opportunityId: data.opportunityId,
    participantId: data.participantId,
    participantName: data.participantName || '',
    status: (data.status in BID_STAGE_META ? data.status : 'invited') as InterestStatus,
    responseNote: data.responseNote || '',
    invitedAt: toDate(data.invitedAt),
    respondedAt: toDate(data.respondedAt),
    stageChangedAt: toDate(data.stageChangedAt),
    lostReason: lostReasonMeta(data.lostReason)?.key || null,
    lostNote: data.lostNote || '',
    contractId: data.contractId || null,
    opportunity: {
        title: data.opportunity?.title || 'Opportunity',
        buyer: data.opportunity?.buyer || null,
        summary: data.opportunity?.summary || null,
        closingDate: toDate(data.opportunity?.closingDate),
        value: data.opportunity?.value || null,
        location: data.opportunity?.location || null,
        documents: data.opportunity?.documents || []
    },
    match: data.match || null
})

export const listInterestsForOpportunity = async (opportunityId: string) => {
    const snap = await getDocs(query(collection(db, 'opportunityInterests'), where('opportunityId', '==', opportunityId)))
    return snap.docs.map(d => interestFromDoc(d.id, d.data()))
}

/** An SME's own invitations, newest first (sorted here, so no composite index is needed). */
export const listMyInterests = async (participantId: string) => {
    const snap = await getDocs(query(collection(db, 'opportunityInterests'), where('participantId', '==', participantId)))
    return snap.docs
        .map(d => interestFromDoc(d.id, d.data()))
        .sort((a, b) => (b.invitedAt?.getTime() || 0) - (a.invitedAt?.getTime() || 0))
}

export const respondToOpportunity = (interestId: string, status: 'interested' | 'declined', responseNote = '') =>
    updateDoc(doc(db, 'opportunityInterests', interestId), {
        status,
        responseNote: responseNote.trim().slice(0, 500),
        respondedAt: serverTimestamp()
    })

/** Market Linkages moves a bid along. The SME is told by onOpportunityInterestStage (functions/src/bidPipeline.ts). */
export const moveBid = (
    interestId: string,
    status: Exclude<InterestStatus, 'awarded'>,
    uid: string,
    lost?: { reason: LostReasonKey; note: string }
) =>
    updateDoc(doc(db, 'opportunityInterests', interestId), {
        status,
        ...(lost ? { lostReason: lost.reason, lostNote: lost.note.trim().slice(0, 500) } : {}),
        stageChangedAt: serverTimestamp(),
        stageChangedBy: uid
    })

/* ---------------------------------------------------------------- contracts */

export type MilestoneStatus = 'pending' | 'delivered' | 'paid'
export type ContractMilestone = { id: string; title: string; dueDate: Date | null; amount: number; status: MilestoneStatus }
export type ContractStatus = 'active' | 'completed' | 'terminated'

export type SupplyContract = {
    id: string
    opportunityId: string
    interestId: string
    participantId: string
    participantName: string
    programId: string | null
    title: string
    buyer: string
    value: number
    startDate: Date | null
    endDate: Date | null
    status: ContractStatus
    milestones: ContractMilestone[]
    createdAt: Date | null
}

const contractFromDoc = (id: string, data: any): SupplyContract => ({
    id,
    opportunityId: data.opportunityId || '',
    interestId: data.interestId || '',
    participantId: data.participantId || '',
    participantName: data.participantName || 'SME',
    programId: data.programId || null,
    title: data.title || 'Contract',
    buyer: data.buyer || '',
    value: Number(data.value) || 0,
    startDate: toDate(data.startDate),
    endDate: toDate(data.endDate),
    status: (['completed', 'terminated'].includes(data.status) ? data.status : 'active') as ContractStatus,
    milestones: (Array.isArray(data.milestones) ? data.milestones : []).map((m: any, i: number) => ({
        id: m.id || String(i),
        title: m.title || `Milestone ${i + 1}`,
        dueDate: toDate(m.dueDate),
        amount: Number(m.amount) || 0,
        status: (['delivered', 'paid'].includes(m.status) ? m.status : 'pending') as MilestoneStatus
    })),
    createdAt: toDate(data.createdAt)
})

/** Mirrors contractTotals in functions/src/bidPipelineLogic.ts. */
export const contractTotals = (contract: Pick<SupplyContract, 'value' | 'milestones'>) => {
    const sum = (statuses: MilestoneStatus[]) =>
        contract.milestones.filter(m => statuses.includes(m.status)).reduce((total, m) => total + m.amount, 0)
    const scheduled = contract.milestones.reduce((total, m) => total + m.amount, 0)
    return {
        scheduled,
        unscheduled: Math.max(0, contract.value - scheduled),
        delivered: sum(['delivered', 'paid']),
        paid: sum(['paid'])
    }
}

export const isMilestoneOverdue = (m: ContractMilestone) =>
    m.status === 'pending' && !!m.dueDate && m.dueDate.getTime() < Date.now()

/** The programme's contracts, newest first; 'all' lists every programme's. */
export const listContracts = async (programId: string) => {
    const snap = await getDocs(collection(db, 'supplyContracts'))
    return snap.docs
        .map(d => contractFromDoc(d.id, d.data()))
        .filter(c => programId === 'all' || c.programId === programId)
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
}

/** An SME's own contracts. */
export const listMyContracts = async (participantId: string) => {
    const snap = await getDocs(query(collection(db, 'supplyContracts'), where('participantId', '==', participantId)))
    return snap.docs.map(d => contractFromDoc(d.id, d.data())).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
}

const milestoneRecord = (m: ContractMilestone) => ({
    id: m.id,
    title: m.title.trim(),
    dueDate: m.dueDate ? Timestamp.fromDate(m.dueDate) : null,
    amount: Number(m.amount) || 0,
    status: m.status
})

export type AwardInput = {
    value: number
    startDate: Date | null
    endDate: Date | null
    milestones: ContractMilestone[]
}

/**
 * Awards the bid and opens its contract in one write, so there is never an
 * awarded bid without a contract (or the other way round).
 */
export const awardBid = async (interest: OpportunityInterest, opportunity: Opportunity, input: AwardInput, uid: string) => {
    const batch = writeBatch(db)
    const contractRef = doc(collection(db, 'supplyContracts'))
    batch.set(contractRef, {
        opportunityId: interest.opportunityId,
        interestId: interest.id,
        participantId: interest.participantId,
        participantName: interest.participantName,
        programId: opportunity.programId,
        title: opportunity.title,
        buyer: opportunity.buyer,
        value: input.value,
        startDate: input.startDate ? Timestamp.fromDate(input.startDate) : null,
        endDate: input.endDate ? Timestamp.fromDate(input.endDate) : null,
        status: 'active',
        milestones: input.milestones.map(milestoneRecord),
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })
    batch.update(doc(db, 'opportunityInterests', interest.id), {
        status: 'awarded',
        contractId: contractRef.id,
        stageChangedAt: serverTimestamp(),
        stageChangedBy: uid
    })
    await batch.commit()
    return contractRef.id
}

export const saveContractMilestones = (contractId: string, milestones: ContractMilestone[]) =>
    updateDoc(doc(db, 'supplyContracts', contractId), {
        milestones: milestones.map(milestoneRecord),
        updatedAt: serverTimestamp()
    })

export const setContractStatus = (contractId: string, status: ContractStatus) =>
    updateDoc(doc(db, 'supplyContracts', contractId), { status, updatedAt: serverTimestamp() })

export const newMilestoneId = () => Math.random().toString(36).slice(2, 10)

export const formatRand = (value: number) => `R ${Math.round(value).toLocaleString('en-ZA')}`

/* ------------------------------------------------------------------ capture */

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-inc.hf.space'
).replace(/\/$/, '')

export type OpportunityDraft = {
    title: string
    buyer: string
    reference: string
    summary: string
    sectors: string[]
    provinces: string[]
    location: string
    documents: string[]
    maxBeeLevel: number | null
    ownership: { black: number | null; women: number | null; youth: number | null }
    requireCsd: boolean
    closingDate: string | null
    value: string
    warnings: string[]
}

const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = String(reader.result || '')
            resolve(result.split(',', 2)[1] || result)
        }
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })

/** Asks the AI backend to draft an opportunity from pasted text or a document. Nothing is saved. */
export async function extractOpportunity(source: { text?: string; file?: File }): Promise<OpportunityDraft> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Please sign in again to use the assistant.')
    const body = source.file
        ? { fileBase64: await readFileAsBase64(source.file), fileName: source.file.name, mimeType: source.file.type }
        : { text: source.text || '' }
    const response = await fetch(`${AI_BACKEND_URL}/opportunities/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify(body)
    })
    const data = await response.json().catch(() => ({}))
    // 404 means the AI backend in use predates opportunity capture.
    if (response.status === 404) throw new Error("The AI reader isn't available yet. Fill the form in yourself.")
    if (!response.ok) throw new Error(data?.detail || `The assistant is unavailable (${response.status}).`)
    return data as OpportunityDraft
}
