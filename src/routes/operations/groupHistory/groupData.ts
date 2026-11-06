import dayjs from 'dayjs'
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    isAgreementCountersigned,
    type GroupEligibility,
    type GroupEvidence,
    type GroupHistoryEntry,
    type GroupIntervention,
    type IncubationGroup,
    type PendingGroupMovement
} from '@/services/groupLifecycleService'
import { departmentNameOf, loadDepartmentRoles } from '@/services/departmentRoles'
import { canonicalAgreementId, complianceStatusLabel } from '@/services/complianceResolver'

/**
 * Data for the Groups page: one row per accepted SME in the active programme,
 * with the evidence and interventions its group eligibility is judged on.
 * No React here; the hook and components import these.
 */

export type SmeGroupRow = {
    key: string
    applicationId: string
    participantId?: string
    name: string
    email?: string
    photoUrl?: string
    stage?: string
    programName?: string
    group: IncubationGroup
    history: GroupHistoryEntry[]
    evidence: GroupEvidence[]
    interventions: GroupIntervention[]
    graduationApproved?: boolean
    lastReminderAt?: Date | null
    pendingMovement?: PendingGroupMovement | null
}

export const GROUPS: IncubationGroup[] = ['A', 'B', 'C', 'Graduated']
export const groupColors: Record<IncubationGroup, string> = {
    A: 'red', B: 'gold', C: 'blue', Graduated: 'green'
}

/** Where an SME is in the ROM → M&E movement workflow. */
export type MovementState = 'ready' | 'awaiting' | 'needs-details' | 'complete'

export const MOVEMENT_META: Record<MovementState, { label: string; color: string }> = {
    ready: { label: 'Ready to move', color: 'success' },
    awaiting: { label: 'Awaiting M&E', color: 'processing' },
    'needs-details': { label: 'Needs details', color: 'warning' },
    complete: { label: 'Complete', color: 'default' }
}

export const movementStateOf = (row: SmeGroupRow, eligibility: GroupEligibility): MovementState => {
    if (row.pendingMovement) return 'awaiting'
    if (!eligibility.target) return 'complete'
    return eligibility.eligible ? 'ready' : 'needs-details'
}

export const complianceStatusColor = (status: string) => {
    if (['valid', 'signed'].includes(status)) return 'green'
    if (status === 'expiring-soon') return 'orange'
    if (status === 'pending') return 'blue'
    return 'red'
}

export const outstandingReminderItems = (eligibility: GroupEligibility) => {
    const detailed = eligibility.requirements?.filter(item => !item.met) || []
    return detailed.length
        ? detailed.map(item =>
            `${item.title} — ${complianceStatusLabel(item.status)}: ${item.reason}`
        )
        : eligibility.missing
}

export const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const formatDateTime = (value: any, fallback = 'Not recorded') => {
    const date = toDate(value)
    return date ? dayjs(date).format('DD MMM YYYY HH:mm') : fallback
}

export const getName = (application: any, participant: any) =>
    participant?.beneficiaryName || participant?.name || application?.beneficiaryName ||
    application?.businessName || application?.participantName || application?.email || 'Unnamed SME'

export const getEmail = (application: any, participant: any) =>
    participant?.email || application?.email || application?.contactEmail || application?.ownerEmail

export async function resolveParticipant(application: any) {
    const participantId = application.participantId || application.participantDocId || application.incubateeId
    if (participantId) {
        const snapshot = await getDoc(doc(db, 'participants', participantId))
        if (snapshot.exists()) return { id: snapshot.id, data: snapshot.data() }
    }
    // email fallback until Phase 4 (docs/sme-identity-migration-plan.md)
    const email = application.email || application.contactEmail
    if (!email) return null
    const snapshot = await getDocs(query(
        collection(db, 'participants'),

        where('email', '==', email),
        limit(1)
    ))
    return snapshot.empty ? null : { id: snapshot.docs[0].id, data: snapshot.docs[0].data() }
}

// Re-reads an SME's documents and agreements just before M&E confirms a move,
// so anything rejected, replaced or countersign-revoked since the page loaded
// is caught rather than confirmed on the strength of a stale copy.
export async function withFreshEvidence(row: SmeGroupRow): Promise<SmeGroupRow> {
    const snapshot = await getDoc(doc(db, 'applications', row.applicationId))
    if (!snapshot.exists()) throw new Error('The accepted application no longer exists.')
    const application = { id: snapshot.id, ...(snapshot.data() as any) }
    const participant = await resolveParticipant(application)
    return { ...row, evidence: await loadEvidence(application, participant?.data || {}) }
}

