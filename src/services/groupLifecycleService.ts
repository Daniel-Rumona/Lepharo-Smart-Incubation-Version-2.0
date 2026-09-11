import { auth, db, functions } from '@/firebase'
import {
    arrayUnion,
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    runTransaction,
    updateDoc,
    where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { isIncubateeAgreementSigned } from '@/utils/agreementStatus'
import {
    canonicalAgreementId,
    complianceStatusCountsAsCovered,
    resolveComplianceDocumentStatus
} from '@/services/complianceResolver'

export type IncubationGroup = 'A' | 'B' | 'C' | 'Graduated'

export type GroupHistoryEntry = {
    from: IncubationGroup | null
    to: IncubationGroup
    date: string
    by: string
    reason: string
    docs: string[]
    requirementsMet: string[]
}

export type PendingGroupMovement = {
    id: string
    from: IncubationGroup
    to: IncubationGroup
    status: 'pending_me_confirmation'
    requestedAt: string
    requestedBy: string
    requestedByEmail?: string
    requestedByDepartment?: string
    reason: string
    requirementsMet: string[]
    batchId?: string
}

export type GroupRequirement = {
    id: string
    title: string
    kind: 'upload' | 'agreement'
    agreementId?: string
}

export type GroupEvidence = {
    id?: string
    agreementId?: string
    title: string
    slug?: string
    presetId?: string
    documentName?: string
    kind?: 'upload' | 'agreement'
    raw?: any
    status?: string | boolean
    signed?: boolean
    expiryDate?: unknown
}

export type GroupIntervention = {
    id: string
    title?: string
    status?: string
    smeName?: string
    facilitatorName?: string
    departmentName?: string
    userStatus?: string
    consultantStatus?: string
    userCompletionStatus?: string
    consultantCompletionStatus?: string
    movStatus?: string
    movApproved?: boolean
    departmentConfirmed?: boolean
    proofValidated?: boolean
}

export type GroupProgressionRules = {
    minimumCompletedInterventions?: number
    requireAllAssignedInterventionsClosed?: boolean
    requireGraduationApproval?: boolean
}

export type GroupEligibility = {
    current: IncubationGroup
    target: IncubationGroup | null
    eligible: boolean
    progress: number
    met: string[]
    missing: string[]
    requirements?: GroupRequirementResult[]
    summary: string
}

export type GroupRequirementResult = {
    id: string
    title: string
    kind: 'upload' | 'agreement'
    status: string
    met: boolean
    reason: string
}

const clean = (value: unknown) => String(value ?? '').trim()

export const normalizeGroup = (value: unknown): IncubationGroup => {
    const normalized = clean(value).toLowerCase().replace(/^group\s+/, '')
    if (normalized === 'b') return 'B'
    if (normalized === 'c') return 'C'
    if (['graduated', 'post-incubation', 'post incubation'].includes(normalized)) return 'Graduated'
    return 'A'
}

export const groupLabel = (group: IncubationGroup) =>
    group === 'Graduated' ? 'Graduated' : `Group ${group}`

const normalizedDepartment = (value: unknown) => clean(value).toLowerCase()

export const isRomDepartment = (value: unknown) => {
    const department = normalizedDepartment(value)
    return department === 'rom' || department.startsWith('rom ') ||
        department.includes('recruitment, onboarding and maintenance')
}

export const isMonitoringAndEvaluationDepartment = (value: unknown) => {
    const department = normalizedDepartment(value).replace(/\s+/g, ' ')
    return department === 'm&e' || department.startsWith('m&e ') ||
        department.includes('monitoring and evaluation') ||
        department.includes('monitoring & evaluation')
}

type WorkflowDepartment = 'rom' | 'me'

async function resolveWorkflowRecipients(department: WorkflowDepartment) {
    const departmentSnapshot = await getDocs(query(
        collection(db, 'departments'),

    ))
    const matchingDepartmentIds = new Set(departmentSnapshot.docs
        .filter(snapshot => department === 'rom'
            ? isRomDepartment(snapshot.data().name || snapshot.data().departmentName)
            : isMonitoringAndEvaluationDepartment(snapshot.data().name || snapshot.data().departmentName))
        .map(snapshot => snapshot.id))
    departmentSnapshot.docs.forEach(snapshot => {
        const parentId = clean(snapshot.data().parentDepartmentId || snapshot.data().parentDeptId)
        if (parentId && matchingDepartmentIds.has(parentId)) matchingDepartmentIds.add(snapshot.id)
    })
    const usersSnapshot = await getDocs(query(
        collection(db, 'users'),

    ))
    return Array.from(new Set(usersSnapshot.docs
        .map(snapshot => snapshot.data() as any)
        .filter(user => {
            const nameMatches = department === 'rom'
                ? isRomDepartment(user.departmentName || user.department)
                : isMonitoringAndEvaluationDepartment(user.departmentName || user.department)
            return nameMatches || matchingDepartmentIds.has(clean(user.departmentId))
        })
        .map(user => clean(user.email).toLowerCase())
        .filter(Boolean)))
}

const escapeHtml = (value: unknown) => clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

async function sendWorkflowEmail(input: {
    to: string | string[]
    subject: string
    heading: string
    paragraphs: string[]
    items?: string[]
}) {
    if (!auth.currentUser) throw new Error('You must be logged in to send workflow emails.')
    const recipients = (Array.isArray(input.to) ? input.to : [input.to]).filter(Boolean)
    if (!recipients.length) return 0
    const token = await auth.currentUser.getIdToken()
    const items = input.items || []
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:680px;margin:auto">
        <h2 style="color:#1457a6">${escapeHtml(input.heading)}</h2>
        ${input.paragraphs.map(value => `<p>${escapeHtml(value)}</p>`).join('')}
        ${items.length ? `<ul>${items.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : ''}
        <p>Regards,<br/>Lepharo Smart Incubator</p>
    </div>`
    const text = [input.heading, '', ...input.paragraphs, ...(items.length ? ['', ...items.map(item => `- ${item}`)] : []), '', 'Regards,', 'Lepharo Smart Incubator'].join('\n')
    const endpoint = typeof window !== 'undefined' && window.location.hostname.includes('localhost')
        ? 'https://us-central1-lph-smart-inc.cloudfunctions.net/sendEmail'
        : 'https://oauth.lepharosmartinc.co.za/sendEmail'
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: recipients, subject: input.subject, html, text })
    })
    if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(detail || 'The workflow email could not be sent.')
    }
    return recipients.length
}

