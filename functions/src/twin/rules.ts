// Digital twin rules: every number on an SME's twin, worked out one way.
//
// The web app (live twin screen, Risk Register) and the Cloud Functions (nightly
// twin job, recalculate callable) both import this file, so a saved daily record
// and what a screen shows can never disagree. It is pure: plain documents in,
// plain record out, no Firestore and no imports beyond its siblings, so both
// builds compile it unchanged.
//
// Rules corrected here (see the Digital Twin Build Plan, "Fix before we build"):
// - Completed, declined and waiting-on-SME come only from resolveAssignmentLifecycle.
// - Compliance documents are read from the complianceDocuments sub-collection,
//   which overrides the older copies embedded on the application, measured
//   against the programme's own requirements.
// - The growth score finds the SME by id and programme, not by email, and uses
//   the same lifecycle and compliance readers.
// - Interventions, plans and revenue are scoped to the application's programme.

import { resolveAssignmentLifecycle, type AssignmentLifecycleKey } from './lifecycle'
import { computeRiskScore, getRiskLevel, NEEDS_ATTENTION_WEIGHTS, type RiskLevel, type RiskReason, type RiskScoreInputs } from './needsAttention'

export { computeRiskScore, getRiskLevel, NEEDS_ATTENTION_WEIGHTS } from './needsAttention'
export type { RiskLevel, RiskReason, RiskReasonKey, RiskScoreInputs, RiskScoreResult } from './needsAttention'

/** Bump whenever a calculation below changes, so saved records stay traceable. */
export const TWIN_RULE_VERSION = 'v2'

/** Days ahead the outlook projects, if nothing changes. */
export const OUTLOOK_HORIZONS = [20, 40] as const

/** Peer groups smaller than this are not shown, so no single SME can be singled out. */
export const MIN_PEER_GROUP = 3

/** Roles that may see twins and ask for a recalculation. firestore.rules repeats this list. */
export const TWIN_STAFF_ROLES: readonly string[] = [
    'director', 'system_admin', 'superadmin', 'admin', 'operations', 'projectadmin', 'projectmanager', 'coordinator'
]

export type AnyDoc = Record<string, any>

const DAY_MS = 24 * 60 * 60 * 1000
const COMPLIANCE_EXPIRING_SOON_DAYS = 30
const SOUTH_AFRICA_OFFSET_MS = 2 * 60 * 60 * 1000
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
]

/* ============================== helpers ============================== */

export function normalizeText(value: any): string {
    return String(value ?? '').trim()
}

export function normalizeLower(value: any): string {
    return normalizeText(value).toLowerCase()
}

export function firstNonEmpty(...values: any[]): any {
    for (const value of values) {
        if (value === 0) return value
        if (value === false) return value
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value
        }
    }
    return undefined
}

export function toDate(value: any): Date | null {
    if (!value) return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value === 'object' && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000)
    }
    if (typeof value === 'object' && typeof value._seconds === 'number') {
        return new Date(value._seconds * 1000)
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? null : date
    }
    return null
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)

/** Whole days from `from` to `to`, truncated like dayjs().diff(date, 'day'). */
export const wholeDaysBetween = (from: Date, to: Date) => Math.trunc((to.getTime() - from.getTime()) / DAY_MS)

/** Calendar date in South Africa (UTC+2, no daylight saving), as YYYY-MM-DD. */
export const twinDayKey = (date: Date) => new Date(date.getTime() + SOUTH_AFRICA_OFFSET_MS).toISOString().slice(0, 10)

export const twinIdFor = (participantId: string, programId: string | null) =>
    `${participantId}_${programId || 'no-programme'}`

const iso = (date: Date | null) => (date ? date.toISOString() : null)

const median = (values: number[]): number | null => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Keeps rows for this programme; rows with no programme recorded are kept too. */
const inProgramme = (programId: string | null) => (item: AnyDoc) =>
    !programId || !item?.programId || normalizeText(item.programId) === programId

const newestFirst = (left: AnyDoc, right: AnyDoc) =>
    (toDate(right?.updatedAt ?? right?.createdAt)?.getTime() || 0) -
    (toDate(left?.updatedAt ?? left?.createdAt)?.getTime() || 0)

export const scopeToProgramme = <T extends AnyDoc>(items: T[], programId: string | null): T[] =>
    items.filter(inProgramme(programId))

/** The plan for this programme, else the newest plan the SME has. */
export const pickPlanForProgramme = (plans: AnyDoc[], programId: string | null): AnyDoc | null => {
    const sorted = [...plans].sort(newestFirst)
    return sorted.find(plan => programId && normalizeText(plan.programId) === programId) ?? sorted[0] ?? null
}

/* ========================= SME identity fields ========================= */

export function getParticipantId(doc: AnyDoc): string {
    return normalizeText(firstNonEmpty(doc.participantId, doc.participantID, doc.incubateeId, doc.smeId, doc.userId, doc.id))
}

export function getEmail(doc?: AnyDoc): string | undefined {
    if (!doc) return undefined
    const value = firstNonEmpty(doc.email, doc.applicantEmail, doc.ownerEmail, doc.contactEmail, doc.userEmail, doc?.contactInfo?.email)
    return value ? String(value).trim().toLowerCase() : undefined
}

export type IncubationGroup = 'A' | 'B' | 'C' | 'Graduated'

export function normalizeGroup(value: unknown): IncubationGroup {
    const normalized = normalizeLower(value).replace(/^group\s+/, '')
    if (normalized === 'b') return 'B'
    if (normalized === 'c') return 'C'
    if (['graduated', 'post-incubation', 'post incubation'].includes(normalized)) return 'Graduated'
    return 'A'
}

/** Same resolution as groupLifecycleService.resolveApplicationGroup. */
export function resolveGroup(application: AnyDoc, participant?: AnyDoc): IncubationGroup {
    const direct = firstNonEmpty(
        application?.gapGroup, application?.group, application?.currentGroup,
        participant?.gapGroup, participant?.group, participant?.currentGroup
    )
    if (normalizeText(direct)) return normalizeGroup(direct)
    const history = [
        ...(Array.isArray(participant?.groupHistory) ? participant!.groupHistory : []),
        ...(Array.isArray(application?.groupHistory) ? application.groupHistory : [])
    ]
        .filter((item: AnyDoc) => item?.to)
        .sort((a: AnyDoc, b: AnyDoc) => new Date(a.date || a.at || 0).getTime() - new Date(b.date || b.at || 0).getTime())
    return history.length ? normalizeGroup(history[history.length - 1].to) : 'A'
}

/* ============================ departments ============================ */

export function normalizeDepartmentName(value: any): string {
    const raw = normalizeText(value)
    if (!raw) return ''
    const lower = raw.toLowerCase()

    if (lower === 'rom' || lower.includes('recruitment') || lower.includes('onboarding')) return 'ROM'
    if (lower.includes('hse') || lower.includes('labour')) return 'HSE & Labour Compliance'
    if (lower.includes('financial')) return 'Financial Compliance'
    if (lower === 'pds' || lower.includes('personal development')) return 'PDS'
    // Marketing must be checked before Market Linkages: "marketing" contains "market".
    if (
        lower.includes('marketing') ||
        lower === 'communication' ||
        lower === 'communications'
    ) return 'Marketing and Communication'
    if (
        lower === 'market' ||
        lower === 'market linkage' ||
        lower === 'market linkages' ||
        lower.includes('market linkage')
    ) return 'Market Linkages'
    if (lower.includes('legal')) return 'Legal Advisory Services'
    if (lower.includes('wellness')) return 'Wellness Services'
    if (lower.includes('training') || lower.includes('academy')) return 'Training Academy'
    return raw
}

export type DepartmentIndex = {
    byId: Record<string, AnyDoc>
    byName: Record<string, AnyDoc>
}

/** One department's slice: its services only, as that department's HOD sees an SME. */
export type TwinScope = { departmentId: string; departmentName: string }

/**
 * The department a viewer's Risk Register and twin are limited to, or null for the
 * whole SME. Main and monitoring departments see the whole SME; any other
 * department sees only its own services. Until departments load, a viewer with a
 * department is treated as limited to it, as the register always has.
 */
export function departmentScopeFor(
    viewer: AnyDoc | null | undefined,
    departments: AnyDoc[]
): TwinScope | null {
    const departmentId = normalizeText(viewer?.departmentId)
    if (!departmentId) return null
    const department = departments.find(dep => String(dep.id) === departmentId)
    if (department?.isMain === true || department?.isMonitoring === true) return null
    const name = normalizeDepartmentName(firstNonEmpty(
        department?.name,
        department?.title,
        department?.departmentName,
        department?.displayName,
        viewer?.departmentName
    ))
    return { departmentId, departmentName: name || normalizeText(viewer?.departmentName) || 'My Department' }
}

export function indexDepartments(departments: AnyDoc[]): DepartmentIndex {
    const byId: Record<string, AnyDoc> = {}
    const byName: Record<string, AnyDoc> = {}
    departments.forEach(dep => {
        byId[String(dep.id)] = dep
        const name = normalizeDepartmentName(dep?.name)
        if (name) byName[name.toLowerCase()] = dep
    })
    return { byId, byName }
}

export function getInterventionDepartmentKey(
    iv: AnyDoc,
    departmentsById: Record<string, AnyDoc>,
    departmentsByName: Record<string, AnyDoc>
) {
    const rawDepartmentId = normalizeText(iv?.departmentId)
    const rawArea = normalizeDepartmentName(firstNonEmpty(iv?.area, iv?.areaOfSupport, iv?.departmentName, iv?.department))

    if (rawDepartmentId && departmentsById[rawDepartmentId]) {
        const dep = departmentsById[rawDepartmentId]
        return {
            departmentId: String(dep.id),
            departmentName: normalizeDepartmentName(dep.name || rawArea || 'Unknown Department')
        }
    }

    if (rawArea) {
        const dep = departmentsByName[rawArea.toLowerCase()]
        if (dep) {
            return { departmentId: String(dep.id), departmentName: normalizeDepartmentName(dep.name || rawArea) }
        }
        return { departmentId: rawArea, departmentName: rawArea }
    }

    return { departmentId: 'unknown', departmentName: 'Unknown Department' }
}

