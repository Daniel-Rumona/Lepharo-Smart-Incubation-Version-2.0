"use strict";
/**
 * SME risk score: the single formula behind the SME Risk Register (browser) and the
 * nightly early-warning job (smeRiskScoring.ts). No imports, so both sides and the
 * tests in smeRiskLogic.test.cjs use the very same code.
 *
 * The first block of inputs is the register's original formula, unchanged. The
 * early-warning signals are optional and default to zero, so a caller that does not
 * supply them gets exactly the register's score.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreInputsFor = exports.SNAPSHOT_ONLY_INPUTS = exports.deriveRiskInputs = exports.expectedServiceIntervalDays = exports.departmentCoverage = exports.smeJoinedAt = exports.revenueDropPercent = exports.suggestNextStep = exports.shouldAlert = exports.riskTrend = exports.computeRiskScore = exports.cyclesWithoutService = exports.RISK_LEVEL_RANK = exports.getRiskLevel = exports.RISK_SCORE_WEIGHTS = void 0;
// Values for the original formula are unchanged from the register.
exports.RISK_SCORE_WEIGHTS = {
    neverReceivedService: 85,
    unknownLastService: 70,
    inactive6Months: 80,
    inactive3Months: 65,
    inactive1Month: 45,
    recentlyServiced: 15,
    // A new SME gets this long for its first service before "never serviced" counts against it.
    newSmeGraceDays: 30,
    newSmeNotYetServiced: 15,
    waitingOnStaff: 15,
    // Inactivity bands in missed cycles: 1, 3 and 6 cycles of 30 days are 30, 90 and 180 days.
    defaultCycleDays: 30,
    inactiveLongCycles: 3,
    inactiveSevereCycles: 6,
    missingDocPerItem: 4,
    missingDocCap: 12,
    queriedDocPerItem: 3,
    queriedDocCap: 9,
    rejectedDocPerItem: 4,
    rejectedDocCap: 12,
    missingDeptPerItem: 5,
    missingDeptCap: 15,
    unresponsivePerItem: 8,
    unresponsiveCap: 24,
    unresponsiveThresholdCount: 3,
    unresponsiveThresholdFloor: 85,
    repeatDeclinePenalty: 8,
    repeatDeclineThreshold: 2,
    // Early-warning signals.
    missedAppointmentPerItem: 6,
    missedAppointmentCap: 18,
    declinedAppointmentPerItem: 3,
    declinedAppointmentCap: 9,
    overdueInterventionPerItem: 4,
    overdueInterventionCap: 12,
    expiredDocPerItem: 5,
    expiredDocCap: 15,
    revenueDropThreshold: 25,
    revenueDropPenalty: 10,
    revenueSevereDropThreshold: 50,
    revenueSevereDropPenalty: 15,
    overdueFollowUpPerItem: 4,
    overdueFollowUpCap: 8,
    openQueryPerItem: 3,
    openQueryCap: 9,
    emailBouncedPenalty: 6,
    poorFeedbackPerItem: 4,
    poorFeedbackCap: 8,
};
const W = exports.RISK_SCORE_WEIGHTS;
function getRiskLevel(score) {
    if (score >= 75)
        return "Critical";
    if (score >= 50)
        return "High";
    if (score >= 25)
        return "Medium";
    return "Low";
}
exports.getRiskLevel = getRiskLevel;
exports.RISK_LEVEL_RANK = { Low: 0, Medium: 1, High: 2, Critical: 3 };
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const expectedCycleDays = (input) => input.expectedServiceIntervalDays && input.expectedServiceIntervalDays > 0 ? input.expectedServiceIntervalDays : null;
/** Whole cycles gone by without service: against the SME's own schedule when it has one, else 30-day cycles. */
const cyclesWithoutService = (input) => Math.floor((input.daysSinceLastService ?? 0) / (expectedCycleDays(input) ?? W.defaultCycleDays));
exports.cyclesWithoutService = cyclesWithoutService;
const inactivityLabel = (input, fixedLabel) => {
    const cycle = expectedCycleDays(input);
    if (!cycle)
        return fixedLabel;
    return `No service for ${plural((0, exports.cyclesWithoutService)(input), "scheduled cycle")} (expected every ${plural(cycle, "day")})`;
};
function computeRiskScore(input) {
    const breakdown = [];
    let score;
    const joined = input.daysSinceJoined ?? null;
    const notYetServiced = input.hasNeverReceivedService || input.daysSinceLastService === null;
    if (notYetServiced && joined !== null && joined >= 0 && joined < W.newSmeGraceDays) {
        score = W.newSmeNotYetServiced;
        breakdown.push({ label: `New SME: joined ${plural(joined, "day")} ago, first service not yet due`, delta: score, key: "inactivity" });
    }
    else if (notYetServiced && input.waitingOnStaff) {
        score = W.waitingOnStaff;
        breakdown.push({
            label: `No support assigned yet: waiting on ${plural(input.staffDelayDepartments || 0, "department")}`,
            delta: score,
            key: "inactivity",
        });
    }
    else if (input.hasNeverReceivedService) {
        score = W.neverReceivedService;
        breakdown.push({ label: "Never received an expected service", delta: score, key: "inactivity" });
    }
    else if (input.daysSinceLastService === null) {
        score = W.unknownLastService;
        breakdown.push({ label: "Last service date unknown", delta: score, key: "inactivity" });
    }
    else if ((0, exports.cyclesWithoutService)(input) >= W.inactiveSevereCycles) {
        score = W.inactive6Months;
        breakdown.push({ label: inactivityLabel(input, "No service in 6+ months"), delta: score, key: "inactivity" });
    }
    else if ((0, exports.cyclesWithoutService)(input) >= W.inactiveLongCycles) {
        score = W.inactive3Months;
        breakdown.push({ label: inactivityLabel(input, "No service in 3+ months"), delta: score, key: "inactivity" });
    }
    else if ((0, exports.cyclesWithoutService)(input) >= 1) {
        score = W.inactive1Month;
        breakdown.push({ label: inactivityLabel(input, "No service in 1+ month"), delta: score, key: "inactivity" });
    }
    else {
        score = W.recentlyServiced;
        breakdown.push({ label: "Recently serviced", delta: score, key: "inactivity" });
    }
    const add = (delta, label, key) => {
        if (delta <= 0)
            return;
        score += delta;
        breakdown.push({ label, delta, key });
    };
    add(Math.min(input.docsMissing * W.missingDocPerItem, W.missingDocCap), `${input.docsMissing} missing document(s)`, "documents");
    add(Math.min(input.docsQueried * W.queriedDocPerItem, W.queriedDocCap), `${input.docsQueried} queried document(s)`, "documents");
    add(Math.min(input.docsRejected * W.rejectedDocPerItem, W.rejectedDocCap), `${input.docsRejected} rejected document(s)`, "documents");
    add(Math.min(input.missingDepartmentsCount * W.missingDeptPerItem, W.missingDeptCap), `${plural(input.missingDepartmentsCount, "department plan")} awaiting SME confirmation`, "departments");
    const unresponsiveCount = input.smePendingAcceptanceCount + input.smePendingConfirmationCount;
    add(Math.min(unresponsiveCount * W.unresponsivePerItem, W.unresponsiveCap), `${unresponsiveCount} intervention(s) awaiting SME response`, "unresponsive");
    if (unresponsiveCount >= W.unresponsiveThresholdCount && score < W.unresponsiveThresholdFloor) {
        breakdown.push({ label: "SME responsiveness threshold reached", delta: W.unresponsiveThresholdFloor - score, key: "unresponsive" });
        score = W.unresponsiveThresholdFloor;
    }
    if (input.declinedTouches >= W.repeatDeclineThreshold) {
        add(W.repeatDeclinePenalty, `${input.declinedTouches} declined intervention(s)`, "declines");
    }
    const missed = input.missedAppointments || 0;
    add(Math.min(missed * W.missedAppointmentPerItem, W.missedAppointmentCap), `Missed ${plural(missed, "appointment")} in the last 90 days`, "appointments");
    const declinedAppointments = input.declinedAppointments || 0;
    add(Math.min(declinedAppointments * W.declinedAppointmentPerItem, W.declinedAppointmentCap), `Declined ${plural(declinedAppointments, "appointment")} in the last 90 days`, "appointments");
    const overdue = input.overdueInterventions || 0;
    add(Math.min(overdue * W.overdueInterventionPerItem, W.overdueInterventionCap), `${plural(overdue, "intervention")} past due date`, "overdue");
    const expired = input.expiredComplianceDocs || 0;
    add(Math.min(expired * W.expiredDocPerItem, W.expiredDocCap), `${plural(expired, "compliance document")} expired`, "expired");
    const drop = input.revenueDropPercent ?? null;
    if (drop !== null && drop >= W.revenueSevereDropThreshold) {
        add(W.revenueSevereDropPenalty, `Revenue down ${Math.round(drop)}% on the previous quarter`, "revenue");
    }
    else if (drop !== null && drop >= W.revenueDropThreshold) {
        add(W.revenueDropPenalty, `Revenue down ${Math.round(drop)}% on the previous quarter`, "revenue");
    }
    const followUps = input.overdueFollowUps || 0;
    add(Math.min(followUps * W.overdueFollowUpPerItem, W.overdueFollowUpCap), `${plural(followUps, "outcome check-back")} overdue`, "followUps");
    const queries = input.openQueries || 0;
    add(Math.min(queries * W.openQueryPerItem, W.openQueryCap), `${plural(queries, "open query", "open queries")} or disputes`, "queries");
    if (input.emailBounced)
        add(W.emailBouncedPenalty, "Emails to this SME are bouncing", "bounced");
    const poor = input.poorFeedbackCount || 0;
    add(Math.min(poor * W.poorFeedbackPerItem, W.poorFeedbackCap), `${plural(poor, "low feedback rating")} on recent support`, "feedback");
    if (score > 100) {
        breakdown.push({ label: "Capped at 100", delta: 100 - score });
        score = 100;
    }
    return { score, level: getRiskLevel(score), breakdown };
}
exports.computeRiskScore = computeRiskScore;
function riskTrend(previousScore, score) {
    if (previousScore === null || previousScore === undefined)
        return "new";
    if (score >= previousScore + 5)
        return "up";
    if (score <= previousScore - 5)
        return "down";
    return "same";
}
exports.riskTrend = riskTrend;
/** Alert only when an SME moves up into High or Critical, so a steady state never re-alerts. */
function shouldAlert(previousLevel, level) {
    if (exports.RISK_LEVEL_RANK[level] < exports.RISK_LEVEL_RANK.High)
        return false;
    if (!previousLevel)
        return true;
    return exports.RISK_LEVEL_RANK[level] > exports.RISK_LEVEL_RANK[previousLevel];
}
exports.shouldAlert = shouldAlert;
const SUGGESTIONS = {
    inactivity: { departmentRole: null, text: "Book a check-in session and agree the next intervention." },
    documents: { departmentRole: "financialCompliance", text: "Send a compliance reminder and offer help with the outstanding documents." },
    expired: { departmentRole: "financialCompliance", text: "Send a compliance reminder for the expired documents." },
    departments: { departmentRole: null, text: "Ask the SME to confirm the development plan with the departments waiting on it." },
    unresponsive: { departmentRole: null, text: "Call the SME about the interventions waiting on their response." },
    declines: { departmentRole: null, text: "Meet the SME to understand why support keeps being declined." },
    appointments: { departmentRole: null, text: "Call the SME about missed sessions and rebook at a time that suits them." },
    overdue: { departmentRole: null, text: "Review the overdue interventions with their consultants and set new dates." },
    revenue: { departmentRole: "inhouseFinance", text: "Arrange a finance review of the revenue drop." },
    followUps: { departmentRole: "monitoring", text: "Complete the overdue outcome check-backs." },
    queries: { departmentRole: null, text: "Resolve the open queries and disputes with the SME." },
    bounced: { departmentRole: null, text: "Get a working email address for the SME; reminders aren't reaching them." },
    feedback: { departmentRole: null, text: "Follow up on the low feedback ratings with the SME." },
};
/** The single most useful next step, taken from the biggest driver other than the inactivity baseline when there is one. */
function suggestNextStep(result) {
    const drivers = result.breakdown.filter((item) => item.key && item.delta > 0);
    if (!drivers.length)
        return null;
    const nonBaseline = drivers.filter((item) => item.key !== "inactivity");
    const pick = (nonBaseline.length ? nonBaseline : drivers).sort((a, b) => b.delta - a.delta)[0];
    if (pick.key === "inactivity" && result.score < 45)
        return null;
    const key = pick.key;
    return { driver: key, ...SUGGESTIONS[key] };
}
exports.suggestNextStep = suggestNextStep;
/** Percentage fall from the earlier window's average to the later window's; null without enough months. */
function revenueDropPercent(monthly) {
    const sorted = monthly
        .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && Number.isFinite(row.revenue))
        .sort((a, b) => a.month.localeCompare(b.month));
    if (sorted.length < 4)
        return null;
    const recent = sorted.slice(-3);
    const before = sorted.slice(-6, -3);
    const average = (rows) => rows.reduce((sum, row) => sum + row.revenue, 0) / rows.length;
    const previous = average(before);
    if (previous <= 0)
        return null;
    const drop = ((previous - average(recent)) / previous) * 100;
    return drop > 0 ? Math.round(drop) : 0;
}
exports.revenueDropPercent = revenueDropPercent;
/** When an SME joined: accepted, else joined, else created, on the application, then the participant. */
function smeJoinedAt(application, participant) {
    for (const value of [
        application?.acceptedAt, application?.dateAccepted, application?.joinedAt, application?.createdAt,
        participant?.acceptedAt, participant?.joinedAt, participant?.createdAt,
    ]) {
        if (value === undefined || value === null || value === "")
            continue;
        return asTime(value);
    }
    return null;
}
exports.smeJoinedAt = smeJoinedAt;
const isConfirmed = (value) => value === true || (!!value && typeof value === "object" && value.confirmed === true);
const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
/**
 * Departments the SME's diagnostic plan expects support from, and how many still need
 * follow-up: not confirmed by the department, not confirmed by the SME, or nothing assigned.
 * Split by who has to act: awaitingSme (the department confirmed, the SME hasn't) is the
 * SME's risk; staffDelays (the department hasn't confirmed or assigned) is not.
 * Mirrors the register's department rows, across all departments.
 */