export async function notifyRomSmeReady(input: {
    applicationId: string

    smeName: string
    programName?: string
    current: IncubationGroup
    target: IncubationGroup
    requirementsMet: string[]
}) {
    const notificationKey = `groupWorkflowNotifications.readyFor${input.target}`
    const claimed = await runTransaction(db, async transaction => {
        const applicationRef = doc(db, 'applications', input.applicationId)
        const snapshot = await transaction.get(applicationRef)
        if (!snapshot.exists()) return false
        const existing = snapshot.data()?.groupWorkflowNotifications?.[`readyFor${input.target}`]
        // Every readiness event is claimed once. Failed/no-recipient outcomes remain
        // visible for manual follow-up instead of causing an email retry loop.
        if (existing?.status) return false
        transaction.update(applicationRef, {
            [notificationKey]: { status: 'sending', claimedAt: new Date().toISOString() }
        })
        return true
    })
    if (!claimed) return { sent: 0, skipped: true }
    try {
        const recipients = await resolveWorkflowRecipients('rom')
        const sent = await sendWorkflowEmail({
            to: recipients,
            subject: `${input.smeName} is ready for ${groupLabel(input.target)}`,
            heading: 'SME ready for group movement',
            paragraphs: [
                `${input.smeName} has met the requirements to progress from ${groupLabel(input.current)} to ${groupLabel(input.target)}.`,
                `Program: ${input.programName || 'Active incubation programme'}. ROM can review and submit the movement to M&E.`
            ],
            items: input.requirementsMet
        })
        await updateDoc(doc(db, 'applications', input.applicationId), {
            [notificationKey]: { status: sent ? 'sent' : 'no_recipients', sentAt: new Date().toISOString(), recipients: sent }
        })
        return { sent, skipped: false }
    } catch (error: any) {
        await updateDoc(doc(db, 'applications', input.applicationId), {
            [notificationKey]: { status: 'failed', failedAt: new Date().toISOString(), error: clean(error?.message || error) }
        }).catch(() => undefined)
        return { sent: 0, skipped: false, error: clean(error?.message || error) }
    }
}