export function getDepartmentDocForKey(
    dep: { departmentId: string; departmentName: string },
    departmentsById: Record<string, AnyDoc>,
    departmentsByName: Record<string, AnyDoc>
): AnyDoc | undefined {
    return departmentsById[dep.departmentId] || departmentsByName[dep.departmentName.toLowerCase()]
}

export function isInterventionsDepartment(depDoc?: AnyDoc): boolean {
    return depDoc?.interventionsDepartment === true
}

export function isDpInterventionDepartment(
    iv: AnyDoc,
    departmentsById: Record<string, AnyDoc>,
    departmentsByName: Record<string, AnyDoc>
): boolean {
    const dep = getInterventionDepartmentKey(iv, departmentsById, departmentsByName)
    return isInterventionsDepartment(getDepartmentDocForKey(dep, departmentsById, departmentsByName))
}

export function getEligibleDpInterventions(
    interventions: AnyDoc[],
    departmentsById: Record<string, AnyDoc>,
    departmentsByName: Record<string, AnyDoc>
) {
    return interventions.filter(iv => isDpInterventionDepartment(iv, departmentsById, departmentsByName))
}

export function departmentMatchesScope(
    dep: { departmentId: string; departmentName: string },
    scope?: { departmentId?: string; departmentName?: string }
) {
    if (!scope?.departmentId && !scope?.departmentName) return true
    const depId = normalizeLower(dep.departmentId)
    const depName = normalizeLower(dep.departmentName)
    const scopeId = normalizeLower(scope.departmentId)
    const scopeName = normalizeLower(scope.departmentName)
    return (!!scopeId && depId === scopeId) || (!!scopeName && depName === scopeName)
}

export function isConfirmedValue(value: any): boolean {
    if (value === true) return true
    if (value && typeof value === 'object') return value.confirmed === true
    return false
}

export function isDeptConfirmedForDp(dp: AnyDoc, deptId?: string, deptName?: string): boolean {
    const id = normalizeText(deptId)
    const name = normalizeText(deptName)
    return isConfirmedValue(id ? dp?.confirmedByDeptId?.[id] : undefined) ||
        isConfirmedValue(name ? dp?.confirmed?.[name] : undefined)
}

export function isSmmeConfirmedForDp(dp: AnyDoc, deptId?: string, deptName?: string): boolean {
    const id = normalizeText(deptId)
    const name = normalizeText(deptName)
    return (
        (!!id && isConfirmedValue(firstNonEmpty(
            dp?.smmeConfirmedByDeptId?.[id],
            dp?.incubateeDepartmentConfirmationsByDeptId?.[id]
        ))) ||
        (!!name && isConfirmedValue(firstNonEmpty(
            dp?.smmeConfirmedByDept?.[name],
            dp?.incubateeConfirmedByDept?.[name],
            dp?.incubateeDepartmentConfirmations?.[name],
            dp?.smmeConfirmedMap?.[name]
        )))
    )
}

export function getInterventionTitle(doc: AnyDoc): string {
    return String(firstNonEmpty(
        doc.interventionTitle, doc.title, doc.serviceTitle, doc.activityTitle, doc.interventionName,
        'Untitled intervention'
    ))
}

export function getBestInterventionDate(doc: AnyDoc): Date | null {
    return toDate(firstNonEmpty(
        doc.completedAt, doc.interventionDate, doc.executionDate, doc.engagementDate,
        doc.attendanceDate, doc.date, doc.updatedAt, doc.createdAt
    ))
}

/* ======================= delivery coverage (fixed) ======================= */

/**
 * How one assignment counts towards coverage. Corrected rule: this reads only
 * resolveAssignmentLifecycle, replacing the register's separate status checks,
 * so facilitator completion and SME confirmation are judged the same everywhere.
 */
export function classifyAssignment(assignment: AnyDoc) {
    const lifecycle = resolveAssignmentLifecycle(assignment)
    return {
        lifecycle,
        isCompleted: lifecycle.isCompleted,
        // Declined as the Risk Register has always counted it: the SME turned it down, or
        // it was cancelled. A facilitator declining (needs reassignment) and the SME
        // rejecting a completion both wait on staff, so neither counts against the SME.
        isDeclined: lifecycle.key === 'participant-declined' || lifecycle.key === 'cancelled',
        awaitingSmeAcceptance: lifecycle.key === 'awaiting-participant-acceptance',
        awaitingSmeConfirmation: lifecycle.key === 'awaiting-participant-confirmation'
    }
}

export type DepartmentCoverage = {
    departmentId: string
    departmentName: string
    deptConfirmed: boolean
    smmeConfirmed: boolean
    expectedInterventionIds: string[]
    expectedInterventionTitles: string[]
    servicedCount: number
    completedCount: number
    pendingCount: number
    declinedCount: number
    latestServiceDate: Date | null
}

export type DeliveryCoverage = {
    hasPlan: boolean
    eligiblePlanInterventionCount: number
    expectedDepartments: DepartmentCoverage[]
    servicedDepartments: DepartmentCoverage[]
    missingDepartments: DepartmentCoverage[]
    fullyConfirmedDepartments: DepartmentCoverage[]
    /** Assignments counted against an expected department, with that department. */
    matchedAssignments: Array<{ assignment: AnyDoc; departmentId: string; departmentName: string }>
    smePendingAcceptanceCount: number
    smePendingConfirmationCount: number
    responsivenessRiskDepartments: string[]
    totalTouches: number
    completedTouches: number
    pendingTouches: number
    declinedTouches: number
    totalExpectedInterventions: number
    lastInterventionDate: Date | null
}

/** Departments the development plan expects, and what each has delivered. */
export function deriveDeliveryCoverage(args: {
    diagnosticPlan?: AnyDoc | null
    assignments: AnyDoc[]
    departmentsById: Record<string, AnyDoc>
    departmentsByName: Record<string, AnyDoc>
    scope?: { departmentId?: string; departmentName?: string }
}): DeliveryCoverage {
    const { diagnosticPlan, assignments, departmentsById, departmentsByName, scope } = args
    const plan = diagnosticPlan || {}
    const planInterventions: AnyDoc[] = Array.isArray(plan.interventions) ? plan.interventions : []
    const eligible = getEligibleDpInterventions(planInterventions, departmentsById, departmentsByName)
        .filter(iv => departmentMatchesScope(getInterventionDepartmentKey(iv, departmentsById, departmentsByName), scope))

    const expected = new Map<string, DepartmentCoverage>()
    eligible.forEach(iv => {
        const dep = getInterventionDepartmentKey(iv, departmentsById, departmentsByName)
        const deptConfirmed = isDeptConfirmedForDp(plan, dep.departmentId, dep.departmentName)
        const smmeConfirmed = isSmmeConfirmedForDp(plan, dep.departmentId, dep.departmentName)
        if (!expected.has(dep.departmentId)) {
            expected.set(dep.departmentId, {
                departmentId: dep.departmentId,
                departmentName: dep.departmentName,
                deptConfirmed,
                smmeConfirmed,
                expectedInterventionIds: [],
                expectedInterventionTitles: [],
                servicedCount: 0,
                completedCount: 0,
                pendingCount: 0,
                declinedCount: 0,
                latestServiceDate: null
            })
        }
        const entry = expected.get(dep.departmentId)!
        entry.deptConfirmed = entry.deptConfirmed || deptConfirmed
        entry.smmeConfirmed = entry.smmeConfirmed || smmeConfirmed
        const ivId = normalizeText(iv?.id)
        const ivTitle = getInterventionTitle(iv)
        if (ivId && !entry.expectedInterventionIds.includes(ivId)) entry.expectedInterventionIds.push(ivId)
        if (ivTitle && !entry.expectedInterventionTitles.includes(ivTitle)) entry.expectedInterventionTitles.push(ivTitle)
    })

    let smePendingAcceptanceCount = 0
    let smePendingConfirmationCount = 0
    const responsiveness = new Set<string>()
    const matchedAssignments: DeliveryCoverage['matchedAssignments'] = []

    assignments.forEach(assignment => {
        const dep = getInterventionDepartmentKey(assignment, departmentsById, departmentsByName)
        if (!departmentMatchesScope(dep, scope)) return
        const entry = expected.get(dep.departmentId)
        if (!entry) return

        const state = classifyAssignment(assignment)
        const date = getBestInterventionDate(assignment)

        entry.servicedCount += 1
        if (state.isCompleted) entry.completedCount += 1
        else if (state.isDeclined) entry.declinedCount += 1
        else entry.pendingCount += 1

        if (state.awaitingSmeAcceptance) {
            smePendingAcceptanceCount += 1
            responsiveness.add(dep.departmentName)
        }
        if (state.awaitingSmeConfirmation) {
            smePendingConfirmationCount += 1
            responsiveness.add(dep.departmentName)
        }
        if (date && (!entry.latestServiceDate || date.getTime() > entry.latestServiceDate.getTime())) {
            entry.latestServiceDate = date
        }
        matchedAssignments.push({ assignment, departmentId: dep.departmentId, departmentName: dep.departmentName })
    })

    const expectedDepartments = [...expected.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName))
    const sum = (pick: (item: DepartmentCoverage) => number) => expectedDepartments.reduce((total, item) => total + pick(item), 0)
    const lastInterventionDate = expectedDepartments
        .map(item => item.latestServiceDate)
        .filter((date): date is Date => !!date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

    return {
        hasPlan: !!diagnosticPlan,
        eligiblePlanInterventionCount: eligible.length,
        expectedDepartments,
        servicedDepartments: expectedDepartments.filter(item => item.servicedCount > 0),
        missingDepartments: expectedDepartments.filter(item => !item.deptConfirmed || !item.smmeConfirmed || item.servicedCount === 0),
        fullyConfirmedDepartments: expectedDepartments.filter(item => item.deptConfirmed && item.smmeConfirmed),
        matchedAssignments,
        smePendingAcceptanceCount,
        smePendingConfirmationCount,
        responsivenessRiskDepartments: [...responsiveness].filter(Boolean).sort(),
        totalTouches: sum(item => item.servicedCount),
        completedTouches: sum(item => item.completedCount),
        pendingTouches: sum(item => item.pendingCount),
        declinedTouches: sum(item => item.declinedCount),
        totalExpectedInterventions: sum(item => item.expectedInterventionIds.length),
        lastInterventionDate
    }
}