function departmentCoverage(records, assignments) {
    const plan = records.plan || {};
    const closed = new Set([
        ...(records.closedInterventionIds ?? []),
        ...assignments.filter((row) => row?.supportClosedAt).map((row) => String(row.interventionId ?? "").trim()),
    ]);
    const departmentOf = (row) => String(row?.departmentId ?? "").trim() || "unknown";
    const expected = new Set();
    for (const intervention of Array.isArray(plan.interventions) ? plan.interventions : []) {
        if (records.departmentsById[departmentOf(intervention)]?.interventionsDepartment !== true)
            continue;
        if (closed.has(String(intervention?.id ?? "").trim()))
            continue;
        expected.add(departmentOf(intervention));
    }
    const serviced = new Map();
    for (const row of assignments) {
        if (row?.supportClosedAt || !expected.has(departmentOf(row)))
            continue;
        serviced.set(departmentOf(row), (serviced.get(departmentOf(row)) || 0) + 1);
    }
    let missing = 0;
    let fullyConfirmed = 0;
    let awaitingSme = 0;
    let staffDelays = 0;
    for (const departmentId of expected) {
        const byDepartment = isConfirmed(plan.confirmedByDeptId?.[departmentId]);
        const bySme = isConfirmed(firstPresent(plan.smmeConfirmedByDeptId?.[departmentId], plan.incubateeDepartmentConfirmationsByDeptId?.[departmentId]));
        if (byDepartment && bySme)
            fullyConfirmed++;
        if (!byDepartment || !bySme || !serviced.get(departmentId))
            missing++;
        // Who has to act: the SME once the department has confirmed; otherwise the department.
        if (byDepartment && !bySme)
            awaitingSme++;
        else if (!byDepartment || !serviced.get(departmentId))
            staffDelays++;
    }
    return { expected: expected.size, missing, fullyConfirmed, awaitingSme, staffDelays };
}
exports.departmentCoverage = departmentCoverage;
const DAY = 24 * 60 * 60 * 1000;
const norm = (value) => String(value ?? "").trim().toLowerCase();
const asTime = (value) => {
    if (!value)
        return null;
    if (typeof value?.toMillis === "function")
        return value.toMillis();
    if (typeof value?.toDate === "function")
        return value.toDate().getTime();
    if (typeof value?.seconds === "number")
        return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
};
const isClosedAssignment = (row) => ["cancelled", "declined", "needs reassignment", "needs-reassignment"].includes(norm(row.assignmentStatus));
const assigneeDone = (row) => ["done", "complete", "completed"].includes(norm(row.assigneeCompletionStatus));
const smeConfirmed = (row) => ["confirmed", "done", "completed"].includes(norm(row.participantCompletionStatus));
const smeAcceptance = (row) => {
    const status = norm(row.participantAcceptanceStatus);
    if (status === "accepted" || status === "confirmed")
        return "accepted";
    if (status === "declined" || status === "rejected")
        return "declined";
    return "pending";
};
const UNIT_DAYS = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };
// Only support assigned this recently sets an expectation; older cycles have usually ended.
const EXPECTATION_WINDOW_DAYS = 180;
/**
 * Days between services the SME's recurring support expects: the shortest interval among its
 * recent recurring assignments. Null when it has none, e.g. only ad-hoc or once-off support.
 * Reads the stored schedule shape (scheduleMode + recurrence {every, unit}) as
 * src/lib/recurrence.ts writes it. An assignment's `strict` isn't used: a missing value has
 * always been stored as false, so on assignments it doesn't say whether a cycle may be skipped.
 */
