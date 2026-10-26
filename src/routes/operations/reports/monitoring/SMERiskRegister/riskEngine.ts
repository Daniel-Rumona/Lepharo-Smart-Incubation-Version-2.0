import type { CSSProperties } from 'react'
import {
    normalizeText,
    normalizeLower,
    firstNonEmpty,
    toDate,
    getParticipantId,
    getEmail,
    normalizeDepartmentName,
    getInterventionDepartmentKey,
    getBestInterventionDate,
    getInterventionTitle,
    isConfirmedValue,
    isDeptConfirmedForDp,
    isSmmeConfirmedForDp,
    getRiskLevel,
    getDepartmentDocForKey,
    isInterventionsDepartment,
    isDpInterventionDepartment,
    getEligibleDpInterventions,
    departmentMatchesScope,
    computeRiskScore,
    deriveDeliveryCoverage,
    needsAttentionInputs
} from '@twin/rules'

import type {
    AnyDoc,
    BounceStatus,
    CommunicationAttempt,
    DepartmentAction,
    DepartmentSummary,
    InactivityBucket,
    OperationalChallenge,
    ReminderEmailLog,
    RiskLevel,
    RiskScoreInputs,
    RiskScoreResult,
    ServiceProgressRow,
    ServiceRecencyFilter,
    SMERow
} from './types'

// Shared with the digital twin (functions/src/twin/rules.ts): one implementation of
// these helpers and of the needs-attention score for the register and the twin.
export {
    normalizeText,
    normalizeLower,
    firstNonEmpty,
    toDate,
    getParticipantId,
    getEmail,
    normalizeDepartmentName,
    getInterventionDepartmentKey,
    getBestInterventionDate,
    getInterventionTitle,
    isConfirmedValue,
    isDeptConfirmedForDp,
    isSmmeConfirmedForDp,
    getRiskLevel,
    getDepartmentDocForKey,
    isInterventionsDepartment,
    isDpInterventionDepartment,
    getEligibleDpInterventions,
    departmentMatchesScope,
    computeRiskScore
}

export const DOC_REQUIRED_KEYS = [
    'companyProfile',
    'registrationDocument',
    'directorsIds',
    'bankConfirmationLetter',
    'beeCertificate',
    'shareholderCertificates',
    'assessmentForm',
    'preIncubationContract',
    'gapAnalysis',
    'moa'
]

// Centralized color tokens so risk-level colors live in one place instead of being
// scattered across tag/row-style helpers as a mix of AntD tokens and raw hex.
export const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
    Critical: '#820014',
    High: '#cf1322',
    Medium: 'gold',
    Low: 'green'
}

export const RISK_ROW_BACKGROUND: Record<RiskLevel, string> = {
    Critical: '#ffccc7',
    High: '#fff1f0',
    Medium: '#fffbe6',
    Low: '#f6ffed'
}

export const INACTIVITY_TAG_COLORS: Record<InactivityBucket, string> = {
    'Never Serviced': 'red',
    '6 Months': 'red',
    '3 Months': 'volcano',
    '1 Month': 'gold',
    'Recently Serviced': 'green'
}

export const SEMANTIC_DANGER_COLOR = '#a8071a'
export const SEMANTIC_SUCCESS_COLOR = '#389e0d'

export function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map(v => normalizeText(v)).filter(Boolean))]
}

export function getApplicationId(doc: AnyDoc): string | undefined {
    return firstNonEmpty(doc.applicationId, doc.applicationID, doc.appId)
}

export function getProgramId(doc: AnyDoc): string | undefined {
    const value = firstNonEmpty(doc.programId, doc.programID, doc.selectedProgramId)
    return value ? String(value) : undefined
}

export function getSMEName(application?: AnyDoc): string {
    return String(firstNonEmpty(application?.beneficiaryName, application?.businessName, 'Unnamed SME'))
}

export function getOwnerName(participant?: AnyDoc): string | undefined {
    const value = firstNonEmpty(participant?.participantName, participant?.name)
    return value ? String(value) : undefined
}

export function getGroup(application?: AnyDoc): string | undefined {
    const value = firstNonEmpty(application?.gapGroup, application?.group, application?.complianceGroup)
    return value ? String(value) : undefined
}

