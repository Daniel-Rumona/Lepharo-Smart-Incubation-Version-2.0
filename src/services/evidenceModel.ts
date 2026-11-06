// Read-side normalisers for the outcome-driven intervention model.
//
// Pure functions, no Firestore access and no writes. Every field they read is
// optional, and a missing field resolves to today's behaviour, so legacy
// interventions, assignments and programmes keep working unchanged.

export type ServiceEvidenceMode = 'mov' | 'attendance' | 'none'
export type DeliverableMode = 'named' | 'generic' | 'none'
export type OutcomeCaptureMode = 'off' | 'facilitator' | 'facilitator_and_sme'

export type EvidenceModel = {
    serviceEvidence: ServiceEvidenceMode
    deliverable: DeliverableMode
    outcomeCapture: OutcomeCaptureMode
}

/** What every programme does today: MOV required, POE shown generically, no outcome capture. */
export const DEFAULT_EVIDENCE_MODEL: EvidenceModel = {
    serviceEvidence: 'mov',
    deliverable: 'generic',
    outcomeCapture: 'off'
}

/** Used only when nothing more meaningful is configured. */
export const GENERIC_DELIVERABLE_LABEL = 'Proof of Execution'

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
    const v = String(value ?? '').trim().toLowerCase() as T
    return allowed.includes(v) ? v : fallback
}

/** programs/{id}.evidenceModel, defaulting each missing or unknown field to current behaviour. */
export function resolveEvidenceModel(program?: Record<string, any> | null): EvidenceModel {
    const raw = program?.evidenceModel
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_EVIDENCE_MODEL }
    return {
        serviceEvidence: pick(raw.serviceEvidence, ['mov', 'attendance', 'none'], DEFAULT_EVIDENCE_MODEL.serviceEvidence),
        deliverable: pick(raw.deliverable, ['named', 'generic', 'none'], DEFAULT_EVIDENCE_MODEL.deliverable),
        outcomeCapture: pick(
            raw.outcomeCapture,
            ['off', 'facilitator', 'facilitator_and_sme'],
            DEFAULT_EVIDENCE_MODEL.outcomeCapture
        )
    }
}

const text = (value: unknown) => String(value ?? '').trim()

/**
 * The deliverable name for an assignment.
 *
 * Order: the name frozen on the assignment at assign time, then the live
 * definition, then the generic label. Never derived from a resource `label`,
 * which holds the uploaded filename.
 */
export function resolveDeliverableName(
    assignment?: Record<string, any> | null,
    definition?: Record<string, any> | null,
    model: EvidenceModel = DEFAULT_EVIDENCE_MODEL
): { name: string; isConfigured: boolean } {
    if (model.deliverable === 'generic') return { name: GENERIC_DELIVERABLE_LABEL, isConfigured: false }
    const configured =
        text(assignment?.definitionSnapshot?.deliverableName) ||
        text(assignment?.definitionSnapshot?.outcomeDef?.deliverable?.name) ||
        text(definition?.outcomeDef?.deliverable?.name)
    return configured
        ? { name: configured, isConfigured: true }
        : { name: GENERIC_DELIVERABLE_LABEL, isConfigured: false }
}

export type DeliverableResource = {
    link: string
    label?: string
    originalName?: string
    type?: string
    role: 'deliverable' | 'other'
    deliverableName?: string
}

// Resource types that are not intervention output: signed agreements, shared learning links.
const NON_DELIVERABLE_TYPES = ['signed_agreement', 'link', 'learning', 'resource']

/**
 * Classify one `resources[]` entry. An explicit `role` wins. Legacy entries
 * (type 'poe' or 'document', no role) are deliverables. Anything else is 'other'.
 */
export function classifyResource(resource: Record<string, any>): 'deliverable' | 'other' {
    const role = text(resource?.role).toLowerCase()
    if (role === 'deliverable' || role === 'other') return role
    const type = text(resource?.type).toLowerCase()
    if (NON_DELIVERABLE_TYPES.includes(type)) return 'other'
    return type === 'poe' || type === 'document' || type === 'evidence' ? 'deliverable' : 'other'
}