/* ========================= compliance (fixed) ========================= */

export type ComplianceStatus =
    | 'signed' | 'valid' | 'expiring-soon' | 'expired' | 'missing'
    | 'pending' | 'invalid' | 'rejected' | 'queried' | string

/** Matches documents to requirements the way the incubatee compliance page does. */
export const complianceMatchKey = (value: unknown) => normalizeLower(value)
    .replace(/\(signed\)/g, '')
    .replace(/\b(docs|documents)\b/g, 'document')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function resolveComplianceDocumentStatus(
    document: AnyDoc,
    effectiveExpiry?: unknown,
    now = new Date(),
    expiringSoonDays = COMPLIANCE_EXPIRING_SOON_DAYS
): ComplianceStatus {
    const storedStatus = normalizeLower(document?.status || 'pending')
    if (storedStatus === 'missing') return 'missing'
    const expiry = toDate(effectiveExpiry ?? document?.expiryDate)
    if (expiry && expiry.getTime() < now.getTime()) return 'expired'
    if (['invalid', 'rejected', 'queried'].includes(storedStatus)) return storedStatus
    if (['valid', 'approved', 'verified', 'accepted'].includes(storedStatus)) {
        if (expiry && expiry.getTime() <= now.getTime() + expiringSoonDays * DAY_MS) return 'expiring-soon'
        return 'valid'
    }
    return storedStatus
}

export const complianceStatusCountsAsCovered = (status: unknown) =>
    ['valid', 'expiring-soon', 'signed'].includes(normalizeLower(status))

export type ComplianceRequirementLite = {
    key: string
    title: string
    hasExpiry: boolean
    expiryMonths: number | null
}

const isAgreementRecord = (raw: AnyDoc) =>
    raw?.kind === 'agreement' || raw?.type === 'agreement' || Boolean(raw?.agreementId)

/** Upload requirements from a programme's programRequirements (agreements are separate). */
export function normalizeProgramRequirements(raw: AnyDoc[] = []): ComplianceRequirementLite[] {
    const unique = new Map<string, ComplianceRequirementLite>()
    raw.forEach(item => {
        if (!item || isAgreementRecord(item)) return
        const title = normalizeText(firstNonEmpty(item.title, item.name, item.presetId, item.key, item.id))
        const key = complianceMatchKey(title)
        if (!key) return
        const hasExpiry = Boolean(item.hasExpiry || item.expiryRule)
        const months = Number(item.expiryMonths ?? item.expiryRule?.months)
        unique.set(key, {
            key,
            title,
            hasExpiry,
            expiryMonths: hasExpiry && Number.isFinite(months) && months > 0 ? months : null
        })
    })
    return [...unique.values()]
}

export type ComplianceRow = {
    key: string
    title: string
    status: ComplianceStatus
    expiry: Date | null
    covered: boolean
    source: 'subcollection' | 'embedded' | 'none'
}

/**
 * The one compliance reader. Sub-collection uploads override the copies
 * embedded on the application; each programme requirement becomes a row,
 * "missing" when nothing matches. With no requirements configured, every
 * uploaded document becomes a row instead.
 */
export function resolveComplianceRows(args: {
    requirements: ComplianceRequirementLite[]
    embedded: AnyDoc[]
    uploads: AnyDoc[]
    now?: Date
}): ComplianceRow[] {
    const now = args.now ?? new Date()
    const byKey = new Map<string, AnyDoc & { _source: ComplianceRow['source'] }>()
    const add = (document: AnyDoc, source: ComplianceRow['source']) => {
        if (!document || isAgreementRecord(document)) return
        const key = complianceMatchKey(firstNonEmpty(document.type, document.title, document.documentName, document.name))
        if (key) byKey.set(key, { ...document, _source: source })
    }
    args.embedded.forEach(document => add(document, 'embedded'))
    args.uploads.forEach(document => add(document, 'subcollection'))

    const toRow = (key: string, title: string, document: AnyDoc | undefined, requirement?: ComplianceRequirementLite): ComplianceRow => {
        const model = document ?? { status: 'missing' }
        const issued = toDate(model.issueDate) || toDate(model.createdAt)
        let expiry = toDate(model.expiryDate)
        if (!expiry && requirement?.hasExpiry && requirement.expiryMonths && issued) {
            expiry = new Date(issued)
            expiry.setMonth(expiry.getMonth() + requirement.expiryMonths)
        }
        const status = resolveComplianceDocumentStatus(model, expiry, now)
        return {
            key,
            title,
            status,
            expiry: status === 'missing' ? null : expiry,
            covered: complianceStatusCountsAsCovered(status),
            source: document ? (document as any)._source : 'none'
        }
    }

    if (args.requirements.length) {
        return args.requirements.map(requirement => toRow(requirement.key, requirement.title, byKey.get(requirement.key), requirement))
    }
    return [...byKey.entries()].map(([key, document]) =>
        toRow(key, normalizeText(firstNonEmpty(document.type, document.title, document.documentName, document.name)), document)
    )
}

export type ComplianceSummary = {
    total: number
    covered: number
    expiringSoon: number
    pending: number
    missing: number
    expired: number
    queried: number
    rejected: number
}

export function summarizeCompliance(rows: ComplianceRow[]): ComplianceSummary {
    const count = (statuses: string[]) => rows.filter(row => statuses.includes(normalizeLower(row.status))).length
    const covered = rows.filter(row => row.covered).length
    const missing = count(['missing'])
    const expired = count(['expired'])
    const queried = count(['queried'])
    const rejected = count(['rejected', 'invalid'])
    return {
        total: rows.length,
        covered,
        expiringSoon: count(['expiring-soon']),
        pending: rows.length - covered - missing - expired - queried - rejected,
        missing,
        expired,
        queried,
        rejected
    }
}

/* ============================ needs attention ============================ */

export type NeedsAttention = {
    score: number
    level: RiskLevel
    reasons: { label: string; delta: number }[]
    daysSinceLastService: number | null
    inputs: RiskScoreInputs
}

export function needsAttentionInputs(
    coverage: DeliveryCoverage,
    docs: { missing: number; queried: number; rejected: number },
    now: Date
): RiskScoreInputs {
    return {
        daysSinceLastService: coverage.lastInterventionDate ? wholeDaysBetween(coverage.lastInterventionDate, now) : null,
        hasNeverReceivedService: coverage.fullyConfirmedDepartments.length > 0 && coverage.totalTouches === 0,
        docsMissing: docs.missing,
        docsQueried: docs.queried,
        docsRejected: docs.rejected,
        missingDepartmentsCount: coverage.missingDepartments.length,
        smePendingAcceptanceCount: coverage.smePendingAcceptanceCount,
        smePendingConfirmationCount: coverage.smePendingConfirmationCount,
        declinedTouches: coverage.declinedTouches
    }
}

/** Twin compliance feeds the score as: expired counts as missing, invalid as rejected. */
const complianceRiskDocs = (summary: ComplianceSummary) => ({
    missing: summary.missing + summary.expired,
    queried: summary.queried,
    rejected: summary.rejected
})

/**
 * An SME's document counts against its programme's required uploads, read the way
 * the Compliance page and the SME's own dashboard read them, so the Risk Register,
 * the ROM dashboard and the twin agree. An expired document counts as missing: it
 * has to be uploaded again.
 */
export function complianceDocumentCounts(args: {
    application: AnyDoc
    programRequirements?: AnyDoc[] | null
    uploads?: AnyDoc[] | null
    now?: Date
}) {
    const summary = summarizeCompliance(resolveComplianceRows({
        requirements: normalizeProgramRequirements(args.programRequirements || []),
        embedded: Array.isArray(args.application?.complianceDocuments) ? args.application.complianceDocuments : [],
        uploads: args.uploads || [],
        now: args.now
    }))
    return {
        total: summary.total,
        completed: summary.covered,
        pending: summary.pending,
        ...complianceRiskDocs(summary)
    }
}

export function computeNeedsAttention(inputs: RiskScoreInputs): NeedsAttention {
    const result = computeRiskScore(inputs)
    return {
        score: result.score,
        level: result.level,
        reasons: result.breakdown,
        daysSinceLastService: inputs.daysSinceLastService,
        inputs
    }
}

/* ============================ growth score ============================ */

export type GrowthScoreComponentKey = 'compliance' | 'interventions' | 'roadmap' | 'responsiveness'

export type GrowthScoreComponent = {
    key: GrowthScoreComponentKey
    label: string
    score: number
    maximum: number
    detail: string
}

/** The raw counts behind the growth score, kept so a what-if can recompute it exactly. */
export type GrowthCounts = {
    documentsCovered: number
    documentsTotal: number
    interventionsCompleted: number
    interventionsTotal: number
    roadmapConfirmed: number
    roadmapTotal: number
    roadmapFinal: boolean
    responses: number
    responseOpportunities: number
}

export type GrowthScore = {
    total: number
    band: 'Starting' | 'Building momentum' | 'On track' | 'Growth ready'
    components: GrowthScoreComponent[]
    counts: GrowthCounts
}

