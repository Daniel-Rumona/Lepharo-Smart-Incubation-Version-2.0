# Lepharo Smart Incubation: digital twin implementation plan

Implementation plan — updated 9 October 2026. Prioritises full functionality during development using synthetic historical and current data.

## Implementation status — current state, animation and local scenarios implemented

The dedicated page at /projectadmin/digital-twin and /operations/digital-twin follows the **universal programme selector**. There is no duplicate programme filter, reference-clock selector, header or back button. Control Tower links carry centre/department context only.

- Current state: compact responsive process map, shared MotionCard.Metric summaries, grouped delivery/evidence stages, separate outcomes and exceptions, source drawers and collapsible data quality.
- History: animated 2D milestone movement, play/pause/reset, speed, timeline seeking, coverage and current-record inspection. Explicit source timestamps and authored synthetic history provide observations. Counts show assignments observed at milestones, not historic queue occupancy. Missing transitions remain unknown; future/invalid events are excluded; reduced motion is respected.
- Scenarios: frozen local demand, versioned deterministic daily capacity simulation, facilitator-hours/review-frequency/+30-SME templates, editable assumptions/calendar, baseline comparison, outstanding-work chart, stage queues/utilisation and reproducible JSON export. No operational records or notifications are written.

The model pools capacity within scope, uses UTC+2 weekdays and closures, counts shared delivery once and reviews separately per SME. Handoffs take at least one day. Simulated deliveries assume confirmation and review-ready evidence by the next day. Existing unresolved human-action records are excluded. Outstanding work includes committed future intake before release. CC pack work is approximated per evidence item. Defaults are assumptions, not calibrated forecasts; detailed staffing, prerequisites, recurrence, rework and business effects remain extensions.

**Remaining:** durable scoped server event capture/backfill/reconciliation, persisted versioned models/snapshots/runs, bounded server jobs, saved evaluations and richer resource rules. Local milestone playback is not an immutable production event log; exported comparisons are not shared saved runs.

**Validation:** 11 projection/history/simulation tests, focused TypeScript, production Vite/PWA build and isolated desktop/mobile browser checks pass. Browser checks cover playback, seeking, scenario export/conservation, universal programme switching, foreign-centre denial, drawers and subscription errors using mocked identity/Firestore transport. Authenticated multi-role access and deployed rules remain unverified. No deployment is included.

See the [continuation README](digital-twins/README.md). Seed scope: 3,444 original documents plus 235 walk-ins and two synthetic actors. Existing branches are reused; no Auth accounts were created.

## Recommendation

Build one connected incubation twin capability in three releases: **Intervention Delivery Process Twin → SME State Twin → Programme System Twin**. Use a dedicated Digital Twin page linked from the existing Interventions Control Tower. Deliver and test all three using a reproducible synthetic dataset; missing real history must not block functional development. Expand the process model to applications, onboarding, compliance and graduation using explicit, versioned rules and test cases.

The user has authorised seeding missing development data, including historical interventions and both positive and negative follow-up outcomes. On 9 October 2026, dataset `dtseed_20261009_v1` was loaded into the existing collections: 3,444 synthetic records covering 60 SMEs, 300 assignments, historical delivery and mixed outcomes. Live validation found no seed-record drift or changes to the 172 fingerprinted pre-existing records. See `artifacts/digital-twin/seed-report.md` for the completed seed scope and verification boundaries. Current state, milestone animation and local scenario comparison are implemented as described above. Functional completeness remains the release objective; calibration against real operations is a separate later validation track.

The first decision to support is: **What is delaying delivery and verification, and which feasible operational change would reduce that delay?** The later decision is: **Are SMEs improving, and which support appears associated with that improvement?** Keep these questions and their measures separate.

Do not start with physical asset twins, a 3D model, a new database platform, or a model claiming to predict business growth. Introduce equipment or facility constraints later only where they materially limit delivery.

## 1. Evidence and current readiness

This draft uses the current local working tree and a read-only aggregate audit of the Firebase project configured by the application, `lepharo-smart-inc`. The service-account project identity was checked against that project for the initial audit. Reads were performed on 9 October 2026. No operational records were changed.

The working tree contains substantial uncommitted changes. Source capabilities below are not proof that the same version is deployed. Database collection counts are not an audit of all operational systems, deployment configuration, or completeness of migrated records. Collection reads were not a single atomic database snapshot.

