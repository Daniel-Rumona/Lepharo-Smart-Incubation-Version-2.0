// Where one MOV sits in the evidence chain, as a single comparable position.
//
// The chain spans two records: the per-intervention `movDocuments` doc
// (SME -> HOD) and the monthly `consolidatedMOVs` pack it is rolled into
// (CC confirm -> M&E validate). The field that tells you the position is
// different at each hop, which is why the pages that own each hop cannot
// answer "where is this MOV overall?" - this file does.

import { PACK_STATUS, normalizePackStatus } from '../utils/packStatus'

export type MovStage =
    | 'unrecognised'       // status missing or not one of the real ones: a data problem, not a stage
    | 'awaiting_smme'
    | 'awaiting_hod'
    | 'queried'
    | 'rejected'
    | 'hod_approved'       // approved, not yet rolled into a monthly pack
    | 'in_pack'            // pack submitted, waiting for the Centre Coordinator
    | 'cc_confirmed'       // pack confirmed, waiting for M&E
    | 'me_validated'
    | 'invoice_redeemable'

/** Who has to act next. null = nothing outstanding on the MOV chain. */
export type MovOwner = 'SME' | 'Facilitator' | 'HOD' | 'CC' | 'M&E' | null

export type MovPosition = {
    stage: MovStage
    label: string
    owner: MovOwner
    /** Time the MOV entered this stage, in ms; 0 when it cannot be determined. */
    enteredAt: number
    /** True when the CC step was done by M&E because the CC was away. Display only. */
    ccConfirmedByMe: boolean
    /** True when this stage still needs someone to act. */
    isOpen: boolean
}

export const MOV_STAGE_ORDER: MovStage[] = [
    'unrecognised',
    'awaiting_smme',
    'awaiting_hod',
    'queried',
    'rejected',
    'hod_approved',
    'in_pack',
    'cc_confirmed',
    'me_validated',
    'invoice_redeemable'
]

export const MOV_STAGE_META: Record<MovStage, { label: string; owner: MovOwner }> = {
    unrecognised: { label: 'Status not recognised', owner: null },
    awaiting_smme: { label: 'Awaiting SME confirmation', owner: 'SME' },
    awaiting_hod: { label: 'Awaiting HOD approval', owner: 'HOD' },
    queried: { label: 'Queried', owner: 'Facilitator' },
    rejected: { label: 'Rejected', owner: 'Facilitator' },
    hod_approved: { label: 'Approved - not yet in a pack', owner: 'HOD' },
    in_pack: { label: 'In pack - awaiting CC', owner: 'CC' },
    cc_confirmed: { label: 'CC confirmed - awaiting M&E', owner: 'M&E' },
    me_validated: { label: 'Validated by M&E', owner: null },
    invoice_redeemable: { label: 'Invoice redeemable', owner: null }
}

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()

const millis = (value: any): number => {
    if (!value) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    return 0
}

const approvalAt = (pack: any, step: string): number => {
    const approvals: any[] = Array.isArray(pack?.approvals) ? pack.approvals : []
    for (let i = approvals.length - 1; i >= 0; i -= 1) {
        if (lower(approvals[i]?.step) === step) return millis(approvals[i]?.date)
    }
    return 0
}

const make = (stage: MovStage, enteredAt: number, ccConfirmedByMe = false): MovPosition => ({
    stage,
    label: MOV_STAGE_META[stage].label,
    owner: MOV_STAGE_META[stage].owner,
    enteredAt,
    ccConfirmedByMe,
    isOpen: MOV_STAGE_META[stage].owner !== null
})

/**
 * Position of a single `movDocuments` row. `pack` is the `consolidatedMOVs`
 * doc that contains it, if any (match on department + month + programme).
 *
 * Pack status wins once the MOV is HOD-approved, because from that point the
 * pack - not the MOV - is what moves. M&E also stamps `monitoringApproved`
 * on the MOV itself, so that counts as validated even if the pack is behind.
 */
export function resolveMovPosition(mov: Record<string, any>, pack?: Record<string, any> | null): MovPosition {
    const status = lower(mov?.status)

    if (status === 'rejected') return make('rejected', millis(mov.updatedAt))
    if (status === 'queried') return make('queried', millis(mov.updatedAt))
    if (status === 'awaiting_smme') return make('awaiting_smme', millis(mov.createdAt))
    if (status === 'awaiting_hod') {
        return make('awaiting_hod', millis(mov.smmeSignedAt) || millis(mov.updatedAt) || millis(mov.createdAt))
    }

    // A MOV is created when the facilitator completes the intervention, already awaiting the SME, so there is no draft.
    // Anything else that is not approved is a data problem and is reported as such rather than chased.
    if (status !== 'approved') return make('unrecognised', millis(mov?.createdAt))

    const approvedAt = millis(mov.hodApprovedAt) || millis(mov.updatedAt)
    const packStatus = normalizePackStatus(pack?.status)
    const validated =
        mov.monitoringApproved === true || lower(mov.monitoringValidation?.status) === 'validated'

    if (packStatus === 'invoice_redeemable') {
        return make('invoice_redeemable', millis(pack?.invoiceRedeemableAt) || millis(mov.monitoringApprovedAt))
    }
    if (validated || packStatus === 'validated') {
        return make('me_validated', millis(mov.monitoringApprovedAt) || millis(mov.monitoringValidation?.validatedAt))
    }
    if (packStatus === PACK_STATUS.AWAITING_ME) {
        const onBehalf = !!pack?.ccConfirmationOnBehalf
        return make('cc_confirmed', approvalAt(pack, 'final_confirmation') || millis(pack?.updatedAt), onBehalf)
    }
    if (packStatus === PACK_STATUS.AWAITING_CC) return make('in_pack', millis(pack?.createdAt))

    return make('hod_approved', approvedAt)
}

/** Whole days a MOV has sat in its current stage; 0 when unknown or not open. */
export function daysInStage(position: MovPosition, now: number = Date.now()): number {
    if (!position.isOpen || !position.enteredAt) return 0
    return Math.max(0, Math.floor((now - position.enteredAt) / 86_400_000))
}