export const growthBandFor = (score: number): GrowthScore['band'] => {
    if (score >= 85) return 'Growth ready'
    if (score >= 65) return 'On track'
    if (score >= 35) return 'Building momentum'
    return 'Starting'
}

const isClosedWithoutDelivery = (key: AssignmentLifecycleKey) => key === 'cancelled' || key === 'needs-reassignment'

/** Turns growth counts into the 100-point score (compliance 30, interventions 30, roadmap 20, responsiveness 20). */
export function growthFromCounts(counts: GrowthCounts): GrowthScore {
    const share = (part: number, whole: number, points: number) => (whole ? Math.round((Math.min(part, whole) / whole) * points) : 0)
    const roadmapScore = counts.roadmapFinal ? 20 : share(counts.roadmapConfirmed, counts.roadmapTotal, 20)
    const components: GrowthScoreComponent[] = [
        {
            key: 'compliance', label: 'Compliance', score: share(counts.documentsCovered, counts.documentsTotal, 30), maximum: 30,
            detail: counts.documentsTotal
                ? `${Math.min(counts.documentsCovered, counts.documentsTotal)} of ${counts.documentsTotal} documents verified`
                : 'No compliance requirements or documents recorded yet'
        },
        {
            key: 'interventions', label: 'Interventions', score: share(counts.interventionsCompleted, counts.interventionsTotal, 30), maximum: 30,
            detail: counts.interventionsTotal
                ? `${Math.min(counts.interventionsCompleted, counts.interventionsTotal)} of ${counts.interventionsTotal} interventions completed`
                : 'No interventions assigned yet'
        },
        {
            key: 'roadmap', label: 'Roadmap', score: roadmapScore, maximum: 20,
            detail: counts.roadmapFinal
                ? 'Growth plan finalised'
                : counts.roadmapTotal
                    ? `${Math.min(counts.roadmapConfirmed, counts.roadmapTotal)} of ${counts.roadmapTotal} roadmap areas confirmed`
                    : 'No confirmed roadmap areas yet'
        },
        {
            key: 'responsiveness', label: 'SME responsiveness', score: share(counts.responses, counts.responseOpportunities, 20), maximum: 20,
            detail: counts.responseOpportunities
                ? `${Math.min(counts.responses, counts.responseOpportunities)} of ${counts.responseOpportunities} requested intervention responses completed`
                : 'No intervention responses requested yet'
        }
    ]
    const total = components.reduce((sum, component) => sum + component.score, 0)
    return { total, band: growthBandFor(total), components, counts }
}

/**
 * The growth score for one SME in one programme, from the shared lifecycle and
 * compliance readers. Cancelled and reassigned assignments no longer count
 * against the SME.
 */
export function computeGrowthScore(args: {
    assignments: AnyDoc[]
    compliance: ComplianceSummary
    diagnosticPlan?: AnyDoc | null
}): GrowthScore {
    const lifecycles = args.assignments.map(resolveAssignmentLifecycle).filter(item => !isClosedWithoutDelivery(item.key))

    const plan = args.diagnosticPlan
    const planInterventions: AnyDoc[] = Array.isArray(plan?.interventions) ? plan!.interventions : []
    const departmentIds = Array.from(new Set(planInterventions
        .map(item => normalizeText(item?.departmentId || item?.addedByDeptId))
        .filter(Boolean)))
    const confirmations = plan?.incubateeDepartmentConfirmationsByDeptId || plan?.incubateeDepartmentConfirmations || {}

    // SMEs are asked to respond twice per intervention: accept or decline the
    // appointment, then confirm or reject the delivered work once it is done.
    let opportunities = 0
    let responses = 0
    lifecycles.forEach(item => {
        opportunities += 1
        if (item.participantAcceptance !== 'pending') responses += 1
        if (item.assigneeCompletion === 'completed' || item.isCompleted) {
            opportunities += 1
            if (item.participantCompletion !== 'pending') responses += 1
        }
    })

    return growthFromCounts({
        documentsCovered: args.compliance.covered,
        documentsTotal: args.compliance.total,
        interventionsCompleted: lifecycles.filter(item => item.isCompleted).length,
        interventionsTotal: lifecycles.length,
        roadmapConfirmed: departmentIds.filter(id => isConfirmedValue(confirmations[id])).length,
        roadmapTotal: departmentIds.length,
        roadmapFinal: !!plan?.finalConfirmation,
        responses,
        responseOpportunities: opportunities
    })
}

/* ======================= delivery, evidence, plan ======================= */

export type TwinLifecycleCount = { key: AssignmentLifecycleKey; label: string; count: number }

export type DeliverySummary = {
    total: number
    open: number
    completed: number
    declined: number
    overdue: number
    waitingOnSme: number
    byLifecycle: TwinLifecycleCount[]
}

/** Overdue = still open by the lifecycle and past its due date (the plan's single rule). */
export function summarizeDelivery(assignments: AnyDoc[], now: Date): DeliverySummary {
    const counts = new Map<AssignmentLifecycleKey, TwinLifecycleCount>()
    const summary: DeliverySummary = { total: assignments.length, open: 0, completed: 0, declined: 0, overdue: 0, waitingOnSme: 0, byLifecycle: [] }
    assignments.forEach(assignment => {
        const { lifecycle, isDeclined } = classifyAssignment(assignment)
        const entry = counts.get(lifecycle.key) ?? { key: lifecycle.key, label: lifecycle.label, count: 0 }
        entry.count += 1
        counts.set(lifecycle.key, entry)
        if (lifecycle.isOpen) summary.open += 1
        if (lifecycle.isCompleted) summary.completed += 1
        if (isDeclined) summary.declined += 1
        if (lifecycle.waitingOn === 'participant') summary.waitingOnSme += 1
        const due = toDate(assignment.dueDate)
        if (lifecycle.isOpen && due && due.getTime() < now.getTime()) summary.overdue += 1
    })
    summary.byLifecycle = [...counts.values()].sort((a, b) => b.count - a.count)
    return summary
}

export type EvidenceSummary = { total: number; approved: number; awaitingSme: number; awaitingHod: number; draft: number }

export function summarizeEvidence(movs: AnyDoc[]): EvidenceSummary {
    const status = (mov: AnyDoc) => normalizeLower(mov?.status)
    return {
        total: movs.length,
        approved: movs.filter(mov => status(mov) === 'approved').length,
        awaitingSme: movs.filter(mov => status(mov) === 'awaiting_smme').length,
        awaitingHod: movs.filter(mov => status(mov) === 'awaiting_hod').length,
        draft: movs.filter(mov => status(mov) === 'draft').length
    }
}

/** One department in the development plan: who has confirmed it, and how many services it has assigned. */
export type PlanArea = { departmentName: string; deptConfirmed: boolean; smmeConfirmed: boolean; services: number }

export type PlanSummary = {
    departments: number
    departmentConfirmed: number
    smeConfirmed: number
    finalConfirmed: boolean
    /** Each planned department, so the twin can say who a follow-up is waiting on. */
    areas: PlanArea[]
}

/* ========================== business results ========================== */

export type BusinessSnapshot = {
    revenue: { monthly: number; month: string; source: 'QuantNow' | 'SME profile' } | null
    headcount: { total: number; period: string; source: 'SME profile' } | null
    jobsSustained: number
    jobsCreatedLast12Months: number
}

/** Walks back from this month over the last 12 month names the profile form stores. */
// The SME profile keys months by name ("September"); some records key them as
// "2026-09". The dated key is read first, because a month name carries no year.
const recentMonthNames = (now: Date) =>
    Array.from({ length: 12 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - index, 1)
        return {
            name: MONTH_NAMES[date.getMonth()],
            key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
            label: `${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`
        }
    })
const monthEntry = (monthly: AnyDoc, month: { name: string; key: string }) => monthly[month.key] ?? monthly[month.name]

export function summarizeBusiness(args: {
    participant: AnyDoc
    monthlyMetrics: AnyDoc[]
    jobContracts: AnyDoc[]
    now: Date
}): BusinessSnapshot {
    const { participant, now } = args

    let revenue: BusinessSnapshot['revenue'] = null
    const quantNow = args.monthlyMetrics
        .filter(row => Number.isFinite(Number(row?.monthlyRevenue)) && normalizeText(row?.sourceMonth))
        .sort((a, b) => normalizeText(b.sourceMonth).localeCompare(normalizeText(a.sourceMonth)))[0]
    if (quantNow) {
        revenue = { monthly: Number(quantNow.monthlyRevenue), month: normalizeText(quantNow.sourceMonth), source: 'QuantNow' }
    } else {
        const monthly = participant?.revenueHistory?.monthly || {}
        const hit = recentMonthNames(now).find(month => Number(monthEntry(monthly, month)) > 0)
        if (hit) revenue = { monthly: Number(monthEntry(monthly, hit)), month: hit.label, source: 'SME profile' }
    }

    let headcount: BusinessSnapshot['headcount'] = null
    const headcountMonthly = participant?.headcountHistory?.monthly || {}
    const totalOf = (row: AnyDoc) => Number(row?.total ?? (Number(row?.permanent || 0) + Number(row?.temporary || 0)))
    const monthHit = recentMonthNames(now).find(month => totalOf(monthEntry(headcountMonthly, month)) > 0)
    if (monthHit) {
        headcount = { total: totalOf(monthEntry(headcountMonthly, monthHit)), period: monthHit.label, source: 'SME profile' }
    } else {
        const annual = participant?.headcountHistory?.annual || {}
        const latestYear = Object.keys(annual).filter(year => totalOf(annual[year]) > 0).sort().pop()
        if (latestYear) headcount = { total: totalOf(annual[latestYear]), period: latestYear, source: 'SME profile' }
    }

    let jobsSustained = 0
    let jobsCreatedLast12Months = 0
    args.jobContracts.forEach(contract => {
        const created = toDate(contract.createdAt || contract.uploadMonthDate)
        if (!created || created.getTime() > now.getTime()) return
        const end = toDate(contract.contractEndDate)
        if (contract.contractType === 'permanent' || !end || end.getTime() >= now.getTime()) jobsSustained += 1
        if (now.getTime() - created.getTime() <= 365 * DAY_MS) jobsCreatedLast12Months += 1
    })

    return { revenue, headcount, jobsSustained, jobsCreatedLast12Months }
}

