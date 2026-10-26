"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendNextAction = exports.summarizeBusiness = exports.summarizeEvidence = exports.summarizeDelivery = exports.computeGrowthScore = exports.growthFromCounts = exports.growthBandFor = exports.computeNeedsAttention = exports.needsAttentionInputs = exports.summarizeCompliance = exports.resolveComplianceRows = exports.normalizeProgramRequirements = exports.complianceStatusCountsAsCovered = exports.resolveComplianceDocumentStatus = exports.complianceMatchKey = exports.deriveDeliveryCoverage = exports.classifyAssignment = exports.getBestInterventionDate = exports.getInterventionTitle = exports.isSmmeConfirmedForDp = exports.isDeptConfirmedForDp = exports.isConfirmedValue = exports.departmentMatchesScope = exports.getEligibleDpInterventions = exports.isDpInterventionDepartment = exports.isInterventionsDepartment = exports.getDepartmentDocForKey = exports.getInterventionDepartmentKey = exports.indexDepartments = exports.normalizeDepartmentName = exports.resolveGroup = exports.normalizeGroup = exports.getEmail = exports.getParticipantId = exports.pickPlanForProgramme = exports.scopeToProgramme = exports.twinIdFor = exports.twinDayKey = exports.wholeDaysBetween = exports.toDate = exports.firstNonEmpty = exports.normalizeLower = exports.normalizeText = exports.TWIN_STAFF_ROLES = exports.MIN_PEER_GROUP = exports.OUTLOOK_HORIZONS = exports.TWIN_RULE_VERSION = exports.NEEDS_ATTENTION_WEIGHTS = exports.getRiskLevel = exports.computeRiskScore = void 0;
exports.peerProfileOf = exports.buildTwinRecord = exports.comparePeers = exports.scenarioGrowth = exports.projectionCurve = exports.scenarioCurve = exports.scenarioInputsAt = exports.scenarioLimits = exports.isNoChangeScenario = exports.NO_CHANGE_SCENARIO = exports.projectOutlook = exports.latestContactDate = exports.deriveOutlookStatus = void 0;
const lifecycle_1 = require("./lifecycle");
const needsAttention_1 = require("./needsAttention");
var needsAttention_2 = require("./needsAttention");
Object.defineProperty(exports, "computeRiskScore", { enumerable: true, get: function () { return needsAttention_2.computeRiskScore; } });
Object.defineProperty(exports, "getRiskLevel", { enumerable: true, get: function () { return needsAttention_2.getRiskLevel; } });
Object.defineProperty(exports, "NEEDS_ATTENTION_WEIGHTS", { enumerable: true, get: function () { return needsAttention_2.NEEDS_ATTENTION_WEIGHTS; } });
/** Bump whenever a calculation below changes, so saved records stay traceable. */
exports.TWIN_RULE_VERSION = 'v1';
/** Days ahead the outlook projects, if nothing changes. */
exports.OUTLOOK_HORIZONS = [20, 40];
/** Peer groups smaller than this are not shown, so no single SME can be singled out. */
exports.MIN_PEER_GROUP = 3;
/** Roles that may see twins and ask for a recalculation. firestore.rules repeats this list. */
exports.TWIN_STAFF_ROLES = [
    'director', 'system_admin', 'superadmin', 'admin', 'operations', 'projectadmin', 'projectmanager', 'coordinator'
];
const DAY_MS = 24 * 60 * 60 * 1000;
const COMPLIANCE_EXPIRING_SOON_DAYS = 30;
const SOUTH_AFRICA_OFFSET_MS = 2 * 60 * 60 * 1000;
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
/* ============================== helpers ============================== */
function normalizeText(value) {
    return String(value ?? '').trim();
}
exports.normalizeText = normalizeText;
function normalizeLower(value) {
    return normalizeText(value).toLowerCase();
}
exports.normalizeLower = normalizeLower;
function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === 0)
            return value;
        if (value === false)
            return value;
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }
    return undefined;
}
exports.firstNonEmpty = firstNonEmpty;
function toDate(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === 'function')
        return value.toDate();
    if (typeof value === 'object' && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000);
    }
    if (typeof value === 'object' && typeof value._seconds === 'number') {
        return new Date(value._seconds * 1000);
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}
exports.toDate = toDate;
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
/** Whole days from `from` to `to`, truncated like dayjs().diff(date, 'day'). */
const wholeDaysBetween = (from, to) => Math.trunc((to.getTime() - from.getTime()) / DAY_MS);
exports.wholeDaysBetween = wholeDaysBetween;
/** Calendar date in South Africa (UTC+2, no daylight saving), as YYYY-MM-DD. */
const twinDayKey = (date) => new Date(date.getTime() + SOUTH_AFRICA_OFFSET_MS).toISOString().slice(0, 10);
exports.twinDayKey = twinDayKey;
const twinIdFor = (participantId, programId) => `${participantId}_${programId || 'no-programme'}`;
exports.twinIdFor = twinIdFor;
const iso = (date) => (date ? date.toISOString() : null);
const median = (values) => {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
/** Keeps rows for this programme; rows with no programme recorded are kept too. */
const inProgramme = (programId) => (item) => !programId || !item?.programId || normalizeText(item.programId) === programId;
const newestFirst = (left, right) => (toDate(right?.updatedAt ?? right?.createdAt)?.getTime() || 0) -
    (toDate(left?.updatedAt ?? left?.createdAt)?.getTime() || 0);
const scopeToProgramme = (items, programId) => items.filter(inProgramme(programId));
exports.scopeToProgramme = scopeToProgramme;
/** The plan for this programme, else the newest plan the SME has. */
const pickPlanForProgramme = (plans, programId) => {
    const sorted = [...plans].sort(newestFirst);
    return sorted.find(plan => programId && normalizeText(plan.programId) === programId) ?? sorted[0] ?? null;
};
exports.pickPlanForProgramme = pickPlanForProgramme;
/* ========================= SME identity fields ========================= */
function getParticipantId(doc) {
    return normalizeText(firstNonEmpty(doc.participantId, doc.participantID, doc.incubateeId, doc.smeId, doc.userId, doc.id));
}
exports.getParticipantId = getParticipantId;
function getEmail(doc) {
    if (!doc)
        return undefined;
    const value = firstNonEmpty(doc.email, doc.applicantEmail, doc.ownerEmail, doc.contactEmail, doc.userEmail, doc?.contactInfo?.email);
    return value ? String(value).trim().toLowerCase() : undefined;
}
exports.getEmail = getEmail;
function normalizeGroup(value) {
    const normalized = normalizeLower(value).replace(/^group\s+/, '');
    if (normalized === 'b')
        return 'B';
    if (normalized === 'c')
        return 'C';
    if (['graduated', 'post-incubation', 'post incubation'].includes(normalized))
        return 'Graduated';
    return 'A';
}
exports.normalizeGroup = normalizeGroup;
/** Same resolution as groupLifecycleService.resolveApplicationGroup. */
function resolveGroup(application, participant) {
    const direct = firstNonEmpty(application?.gapGroup, application?.group, application?.currentGroup, participant?.gapGroup, participant?.group, participant?.currentGroup);
    if (normalizeText(direct))
        return normalizeGroup(direct);
    const history = [
        ...(Array.isArray(participant?.groupHistory) ? participant.groupHistory : []),
        ...(Array.isArray(application?.groupHistory) ? application.groupHistory : [])
    ]
        .filter((item) => item?.to)
        .sort((a, b) => new Date(a.date || a.at || 0).getTime() - new Date(b.date || b.at || 0).getTime());
    return history.length ? normalizeGroup(history[history.length - 1].to) : 'A';
}
exports.resolveGroup = resolveGroup;
/* ============================ departments ============================ */
function normalizeDepartmentName(value) {
    const raw = normalizeText(value);
    if (!raw)
        return '';
    const lower = raw.toLowerCase();
    if (lower === 'rom' || lower.includes('recruitment') || lower.includes('onboarding'))
        return 'ROM';
    if (lower.includes('hse') || lower.includes('labour'))
        return 'HSE & Labour Compliance';
    if (lower.includes('financial'))
        return 'Financial Compliance';
    if (lower === 'pds' || lower.includes('personal development'))
        return 'PDS';
    // Marketing must be checked before Market Linkages: "marketing" contains "market".
    if (lower.includes('marketing') ||
        lower === 'communication' ||
        lower === 'communications')
        return 'Marketing and Communication';
    if (lower === 'market' ||
        lower === 'market linkage' ||
        lower === 'market linkages' ||
        lower.includes('market linkage'))
        return 'Market Linkages';
    if (lower.includes('legal'))
        return 'Legal Advisory Services';
    if (lower.includes('wellness'))
        return 'Wellness Services';
    if (lower.includes('training') || lower.includes('academy'))
        return 'Training Academy';
    return raw;
}
exports.normalizeDepartmentName = normalizeDepartmentName;
function indexDepartments(departments) {
    const byId = {};
    const byName = {};
    departments.forEach(dep => {
        byId[String(dep.id)] = dep;
        const name = normalizeDepartmentName(dep?.name);
        if (name)
            byName[name.toLowerCase()] = dep;
    });
    return { byId, byName };
}
exports.indexDepartments = indexDepartments;
function getInterventionDepartmentKey(iv, departmentsById, departmentsByName) {
    const rawDepartmentId = normalizeText(iv?.departmentId);
    const rawArea = normalizeDepartmentName(firstNonEmpty(iv?.area, iv?.areaOfSupport, iv?.departmentName, iv?.department));
    if (rawDepartmentId && departmentsById[rawDepartmentId]) {
        const dep = departmentsById[rawDepartmentId];
        return {
            departmentId: String(dep.id),
            departmentName: normalizeDepartmentName(dep.name || rawArea || 'Unknown Department')
        };
    }
    if (rawArea) {
        const dep = departmentsByName[rawArea.toLowerCase()];
        if (dep) {
            return { departmentId: String(dep.id), departmentName: normalizeDepartmentName(dep.name || rawArea) };
        }
        return { departmentId: rawArea, departmentName: rawArea };
    }
    return { departmentId: 'unknown', departmentName: 'Unknown Department' };
}
exports.getInterventionDepartmentKey = getInterventionDepartmentKey;
function getDepartmentDocForKey(dep, departmentsById, departmentsByName) {
    return departmentsById[dep.departmentId] || departmentsByName[dep.departmentName.toLowerCase()];
}
exports.getDepartmentDocForKey = getDepartmentDocForKey;
function isInterventionsDepartment(depDoc) {
    return depDoc?.interventionsDepartment === true;
}
exports.isInterventionsDepartment = isInterventionsDepartment;
function isDpInterventionDepartment(iv, departmentsById, departmentsByName) {
    const dep = getInterventionDepartmentKey(iv, departmentsById, departmentsByName);
    return isInterventionsDepartment(getDepartmentDocForKey(dep, departmentsById, departmentsByName));
}
exports.isDpInterventionDepartment = isDpInterventionDepartment;
function getEligibleDpInterventions(interventions, departmentsById, departmentsByName) {
    return interventions.filter(iv => isDpInterventionDepartment(iv, departmentsById, departmentsByName));
}
exports.getEligibleDpInterventions = getEligibleDpInterventions;
function departmentMatchesScope(dep, scope) {
    if (!scope?.departmentId && !scope?.departmentName)
        return true;
    const depId = normalizeLower(dep.departmentId);
    const depName = normalizeLower(dep.departmentName);
    const scopeId = normalizeLower(scope.departmentId);
    const scopeName = normalizeLower(scope.departmentName);
    return (!!scopeId && depId === scopeId) || (!!scopeName && depName === scopeName);
}
exports.departmentMatchesScope = departmentMatchesScope;
function isConfirmedValue(value) {
    if (value === true)
        return true;
    if (value && typeof value === 'object')
        return value.confirmed === true;
    return false;
}
exports.isConfirmedValue = isConfirmedValue;
function isDeptConfirmedForDp(dp, deptId, deptName) {
    const id = normalizeText(deptId);
    const name = normalizeText(deptName);
    return isConfirmedValue(id ? dp?.confirmedByDeptId?.[id] : undefined) ||
        isConfirmedValue(name ? dp?.confirmed?.[name] : undefined);
}
exports.isDeptConfirmedForDp = isDeptConfirmedForDp;
function isSmmeConfirmedForDp(dp, deptId, deptName) {
    const id = normalizeText(deptId);
    const name = normalizeText(deptName);
    return ((!!id && isConfirmedValue(firstNonEmpty(dp?.smmeConfirmedByDeptId?.[id], dp?.incubateeDepartmentConfirmationsByDeptId?.[id]))) ||
        (!!name && isConfirmedValue(firstNonEmpty(dp?.smmeConfirmedByDept?.[name], dp?.incubateeConfirmedByDept?.[name], dp?.incubateeDepartmentConfirmations?.[name], dp?.smmeConfirmedMap?.[name]))));
}
exports.isSmmeConfirmedForDp = isSmmeConfirmedForDp;
function getInterventionTitle(doc) {
    return String(firstNonEmpty(doc.interventionTitle, doc.title, doc.serviceTitle, doc.activityTitle, doc.interventionName, 'Untitled intervention'));
}
exports.getInterventionTitle = getInterventionTitle;
function getBestInterventionDate(doc) {
    return toDate(firstNonEmpty(doc.completedAt, doc.interventionDate, doc.executionDate, doc.engagementDate, doc.attendanceDate, doc.date, doc.updatedAt, doc.createdAt));
}
exports.getBestInterventionDate = getBestInterventionDate;
/* ======================= delivery coverage (fixed) ======================= */
/**
 * How one assignment counts towards coverage. Corrected rule: this reads only
 * resolveAssignmentLifecycle, replacing the register's separate status checks,
 * so facilitator completion and SME confirmation are judged the same everywhere.
 */
function classifyAssignment(assignment) {
    const lifecycle = (0, lifecycle_1.resolveAssignmentLifecycle)(assignment);
    return {
        lifecycle,
        isCompleted: lifecycle.isCompleted,
        isDeclined: !lifecycle.isCompleted && (lifecycle.isDeclined || lifecycle.key === 'cancelled'),
        awaitingSmeAcceptance: lifecycle.key === 'awaiting-participant-acceptance',
        awaitingSmeConfirmation: lifecycle.key === 'awaiting-participant-confirmation'
    };
}
exports.classifyAssignment = classifyAssignment;
/** Departments the development plan expects, and what each has delivered. */
function deriveDeliveryCoverage(args) {
    const { diagnosticPlan, assignments, departmentsById, departmentsByName, scope } = args;
    const plan = diagnosticPlan || {};
    const planInterventions = Array.isArray(plan.interventions) ? plan.interventions : [];
    const eligible = getEligibleDpInterventions(planInterventions, departmentsById, departmentsByName)
        .filter(iv => departmentMatchesScope(getInterventionDepartmentKey(iv, departmentsById, departmentsByName), scope));
    const expected = new Map();
    eligible.forEach(iv => {
        const dep = getInterventionDepartmentKey(iv, departmentsById, departmentsByName);
        const deptConfirmed = isDeptConfirmedForDp(plan, dep.departmentId, dep.departmentName);
        const smmeConfirmed = isSmmeConfirmedForDp(plan, dep.departmentId, dep.departmentName);
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
            });
        }
        const entry = expected.get(dep.departmentId);
        entry.deptConfirmed = entry.deptConfirmed || deptConfirmed;
        entry.smmeConfirmed = entry.smmeConfirmed || smmeConfirmed;
        const ivId = normalizeText(iv?.id);
        const ivTitle = getInterventionTitle(iv);
        if (ivId && !entry.expectedInterventionIds.includes(ivId))
            entry.expectedInterventionIds.push(ivId);
        if (ivTitle && !entry.expectedInterventionTitles.includes(ivTitle))
            entry.expectedInterventionTitles.push(ivTitle);
    });
    let smePendingAcceptanceCount = 0;
    let smePendingConfirmationCount = 0;
    const responsiveness = new Set();
    const matchedAssignments = [];
    assignments.forEach(assignment => {
        const dep = getInterventionDepartmentKey(assignment, departmentsById, departmentsByName);
        if (!departmentMatchesScope(dep, scope))
            return;
        const entry = expected.get(dep.departmentId);
        if (!entry)
            return;
        const state = classifyAssignment(assignment);
        const date = getBestInterventionDate(assignment);
        entry.servicedCount += 1;
        if (state.isCompleted)
            entry.completedCount += 1;
        else if (state.isDeclined)
            entry.declinedCount += 1;
        else
            entry.pendingCount += 1;
        if (state.awaitingSmeAcceptance) {
            smePendingAcceptanceCount += 1;
            responsiveness.add(dep.departmentName);
        }
        if (state.awaitingSmeConfirmation) {
            smePendingConfirmationCount += 1;
            responsiveness.add(dep.departmentName);
        }
        if (date && (!entry.latestServiceDate || date.getTime() > entry.latestServiceDate.getTime())) {
            entry.latestServiceDate = date;
        }
        matchedAssignments.push({ assignment, departmentId: dep.departmentId, departmentName: dep.departmentName });
    });
    const expectedDepartments = [...expected.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName));
    const sum = (pick) => expectedDepartments.reduce((total, item) => total + pick(item), 0);
    const lastInterventionDate = expectedDepartments
        .map(item => item.latestServiceDate)
        .filter((date) => !!date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
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
    };
}
exports.deriveDeliveryCoverage = deriveDeliveryCoverage;
/** Matches documents to requirements the way the incubatee compliance page does. */
const complianceMatchKey = (value) => normalizeLower(value)
    .replace(/\(signed\)/g, '')
    .replace(/\b(docs|documents)\b/g, 'document')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