export function isInternalQuantilytixEmail(email?: string): boolean {
    return !!email && email.endsWith('@quantilytix.co.za')
}

export function getStatus(doc: AnyDoc): string | undefined {
    const value = firstNonEmpty(doc.status, doc.applicationStatus, doc.participantStatus)
    return value ? String(value) : undefined
}

export function getDateJoined(application?: AnyDoc, participant?: AnyDoc): Date | null {
    return toDate(
        firstNonEmpty(
            application?.acceptedAt,
            application?.dateAccepted,
            application?.joinedAt,
            application?.createdAt,
            participant?.acceptedAt,
            participant?.joinedAt,
            participant?.createdAt
        )
    )
}

export function getInterventionParticipantId(doc: AnyDoc): string {
    return (
        firstNonEmpty(
            doc.participantId,
            doc.participantID,
            doc.smeId,
            doc.incubateeId,
            doc.applicationParticipantId,
            doc.clientId
        ) ?? ''
    )
}

export function getInterventionStatus(doc: AnyDoc): string {
    return normalizeLower(
        firstNonEmpty(
            doc.status,
            doc.interventionStatus,
            doc.assignmentStatus
        )
    )
}

export function isPendingLifecycleStatus(value: any) {
    const v = normalizeLower(value).replace(/_/g, '-')
    return !v || ['pending', 'assigned', 'awaiting', 'new'].includes(v)
}

export function isAcceptedLifecycleStatus(value: any) {
    const v = normalizeLower(value).replace(/_/g, '-')
    return ['accepted', 'confirmed', 'approved'].includes(v)
}

export function isCompletedLifecycleStatus(value: any) {
    const v = normalizeLower(value).replace(/_/g, '-')
    return ['done', 'completed', 'complete', 'confirmed', 'approved', 'closed'].includes(v)
}

export function isDeclinedLifecycleStatus(value: any) {
    const v = normalizeLower(value).replace(/_/g, '-')
    return ['declined', 'rejected', 'cancelled', 'canceled'].includes(v)
}

export function getCanonicalInterventionStatus(doc: AnyDoc): 'assigned' | 'in_progress' | 'completed' | 'declined' | 'unknown' {
    const status = normalizeLower(firstNonEmpty(doc.status, doc.interventionStatus, doc.assignmentStatus)).replace(/-/g, '_')
    const assigneeAcceptanceStatus = normalizeLower(doc?.assigneeAcceptanceStatus)
    const participantAcceptanceStatus = normalizeLower(doc?.participantAcceptanceStatus)
    const assigneeCompletionStatus = normalizeLower(doc?.assigneeCompletionStatus)
    const participantCompletionStatus = normalizeLower(doc?.participantCompletionStatus)

    if (
        isDeclinedLifecycleStatus(status) ||
        isDeclinedLifecycleStatus(participantAcceptanceStatus) ||
        isDeclinedLifecycleStatus(assigneeAcceptanceStatus)
    ) {
        return 'declined'
    }

    if (
        status === 'completed' ||
        (isCompletedLifecycleStatus(assigneeCompletionStatus) &&
            isCompletedLifecycleStatus(participantCompletionStatus))
    ) {
        return 'completed'
    }

    if (
        status === 'in_progress' ||
        status === 'in progress' ||
        isAcceptedLifecycleStatus(participantAcceptanceStatus) ||
        isCompletedLifecycleStatus(assigneeCompletionStatus)
    ) {
        return 'in_progress'
    }

    if (status === 'assigned' || isAcceptedLifecycleStatus(assigneeAcceptanceStatus) || isPendingLifecycleStatus(assigneeAcceptanceStatus)) {
        return 'assigned'
    }

    return 'unknown'
}

export function getInterventionStatusLabel(status: ReturnType<typeof getCanonicalInterventionStatus>) {
    const labels: Record<ReturnType<typeof getCanonicalInterventionStatus>, string> = {
        assigned: 'Assigned',
        in_progress: 'In Progress',
        completed: 'Completed',
        declined: 'Declined',
        unknown: 'Unknown'
    }
    return labels[status]
}