/* =============================== outlook =============================== */

export type OutlookStatus = { label: 'Needs attention' | 'Mitigation in progress' | 'Stable'; detail: string }

export type OutlookHorizon = {
    days: number
    date: string
    score: number
    level: RiskLevel
    reasons: { label: string; delta: number }[]
    /** Plain-language differences from today, each with its cause. */
    changes: string[]
    dueInterventions: Array<{ title: string; dueDate: string }>
    expiringDocuments: Array<{ title: string; expiry: string }>
}

export type Outlook = {
    status: OutlookStatus
    nextAction: string
    lastContactAt: string | null
    horizons: OutlookHorizon[]
    /** First day the level changes if nothing happens, within a year. */
    nextChange: { inDays: number; date: string; fromLevel: RiskLevel; toLevel: RiskLevel; score: number } | null
}

const formatDay = (date: Date) => date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })

/** The fields next-action rules read; an SMERow from the register fits this shape too. */
export type NextActionContext = {
    expectedDepartments: Array<{ departmentName: string; deptConfirmed: boolean; smmeConfirmed: boolean }>
    fullyConfirmedDepartmentsCount: number
    totalTouches: number
    smePendingAcceptanceCount: number
    smePendingConfirmationCount: number
    daysSinceLastService: number | null
    declinedTouches: number
}

const isOpenChallenge = (challenge: AnyDoc) => !['resolved', 'closed'].includes(normalizeLower(challenge?.status))

/** Same order of checks as the Risk Register's Risk Outlook panel. */
export function recommendNextAction(context: NextActionContext, challenges: AnyDoc[] = []): string {
    const mitigation = challenges
        .filter(isOpenChallenge)
        .flatMap(challenge => (Array.isArray(challenge.mitigationSteps) ? challenge.mitigationSteps : []))
        .map(normalizeText)
        .find(Boolean)
    if (mitigation) return mitigation

    const join = (items: Array<{ departmentName: string }>) => items.map(item => item.departmentName).join(', ')

    const pendingReviews = context.expectedDepartments.filter(dep => !dep.deptConfirmed)
    if (pendingReviews.length) {
        return pendingReviews.length === 1
            ? `Follow up with ${join(pendingReviews)} to review the Developmental Plan.`
            : `Follow up with ${join(pendingReviews)} to review their Developmental Plan sections.`
    }

    const pendingSme = context.expectedDepartments.filter(dep => dep.deptConfirmed && !dep.smmeConfirmed)
    if (pendingSme.length) {
        return pendingSme.length === 1
            ? `Remind the SME to confirm the Developmental Plan for ${join(pendingSme)}.`
            : `Remind the SME to confirm the Developmental Plans for ${join(pendingSme)}.`
    }

    if (context.fullyConfirmedDepartmentsCount > 0 && context.totalTouches === 0) {
        return 'Schedule the first service intervention for the SME.'
    }
    if (context.smePendingAcceptanceCount > 0) {
        return context.smePendingAcceptanceCount === 1
            ? 'Follow up with the SME to accept the pending intervention.'
            : `Follow up with the SME to accept ${context.smePendingAcceptanceCount} pending interventions.`
    }
    if (context.smePendingConfirmationCount > 0) {
        return context.smePendingConfirmationCount === 1
            ? 'Follow up with the SME to confirm the completed intervention.'
            : `Follow up with the SME to confirm ${context.smePendingConfirmationCount} completed interventions.`
    }
    if ((context.daysSinceLastService ?? 0) >= 30) {
        return `Schedule a follow-up service; the SME has not been serviced for ${context.daysSinceLastService} days.`
    }
    if (context.declinedTouches > 0) {
        return context.declinedTouches === 1
            ? 'Review the declined intervention and agree on the next delivery step with the SME.'
            : `Review the ${context.declinedTouches} declined interventions and agree on the next delivery steps with the SME.`
    }
    return 'Continue monitoring the SME’s service delivery progress.'
}

/** Same rule as the Risk Outlook panel's trend tag. */
export function deriveOutlookStatus(args: {
    level: RiskLevel
    challenges: AnyDoc[]
    lastContactAt: Date | null
    now: Date
}): OutlookStatus {
    const open = args.challenges.filter(isOpenChallenge)
    const hasOverdueChallenge = open.some(challenge => {
        const due = toDate(challenge.dueDate)
        return !!due && twinDayKey(due) < twinDayKey(args.now)
    })
    const contactIsRecent = !!args.lastContactAt && wholeDaysBetween(args.lastContactAt, args.now) <= 14
    if (hasOverdueChallenge || ((args.level === 'High' || args.level === 'Critical') && !contactIsRecent)) {
        return {
            label: 'Needs attention',
            detail: hasOverdueChallenge
                ? 'An open challenge is overdue.'
                : 'Current score is high and there has been no contact in the last 14 days.'
        }
    }
    if (open.length) return { label: 'Mitigation in progress', detail: 'Open mitigation work is recorded.' }
    return { label: 'Stable', detail: 'No overdue mitigation is recorded.' }
}

export function latestContactDate(challenges: AnyDoc[], reminderEmails: AnyDoc[]): Date | null {
    const dates = [
        ...challenges.flatMap(challenge => (Array.isArray(challenge.communicationAttempts) ? challenge.communicationAttempts : [])
            .map((attempt: AnyDoc) => toDate(attempt?.attemptedAt))),
        ...reminderEmails.map(email => toDate(email?.createdAt ?? email?.sentAt))
    ].filter((date): date is Date => !!date)
    return dates.sort((a, b) => b.getTime() - a.getTime())[0] ?? null
}

const inactivityLabel = (days: number) =>
    days >= 180 ? '6+ months' : days >= 90 ? '3+ months' : days >= 30 ? '1+ month' : 'under a month'

/**
 * "If nothing changes": the score on each horizon assuming no new service, no
 * responses and no new documents. Only known dates move it: days since the
 * last service grow, and documents pass their expiry dates.
 */
export function projectOutlook(args: {
    inputs: RiskScoreInputs
    complianceRows: ComplianceRow[]
    assignments: AnyDoc[]
    now: Date
    horizons?: readonly number[]
}): Pick<Outlook, 'horizons' | 'nextChange'> {
    const { inputs, complianceRows, assignments, now } = args
    const horizons = args.horizons ?? OUTLOOK_HORIZONS

    const expiringBy = (date: Date) => complianceRows.filter(row =>
        row.expiry && !['expired', 'missing'].includes(normalizeLower(row.status)) &&
        row.expiry.getTime() > now.getTime() && row.expiry.getTime() <= date.getTime()
    )
    const projectInputs = (days: number): RiskScoreInputs => ({
        ...inputs,
        daysSinceLastService: inputs.daysSinceLastService === null ? null : inputs.daysSinceLastService + days,
        docsMissing: inputs.docsMissing + expiringBy(addDays(now, days)).length
    })

    const today = computeRiskScore(inputs)
    const projected: OutlookHorizon[] = horizons.map(days => {
        const date = addDays(now, days)
        const projectedInputs = projectInputs(days)
        const result = computeRiskScore(projectedInputs)
        const expiring = expiringBy(date)
        const changes: string[] = []
        if (
            inputs.daysSinceLastService !== null && projectedInputs.daysSinceLastService !== null &&
            inactivityLabel(inputs.daysSinceLastService) !== inactivityLabel(projectedInputs.daysSinceLastService)
        ) {
            changes.push(`No service for ${projectedInputs.daysSinceLastService} days by ${formatDay(date)} (${inactivityLabel(projectedInputs.daysSinceLastService)})`)
        }
        if (expiring.length) {
            changes.push(`${expiring.length} document${expiring.length === 1 ? '' : 's'} expire${expiring.length === 1 ? 's' : ''} before ${formatDay(date)}`)
        }
        const due = assignments
            .filter(assignment => resolveAssignmentLifecycle(assignment).isOpen)
            .map(assignment => ({ title: getInterventionTitle(assignment), due: toDate(assignment.dueDate) }))
            .filter((item): item is { title: string; due: Date } =>
                !!item.due && item.due.getTime() >= now.getTime() && item.due.getTime() <= date.getTime())
            .sort((a, b) => a.due.getTime() - b.due.getTime())
        if (due.length) {
            changes.push(`${due.length} intervention${due.length === 1 ? '' : 's'} fall${due.length === 1 ? 's' : ''} due and become${due.length === 1 ? 's' : ''} overdue if not delivered`)
        }
        if (result.level !== today.level) changes.unshift(`Moves from ${today.level} to ${result.level}`)
        if (!changes.length) changes.push('No dated change expected')
        return {
            days,
            date: date.toISOString(),
            score: result.score,
            level: result.level,
            reasons: result.breakdown,
            changes,
            dueInterventions: due.map(item => ({ title: item.title, dueDate: item.due.toISOString() })),
            expiringDocuments: expiring.map(row => ({ title: row.title, expiry: row.expiry!.toISOString() }))
        }
    })

    let nextChange: Outlook['nextChange'] = null
    for (let day = 1; day <= 365; day += 1) {
        const result = computeRiskScore(projectInputs(day))
        if (result.level !== today.level) {
            nextChange = { inDays: day, date: addDays(now, day).toISOString(), fromLevel: today.level, toLevel: result.level, score: result.score }
            break
        }
    }

    return { horizons: projected, nextChange }
}

