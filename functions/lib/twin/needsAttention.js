"use strict";
// Needs-attention score: the 0-100 score the SME Risk Register shows, with a
// reason for every point. Shared by the web app (re-exported from the register's
// riskEngine.ts) and the nightly digital-twin job, so a saved twin record and the
// register can never use different weights. Keep this file free of imports so
// both builds can compile it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRiskScore = exports.getRiskLevel = exports.NEEDS_ATTENTION_WEIGHTS = void 0;
// Named weights for the score. Values are unchanged from the original register
// implementation; tuning them means bumping TWIN_RULE_VERSION in rules.ts.
exports.NEEDS_ATTENTION_WEIGHTS = {
    neverReceivedService: 85,
    unknownLastService: 70,
    inactive6Months: 80,
    inactive3Months: 65,
    inactive1Month: 45,
    recentlyServiced: 15,
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
    repeatDeclineThreshold: 2
};
function getRiskLevel(score) {
    if (score >= 75)
        return 'Critical';
    if (score >= 50)
        return 'High';
    if (score >= 25)
        return 'Medium';
    return 'Low';
}
exports.getRiskLevel = getRiskLevel;
function computeRiskScore(input) {
    const weights = exports.NEEDS_ATTENTION_WEIGHTS;
    const breakdown = [];
    let score;
    if (input.hasNeverReceivedService) {
        score = weights.neverReceivedService;
        breakdown.push({ label: 'Never received an expected service', delta: score });
    }
    else if (input.daysSinceLastService === null) {
        score = weights.unknownLastService;
        breakdown.push({ label: 'Last service date unknown', delta: score });
    }
    else if (input.daysSinceLastService >= 180) {
        score = weights.inactive6Months;
        breakdown.push({ label: 'No service in 6+ months', delta: score });
    }
    else if (input.daysSinceLastService >= 90) {
        score = weights.inactive3Months;
        breakdown.push({ label: 'No service in 3+ months', delta: score });
    }
    else if (input.daysSinceLastService >= 30) {
        score = weights.inactive1Month;
        breakdown.push({ label: 'No service in 1+ month', delta: score });
    }
    else {
        score = weights.recentlyServiced;
        breakdown.push({ label: 'Recently serviced', delta: score });
    }
    const missingDocsDelta = Math.min(input.docsMissing * weights.missingDocPerItem, weights.missingDocCap);
    if (missingDocsDelta > 0) {
        score += missingDocsDelta;
        breakdown.push({ label: `${input.docsMissing} missing document(s)`, delta: missingDocsDelta });
    }
    const queriedDocsDelta = Math.min(input.docsQueried * weights.queriedDocPerItem, weights.queriedDocCap);
    if (queriedDocsDelta > 0) {
        score += queriedDocsDelta;
        breakdown.push({ label: `${input.docsQueried} queried document(s)`, delta: queriedDocsDelta });
    }
    const rejectedDocsDelta = Math.min(input.docsRejected * weights.rejectedDocPerItem, weights.rejectedDocCap);
    if (rejectedDocsDelta > 0) {
        score += rejectedDocsDelta;
        breakdown.push({ label: `${input.docsRejected} rejected document(s)`, delta: rejectedDocsDelta });
    }
    const missingDeptDelta = Math.min(input.missingDepartmentsCount * weights.missingDeptPerItem, weights.missingDeptCap);
    if (missingDeptDelta > 0) {
        score += missingDeptDelta;
        breakdown.push({ label: `${input.missingDepartmentsCount} department(s) needing follow-up`, delta: missingDeptDelta });
    }
    const unresponsiveCount = input.smePendingAcceptanceCount + input.smePendingConfirmationCount;
    const unresponsiveDelta = Math.min(unresponsiveCount * weights.unresponsivePerItem, weights.unresponsiveCap);
    if (unresponsiveDelta > 0) {
        score += unresponsiveDelta;
        breakdown.push({ label: `${unresponsiveCount} intervention(s) awaiting SME response`, delta: unresponsiveDelta });
    }
    if (unresponsiveCount >= weights.unresponsiveThresholdCount && score < weights.unresponsiveThresholdFloor) {
        breakdown.push({ label: 'SME responsiveness threshold reached', delta: weights.unresponsiveThresholdFloor - score });
        score = weights.unresponsiveThresholdFloor;
    }
    if (input.declinedTouches >= weights.repeatDeclineThreshold) {
        score += weights.repeatDeclinePenalty;
        breakdown.push({ label: `${input.declinedTouches} declined intervention(s)`, delta: weights.repeatDeclinePenalty });
    }
    if (score > 100) {
        breakdown.push({ label: 'Capped at 100', delta: 100 - score });
        score = 100;
    }
    return { score, level: getRiskLevel(score), breakdown };
}
exports.computeRiskScore = computeRiskScore;
//# sourceMappingURL=needsAttention.js.map