# Outcome-driven intervention model — codebase audit

Status: audit only. No application code was changed.
Method: I read the core files listed under "Read in full" and located the remaining consumers by repo-wide search. Search-located files are flagged **(grep only)**. Confirm them during Phase 1 design before you rely on them.

Read in full or at length: `types/intervetion.ts`, `types/mov.ts`, `lib/interventions.ts`, `services/{assignedIntervention,assignmentLifecycle,interventionCompletion,mov,poe,poeSync}Service.ts`, `components/evidence/EvidenceManagerPanel.tsx`, `config/evidencePolicy.ts`, `routes/operations/interventions/index.tsx` (definition form and save), the risk score section of `SMERiskRegister/riskEngine.ts`, `firestore.rules` (assignments, sessions).

Naming trap: `routes/shared/library/index.tsx` is the **materials** library (`libraryMaterials`). The **Intervention Library** is `routes/operations/interventions/index.tsx`, which writes to the `interventions` collection.

---

## A. Current architecture

```
interventions (definition)                 routes/operations/interventions/index.tsx
  title, areaOfSupport, departmentId, compulsory, recurrence*, hasSubInterventions,
  subInterventions[], defaultPlannedSessions, definitionVersion (bumped every save)
        │  assign (operations/assignments; compulsory auto-allocation)
        ▼
assignedInterventions (one per SME per cycle)      services/assignedInterventionService.ts
  lifecycle fields: assignmentStatus, assignee/participant Acceptance/Completion statuses
  computedProgress (0-100), progressUpdates[] (embedded array), resources[] (evidence),
  movDocumentId, groupKey, target{mode}, definitionSnapshot
        │  grouped deliveries share state in groupInterventionDeliveries (evidence[], progressUpdates[])
        ▼
Delivery: appointments + appointmentSessions (coverage, attendance) → progress updates
        ▼
Completion: completeIntervention()                 services/interventionCompletionService.ts
  1. upload files → resources[] {link,label=filename,originalName,type:'poe'}
  2. transaction: write resources, computedProgress=100, progressUpdates
  3. createMovDraftFromAssignment() → movDocuments (status awaiting_smme), copies resources + progressUpdates
  4. finalise: assigneeCompletionStatus='completed'
        ▼
SME confirms: confirmCompletion()                  lib/interventions.ts
  participantCompletionStatus='confirmed', assignmentStatus='completed'; MOV → awaiting_hod
        ▼
HOD approves (operations/movs ~L2132, projectadmin/movs, coordinator/movs): movDocuments.status='approved', approvedByHod
        ▼
consolidatedMOVs (monthly per-department pack, HOD-signed, invoice attached)
```

Findings that shape the design:

1. **Completion is a lifecycle, not a percentage.** `resolveAssignmentLifecycle` derives `completed` from `assignmentStatus`/`participantCompletionStatus`, not from progress. The nine lifecycle states already include MOV-adjacent steps ("Awaiting SME Confirmation"). Outcome state can sit **beside** this and must not extend it.
2. **"Progress 100%" is still read as "done" in several places.** `reportingUtils.ts` L92/L108 ORs `computedProgress >= 100` into `isCompleted`, and `riskEngine.getComputedProgress` reads it too.
3. **MOV is a hard global requirement today.** `confirmCompletion` → `ensureCompletionMov` throws if no MOV exists. `completeIntervention` creates an MOV for every assignment unless `movAssignmentIds` excludes it (used only for group non-attendees). There is no programme-level switch. The only evidence-policy switch is the global constant `USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE`.
4. **"POE" and "MOV" are already separate concepts in the data**, but not in the UI.
   - POE = `assignedInterventions.resources[]` (type `'poe'`, or `'document'` for document-target interventions).
   - MOV = a `movDocuments` record. Its uploaded signed file is `uploadedMovUrl`.
   - The completion wizard in `routes/shared/allocated/index.tsx` runs them as **sequential steps** (0 progress update, 1 reuse progress evidence, 2 POE, 3 MOV). Side-by-side is a restructure of steps 2 and 3.
   - **Cardinality differs.** For a group, the POE is shared (one file set) and MOVs are per SME. The two-pane UI must be "1 deliverable ↔ N MOVs".
