import {
    computeNeedsAttention,
    computeRiskScore,
    deriveOutlookStatus,
    growthFromCounts,
    projectOutlook,
    resolveComplianceRows,
    twinDayKey,
    TWIN_RULE_VERSION,
    type DigitalTwinRecord,
    type RiskScoreInputs
} from '@twin/rules'
import { SAMPLE_TWIN_ID, type DigitalTwinView, type TwinHistoryPoint } from './digitalTwinService'

const DAY_MS = 24 * 60 * 60 * 1000

// Made-up SME for previewing the twin before the database has SMEs. The raw
// facts below are invented; the score, outlook, history and peer comparison are
// worked out from them by the real shared rules.
const SAMPLE_INPUTS: RiskScoreInputs = {
    daysSinceLastService: 75,
    hasNeverReceivedService: false,
    docsMissing: 2,
    docsQueried: 0,
    docsRejected: 0,
    missingDepartmentsCount: 0,
    smePendingAcceptanceCount: 1,
    smePendingConfirmationCount: 0,
    declinedTouches: 1
}

function sampleHistory(now: Date): TwinHistoryPoint[] {
    return Array.from({ length: 90 }, (_, index) => {
        const daysAgo = 89 - index
        const date = new Date(now.getTime() - daysAgo * DAY_MS)
        // Regular service until 75 days ago, then none.
        const daysSinceLastService = daysAgo <= 75 ? 75 - daysAgo : (daysAgo - 75) % 11
        const result = computeRiskScore({
            ...SAMPLE_INPUTS,
            daysSinceLastService,
            smePendingAcceptanceCount: daysAgo <= 40 ? 1 : 0,
            declinedTouches: daysAgo <= 20 ? 1 : 0
        })
        return {
            day: twinDayKey(date),
            needsAttention: result.score,
            level: result.level,
            growth: Math.round(38 + (index / 89) * 20),
            source: 'reconstructed'
        }
    })
}


export function buildSampleTwinView(): DigitalTwinView {
    const now = new Date()
    const at = (days: number) => new Date(now.getTime() + days * DAY_MS)

    const complianceRows = resolveComplianceRows({
        requirements: [],
        embedded: [],
        uploads: [
            { type: 'Tax Clearance Certificate', status: 'valid', expiryDate: at(12) },
            { type: 'BEE Certificate', status: 'valid', expiryDate: at(200) },
            { type: 'Company Registration', status: 'valid' }
        ],
        now
    })
    const assignments = [
        { interventionTitle: 'Financial statements coaching', participantAcceptanceStatus: 'accepted', dueDate: at(9) },
        { interventionTitle: 'HSE file set-up', participantAcceptanceStatus: 'accepted', dueDate: at(31) }
    ]
    const needsAttention = computeNeedsAttention(SAMPLE_INPUTS)
    const projection = projectOutlook({ inputs: SAMPLE_INPUTS, complianceRows, assignments, now })

    const growth = growthFromCounts({
        documentsCovered: 7,
        documentsTotal: 10,
        interventionsCompleted: 6,
        interventionsTotal: 12,
        roadmapConfirmed: 3,
        roadmapTotal: 5,
        roadmapFinal: false,
        responses: 9,
        responseOpportunities: 18
    })
    const growthTotal = growth.total

    const record: DigitalTwinRecord = {
        twinId: SAMPLE_TWIN_ID,
        applicationId: SAMPLE_TWIN_ID,
        participantId: SAMPLE_TWIN_ID,
        programId: null,
        programName: 'Sample programme',
        smeName: 'Sample SME (Pty) Ltd',
        ownerName: 'Sample owner',
        email: null,
        profile: { group: 'B', sector: 'Construction', gender: 'Female', province: 'Gauteng' },
        day: twinDayKey(now),
        calculatedAt: now.toISOString(),
        ruleVersion: TWIN_RULE_VERSION,
        source: 'sample',

        needsAttention,
        growth,
        delivery: {
            total: 12, open: 5, completed: 6, declined: 1, overdue: 2, waitingOnSme: 3,
            byLifecycle: [
                { key: 'completed', label: 'Completed', count: 6 },
                { key: 'in-delivery', label: 'In Delivery', count: 2 },
                { key: 'awaiting-participant-confirmation', label: 'Awaiting SME Confirmation', count: 2 },
                { key: 'awaiting-participant-acceptance', label: 'Awaiting Appointment Response', count: 1 },
                { key: 'participant-declined', label: 'Appointment Declined', count: 1 }
            ]
        },
        evidence: { total: 9, approved: 5, awaitingSme: 2, awaitingHod: 1, draft: 1 },
        compliance: {
            total: 10, covered: 7, expiringSoon: 1, pending: 1, missing: 2, expired: 0, queried: 0, rejected: 0,
            outstanding: [
                { title: 'Bank confirmation letter', status: 'missing', expiry: null },
                { title: 'Shareholder certificates', status: 'missing', expiry: null },
                { title: 'Assessment form', status: 'pending', expiry: null }
            ]
        },
        plan: { departments: 5, departmentConfirmed: 4, smeConfirmed: 3, finalConfirmed: false },
        business: {
            revenue: { monthly: 186500, month: now.toISOString().slice(0, 7), source: 'QuantNow' },
            headcount: { total: 9, period: 'Sep 2026', source: 'SME profile' },
            jobsSustained: 7,
            jobsCreatedLast12Months: 3
        },
        outlook: {
            status: deriveOutlookStatus({ level: needsAttention.level, challenges: [], lastContactAt: at(-21), now }),
            nextAction: 'Follow up with the SME to accept the pending intervention.',
            lastContactAt: at(-21).toISOString(),
            ...projection
        },
        peers: []
    }


    const history = sampleHistory(now)
    history[history.length - 1] = { ...history[history.length - 1], needsAttention: needsAttention.score, level: needsAttention.level, growth: growthTotal, source: 'sample' }

    return { record, origin: 'sample', lastSavedAt: null, history }
}