export const resolveApplicationGroup = (application: any, participant?: any): IncubationGroup => {
    const direct =
        application?.gapGroup ||
        application?.group ||
        application?.currentGroup ||
        participant?.gapGroup ||
        participant?.group ||
        participant?.currentGroup
    if (clean(direct)) return normalizeGroup(direct)

    const history = [
        ...(Array.isArray(participant?.groupHistory) ? participant.groupHistory : []),
        ...(Array.isArray(application?.groupHistory) ? application.groupHistory : [])
    ]
        .filter(item => item?.to)
        .sort((a, b) => new Date(a.date || a.at || 0).getTime() - new Date(b.date || b.at || 0).getTime())
    return history.length ? normalizeGroup(history[history.length - 1].to) : 'A'
}

const normalizeKey = (value: unknown) =>
    clean(value)
        .toLowerCase()
        .replace(/\(signed\)/g, '')
        .replace(/\b(docs|documents)\b/g, 'document')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()

export function buildGroupRequirements(programRequirements: any[] = []): GroupRequirement[] {
    return programRequirements
        .filter(requirement => requirement && requirement.required !== false && clean(requirement.title || requirement.name))
        .map((requirement, index) => {
            const preset = clean(requirement.preset || requirement.key || requirement.presetId).toUpperCase()
            const title = clean(requirement.title || requirement.name)
            const inferredId = canonicalAgreementId(requirement.agreementId || preset || title)
            const agreementId = ['gap-analysis', 'pre-incubation-contract', 'moa'].includes(inferredId)
                ? inferredId
                : clean(requirement.agreementId) || undefined
            const kind: GroupRequirement['kind'] =
                requirement.type === 'agreement' || requirement.kind === 'agreement' || !!agreementId
                    ? 'agreement'
                    : 'upload'
            return {
                id: clean(requirement.id || requirement.key || requirement.presetId || agreementId) || `${normalizeKey(title)}-${index}`,
                title,
                kind,
                agreementId
            }
        })
}

function asDate(value: any): Date | null {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    if (value?.seconds) return new Date(value.seconds * 1000)
    return null
}

function evidenceMatches(requirement: GroupRequirement, evidence: GroupEvidence) {
    const requirementKeys = [requirement.id, requirement.title, requirement.agreementId]
        .map(normalizeKey)
        .filter(Boolean)
    const evidenceKeys = [
        evidence.id,
        evidence.agreementId,
        evidence.title,
        evidence.slug,
        evidence.presetId,
        evidence.documentName,
        evidence.raw?.slug,
        evidence.raw?.presetId,
        evidence.raw?.preset,
        evidence.raw?.key,
        evidence.raw?.type,
        evidence.raw?.documentName,
        evidence.raw?.title
    ].map(normalizeKey).filter(Boolean)
    if (requirement.kind === 'agreement') {
        const requiredSlug = canonicalAgreementId(requirement.agreementId || requirement.id || requirement.title)
        return evidenceKeys.some(key => canonicalAgreementId(key) === requiredSlug)
    }
    return requirementKeys.some(req =>
        evidenceKeys.some(ev => ev === req || ev.includes(req) || req.includes(ev))
    )
}

function evidenceIsValid(requirement: GroupRequirement, evidence: GroupEvidence) {
    if (requirement.kind === 'agreement') {
        const status = normalizeKey(evidence.status)
        return evidence.signed === true ||
            ['approved', 'verified', 'valid', 'accepted'].includes(status) ||
            isIncubateeAgreementSigned(evidence.raw ?? evidence, requirement.agreementId || requirement.id || requirement.title)
    }
    if (evidence.status === true) {
        const expiry = asDate(evidence.expiryDate)
        return !expiry || expiry.getTime() > Date.now()
    }
    return complianceStatusCountsAsCovered(
        resolveComplianceDocumentStatus(evidence, evidence.expiryDate)
    )
}

function evidenceStatus(requirement: GroupRequirement, evidence?: GroupEvidence) {
    if (!evidence) return 'missing'
    if (requirement.kind === 'agreement') {
        if (evidenceIsValid(requirement, evidence)) return 'signed'
        const storedStatus = normalizeKey(evidence.status)
        if (['invalid', 'rejected', 'queried'].includes(storedStatus)) return storedStatus
        return 'pending'
    }
    if (evidence.status === true) {
        const expiry = asDate(evidence.expiryDate)
        if (expiry && expiry.getTime() < Date.now()) return 'expired'
        return resolveComplianceDocumentStatus(
            { ...evidence, status: 'valid' },
            evidence.expiryDate
        )
    }
    return resolveComplianceDocumentStatus(evidence, evidence.expiryDate)
}