export function getInterventionStatusColor(status: ReturnType<typeof getCanonicalInterventionStatus>) {
    const colors: Record<ReturnType<typeof getCanonicalInterventionStatus>, string> = {
        assigned: 'blue',
        in_progress: 'gold',
        completed: 'green',
        declined: 'volcano',
        unknown: 'default'
    }
    return colors[status]
}

export function getInterventionBottleneck(doc: AnyDoc): string {
    const c = getCanonicalInterventionStatus(doc)

    if (c === 'assigned') {
        if (isPendingLifecycleStatus(doc?.participantAcceptanceStatus)) {
            return 'Awaiting SME Acceptance'
        }

        return '-'
    }

    if (c === 'in_progress') {
        if (isPendingLifecycleStatus(doc?.assigneeCompletionStatus)) {
            return 'Awaiting Facilitator Completion'
        }

        if (isCompletedLifecycleStatus(doc?.assigneeCompletionStatus)) {
            const u = doc?.participantCompletionStatus
            if (!isCompletedLifecycleStatus(u)) return 'Awaiting SME Intervention Confirmation'
        }

        return '-'
    }

    return '-'
}

export function getComputedProgress(doc: AnyDoc): number {
    const value = Number(doc?.computedProgress ?? 0)
    return Number.isFinite(value) ? value : 0
}

export function isCompletedStatus(status: string) {
    return [
        'completed',
        'done',
        'confirmed',
        'approved',
        'attended',
        'closed'
    ].includes(status)
}

export function isDeclinedStatus(status: string) {
    return ['declined', 'rejected', 'cancelled', 'canceled'].includes(status)
}

export function evaluateInterventionState(doc: AnyDoc) {
    const assigneeAcceptanceStatus = normalizeLower(doc?.assigneeAcceptanceStatus)
    const participantAcceptanceStatus = normalizeLower(doc?.participantAcceptanceStatus)
    const assigneeCompletionStatus = normalizeLower(doc?.assigneeCompletionStatus)
    const participantCompletionStatus = normalizeLower(doc?.participantCompletionStatus)
    const overallStatus = normalizeLower(doc?.status)

    const isCompleted =
        overallStatus === 'completed' ||
        (['done', 'completed'].includes(assigneeCompletionStatus) && participantCompletionStatus === 'confirmed')

    const isDeclined =
        overallStatus === 'declined' ||
        participantAcceptanceStatus === 'declined'

    const consultantAccepted = !['declined', 'rejected'].includes(assigneeAcceptanceStatus)
    const userAccepted = participantAcceptanceStatus === 'accepted' || participantAcceptanceStatus === 'confirmed'

    const awaitingSMEAcceptance =
        !isCompleted &&
        !isDeclined &&
        consultantAccepted &&
        !userAccepted

    const awaitingSMECompletion =
        !isCompleted &&
        !isDeclined &&
        consultantAccepted &&
        userAccepted &&
        ['done', 'completed'].includes(assigneeCompletionStatus) &&
        participantCompletionStatus !== 'confirmed'

    const otherPending =
        !isCompleted &&
        !isDeclined &&
        !awaitingSMEAcceptance &&
        !awaitingSMECompletion

    return {
        isCompleted,
        isDeclined,
        awaitingSMEAcceptance,
        awaitingSMECompletion,
        otherPending
    }
}