5. **`resources` is overloaded.** It holds POE files, document-target uploads, signed agreements (`type: 'signed_agreement'`) and shared learning links. `poeService.extractCanonicalPoeUrls` returns every `resources[].link` regardless of type. A legacy `poeUrls[]` is also read.
6. **Evidence is copied, not referenced.** The same file reference lives in `assignedInterventions.resources`, `movDocuments.resources` (snapshot at MOV creation) and `groupInterventionDeliveries.evidence`. The de-facto identity is the download URL (`evidence()` de-dupes by `link`). Progress-update attachments are held in `progressUpdates[].resources` until promoted to POE. Reuse already exists for that step ("Continue with N selected POEs").
7. **`progressUpdates` is an unbounded array inside the assignment document** and is copied onto the MOV. Do not put outcome history there (1 MB document limit, and it is written via `arrayUnion`).
8. **Three MOV status vocabularies coexist:** `types/mov.ts` `MOVStatus` (`generated/signed/verified/complete`, which looks legacy), `MovDoc.status` (`awaiting_smme/signed/approved/queried/rejected`), and actual writes (`awaiting_smme → awaiting_hod → approved`). New code must not add a fourth. Outcome state must not live in MOV status.
9. **There is no evidence-detector infrastructure.** No code in `src`, `functions/src` or `ai-backend` implements document-intelligence or a detector. Today the platform can honestly claim **zero** system-observed outcome evidence.
10. **`assignedInterventions` is client-writable by any authenticated user** (`firestore.rules` L333: `allow read, write: if request.auth != null`). Provenance stored there cannot be trusted. See section E and I.
11. `toAssignedInterventionView` and `canonicalizeAssignedInterventionWrite` spread unknown fields through and only strip `DEPRECATED_ASSIGNMENT_FIELDS`, so additive fields survive. **Avoid these reserved names:** `poeFileUrl, proofOfExecutionUrl, poeUrl, evidenceUrl, movFileUrl, evidenceFile, poeFile, status, notes, frequency, progress`.

---

## B. Files affected

Legend: **UI** = interface change, **L** = logic change, **D** = data-model impact.

### Definition and assignment
| File | Responsibility now | Change |
|---|---|---|
| `routes/operations/interventions/index.tsx` | Intervention Library form and save (`payload` at ~L983, `definitionVersion` bump) | **UI:** one collapsed "Outcome & deliverable" section, 2 visible inputs (deliverable name, intended outcome) plus "Suggest for me". **L:** write `outcomeDef` in the payload. `updateDoc` already tolerates extra fields. **D:** `interventions.outcomeDef`. |
| `types/intervetion.ts` | `Assignment`, `Target`, `definitionSnapshot` type | **D:** extend `definitionSnapshot` with `deliverableName` and `outcomeDef` so the name is frozen at assignment. Add the `outcome` summary type. |
| `routes/operations/assignments/index.tsx` (7k lines, **grep only**) | Assignment creation, status modals, ROM MOV workspace | **L:** copy the snapshot on create. **UI:** show the deliverable name in assignment rows. |
| `services/compulsoryInterventionService.ts` (**grep only**) | Auto-allocation | **L:** include the snapshot. |
| `services/assignedInterventionService.ts` | Canonical read/write view | **L:** add `getDeliverableView(row)` and `outcome` normalisation. Keep the spread behaviour. |