| Live collection | Count | Relevant observation |
|---|---:|---|
| participants | 5 | Four accepted, one pending; all have programme and branch identifiers |
| applications | 5 | Four accepted, one pending; all have participant, programme and branch identifiers |
| departments | 15 | Organisational structure exists; usable capacity data still needs confirmation |
| interventions | 82 | Of the first 80 inspected, 10 have a top-level outcome definition; this is a bounded sample, not a representative estimate |
| assignedInterventions | 16 | Four stored as completed, nine assigned, three in progress; all have participant/programme/department IDs, progress updates and outcome definitions inside definition snapshots |
| appointmentSessions | 10 | Eight completed, two scheduled |
| appointments | 10 | Eight completed, two scheduled; per-SME records link to sessions and assignments |
| movDocuments | 5 | Three approved, one awaiting SME, one awaiting HOD |
| consolidatedMOVs | 0 | Later approval stages cannot currently be calibrated from these records |
| diagnosticPlans | 4 | Existing SME development planning source |
| outcomeFollowUps | 4 | All scheduled; no answers observed |
| outcomeAssessments | 0 | No assessment history available in this collection |
| workflowQueries | 0 | Query/rework behaviour exists in code but lacks current records for calibration |

Counts above are stored statuses, not independently validated business classifications. For example, five assignments have `completedAt`, but only four have stored completed status and SME confirmation. A timestamp alone must not become a completion rule.

Participant records expose revenue and headcount history fields. Their date coverage, units, provenance and reliability were not inspected in this aggregate audit. Do not equate field existence with usable longitudinal evidence.

The repository also contains seeding scripts and references to test SMEs. Before calibration, the data owner must classify records as operational, demonstration, test or migrated. Do not assume every current record represents real operating history.

**Readiness conclusion:** proceed with the full functional architecture and supply missing coverage through synthetic data. The small live population limits empirical forecast validation, not which twin features we can implement. Passing synthetic tests demonstrates the behaviours tested, but does not guarantee performance on every real record or predictive accuracy.

### Synthetic development dataset

Create a deterministic seed generator with a configurable reference date, fixed random seed, dataset version and manifest. A proposed standard fixture is 60 synthetic SMEs across two programmes, two branches and four departments, covering 12 months of history and three months of future schedules. Start with approximately 300 assignments and generate the linked sessions, per-SME appointments, evidence, MOVs, packs, follow-ups and assessments required by the scenario matrix. These numbers are development coverage targets, not business assumptions or representative outcome rates.

Reuse existing definitions where compatible. Seed missing definitions, capacity calendars, synthetic business measurements and explicit programme rules as necessary. Preserve all existing records. Default to a dedicated development environment or emulator; any shared development project must use visibly marked synthetic records and segregated reporting scope.

Every seed-owned record must be traceable through a manifest and metadata such as `dataOrigin: synthetic`, `seedRunId`, `scenarioKey` and `generatorVersion`, carried into projections, snapshots and exports. Use a separate metadata mapping where canonical schemas cannot accept these fields. Do not relabel historical real records as synthetic or blend generated results into observed performance.

| Scenario family | Required examples | Expected behaviour |
|---|---|---|
| Positive outcomes | Verified deliverable, outcome achieved, sustained improvement on later follow-up | Delivery, evidence and outcome histories remain independently traceable |
| Partial and delayed outcomes | Partial achievement, no early change, improvement at a later check-back | Follow-up and state history reflect timing without rewriting the earlier observation |
| Negative outcomes | Intended outcome not achieved; business revenue/headcount deteriorates despite completed support | Delivery can remain completed while outcome/business indicators show an unfavourable result |
| Unknown and disputed outcomes | No response, overdue check-back, missing evidence, facilitator/SME disagreement | Unknown does not become failure or success; disagreements retain source attribution |
| Delivery exceptions | Declined appointment, cancellation, no-show, reassignment, rejected completion, rework | Canonical lifecycle, queue ownership and capacity effects remain correct |
| Group and recurring delivery | Mixed attendance in a group; successive cycles with different results | Shared time is counted once; attendance, MOV eligibility and outcomes remain per SME/cycle |
| Evidence approvals | Every MOV/pack stage, query, rejection and resubmission | Stage age, responsible actor and approval transitions match source rules |
| Capacity and dependencies | Leave, staff shared across departments, intake surge, prerequisite delays | Queues respect resource limits and downstream bottlenecks |
| SME journey | Pending/accepted applications, onboarding gaps, expired compliance, graduation eligibility | Journey state follows versioned programme requirements |
| Data resilience | Missing dates, duplicate/reordered events, corrected measurements, ambiguous identity | Invalid records are flagged or quarantined; replay and reconciliation are deterministic |