/**
 * A what-if: changes staff could make, applied to today's record. Every lever
 * moves an input the rules already use, so the result is the rules' own answer,
 * not an estimate.
 */
export type TwinScenario = {
    /** A service is delivered on this day from today (null: no service). */
    serviceInDays: number | null
    /** Missing or expired documents uploaded and verified now. */
    documentsUploaded: number
    /** Documents expiring inside the outlook are renewed before they lapse. */
    renewExpiring: boolean
    /** Queried or rejected documents corrected now. */
    documentsFixed: number
    /** Pending appointment responses and completion confirmations the SME gives now. */
    smeResponses: number
    /** Departments brought up to date on the development plan now. */
    departmentsFollowedUp: number
    /** Declined interventions resolved now. */
    declinesResolved: number
    /** Extra interventions completed (growth score). */
    interventionsCompleted: number
    /** Extra roadmap areas the SME confirms (growth score). */
    roadmapConfirmed: number
}

export const NO_CHANGE_SCENARIO: TwinScenario = {
    serviceInDays: null,
    documentsUploaded: 0,
    renewExpiring: false,
    documentsFixed: 0,
    smeResponses: 0,
    departmentsFollowedUp: 0,
    declinesResolved: 0,
    interventionsCompleted: 0,
    roadmapConfirmed: 0
}

export const isNoChangeScenario = (scenario: TwinScenario) =>
    (Object.keys(NO_CHANGE_SCENARIO) as Array<keyof TwinScenario>).every(key => scenario[key] === NO_CHANGE_SCENARIO[key])

/** How far each lever can go for this SME. */
export function scenarioLimits(record: DigitalTwinRecord) {
    const inputs = record.needsAttention.inputs
    const counts = record.growth.counts
    const furthest = record.outlook.horizons[record.outlook.horizons.length - 1]
    return {
        documentsUploaded: inputs.docsMissing,
        expiringDocuments: furthest?.expiringDocuments.length ?? 0,
        documentsFixed: inputs.docsQueried + inputs.docsRejected,
        smeResponses: inputs.smePendingAcceptanceCount + inputs.smePendingConfirmationCount,
        departmentsFollowedUp: inputs.missingDepartmentsCount,
        declinesResolved: inputs.declinedTouches,
        interventionsCompleted: counts ? Math.max(0, counts.interventionsTotal - counts.interventionsCompleted) : 0,
        roadmapConfirmed: counts && !counts.roadmapFinal ? Math.max(0, counts.roadmapTotal - counts.roadmapConfirmed) : 0
    }
}

/** The needs-attention inputs on a given day under a scenario. */
export function scenarioInputsAt(record: DigitalTwinRecord, scenario: TwinScenario, day: number): RiskScoreInputs {
    const base = record.needsAttention.inputs
    const start = new Date(record.calculatedAt).getTime()
    const furthest = record.outlook.horizons[record.outlook.horizons.length - 1]
    const lapsed = scenario.renewExpiring
        ? 0
        : (furthest?.expiringDocuments ?? []).filter(item => {
            const time = new Date(item.expiry).getTime()
            return time > start && time <= start + day * DAY_MS
        }).length
    const served = scenario.serviceInDays !== null && day >= scenario.serviceInDays
    const queriedFixed = Math.min(base.docsQueried, scenario.documentsFixed)
    const acceptancesAnswered = Math.min(base.smePendingAcceptanceCount, scenario.smeResponses)
    return {
        daysSinceLastService: served
            ? day - scenario.serviceInDays!
            : base.daysSinceLastService === null ? null : base.daysSinceLastService + day,
        hasNeverReceivedService: base.hasNeverReceivedService && !served,
        docsMissing: Math.max(0, base.docsMissing - scenario.documentsUploaded) + lapsed,
        docsQueried: base.docsQueried - queriedFixed,
        docsRejected: Math.max(0, base.docsRejected - (scenario.documentsFixed - queriedFixed)),
        missingDepartmentsCount: Math.max(0, base.missingDepartmentsCount - scenario.departmentsFollowedUp),
        smePendingAcceptanceCount: base.smePendingAcceptanceCount - acceptancesAnswered,
        smePendingConfirmationCount: Math.max(0, base.smePendingConfirmationCount - (scenario.smeResponses - acceptancesAnswered)),
        declinedTouches: Math.max(0, base.declinedTouches - scenario.declinesResolved)
    }
}

/** The needs-attention score for each day from today to `untilDays` ahead, under a scenario. */
export function scenarioCurve(record: DigitalTwinRecord, scenario: TwinScenario, untilDays: number): Array<{ day: number; score: number; level: RiskLevel }> {
    return Array.from({ length: Math.max(0, untilDays) + 1 }, (_, day) => {
        const result = computeRiskScore(scenarioInputsAt(record, scenario, day))
        return { day, score: result.score, level: result.level }
    })
}

/**
 * "If nothing changes", from a saved record alone: the same rule as
 * projectOutlook, so the chart and the saved horizons always agree.
 */
export const projectionCurve = (record: DigitalTwinRecord, untilDays: number) =>
    scenarioCurve(record, NO_CHANGE_SCENARIO, untilDays)

/** The furthest day this record's outlook looks ahead. */
export const outlookHorizonDays = (record: DigitalTwinRecord) =>
    record.outlook.horizons[record.outlook.horizons.length - 1]?.days ?? OUTLOOK_HORIZONS[OUTLOOK_HORIZONS.length - 1]

/** The growth score once the scenario's changes have happened. */
export function scenarioGrowth(record: DigitalTwinRecord, scenario: TwinScenario): GrowthScore {
    const counts = record.growth.counts
    if (!counts) return record.growth
    const answered = Math.min(scenario.smeResponses, counts.responseOpportunities - counts.responses)
    return growthFromCounts({
        ...counts,
        documentsCovered: counts.documentsCovered + scenario.documentsUploaded + scenario.documentsFixed,
        interventionsCompleted: counts.interventionsCompleted + scenario.interventionsCompleted,
        roadmapConfirmed: counts.roadmapConfirmed + scenario.roadmapConfirmed,
        responses: counts.responses + Math.max(0, answered)
    })
}

/** The move the twin tries for a service: delivered within a week. */
export const SIMULATED_SERVICE_IN_DAYS = 7

export type TwinMoveKey =
    | 'service'
    | 'documentsUploaded'
    | 'renewExpiring'
    | 'documentsFixed'
    | 'smeResponses'
    | 'departmentsFollowedUp'
    | 'declinesResolved'
    | 'interventionsCompleted'
    | 'roadmapConfirmed'

/** One move the twin simulated on its own, and what it does to the days ahead. */
export type TwinMove = {
    key: TwinMoveKey
    /** How many items the move covers: documents, responses, departments… (1 for a service). */
    amount: number
    /** The what-if levers this move pulls. */
    change: Partial<TwinScenario>
    /** Average needs attention over the days ahead with this move, and its level. */
    score: number
    level: RiskLevel
    /** Against doing nothing: negative is better. */
    scoreDelta: number
    growth: number
    growthDelta: number
}

/**
 * Needs attention averaged over every day from tomorrow to the horizon. A
 * single day would undersell a service: its effect fades back into the same
 * band by the horizon, after weeks of lower scores.
 */
export function averageOutlook(record: DigitalTwinRecord, scenario: TwinScenario, horizonDays: number): { score: number; level: RiskLevel } {
    const days = scenarioCurve(record, scenario, Math.max(1, horizonDays)).slice(1)
    const score = Math.round(days.reduce((sum, day) => sum + day.score, 0) / days.length)
    return { score, level: getRiskLevel(score) }
}

/**
 * Every move open to this SME, each run through the rules on its own, best
 * first: the biggest drop in average needs attention over the days ahead, then
 * the biggest growth gain. Moves that change nothing are left out.
 */
export function simulateMoves(record: DigitalTwinRecord, horizonDays: number): TwinMove[] {
    const limits = scenarioLimits(record)
    const candidates: Array<Pick<TwinMove, 'key' | 'amount' | 'change'>> = [
        { key: 'service', amount: 1, change: { serviceInDays: SIMULATED_SERVICE_IN_DAYS } },
        { key: 'documentsUploaded', amount: limits.documentsUploaded, change: { documentsUploaded: limits.documentsUploaded } },
        { key: 'renewExpiring', amount: limits.expiringDocuments, change: { renewExpiring: true } },
        { key: 'documentsFixed', amount: limits.documentsFixed, change: { documentsFixed: limits.documentsFixed } },
        { key: 'smeResponses', amount: limits.smeResponses, change: { smeResponses: limits.smeResponses } },
        { key: 'departmentsFollowedUp', amount: limits.departmentsFollowedUp, change: { departmentsFollowedUp: limits.departmentsFollowedUp } },
        { key: 'declinesResolved', amount: limits.declinesResolved, change: { declinesResolved: limits.declinesResolved } },
        { key: 'interventionsCompleted', amount: limits.interventionsCompleted, change: { interventionsCompleted: limits.interventionsCompleted } },
        { key: 'roadmapConfirmed', amount: limits.roadmapConfirmed, change: { roadmapConfirmed: limits.roadmapConfirmed } }
    ]
    const baseline = averageOutlook(record, NO_CHANGE_SCENARIO, horizonDays)
    return candidates
        .filter(move => move.amount > 0)
        .map(move => {
            const scenario = scenarioFromMoves([move])
            const ahead = averageOutlook(record, scenario, horizonDays)
            const growth = scenarioGrowth(record, scenario).total
            return { ...move, score: ahead.score, level: ahead.level, scoreDelta: ahead.score - baseline.score, growth, growthDelta: growth - record.growth.total }
        })
        .filter(move => move.scoreDelta < 0 || move.growthDelta > 0)
        .sort((a, b) => a.scoreDelta - b.scoreDelta || b.growthDelta - a.growthDelta)
}