export function parseComplianceDocuments(application: AnyDoc): {
    total: number
    completed: number
    missing: number
    pending: number
    queried: number
    rejected: number
} {
    const docsArray = Array.isArray(application?.complianceDocuments)
        ? application.complianceDocuments
        : Array.isArray(application?.documents)
            ? application.documents
            : Array.isArray(application?.requiredDocs)
                ? application.requiredDocs
                : []

    if (docsArray.length > 0) {
        let completed = 0
        let missing = 0
        let pending = 0
        let queried = 0
        let rejected = 0

        docsArray.forEach((doc: AnyDoc) => {
            const status = normalizeLower(
                firstNonEmpty(doc.status, doc.verificationStatus, doc.reviewStatus)
            )

            const hasFile =
                !!firstNonEmpty(
                    doc.url,
                    doc.downloadURL,
                    doc.fileUrl,
                    doc.fileURL,
                    doc.fileName,
                    doc.storagePath
                )

            if (['verified', 'approved', 'accepted', 'complete', 'completed'].includes(status)) {
                completed += 1
            } else if (['queried', 'query', 'needs revision', 'needs_reupload'].includes(status)) {
                queried += 1
            } else if (['rejected', 'invalid', 'declined'].includes(status)) {
                rejected += 1
            } else if (hasFile) {
                pending += 1
            } else {
                missing += 1
            }
        })

        return {
            total: docsArray.length,
            completed,
            missing,
            pending,
            queried,
            rejected
        }
    }

    const flags = DOC_REQUIRED_KEYS.map((key) => {
        const raw = application?.[key]
        const status = normalizeLower(raw?.status ?? raw?.verificationStatus ?? raw)
        const hasFile =
            !!firstNonEmpty(
                raw?.url,
                raw?.downloadURL,
                raw?.fileUrl,
                raw?.storagePath,
                typeof raw === 'string' ? raw : undefined
            )

        if (['verified', 'approved', 'accepted', 'complete', 'completed', 'true'].includes(status)) {
            return 'completed'
        }
        if (['queried', 'query', 'needs revision'].includes(status)) return 'queried'
        if (['rejected', 'invalid', 'declined'].includes(status)) return 'rejected'
        if (hasFile) return 'pending'
        return 'missing'
    })

    return {
        total: flags.length,
        completed: flags.filter(v => v === 'completed').length,
        missing: flags.filter(v => v === 'missing').length,
        pending: flags.filter(v => v === 'pending').length,
        queried: flags.filter(v => v === 'queried').length,
        rejected: flags.filter(v => v === 'rejected').length
    }
}

export function getInactivityBucket(daysSince: number | null): InactivityBucket {
    if (daysSince === null) return 'Never Serviced'
    if (daysSince >= 180) return '6 Months'
    if (daysSince >= 90) return '3 Months'
    if (daysSince >= 30) return '1 Month'
    return 'Recently Serviced'
}

export function getUserId(doc?: AnyDoc): string | undefined {
    if (!doc) return undefined
    const value = firstNonEmpty(doc.uid, doc.userId, doc.authUid, doc.firebaseUid, doc.id)
    return value ? String(value).trim() : undefined
}

export function getRiskRowStyle(level: RiskLevel): CSSProperties {
    return { backgroundColor: RISK_ROW_BACKGROUND[level] }
}

export function isOpenChallengeStatus(value: any) {
    return !['resolved', 'closed'].includes(normalizeLower(value))
}

export function getChallengeStatusColor(value: any) {
    const status = normalizeLower(value)
    if (status === 'resolved' || status === 'closed') return 'green'
    if (status === 'in progress') return 'blue'
    return 'gold'
}

export function getActionStatusColor(status?: string) {
    const s = normalizeLower(status).replace(/\s+/g, '_')
    if (s === 'completed') return 'green'
    if (s === 'in_progress') return 'gold'
    if (s === 'assigned') return 'blue'
    if (s === 'declined') return 'volcano'
    return 'default'
}

export function getSystemAccessInfo(application?: AnyDoc, participant?: AnyDoc, sessions: AnyDoc[] = []) {
    const email = getEmail(application) ?? getEmail(participant)
    const uid = getUserId(participant) ?? getUserId(application)
    const directAccessDate = toDate(
        firstNonEmpty(
            participant?.lastSeenAt,
            participant?.lastLoginAt,
            participant?.lastSignInAt,
            participant?.lastSignInTime,
            application?.lastSeenAt,
            application?.lastLoginAt,
            application?.lastSignInAt,
            application?.lastSignInTime
        )
    )

    const matchedSessions = sessions.filter(session => {
        const sessionEmail = getEmail(session)
        const sessionUid = normalizeText(firstNonEmpty(session?.uid, session?.userId))
        return (!!email && sessionEmail === email) || (!!uid && sessionUid === uid)
    })

    const latestSessionDate =
        matchedSessions
            .map(session => toDate(firstNonEmpty(session?.lastSeenAt, session?.startedAt)))
            .filter(Boolean)
            .sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null

    const lastSystemAccessDate =
        [directAccessDate, latestSessionDate]
            .filter(Boolean)
            .sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null

    return {
        hasAccessedSystem:
            !!lastSystemAccessDate ||
            participant?.signedIn === true ||
            application?.signedIn === true ||
            participant?.hasSignedIn === true ||
            application?.hasSignedIn === true,
        lastSystemAccessDate
    }
}

