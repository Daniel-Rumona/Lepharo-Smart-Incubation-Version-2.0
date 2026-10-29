// Statuses of a consolidated MOV pack (collection `consolidatedMOVs`), named after
// who owes the next action, like the MOV-level `awaiting_smme` / `awaiting_hod`:
//
//   HOD saves the monthly pack  -> awaiting_cc   (the Center Coordinator confirms)
//   Center Coordinator confirms -> awaiting_me   (M&E validates)
//   M&E validates               -> validated
//   Invoice can be redeemed     -> invoice_redeemable
//
// Packs written before the rename carry the old names, so every reader goes
// through normalizePackStatus and both spellings work without a data migration.

export const PACK_STATUS = {
    AWAITING_CC: 'awaiting_cc',
    AWAITING_ME: 'awaiting_me',
    VALIDATED: 'validated',
    INVOICE_REDEEMABLE: 'invoice_redeemable'
} as const

export type PackStatus = (typeof PACK_STATUS)[keyof typeof PACK_STATUS]

/** Old name -> current name. */
const LEGACY_PACK_STATUS: Record<string, PackStatus> = {
    submitted_to_me: PACK_STATUS.AWAITING_CC,
    confirmed: PACK_STATUS.AWAITING_ME
}

/** The current name for any stored pack status; unknown values pass through lower-cased. */
export const normalizePackStatus = (value: unknown): string => {
    const status = String(value ?? '').trim().toLowerCase()
    return LEGACY_PACK_STATUS[status] ?? status
}

export const PACK_STATUS_LABELS: Record<PackStatus, string> = {
    awaiting_cc: 'Awaiting Center Coordinator',
    awaiting_me: 'Awaiting M&E validation',
    validated: 'Validated by M&E',
    invoice_redeemable: 'Invoice redeemable'
}

export const packStatusLabel = (value: unknown): string =>
    PACK_STATUS_LABELS[normalizePackStatus(value) as PackStatus] || String(value ?? '') || '—'