/** Several moves at once, as one what-if. */
export const scenarioFromMoves = (moves: Array<Pick<TwinMove, 'change'>>): TwinScenario =>
    moves.reduce<TwinScenario>((scenario, move) => ({ ...scenario, ...move.change }), { ...NO_CHANGE_SCENARIO })

/* ========================= who it is waiting on ========================= */

/** Who has to act for a reason to go away: the SME, staff, both, or nobody. */
export type ReasonOwner = 'sme' | 'staff' | 'both' | 'none'

export type ExplainedReason = RiskReason & {
    owner: ReasonOwner
    /** The people to chase, in plain words: "SME", "Facilitators", "HOD · Finance"… */
    waitingOn: string
    detail: string
}

const countOf = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const namesOf = (names: string[], most = 3) =>
    names.length <= most ? names.join(', ') : `${names.slice(0, most).join(', ')} and ${names.length - most} more`

/**
 * Every reason for the score on a day, and who it is waiting on: the SME, or
 * staff who have not done their part. Names (departments, documents) come from
 * today's record; a later day whose counts differ is described by its counts.
 */
export function explainNeedsAttention(record: DigitalTwinRecord, inputs: RiskScoreInputs): ExplainedReason[] {
    const areas = record.plan.areas ?? []
    const outstanding = record.compliance.outstanding ?? []
    const titles = (statuses: string[]) => outstanding.filter(row => statuses.includes(normalizeLower(row.status))).map(row => row.title)
    const days = inputs.daysSinceLastService
    const toAccept = inputs.smePendingAcceptanceCount
    const toConfirm = inputs.smePendingConfirmationCount

    return computeRiskScore(inputs).breakdown.map((reason): ExplainedReason => {
        const explained = (owner: ReasonOwner, waitingOn: string, detail: string) => ({ ...reason, owner, waitingOn, detail })
        switch (reason.key) {
            case 'never-serviced': {
                const ready = areas.filter(area => area.deptConfirmed && area.smmeConfirmed).map(area => area.departmentName)
                return explained('staff', 'Facilitators', ready.length
                    ? `${namesOf(ready)} confirmed the plan, but no service has been delivered yet.`
                    : 'The plan is confirmed, but no service has been delivered yet.')
            }
            case 'service-date-unknown':
                return explained('staff', 'Facilitators', 'Services are recorded without dates, so the twin cannot tell when the SME was last served.')
            case 'inactive-6-months':
            case 'inactive-3-months':
            case 'inactive-1-month':
                return toAccept > 0
                    ? explained('both', 'Facilitators and SME', `Last service ${countOf(days ?? 0, 'day')} ago. ${countOf(toAccept, 'new intervention')} still ${toAccept === 1 ? 'waits' : 'wait'} for the SME to accept.`)
                    : explained('staff', 'Facilitators', `Last service ${countOf(days ?? 0, 'day')} ago, and nothing delivered since.`)
            case 'recently-serviced':
                return explained('none', 'On track', days ? `Served ${countOf(days, 'day')} ago; this is the base score.` : 'Served recently; this is the base score.')
            case 'documents-missing': {
                const names = titles(['missing', 'expired'])
                return explained('sme', 'SME', names.length === inputs.docsMissing
                    ? `To upload or renew: ${namesOf(names)}.`
                    : `${countOf(inputs.docsMissing, 'document')} missing or expired by then.`)
            }
            case 'documents-queried': {
                const names = titles(['queried'])
                return explained('sme', 'SME', names.length === inputs.docsQueried
                    ? `Staff queried ${namesOf(names)}; the SME has to answer.`
                    : `${countOf(inputs.docsQueried, 'queried document')} to answer.`)
            }
            case 'documents-rejected': {
                const names = titles(['rejected', 'invalid'])
                return explained('sme', 'SME', names.length === inputs.docsRejected
                    ? `To upload again: ${namesOf(names)}.`
                    : `${countOf(inputs.docsRejected, 'rejected document')} to upload again.`)
            }
            case 'departments-follow-up': {
                const toReview = areas.filter(area => !area.deptConfirmed).map(area => area.departmentName)
                const toAgree = areas.filter(area => area.deptConfirmed && !area.smmeConfirmed).map(area => area.departmentName)
                const unassigned = areas.filter(area => area.deptConfirmed && area.smmeConfirmed && area.services === 0).map(area => area.departmentName)
                if (toReview.length + toAgree.length + unassigned.length !== inputs.missingDepartmentsCount) {
                    return explained('both', 'HODs and SME', `${countOf(inputs.missingDepartmentsCount, 'department')} still ${inputs.missingDepartmentsCount === 1 ? 'needs' : 'need'} follow-up on the plan.`)
                }
                const parts = [
                    toReview.length ? `HOD to review the plan: ${namesOf(toReview)}` : '',
                    toAgree.length ? `SME to confirm the plan: ${namesOf(toAgree)}` : '',
                    unassigned.length ? `No service assigned yet: ${namesOf(unassigned)}` : ''
                ].filter(Boolean)
                const hods = [...toReview, ...unassigned]
                const owner: ReasonOwner = hods.length && toAgree.length ? 'both' : hods.length ? 'staff' : 'sme'
                const waitingOn = owner === 'sme' ? 'SME' : owner === 'both' ? 'HODs and SME' : hods.length === 1 ? `HOD · ${hods[0]}` : 'HODs'
                return explained(owner, waitingOn, `${parts.join('. ')}.`)
            }
            case 'awaiting-sme-response': {
                const parts = [
                    toAccept ? `${countOf(toAccept, 'intervention')} to accept` : '',
                    toConfirm ? `${countOf(toConfirm, 'completed intervention')} to confirm` : ''
                ].filter(Boolean)
                return explained('sme', 'SME', `The SME has ${parts.join(' and ')}.`)
            }
            case 'sme-responsiveness-floor':
                return explained('sme', 'SME', `With ${NEEDS_ATTENTION_WEIGHTS.unresponsiveThresholdCount} or more items unanswered, the score stays at ${NEEDS_ATTENTION_WEIGHTS.unresponsiveThresholdFloor} or above.`)
            case 'repeat-declines':
                return explained('both', 'SME and facilitators', `${countOf(inputs.declinedTouches, 'intervention')} declined by the SME or cancelled; agree a new plan together.`)
            case 'capped':
                return explained('none', '', 'The score never goes above 100.')
        }
    })
}

/* ================================ mirror ================================ */

/*
 * The live mirror: which records the twin reads, how many, and the newest
 * change it can see in them. Stale sources mean the twin, and the work it
 * mirrors, has gone quiet.
 */
export type MirrorFeedKey = 'interventions' | 'documents' | 'plan' | 'evidence' | 'contact' | 'business'
export type MirrorFeed = { key: MirrorFeedKey; records: number; lastChange: string | null }
export type MirrorFreshness = 'fresh' | 'ageing' | 'stale' | 'unknown'

/** A source changed within this many days is fresh; beyond the second, stale. */
export const MIRROR_FRESH_DAYS = 14
export const MIRROR_STALE_DAYS = 60

const CHANGE_FIELDS = [
    'updatedAt', 'lastUpdated', 'uploadedAt', 'submittedAt', 'completedAt', 'participantConfirmedAt',
    'assigneeCompletedAt', 'assignedAt', 'createdAt', 'uploadMonthDate', 'sourceMonth'
]

/** The newest change date on any of these documents. Future dates are ignored: they are plans, not changes. */
export function latestChange(docs: AnyDoc[], now: Date): Date | null {
    let latest: Date | null = null
    for (const item of docs) {
        for (const field of CHANGE_FIELDS) {
            const date = toDate(item?.[field])
            if (date && date.getTime() <= now.getTime() && (!latest || date.getTime() > latest.getTime())) latest = date
        }
    }
    return latest
}

export function mirrorFreshness(lastChange: string | null, now: Date): MirrorFreshness {
    const date = toDate(lastChange)
    if (!date) return 'unknown'
    const days = wholeDaysBetween(date, now)
    return days <= MIRROR_FRESH_DAYS ? 'fresh' : days <= MIRROR_STALE_DAYS ? 'ageing' : 'stale'
}

/* ================================ peers ================================ */

export type PeerDimension = 'group' | 'programme' | 'sector' | 'gender'
export type PeerMetricKey = 'needsAttention' | 'growth' | 'compliancePercent' | 'deliveryPercent' | 'revenue' | 'headcount'

export type PeerProfile = {
    twinId: string
    group: string | null
    programme: string | null
    sector: string | null
    gender: string | null
    needsAttention: number | null
    growth: number | null
    compliancePercent: number | null
    deliveryPercent: number | null
    revenue: number | null
    headcount: number | null
}

export type PeerMetric = {
    key: PeerMetricKey
    label: string
    self: number | null
    peerMedian: number | null
    /** Share of peers this SME does better than (lower is better for needs attention). */
    betterThanPercent: number | null
    lowerIsBetter: boolean
}

export type PeerComparison = { dimension: PeerDimension; value: string; peerCount: number; metrics: PeerMetric[] }

const PEER_METRICS: Array<{ key: PeerMetricKey; label: string; lowerIsBetter: boolean }> = [
    { key: 'needsAttention', label: 'Needs attention', lowerIsBetter: true },
    { key: 'growth', label: 'Growth score', lowerIsBetter: false },
    { key: 'compliancePercent', label: 'Compliance %', lowerIsBetter: false },
    { key: 'deliveryPercent', label: 'Delivery completed %', lowerIsBetter: false },
    { key: 'revenue', label: 'Monthly revenue (R)', lowerIsBetter: false },
    { key: 'headcount', label: 'Headcount', lowerIsBetter: false }
]

const PEER_DIMENSIONS: PeerDimension[] = ['group', 'programme', 'sector', 'gender']

