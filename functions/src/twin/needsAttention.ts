// Needs-attention score for the digital twin. It is the SME Risk Register's own
// formula (../smeRiskLogic.ts), which the register and the nightly early-warning
// job already share, so a saved twin record and the register can never use
// different weights. Tuning the weights means bumping TWIN_RULE_VERSION in rules.ts.
//
// The shared formula tags each reason by area ("inactivity", "documents"...). The
// twin also says who each reason is waiting on, so this adds a finer key per reason.

import {
    computeRiskScore as computeSharedRiskScore,
    cyclesWithoutService,
    getRiskLevel,
    RISK_SCORE_WEIGHTS,
    type RiskBreakdownItem,
    type RiskLevel,
    type RiskScoreInputs
} from '../smeRiskLogic'

export { getRiskLevel }
export { RISK_SCORE_WEIGHTS as NEEDS_ATTENTION_WEIGHTS }
export type { RiskLevel, RiskScoreInputs }

/** What each part of the score is about, so the twin can say who it is waiting on. */
export type RiskReasonKey =
    | 'new-sme'
    | 'waiting-on-staff'
    | 'never-serviced'
    | 'service-date-unknown'
    | 'inactive-6-months'
    | 'inactive-3-months'
    | 'inactive-1-month'
    | 'recently-serviced'
    | 'documents-missing'
    | 'documents-queried'
    | 'documents-rejected'
    | 'documents-expired'
    | 'departments-follow-up'
    | 'awaiting-sme-response'
    | 'sme-responsiveness-floor'
    | 'repeat-declines'
    | 'missed-appointments'
    | 'declined-appointments'
    | 'overdue-interventions'
    | 'revenue-drop'
    | 'follow-ups-overdue'
    | 'open-queries'
    | 'email-bouncing'
    | 'poor-feedback'
    | 'capped'

export type RiskReason = { key: RiskReasonKey; label: string; delta: number }

export type RiskScoreResult = {
    score: number
    level: RiskLevel
    breakdown: RiskReason[]
}

const W = RISK_SCORE_WEIGHTS

/** The base (inactivity) reason, decided by the same order of rules as the shared formula. */
function inactivityKey(input: RiskScoreInputs): RiskReasonKey {
    const joined = input.daysSinceJoined ?? null
    const notYetServiced = input.hasNeverReceivedService || input.daysSinceLastService === null
    if (notYetServiced && joined !== null && joined >= 0 && joined < W.newSmeGraceDays) return 'new-sme'
    if (notYetServiced && input.waitingOnStaff) return 'waiting-on-staff'
    if (input.hasNeverReceivedService) return 'never-serviced'
    if (input.daysSinceLastService === null) return 'service-date-unknown'
    const cycles = cyclesWithoutService(input)
    if (cycles >= W.inactiveSevereCycles) return 'inactive-6-months'
    if (cycles >= W.inactiveLongCycles) return 'inactive-3-months'
    if (cycles >= 1) return 'inactive-1-month'
    return 'recently-serviced'
}

function reasonKey(item: RiskBreakdownItem, input: RiskScoreInputs): RiskReasonKey {
    const label = item.label
    switch (item.key) {
        case 'inactivity': return inactivityKey(input)
        case 'documents':
            if (label.includes('queried')) return 'documents-queried'
            if (label.includes('rejected')) return 'documents-rejected'
            return 'documents-missing'
        case 'expired': return 'documents-expired'
        case 'departments': return 'departments-follow-up'
        case 'unresponsive': return label.startsWith('SME responsiveness threshold') ? 'sme-responsiveness-floor' : 'awaiting-sme-response'
        case 'declines': return 'repeat-declines'
        case 'appointments': return label.startsWith('Declined') ? 'declined-appointments' : 'missed-appointments'
        case 'overdue': return 'overdue-interventions'
        case 'revenue': return 'revenue-drop'
        case 'followUps': return 'follow-ups-overdue'
        case 'queries': return 'open-queries'
        case 'bounced': return 'email-bouncing'
        case 'feedback': return 'poor-feedback'
        default: return 'capped'
    }
}

/** The shared score, with a twin reason key on every part of it. */
export function computeRiskScore(input: RiskScoreInputs): RiskScoreResult {
    const result = computeSharedRiskScore(input)
    return {
        score: result.score,
        level: result.level,
        breakdown: result.breakdown.map(item => ({ key: reasonKey(item, input), label: item.label, delta: item.delta }))
    }
}