/** The deliverable files on an assignment (or group delivery), with the resolved display name attached. */
export function getDeliverableView(
    record?: Record<string, any> | null,
    definition?: Record<string, any> | null,
    model: EvidenceModel = DEFAULT_EVIDENCE_MODEL
): { name: string; isConfigured: boolean; files: DeliverableResource[] } {
    const { name, isConfigured } = resolveDeliverableName(record, definition, model)
    const seen = new Set<string>()
    const files: DeliverableResource[] = []
    for (const item of Array.isArray(record?.resources) ? record!.resources : []) {
        const link = text(item?.link)
        if (!/^https?:\/\//i.test(link) || seen.has(link)) continue
        seen.add(link)
        const role = classifyResource(item)
        if (role !== 'deliverable') continue
        files.push({
            link,
            label: item.label,
            originalName: item.originalName,
            type: item.type,
            role,
            deliverableName: text(item.deliverableName) || (isConfigured ? name : undefined)
        })
    }
    return { name, isConfigured, files }
}

export type OutcomeStatus = 'not_tracked' | 'pending' | 'not_yet' | 'partial' | 'achieved'
export type OutcomeConfidence =
    | 'not_evidenced'
    | 'self_reported'
    | 'facilitator_verified'
    | 'artefact_supported'
    | 'system_observed'
    | 'independently_supported'

export type OutcomeState = {
    status: OutcomeStatus
    confidence: OutcomeConfidence
    adoption?: 'pending' | 'sustained' | 'lapsed'
    lastAssessedAt?: unknown
    followUpDueAt?: unknown
    /** True when the intervention defines an outcome at all. Legacy interventions are false. */
    isTracked: boolean
}

const STATUSES: readonly OutcomeStatus[] = ['not_tracked', 'pending', 'not_yet', 'partial', 'achieved']
const CONFIDENCES: readonly OutcomeConfidence[] = [
    'not_evidenced', 'self_reported', 'facilitator_verified',
    'artefact_supported', 'system_observed', 'independently_supported'
]

/**
 * The outcome summary cached on an assignment.
 *
 * `system_observed` is never accepted from this cache alone: a cached value is
 * downgraded unless the caller confirms a detector-backed evidence record
 * exists (`hasDetectorEvidence`, computed from outcomeEvidence by trusted
 * code). This keeps the summary from ever claiming what it cannot observe.
 */
export function getOutcomeState(
    assignment?: Record<string, any> | null,
    definition?: Record<string, any> | null,
    opts: { hasDetectorEvidence?: boolean } = {}
): OutcomeState {
    const raw = assignment?.outcome
    const tracked = Boolean(
        definition?.outcomeDef?.intendedOutcome ||
        assignment?.definitionSnapshot?.outcomeDef?.intendedOutcome
    )
    if (!raw || typeof raw !== 'object') {
        return { status: tracked ? 'pending' : 'not_tracked', confidence: 'not_evidenced', isTracked: tracked }
    }
    const status = pick(raw.status, STATUSES, tracked ? 'pending' : 'not_tracked')
    let confidence = pick(raw.confidence, CONFIDENCES, 'not_evidenced')
    if ((confidence === 'system_observed' || confidence === 'independently_supported') && !opts.hasDetectorEvidence) {
        confidence = 'not_evidenced'
    }
    const adoption = pick(raw.adoption, ['pending', 'sustained', 'lapsed', ''] as const, '')
    return {
        status,
        confidence,
        adoption: adoption || undefined,
        lastAssessedAt: raw.lastAssessedAt,
        followUpDueAt: raw.followUpDueAt,
        isTracked: tracked || status !== 'not_tracked'
    }
}

// ── Intervention definition: outcomeDef ──────────────────────────────────────

export type OutcomeType =
    | 'capability_established'
    | 'process_implemented'
    | 'behaviour_adopted'
    | 'compliance_achieved'
    | 'risk_reduced'
    | 'performance_improved'
    | 'access_achieved'
    | 'issue_resolved'

export type EvidenceMechanism =
    | 'facilitator_observation'
    | 'sme_self_report'
    | 'deliverable'
    | 'assessment'
    | 'compliance_record'

export const OUTCOME_TYPE_LABELS: Record<OutcomeType, string> = {
    capability_established: 'Capability established',
    process_implemented: 'Process implemented',
    behaviour_adopted: 'Behaviour adopted',
    compliance_achieved: 'Compliance achieved',
    risk_reduced: 'Risk reduced',
    performance_improved: 'Performance improved',
    access_achieved: 'Access achieved',
    issue_resolved: 'Issue resolved'
}

export const OUTCOME_TYPES = Object.keys(OUTCOME_TYPE_LABELS) as OutcomeType[]

/**
 * Defaults that hide measurement design from the HOD. Only mechanisms people
 * can genuinely supply are listed: no system or integration mechanism appears
 * here, because none can be observed until a detector exists.
 */
export const OUTCOME_TYPE_DEFAULTS: Record<
    OutcomeType,
    { acceptedMechanisms: EvidenceMechanism[]; followUpAfterDays: number; checkAdoption: boolean }
> = {
    capability_established: { acceptedMechanisms: ['deliverable', 'facilitator_observation'], followUpAfterDays: 60, checkAdoption: true },
    process_implemented: { acceptedMechanisms: ['deliverable', 'facilitator_observation', 'sme_self_report'], followUpAfterDays: 60, checkAdoption: true },
    behaviour_adopted: { acceptedMechanisms: ['facilitator_observation', 'sme_self_report'], followUpAfterDays: 90, checkAdoption: true },
    compliance_achieved: { acceptedMechanisms: ['compliance_record', 'deliverable'], followUpAfterDays: 30, checkAdoption: false },
    risk_reduced: { acceptedMechanisms: ['facilitator_observation', 'assessment', 'deliverable'], followUpAfterDays: 90, checkAdoption: false },
    performance_improved: { acceptedMechanisms: ['assessment', 'facilitator_observation', 'sme_self_report'], followUpAfterDays: 90, checkAdoption: false },
    access_achieved: { acceptedMechanisms: ['deliverable', 'facilitator_observation'], followUpAfterDays: 30, checkAdoption: false },
    issue_resolved: { acceptedMechanisms: ['facilitator_observation', 'sme_self_report'], followUpAfterDays: 30, checkAdoption: false }
}

export type OutcomeDef = {
    /** Whether to check back later, and whether the SME is also asked. */
    followUp?: { required: boolean; smeCheckIn: boolean }
    deliverable?: { name: string; description?: string; required?: boolean }
    intendedOutcome?: string
    outcomeType?: OutcomeType
    acceptedMechanisms?: EvidenceMechanism[]
    followUpAfterDays?: number
    checkAdoption?: boolean
    origin: 'manual' | 'ai_suggested' | 'default'
}

export type OutcomeDefInput = {
    deliverableName?: string
    deliverableDescription?: string
    deliverableRequired?: boolean
    intendedOutcome?: string
    outcomeType?: string
    followUpAfterDays?: number
    /** Only meaningful when an intended outcome is set. */
    followUpRequired?: boolean
    smeCheckIn?: boolean
    /** True when the values came from an accepted AI suggestion card. */
    fromSuggestion?: boolean
}

/**
 * Build the `outcomeDef` to store on an intervention, or null when the HOD
 * defined neither a deliverable nor an outcome (so legacy-style definitions
 * stay free of empty objects). Undefined keys are omitted for Firestore.
 */
export function buildOutcomeDef(input: OutcomeDefInput): OutcomeDef | null {
    const name = text(input.deliverableName)
    const outcome = text(input.intendedOutcome)
    if (!name && !outcome) return null

    const type = OUTCOME_TYPES.includes(text(input.outcomeType) as OutcomeType)
        ? (text(input.outcomeType) as OutcomeType)
        : undefined
    const defaults = type ? OUTCOME_TYPE_DEFAULTS[type] : undefined
    const days = Number(input.followUpAfterDays)
    const description = text(input.deliverableDescription)

    const def: OutcomeDef = {
        origin: input.fromSuggestion ? 'ai_suggested' : 'manual'
    }
    if (name) {
        def.deliverable = {
            name,
            ...(description ? { description } : {}),
            required: input.deliverableRequired !== false
        }
    }
    if (outcome) def.intendedOutcome = outcome
    if (type) {
        def.outcomeType = type
        def.acceptedMechanisms = defaults!.acceptedMechanisms
        def.checkAdoption = defaults!.checkAdoption
    }
    const followUp = Number.isFinite(days) && days > 0 ? Math.round(days) : defaults?.followUpAfterDays
    if (outcome && input.followUpRequired === false) {
        // Explicitly no check-back: keep the choice, drop the schedule.
        def.followUp = { required: false, smeCheckIn: false }
        return def
    }
    if (outcome && input.followUpRequired === true) {
        def.followUp = { required: true, smeCheckIn: input.smeCheckIn === true }
        def.followUpAfterDays = followUp || 60
        return def
    }
    if (followUp) def.followUpAfterDays = followUp
    return def
}