function expectedServiceIntervalDays(assignments, now, closedInterventionIds) {
    let shortest = null;
    for (const row of assignments) {
        if (!row || isClosedAssignment(row) || row.supportClosedAt)
            continue;
        if (closedInterventionIds?.has(String(row.interventionId ?? "").trim()))
            continue;
        const mode = norm(row.scheduleMode).replace(/_/g, "-");
        if (mode === "once-off" || mode === "ad-hoc")
            continue;
        const recurrence = row.recurrence;
        if (!recurrence || typeof recurrence !== "object")
            continue;
        const unitDays = UNIT_DAYS[norm(recurrence.unit).replace(/s$/, "")];
        const every = Number(recurrence.every ?? recurrence.interval ?? 1);
        if (!unitDays || !(every > 0))
            continue;
        const assignedAt = asTime(row.assignedAt) ?? asTime(row.createdAt);
        if (assignedAt !== null && assignedAt < now - EXPECTATION_WINDOW_DAYS * DAY)
            continue;
        const days = every * unitDays;
        if (shortest === null || days < shortest)
            shortest = days;
    }
    return shortest;
}
exports.expectedServiceIntervalDays = expectedServiceIntervalDays;
/**
 * Works out the score inputs for one SME from its raw records. The one derivation both
 * the nightly job and the SME Risk Register use: service dates come from completed work
 * and attended sessions; "waiting on the SME" is an unanswered assignment or an
 * unconfirmed completion; department follow-up comes from `coverage` when it's given.
 */