Represent outcomes through existing schema values where available. A negative business change is a dated measurement; it does not require inventing a new assignment status. Only extend outcome vocabularies deliberately across storage, services and UI. Synthetic evidence should be plainly labelled sample material and must not impersonate a real signature or approval.

Seed both positive and negative cases without making outcome direction a simplistic function of intervention completion. Include successful delivery with no measurable improvement and business improvement alongside incomplete support. Generated patterns are authored assumptions, not evidence of intervention effectiveness.

Support dry-run, repeatable upsert, validation and reset of only manifest-owned synthetic records. Enforce a seed-only email/SMS/WhatsApp delivery sink on server notification paths before creating trigger-producing records; client flags alone are insufficient. Seeded assessments and approval fixtures may establish historical coverage, but separate end-to-end tests must exercise the actual authenticated workflows and server triggers. Use a controllable clock for due dates and reminders so historical fixtures do not cause notification floods or require waiting weeks.

Maintain small, hand-specified reference cases with independently calculated expected results alongside the larger generated dataset. Do not judge the simulation solely against data generated by the same simulation rules. Keep malformed fixtures in a separate resilience suite so ordinary demonstrations remain coherent.

## 2. Build on existing domain logic

| Existing source | Twin use | Boundary to preserve |
|---|---|---|
| `src/services/interventionTower.ts` | Current delivery/evidence queues and departmental coverage | Existing waiting thresholds are policy assumptions, not learned delay distributions |
| `src/services/assignmentLifecycleService.ts` | Assignment state and next responsible actor | Progress percentage, attendance, completion claim and SME confirmation are distinct |
| `src/services/appointmentSessionService.ts` | Shared session plus per-SME attendance model | One group session consumes one shared delivery slot; each SME has separate attendance |
| `src/services/completionMovRules.ts` | Group MOV eligibility | A group member with no recorded attendance must not be counted as receiving the intervention |
| `src/services/movPipeline.ts` | MOV stages across individual documents and monthly packs | HOD approval is distinct from CC confirmation and M&E validation |
| `src/services/poeService.ts` | Existing evidence resolution | Preserve evidence on MOVs as well as linked assignments; file presence alone does not prove an outcome |
| `functions/src/outcomeFollowUps.ts` | Scheduled check-backs and assessment creation | Facilitator and SME reports retain their separate provenance |
| `src/services/growthScoreService.ts` | Explainable compliance/activity indicator | Not a probability of business success or a measured economic outcome |
| `src/services/workflowQueryService.ts` | Exceptions and resolution history | Closing a query must not automatically imply a rejected assignment is completed |

Share tested domain functions between operational views and twin projections where practical. Avoid a second implementation of business status rules. Validate current source against deployment before relying on newly added modules.

## 3. Release one: Intervention Delivery Process Twin

**Scope:** begin implementation with one programme/branch/department slice, then exercise the complete synthetic multi-department dataset. Model assignment, scheduling, SME response, delivery, attendance, completion submission, SME confirmation, MOV approval and pack validation. Include declines, cancellations, non-attendance, rejection, reassignment, recurring cycles and rework. Implement all stages even where current operational collections are empty; identify synthetic histories and assumption-based parameters explicitly.

Use connected state dimensions rather than forcing everything into one funnel:

- Delivery: assigned → scheduled/accepted → delivered → confirmation → completed, with exception paths derived from the canonical resolver.
- Evidence: individual MOV → HOD → monthly pack → CC → M&E, with query and rejection loops.
- Outcomes: not yet due → due → assessed, with reported achievement and evidence quality held separately.

