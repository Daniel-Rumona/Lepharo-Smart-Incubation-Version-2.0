# Reception walk-in seed

Applied to `lepharo-smart-inc` on 9 October 2026. Extension: `dtseed_20261009_walkins_v1`, linked to the original `dtseed_20261009_v1` dataset.

## Added

- **235 inquiries** with source `Walk-in`, audience `Incubatee`, and status `Resolved`.
- Rustenburg: **115**; Springs (Head Office): **120**.
- Two synthetic reception actors, with no authentication accounts, phone numbers or email recipients.
- Every inquiry links to its SME, programme, branch, appointment, session and assigned intervention. Historical arrival/departure timestamps match the appointment attendance.
- Five group sessions contribute ten inquiries, one per attendee.

Excluded 15 future bookings, 30 cancelled/declined visits and five absent group invitees. These retain their original state; no false reception attendance was created. A resolved reception visit does not imply completed intervention verification or a positive business outcome.

## Where to view

Open **Reception / Inquiries**, select the applicable **[DEMO Twin]** programme, choose **Walk-in**, **Incubated SME**, and **Resolved** or **All**. Clear restrictive date filters to include historical visits. Existing branch access restrictions still apply.

## Validation

- All 237 extension documents read back with exact data hashes.
- A second read-only run found zero missing records (`toCreate: 0`), confirming repeat execution would not duplicate visits.
- All 620 source SME, appointment and session records remained unchanged.
- The inquiries collection contained no pre-existing records at preflight.
- Two mapping tests passed, including group attendance, omitted non-attendees, deterministic generation and missing-link failure.
- All 17 notification safeguard tests passed.
- Functions compiled successfully. `onInquiryCreatedNotifyStaff` and `notifyInquirySpecialist` deployed successfully and were verified ACTIVE; the expanded safeguard receipt covers 22 functions.
- The post-import audit found zero synthetic-data notifications and zero synthetic-data email-log entries in its recorded window. This is a database audit, not a provider delivery-log audit.
- Authenticated browser testing was not performed. No frontend or Firestore rules were changed for this extension.

Machine-readable evidence: `walkins-verification.json`, `walkins-dry-run.json`, `notification-audit.json`, and `safeguard-receipt.json` in this directory. Firestore stores a separate extension manifest with a create-only resume mechanism.

Dataset SHA-256: `8f11faa3f2a8e0a64e924703f51c042ad5f662536ca191675e2ed38d4d9d95af`.

## Files changed for this extension

- `functions/src/emailInquiries.ts` and `functions/src/inquiryReferral.ts`: synthetic inquiry notification guards.
- `functions/src/syntheticData.test.cjs`: inquiry creation/referral tests and authenticated handler fixture.
- Corresponding build outputs: `functions/lib/emailInquiries.js`, `functions/lib/emailInquiries.js.map`, `functions/lib/inquiryReferral.js`, `functions/lib/inquiryReferral.js.map`.
- `scripts/digital-twin/seed-walkins.cjs`: additive create-only seed, provenance, preflight and readback validation.
- `scripts/digital-twin/walkins.test.cjs`: reception mapping tests.
- `scripts/digital-twin/seed.cjs` and `scripts/digital-twin/verify-safeguards.cjs`: two additional required safeguards; the original dataset generator is unchanged.
- `scripts/digital-twin/README.md`: extension commands and UI filters.
- New reports: `walkins-local.json`, `walkins-dry-run.json`, `walkins-verification.json`, and this report. Refreshed deployment inventory, safeguard receipt and notification audit.