### Delivery and completion
| File | Responsibility now | Change |
|---|---|---|
| `routes/shared/allocated/index.tsx` (6,972 lines; ~60 "POE"/"MOV" strings) | Facilitator progress, completion wizard, evidence manager | **UI:** step 2 and 3 become one two-pane step, "MOV per SME" and "`{deliverableName}` (shared)". Replace "POE" labels with the resolved name. Add the light outcome prompt after completion. **L:** call a `resolveEvidenceModel(program)` gate instead of assuming MOV. **D:** tag uploads with `role`. Keep `type:'poe'`. |
| `components/interventions/InterventionCompletionFields.tsx` | Shared "Proof of Execution" upload field | **UI:** label via prop (`deliverableName`), fall back to "Proof of Execution". |
| `components/evidence/EvidenceManagerPanel.tsx` | Generic list, replace, remove, upload | **Reuse as-is.** It already takes `uploadLabel`. Add optional `itemNoun`/`role` badge only. |
| `services/interventionCompletionService.ts` | Completion write path, error copy | **L:** stamp `role:'deliverable'` and `deliverableName` on uploads. Make MOV creation conditional on the programme evidence model. **UI:** error strings say "POE" (L139–151); parameterise but **keep support codes `POE-UPLOAD` and `POE-ATTACH` unchanged** (they are tied to support triage). |
| `services/poeService.ts`, `poeSyncService.ts` | POE URL extraction and merge, replace | **L:** `isPoeResource` matches by `type`/label text ("poe", "evidence", "proof"). **Never overwrite `label` with the deliverable name.** `label` is the filename and used for matching. Put the name in a new `deliverableName` field. Make replace-existing honour `role`. |
| `services/movService.ts` | MOV creation, appointment→MOV rows, KPI names | **No structural change.** It is the service-evidence side. Optionally record `deliverableName` on the MOV snapshot for display. |
| `lib/interventions.ts` | SME accept/decline/confirm, denormalised `applications.interventions.{assigned,completed}` | **L:** `confirmCompletion` must not be blocked by absent outcome data, and must not touch it. Consider adding `outcomeStatus` to `DenormInterventionEntry` (**optional**). |
| `services/assignmentLifecycleService.ts` | Lifecycle state machine | **Do not change.** |
| `routes/shared/appointments/index.tsx` (**grep only**), `services/appointmentSessionService.ts` | Session coverage, completion entry point | **UI/L:** same completion gate as `allocated`. Session coverage (`coveredPoints`) is a candidate *existing* facilitator-evidence source. |
| `routes/incubatee/interventions/index.tsx` (2,185 lines, **grep only**) | SME view and confirm | **UI:** show the deliverable name. Later: SME "has this helped?" self-report. **This is the mobile-critical surface.** |

### MOV review and approval
| File | Change |
|---|---|
| `routes/operations/movs/index.tsx` (3,749), `routes/projectadmin/movs/index.tsx` (2,261), `routes/coordinator/movs/index.tsx`, `routes/operations/monitoring/movs/index.tsx`, `routes/operations/assignments/RomMovWorkspace.tsx` | **UI:** review lists show the "Deliverable" column with its real name. "POE" in remove/confirm copy becomes the name. **L:** none; approval stays `movDocuments.status`. |
| `components/movs/MovDocumentView.tsx`, `ConsolidatedMOVReviewModal.tsx`, `docx/movBuilder.ts` | Optional: print the deliverable name on the MOV. Do not add outcome claims to signed MOV documents. |
| `components/movs/PreIncPoeButton.tsx` | **Leave alone.** "Pre-Inc POE" is a signed agreement (`hasPreIncAgreementEvidence`), not a deliverable. |