**User experience:** provide Current state, History, Scenarios and Validation views within the dedicated Digital Twin page. The Control Tower links into it with the user's filters. Current state, data quality, milestone History playback and local Scenarios are implemented; durable capture, saved runs and Validation remain to build. Use an interactive 2D process map, with animation driven by recorded transitions or clearly identified simulated events. A 3D model is optional only if physical facility layout later informs a decision. Each queue item shows its exact state, responsible role, age where known, source record and data freshness. A scenario compares a frozen baseline with a proposed operational change and displays assumptions beside results.

**First three scenarios:**

1. Add a stated number of facilitator hours per week and compare waiting time and backlog.
2. Increase HOD review frequency and inspect downstream CC/M&E workload.
3. Add 30 SMEs with an explicitly selected intervention demand mix and compare demand with available delivery and review capacity.

Use transparent discrete-event simulation: sessions, assignments and review packs enter queues, wait for eligible capacity and change state under existing rules. Implement deterministic assumptions, sensitivity ranges and seeded sampling from configurable duration distributions. Synthetic distributions are sufficient to test functionality; real-world calibration later replaces their parameters without replacing the engine.

Model working calendars, leave, service time, review time, group size, recurrence, prerequisites and pack batching. Capacity is staff time available for this work after other commitments, not department headcount. Do not infer it solely from booked appointments. Count service time separately from waiting time; elapsed assignment duration is not facilitator effort.

Outputs: eligible backlog, completed deliveries, verified MOVs, median and upper-range waiting time, overdue work, utilisation and unmet demand. Label outputs **scenario estimates**, not forecasts, until historical validation supports stronger claims.

An illustrative configuration might specify 30 additional SMEs over eight weeks, a chosen service mix, two facilitators with eight available hours each per week and two approval windows per week. These are editable examples, not observed Lepharo capacity or predicted results.

## 4. Release two: SME State Twin

Create a state record per **SME and programme enrolment**, not per email address. Preserve participant identity, application/enrolment, branch, programme, assignment cycle and effective dates. Resolve historical identities explicitly; quarantine ambiguous matches.

Represent six dimensions: compliance validity and expiry; engagement and attendance; diagnosed needs and roadmap; delivered and verified support; reported/assessed outcomes; measured business indicators such as revenue and headcount.

For each indicator retain value, unit, period, baseline, source, observation time, recording time, assessor and verification status. Separate unknown, not applicable, overdue and failed. Record disagreements between SME and facilitator reports rather than averaging them away.

Reuse `outcomeFollowUps` and `outcomeAssessments`; do not introduce a competing outcome workflow. Add structured business measurements only where existing history cannot represent the required provenance and periods. Show the existing Growth Score as an activity indicator with its components and definition version.

Initially answer: “What changed?”, “Which requirement is unmet?”, “Which outcome needs follow-up?” and “What would the roadmap require if this gap were addressed?” Do not infer that completing an intervention caused revenue growth. Later observational comparisons must disclose cohort differences, missing data and confounding; causal claims require an appropriate evaluation design.

## 5. Release three: Programme System Twin

Integrate enrolments, SME states, intervention demand, department capabilities, staff calendars, review queues and programme targets. Model shared staff across departments, cross-department prerequisites, group delivery and periodic pack approval.

Support intake planning, facilitator allocation, service sequencing and capacity scenarios across branches. Implement cost-per-service and budget constraints with labelled synthetic unit costs, replacing these with validated finance inputs when available. Keep operational throughput, verification quality and SME outcomes as separate objectives so optimising volume cannot conceal weak outcomes.

Extend the process model upstream to onboarding and downstream to graduation using explicit configurable rules. Provisional development criteria must be labelled as such and exercised through fixtures; real eligibility decisions require approved programme criteria. Do not silently turn a Growth Score threshold into a graduation rule.

## 6. Proposed technical architecture

```text
Existing Firestore operational records
    → validated source adapters and transition capture
    → append-only twin events + rebuildable current projections
    → frozen baseline snapshots + versioned model/assumptions
    → scenario worker
    → role-scoped Control Tower / SME / programme views
    → human decision through existing operational workflows
    → observed results and validation
```

Keep the existing React/TypeScript and Firebase stack for the pilot. Use server-side projection code and a bounded simulation worker; move expensive runs to a queued job service if measured load warrants it. No graph database or separate digital twin vendor is necessary for this first scope.

Proposed new storage, subject to design review:

