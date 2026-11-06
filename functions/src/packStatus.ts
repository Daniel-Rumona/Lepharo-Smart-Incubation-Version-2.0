// Consolidated MOV pack statuses, named after who owes the next action.
// Mirror of src/utils/packStatus.ts (functions cannot import from the app).
//
//   HOD saves the monthly pack  -> awaiting_cc   (the Center Coordinator confirms)
//   Center Coordinator confirms -> awaiting_me   (M&E validates)
//   M&E validates               -> validated
//   Invoice can be redeemed     -> invoice_redeemable
//
// Packs written before the rename still carry the old names; readers normalise.

export const PACK_STATUS = {
  AWAITING_CC: "awaiting_cc",
  AWAITING_ME: "awaiting_me",
  VALIDATED: "validated",
  INVOICE_REDEEMABLE: "invoice_redeemable",
} as const;

/** Old name -> current name. */
export const LEGACY_PACK_STATUS: Record<string, string> = {
  submitted_to_me: PACK_STATUS.AWAITING_CC,
  confirmed: PACK_STATUS.AWAITING_ME,
};

/** The current name for any stored pack status; unknown values pass through lower-cased. */
export const normalizePackStatus = (value: unknown): string => {
  const status = String(value ?? "").trim().toLowerCase();
  return LEGACY_PACK_STATUS[status] ?? status;
};

/** Every stored spelling of a current status (the current name plus any old one), for Firestore `in` queries. */
export const storedPackStatuses = (status: string): string[] => [
  status,
  ...Object.entries(LEGACY_PACK_STATUS)
    .filter(([, current]) => current === status)
    .map(([legacy]) => legacy),
];