### Reporting and analytics (**grep only unless noted**)
| File | What it infers "success" from | Change |
|---|---|---|
| `routes/operations/reports/universal/reportingUtils.ts` (read partly) | `assignmentStatus`, `assigneeCompletionStatus`, `computedProgress>=100` | Add delivered/MOV/deliverable/outcome buckets **alongside**, do not redefine `isCompleted`. |
| `services/interventionMetricsService.ts` (read) | `getAssignedInterventionLifecycle` → assigned/inProgress/completed counts | Extend `InterventionMetricSummary` with optional outcome counts. |
| `components/dashboards/metrics/InterventionMetricsGrid.tsx`, `charts/InterventionsBreakdown.tsx`, `shared/InterventionsDashboard.tsx`, `rom/romDashboard.tsx`, `wellness/index.tsx`, `metrics/DepartmentRisksBottlenecksRow.tsx`, `metrics/MovSubmissionStatusCard.tsx` | completed counts, `computedProgress`, MOV status | Phase 3 tiles. `InterventionsBreakdown.tsx` currently has uncommitted edits in your working tree. |
| `routes/operations/reports/monitoring/*`, `interventionStatus.ts`, `DepartmentInterventionsDrilldown.tsx`, `FacilitatorsTab.tsx` | status classification | Same. |
| `utils/buildMonthlyReportFromAssigned.ts`, `buildExecutiveQuarterlyReport.ts`, `buildProgramSummaryReportWithCharts.ts`, `monthlyReportDocx.ts`, `routes/data-export/*` | completed counts and MOV totals in exported reports | Add columns only. Never change existing column semantics (funder-facing). |
| `routes/kpis/index.tsx`, `lib/kpis.ts`, `services/kpiCalculationService.ts`, `types/kpiCandidate.ts` | KPIs computed from `interventions` counts | **Highest reporting-regression risk.** KPIs bind to intervention-title matching. Do not repoint. Outcome KPIs are new definitions. |
| `routes/funder/*`, `routes/directors/*` | roll-ups | Later. |
| `components/dashboards/charts/ReachAnalytics`, `utils/reportGroupAssignments.ts` | grouping | Verify only. |

### Risk register
`routes/operations/reports/monitoring/SMERiskRegister/riskEngine.ts` (1,249 lines): `computeRiskScore`, `buildRow`, `evaluateInterventionState`, `getInterventionBottleneck`, `buildServiceProgressRows`. See section I.

---

## C. Existing functionality to retain and reuse

- **`EvidenceManagerPanel`** for all upload, replace and remove UI, including the deliverable pane.
- **`completeIntervention` transaction and retry-with-saved-evidence design.** Extend it; don't fork it.
- **Progress-update attachments → "promote to POE"** (allocated steps 0–1). This is already the "reuse existing evidence, don't re-upload" pattern. Outcome evidence should reference the same `resources` entries by link.
- **`definitionVersion` + `definitionSnapshot`**: right mechanism to freeze deliverable name and outcome definition at assignment.
- **Session coverage** (`appointmentSessions.coverage`, `coveredPoints`, per-SME attendance): a ready source of *facilitator-recorded* evidence.
- **`workflowQueries`** (query/response threads on MOVs): usable for follow-up nudges without a new messaging system.
- **Department capability flag pattern** (`isTraining`, `interventionsDepartment`, `isSensitive` on `departments`): the precedent for config-by-flag; the programme evidence model follows it.
- **Compliance stack** (`complianceDocuments`, `complianceResolver`, `complianceVerificationService`, `complianceExpiry.ts`): existing verified-document source for "Compliance achieved" outcomes.
- **Firebase Functions scheduling** (`kpiReminders.ts`, `movValidationReminders.ts`, `complianceExpiry.ts`): the pattern for follow-up-due reminders and any future detectors.
- **`ai-backend`**: existing place for "suggest deliverable and outcome for this title" (same pattern as `gap_mapping.py`, `aiAssistantService`).

---

## D. Gaps

1. No place to state deliverable name or intended outcome on a definition.
2. No `role` on evidence: cannot tell MOV-side from deliverable-side, or deliverable from other `resources`.
3. No outcome state anywhere; lifecycle/`computedProgress` are the only "done" signals.
4. No provenance on evidence (who, when, how verified, from what source).
5. No programme-level evidence model; MOV mandatory globally; only a global boolean for sensitive departments.
6. No follow-up scheduling tied to a delivered intervention (`followUps` is receptionist/inquiry-scoped, not this).
7. No detector or integration registry, so "not system observable" cannot yet be expressed.
8. Firestore rules do not distinguish trusted from user writes for assignments.
9. Completion wizard is sequential and desktop-shaped; no two-pane responsive layout for MOV | deliverable.
10. Reporting has no delivered / MOV / deliverable / outcome separation; risk engine ignores effect.

