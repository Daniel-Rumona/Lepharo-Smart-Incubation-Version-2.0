# Digital twin development dataset

**Continue building the twins:** see the [implementation continuation README](../../docs/digital-twins/README.md) for current status, source mappings, visualisation, phased build tasks and acceptance checks.

This seed uses the **existing collections in `lepharo-smart-inc`**. It creates new records only; it does not replace existing SMEs, definitions, staff or programmes.

Dataset: `dtseed_20261009_v1`. Reference clock: 9 October 2026, 10:00 Africa/Johannesburg. Generated historical events retain their synthetic provenance; they are not imported real events.

## What is included

- Two programmes: **Incubation Foundations** (Rustenburg) and **Enterprise Growth** (also Rustenburg; both programmes run from the Rustenburg centre, so its Center Coordinator administers both).
- 60 accepted SMEs and application/profile records, with 12 months of revenue and headcount measurements. Business trajectories are deliberately independent of intervention completion.
- Four demo intervention definitions using the existing Legal Advisory, Financial Compliance, Marketing and Communication, and Training Academy departments.
- 300 assignments across historical cycles, future bookings, delivery exceptions and mixed-attendance groups.
- Canonical `appointmentSessions`, per-SME `appointments`, shared `groupInterventionDeliveries`, individual MOVs, monthly packs and workflow queries.
- Follow-ups and append-only assessments covering achievement, partial achievement, non-achievement, disagreement, non-response, delayed improvement, sustained improvement and reversal.
- Four plainly labelled sample evidence text files in Firebase Storage; these are not genuine evidence, signatures or invoices.
- Synthetic event history and capacity assumptions in `syntheticHistory` and `twinCapacityCalendars`, ready for future twin adapters. No twin frontend or animation is implemented by this seed.

Every record has `dataOrigin: synthetic`, `seedRunId`, `generatorVersion`, `scenarioKey` and `suppressNotifications: true`. Names carry no "[DEMO]" prefix, so tell demo records apart by `dataOrigin: synthetic`, the `dtseed_` ID prefix and `@example.invalid` addresses (the notification safeguards use those markers, never the names). New IDs start with `dtseed_`.

Synthetic SME Firestore profiles and facilitator directory entries are created, **not Firebase Authentication accounts or passwords**. Review through existing authorised administrative views. Existing department HODs/real staff access assignments are not changed. Simulated review actors are in `syntheticActors`; signatures are left empty and approval records identify themselves as fixtures.

Existing unfiltered reports may include the dummy records because these are ordinary application collections. Select the two demo programmes for testing; exclude `dataOrigin == synthetic` when measuring real performance. No global reporting-filter change is included in this seed.

## Commands

Run from the repository root. Credentials are read locally from the existing ignored service-account file and never printed.

```powershell
# Pure local validation and timestamp round-trip / deterministic generation
node scripts/digital-twin/validate.cjs
node --test functions/src/syntheticData.test.cjs

# Local export only
node scripts/digital-twin/seed.cjs --local-only

# Read-only preflight: resolve required departments/branches and detect ID collisions
node scripts/digital-twin/seed.cjs

# AFTER the safeguard functions have been deployed successfully:
node scripts/digital-twin/deployed-functions.cjs
node scripts/digital-twin/verify-safeguards.cjs

# Create missing records. Existing seed-owned records are preserved, not reset.
node scripts/digital-twin/seed.cjs --apply --confirm=dtseed_20261009_v1

# Read records back and validate canonical lifecycle, joins, counts and unchanged originals
node scripts/digital-twin/seed.cjs --verify
```

An interrupted import can be resumed with the identical apply command. It uses batch `create`, rejects collisions with records outside this dataset, and checks its dataset hash against `syntheticSeedRuns/{seedRunId}`. Changing the generator requires a new dataset version rather than overwriting an edited fixture. There is deliberately no broad collection reset/delete command.

The receipt records the exact counts and manifest hash. Local files in `artifacts/digital-twin/` include the generated dataset, dry run, local/live validation, safeguard deployment receipt, existing-record hash baseline and seed receipt. The baseline contains paths and hashes, not original document contents.

