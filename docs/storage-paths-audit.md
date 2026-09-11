# Firebase Storage upload paths vs. storage.rules

Audit taken 2026-09-08 by walking every `ref(storage, …)` / `ref(getStorage(), …)`
call reachable from `uploadBytes` / `uploadString` in `src` (36 files),
resolving path variables back to their template literals.

Why it matters: a Storage path with **no** matching rule is denied. And a
catch-all `match /{allPaths=**}` is not a safe shortcut — Storage grants access
when *any* matching rule allows it, so a permissive catch-all silently
overrides every restriction in the file, including `canAccessProposals()`,
which deliberately keeps incubatees out of proposal documents.

`storage.rules` was **not** compared against what is currently deployed. If the
deployed rules are more permissive than this file, deploying this file will
deny everything not listed as covered below. Check the deployed rules first.

## Covered by storage.rules

| Path | Written by |
|---|---|
| `library/{userId}/{file}` | `routes/shared/library` |
| `intervention-evidence/{programId}/{participantId}/{assignmentId}/{file}` | `routes/operations/assignments/RomMovWorkspace`, `routes/shared/allocated`, `services/interventionCompletionService` |
| `participant_documents/{file}` | `routes/registration/onboarding`, `routes/operations/participants/new` |
| `agreements/{participantId}/{file}` | `utils/generateContractPdf` (signed contract PDFs) |
| `projectProposals/{companyCode}/{proposalId}/{folder}/{file}` | `services/proposalService` |
| `projectProposals/{proposalId}/{folder}/{file}` | `routes/programs` |
| `feature-releases/{releaseId}/{file}` | `routes/admin/features` |

## Not yet covered — would be denied

| Path | Written by | Access needed |
|---|---|---|
| `signatures/{uid}_{ts}.png` | `components/layout/account-settings` | Owner writes their own saved signature; broad read (rendered into agreements) |
| `signatures/{uid}/{file}` | `components/modals/WelcomeWizard` | as above |
| `logos/{uid}/{file}` | `routes/applicant/profile`, `utilities/firebaseLogo` | Owner writes; broad read |
| `programLogos/{programId}/{file}` | `routes/programs` | Staff write; broad read |
| `compliance-documents/{file}` | `routes/shared/compliance` | Staff + participant write; staff read |
| `compliance/…` | `routes/incubatee/documents/compliance` | depth unverified |
| `assignedInterventions/{assignmentId}/evidence/{file}` | `routes/coordinator/movs`, `routes/coordinator/interventions/pdswellness`, `routes/shared/allocated` | depth varies per caller — verify each |
| `consolidatedMOVs/…` | `routes/operations/movs` | depth unverified |
| `appointments/{appointmentId}/coverage-photos/{file}` | `services/coveragePhotoService` | Any signed-in attendee writes; broad read |
| `jobContracts/{smeId}/{YYYY-MM}/{file}` | `routes/coordinator/interventions/hse/JobManagement` | Staff write + delete; SME may need read |
| `invoices/{scope}/{YYYY-MM}/{file}` | `routes/operations/inhouse/invoices`, `routes/operations/inhouse/requested/FinanceRequest` | **Staff only** — internal finance |
| `invoicesandquotations/{file}` | `routes/projectmanager/inhouse/requests` | **Staff only** — internal finance |
| `stakeholder-engagements/{id}/{file}` | `routes/operations/stakeholder` | Staff write + delete |
| `success-stories/{id}/cover|evidence/{file}` | `routes/operations/success-challenges` | Staff write |
| `success-stories/sme-{id}/cover|evidence/{file}` | `routes/incubatee/feedback` | Participant write |
| `internal-operations/uploads/{uploaderId}/{file}` | `routes/operations/documentation` | Staff only |
| `implementation-plans/uploads/{programId}/{file}` | `routes/operations/documentation` | Staff |
| `collaborative-reports/templates/{templateId}/source/{file}` | `routes/operations/reports/collaborative` | Staff |
| `collaborative-reports/reports/{reportId}/blocks/{blockId}/{file}` | `routes/operations/reports/collaborative` | Staff |
| `survey_uploads/…` | `components/surveys/response` | depth unverified |
| `task-proofs/…` | `components/department-management/DepartmentWorkroom` | depth unverified |

## Before writing the remaining rules

1. Diff against the deployed rules — that tells you whether these paths
   currently work, and therefore whether adding rules tightens or loosens.
2. Confirm the depth of each `depth unverified` entry against its caller; a
   rule with the wrong number of segments silently denies. The existing
   `intervention-evidence` rule is fixed at four segments while three different
   callers write it, so that one is worth re-checking too.
3. Decide the read model for the finance and HR paths. A plain
   `request.auth != null` read would expose internal invoices and job contracts
   to participants; the `canAccessProposals()` role lookup is the existing
   pattern for excluding them.