---

## E. Proposed data model (all optional and additive)

```ts
// interventions/{id}.outcomeDef  — absent on legacy docs; absence = "not tracked"
outcomeDef?: {
  deliverable?: { name: string; description?: string; required?: boolean }   // "Cash Flow Forecast"
  intendedOutcome?: string                                                   // plain sentence
  outcomeType?: 'capability_established' | 'process_implemented' | 'behaviour_adopted'
              | 'compliance_achieved' | 'risk_reduced' | 'performance_improved'
              | 'access_achieved' | 'issue_resolved'
  acceptedMechanisms?: EvidenceMechanism[]     // defaulted from outcomeType, rarely edited
  followUpAfterDays?: number                   // defaulted from outcomeType
  checkAdoption?: boolean
  origin: 'manual' | 'ai_suggested' | 'default'
}
// assignedInterventions/{id}.definitionSnapshot gains: deliverableName?, outcomeDef?   (frozen at assign)

// assignedInterventions/{id}.resources[] entries gain (all optional):
{ role?: 'deliverable' | 'other', deliverableName?: string, evidenceId?: string }
// legacy type:'poe' with no role ⇒ read as role:'deliverable'. Never rewrite label.
// MOV side remains movDocuments (uploadedMovUrl etc.) — unchanged.

// assignedInterventions/{id}.outcome  — DENORMALISED CACHE, written only by outcomeService/Functions
outcome?: {
  status: 'not_tracked' | 'pending' | 'not_yet' | 'partial' | 'achieved'
  adoption?: 'pending' | 'sustained' | 'lapsed'
  confidence: 'not_evidenced' | 'self_reported' | 'facilitator_verified'
            | 'artefact_supported' | 'system_observed' | 'independently_supported'   // derived, never input
  lastAssessedAt?: Timestamp; followUpDueAt?: Timestamp
}

// NEW collection: outcomeAssessments/{id}  (facilitator/SME statements, append-only)
{ assignedInterventionId, participantId, programId, departmentId, kind: 'initial'|'follow_up',
  assessment: 'not_yet'|'partial'|'achieved', note?: string, by: uid, byRole, at,
  evidenceIds: string[] }

// NEW collection: outcomeEvidence/{id}  (provenance-carrying evidence links)
{ assignedInterventionId, participantId, programId,
  mechanism: EvidenceMechanism,
  sourceType: 'facilitator' | 'sme' | 'deliverable' | 'assessment' | 'session' | 'compliance_record'
            | 'system' | 'integration' | 'external',
  sourceRef?: { collection: string; id: string; url?: string },   // e.g. the existing resource link
  sourceRole?: string, observedAt: Timestamp, recordedBy?: uid,
  verifiedBy?: uid, verificationMethod?: string,
  detector?: { provider: string; id: string; version: string },   // REQUIRED iff sourceType is system|integration
  result?: Record<string, unknown>, confidence?: number }

// programs/{id}.evidenceModel — absent ⇒ today's behaviour (MOV required, named deliverable if configured)
evidenceModel?: { serviceEvidence: 'mov' | 'attendance' | 'none';
                  deliverable: 'named' | 'generic' | 'none';
                  outcomeCapture: 'off' | 'facilitator' | 'facilitator_and_sme' }
```

Design rules:

- **`system_observed` is derived, never written by clients.**
  - Firestore rules on `outcomeEvidence`: clients may create only `sourceType in [facilitator, sme, deliverable, assessment, session, compliance_record]` and must not set `detector`.
  - Only the Admin SDK (Cloud Function detector) may write `system`/`integration`.
  - A detector must be present in a static registry (`detectorRegistry`) keyed by `outcomeType`/mechanism.
  - If the registry has no detector for the outcome, the UI shows **"Not system observable"**, an explicit state, not an empty badge.
