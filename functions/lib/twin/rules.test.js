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
//# sourceMappingURL=rules.test.js.map