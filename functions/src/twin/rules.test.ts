// Tests for the shared digital-twin rules. Run with `npm run test:twin` in functions/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAssignmentLifecycle, type AssignmentLifecycleKey } from "./lifecycle";
import {
  buildTwinRecord,
  classifyAssignment,
  comparePeers,
  computeGrowthScore,
  computeRiskScore,
  NO_CHANGE_SCENARIO,
  projectOutlook,
  projectionCurve,
  resolveComplianceRows,
  scenarioCurve,
  scenarioGrowth,
  summarizeCompliance,
  summarizeDelivery,
  type PeerProfile,
  type RiskScoreInputs,
} from "./rules";

const NOW = new Date("2026-10-17T08:00:00Z");
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

// One fixture per reachable lifecycle key. "assigned" is the resolver's final
// fallback and no combination of normalised statuses reaches it today.
const LIFECYCLE_FIXTURES: Array<[AssignmentLifecycleKey, Record<string, any>]> = [
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
  test(`lifecycle: ${key}`, () => {
    assert.equal(resolveAssignmentLifecycle(fixture).key, key);
  });
}

test("lifecycle: SME confirmation completes even when assignmentStatus lags", () => {
  assert.equal(resolveAssignmentLifecycle({ assignmentStatus: "in-progress", participantCompletionStatus: "confirmed" }).key, "completed");
});

test("coverage: facilitator completion alone is waiting on the SME, not completed", () => {
  const state = classifyAssignment({
    assignmentStatus: "in-progress",
    participantAcceptanceStatus: "accepted",
    assigneeCompletionStatus: "completed",
  });
  assert.equal(state.isCompleted, false);
  assert.equal(state.awaitingSmeConfirmation, true);
});

test("delivery: overdue means open and past due, never completed", () => {
  const summary = summarizeDelivery(
    [
      { participantAcceptanceStatus: "accepted", dueDate: daysFromNow(-3) },
      { assignmentStatus: "completed", dueDate: daysFromNow(-3) },
      { participantAcceptanceStatus: "accepted", dueDate: daysFromNow(5) },
    ],
    NOW
  );
  assert.equal(summary.overdue, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.open, 2);
});

test("compliance: sub-collection upload overrides the embedded copy", () => {
  const rows = resolveComplianceRows({
    requirements: [
      { key: "tax clearance", title: "Tax Clearance", hasExpiry: false, expiryMonths: null },
      { key: "bee certificate", title: "BEE Certificate", hasExpiry: false, expiryMonths: null },
    ],
    embedded: [{ type: "Tax Clearance", status: "rejected" }],
    uploads: [{ type: "tax clearance", status: "valid" }],
    now: NOW,
  });
  assert.equal(rows[0].status, "valid");
  assert.equal(rows[0].source, "subcollection");
  assert.equal(rows[1].status, "missing");
});

test("compliance: expiry turns valid into expiring-soon, then expired", () => {
  const rows = resolveComplianceRows({
    requirements: [],
    embedded: [],
    uploads: [
      { type: "Soon", status: "valid", expiryDate: daysFromNow(10) },
      { type: "Gone", status: "valid", expiryDate: daysFromNow(-1) },
    ],
    now: NOW,
  });
  assert.deepEqual(rows.map((row) => row.status), ["expiring-soon", "expired"]);
  const summary = summarizeCompliance(rows);
  assert.equal(summary.covered, 1);
  assert.equal(summary.expired, 1);
});