- **Why a separate collection rather than fields on `assignedInterventions`:** that document is world-writable to authenticated users (section A.10). Any provenance stored on it could be forged from a browser. It also avoids the 1 MB / `arrayUnion` growth problem (A.7).
- **Deliverable and outcome are stored separately.** `resources[]` holds files. `outcomeEvidence.sourceRef` *points at* a resource link, so nothing is uploaded twice.
- **`resolveEvidenceModel(program)`** returns defaults that reproduce current behaviour when the field is absent, and absorbs `USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE`. Lepharo = `{ mov, named, facilitator }`, set as data on its programme doc. It is **not** hard-coded.

**Migration: none required.** All reads go through normalisers (`getDeliverableView`, `resolveEvidenceModel`, `getOutcomeState`) that treat missing fields as legacy defaults. Optional later backfill: `role` on old `type:'poe'` resources, which is not needed to function.

---

## F. Proposed user flows

1. **HOD creates or edits an intervention.** Title is entered as today. A collapsed "Outcome & deliverable (optional)" section shows a "Suggest for me" button (ai-backend) that fills deliverable name, outcome sentence, outcome type, and default follow-up period. HOD edits two text fields or accepts. Nothing is mandatory. Saved as `outcomeDef` with `origin:'ai_suggested'|'manual'`. Compulsory/legacy interventions are untouched.
2. **Facilitator delivers.** Unchanged (appointments, coverage, progress). At assignment the snapshot carries the deliverable name, so every screen says "Cash Flow Forecast" from then on.
3. **Complete: MOV + deliverable.** At 100% the wizard shows one step with two panes: left **MOV** (one row per SME who attended; proof the service happened), right **Cash Flow Forecast** (shared; `EvidenceManagerPanel`, pre-selected from progress-update files). Desktop side-by-side, mobile stacked with MOV first and a sticky "Continue" bar. If the programme's `deliverable` is `none`, the right pane is absent. If `serviceEvidence` is `none`, the left pane is absent.
4. **Facilitator outcome update (post-completion, optional).** A single sheet: "What changed?" (free text, voice-dictation friendly), "Evidence detected: Cash Flow Forecast.xlsx ✓ (from this intervention)" with chips for any session notes or compliance records found, then **Not yet / Partially / Achieved**. That yields one `outcomeAssessments` and 0..n `outcomeEvidence` rows, and updates the cached `outcome`. Confidence is computed: facilitator text only = `self_reported`, facilitator + deliverable = `artefact_supported`, and so on.
5. **Follow-up.** `followUpDueAt = completion + followUpAfterDays`. A scheduled Function raises a `workflowQueries`/notification to the facilitator (SME self-report optionally). Same one-tap sheet, `kind:'follow_up'`, sets `adoption`.
6. **Reporting.** Each dashboard reads the stage counts (assigned, delivered, MOV approved, deliverable present, outcome achieved/pending, adoption, follow-up due) from the assignment read-model plus `outcome`. Confidence appears as a badge.

---

## G. Programme-specific handling

Lepharo's MOV emphasis remains: nothing is removed. `programs/{lepharo}.evidenceModel = {serviceEvidence:'mov', deliverable:'named', outcomeCapture:'facilitator'}`, so `resolveEvidenceModel` yields exactly today's gating plus the named deliverable pane. Another programme sets `serviceEvidence:'none'` or `'attendance'` (the attendance data already exists in sessions), or `deliverable:'none'`. One shared `EvidenceStep` component reads the model and renders 0, 1 or 2 panes. The one code change at the core is replacing the unconditional MOV requirement in `ensureCompletionMov` and `completeIntervention` with a model check. That is the only place a programme difference enters the logic, so there are no per-programme forks.

---

## H. Suggested phases

**Phase 0 (small, prerequisite).** Add `resolveEvidenceModel` + `getDeliverableView` with defaults that exactly preserve behaviour, and add tests beside the existing `.test.cjs` suites (`interventionCompletionService.test.cjs`, `interventionFlows.test.cjs`). Ship nothing user-visible.