exports.complianceMatchKey = complianceMatchKey;
function resolveComplianceDocumentStatus(document, effectiveExpiry, now = new Date(), expiringSoonDays = COMPLIANCE_EXPIRING_SOON_DAYS) {
    const storedStatus = normalizeLower(document?.status || 'pending');
    if (storedStatus === 'missing')
        return 'missing';
    const expiry = toDate(effectiveExpiry ?? document?.expiryDate);
    if (expiry && expiry.getTime() < now.getTime())
        return 'expired';
    if (['invalid', 'rejected', 'queried'].includes(storedStatus))
        return storedStatus;
    if (['valid', 'approved', 'verified', 'accepted'].includes(storedStatus)) {
        if (expiry && expiry.getTime() <= now.getTime() + expiringSoonDays * DAY_MS)
            return 'expiring-soon';
        return 'valid';
    }
    return storedStatus;
}
exports.resolveComplianceDocumentStatus = resolveComplianceDocumentStatus;
const complianceStatusCountsAsCovered = (status) => ['valid', 'expiring-soon', 'signed'].includes(normalizeLower(status));
exports.complianceStatusCountsAsCovered = complianceStatusCountsAsCovered;
const isAgreementRecord = (raw) => raw?.kind === 'agreement' || raw?.type === 'agreement' || Boolean(raw?.agreementId);
/** Upload requirements from a programme's programRequirements (agreements are separate). */
function normalizeProgramRequirements(raw = []) {
    const unique = new Map();
    raw.forEach(item => {
        if (!item || isAgreementRecord(item))
            return;
        const title = normalizeText(firstNonEmpty(item.title, item.name, item.presetId, item.key, item.id));
        const key = (0, exports.complianceMatchKey)(title);
        if (!key)
            return;
        const hasExpiry = Boolean(item.hasExpiry || item.expiryRule);
        const months = Number(item.expiryMonths ?? item.expiryRule?.months);
        unique.set(key, {
            key,
            title,
            hasExpiry,
            expiryMonths: hasExpiry && Number.isFinite(months) && months > 0 ? months : null
        });
    });
    return [...unique.values()];
}
exports.normalizeProgramRequirements = normalizeProgramRequirements;
/**
 * The one compliance reader. Sub-collection uploads override the copies
 * embedded on the application; each programme requirement becomes a row,
 * "missing" when nothing matches. With no requirements configured, every
 * uploaded document becomes a row instead.
 */
