"use strict";
// Needs-attention score for the digital twin. It is the SME Risk Register's own
// formula (../smeRiskLogic.ts), which the register and the nightly early-warning
// job already share, so a saved twin record and the register can never use
// different weights. Tuning the weights means bumping TWIN_RULE_VERSION in rules.ts.
//
// The shared formula tags each reason by area ("inactivity", "documents"...). The
// twin also says who each reason is waiting on, so this adds a finer key per reason.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRiskScore = exports.NEEDS_ATTENTION_WEIGHTS = exports.getRiskLevel = void 0;
const smeRiskLogic_1 = require("../smeRiskLogic");
Object.defineProperty(exports, "getRiskLevel", { enumerable: true, get: function () { return smeRiskLogic_1.getRiskLevel; } });
Object.defineProperty(exports, "NEEDS_ATTENTION_WEIGHTS", { enumerable: true, get: function () { return smeRiskLogic_1.RISK_SCORE_WEIGHTS; } });
const W = smeRiskLogic_1.RISK_SCORE_WEIGHTS;
/** The base (inactivity) reason, decided by the same order of rules as the shared formula. */
function inactivityKey(input) {
    const joined = input.daysSinceJoined ?? null;
    const notYetServiced = input.hasNeverReceivedService || input.daysSinceLastService === null;
    if (notYetServiced && joined !== null && joined >= 0 && joined < W.newSmeGraceDays)
        return 'new-sme';
    if (notYetServiced && input.waitingOnStaff)
        return 'waiting-on-staff';
    if (input.hasNeverReceivedService)
        return 'never-serviced';
    if (input.daysSinceLastService === null)
        return 'service-date-unknown';
    const cycles = (0, smeRiskLogic_1.cyclesWithoutService)(input);
    if (cycles >= W.inactiveSevereCycles)
        return 'inactive-6-months';
    if (cycles >= W.inactiveLongCycles)
        return 'inactive-3-months';
    if (cycles >= 1)
        return 'inactive-1-month';
    return 'recently-serviced';
}
function reasonKey(item, input) {
    const label = item.label;
    switch (item.key) {
        case 'inactivity': return inactivityKey(input);
        case 'documents':
            if (label.includes('queried'))
                return 'documents-queried';
            if (label.includes('rejected'))
                return 'documents-rejected';
            return 'documents-missing';
        case 'expired': return 'documents-expired';
        case 'departments': return 'departments-follow-up';
        case 'unresponsive': return label.startsWith('SME responsiveness threshold') ? 'sme-responsiveness-floor' : 'awaiting-sme-response';
        case 'declines': return 'repeat-declines';
        case 'appointments': return label.startsWith('Declined') ? 'declined-appointments' : 'missed-appointments';
        case 'overdue': return 'overdue-interventions';
        case 'revenue': return 'revenue-drop';
        case 'followUps': return 'follow-ups-overdue';
        case 'queries': return 'open-queries';
        case 'bounced': return 'email-bouncing';
        case 'feedback': return 'poor-feedback';
        default: return 'capped';
    }
}
/** The shared score, with a twin reason key on every part of it. */
function computeRiskScore(input) {
    const result = (0, smeRiskLogic_1.computeRiskScore)(input);
    return {
        score: result.score,
        level: result.level,
        breakdown: result.breakdown.map(item => ({ key: reasonKey(item, input), label: item.label, delta: item.delta }))
    };
}
exports.computeRiskScore = computeRiskScore;
//# sourceMappingURL=needsAttention.js.map