function deriveRiskInputs(records, now) {
    const active = records.assignments.filter((row) => !isClosedAssignment(row));
    const serviceTimes = [];
    for (const row of records.assignments) {
        for (const value of [row.assigneeCompletedAt, row.completedAt]) {
            const time = asTime(value);
            if (time && time <= now)
                serviceTimes.push(time);
        }
    }
    for (const appointment of records.appointments) {
        if (norm(appointment.attendance?.status) !== "attended")
            continue;
        const time = asTime(appointment.attendance?.checkedInAt) ?? asTime(appointment.completedAt);
        if (time && time <= now)
            serviceTimes.push(time);
    }
    if (records.knownServiceAt && records.knownServiceAt <= now)
        serviceTimes.push(records.knownServiceAt);
    const lastService = serviceTimes.length ? Math.max(...serviceTimes) : null;
    const coverage = records.coverage ? departmentCoverage(records.coverage, records.assignments) : null;
    const pendingAcceptance = active.filter((row) => smeAcceptance(row) === "pending" && norm(row.assigneeAcceptanceStatus) !== "declined").length;
    const pendingConfirmation = active.filter((row) => assigneeDone(row) && !smeConfirmed(row)).length;
    const declined = records.assignments.filter((row) => smeAcceptance(row) === "declined").length;
    const overdue = active.filter((row) => {
        const due = asTime(row.dueDate);
        return due !== null && due < now && !(assigneeDone(row) && smeConfirmed(row));
    }).length;
    const since = now - 90 * DAY;
    const recentAppointments = records.appointments.filter((appointment) => {
        const time = asTime(appointment.startAt) ?? asTime(appointment.createdAt);
        return time !== null && time >= since && time <= now;
    });
    const missed = recentAppointments.filter((appointment) => norm(appointment.attendance?.status) === "absent").length;
    const declinedAppointments = recentAppointments.filter((appointment) => norm(appointment.smeConfirmation) === "declined").length;
    const overdueFollowUps = records.followUps.filter((followUp) => {
        const due = asTime(followUp.dueAt);
        return due !== null && due < now && !followUp.answer && !["answered", "closed", "cancelled"].includes(norm(followUp.status));
    }).length;
    const poorFeedback = records.assignments.filter((row) => {
        const rating = Number(row.feedback?.rating);
        const at = asTime(row.feedback?.submittedAt) ?? asTime(row.completedAt) ?? asTime(row.updatedAt);
        return Number.isFinite(rating) && rating > 0 && rating <= 2 && (at === null || at >= now - 180 * DAY);
    }).length;
    return {
        daysSinceLastService: lastService === null ? null : Math.floor((now - lastService) / DAY),
        expectedServiceIntervalDays: expectedServiceIntervalDays(records.assignments, now, records.coverage?.closedInterventionIds),
        // Never serviced: support is assigned but nothing delivered yet. A plan with nothing
        // assigned is the departments' delay (waitingOnStaff), not the SME's.
        hasNeverReceivedService: lastService === null && records.assignments.length > 0,
        waitingOnStaff: lastService === null && records.assignments.length === 0 && (coverage?.staffDelays ?? 0) > 0,
        lastServiceAt: lastService,
        daysSinceJoined: records.joinedAt ? Math.floor((now - records.joinedAt) / DAY) : null,
        docsMissing: records.compliance.missing,
        docsQueried: records.compliance.queried,
        docsRejected: records.compliance.rejected,
        missingDepartmentsCount: coverage?.awaitingSme ?? 0,
        staffDelayDepartments: coverage?.staffDelays ?? 0,
        smePendingAcceptanceCount: pendingAcceptance,
        smePendingConfirmationCount: pendingConfirmation,
        declinedTouches: declined,
        missedAppointments: missed,
        declinedAppointments,
        overdueInterventions: overdue,
        expiredComplianceDocs: records.compliance.expired,
        revenueDropPercent: revenueDropPercent(records.monthlyRevenue),
        overdueFollowUps,
        openQueries: records.openQueries,
        emailBounced: records.emailBounced,
        poorFeedbackCount: poorFeedback,
    };
}
exports.deriveRiskInputs = deriveRiskInputs;
/**
 * Signals the Risk Register page doesn't load live; the nightly snapshot has them.
 * Document counts are not among them: the register and the twin read documents live,
 * as uploads measured against the programme's requirements, and that reading wins.
 */