function resolveComplianceRows(args) {
    const now = args.now ?? new Date();
    const byKey = new Map();
    const add = (document, source) => {
        if (!document || isAgreementRecord(document))
            return;
        const key = (0, exports.complianceMatchKey)(firstNonEmpty(document.type, document.title, document.documentName, document.name));
        if (key)
            byKey.set(key, { ...document, _source: source });
    };
    args.embedded.forEach(document => add(document, 'embedded'));
    args.uploads.forEach(document => add(document, 'subcollection'));
    const toRow = (key, title, document, requirement) => {
        const model = document ?? { status: 'missing' };
        const issued = toDate(model.issueDate) || toDate(model.createdAt);
        let expiry = toDate(model.expiryDate);
        if (!expiry && requirement?.hasExpiry && requirement.expiryMonths && issued) {
            expiry = new Date(issued);
            expiry.setMonth(expiry.getMonth() + requirement.expiryMonths);
        }
        const status = resolveComplianceDocumentStatus(model, expiry, now);
        return {
            key,
            title,
            status,
            expiry: status === 'missing' ? null : expiry,
            covered: (0, exports.complianceStatusCountsAsCovered)(status),
            source: document ? document._source : 'none'
        };
    };
    if (args.requirements.length) {
        return args.requirements.map(requirement => toRow(requirement.key, requirement.title, byKey.get(requirement.key), requirement));
    }
    return [...byKey.entries()].map(([key, document]) => toRow(key, normalizeText(firstNonEmpty(document.type, document.title, document.documentName, document.name)), document));
}
exports.resolveComplianceRows = resolveComplianceRows;
function summarizeCompliance(rows) {
    const count = (statuses) => rows.filter(row => statuses.includes(normalizeLower(row.status))).length;
    const covered = rows.filter(row => row.covered).length;
    const missing = count(['missing']);
    const expired = count(['expired']);
    const queried = count(['queried']);
    const rejected = count(['rejected', 'invalid']);
    return {
        total: rows.length,
        covered,
        expiringSoon: count(['expiring-soon']),
        pending: rows.length - covered - missing - expired - queried - rejected,
        missing,
        expired,
        queried,
        rejected
    };
}
exports.summarizeCompliance = summarizeCompliance;
function needsAttentionInputs(coverage, docs, now) {
    return {
        daysSinceLastService: coverage.lastInterventionDate ? (0, exports.wholeDaysBetween)(coverage.lastInterventionDate, now) : null,
        hasNeverReceivedService: coverage.fullyConfirmedDepartments.length > 0 && coverage.totalTouches === 0,
        docsMissing: docs.missing,
        docsQueried: docs.queried,
        docsRejected: docs.rejected,
        missingDepartmentsCount: coverage.missingDepartments.length,
        smePendingAcceptanceCount: coverage.smePendingAcceptanceCount,
        smePendingConfirmationCount: coverage.smePendingConfirmationCount,
        declinedTouches: coverage.declinedTouches
    };
}
exports.needsAttentionInputs = needsAttentionInputs;
/** Twin compliance feeds the score as: expired counts as missing, invalid as rejected. */
const complianceRiskDocs = (summary) => ({
    missing: summary.missing + summary.expired,
    queried: summary.queried,
    rejected: summary.rejected
});
function computeNeedsAttention(inputs) {
    const result = (0, needsAttention_1.computeRiskScore)(inputs);
    return {
        score: result.score,
        level: result.level,
        reasons: result.breakdown,
        daysSinceLastService: inputs.daysSinceLastService,
        inputs
    };
}
exports.computeNeedsAttention = computeNeedsAttention;
const growthBandFor = (score) => {
    if (score >= 85)
        return 'Growth ready';
    if (score >= 65)
        return 'On track';
    if (score >= 35)
        return 'Building momentum';
    return 'Starting';
};
exports.growthBandFor = growthBandFor;
const isClosedWithoutDelivery = (key) => key === 'cancelled' || key === 'needs-reassignment';
/** Turns growth counts into the 100-point score (compliance 30, interventions 30, roadmap 20, responsiveness 20). */
function growthFromCounts(counts) {
    const share = (part, whole, points) => (whole ? Math.round((Math.min(part, whole) / whole) * points) : 0);
    const roadmapScore = counts.roadmapFinal ? 20 : share(counts.roadmapConfirmed, counts.roadmapTotal, 20);
    const components = [
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
    ];
    const total = components.reduce((sum, component) => sum + component.score, 0);
    return { total, band: (0, exports.growthBandFor)(total), components, counts };
}
exports.growthFromCounts = growthFromCounts;
/**
 * The growth score for one SME in one programme, from the shared lifecycle and
 * compliance readers. Cancelled and reassigned assignments no longer count
 * against the SME.
 */