const BASE_INPUTS: RiskScoreInputs = {
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

test("needs attention: unchanged register weights", () => {
  const result = computeRiskScore(BASE_INPUTS);
  assert.equal(result.score, 61);
  assert.equal(result.level, "High");
  assert.deepEqual(result.breakdown.map((item) => item.delta), [45, 8, 8]);
});

test("outlook: inactivity crossing 90 days moves the level on a known day", () => {
  const inputs = { ...BASE_INPUTS, daysSinceLastService: 80, docsMissing: 0, smePendingAcceptanceCount: 0 };
  const outlook = projectOutlook({ inputs, complianceRows: [], assignments: [], now: NOW });
  assert.equal(computeRiskScore(inputs).level, "Medium");
  assert.equal(outlook.nextChange?.inDays, 10);
  assert.equal(outlook.nextChange?.toLevel, "High");
  assert.equal(outlook.horizons[0].days, 20);
  assert.equal(outlook.horizons[0].level, "High");
});

test("outlook: documents expiring inside the horizon count as missing there", () => {
  const complianceRows = resolveComplianceRows({
    requirements: [],
    embedded: [],
    uploads: [{ type: "Tax", status: "valid", expiryDate: daysFromNow(15) }],
    now: NOW,
  });
  const inputs = { ...BASE_INPUTS, daysSinceLastService: 5, docsMissing: 0, smePendingAcceptanceCount: 0 };
  const outlook = projectOutlook({ inputs, complianceRows, assignments: [], now: NOW });
  assert.equal(outlook.horizons[0].expiringDocuments.length, 1);
  assert.equal(outlook.horizons[0].score, computeRiskScore({ ...inputs, daysSinceLastService: 25, docsMissing: 1 }).score);
});

test("growth: cancelled and reassigned work no longer counts against the SME", () => {
  const compliance = summarizeCompliance([]);
  const score = computeGrowthScore({
    assignments: [{ assignmentStatus: "completed" }, { assignmentStatus: "cancelled" }, { assigneeAcceptanceStatus: "declined" }],
    compliance,
  });
  const interventions = score.components.find((item) => item.key === "interventions")!;
  assert.equal(interventions.score, 30);
  assert.equal(interventions.detail, "1 of 1 interventions completed");
});

const peer = (twinId: string, needsAttention: number, gender = "Female"): PeerProfile => ({
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

test("peers: hidden below three peers, lower needs attention is better", () => {
  const self = peer("me", 20);
  const all = [self, peer("a", 30), peer("b", 40), peer("c", 10), peer("d", 90, "Male")];
  const comparisons = comparePeers(self, all);
  const byGender = comparisons.find((item) => item.dimension === "gender")!;
  assert.equal(byGender.peerCount, 3);
  assert.equal(byGender.metrics.find((item) => item.key === "needsAttention")!.betterThanPercent, 67);
  assert.equal(comparisons.find((item) => item.dimension === "sector"), undefined);
});

test("record: scoped to the application's programme and JSON-safe", () => {
  const record = buildTwinRecord(
    {
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
    },
    { now: NOW, source: "daily" }
  );
  assert.equal(record.twinId, "p1_prog1");
  assert.equal(record.day, "2026-10-17");
  assert.equal(record.delivery.total, 1);
  assert.equal(record.compliance.missing, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(record)).needsAttention, record.needsAttention);
});

const scenarioRecord = () =>
  buildTwinRecord(
    {
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
    },
    { now: NOW, source: "live" }
  );

test("what-if: no change matches the saved outlook horizons", () => {
  const record = scenarioRecord();
  const curve = projectionCurve(record, 40);
  for (const horizon of record.outlook.horizons) {
    assert.equal(curve[horizon.days].score, horizon.score);
  }
  assert.deepEqual(scenarioCurve(record, NO_CHANGE_SCENARIO, 40), curve);
});

test("what-if: a service on day 10 resets inactivity from that day", () => {
  const record = { ...scenarioRecord() };
  record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS, daysSinceLastService: 80, docsMissing: 0, smePendingAcceptanceCount: 0 } };
  const curve = scenarioCurve(record, { ...NO_CHANGE_SCENARIO, serviceInDays: 10 }, 40);
  assert.equal(curve[9].level, "Medium");
  assert.equal(curve[10].score, computeRiskScore({ ...record.needsAttention.inputs, daysSinceLastService: 0 }).score);
  assert.equal(curve[40].level, "Medium");
});

test("what-if: uploads and responses lower the score and lift growth", () => {
  const record = scenarioRecord();
  record.needsAttention = { ...record.needsAttention, inputs: { ...BASE_INPUTS } };
  const scenario = { ...NO_CHANGE_SCENARIO, documentsUploaded: 2, smeResponses: 1 };
  const before = scenarioCurve(record, NO_CHANGE_SCENARIO, 0)[0].score;
  const after = scenarioCurve(record, scenario, 0)[0].score;
  assert.equal(before - after, 8 + 8);
  const growth = scenarioGrowth(record, scenario);
  assert.equal(growth.counts.documentsCovered, 2);
  assert.ok(growth.total > record.growth.total);
});