**Phase 1: naming and separation (low risk, visible value).** `outcomeDef.deliverable` on the Library form; snapshot on assignment; `role`/`deliverableName` on new uploads; two-pane completion step; relabel POE → deliverable name across `allocated`, `InterventionCompletionFields`, MOV review screens. Optional `outcomeDef.intendedOutcome` field at the same time (stored, not yet used).

**Phase 2: capture.** Add `outcomeAssessments` and `outcomeEvidence` with rules, the one-tap facilitator sheet, evidence reuse (deliverable, session coverage, prior progress updates), follow-up due + reminders, SME incubatee-side confirmation. Add "Suggest for me" via ai-backend.

**Phase 3: analytics.** Stage-count read model; new dashboard tiles and export columns (additive); risk-register signals as informational flags first.

**Phase 4: detectors.** `detectorRegistry`, Cloud Function detectors (start with the compliance records already in the system, as the only genuinely trustworthy internal source), then document-intelligence and integrations. `system_observed` becomes possible only here.

I recommend this order because naming/separation needs no new collections, and provenance needs rules work that should be designed once before anything writes to it.

---

## I. Risks

**Backwards compatibility**
- The new fields are optional, but `label` reuse would break `isPoeResource` matching (it keys off `type` and label text). Store the name in a separate field.
- Reserved/deprecated field names (A.11) will be silently stripped on canonical writes.
- Support codes in `interventionCompletionSupportCode` must be preserved.

**Firestore**
- `assignedInterventions` and `groupInterventionDeliveries` are open to any authenticated user. That is acceptable for operational data, not for provenance (hence the separate collection with tight rules). `firestore.rules` changes must be deployed **before** the client code that relies on them. I did not audit the rules for the `interventions`, `movDocuments` or `consolidatedMOVs` collections, so check whether they are covered by the "broad legacy matcher".
- New queries (`where assignedInterventionId ==`, `followUpDueAt <=`) need entries in `firestore.indexes.json`.
- Editing a definition bumps `definitionVersion` every save; snapshots must copy `outcomeDef` at assignment or historic assignments will change meaning when the HOD edits the wording.

**Duplicate evidence**
- File references already live in three places (A.6). Outcome evidence must hold `sourceRef` to the existing link and never a copy; dedupe key = link.
- Group deliverables are shared but outcomes are per SME (one deliverable, N outcome assessments).

**UI complexity**
- `allocated/index.tsx` is ~7,000 lines with a stateful multi-step modal. Extract the two-pane step into a component instead of adding more branches inline. Test on a 375px viewport.
- The outcome sheet must stay at three inputs. Resist adding fields for outcome type or mechanisms at the point of use.

**Performance**
- The dashboards already fetch entire assignment sets client-side. Do not add per-assignment reads of `outcomeEvidence`; use the cached `outcome` summary for lists and read evidence only on drill-down.

**Roles and permissions**
- Who may mark `facilitator_verified` (assignee vs HOD)? Should the SME be able to contradict? These are product decisions I have not assumed. Start with assignee + HOD.
- Sensitive departments (psychology, legal): outcome free text may contain confidential information. `isSensitive` must gate visibility of outcome notes, as it already gates POE.

**Reporting regressions**
- Do not redefine `isCompleted`, `computedProgress`, or completed KPIs. Funder-facing exports and title-matched KPIs (`routes/kpis`) depend on them. Add columns only.

**Risk model**
- Integration points (do not rewrite yet): `computeRiskScore` inputs (add optional `outcomeSignals`), `evaluateInterventionState`/`getInterventionBottleneck` (new bottleneck "Outcome follow-up overdue"), `buildServiceProgressRows` (delivered vs outcome per department). Candidate signals are stale follow-ups, `adoption:'lapsed'`, repeated interventions with `not_yet`. Ship as *flags*, not score changes, until real data exists. Current weights (e.g. `recentlyServiced: 15`) reward activity only.
