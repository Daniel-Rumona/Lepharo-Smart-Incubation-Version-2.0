"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for the shared digital-twin rules. Run with `npm run test:twin` in functions/.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const lifecycle_1 = require("./lifecycle");
const rules_1 = require("./rules");
const NOW = new Date("2026-10-17T08:00:00Z");
const daysFromNow = (days) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
// One fixture per reachable lifecycle key. "assigned" is the resolver's final
// fallback and no combination of normalised statuses reaches it today.
const LIFECYCLE_FIXTURES = [
    ["cancelled", { assignmentStatus: "cancelled" }],
    ["needs-reassignment", { assigneeAcceptanceStatus: "declined" }],
    ["participant-declined", { participantAcceptanceStatus: "declined" }],
    ["participant-rejected", { participantAcceptanceStatus: "accepted", participantCompletionStatus: "rejected" }],
    ["completed", { assignmentStatus: "completed" }],
    ["awaiting-participant-acceptance", {}],
    ["in-delivery", { participantAcceptanceStatus: "accepted" }],
    ["awaiting-participant-confirmation", { participantAcceptanceStatus: "accepted", assigneeCompletionStatus: "completed" }],
];
for (const [key, fixture] of LIFECYCLE_FIXTURES) {
    (0, node_test_1.test)(`lifecycle: ${key}`, () => {
        strict_1.default.equal((0, lifecycle_1.resolveAssignmentLifecycle)(fixture).key, key);
    });
}
(0, node_test_1.test)("lifecycle: SME confirmation completes even when assignmentStatus lags", () => {
    strict_1.default.equal((0, lifecycle_1.resolveAssignmentLifecycle)({ assignmentStatus: "in-progress", participantCompletionStatus: "confirmed" }).key, "completed");
});
(0, node_test_1.test)("coverage: facilitator completion alone is waiting on the SME, not completed", () => {
    const state = (0, rules_1.classifyAssignment)({
        assignmentStatus: "in-progress",
        participantAcceptanceStatus: "accepted",
        assigneeCompletionStatus: "completed",
    });
    strict_1.default.equal(state.isCompleted, false);
    strict_1.default.equal(state.awaitingSmeConfirmation, true);
});
(0, node_test_1.test)("coverage: only the SME declining or a cancellation counts as declined", () => {
    const declined = (fixture) => (0, rules_1.classifyAssignment)(fixture).isDeclined;
    strict_1.default.equal(declined({ assignmentStatus: "cancelled", participantAcceptanceStatus: "declined" }), true);
    strict_1.default.equal(declined({ assignmentStatus: "cancelled" }), true);
    // The facilitator declined: waiting on staff to reassign, not the SME's decline.
    strict_1.default.equal(declined({ assigneeAcceptanceStatus: "declined", participantAcceptanceStatus: "accepted" }), false);
    // The SME rejected a completion: it answered, so it is neither declined nor unresponsive.
    const rejected = (0, rules_1.classifyAssignment)({ participantAcceptanceStatus: "accepted", assigneeCompletionStatus: "completed", participantCompletionStatus: "rejected" });
    strict_1.default.equal(rejected.isDeclined, false);
    strict_1.default.equal(rejected.awaitingSmeConfirmation, false);
});
(0, node_test_1.test)("delivery: overdue means open and past due, never completed", () => {
    const summary = (0, rules_1.summarizeDelivery)([
        { participantAcceptanceStatus: "accepted", dueDate: daysFromNow(-3) },
        { assignmentStatus: "completed", dueDate: daysFromNow(-3) },
        { participantAcceptanceStatus: "accepted", dueDate: daysFromNow(5) },
    ], NOW);
    strict_1.default.equal(summary.overdue, 1);
    strict_1.default.equal(summary.completed, 1);
    strict_1.default.equal(summary.open, 2);
});
(0, node_test_1.test)("compliance: sub-collection upload overrides the embedded copy", () => {
    const rows = (0, rules_1.resolveComplianceRows)({
        requirements: [
            { key: "tax clearance", title: "Tax Clearance", hasExpiry: false, expiryMonths: null },
            { key: "bee certificate", title: "BEE Certificate", hasExpiry: false, expiryMonths: null },
        ],
        embedded: [{ type: "Tax Clearance", status: "rejected" }],
        uploads: [{ type: "tax clearance", status: "valid" }],
        now: NOW,
    });
    strict_1.default.equal(rows[0].status, "valid");
    strict_1.default.equal(rows[0].source, "subcollection");
    strict_1.default.equal(rows[1].status, "missing");
});
(0, node_test_1.test)("compliance: expiry turns valid into expiring-soon, then expired", () => {
    const rows = (0, rules_1.resolveComplianceRows)({
        requirements: [],
        embedded: [],
        uploads: [
            { type: "Soon", status: "valid", expiryDate: daysFromNow(10) },
            { type: "Gone", status: "valid", expiryDate: daysFromNow(-1) },
        ],
        now: NOW,
    });
    strict_1.default.deepEqual(rows.map((row) => row.status), ["expiring-soon", "expired"]);
    const summary = (0, rules_1.summarizeCompliance)(rows);
    strict_1.default.equal(summary.covered, 1);
    strict_1.default.equal(summary.expired, 1);
});
const BASE_INPUTS = {
    daysSinceLastService: 47,
    hasNeverReceivedService: false,
    docsMissing: 2,
    docsQueried: 0,
    docsRejected: 0,
    missingDepartmentsCount: 0,
    smePendingAcceptanceCount: 1,
    smePendingConfirmationCount: 0,
    declinedTouches: 0,
};
(0, node_test_1.test)("needs attention: unchanged register weights", () => {
    const result = (0, rules_1.computeRiskScore)(BASE_INPUTS);
    strict_1.default.equal(result.score, 61);
    strict_1.default.equal(result.level, "High");
    strict_1.default.deepEqual(result.breakdown.map((item) => item.delta), [45, 8, 8]);
});
(0, node_test_1.test)("outlook: inactivity crossing 90 days moves the level on a known day", () => {
    const inputs = { ...BASE_INPUTS, daysSinceLastService: 80, docsMissing: 0, smePendingAcceptanceCount: 0 };
    const outlook = (0, rules_1.projectOutlook)({ inputs, complianceRows: [], assignments: [], now: NOW });
    strict_1.default.equal((0, rules_1.computeRiskScore)(inputs).level, "Medium");
    strict_1.default.equal(outlook.nextChange?.inDays, 10);
    strict_1.default.equal(outlook.nextChange?.toLevel, "High");
    strict_1.default.equal(outlook.horizons[0].days, 20);
    strict_1.default.equal(outlook.horizons[0].level, "High");
});
(0, node_test_1.test)("outlook: documents expiring inside the horizon count as missing there", () => {
    const complianceRows = (0, rules_1.resolveComplianceRows)({
        requirements: [],
        embedded: [],
        uploads: [{ type: "Tax", status: "valid", expiryDate: daysFromNow(15) }],
        now: NOW,
    });
    const inputs = { ...BASE_INPUTS, daysSinceLastService: 5, docsMissing: 0, smePendingAcceptanceCount: 0 };
    const outlook = (0, rules_1.projectOutlook)({ inputs, complianceRows, assignments: [], now: NOW });
    strict_1.default.equal(outlook.horizons[0].expiringDocuments.length, 1);
    strict_1.default.equal(outlook.horizons[0].score, (0, rules_1.computeRiskScore)({ ...inputs, daysSinceLastService: 25, docsMissing: 1 }).score);
});
(0, node_test_1.test)("growth: cancelled and reassigned work no longer counts against the SME", () => {
    const compliance = (0, rules_1.summarizeCompliance)([]);
    const score = (0, rules_1.computeGrowthScore)({
        assignments: [{ assignmentStatus: "completed" }, { assignmentStatus: "cancelled" }, { assigneeAcceptanceStatus: "declined" }],
        compliance,
    });
    const interventions = score.components.find((item) => item.key === "interventions");
    strict_1.default.equal(interventions.score, 30);
    strict_1.default.equal(interventions.detail, "1 of 1 interventions completed");
});
(0, node_test_1.test)("business: headcount months keyed by name or by year and month", () => {
    const business = (monthly) => (0, rules_1.summarizeBusiness)({ participant: { headcountHistory: { monthly } }, monthlyMetrics: [], jobContracts: [], now: NOW });
    strict_1.default.deepEqual(business({ September: { permanent: 4, temporary: 1 } }).headcount, { total: 5, period: "Sep 2026", source: "SME profile" });
    strict_1.default.deepEqual(business({ "2026-09": { permanent: 6, temporary: 2 } }).headcount, { total: 8, period: "Sep 2026", source: "SME profile" });
    // A dated key wins over a bare month name, which could be from any year.
    strict_1.default.equal(business({ October: { permanent: 1 }, "2026-10": { permanent: 3 } }).headcount?.total, 3);
});
const peer = (twinId, needsAttention, gender = "Female") => ({
    twinId,
    group: "B",
    programme: "P1",
    sector: null,
    gender,
    needsAttention,
    growth: 50,
    compliancePercent: 70,
    deliveryPercent: 50,
    revenue: null,
    headcount: null,
});
(0, node_test_1.test)("peers: hidden below three peers, lower needs attention is better", () => {
    const self = peer("me", 20);
    const all = [self, peer("a", 30), peer("b", 40), peer("c", 10), peer("d", 90, "Male")];
    const comparisons = (0, rules_1.comparePeers)(self, all);
    const byGender = comparisons.find((item) => item.dimension === "gender");
    strict_1.default.equal(byGender.peerCount, 3);
    strict_1.default.equal(byGender.metrics.find((item) => item.key === "needsAttention").betterThanPercent, 67);
    strict_1.default.equal(comparisons.find((item) => item.dimension === "sector"), undefined);
});
(0, node_test_1.test)("record: scoped to the application's programme and JSON-safe", () => {
    const record = (0, rules_1.buildTwinRecord)({
        application: { id: "app1", participantId: "p1", programId: "prog1", beneficiaryName: "Test SME", applicationStatus: "accepted" },
        participant: { id: "p1", participantName: "Owner" },
        program: { programRequirements: [{ title: "Tax Clearance" }] },
        diagnosticPlans: [],
        assignments: [
            { programId: "prog1", assignmentStatus: "completed" },
            { programId: "prog2", assignmentStatus: "completed" },
        ],
        departments: [],
        movs: [],
        complianceUploads: [],
    }, { now: NOW, source: "daily" });
    strict_1.default.equal(record.twinId, "p1_prog1");
    strict_1.default.equal(record.day, "2026-10-17");
    strict_1.default.equal(record.delivery.total, 1);
    strict_1.default.equal(record.compliance.missing, 1);
    strict_1.default.deepEqual(JSON.parse(JSON.stringify(record)).needsAttention, record.needsAttention);
});
const scenarioRecord = () => (0, rules_1.buildTwinRecord)({
    application: { id: "app1", participantId: "p1", programId: "prog1" },
    participant: { id: "p1" },
    program: { programRequirements: [{ title: "Tax Clearance" }, { title: "BEE Certificate" }] },
    diagnosticPlans: [],
    assignments: [
        { programId: "prog1", assignmentStatus: "completed", completedAt: daysFromNow(-80) },
        { programId: "prog1", participantAcceptanceStatus: "pending" },
    ],
    departments: [],
    movs: [],
    complianceUploads: [],
}, { now: NOW, source: "live" });
(0, node_test_1.test)("scope: main and monitoring departments see the whole SME, others their own", () => {
    const departments = [
        { id: "rom", name: "ROM (Recruitment, Onboarding and Maintenance)", isMain: true, isMonitoring: true },
        { id: "me", name: "M&E (Monitoring and Evaluation)", isMain: true },
        { id: "hse", name: "HSE and Labour Compliance", isMain: false },
    ];
    strict_1.default.equal((0, rules_1.departmentScopeFor)({ departmentId: "rom" }, departments), null);
    strict_1.default.equal((0, rules_1.departmentScopeFor)({ departmentId: "me" }, departments), null);
    strict_1.default.equal((0, rules_1.departmentScopeFor)({}, departments), null);
    strict_1.default.deepEqual((0, rules_1.departmentScopeFor)({ departmentId: "hse" }, departments), { departmentId: "hse", departmentName: "HSE & Labour Compliance" });
});
(0, node_test_1.test)("record: a department's view counts only its services, and every record keeps each department's score", () => {
    const sources = {
        application: { id: "app1", participantId: "p1", programId: "prog1", applicationStatus: "accepted" },
        participant: { id: "p1" },
        diagnosticPlans: [{ participantId: "p1", programId: "prog1", interventions: [
                    { id: "iv-hse", departmentId: "hse", title: "HSE file" },
                    { id: "iv-fin", departmentId: "fin", title: "Financial statements" },
                ] }],
        assignments: [
            { programId: "prog1", departmentId: "hse", interventionId: "iv-hse", assignmentStatus: "completed", completedAt: daysFromNow(-5) },
            { programId: "prog1", departmentId: "fin", interventionId: "iv-fin", assignmentStatus: "assigned", assigneeAcceptanceStatus: "accepted", participantAcceptanceStatus: "pending" },
        ],
        departments: [
            { id: "hse", name: "HSE and Labour Compliance", interventionsDepartment: true },
            { id: "fin", name: "Financial Compliance", interventionsDepartment: true },
        ],
        movs: [],
        complianceUploads: [],
    };
    const whole = (0, rules_1.buildTwinRecord)(sources, { now: NOW, source: "live" });
    const finance = (0, rules_1.buildTwinRecord)(sources, { now: NOW, source: "live", scope: { departmentId: "fin", departmentName: "Financial Compliance" } });
    strict_1.default.equal(whole.scope, null);
    strict_1.default.equal(whole.delivery.total, 2);
    strict_1.default.deepEqual(whole.byDepartment.map((dep) => dep.departmentId).sort(), ["fin", "hse"]);
    strict_1.default.deepEqual(finance.scope, { departmentId: "fin", departmentName: "Financial Compliance" });
    strict_1.default.equal(finance.delivery.total, 1);
    strict_1.default.equal(finance.needsAttention.inputs.smePendingAcceptanceCount, 1);
    // The department's score in a whole-SME record is the score its own view shows.
    strict_1.default.equal(whole.byDepartment.find((dep) => dep.departmentId === "fin").score, finance.needsAttention.score);
    // Growth stays the whole SME's in every view.
    strict_1.default.equal(finance.growth.total, whole.growth.total);
});
(0, node_test_1.test)("what-if: no change matches the saved outlook horizons", () => {
    const record = scenarioRecord();
    const curve = (0, rules_1.projectionCurve)(record, 40);
    for (const horizon of record.outlook.horizons) {
        strict_1.default.equal(curve[horizon.days].score, horizon.score);
    }
    strict_1.default.deepEqual((0, rules_1.scenarioCurve)(record, rules_1.NO_CHANGE_SCENARIO, 40), curve);
});
(0, node_test_1.test)("what-if: a service on day 10 resets inactivity from that day", () => {
    const record = { ...scenarioRecord() };
    record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS, daysSinceLastService: 80, docsMissing: 0, smePendingAcceptanceCount: 0 } };
    const curve = (0, rules_1.scenarioCurve)(record, { ...rules_1.NO_CHANGE_SCENARIO, serviceInDays: 10 }, 40);
    strict_1.default.equal(curve[9].level, "Medium");
    strict_1.default.equal(curve[10].score, (0, rules_1.computeRiskScore)({ ...record.needsAttention.inputs, daysSinceLastService: 0 }).score);
    strict_1.default.equal(curve[40].level, "Medium");
});
(0, node_test_1.test)("what-if: uploads and responses lower the score and lift growth", () => {
    const record = scenarioRecord();
    record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS } };
    const scenario = { ...rules_1.NO_CHANGE_SCENARIO, documentsUploaded: 2, smeResponses: 1 };
    const before = (0, rules_1.scenarioCurve)(record, rules_1.NO_CHANGE_SCENARIO, 0)[0].score;
    const after = (0, rules_1.scenarioCurve)(record, scenario, 0)[0].score;
    strict_1.default.equal(before - after, 8 + 8);
    const growth = (0, rules_1.scenarioGrowth)(record, scenario);
    strict_1.default.equal(growth.counts.documentsCovered, 2);
    strict_1.default.ok(growth.total > record.growth.total);
});
(0, node_test_1.test)("moves: each move runs alone, ranked by its drop in average needs attention", () => {
    const record = scenarioRecord();
    // 47 days without a service, 2 missing documents, 1 intervention awaiting acceptance.
    record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS } };
    const moves = (0, rules_1.simulateMoves)(record, 40);
    const keys = moves.map((move) => move.key);
    strict_1.default.ok(keys.includes("service"), "a service lowers the days ahead even though they drift back by day 40");
    strict_1.default.ok(keys.includes("documentsUploaded") && keys.includes("smeResponses"));
    strict_1.default.ok(!keys.includes("declinesResolved"), "nothing to resolve, so no move");
    moves.forEach((move) => strict_1.default.ok(move.scoreDelta < 0 || move.growthDelta > 0));
    for (let index = 1; index < moves.length; index += 1) {
        const [before, after] = [moves[index - 1], moves[index]];
        strict_1.default.ok(before.scoreDelta < after.scoreDelta || (before.scoreDelta === after.scoreDelta && before.growthDelta >= after.growthDelta));
    }
    const baseline = (0, rules_1.averageOutlook)(record, rules_1.NO_CHANGE_SCENARIO, 40);
    const days = (0, rules_1.scenarioCurve)(record, rules_1.NO_CHANGE_SCENARIO, 40).slice(1);
    strict_1.default.equal(baseline.score, Math.round(days.reduce((sum, day) => sum + day.score, 0) / days.length));
    const upload = moves.find((move) => move.key === "documentsUploaded");
    strict_1.default.equal(upload.score, (0, rules_1.averageOutlook)(record, (0, rules_1.scenarioFromMoves)([upload]), 40).score);
});
(0, node_test_1.test)("moves: chosen together they make one what-if", () => {
    const scenario = (0, rules_1.scenarioFromMoves)([{ change: { documentsUploaded: 2 } }, { change: { serviceInDays: 7 } }]);
    strict_1.default.deepEqual(scenario, { ...rules_1.NO_CHANGE_SCENARIO, documentsUploaded: 2, serviceInDays: 7 });
    strict_1.default.deepEqual((0, rules_1.scenarioFromMoves)([]), rules_1.NO_CHANGE_SCENARIO);
});
(0, node_test_1.test)("mirror: newest past change per source, and how fresh it is", () => {
    const docs = [
        { createdAt: daysFromNow(-90), updatedAt: daysFromNow(-20) },
        { createdAt: daysFromNow(-5) },
        { createdAt: daysFromNow(10) },
    ];
    strict_1.default.equal((0, rules_1.latestChange)(docs, NOW)?.toISOString(), daysFromNow(-5).toISOString());
    strict_1.default.equal((0, rules_1.latestChange)([], NOW), null);
    strict_1.default.equal((0, rules_1.mirrorFreshness)(daysFromNow(-3).toISOString(), NOW), "fresh");
    strict_1.default.equal((0, rules_1.mirrorFreshness)(daysFromNow(-30).toISOString(), NOW), "ageing");
    strict_1.default.equal((0, rules_1.mirrorFreshness)(daysFromNow(-90).toISOString(), NOW), "stale");
    strict_1.default.equal((0, rules_1.mirrorFreshness)(null, NOW), "unknown");
    const record = scenarioRecord();
    const interventions = record.mirror.find((feed) => feed.key === "interventions");
    strict_1.default.equal(interventions.records, 2);
    strict_1.default.equal(interventions.lastChange, daysFromNow(-80).toISOString());
    strict_1.default.deepEqual(record.mirror.map((feed) => feed.key), ["interventions", "documents", "plan", "evidence", "contact", "business"]);
});
(0, node_test_1.test)("why: every reason says who it is waiting on", () => {
    const record = scenarioRecord();
    record.plan = {
        ...record.plan,
        areas: [
            { departmentName: "Finance", deptConfirmed: false, smmeConfirmed: false, services: 0 },
            { departmentName: "Legal", deptConfirmed: true, smmeConfirmed: false, services: 1 },
            { departmentName: "HSE", deptConfirmed: true, smmeConfirmed: true, services: 2 },
        ],
    };
    record.compliance = { ...record.compliance, outstanding: [{ title: "Tax Clearance", status: "missing", expiry: null }, { title: "BEE Certificate", status: "expired", expiry: null }] };
    const inputs = { ...BASE_INPUTS, docsMissing: 2, missingDepartmentsCount: 2, smePendingAcceptanceCount: 1, declinedTouches: 2 };
    const byKey = Object.fromEntries((0, rules_1.explainNeedsAttention)(record, inputs).map((reason) => [reason.key, reason]));
    // A service gap with an unaccepted intervention is on both sides.
    strict_1.default.equal(byKey["inactive-1-month"].owner, "both");
    strict_1.default.match(byKey["inactive-1-month"].detail, /47 days ago.*1 new intervention still waits for the SME to accept/);
    strict_1.default.equal(byKey["documents-missing"].owner, "sme");
    strict_1.default.equal(byKey["documents-missing"].detail, "To upload or renew: Tax Clearance, BEE Certificate.");
    strict_1.default.equal(byKey["departments-follow-up"].owner, "both");
    strict_1.default.equal(byKey["departments-follow-up"].detail, "HOD to review the plan: Finance. SME to confirm the plan: Legal.");
    strict_1.default.equal(byKey["awaiting-sme-response"].waitingOn, "SME");
    strict_1.default.equal(byKey["repeat-declines"].owner, "both");
    // Without anything waiting on the SME, the service gap is staff's.
    const staffOnly = (0, rules_1.explainNeedsAttention)(record, { ...inputs, smePendingAcceptanceCount: 0 });
    strict_1.default.equal(staffOnly.find((reason) => reason.key === "inactive-1-month").owner, "staff");
    // A later day with more documents missing than today is described by its count.
    const later = (0, rules_1.explainNeedsAttention)(record, { ...inputs, docsMissing: 3 });
    strict_1.default.equal(later.find((reason) => reason.key === "documents-missing").detail, "3 documents missing or expired by then.");
    // The deltas are the score's own.
    strict_1.default.deepEqual((0, rules_1.explainNeedsAttention)(record, inputs).map((reason) => reason.delta), (0, rules_1.computeRiskScore)(inputs).breakdown.map((reason) => reason.delta));
});
(0, node_test_1.test)("why: a department only waiting on its HOD names that HOD", () => {
    const record = scenarioRecord();
    record.plan = { ...record.plan, areas: [{ departmentName: "QMS", deptConfirmed: true, smmeConfirmed: true, services: 0 }] };
    const reason = (0, rules_1.explainNeedsAttention)(record, { ...BASE_INPUTS, missingDepartmentsCount: 1 }).find((item) => item.key === "departments-follow-up");
    strict_1.default.equal(reason.owner, "staff");
    strict_1.default.equal(reason.waitingOn, "HOD · QMS");
    strict_1.default.equal(reason.detail, "No service assigned yet: QMS.");
});
//# sourceMappingURL=rules.test.js.map