export function hasActiveWarnings(row: SMERow) {
    return (
        row.expectedDepartments.some(dep => !dep.deptConfirmed) ||
        row.expectedDepartments.some(dep => dep.deptConfirmed && !dep.smmeConfirmed) ||
        row.notes.length > 0 ||
        row.noServiceReasons.length > 0
    )
}

export function buildServiceProgressRows(dep: DepartmentSummary): ServiceProgressRow[] {
    const usedActionIds = new Set<string>()

    const expectedRows = dep.expectedInterventionTitles.map((title, index) => {
        const action = dep.actions.find(item => {
            if (usedActionIds.has(item.assignmentId)) return false
            return normalizeLower(item.title) === normalizeLower(title)
        })

        if (action) usedActionIds.add(action.assignmentId)

        return {
            key: `expected-${dep.departmentId}-${index}-${title}`,
            expectedTitle: title,
            action,
            isExpected: true,
            consultantName: action?.consultantName,
            cycleKey: action?.cycleKey,
            progress: action?.progress,
            date: action?.date ?? null
        }
    })

    const extraActionRows = dep.actions
        .filter(action => !usedActionIds.has(action.assignmentId))
        .map(action => ({
            key: `action-${action.assignmentId}`,
            expectedTitle: action.title,
            action,
            isExpected: false,
            consultantName: action.consultantName,
            cycleKey: action.cycleKey,
            progress: action.progress,
            date: action.date
        }))

    return [...expectedRows, ...extraActionRows]
}

export function matchesServiceRecency(row: SMERow, filter: ServiceRecencyFilter): boolean {
    if (filter === 'all') return true
    if (filter === 'never_serviced') return row.totalTouches === 0 || row.daysSinceLastService === null
    if (row.daysSinceLastService === null) return false
    if (filter === 'six_months') return row.daysSinceLastService >= 180
    if (filter === 'three_months') return row.daysSinceLastService >= 90 && row.daysSinceLastService < 180
    return row.daysSinceLastService >= 30 && row.daysSinceLastService < 90
}

export function getSMEChallenges(
    challenges: OperationalChallenge[],
    participantId: string,
    resolvedProgramId?: string
): OperationalChallenge[] {
    return challenges
        .filter(challenge => (challenge.smeIds || []).some(id => String(id) === String(participantId)))
        .filter(challenge => !resolvedProgramId || !challenge.programId || String(challenge.programId) === String(resolvedProgramId))
}

export function getCommunicationAttempts(
    challenges: OperationalChallenge[],
    participantId: string,
    resolvedProgramId?: string
): Array<CommunicationAttempt & { challengeId: string; challengeTitle: string; challengeStatus: string; mitigationSteps: string[] }> {
    return getSMEChallenges(challenges, participantId, resolvedProgramId)
        .flatMap(challenge => (challenge.communicationAttempts || []).map(attempt => ({
            ...attempt,
            challengeId: challenge.id,
            challengeTitle: challenge.title || 'Operational challenge',
            challengeStatus: challenge.status || 'Open',
            mitigationSteps: challenge.mitigationSteps || []
        })))
        .sort((a, b) => (toDate(b.attemptedAt)?.getTime() || 0) - (toDate(a.attemptedAt)?.getTime() || 0))
}

export function getReminderEmails(emailLogs: ReminderEmailLog[], participantId: string): ReminderEmailLog[] {
    return emailLogs
        .filter(log => String(log.participantId || '') === String(participantId))
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
}

export function getBounceStatus(emailSuppressions: BounceStatus[], participantId: string): BounceStatus | undefined {
    return emailSuppressions.find(entry => String(entry.participantId || '') === String(participantId))
}