- `twinEvents`: entity/enrolment/cycle identity, source document/version, event type, occurrence and recording times, scoped dimensions, evidence references and capture provenance.
- `twinStates`: derived current state, rule version, source revisions, missing-data flags and synchronisation watermark.
- `twinModels`: versioned transition rules, capacity calendars, assumptions, units and validity dates.
- `twinScenarios`: immutable baseline reference, model version, changed inputs, horizon, random seed where used, author and scope.
- `twinRuns`: job state, results, uncertainty/sensitivity, exclusions and validation status.
- `twinEvaluations`: saved prediction or scenario comparison, actual observations, error measures and reviewer decision.

Firestore change capture must tolerate duplicate and out-of-order delivery. Use idempotency keys and source revisions, preserve correction events, prevent projections triggering themselves, and reconcile projections periodically against source documents. A server capture proves what was observed, not the truth of an unverified client claim. Capture trustworthy actor identity through authorised write paths where required.

For real records, backfill only defensible facts. Label initial imported state `observed_at_import`; do not manufacture historical transition times from `updatedAt`. Synthetic histories may contain generated past transitions, explicitly identified as generated with coherent chronology. Store event history outside growing arrays. Retain tombstones for deletion and handle backdated corrections with explicit valid-time and recorded-time fields.

Scenarios must never modify production assignments or approve MOVs. A user chooses an operational action through existing authorised workflows; the twin records the scenario/decision relationship and later evaluates the observed result.

## 7. Data quality, access and operating controls

Before pilot release, measure identity linkage, timestamp completeness, status contradictions, duplicate deliveries, evidence linkage, branch/programme scoping and outcome coverage. Set exclusions with owners and expose the denominator in every metric.

Local `firestore.rules` currently permits broad authenticated reads/writes on assignments. A derived twin cannot treat those records as independently verified provenance. Verify deployed rules and tighten the required source write paths before trusted multi-role rollout. Server-only twin writes do not by themselves fix source integrity.

Enforce role, programme, branch and SME scope on the server for projections, scenario jobs and exports. Recheck scope when a run is retrieved. Test View As behaviour separately. Store minimal evidence references; avoid copying sensitive documents into simulation inputs. Apply agreed retention and deletion requirements across events, snapshots and exports. Keep raw IDs out of user-facing labels.

Every view shows freshness, excluded/unknown records and model version. Operations receives alerts for capture lag or failed reconciliation. Feature flags allow disabling scenarios or projections without interrupting core delivery workflows.

## 8. Delivery sequence and ownership

Indicative effort for a small dedicated team; a planning estimate, not a delivery commitment. Functional delivery uses synthetic history and does not wait for real observation periods. Real-world calibration runs separately.

| Phase | Indicative duration | Deliverable and exit gate | Accountable owners |
|---|---|---|---|
| 0. Synthetic foundation | 1–2 weeks | Versioned seed generator, linked historical/current fixtures, notification sink, scenario matrix and independently specified expected results | Product/Operations, data owner, engineering |
| 1. Synchronised state and history | 2–3 weeks | Source adapters, events, projections and history; all eligible pilot records reconcile with canonical source state | Engineering, Operations reviewer |
| 2. Process scenarios | 2–3 weeks | Three scenario templates, reproducible runs, sensitivity and assumption displays; domain owners verify queue/calendar behaviour | Engineering, department HOD, M&E |
| 3. SME State Twin | 2–3 weeks | Enrolment-scoped state and outcome follow-up integration; source and verification status traceable for every displayed indicator | M&E, SME support, engineering |
| 4. Programme integration | 3–4 weeks | Cross-department demand/capacity and full journey scenarios validated against synthetic baselines, with reviewed assumptions | Programme lead, HODs, finance where needed |

An initial process pilot is approximately **5–8 weeks** under these assumptions. All three functional releases total approximately **10–15 weeks**, subject to re-estimation after the seed/schema design. Real observations are not a prerequisite for these releases. Run weekly model review with Operations and M&E; add real-data calibration as usable observations become available.

## 9. Validation and acceptance

Functional acceptance requires all scenario families above to pass through source records, projections, histories, simulations and relevant role-scoped UI. Positive and negative outcomes are equally required. Real-data calibration is a separate acceptance category and cannot be inferred from synthetic test success.