exports.SNAPSHOT_ONLY_INPUTS = [
    "missedAppointments",
    "declinedAppointments",
    "revenueDropPercent",
    "overdueFollowUps",
    "openQueries",
    "emailBounced",
];
/**
 * An SME's score inputs from live assignments and plan, plus the signals only the nightly
 * snapshot (smeRiskSnapshots/{participantId}) has. The Risk Register and the digital twin
 * both use this, so they show the same score for the same SME.
 */
function scoreInputsFor(args) {
    const stored = args.snapshot?.inputs || null;
    const live = deriveRiskInputs({
        assignments: args.assignments,
        appointments: [],
        monthlyRevenue: [],
        followUps: [],
        openQueries: 0,
        emailBounced: false,
        compliance: { missing: args.docs.missing, queried: args.docs.queried, rejected: args.docs.rejected, expired: args.docs.expired ?? 0 },
        coverage: {
            plan: args.diagnosticPlan || null,
            departmentsById: args.departmentsById,
            closedInterventionIds: args.closedInterventionIds,
        },
        knownServiceAt: typeof stored?.lastServiceAt === "number" ? stored.lastServiceAt : null,
        joinedAt: args.joinedAt,
    }, args.now);
    if (!stored)
        return live;
    const fromSnapshot = Object.fromEntries(exports.SNAPSHOT_ONLY_INPUTS.filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]]));
    return { ...live, ...fromSnapshot };
}
exports.scoreInputsFor = scoreInputsFor;
//# sourceMappingURL=smeRiskLogic.js.map