const evidenceSlug = (item: any, fallback = '') =>
    String(item?.slug || item?.presetId || item?.preset || item?.key || item?.type || item?.documentName || item?.title || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

const looksLikeAgreementEvidence = (item: any) => {
    const rawType = String(item?.kind || item?.type || '').toLowerCase()
    const text = String(`${item?.agreementId || ''} ${item?.documentName || ''} ${item?.title || ''} ${item?.type || ''}`).toLowerCase()
    return rawType === 'agreement' || !!item?.agreementId ||
        text.includes('agreement') || text.includes('contract') ||
        text.includes('memorandum of agreement') || text.includes('gap analysis') ||
        text.includes('gap-analysis') || text.trim() === 'moa'
}

export async function loadEvidence(application: any, participant: any = {}): Promise<GroupEvidence[]> {
    // Same source the Compliance page reads: the participant's array when it
    // has entries, otherwise the application's.
    const flatSources: any[] = Array.isArray(participant.complianceDocuments) && participant.complianceDocuments.length
        ? participant.complianceDocuments
        : Array.isArray(application.complianceDocuments) ? application.complianceDocuments : []
    const flat = flatSources.map((item: any, index: number): GroupEvidence => {
        const agreement = looksLikeAgreementEvidence(item)
        const slug = evidenceSlug(item, `flat-${index}`)
        return {
            id: item.id || item.slug || item.presetId || item.key || slug || `flat-${index}`,
            title: item.title || item.documentName || item.name || item.type || slug || '',
            slug,
            presetId: item.presetId || item.preset,
            documentName: item.documentName || item.title || item.type,
            kind: agreement ? 'agreement' : 'upload',
            status: item.verificationStatus ?? item.status ?? item.verified ?? item.approved ??
                (agreement ? (isAgreementCountersigned(item) ? 'valid' : 'pending') : undefined),
            signed: item.signed === true || item.participantSigned === true || item.smmeSigned === true,
            expiryDate: item.expiryDate,
            raw: item
        }
    })

    const [uploadsSnapshot, agreementsSnapshot] = await Promise.all([
        getDocs(collection(db, 'applications', application.id, 'complianceDocuments')),
        getDocs(collection(db, 'applications', application.id, 'agreements'))
    ])
    const uploads: GroupEvidence[] = uploadsSnapshot.docs.map(snapshot => {
        const item = snapshot.data() as any
        return {
            id: snapshot.id,
            title: item.title || item.documentName || item.name || item.type || snapshot.id,
            slug: evidenceSlug(item, snapshot.id),
            presetId: item.presetId || item.preset,
            documentName: item.documentName || item.title || item.type,
            kind: looksLikeAgreementEvidence(item) ? 'agreement' : 'upload',
            status: item.verificationStatus ?? item.status ?? item.verified ?? item.approved,
            expiryDate: item.expiryDate,
            raw: item
        }
    })
    const agreements: GroupEvidence[] = agreementsSnapshot.docs.map(snapshot => {
        const item = snapshot.data() as any
        return {
            id: snapshot.id,
            slug: evidenceSlug({ ...item, slug: snapshot.id }, snapshot.id),
            title: item.title || snapshot.id,
            documentName: item.title || snapshot.id,
            kind: 'agreement',
            status: isAgreementCountersigned(item) ? 'valid' : 'pending',
            signed: item.signed === true || item.smmeSigned === true || item.participantSigned === true,
            raw: { ...item, slug: snapshot.id }
        }
    })
    Object.entries({ ...(participant.signedAgreements || {}), ...(application.signedAgreements || {}) }).forEach(([slug, raw]: [string, any]) => {
        agreements.push({
            id: slug,
            slug: evidenceSlug({ ...(raw || {}), slug }, slug),
            title: raw?.title || slug,
            documentName: raw?.title || slug,
            kind: 'agreement',
            status: isAgreementCountersigned(raw) ? 'valid' : 'pending',
            signed: raw === true || raw?.signed === true || raw?.smmeSigned === true || raw?.participantSigned === true,
            raw: raw === true ? { slug, signed: true } : { ...(raw || {}), slug }
        })
    })
    if (application.gapAnalysisStatus === 'Completed' || application.gapSubmittedAt) {
        agreements.push({
            id: 'gap-analysis',
            agreementId: 'gap-analysis',
            slug: 'gap-analysis',
            title: 'Gap Analysis',
            documentName: 'Gap Analysis',
            kind: 'agreement',
            status: 'valid',
            signed: true,
            raw: { agreementId: 'gap-analysis', signed: true }
        })
    }

    const canonical = new Map<string, GroupEvidence>()
        ;[...flat, ...uploads, ...agreements].forEach(item => {
            const kind = item.kind === 'agreement' ? 'agreement' : 'upload'
            const id = kind === 'agreement'
                ? canonicalAgreementId(item.agreementId || item.slug || item.id || item.title)
                : evidenceSlug(item, item.id)
            if (id) canonical.set(`${kind}:${id}`, item)
        })
    return Array.from(canonical.values())
}

export async function loadInterventions(participantId: string | undefined, applicationId: string, programId: string) {
    const lookupField = participantId ? 'participantId' : 'applicationId'
    const lookupValue = participantId || applicationId
    const snapshot = await getDocs(query(
        collection(db, 'assignedInterventions'),
        where(lookupField, '==', lookupValue)
    ))
    const { departments } = await loadDepartmentRoles()
    return snapshot.docs
        .map(item => ({ id: item.id, ...(item.data() as any) }))
        .filter((item: any) => !item.programId || item.programId === programId)
        .map((item: any): GroupIntervention => ({
            id: item.id,
            title: item.interventionTitle,
            status: item.assignmentStatus,
            smeName: item.beneficiaryName || item.participantName || item.smeName || item.smmeName,
            facilitatorName: item.assigneeName || item.facilitatorName || item.assignedToName,
            departmentName: departmentNameOf(item.departmentId, departments, ''),
            participantAcceptanceStatus: item.participantAcceptanceStatus,
            assigneeAcceptanceStatus: item.assigneeAcceptanceStatus,
            participantCompletionStatus: item.participantCompletionStatus,
            assigneeCompletionStatus: item.assigneeCompletionStatus,
            movStatus: item.movStatus,
            movApproved: item.movApproved === true || String(item.movStatus || '').toLowerCase() === 'approved',
            departmentConfirmed: item.departmentConfirmed,
            proofValidated: item.proofValidated
        }))
}
