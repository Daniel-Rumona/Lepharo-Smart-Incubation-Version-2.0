# Digital twin seed completed

Date: 9 October 2026. Project: `lepharo-smart-inc`. Dataset: `dtseed_20261009_v1`.

Created **3,444 synthetic records** in the existing application collections, plus the seed manifest and four labelled sample evidence files. Existing records were not overwritten.

## Where to find the data

Select either **[DEMO Twin] Incubation Foundations** (Rustenburg) or **[DEMO Twin] Enterprise Growth** (Springs). The four departments are Legal Advisory Services, Financial Compliance, Marketing and Communication, and Training Academy.

The SMEs and intervention definitions display `[DEMO]` names. All seed-owned documents carry synthetic provenance and notification-suppression metadata. Existing unfiltered reporting can include these records; select the demo programmes when testing.

| Records | Created |
|---|---:|
| Programmes | 2 |
| SMEs / applications / user profiles | 60 each |
| Diagnostic plans | 60 |
| Demo intervention definitions | 4 |
| Assigned interventions | 300 |
| Shared appointment sessions | 275 |
| Per-SME appointments | 285 |
| Group delivery records | 5 |
| MOV documents | 235 |
| Consolidated MOV packs | 35 |
| Outcome follow-ups | 190 |
| Outcome assessments | 365 |
| Workflow queries | 45 |
| Monthly business measurements | 720 |
| Synthetic historical transition records | 725 |
| Facilitator directory entries | 4 |
| Synthetic actor records | 10 |
| Capacity calendars | 4 |

## Outcome and workflow coverage

190 assignments are completed. Their latest facilitator outcome summaries include 115 achieved, 15 partial and 30 not-yet-achieved results; 30 have no assessment yet. Historical assessments also include delayed improvement, sustained improvement, reversal and disagreement with the SME's report. The remaining assignments exercise scheduling, active delivery, pending completion confirmation, rejection, cancellation, decline and reassignment.

All ten current MOV pipeline stages are represented. Five group sessions each include three invitees and two attendees, with no MOV created for the absent member. Revenue and headcount histories cover October 2025 to September 2026; future appointment dates extend into the following three months. Capacity and cost assumptions are explicitly synthetic.

## Verification performed

- Read back and validated all 3,444 records, including exact per-collection counts, cross-record links, canonical assignment lifecycle results, MOV stages, group attendance, timestamp consistency and expected outcome summaries.
- The live data matched the generated dataset with **zero record drift**.
- Compared **172 pre-existing records** across the touched collections against their saved hashes: **zero changes**.
- All **15 focused safeguard tests passed**, including synthetic programme access protection and manual reminders for app-generated records in a demo programme.
- Functions compiled and 20 distinct safeguard functions were deployed. The manual reminder function received an additional update to recognise derived records by programme scope.
- The post-seed audit found **zero seed-related notification records and zero seed-related email-log entries** in its recorded audit window.
- All four sample evidence download URLs returned HTTP 200 with the expected content.

Live verification completed at 17:08 Africa/Harare on 9 October 2026. Exact machine-readable timestamps and evidence are in `verification-live.json`, `notification-audit.json`, `seed-receipt.json`, and `safeguard-receipt.json` beside this report.

Dataset SHA-256: `47b7733ad9986f9c4bd9d89fc81fb96125388ae37ef5fe30b7129cd5f3ded9cf`.

## Boundaries

This seeds data and protects the relevant notification paths; it does not implement the digital twin frontend, animation or simulation engine. Authenticated browser workflow testing has not been performed. The demo profiles are Firestore records, not new Firebase Authentication logins. No real signatures, invoices, contact numbers or business evidence were copied. Sample evidence consists of clearly labelled text files.

The seed is repeatable and create-only. The same apply command skips already-present seed-owned records and rejects collisions with other data. Generator changes should use a new dataset version, preserving any fixtures edited through the application. See `scripts/digital-twin/README.md` for commands and operational details.