function computeGrowthScore(args) {
    const lifecycles = args.assignments.map(lifecycle_1.resolveAssignmentLifecycle).filter(item => !isClosedWithoutDelivery(item.key));
    const plan = args.diagnosticPlan;
    const planInterventions = Array.isArray(plan?.interventions) ? plan.interventions : [];
    const departmentIds = Array.from(new Set(planInterventions
        .map(item => normalizeText(item?.departmentId || item?.addedByDeptId))
        .filter(Boolean)));
    const confirmations = plan?.incubateeDepartmentConfirmationsByDeptId || plan?.incubateeDepartmentConfirmations || {};
    // SMEs are asked to respond twice per intervention: accept or decline the
    // appointment, then confirm or reject the delivered work once it is done.
    let opportunities = 0;
    let responses = 0;
    lifecycles.forEach(item => {
        opportunities += 1;
        if (item.participantAcceptance !== 'pending')
            responses += 1;
        if (item.assigneeCompletion === 'completed' || item.isCompleted) {
            opportunities += 1;
            if (item.participantCompletion !== 'pending')
                responses += 1;
        }
    });
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
    });
}
exports.computeGrowthScore = computeGrowthScore;
/** Overdue = still open by the lifecycle and past its due date (the plan's single rule). */
function summarizeDelivery(assignments, now) {
    const counts = new Map();
    const summary = { total: assignments.length, open: 0, completed: 0, declined: 0, overdue: 0, waitingOnSme: 0, byLifecycle: [] };
    assignments.forEach(assignment => {
        const lifecycle = (0, lifecycle_1.resolveAssignmentLifecycle)(assignment);
        const entry = counts.get(lifecycle.key) ?? { key: lifecycle.key, label: lifecycle.label, count: 0 };
        entry.count += 1;
        counts.set(lifecycle.key, entry);
        if (lifecycle.isOpen)
            summary.open += 1;
        if (lifecycle.isCompleted)
            summary.completed += 1;
        if (lifecycle.isDeclined)
            summary.declined += 1;
        if (lifecycle.waitingOn === 'participant')
            summary.waitingOnSme += 1;
        const due = toDate(assignment.dueDate);
        if (lifecycle.isOpen && due && due.getTime() < now.getTime())
            summary.overdue += 1;
    });
    summary.byLifecycle = [...counts.values()].sort((a, b) => b.count - a.count);
    return summary;
}
exports.summarizeDelivery = summarizeDelivery;
function summarizeEvidence(movs) {
    const status = (mov) => normalizeLower(mov?.status);
    return {
        total: movs.length,
        approved: movs.filter(mov => status(mov) === 'approved').length,
        awaitingSme: movs.filter(mov => status(mov) === 'awaiting_smme').length,
        awaitingHod: movs.filter(mov => status(mov) === 'awaiting_hod').length,
        draft: movs.filter(mov => status(mov) === 'draft').length
    };
}
exports.summarizeEvidence = summarizeEvidence;
/** Walks back from this month over the last 12 month names the profile form stores. */
const recentMonthNames = (now) => Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return { name: MONTH_NAMES[date.getMonth()], label: `${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getFullYear()}` };
});
function summarizeBusiness(args) {
    const { participant, now } = args;
    let revenue = null;
    const quantNow = args.monthlyMetrics
        .filter(row => Number.isFinite(Number(row?.monthlyRevenue)) && normalizeText(row?.sourceMonth))
        .sort((a, b) => normalizeText(b.sourceMonth).localeCompare(normalizeText(a.sourceMonth)))[0];
    if (quantNow) {
        revenue = { monthly: Number(quantNow.monthlyRevenue), month: normalizeText(quantNow.sourceMonth), source: 'QuantNow' };
    }
    else {
        const monthly = participant?.revenueHistory?.monthly || {};
        const hit = recentMonthNames(now).find(month => Number(monthly[month.name]) > 0);
        if (hit)
            revenue = { monthly: Number(monthly[hit.name]), month: hit.label, source: 'SME profile' };
    }
    let headcount = null;
    const headcountMonthly = participant?.headcountHistory?.monthly || {};
    const totalOf = (row) => Number(row?.total ?? (Number(row?.permanent || 0) + Number(row?.temporary || 0)));
    const monthHit = recentMonthNames(now).find(month => totalOf(headcountMonthly[month.name]) > 0);
    if (monthHit) {
        headcount = { total: totalOf(headcountMonthly[monthHit.name]), period: monthHit.label, source: 'SME profile' };
    }
    else {
        const annual = participant?.headcountHistory?.annual || {};
        const latestYear = Object.keys(annual).filter(year => totalOf(annual[year]) > 0).sort().pop();
        if (latestYear)
            headcount = { total: totalOf(annual[latestYear]), period: latestYear, source: 'SME profile' };
    }
    let jobsSustained = 0;
    let jobsCreatedLast12Months = 0;
    args.jobContracts.forEach(contract => {
        const created = toDate(contract.createdAt || contract.uploadMonthDate);
        if (!created || created.getTime() > now.getTime())
            return;
        const end = toDate(contract.contractEndDate);
        if (contract.contractType === 'permanent' || !end || end.getTime() >= now.getTime())
            jobsSustained += 1;
        if (now.getTime() - created.getTime() <= 365 * DAY_MS)
            jobsCreatedLast12Months += 1;
    });
    return { revenue, headcount, jobsSustained, jobsCreatedLast12Months };
}
exports.summarizeBusiness = summarizeBusiness;
const formatDay = (date) => date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' });
const isOpenChallenge = (challenge) => !['resolved', 'closed'].includes(normalizeLower(challenge?.status));
/** Same order of checks as the Risk Register's Risk Outlook panel. */
function recommendNextAction(context, challenges = []) {
    const mitigation = challenges
        .filter(isOpenChallenge)
        .flatMap(challenge => (Array.isArray(challenge.mitigationSteps) ? challenge.mitigationSteps : []))
        .map(normalizeText)
        .find(Boolean);
    if (mitigation)
        return mitigation;
    const join = (items) => items.map(item => item.departmentName).join(', ');
    const pendingReviews = context.expectedDepartments.filter(dep => !dep.deptConfirmed);
    if (pendingReviews.length) {
        return pendingReviews.length === 1
            ? `Follow up with ${join(pendingReviews)} to review the Developmental Plan.`
            : `Follow up with ${join(pendingReviews)} to review their Developmental Plan sections.`;
    }
    const pendingSme = context.expectedDepartments.filter(dep => dep.deptConfirmed && !dep.smmeConfirmed);
    if (pendingSme.length) {
        return pendingSme.length === 1
            ? `Remind the SME to confirm the Developmental Plan for ${join(pendingSme)}.`
            : `Remind the SME to confirm the Developmental Plans for ${join(pendingSme)}.`;
    }
    if (context.fullyConfirmedDepartmentsCount > 0 && context.totalTouches === 0) {
        return 'Schedule the first service intervention for the SME.';
    }
    if (context.smePendingAcceptanceCount > 0) {
        return context.smePendingAcceptanceCount === 1
            ? 'Follow up with the SME to accept the pending intervention.'
            : `Follow up with the SME to accept ${context.smePendingAcceptanceCount} pending interventions.`;
    }
    if (context.smePendingConfirmationCount > 0) {
        return context.smePendingConfirmationCount === 1
            ? 'Follow up with the SME to confirm the completed intervention.'
            : `Follow up with the SME to confirm ${context.smePendingConfirmationCount} completed interventions.`;
    }
    if ((context.daysSinceLastService ?? 0) >= 30) {
        return `Schedule a follow-up service; the SME has not been serviced for ${context.daysSinceLastService} days.`;
    }
    if (context.declinedTouches > 0) {
        return context.declinedTouches === 1
            ? 'Review the declined intervention and agree on the next delivery step with the SME.'
            : `Review the ${context.declinedTouches} declined interventions and agree on the next delivery steps with the SME.`;
    }
    return 'Continue monitoring the SME’s service delivery progress.';
}
exports.recommendNextAction = recommendNextAction;
/** Same rule as the Risk Outlook panel's trend tag. */
function deriveOutlookStatus(args) {
    const open = args.challenges.filter(isOpenChallenge);
    const hasOverdueChallenge = open.some(challenge => {
        const due = toDate(challenge.dueDate);
        return !!due && (0, exports.twinDayKey)(due) < (0, exports.twinDayKey)(args.now);
    });
    const contactIsRecent = !!args.lastContactAt && (0, exports.wholeDaysBetween)(args.lastContactAt, args.now) <= 14;
    if (hasOverdueChallenge || ((args.level === 'High' || args.level === 'Critical') && !contactIsRecent)) {
        return {
            label: 'Needs attention',
            detail: hasOverdueChallenge
                ? 'An open challenge is overdue.'
                : 'Current score is high and there has been no contact in the last 14 days.'
        };
    }
    if (open.length)
        return { label: 'Mitigation in progress', detail: 'Open mitigation work is recorded.' };
    return { label: 'Stable', detail: 'No overdue mitigation is recorded.' };
}
exports.deriveOutlookStatus = deriveOutlookStatus;
function latestContactDate(challenges, reminderEmails) {
    const dates = [
        ...challenges.flatMap(challenge => (Array.isArray(challenge.communicationAttempts) ? challenge.communicationAttempts : [])
            .map((attempt) => toDate(attempt?.attemptedAt))),
        ...reminderEmails.map(email => toDate(email?.createdAt ?? email?.sentAt))
    ].filter((date) => !!date);
    return dates.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}