function evidenceReason(
    requirement: GroupRequirement,
    evidence: GroupEvidence | undefined,
    status: string
) {
    if (!evidence) {
        return requirement.kind === 'agreement'
            ? 'This agreement has not been signed.'
            : 'This document has not been uploaded.'
    }
    const expiry = asDate(evidence.expiryDate)
    const expiryLabel = expiry
        ? expiry.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
        : ''
    const queryReason = clean(evidence.raw?.queryReason || evidence.raw?.reason)
    if (status === 'signed') return 'The agreement has a completed SME signature.'
    if (status === 'valid') return expiryLabel ? `Verified and valid until ${expiryLabel}.` : 'Verified and valid.'
    if (status === 'expiring-soon') return `Verified, but expires soon on ${expiryLabel}.`
    if (status === 'expired') return expiryLabel ? `The uploaded document expired on ${expiryLabel}.` : 'The uploaded document has expired.'
    if (status === 'pending') {
        return requirement.kind === 'agreement'
            ? 'An agreement record exists, but the SME signature is not complete.'
            : 'The document is uploaded and awaiting verification.'
    }
    if (status === 'queried') return queryReason
        ? `A correction was requested: ${queryReason}`
        : 'A correction query is open on this document.'
    if (status === 'invalid' || status === 'rejected') return queryReason
        ? `The document was marked ${status}: ${queryReason}`
        : `The document was marked ${status}.`
    return requirement.kind === 'agreement'
        ? 'This agreement is not yet complete.'
        : `This document is currently marked ${status}.`
}

const interventionClosed = (intervention: GroupIntervention) => {
    const status = normalizeKey(intervention.status)
    const completed = status.includes('complete') || status === 'done' || status === 'closed'
    const evidenceApproved =
        intervention.movApproved === true ||
        intervention.departmentConfirmed === true ||
        intervention.proofValidated === true
    return completed && evidenceApproved
}

const interventionIsCompleted = (intervention: GroupIntervention) => {
    const status = normalizeKey(intervention.status)
    return status.includes('complete') || status === 'done' || status === 'closed'
}

const interventionTitleList = (interventions: GroupIntervention[], fallback: string) => {
    const titles = interventions
        .map(intervention => clean(intervention.title))
        .filter(Boolean)
        .slice(0, 3)
    const unnamed = interventions.filter(intervention => !clean(intervention.title)).length
    const extra = interventions.length - titles.length - unnamed
    const parts: string[] = []
    if (titles.length) parts.push(`${titles.join(', ')}${extra > 0 ? ` and ${extra} more` : ''}`)
    if (unnamed) {
        parts.push(`${unnamed} assigned intervention record${unnamed === 1 ? '' : 's'} missing interventionTitle`)
    }
    return parts.length ? parts.join('; ') : fallback
}

const acceptanceState = (value: unknown): 'accepted' | 'declined' | 'pending' => {
    const state = normalizeKey(value)
    if (state === 'accepted' || state === 'confirmed') return 'accepted'
    if (state === 'declined' || state === 'rejected') return 'declined'
    return 'pending'
}

const completionState = (value: unknown): 'done' | 'rejected' | 'pending' => {
    const state = normalizeKey(value)
    if (state === 'done' || state === 'completed' || state === 'confirmed' || state === 'accepted') return 'done'
    if (state === 'declined' || state === 'rejected') return 'rejected'
    return 'pending'
}

const groupByReason = (interventions: GroupIntervention[], reasonFor: (intervention: GroupIntervention) => string) => {
    const buckets = new Map<string, GroupIntervention[]>()
    interventions.forEach(intervention => {
        const reason = reasonFor(intervention)
        buckets.set(reason, [...(buckets.get(reason) || []), intervention])
    })
    return Array.from(buckets.entries())
        .map(([reason, items]) => `${reason}: ${interventionTitleList(items, 'assigned intervention records missing interventionTitle')}`)
        .join(' | ')
}

const named = (role: string, name?: string) => clean(name) ? `${role} ${clean(name)}` : role