/** Compares one SME with every other SME sharing its group, programme, sector or gender. */
export function comparePeers(self: PeerProfile, all: PeerProfile[]): PeerComparison[] {
    return PEER_DIMENSIONS.flatMap(dimension => {
        const value = normalizeText(self[dimension])
        if (!value) return []
        const peers = all.filter(peer => peer.twinId !== self.twinId && normalizeLower(peer[dimension]) === value.toLowerCase())
        if (peers.length < MIN_PEER_GROUP) return []
        const metrics = PEER_METRICS.map(metric => {
            const mine = self[metric.key]
            const values = peers.map(peer => peer[metric.key]).filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
            const better = mine === null || !values.length
                ? null
                : Math.round((values.filter(item => (metric.lowerIsBetter ? mine < item : mine > item)).length / values.length) * 100)
            return { ...metric, self: mine, peerMedian: median(values), betterThanPercent: better }
        })
        return [{ dimension, value, peerCount: peers.length, metrics }]
    })
}

/* ============================== the record ============================== */

export type TwinSource = 'daily' | 'manual' | 'live' | 'sample' | 'reconstructed'

export type DigitalTwinRecord = {
    twinId: string
    applicationId: string
    participantId: string
    programId: string | null
    programName: string | null
    smeName: string
    ownerName: string | null
    email: string | null
    profile: { group: IncubationGroup; sector: string | null; gender: string | null; province: string | null }
    day: string
    calculatedAt: string
    ruleVersion: string
    source: TwinSource

    needsAttention: NeedsAttention
    growth: GrowthScore
    delivery: DeliverySummary
    evidence: EvidenceSummary
    compliance: ComplianceSummary & { outstanding: Array<{ title: string; status: string; expiry: string | null }> }
    plan: PlanSummary
    business: BusinessSnapshot
    outlook: Outlook
    /** Filled from other SMEs' records; empty until a nightly run has saved peers. */
    peers: PeerComparison[]
    /** Set when needs attention, the outlook, delivery and plan cover one department's services only. */
    scope: TwinScope | null
    /** Needs attention through each planned department's services, so saved days also give each department's history. */
    byDepartment: DepartmentNeedsAttention[]
    /** What the twin read to build this record, and how recently each source changed. */
    mirror: MirrorFeed[]
}

export type DepartmentNeedsAttention = TwinScope & { score: number; level: RiskLevel }

export type TwinSources = {
    application: AnyDoc
    participant: AnyDoc
    program?: AnyDoc | null
    diagnosticPlans: AnyDoc[]
    assignments: AnyDoc[]
    departments: AnyDoc[]
    movs: AnyDoc[]
    complianceUploads: AnyDoc[]
    challenges?: AnyDoc[]
    reminderEmails?: AnyDoc[]
    monthlyMetrics?: AnyDoc[]
    jobContracts?: AnyDoc[]
}

/**
 * Builds one SME's twin for one programme application from its raw documents.
 * With a scope, needs attention, the outlook, delivery and plan cover that
 * department's services only, exactly as its HOD's Risk Register row does;
 * growth, evidence, compliance and business stay the whole SME's.
 */
export function buildTwinRecord(
    sources: TwinSources,
    options: { now?: Date; source: TwinSource; scope?: TwinScope | null }
): DigitalTwinRecord {
    const now = options.now ?? new Date()
    const scope = options.scope ?? null
    const { application, participant } = sources
    const participantId = getParticipantId(application)
    const programId = normalizeText(application.programId) || null
    const scoped = inProgramme(programId)

    const assignments = sources.assignments.filter(scoped)
    const diagnosticPlan = pickPlanForProgramme(sources.diagnosticPlans, programId)
    const movs = sources.movs.filter(scoped)
    const challenges = (sources.challenges ?? []).filter(scoped)
    const reminderEmails = sources.reminderEmails ?? []
    const { byId, byName } = indexDepartments(sources.departments)
    const coverageFor = (slice: TwinScope | null) =>
        deriveDeliveryCoverage({ diagnosticPlan, assignments, departmentsById: byId, departmentsByName: byName, scope: slice ?? undefined })
    const coverage = coverageFor(scope)
    const scopedAssignments = scope
        ? assignments.filter(item => departmentMatchesScope(getInterventionDepartmentKey(item, byId, byName), scope))
        : assignments

    const embeddedDocuments: AnyDoc[] = Array.isArray(application.complianceDocuments) ? application.complianceDocuments : []
    const complianceRows = resolveComplianceRows({
        requirements: normalizeProgramRequirements(sources.program?.programRequirements || []),
        embedded: embeddedDocuments,
        uploads: sources.complianceUploads,
        now
    })
    const monthlyMetrics = (sources.monthlyMetrics ?? []).filter(scoped)
    const jobContracts = sources.jobContracts ?? []
    const compliance = summarizeCompliance(complianceRows)

    const riskDocs = complianceRiskDocs(compliance)
    const inputs = needsAttentionInputs(coverage, riskDocs, now)
    const needsAttention = computeNeedsAttention(inputs)
    const wholeCoverage = scope ? coverageFor(null) : coverage
    const byDepartment = wholeCoverage.expectedDepartments.map(dep => {
        const slice = { departmentId: dep.departmentId, departmentName: dep.departmentName }
        const result = computeNeedsAttention(needsAttentionInputs(coverageFor(slice), riskDocs, now))
        return { ...slice, score: result.score, level: result.level }
    })
    const lastContact = latestContactDate(challenges, reminderEmails)
    const nextActionContext: NextActionContext = {
        expectedDepartments: coverage.expectedDepartments,
        fullyConfirmedDepartmentsCount: coverage.fullyConfirmedDepartments.length,
        totalTouches: coverage.totalTouches,
        smePendingAcceptanceCount: coverage.smePendingAcceptanceCount,
        smePendingConfirmationCount: coverage.smePendingConfirmationCount,
        daysSinceLastService: inputs.daysSinceLastService,
        declinedTouches: coverage.declinedTouches
    }

    const projection = projectOutlook({ inputs, complianceRows, assignments: scopedAssignments, now })

    return {
        twinId: twinIdFor(participantId, programId),
        applicationId: normalizeText(application.id),
        participantId,
        programId,
        programName: normalizeText(firstNonEmpty(application.programName, sources.program?.name, sources.program?.title)) || null,
        smeName: normalizeText(firstNonEmpty(application.beneficiaryName, application.businessName, participant?.beneficiaryName)) || 'Unnamed SME',
        ownerName: normalizeText(firstNonEmpty(participant?.participantName, participant?.name)) || null,
        email: getEmail(application) ?? getEmail(participant) ?? null,
        profile: {
            group: resolveGroup(application, participant),
            sector: normalizeText(firstNonEmpty(participant?.sector, application.sector)) || null,
            gender: normalizeText(firstNonEmpty(application.gender, participant?.gender)) || null,
            province: normalizeText(firstNonEmpty(application.province, participant?.province)) || null
        },
        day: twinDayKey(now),
        calculatedAt: now.toISOString(),
        ruleVersion: TWIN_RULE_VERSION,
        source: options.source,

        needsAttention,
        growth: computeGrowthScore({ assignments, compliance, diagnosticPlan }),
        delivery: summarizeDelivery(scopedAssignments, now),
        evidence: summarizeEvidence(movs),
        compliance: {
            ...compliance,
            outstanding: complianceRows
                .filter(row => !row.covered)
                .slice(0, 20)
                .map(row => ({ title: row.title, status: String(row.status), expiry: iso(row.expiry) }))
        },
        plan: {
            departments: coverage.expectedDepartments.length,
            departmentConfirmed: coverage.expectedDepartments.filter(dep => dep.deptConfirmed).length,
            smeConfirmed: coverage.expectedDepartments.filter(dep => dep.smmeConfirmed).length,
            finalConfirmed: !!diagnosticPlan?.finalConfirmation,
            areas: coverage.expectedDepartments.map(dep => ({
                departmentName: dep.departmentName,
                deptConfirmed: dep.deptConfirmed,
                smmeConfirmed: dep.smmeConfirmed,
                services: dep.servicedCount
            }))
        },
        business: summarizeBusiness({ participant, monthlyMetrics, jobContracts, now }),
        outlook: {
            status: deriveOutlookStatus({ level: needsAttention.level, challenges, lastContactAt: lastContact, now }),
            nextAction: recommendNextAction(nextActionContext, challenges),
            lastContactAt: iso(lastContact),
            ...projection
        },
        peers: [],
        scope,
        byDepartment,
        mirror: [
            { key: 'interventions', records: assignments.length, lastChange: iso(latestChange(assignments, now)) },
            { key: 'documents', records: complianceRows.length, lastChange: iso(latestChange([...sources.complianceUploads, ...embeddedDocuments], now)) },
            { key: 'plan', records: wholeCoverage.expectedDepartments.length, lastChange: iso(latestChange(diagnosticPlan ? [diagnosticPlan] : [], now)) },
            { key: 'evidence', records: movs.length, lastChange: iso(latestChange(movs, now)) },
            { key: 'contact', records: challenges.length + reminderEmails.length, lastChange: iso(lastContact) },
            { key: 'business', records: monthlyMetrics.length + jobContracts.length, lastChange: iso(latestChange([...monthlyMetrics, ...jobContracts], now)) }
        ]
    }
}

/** The slice of a record that peers are compared on. */
export function peerProfileOf(record: DigitalTwinRecord): PeerProfile {
    return {
        twinId: record.twinId,
        group: record.profile.group,
        programme: record.programName || record.programId,
        sector: record.profile.sector,
        gender: record.profile.gender,
        needsAttention: record.needsAttention.score,
        growth: record.growth.total,
        compliancePercent: record.compliance.total ? Math.round((record.compliance.covered / record.compliance.total) * 100) : null,
        deliveryPercent: record.delivery.total ? Math.round((record.delivery.completed / record.delivery.total) * 100) : null,
        revenue: record.business.revenue?.monthly ?? null,
        headcount: record.business.headcount?.total ?? null
    }
}