exports.latestContactDate = latestContactDate;
const inactivityLabel = (days) => days >= 180 ? '6+ months' : days >= 90 ? '3+ months' : days >= 30 ? '1+ month' : 'under a month';
/**
 * "If nothing changes": the score on each horizon assuming no new service, no
 * responses and no new documents. Only known dates move it: days since the
 * last service grow, and documents pass their expiry dates.
 */
function projectOutlook(args) {
    const { inputs, complianceRows, assignments, now } = args;
    const horizons = args.horizons ?? exports.OUTLOOK_HORIZONS;
    const expiringBy = (date) => complianceRows.filter(row => row.expiry && !['expired', 'missing'].includes(normalizeLower(row.status)) &&
        row.expiry.getTime() > now.getTime() && row.expiry.getTime() <= date.getTime());
    const projectInputs = (days) => ({
        ...inputs,
        daysSinceLastService: inputs.daysSinceLastService === null ? null : inputs.daysSinceLastService + days,
        docsMissing: inputs.docsMissing + expiringBy(addDays(now, days)).length
    });
    const today = (0, needsAttention_1.computeRiskScore)(inputs);
    const projected = horizons.map(days => {
        const date = addDays(now, days);
        const projectedInputs = projectInputs(days);
        const result = (0, needsAttention_1.computeRiskScore)(projectedInputs);
        const expiring = expiringBy(date);
        const changes = [];
        if (inputs.daysSinceLastService !== null && projectedInputs.daysSinceLastService !== null &&
            inactivityLabel(inputs.daysSinceLastService) !== inactivityLabel(projectedInputs.daysSinceLastService)) {
            changes.push(`No service for ${projectedInputs.daysSinceLastService} days by ${formatDay(date)} (${inactivityLabel(projectedInputs.daysSinceLastService)})`);
        }
        if (expiring.length) {
            changes.push(`${expiring.length} document${expiring.length === 1 ? '' : 's'} expire${expiring.length === 1 ? 's' : ''} before ${formatDay(date)}`);
        }
        const due = assignments
            .filter(assignment => (0, lifecycle_1.resolveAssignmentLifecycle)(assignment).isOpen)
            .map(assignment => ({ title: getInterventionTitle(assignment), due: toDate(assignment.dueDate) }))
            .filter((item) => !!item.due && item.due.getTime() >= now.getTime() && item.due.getTime() <= date.getTime())
            .sort((a, b) => a.due.getTime() - b.due.getTime());
        if (due.length) {
            changes.push(`${due.length} intervention${due.length === 1 ? '' : 's'} fall${due.length === 1 ? 's' : ''} due and become${due.length === 1 ? 's' : ''} overdue if not delivered`);
        }
        if (result.level !== today.level)
            changes.unshift(`Moves from ${today.level} to ${result.level}`);
        if (!changes.length)
            changes.push('No dated change expected');
        return {
            days,
            date: date.toISOString(),
            score: result.score,
            level: result.level,
            reasons: result.breakdown,
            changes,
            dueInterventions: due.map(item => ({ title: item.title, dueDate: item.due.toISOString() })),
            expiringDocuments: expiring.map(row => ({ title: row.title, expiry: row.expiry.toISOString() }))
        };
    });
    let nextChange = null;
    for (let day = 1; day <= 365; day += 1) {
        const result = (0, needsAttention_1.computeRiskScore)(projectInputs(day));
        if (result.level !== today.level) {
            nextChange = { inDays: day, date: addDays(now, day).toISOString(), fromLevel: today.level, toLevel: result.level, score: result.score };
            break;
        }
    }
    return { horizons: projected, nextChange };
}
exports.projectOutlook = projectOutlook;
exports.NO_CHANGE_SCENARIO = {
    serviceInDays: null,
    documentsUploaded: 0,
    renewExpiring: false,
    documentsFixed: 0,
    smeResponses: 0,
    departmentsFollowedUp: 0,
    declinesResolved: 0,
    interventionsCompleted: 0,
    roadmapConfirmed: 0
};
const isNoChangeScenario = (scenario) => Object.keys(exports.NO_CHANGE_SCENARIO).every(key => scenario[key] === exports.NO_CHANGE_SCENARIO[key]);
exports.isNoChangeScenario = isNoChangeScenario;
/** How far each lever can go for this SME. */
function scenarioLimits(record) {
    const inputs = record.needsAttention.inputs;
    const counts = record.growth.counts;
    const furthest = record.outlook.horizons[record.outlook.horizons.length - 1];
    return {
        documentsUploaded: inputs.docsMissing,
        expiringDocuments: furthest?.expiringDocuments.length ?? 0,
        documentsFixed: inputs.docsQueried + inputs.docsRejected,
        smeResponses: inputs.smePendingAcceptanceCount + inputs.smePendingConfirmationCount,
        departmentsFollowedUp: inputs.missingDepartmentsCount,
        declinesResolved: inputs.declinedTouches,
        interventionsCompleted: counts ? Math.max(0, counts.interventionsTotal - counts.interventionsCompleted) : 0,
        roadmapConfirmed: counts && !counts.roadmapFinal ? Math.max(0, counts.roadmapTotal - counts.roadmapConfirmed) : 0
    };
}
exports.scenarioLimits = scenarioLimits;
/** The needs-attention inputs on a given day under a scenario. */
function scenarioInputsAt(record, scenario, day) {
    const base = record.needsAttention.inputs;
    const start = new Date(record.calculatedAt).getTime();
    const furthest = record.outlook.horizons[record.outlook.horizons.length - 1];
    const lapsed = scenario.renewExpiring
        ? 0
        : (furthest?.expiringDocuments ?? []).filter(item => {
            const time = new Date(item.expiry).getTime();
            return time > start && time <= start + day * DAY_MS;
        }).length;
    const served = scenario.serviceInDays !== null && day >= scenario.serviceInDays;
    const queriedFixed = Math.min(base.docsQueried, scenario.documentsFixed);
    const acceptancesAnswered = Math.min(base.smePendingAcceptanceCount, scenario.smeResponses);
    return {
        daysSinceLastService: served
            ? day - scenario.serviceInDays
            : base.daysSinceLastService === null ? null : base.daysSinceLastService + day,
        hasNeverReceivedService: base.hasNeverReceivedService && !served,
        docsMissing: Math.max(0, base.docsMissing - scenario.documentsUploaded) + lapsed,
        docsQueried: base.docsQueried - queriedFixed,
        docsRejected: Math.max(0, base.docsRejected - (scenario.documentsFixed - queriedFixed)),
        missingDepartmentsCount: Math.max(0, base.missingDepartmentsCount - scenario.departmentsFollowedUp),
        smePendingAcceptanceCount: base.smePendingAcceptanceCount - acceptancesAnswered,
        smePendingConfirmationCount: Math.max(0, base.smePendingConfirmationCount - (scenario.smeResponses - acceptancesAnswered)),
        declinedTouches: Math.max(0, base.declinedTouches - scenario.declinesResolved)
    };
}
exports.scenarioInputsAt = scenarioInputsAt;
/** The needs-attention score for each day from today to `untilDays` ahead, under a scenario. */
function scenarioCurve(record, scenario, untilDays) {
    return Array.from({ length: Math.max(0, untilDays) + 1 }, (_, day) => {
        const result = (0, needsAttention_1.computeRiskScore)(scenarioInputsAt(record, scenario, day));
        return { day, score: result.score, level: result.level };
    });
}
exports.scenarioCurve = scenarioCurve;
/**
 * "If nothing changes", from a saved record alone: the same rule as
 * projectOutlook, so the chart and the saved horizons always agree.
 */
