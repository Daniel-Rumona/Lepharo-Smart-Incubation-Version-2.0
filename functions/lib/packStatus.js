"use strict";
// Consolidated MOV pack statuses, named after who owes the next action.
// Mirror of src/utils/packStatus.ts (functions cannot import from the app).
//
//   HOD saves the monthly pack  -> awaiting_cc   (the Center Coordinator confirms)
//   Center Coordinator confirms -> awaiting_me   (M&E validates)
//   M&E validates               -> validated
//   Invoice can be redeemed     -> invoice_redeemable
//
// Packs written before the rename still carry the old names; readers normalise.
Object.defineProperty(exports, "__esModule", { value: true });
exports.storedPackStatuses = exports.normalizePackStatus = exports.LEGACY_PACK_STATUS = exports.PACK_STATUS = void 0;
exports.PACK_STATUS = {
    AWAITING_CC: "awaiting_cc",
    AWAITING_ME: "awaiting_me",
    VALIDATED: "validated",
    INVOICE_REDEEMABLE: "invoice_redeemable",
};
/** Old name -> current name. */
exports.LEGACY_PACK_STATUS = {
    submitted_to_me: exports.PACK_STATUS.AWAITING_CC,
    confirmed: exports.PACK_STATUS.AWAITING_ME,
};
/** The current name for any stored pack status; unknown values pass through lower-cased. */
const normalizePackStatus = (value) => {
    const status = String(value ?? "").trim().toLowerCase();
    return exports.LEGACY_PACK_STATUS[status] ?? status;
};
exports.normalizePackStatus = normalizePackStatus;
/** Every stored spelling of a current status (the current name plus any old one), for Firestore `in` queries. */
const storedPackStatuses = (status) => [
    status,
    ...Object.entries(exports.LEGACY_PACK_STATUS)
        .filter(([, current]) => current === status)
        .map(([legacy]) => legacy),
];
exports.storedPackStatuses = storedPackStatuses;
//# sourceMappingURL=packStatus.js.map