- **Seed integrity:** repeated runs do not duplicate entities; references and chronology validate; reset affects only the selected seed manifest; no external notification is sent; dashboards and exports distinguish synthetic scope.
- **End-to-end workflows:** use authenticated SME, facilitator, HOD, CC and M&E flows for representative records rather than validating only admin-seeded final states. Verify real trigger behaviour, persistence, refresh and permissions.

- **State fidelity:** every eligible pilot assignment and MOV matches canonical source semantics; any discrepancy is resolved or explicitly excluded. Group delivery is counted once for capacity and per SME for participation.
- **History:** unknown entry times remain unknown. Duplicate/reordered events, cancellation, rework, recurrence and corrections replay deterministically.
- **Synchronisation:** adopt a provisional target of 95% of observed changes projected within five minutes, subject to measured feasibility; show stale state visibly and reconcile daily.
- **Reproducibility:** identical baseline, model, inputs and seed yield identical results. Scenario inputs cannot write operational records.
- **Simulation verification:** controlled cases prove calendars, resource limits, shared sessions, batching, prerequisites and conservation of queued work. Extra capacity should not introduce unexplained bottlenecks.
- **Empirical validation:** compare against a chronological holdout once suitable operational history exists. Measure backlog and completion-count error and waiting-time error against a simple baseline. Agree tolerances before seeing results; suppress forecast claims while evidence is inadequate.
- **Access:** unauthorised cross-programme/branch/SME reads and exports fail in rules/API tests; authenticated UI testing confirms the same scope and source drill-downs.
- **Decision usefulness:** Operations records at least one reviewed scenario-based decision and subsequently compares actual results. This validates usefulness, not causality or universal forecast accuracy.

## 10. Immediate implementation backlog

1. **Complete locally:** synthetic foundation, notification suppression, walk-in extension and first current-state page with canonical domain resolvers and fixture tests. Preserve the original create-only manifests and any deliberate app edits.
2. Verify the page with real authenticated project-admin, ROM and M&E sessions against deployed rules; address programme visibility and permission gaps without widening unrelated access.
3. Finalise the versioned event/enrolment contract and share the pure projection adapter with a server implementation. Retain effective dates, provenance and correction semantics.
4. Implement append-only capture, defensible initial-state backfill, deduplication, correction handling and reconciliation. Do not treat current source subscriptions as saved history.
5. Connect implemented History playback to durable server events with correction/reconciliation semantics; preserve explicit gaps and reduced motion.
6. Persist implemented frozen baselines and versioned scenario runs behind scoped server APIs. Move larger runs to bounded jobs and extend staffing, prerequisites, recurrence, rework and actual pack batching with independent tests.
7. Add saved scenario comparisons and evaluations, then build SME State and Programme System Twin releases.
8. Run full synthetic acceptance and authenticated workflow/access tests before declaring functional readiness. Add new fixture versions for unrepresented edge cases rather than overwriting the original generator.
9. Connect eligible real records through the same adapters and calibrate as evidence accumulates. Track prediction accuracy independently from functional test status.

## References

IBM describes component, asset, system and process twins in a primarily physical-system context. SME State Twin is a domain-specific adaptation, not a literal industrial component category: [IBM: What is a digital twin?](https://www.ibm.com/think/topics/digital-twin).

Business-process twins are a relevant research direction for linking process events and operational outcomes: [IBM Research: AI for Business Process](https://research.ibm.com/projects/ai-for-business-process).

Verification, validation and uncertainty assessment should be designed into the model lifecycle: [NIST: Digital Twins for Advanced Manufacturing](https://www.nist.gov/programs-projects/digital-twins-advanced-manufacturing). Applying these principles here is a design recommendation, not a claim of certification.

## Guided page explanation

The page now includes a repeatable Guide me walkthrough covering delivery counts, evidence approval roles, follow-up outcomes, waits/exceptions, historical milestones, baseline capture and scenario interpretation. It switches between Current state, History and Scenarios without running or applying a scenario. Inline explanations clarify units and acronyms. The guide explicitly describes the implementation as an early process twin and distinguishes working local simulation from outstanding durable history, shared runs and real-outcome validation. Implementation: `src/routes/oversight/digital-twin/TwinGuide.tsx`.