const closureHoldUpReason = (intervention: GroupIntervention) => {
    const consultantAcceptance = acceptanceState(intervention.consultantStatus)
    const smeAcceptance = acceptanceState(intervention.userStatus)
    const consultantCompletion = completionState(intervention.consultantCompletionStatus)
    const smeCompletion = completionState(intervention.userCompletionStatus)
    const status = clean(intervention.status) || 'no assignment status captured'

    if (consultantAcceptance === 'declined') return 'facilitator declined'
    if (smeAcceptance === 'pending') return `waiting on ${named('SME', intervention.smeName)} acceptance`
    if (smeAcceptance === 'declined') return 'SME declined'
    if (consultantCompletion === 'pending') return `waiting on ${named('facilitator', intervention.facilitatorName)} delivery/closure`
    if (consultantCompletion === 'rejected') return 'facilitator completion was rejected'
    if (consultantCompletion === 'done' && smeCompletion === 'pending') return `waiting on ${named('SME', intervention.smeName)} completion confirmation`
    if (smeCompletion === 'rejected') return 'SME completion confirmation was rejected'
    return `assignment status is ${status}`
}

const movHoldUpReason = (intervention: GroupIntervention) => {
    const movStatus = clean(intervention.movStatus)
    if (intervention.proofValidated === false) return 'proof/MOV was invalidated and needs correction'
    if (intervention.departmentConfirmed === false) return `waiting on ${named('department', intervention.departmentName)} confirmation`
    if (movStatus) return `waiting on MOV approval (${movStatus})`
    if (intervention.proofValidated !== true) return 'waiting on proof/MOV review'
    if (intervention.departmentConfirmed !== true) return `waiting on ${named('department', intervention.departmentName)} confirmation`
    return 'waiting on MOV approval'
}