### Demographics extension

The original seed has no demographic fields. `seed-demographics.cjs` fills gender, date of birth (and age), B-BBEE level, ward and hub, and black/female/youth ownership shares on one demo programme's synthetic SMEs, plus gender, age group, ward and hub on their applications. Values are deterministic per SME; ownership follows the owner (female or youth ownership is a majority only when the owner is). It sets empty fields only, touches only `dataOrigin: synthetic` records of the original run, and tags each write with `demographicsSeedRunId`. Age is stored as a date of birth rather than a generated ID number, which could belong to a real person. Extension run: `dtseed_20261009_demographics_v1`.

```powershell
node scripts/digital-twin/audit-demographics.cjs        # read-only: what is missing, per programme
node scripts/digital-twin/seed-demographics.cjs         # dry run (Incubation Foundations)
node scripts/digital-twin/seed-demographics.cjs --apply --confirm=dtseed_20261009_demographics_v1
node scripts/digital-twin/seed-demographics.cjs --verify
# Another programme: add --program="Enterprise Growth"
```

Applied to Incubation Foundations and Enterprise Growth on 23 October 2026; the receipts are `artifacts/digital-twin/demographics-receipt-incubation-foundations.json` and `demographics-receipt-enterprise-growth.json`.

## Notification and mutation protections

### Reception walk-in extension

`seed-walkins.cjs` adds historical reception inquiries for all **attended** in-person appointments in the original dataset. It excludes future appointments, cancellations/declines and absent invitees. Each attending SME in a group session gets a separate inquiry. `Resolved` means the reception visit ended, not that intervention verification or business development succeeded.

Records retain branch/programme/SME scope, appointment/session/assignment links and original attendance timestamps. Two `syntheticActors` identify the simulated reception staff without creating accounts or adding email recipients. The original seed manifest and original appointment attendance are unchanged. Extension run: `dtseed_20261009_walkins_v1`.

```powershell
node --test scripts/digital-twin/walkins.test.cjs
node scripts/digital-twin/seed-walkins.cjs --local-only
node scripts/digital-twin/seed-walkins.cjs
# Deploy onInquiryCreatedNotifyStaff and notifyInquirySpecialist safeguards first.
node scripts/digital-twin/deployed-functions.cjs
node scripts/digital-twin/verify-safeguards.cjs
node scripts/digital-twin/seed-walkins.cjs --apply --confirm=dtseed_20261009_walkins_v1
node scripts/digital-twin/seed-walkins.cjs --verify
node scripts/digital-twin/audit-notifications.cjs
```

In Reception / Inquiries select the relevant demo programme, channel **Walk-in**, audience **Incubated SME**, and status **Resolved** or **All**. Clear restrictive date filters to see historical visits. Branch access continues to apply.

The common `functions/src/syntheticData.ts` guard recognises explicit flags and synthetic source identifiers. Guards are applied before notification writes/sends in application, appointment, assignment, follow-up, compliance, MOA, diagnostic-plan, MOV-stage and workflow-query paths, as well as email/push fanout and manual intervention/MOV reminders. Follow-up-derived records retain synthetic metadata. Synthetic programmes do not auto-enrol real branch coordinators; seed-time assignment denormalisation is supplied as a consistent snapshot instead of racing concurrent creation triggers.

Legacy deployed `onMovDocumentWorkflowEmails` and `movValidationReminderCron` were inspected from their deployed source. They act only on MOV statuses `generated` and `signed`; this dataset uses the current pipeline statuses and never seeds either legacy status. Do not add legacy-state fixtures without extending those deployed functions first.

Follow-ups are created before confirmed assignments, preventing their creation trigger from scheduling duplicate follow-ups. Sample contacts use the reserved `example.invalid` domain, phone numbers and push tokens are absent, and no real signatures or actor contacts are copied.

The safeguards deliberately suppress notifications; live notification delivery is not tested against these records. The focused tests exercise actual handler bodies with prohibited external effects. They do not replace authenticated browser tests or establish the future twin's forecast accuracy.