export function getRiskDriversForRow(row: SMERow): Array<{
    key: string
    label: string
    points: number
}> {
    const result = computeRiskScore({
        daysSinceLastService: row.daysSinceLastService,
        hasNeverReceivedService:
            row.fullyConfirmedDepartmentsCount > 0 &&
            row.totalTouches === 0,
        docsMissing: row.docsMissing,
        docsQueried: row.docsQueried,
        docsRejected: row.docsRejected,
        missingDepartmentsCount: row.missingDepartmentsCount,
        smePendingAcceptanceCount: row.smePendingAcceptanceCount,
        smePendingConfirmationCount: row.smePendingConfirmationCount,
        declinedTouches: row.declinedTouches
    })

    return result.breakdown
        .filter(item => item.delta > 0)
        .map((item, index) => ({
            key: `risk-driver-${index}-${normalizeLower(item.label)
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')}`,
            label: item.label,
            points: item.delta
        }))
}

export function buildRow(args: {
    participant: AnyDoc
    application: AnyDoc
    diagnosticPlan?: AnyDoc
    assignments: AnyDoc[]
    sessions: AnyDoc[]
    departmentsById: Record<string, AnyDoc>
    departmentsByName: Record<string, AnyDoc>
    scopedDepartment?: {
        departmentId?: string
        departmentName?: string
    }
}): SMERow {
    const { participant, application, diagnosticPlan, assignments, sessions, departmentsById, departmentsByName, scopedDepartment } = args
    const participantId = getParticipantId(application ?? participant ?? {})
    const applicationId = getApplicationId(application ?? participant ?? {})
    const docs = parseComplianceDocuments(application ?? {})
    const accessInfo = getSystemAccessInfo(application, participant, sessions)

    // Coverage comes from the shared twin rules, so the register and the digital
    // twin count completed, declined and waiting-on-SME the same way: through
    // resolveAssignmentLifecycle, not a separate set of status checks.
    const coverage = deriveDeliveryCoverage({
        diagnosticPlan,
        assignments,
        departmentsById,
        departmentsByName,
        scope: scopedDepartment
    })

    const actionsByDepartment = new Map<string, DepartmentAction[]>()
    coverage.matchedAssignments.forEach(({ assignment, departmentId }) => {
        const actions = actionsByDepartment.get(departmentId) ?? []
        actions.push({
            assignmentId: String(assignment.id),
            interventionId: normalizeText(assignment?.interventionId) || undefined,
            title: getInterventionTitle(assignment),
            status: getInterventionStatusLabel(getCanonicalInterventionStatus(assignment)),
            bottleneck: getInterventionBottleneck(assignment),
            cycleKey: assignment?.cycleKey || null,
            consultantName: normalizeText(assignment?.assigneeName) || undefined,
            date: getBestInterventionDate(assignment),
            progress: getComputedProgress(assignment)
        })
        actionsByDepartment.set(departmentId, actions)
    })

    const expectedDepartments: DepartmentSummary[] = coverage.expectedDepartments.map(item => ({
        ...item,
        actions: [...(actionsByDepartment.get(item.departmentId) ?? [])].sort((a, b) => {
            const at = a.date ? a.date.getTime() : 0
            const bt = b.date ? b.date.getTime() : 0
            return bt - at
        })
    }))

    const servicedDepartments = expectedDepartments.filter(item => item.servicedCount > 0)
    const missingDepartments = expectedDepartments.filter(
        item => !item.deptConfirmed || !item.smmeConfirmed || item.servicedCount === 0
    )
    const fullyConfirmedDepartments = expectedDepartments.filter(item => item.deptConfirmed && item.smmeConfirmed)

    const {
        smePendingAcceptanceCount,
        smePendingConfirmationCount,
        completedTouches,
        pendingTouches,
        declinedTouches,
        totalTouches,
        totalExpectedInterventions,
        lastInterventionDate,
        eligiblePlanInterventionCount
    } = coverage

    const riskInputs = needsAttentionInputs(coverage, docs, new Date())
    const { daysSinceLastService } = riskInputs
    const inactivityBucket = getInactivityBucket(daysSinceLastService)
    const { score: riskScore, level: riskLevel, breakdown: riskBreakdown } = computeRiskScore(riskInputs)

    const notes: string[] = []
    const noServiceReasons: string[] = []
    const responsivenessRiskDepartments = coverage.responsivenessRiskDepartments

    if (docs.missing > 0) notes.push(`${docs.missing} missing document${docs.missing > 1 ? 's' : ''}`)
    if (docs.queried > 0) notes.push(`${docs.queried} queried document${docs.queried > 1 ? 's' : ''}`)
    if (docs.rejected > 0) notes.push(`${docs.rejected} rejected document${docs.rejected > 1 ? 's' : ''}`)
    if (smePendingConfirmationCount > 0) {
        notes.push(`Unresponsive: ${smePendingConfirmationCount} completed intervention(s) pending SME confirmation`)
    }
    if (smePendingAcceptanceCount > 0) {
        notes.push(`Unresponsive: ${smePendingAcceptanceCount} assigned intervention(s) pending SME acceptance`)
    }
    if (smePendingAcceptanceCount + smePendingConfirmationCount >= 3 && responsivenessRiskDepartments.length) {
        noServiceReasons.push(`SME responsiveness threshold reached for: ${responsivenessRiskDepartments.join(', ')}.`)
    }

    if (!diagnosticPlan) {
        notes.push('No diagnostic plan linked')
        noServiceReasons.push('No diagnostic plan has been created or linked for this SME.')
    } else if (eligiblePlanInterventionCount === 0) {
        notes.push('Diagnostic plan has no intervention department services')
        noServiceReasons.push('The diagnostic plan does not list services for departments marked as intervention departments.')
    } else if (fullyConfirmedDepartments.length === 0) {
        if (!accessInfo.hasAccessedSystem) {
            noServiceReasons.push('The SME has never accessed the system.')
        }
    } else if (missingDepartments.length > 0) {
        notes.push(`${missingDepartments.length} department(s) need confirmation or service follow-up`)
        missingDepartments.forEach(dep => {
            if (dep.deptConfirmed && dep.smmeConfirmed && dep.servicedCount === 0) {
                noServiceReasons.push(`${dep.departmentName}: Developmental Plan is confirmed, but no service has been assigned.`)
            }
        })
    }

    if (totalTouches === 0 && fullyConfirmedDepartments.length > 0) {
        notes.push('No assigned interventions recorded yet for confirmed departments')
        if (!accessInfo.hasAccessedSystem) {
            noServiceReasons.push('The SME has never accessed the system.')
        }
    }

    if (daysSinceLastService !== null) {
        if (daysSinceLastService >= 180) notes.push('No service in 6+ months')
        else if (daysSinceLastService >= 90) notes.push('No service in 3+ months')
        else if (daysSinceLastService >= 30) notes.push('No service in 1 month+')
    }

    return {
        key: participantId || applicationId || Math.random().toString(36),
        participantId,
        applicationId,
        programId: getProgramId(application ?? participant),

        smeName: getSMEName(application),
        ownerName: getOwnerName(participant),
        currentGroup: getGroup(application),
        status: getStatus(application ?? participant),
        dateJoined: getDateJoined(application, participant),

        docsCompleted: docs.completed,
        docsTotal: docs.total,
        docsMissing: docs.missing,
        docsPending: docs.pending,
        docsQueried: docs.queried,
        docsRejected: docs.rejected,

        expectedDepartments,
        servicedDepartments,
        missingDepartments,

        expectedDepartmentsCount: expectedDepartments.length,
        servicedDepartmentsCount: servicedDepartments.length,
        missingDepartmentsCount: missingDepartments.length,
        deptConfirmedCount: expectedDepartments.filter(dep => dep.deptConfirmed).length,
        smmeConfirmedCount: expectedDepartments.filter(dep => dep.smmeConfirmed).length,
        fullyConfirmedDepartmentsCount: fullyConfirmedDepartments.length,

        totalExpectedInterventions,
        totalTouches,
        completedTouches,
        pendingTouches,
        declinedTouches,
        smePendingAcceptanceCount,
        smePendingConfirmationCount,
        responsivenessRiskDepartments,

        lastInterventionDate,
        daysSinceLastService,
        inactivityBucket,

        riskScore,
        riskLevel,
        riskBreakdown,
        notes,
        noServiceReasons: uniqueStrings(noServiceReasons),
        hasAccessedSystem: accessInfo.hasAccessedSystem,
        lastSystemAccessDate: accessInfo.lastSystemAccessDate
    }
}