export function evaluateGroupEligibility(input: {
    current: IncubationGroup
    requirements?: GroupRequirement[]
    evidence?: GroupEvidence[]
    interventions?: GroupIntervention[]
    rules?: GroupProgressionRules
    graduationApproved?: boolean
}): GroupEligibility {
    const requirements = input.requirements || []
    const evidence = input.evidence || []
    const interventions = input.interventions || []
    const rules = input.rules || {}

    if (input.current === 'A') {
        if (!requirements.length) {
            return {
                current: 'A', target: 'B', eligible: false, progress: 0, met: [],
                missing: ['The program has no Group A progression requirements configured.'],
                summary: 'Program requirements must be configured before this SME can move to Group B.'
            }
        }
        const met: string[] = []
        const missing: string[] = []
        const requirementResults = requirements.map(requirement => {
            const matches = evidence.filter(item => evidenceMatches(requirement, item))
            const validMatch = matches.find(item => evidenceIsValid(requirement, item))
            const match = validMatch || matches[0]
            const status = evidenceStatus(requirement, match)
            const result = {
                id: requirement.id,
                title: requirement.title,
                kind: requirement.kind,
                status,
                met: Boolean(validMatch),
                reason: evidenceReason(requirement, match, status)
            }
            ;(result.met ? met : missing).push(requirement.title)
            return result
        })
        const progress = Math.round((met.length / requirements.length) * 100)
        return {
            current: 'A', target: 'B', eligible: missing.length === 0, progress, met, missing,
            requirements: requirementResults,
            summary: missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} still outstanding.` : 'All Group B entry requirements are complete.'
        }
    }

    if (input.current === 'B') {
        const minimum = Math.max(1, Number(rules.minimumCompletedInterventions ?? 3))
        const closed = interventions.filter(interventionClosed)
        const notClosed = interventions.filter(item => !interventionIsCompleted(item))
        const awaitingMovApproval = interventions.filter(item =>
            interventionIsCompleted(item) && !interventionClosed(item)
        )
        const pending = [...notClosed, ...awaitingMovApproval]
        const met: string[] = []
        const missing: string[] = []
        if (closed.length >= minimum) met.push(`${closed.length} completed interventions with approved evidence`)
        else missing.push(`${minimum - closed.length} more completed intervention${minimum - closed.length === 1 ? '' : 's'} with approved MOV evidence`)
        if (rules.requireAllAssignedInterventionsClosed !== false && pending.length) {
            if (notClosed.length) {
                missing.push(`${notClosed.length} assigned intervention${notClosed.length === 1 ? ' is' : 's are'} not closed/completed — ${groupByReason(notClosed, closureHoldUpReason)}`)
            }
            if (awaitingMovApproval.length) {
                missing.push(`${awaitingMovApproval.length} completed intervention${awaitingMovApproval.length === 1 ? ' is' : 's are'} awaiting MOV/proof approval — ${groupByReason(awaitingMovApproval, movHoldUpReason)}`)
            }
        } else if (interventions.length) {
            met.push('All assigned interventions are closed')
        }
        const completedProgress = Math.min(100, Math.round((closed.length / minimum) * 100))
        const progress = pending.length && rules.requireAllAssignedInterventionsClosed !== false
            ? Math.min(99, completedProgress)
            : completedProgress
        return {
            current: 'B', target: 'C', eligible: missing.length === 0, progress, met, missing,
            summary: missing.length ? `${missing.length} Group C progression condition${missing.length === 1 ? '' : 's'} outstanding.` : 'The SME is ready to move to Group C.'
        }
    }

    if (input.current === 'C') {
        const approved = input.graduationApproved === true
        return {
            current: 'C', target: 'Graduated', eligible: approved, progress: approved ? 100 : 0,
            met: approved ? ['Graduation approved by ROM'] : [],
            missing: approved ? [] : ['ROM graduation approval'],
            summary: approved ? 'The SME is ready to graduate.' : 'Graduation requires an explicit ROM approval.'
        }
    }

    return {
        current: 'Graduated', target: null, eligible: false, progress: 100,
        met: ['Incubation completed'], missing: [], summary: 'This SME has completed the incubation journey.'
    }
}

export async function requestSmeGroupMovement(input: {
    applicationId: string
    participantId?: string
    current: IncubationGroup
    target: IncubationGroup
    actor: { id?: string; name: string; email?: string; departmentName?: string }
    reason: string
    requirementsMet: string[]

    smeName: string
    programName?: string
    batchId?: string
    suppressNotification?: boolean
}) {
    if (!input.applicationId) throw new Error('An application is required before a group movement can be requested.')
    if (!isRomDepartment(input.actor.departmentName)) throw new Error('Only the ROM department can submit an SME group movement.')
    const expectedTarget: Record<IncubationGroup, IncubationGroup | null> = {
        A: 'B', B: 'C', C: 'Graduated', Graduated: null
    }
    if (expectedTarget[input.current] !== input.target) throw new Error('Groups can only move forward one stage at a time.')

    const request: PendingGroupMovement = {
        id: `${input.applicationId}-${Date.now()}`,
        from: input.current,
        to: input.target,
        status: 'pending_me_confirmation',
        requestedAt: new Date().toISOString(),
        requestedBy: input.actor.name,
        requestedByEmail: input.actor.email,
        requestedByDepartment: input.actor.departmentName,
        reason: input.reason,
        requirementsMet: input.requirementsMet,
        ...(input.batchId ? { batchId: input.batchId } : {})
    }
    await runTransaction(db, async transaction => {
        const applicationRef = doc(db, 'applications', input.applicationId)
        const snapshot = await transaction.get(applicationRef)
        if (!snapshot.exists()) throw new Error('The accepted application no longer exists.')
        const data = snapshot.data() as any
        if (data.pendingGroupMovement?.status === 'pending_me_confirmation') {
            throw new Error('This SME already has a group movement awaiting M&E confirmation.')
        }
        const storedGroup = resolveApplicationGroup(data)
        if (storedGroup !== input.current) throw new Error('The SME group changed while this page was open. Refresh and try again.')
        transaction.update(applicationRef, {
            pendingGroupMovement: request,
            groupMovementRequestHistory: arrayUnion({ ...request, event: 'requested' }),
            groupMovementRequestedAt: serverTimestamp()
        })
    })
    let notificationSent = 0
    let notificationError: string | undefined
    if (input.suppressNotification) {
        return { request, notificationSent, notificationError }
    }
    try {
        const recipients = await resolveWorkflowRecipients('me')
        notificationSent = await sendWorkflowEmail({
            to: recipients,
            subject: `M&E approval required: ${input.smeName} to ${groupLabel(input.target)}`,
            heading: 'Group movement awaiting M&E confirmation',
            paragraphs: [
                `ROM submitted ${input.smeName} for movement from ${groupLabel(input.current)} to ${groupLabel(input.target)}.`,
                `Program: ${input.programName || 'Active incubation programme'}. Please review and either confirm the movement or return it to ROM.`
            ],
            items: input.requirementsMet
        })
        await updateDoc(doc(db, 'applications', input.applicationId), {
            'groupWorkflowNotifications.meApproval': {
                status: notificationSent ? 'sent' : 'no_recipients',
                requestId: request.id,
                sentAt: new Date().toISOString(),
                recipients: notificationSent
            }
        })
    } catch (error: any) {
        notificationError = clean(error?.message || error)
        await updateDoc(doc(db, 'applications', input.applicationId), {
            'groupWorkflowNotifications.meApproval': {
                status: 'failed', requestId: request.id,
                failedAt: new Date().toISOString(), error: notificationError
            }
        }).catch(() => undefined)
    }
    return { request, notificationSent, notificationError }
}

export async function notifyMeGroupMovementBatch(input: {

    batchId: string
    programName?: string
    submittedBy: string
    movements: Array<{
        applicationId: string
        requestId: string
        smeName: string
        current: IncubationGroup
        target: IncubationGroup
    }>
}) {
    if (!input.movements.length) return { notificationSent: 0 }
    const recipients = await resolveWorkflowRecipients('me')
    const notificationSent = await sendWorkflowEmail({
        to: recipients,
        subject: `M&E approval required: ${input.movements.length} group movements`,
        heading: 'Group movements awaiting M&E confirmation',
        paragraphs: [
            `${input.submittedBy} submitted ${input.movements.length} SME group movement request${input.movements.length === 1 ? '' : 's'}.`,
            `Program: ${input.programName || 'Active incubation programme'}. Open Group History to confirm or return the requests.`
        ],
        items: input.movements.map(item =>
            `${item.smeName}: ${groupLabel(item.current)} to ${groupLabel(item.target)}`
        )
    })
    const sentAt = new Date().toISOString()
    await Promise.all(input.movements.map(item => updateDoc(
        doc(db, 'applications', item.applicationId),
        {
            'groupWorkflowNotifications.meApproval': {
                status: notificationSent ? 'sent' : 'no_recipients',
                requestId: item.requestId,
                batchId: input.batchId,
                sentAt,
                recipients: notificationSent
            }
        }
    )))
    return { notificationSent }
}

export async function confirmSmeGroupMovement(input: {
    applicationId: string
    participantId?: string
    request: PendingGroupMovement
    actor: { id?: string; name: string; email?: string; departmentName?: string }
    smeName: string
    smeEmail?: string
    programName?: string
    nextRequirements: string[]
}) {
    if (!isMonitoringAndEvaluationDepartment(input.actor.departmentName)) {
        throw new Error('Only the M&E department can confirm an SME group movement.')
    }
    const entry: GroupHistoryEntry = {
        from: input.request.from,
        to: input.request.to,
        date: new Date().toISOString(),
        by: input.actor.name,
        reason: input.request.reason,
        docs: input.request.requirementsMet,
        requirementsMet: input.request.requirementsMet
    }
    await runTransaction(db, async transaction => {
        const applicationRef = doc(db, 'applications', input.applicationId)
        const snapshot = await transaction.get(applicationRef)
        if (!snapshot.exists()) throw new Error('The accepted application no longer exists.')
        const data = snapshot.data() as any
        const pending = data.pendingGroupMovement as PendingGroupMovement | undefined
        if (!pending || pending.id !== input.request.id || pending.status !== 'pending_me_confirmation') {
            throw new Error('This movement request is no longer pending.')
        }
        if (resolveApplicationGroup(data) !== pending.from) {
            throw new Error('The SME group changed after ROM submitted this request.')
        }
        const confirmedRequest = {
            ...pending,
            status: 'confirmed',
            confirmedAt: entry.date,
            confirmedBy: input.actor.name,
            confirmedByEmail: input.actor.email || null
        }
        const patch = {
            gapGroup: pending.to,
            group: pending.to,
            currentGroup: pending.to,
            pendingGroupMovement: null,
            groupHistory: arrayUnion(entry),
            groupMovementRequestHistory: arrayUnion(confirmedRequest),
            groupUpdatedAt: serverTimestamp(),
            groupUpdatedBy: input.actor.email || input.actor.id || input.actor.name
        }
        transaction.update(applicationRef, patch)
        if (input.participantId && !input.participantId.startsWith('app:')) {
            transaction.update(doc(db, 'participants', input.participantId), patch)
        }
    })
    let notificationSent = false
    let notificationError: string | undefined
    if (input.smeEmail) {
        try {
            await sendWorkflowEmail({
                to: input.smeEmail,
                subject: `Congratulations — you have moved to ${groupLabel(input.request.to)}`,
                heading: `Congratulations, ${input.smeName}!`,
                paragraphs: [
                    `M&E has confirmed your movement from ${groupLabel(input.request.from)} to ${groupLabel(input.request.to)}.`,
                    input.request.to === 'Graduated'
                        ? 'You have completed the incubation journey. Aftercare and market-linkage support may continue through your programme.'
                        : `To advance beyond ${groupLabel(input.request.to)}, focus on the requirements below.`
                ],
                items: input.nextRequirements
            })
            notificationSent = true
            await updateDoc(doc(db, 'applications', input.applicationId), {
                [`groupWorkflowNotifications.movedTo${input.request.to}`]: {
                    status: 'sent', sentAt: new Date().toISOString(), email: input.smeEmail
                }
            })
        } catch (error: any) {
            notificationError = clean(error?.message || error)
            await updateDoc(doc(db, 'applications', input.applicationId), {
                [`groupWorkflowNotifications.movedTo${input.request.to}`]: {
                    status: 'failed', failedAt: new Date().toISOString(), error: notificationError
                }
            }).catch(() => undefined)
        }
    }
    return { entry, notificationSent, notificationError }
}

export async function returnSmeGroupMovement(input: {
    applicationId: string
    request: PendingGroupMovement
    actor: { id?: string; name: string; email?: string; departmentName?: string }
    reason?: string
}) {
    if (!isMonitoringAndEvaluationDepartment(input.actor.departmentName)) {
        throw new Error('Only the M&E department can return an SME group movement to ROM.')
    }
    await runTransaction(db, async transaction => {
        const applicationRef = doc(db, 'applications', input.applicationId)
        const snapshot = await transaction.get(applicationRef)
        if (!snapshot.exists()) throw new Error('The accepted application no longer exists.')
        const pending = snapshot.data().pendingGroupMovement as PendingGroupMovement | undefined
        if (!pending || pending.id !== input.request.id) throw new Error('This movement request is no longer pending.')
        transaction.update(applicationRef, {
            pendingGroupMovement: null,
            groupMovementRequestHistory: arrayUnion({
                ...pending,
                status: 'returned',
                returnedAt: new Date().toISOString(),
                returnedBy: input.actor.name,
                returnedByEmail: input.actor.email || null,
                returnReason: input.reason || 'Returned to ROM for review'
            })
        })
    })
}

export async function sendGroupDetailsReminder(input: {
    applicationId: string
    participantId?: string
    email: string
    name: string
    programName?: string
    current: IncubationGroup
    target: IncubationGroup
    missing: string[]
    sentBy?: string
}) {
    if (!auth.currentUser) throw new Error('You must be logged in to send a reminder.')
    if (!input.email) throw new Error('This SME has no email address on record.')
    if (!input.missing.length) throw new Error('There are no outstanding details to request.')

    const reminderId = `${input.applicationId}-${Date.now()}`
    const baseLog = {
        id: reminderId,
        type: 'group-progression-details',
        currentGroup: input.current,
        targetGroup: input.target,
        missing: input.missing,
        sentBy: input.sentBy || auth.currentUser.email || auth.currentUser.uid,
        createdAt: new Date().toISOString()
    }
    try {
        const sendReminder = httpsCallable(functions, 'sendComplianceReminderEmail')
        await sendReminder({
            email: input.email,
            name: input.name,
            programName: input.programName || 'your incubation programme',
            issues: [
                `To progress from ${groupLabel(input.current)} to ${groupLabel(input.target)}, please provide or complete:`,
                ...input.missing
            ],
            reminderType: 'group-progression',
            currentGroup: input.current,
            targetGroup: input.target,
            applicationId: input.applicationId,
            participantId: input.participantId || null
        })
        await updateDoc(doc(db, 'applications', input.applicationId), {
            groupReminder: {
                status: 'sent',
                currentGroup: input.current,
                targetGroup: input.target,
                missing: input.missing,
                lastSentAt: serverTimestamp(),
                lastSentBy: input.sentBy || auth.currentUser.email || auth.currentUser.uid,
                reminderId
            },
            groupReminderHistory: arrayUnion({ ...baseLog, status: 'sent', sentAt: new Date().toISOString() })
        })
        return reminderId
    } catch (error: any) {
        await updateDoc(doc(db, 'applications', input.applicationId), {
            groupReminderHistory: arrayUnion({
                ...baseLog,
                status: 'failed',
                failedAt: new Date().toISOString(),
                error: clean(error?.message || error)
            })
        }).catch(() => undefined)
        throw error
    }
}