const projectionCurve = (record, untilDays) => scenarioCurve(record, exports.NO_CHANGE_SCENARIO, untilDays);
exports.projectionCurve = projectionCurve;
/** The growth score once the scenario's changes have happened. */
function scenarioGrowth(record, scenario) {
    const counts = record.growth.counts;
    if (!counts)
        return record.growth;
    const answered = Math.min(scenario.smeResponses, counts.responseOpportunities - counts.responses);
    return growthFromCounts({
        ...counts,
        documentsCovered: counts.documentsCovered + scenario.documentsUploaded + scenario.documentsFixed,
        interventionsCompleted: counts.interventionsCompleted + scenario.interventionsCompleted,
        roadmapConfirmed: counts.roadmapConfirmed + scenario.roadmapConfirmed,
        responses: counts.responses + Math.max(0, answered)
    });
}
exports.scenarioGrowth = scenarioGrowth;
const PEER_METRICS = [
    { key: 'needsAttention', label: 'Needs attention', lowerIsBetter: true },
    { key: 'growth', label: 'Growth score', lowerIsBetter: false },
    { key: 'compliancePercent', label: 'Compliance %', lowerIsBetter: false },
    { key: 'deliveryPercent', label: 'Delivery completed %', lowerIsBetter: false },
    { key: 'revenue', label: 'Monthly revenue (R)', lowerIsBetter: false },
    { key: 'headcount', label: 'Headcount', lowerIsBetter: false }
];
const PEER_DIMENSIONS = ['group', 'programme', 'sector', 'gender'];
/** Compares one SME with every other SME sharing its group, programme, sector or gender. */
function comparePeers(self, all) {
    return PEER_DIMENSIONS.flatMap(dimension => {
        const value = normalizeText(self[dimension]);
        if (!value)
            return [];
        const peers = all.filter(peer => peer.twinId !== self.twinId && normalizeLower(peer[dimension]) === value.toLowerCase());
        if (peers.length < exports.MIN_PEER_GROUP)
            return [];
        const metrics = PEER_METRICS.map(metric => {
            const mine = self[metric.key];
            const values = peers.map(peer => peer[metric.key]).filter((item) => typeof item === 'number' && Number.isFinite(item));
            const better = mine === null || !values.length
                ? null
                : Math.round((values.filter(item => (metric.lowerIsBetter ? mine < item : mine > item)).length / values.length) * 100);
            return { ...metric, self: mine, peerMedian: median(values), betterThanPercent: better };
        });
        return [{ dimension, value, peerCount: peers.length, metrics }];
    });
}
exports.comparePeers = comparePeers;
/** Builds one SME's twin for one programme application from its raw documents. */
function buildTwinRecord(sources, options) {
    const now = options.now ?? new Date();
    const { application, participant } = sources;
    const participantId = getParticipantId(application);
    const programId = normalizeText(application.programId) || null;
    const scoped = inProgramme(programId);
    const assignments = sources.assignments.filter(scoped);
    const diagnosticPlan = (0, exports.pickPlanForProgramme)(sources.diagnosticPlans, programId);
    const movs = sources.movs.filter(scoped);
    const challenges = (sources.challenges ?? []).filter(scoped);
    const reminderEmails = sources.reminderEmails ?? [];
    const { byId, byName } = indexDepartments(sources.departments);
    const coverage = deriveDeliveryCoverage({ diagnosticPlan, assignments, departmentsById: byId, departmentsByName: byName });
    const complianceRows = resolveComplianceRows({
        requirements: normalizeProgramRequirements(sources.program?.programRequirements || []),
        embedded: Array.isArray(application.complianceDocuments) ? application.complianceDocuments : [],
        uploads: sources.complianceUploads,
        now
    });
    const compliance = summarizeCompliance(complianceRows);
    const inputs = needsAttentionInputs(coverage, complianceRiskDocs(compliance), now);
    const needsAttention = computeNeedsAttention(inputs);
    const lastContact = latestContactDate(challenges, reminderEmails);
    const nextActionContext = {
        expectedDepartments: coverage.expectedDepartments,
        fullyConfirmedDepartmentsCount: coverage.fullyConfirmedDepartments.length,
        totalTouches: coverage.totalTouches,
        smePendingAcceptanceCount: coverage.smePendingAcceptanceCount,
        smePendingConfirmationCount: coverage.smePendingConfirmationCount,
        daysSinceLastService: inputs.daysSinceLastService,
        declinedTouches: coverage.declinedTouches
    };
    const projection = projectOutlook({ inputs, complianceRows, assignments, now });
    return {
        twinId: (0, exports.twinIdFor)(participantId, programId),
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
        day: (0, exports.twinDayKey)(now),
        calculatedAt: now.toISOString(),
        ruleVersion: exports.TWIN_RULE_VERSION,
        source: options.source,
        needsAttention,
        growth: computeGrowthScore({ assignments, compliance, diagnosticPlan }),
        delivery: summarizeDelivery(assignments, now),
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
            finalConfirmed: !!diagnosticPlan?.finalConfirmation
        },
        business: summarizeBusiness({
            participant,
            monthlyMetrics: (sources.monthlyMetrics ?? []).filter(scoped),
            jobContracts: sources.jobContracts ?? [],
            now
        }),
        outlook: {
            status: deriveOutlookStatus({ level: needsAttention.level, challenges, lastContactAt: lastContact, now }),
            nextAction: recommendNextAction(nextActionContext, challenges),
            lastContactAt: iso(lastContact),
            ...projection
        },
        peers: []
    };
}
exports.buildTwinRecord = buildTwinRecord;
/** The slice of a record that peers are compared on. */
function peerProfileOf(record) {
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
    };
}
exports.peerProfileOf = peerProfileOf;
//# sourceMappingURL=rules.js.map