# Digital twins — continuation guide

Last updated: 9 October 2026. Start here when continuing the twin implementation.

## Current position

The synthetic data foundation is loaded into the existing collections in Firebase project **`lepharo-smart-inc`**. The dedicated page now includes redesigned Current state, animated milestone History and local Scenarios. Durable server projections, capture and shared saved runs remain to build. Full production acceptance remains outstanding.

### Implemented entry points

- Routes: `/projectadmin/digital-twin` and `/operations/digital-twin`; navigation follows the Control Tower's existing role placement.
- [Page and drill-downs](../../src/routes/oversight/digital-twin/index.tsx), [subscription hook](../../src/routes/oversight/digital-twin/useProcessTwin.ts), [responsive styles](../../src/routes/oversight/digital-twin/process-twin.css).
- [Pure current projection](../../src/services/digitalTwin/processTwin.ts) and [projection tests](../../src/services/digitalTwin/processTwin.test.cjs).
- [Isolated browser fixture](../../scripts/digital-twin/preview-process-twin.cjs) checks the real page with mocked identity and source data. It does not authenticate to Firebase.
- The Control Tower passes centre and department to **Open Intervention Twin**. The twin follows the universal programme selector; select one programme there to start subscriptions. Centre-scoped project admins need an assigned branch; new demo accounts were not created.

Verified locally: projection tests, focused TypeScript, Vite/PWA production build, desktop/mobile fixture rendering, record drawers and unauthorised UI denial. No deployment or authenticated live-browser validation was performed. Existing source rules remain authoritative and require review; UI filtering is not a replacement for server access controls.

Integration changes are in [`src/App.tsx`](../../src/App.tsx), [`src/components/layout/index.tsx`](../../src/components/layout/index.tsx) and the [Control Tower page](../../src/routes/oversight/interventions/index.tsx). Together with the page, hook, styles, projection, tests and browser fixture linked above, these are the implementation files for this increment. The overall plan and this README track its remaining milestones. Preview screenshots are saved in `artifacts/digital-twin/process-twin-desktop.png`, `process-twin-mobile.png` and `process-twin-detail.png`.

Build in this order:

1. **Intervention Delivery Process Twin:** explain delivery and approval queues, then simulate operational changes.
2. **SME State Twin:** show each SME's development, compliance, engagement, support and outcomes over time.
3. **Programme System Twin:** combine demand, shared resources, departments and SME states for programme planning.

Full functionality can be developed using synthetic data. Passing those tests does not establish predictive accuracy or guarantee compatibility with every real record; real-data reconciliation and calibration remain separate acceptance steps.

## Read these files first

| File | Purpose |
|---|---|
| [Implementation plan](../digital-twin-implementation-plan.md) | Overall architecture, release scope and acceptance criteria. Its initial live-data count table is a **pre-seed snapshot**, not current counts. |
| [Seed README](../../scripts/digital-twin/README.md) | Dataset commands, notification protections and repeatability rules. |
| [Original seed report](../../artifacts/digital-twin/seed-report.md) | Completed seed scope and validation evidence. |
| [Walk-in report](../../artifacts/digital-twin/walkins-report.md) | Reception extension, linked appointments and exclusions. |
| [Dataset generator](../../scripts/digital-twin/dataset.cjs) | Exact fixture schemas, scenario cases and reference clock. |

This guide reflects the saved reports and source inspected on the date above. Refresh live verification before relying on the fixtures after further development.

## Animation and simulation continuation

Implementation files: [process map](../../src/routes/oversight/digital-twin/ProcessMap.tsx), [playback](../../src/routes/oversight/digital-twin/HistoryPlayback.tsx), [history adapter](../../src/services/digitalTwin/history.ts), [scenario UI](../../src/routes/oversight/digital-twin/ScenarioPanel.tsx), [engine](../../src/services/digitalTwin/simulation.ts), [reference tests](../../src/services/digitalTwin/historySimulation.test.cjs). The page, process projection, styles, Control Tower link, browser fixture and these two documentation files were also updated.

Current state colours a step only when something is **past its target**; neutral grey means on track. The per-step target days live in [`twinTargets.ts`](../../src/services/digitalTwin/twinTargets.ts) and are **placeholders, not agreed service levels**: replace them with the team's real targets. Waits use explicit stage-entry dates only; records without one are reported as unknown. History shows the typical (median) days between consecutive steps, and Scenarios recalculates automatically as inputs change.

Process meaning: the **centre coordinator confirms that the work listed in a pack was actually carried out at the centre**, and **M&E then performs a separate quality validation (ISO / QMS)**. Scenarios therefore has levers for facilitator, coordinator and M&E hours. Packs are still approximated per evidence item, not as monthly batches with a month-end cutoff; modelling that needs the centre's real pack calendar. The Scenarios chart states in words when the backlog clears with and without the change, stacks outstanding work by team, shades weekends and closed dates, and marks the clear dates. **Set a goal** ([`goalSeek.ts`](../../src/services/digitalTwin/goalSeek.ts)) takes a target date and finds, greedily then trimmed, a sufficient team-capacity change within the model; it is not a proven minimum and it leaves extra SMEs and starting settings unchanged.

**Steady inflow:** Scenarios can expect new work to keep arriving (`inflowPerWeek`, on by default), from this programme's last 12 weeks of new assignments (`observedInflow` in [`simulation.ts`](../../src/services/digitalTwin/simulation.ts)) once there are enough of them, otherwise from the pilot's per-SME rate. It is editable in the settings and applies equally to "if nothing changes" and "with your change". Each arrival needs its sessions, then the same reviews. The daily chart counts only work that has **arrived**, so a backlog can build up. With inflow the backlog rarely reaches zero, so the headline describes the trend and Set a goal aims to "keep up" (match what maximum capacity achieves) instead of "clear".

**Demand calibration (read-only):** [`analyze-demand.cjs`](../../scripts/digital-twin/analyze-demand.cjs) measures, from real records only (synthetic demo records are excluded), how demand actually behaves: accepted SMEs per week, developmental-plan size per SME and per department, days from full plan sign-off to each intervention being assigned (the opening pace), open load per SME, the share and cycle counts of recurring interventions, planned sessions per assignment, gaps between sessions of one assignment, and how often one intervention really has more than one session on a day. It reads only a fixed set of fields (no names, emails or phone numbers), never writes, never prints the credential, and outputs aggregates with groups under 5 suppressed ([`demand-analysis.cjs`](../../scripts/digital-twin/demand-analysis.cjs), tested in `demand-analysis.test.cjs`, including a scan proving the loader contains no write calls). Run it yourself with `node scripts/digital-twin/analyze-demand.cjs`; results are saved to `artifacts/digital-twin/demand-analysis.json`. **Because the pilot mixes learning with steady behaviour, every measure is reported three ways**: the whole history (reference only), the **first 8 weeks of each programme** (people still learning the system) and the **last 8 weeks** (closest to how the next programme will run), set with `--weeks=N`. It also gives a trend by 4-week period and a per-metric verdict, "stable" (the whole pilot is a fair guide) or "changed" (use the recent window). Cohorts that have not had long enough to be observed (for example, a sign-off 3 weeks ago cannot yet show 12-week behaviour) are left out of the longer horizons rather than counted as slow. The model should calibrate from the recent window, not the pilot-wide average.

**Sessions, new SMEs and facilitator load (calibrated on the pilot):** the model's unit is an **open intervention**: one intervention for one SME (or one shared sitting for several), assigned and not yet fully validated, whether it is waiting for delivery or its evidence is waiting for review. Behaviour measured in the pilot lives in [`pilotCalibration.ts`](../../src/services/digitalTwin/pilotCalibration.ts) with its source; only the settled behaviour is used, because the pilot's first weeks pre-date the plan sign-off workflow.
- **Sessions needed:** an intervention needs its planned sessions (1 if unspecified, at most 12). New work draws from the mix on this programme's recent assignments, or the pilot's while there is too little history (about 1.5 on average, 36% needing more than one). After a session, the next waits at least `daysBetweenSessions` (pilot median 7). A shared sitting serves every SME in it and counts once.
- **No per-intervention daily cap.** In the pilot, two sessions of one SME's intervention on the same day were rare (0.6%), but 35% of intervention-days had sessions for several SMEs, so limiting an intervention to one session a day contradicted the data and was removed. The real limits are the facilitators: with centre hours in use, each facilitator runs up to `sessionsPerFacilitatorPerDay` sessions (default 4, the pilot's 75th percentile; median 2, 90th percentile 5.5), and extra facilitator hours add sessions on top.
- **New SMEs** ("New SMEs joining") join in weekly batches over `intakeWeeks`. Each brings about 6 departments of interventions, opened along the pilot's curve (about 7 in the first month, 11 by six months, then none; recurring cycles are covered by expected new work). They are released as open interventions on the day they open.
- **Expected new work** uses this programme's last 12 weeks of new assignments once there are at least 20, otherwise the pilot's rate per SME (about 0.8 a week) times the SMEs in scope.

**Centre capacity:** coordinators and centre coordinators (projectadmin role) follow their centre's own operating hours, stored on each branch (`operatingHours`: per-weekday hours, closed days and the public-holiday rule). Daily capacity = people × that day's opening minutes × the share of time spent on this work (100% by default, editable), via [`centreCapacity.ts`](../../src/services/digitalTwin/centreCapacity.ts), so a centre open on Saturdays contributes on Saturdays. Headcounts are read straight from the records, with the rules in [`centreHeadcounts.ts`](../../src/services/digitalTwin/centreHeadcounts.ts) (tested): coordinators are active `coordinators` records attached to the centre (`branchId`, `assignedBranch` or `branchIds`), excluding national coordinators; centre coordinators are active `users` with the projectadmin role assigned to the centre; operations-role users are never counted. If a read is refused or finds nothing, coordinators fall back to the distinct people on sessions and assignments in the last 12 weeks and centre coordinators to an assumed 1, each shown with its source and editable. No server function is needed because the current security rules end with a catch-all that lets any signed-in user read these collections; if that catch-all is ever tightened, this read will need an explicit rule or a counts-only function. No two facilitators work the same intervention, so the one-session-per-intervention-per-day rule is the delivery constraint; individual diaries and leave are not modelled.

History shows "Session attended" as three branches (In person, Virtual, Telephonic) that merge back into Support delivered; hybrid or unrecorded methods appear as a note under the branches. Branch counts are distinct assignments per route and can overlap. The remote supplement `dtseed_20261009_remote_v1` ([`seed-remote.cjs`](../../scripts/digital-twin/seed-remote.cjs)) clones every third completed individual in-person delivery as a new virtual or telephonic one (75 assignments, sessions and invitations: 38 virtual, 37 telephonic), with no MOVs, follow-ups or walk-ins. It is **local only and not applied to Firebase**: `node scripts/digital-twin/seed-remote.cjs` writes a summary, and `TWIN_REMOTE=1 node scripts/digital-twin/preview-process-twin.cjs` includes it in the browser fixture (the fixture's own assertions expect the original counts, so run it without the flag for acceptance checks). Applying it live needs a create-only writer modelled on `seed-walkins.cjs`, plus notification re-audit and sign-off.

The History "Session attended" step is built from attended appointment invitations (`attendance.checkedInAt`) for every delivery method (in person, virtual, telephonic, hybrid), not from walk-in inquiries, which are a subset and are not counted separately. Attended invitations without a check-in time are counted in the footnote and kept off the timeline. The seed contains only in-person sessions, so virtual and telephonic attendance is covered by a hand-built test, not by seed data.

History combines explicit source timestamps with synthetic authored milestones. It deduplicates observations and excludes future/invalid dates. Gaps stay unknown; counts are milestones reached, not historical queues. Scope changes reset playback and local runs.

The engine freezes eligible demand and runs daily queues on UTC+2 weekdays with editable closures. Shared delivery consumes one slot; HOD/CC/M&E review each SME separately. Handoffs take at least one calendar day. Simulated deliveries assume confirmation/evidence readiness by the next day; existing pending human actions are excluded. Outstanding work includes committed future intake before release. Capacity and duration defaults are assumptions, not inferred from seeded staff calendars. CC pack batching is approximated per item. Staffing, prerequisites, recurrence, rejection/nonresponse probabilities and business effects are not modelled. Runs remain local and export snapshot/model/inputs/results as JSON, without operational writes.

Validation: 11 domain tests, focused TypeScript, production Vite/PWA build and desktop/mobile browser fixture checks pass. Browser checks cover playback/seek, scenario export/conservation, universal selection changes, foreign-centre denial and subscription errors. They mock identity and Firestore transport; live authenticated/rules validation remains outstanding. No deployment occurred. Reports and new history/scenario/mobile screenshots are under artifacts/digital-twin/.

## Data available for development

Original run: **`dtseed_20261009_v1`** — 3,444 documents, excluding its manifest. Walk-in extension: **`dtseed_20261009_walkins_v1`** — 235 inquiries and two synthetic reception actors, excluding its manifest. Combined: **3,681 data documents**.

The programmes are **[DEMO Twin] Incubation Foundations** in Rustenburg and **[DEMO Twin] Enterprise Growth** in Springs. Reference clock: **2026-10-09T08:00:00Z**. Historical business measurements cover October 2025 through September 2026. Use an injected clock in tests and replay so ageing metrics do not drift with the machine date.

| Collections | Seed coverage and purpose |
|---|---|
| `participants`, `applications`, `users`, `diagnosticPlans` | 60 SME profiles and associated enrolment/development records in each collection; no new Auth accounts. |
| `assignedInterventions` | 300 assignments spanning completed delivery and operational exceptions. |
| `appointmentSessions`, `appointments` | 275 shared sessions and 285 per-SME invitations. |
| `movDocuments`, `consolidatedMOVs` | 235 individual MOVs and 35 monthly packs covering approval stages. |
| `outcomeFollowUps`, `outcomeAssessments` | 190 follow-ups and 365 assessments covering positive, partial, negative, disputed and unknown results. |
| `participantMonthlyMetrics` | 720 dated business measurements. |
| `workflowQueries`, `syntheticHistory` | 45 workflow queries and 725 generated history records. Synthetic history is fixture input, not deployed production event capture. |
| `groupInterventionDeliveries`, `twinCapacityCalendars` | Five group deliveries and four synthetic capacity calendars. |
| `inquiries` | 235 attended walk-ins: 115 Rustenburg and 120 Springs. |

Reception inquiries link through `participantId`, `appointmentId`, `appointmentSessionId` and `assignedInterventionId`, with branch/programme scope. Their arrival/departure timestamps match appointment attendance. `Resolved` means the reception visit ended; it does not prove a positive intervention outcome. There are no walk-ins for 15 future bookings, 30 cancelled/declined visits or five absent group invitees.

Preserve `dataOrigin`, `seedRunId`, `parentSeedRunId` where present, `scenarioKey`, `generatorVersion` and `suppressNotifications` in derived records and exports. Join through IDs, not names or email. The walk-in extension has a different run ID: selecting only the original run would omit reception history. Scope by the selected demo programme and retain both run IDs as provenance.

## Process view checklist and next deliverable

Start with **Incubation Foundations / Rustenburg / one department**, then exercise the complete fixture. Current queues and source drill-downs are implemented. Milestone playback and local simulation are implemented. The next deliverable is durable server capture/reconciliation and persisted scoped runs.

### 1. Define adapters and the domain contract

- [ ] Define enrolment, assignment/cycle, session, invitation, MOV, pack, inquiry and outcome identities and links.
- [ ] Add adapters that validate dates, references, scope and synthetic provenance. Return excluded records with reasons; never silently turn missing data into zero or success.
- [x] Keep delivery, evidence approval and outcome assessment as separate state dimensions.
- [x] Reuse the current domain resolvers rather than introducing alternative status rules.

| Existing source | Reuse |
|---|---|
| [`assignmentLifecycleService.ts`](../../src/services/assignmentLifecycleService.ts) | `resolveAssignmentLifecycle`: canonical assignment state and next actor. |
| [`movPipeline.ts`](../../src/services/movPipeline.ts) | `resolveMovPosition`: individual MOV and pack approval position. |
| [`interventionTower.ts`](../../src/services/interventionTower.ts) | `buildTowerModel`: existing queue and coverage calculations. |
| [`completionMovRules.ts`](../../src/services/completionMovRules.ts) | Group attendee eligibility for MOVs. |
| [`appointmentSessionService.ts`](../../src/services/appointmentSessionService.ts) | Shared session and per-SME attendance semantics. |
| [`outcomeFollowUps.ts`](../../functions/src/outcomeFollowUps.ts) | Existing outcome scheduling/assessment workflow. |
| [`inquiryService.ts`](../../src/services/inquiryService.ts) | Reception inquiry schema and read behaviour. |

**Exit check:** all eligible fixture assignments and MOVs agree with canonical resolvers. A group session consumes shared capacity once; each attendee has separate participation and evidence. Reception attendance must not double-count delivery already recorded on the appointment.

### 2. Implement capture, projections and replay

The following are **proposed new modules/storage**, not existing functionality:

- [x] **Pure capture core done** (12 Oct 2026): [`functions/src/digitalTwin/events.ts`](../../functions/src/digitalTwin/events.ts) with [tests](../../functions/src/digitalTwin/events.test.cjs) covers evidenced-only events, deterministic ids, revision-based corrections, tombstones for deletions, `observed_at_import`, rebuildable projection and reconciliation. Not yet wired: no Firestore triggers, `twinEvents`/`twinStates` writes, backfill job, watermark document or security rules exist. Run with `node --test functions/src/digitalTwin/events.test.cjs`.
- [ ] Introduce shared pure twin types/adapters, for example under `src/services/digitalTwin/`, with a deliberate server-compatible sharing strategy. Avoid importing browser Firebase code into Functions.
- [ ] Implement server capture/projection modules, for example under `functions/src/digitalTwin/`.
- [ ] Define `twinEvents` and rebuildable `twinStates`. Events need scoped identity, source revision, event type, occurrence time, recording time, provenance and rule version.
- [ ] Backfill real records as `observed_at_import` unless a historical transition is evidenced. Import fixture history explicitly as synthetic. Do not infer every transition time from `updatedAt`.
- [ ] Deduplicate events; handle out-of-order delivery, corrections and deletions; prevent projection writes from retriggering source capture.
- [ ] Add reconciliation, a watermark and visible freshness/missing-data status. Unknown stage-entry time must remain unknown.
- [ ] Add server/rules tests for programme, branch, role and SME scope before exposing derived records.

**Exit check:** duplicate/reordered input replays deterministically; projections match their sources; corrected records reconcile; unauthorised cross-scope reads fail.

### 3. Add the process visualisation

Use the dedicated [Digital Twin page](../../src/routes/oversight/digital-twin/index.tsx), linked from the existing [Interventions Control Tower](../../src/routes/oversight/interventions/index.tsx). Keep its role model and verify server-side scope as well. The twin has its own subscriptions; the existing tower remains unchanged apart from its link.

- [x] **Current state:** a 2D process map with stage counts, explicit known waiting times and separate delivery/evidence/outcome lanes. Queue owners and records are available through stage drawers; policy bottleneck thresholds remain a follow-on task.
- [x] **History:** animated milestones with play/pause/reset/speed and timeline seeking; inspection opens the current source record, not a reconstructed historic snapshot.
- [x] **Data quality:** missing links, unknown stage dates, excluded counts and source freshness. Server reconciliation results remain outstanding.
- [x] Show synthetic data clearly and use the universal programme selection and local branch/department filters.
- [x] Distinguish historical playback from scenario estimates; respect reduced motion.

**Visual direction:** start with an interactive 2D map and optional animated movement between stages. A 3D facility model is optional later if physical room/resource layout affects a decision; it is not a prerequisite for the twin.

**Exit check:** an authorised reviewer can trace a delayed assignment through reception/attendance, delivery, MOV and pack stages without equating attendance, verification and business improvement.

## Process simulation — local engine complete; server persistence next

- [ ] Add versioned `twinModels`, immutable baseline snapshots, `twinScenarios` and `twinRuns`. Decide snapshot storage explicitly; large baselines should not become unbounded Firestore documents.
- [ ] Implement a bounded server worker with reproducible run inputs: snapshot ID, model version, calendar, horizon, assumptions and random seed where applicable.
- [ ] Use transparent queue/discrete-event rules for facilitator availability, review windows, shared staff, leave, group sessions, recurrence, prerequisites, cancellations and pack batching.
- [x] Templates for more facilitator hours, more frequent HOD review and 30 additional SMEs. Intake currently assumes one intervention per SME; richer demand mix remains.
- [x] Compare baseline/scenario outstanding work, delivered SMEs, validated evidence, stage queues and utilisation. Population waiting-time analysis remains.
- [x] Label results **scenario estimates**. Expose assumed service durations and capacity; do not invent empirical confidence percentages.
- [x] Current simulation has no Firestore writes. Future persistence must stay within scoped twin collections. Applying a decision must use existing authorised operational workflows.

**Exit check:** independently calculated small cases verify queues, calendars, batching and shared capacity. Identical inputs reproduce identical results. Extra facilitator capacity can expose a downstream approval bottleneck, but cannot create unexplained work or exceed available hours.

## Follow-on twins

### SME State Twin

- [ ] Key each state by SME **and programme enrolment**, preserving effective dates and intervention cycles.
- [ ] Show compliance, engagement, diagnosed gaps, delivered/verified support, reported outcomes and business measurements separately.
- [ ] Retain each measure's unit, period, baseline, source, observation/recording dates and verification status.
- [ ] Reuse existing outcome follow-ups and assessments. Preserve SME/facilitator disagreement and unknown results.
- [ ] Add an SME timeline with source evidence and explainable changes. Completing an intervention must not automatically imply revenue growth or graduation.

### Programme System Twin

- [ ] Combine process queues and SME states with cross-department demand, shared staff, resources and programme targets.
- [ ] Add intake, allocation, sequencing and cost scenarios with explicit synthetic cost assumptions.
- [ ] Extend the journey to onboarding, compliance and graduation using versioned programme rules.
- [ ] Compare throughput, verification quality and SME outcomes as separate objectives.
- [ ] Add `twinEvaluations` to record reviewed decisions and later observed results; calibrate against real chronological holdouts when suitable history exists.

## Verification and safe continuation

Run local checks from the repository root:

```powershell
node scripts/digital-twin/validate.cjs
node --test functions/src/syntheticData.test.cjs
node --test scripts/digital-twin/walkins.test.cjs
node --test src/services/digitalTwin/processTwin.test.cjs src/services/digitalTwin/historySimulation.test.cjs src/services/digitalTwin/centreHeadcounts.test.cjs functions/src/digitalTwin/events.test.cjs scripts/digital-twin/demand-analysis.test.cjs
# Browser fixture: needs the playwright-core package and Microsoft Edge. Install the package anywhere outside the repo
# (npm install playwright-core) and pass its folder as the argument.
node scripts/digital-twin/preview-process-twin.cjs <path to node_modules/playwright-core>
npm.cmd run build
```

The browser fixture covers the Guide Me tours, the Current state map and its drill-downs, History playback and attendance routes, the Scenarios levers, settings, goal and chart (including the wording guard against "Doing nothing" and "work items"), the headcount fallback when staff reads are refused, programme switching, phone widths, and unauthorised access. It also records the Scenarios chart height on a phone (103px at 390px wide), which is a known weakness.

Optional live, read-only checks require access to the existing local credentials:

```powershell
node scripts/digital-twin/seed.cjs --verify
node scripts/digital-twin/seed-walkins.cjs --verify
node scripts/digital-twin/audit-notifications.cjs
```

These checks validate the saved fixture, not the future twin. Exact-hash verification will report drift after intentional app edits: investigate and record the change; do not overwrite those edits merely to make verification pass. For more fixtures, use a new versioned run. Existing imports are create-only; a broad reset or general upsert is not implemented, despite those being early options in the original plan.

Notification suppression was deployed for the seeded workflows, including inquiry creation and specialist referrals; the saved receipt lists 22 safeguards. Keep the common guard in [`syntheticData.ts`](../../functions/src/syntheticData.ts) and propagate metadata into new derivative records. Re-audit notification paths before adding new trigger-producing fixture types. Synthetic profiles and actors have no login credentials; authenticated workflow tests need deliberately provisioned test identities with the appropriate scope.

Before declaring a twin release complete:

- [ ] Run positive, negative, partial, delayed, unknown and disputed outcome cases.
- [ ] Exercise actual authenticated SME, facilitator, HOD, CC and M&E workflows, not only seeded final states.
- [ ] Test cancelled/declined/no-show and recurring/group cases, corrections, duplicates and missing data.
- [ ] Verify browser refresh, source drill-downs, permission boundaries and synthetic labels in exports.
- [ ] Test scenario isolation, resource conservation and reproducibility.
- [ ] Record functional acceptance separately from real-data calibration and predictive accuracy.

The saved seed and current-state fixture checks passed; authenticated browser workflow testing and complete twin acceptance remain outstanding. The checkout contains unrelated uncommitted work: inspect current changes before editing and preserve it.

## Suggested prompt for the next build session

> Read docs/digital-twins/README.md and the overall plan. Continue the implemented Current state, History and Scenarios views. Verify authenticated access, implement durable scoped capture/backfill/reconciliation, then persist versioned frozen baselines and runs behind scoped APIs. Preserve universal programme scope, source records and notification safeguards. Extend the pooled model with explicit rules and independent tests. Report verification boundaries and the next incomplete milestone. Calibration remains separate.

## Guided page explanation

The page now includes a repeatable Guide me walkthrough covering delivery counts, evidence approval roles, follow-up outcomes, waits/exceptions, historical milestones, baseline capture and scenario interpretation. It switches between Current state, History and Scenarios without running or applying a scenario. Inline explanations clarify units and acronyms. The guide explicitly describes the implementation as an early process twin and distinguishes working local simulation from outstanding durable history, shared runs and real-outcome validation. Implementation: `src/routes/oversight/digital-twin/TwinGuide.tsx`.

### Scenario result row
Scenarios now opens with no change applied, so the chart shows only "If nothing changes" until a lever is used. Under the headline, `ResultRow` shows open interventions at the end, the busiest team and the day the backlog peaks (`runSummary.ts`). The pill above it says head-of-department and M&E hours are placeholders (nothing records review time yet); it opens the settings.

### Overview landing view
The twin opens on **Overview** (`TwinOverview.tsx`): one flat circle for the interventions with their health inside (the share of open interventions within target), and four team cards beside it for delivery, head-of-department review, centre coordinator and M&E. Selecting a team card lists its steps and opens the record list. The text field at the bottom is the AI assistant placeholder: it records the question locally and says the assistant is not connected yet.

### MOV lifecycle in the twin
A MOV is created when the facilitator completes an intervention and starts awaiting the SME signature (`awaiting_smme`); the HOD then approves it against the POE, it joins the monthly pack, the CC validates and M&E validates. There is no draft stage: a MOV whose status is missing or not recognised is excluded and listed under "records need attention" (`processTwin.ts`). The synthetic dataset no longer creates MOVs for interventions still in delivery.

### Describe a change (Scenarios)
The field above the Scenarios chart turns a sentence into lever settings with `scenarioIntent.ts`. It is a rule-based reader, not an AI: it reads hours, people (turned into hours using centre opening hours, 40 h for M&E), review days, new SMEs and a horizon in weeks or months, applies only the levers it finds, and lists anything it could not use. A model-backed version only has to return the same `ScenarioIntent`. The Overview no longer has a text field.

Update: the Scenarios field now asks the assistant first (`POST /twin/scenario-intent` in `ai-backend/twin_scenario.py`, Gemini, JSON only) and falls back to the rules above if the assistant is unavailable, and says so. The model only lists named changes; the backend converts people to hours and applies the page limits, and the page validates the answer again (`normaliseIntent`). Deploy `twin_scenario.py` with `app.py`.

### Overview scene
The Overview is the scene (`TwinScene.tsx`); the cards look is gone. It follows the site theme (light or dark), has a full-screen button, and on phones the cards stack under the picture. A glowing core stands for the programme, with the four simulated teams on an arch around it and a pile of cubes at each for work waiting. Each team card has a dial (facilitator hours, review days, coordinator hours, M&E hours) and the core has one for new SMEs. Dials change the **shared scenario state** (`ScenarioState.tsx`), so Scenarios shows the same chips. The slider moves through the simulated weeks. Frame 0 is today's real starting position and is identical with or without dials; later frames come from the simulation. SME signature and Needs attention sit beside the core as steps outside the model. Piles show the model's own queues: only work that is ready to move, so they are smaller than the record counts, and the footer says how many records are waiting on people outside the model.

The Delivery pile also shows the Delivery records the model does not move (waiting on SMEs or on whoever records the work) as grey cubes at its base. They are counted from the records, stay constant while the weeks play, and are never changed by a dial.

Layout update: the scene is now a row of five columns (Delivery, Head of dept., the core with the notice above it, Centre coordinator, M&E), each with its own small pile picture and card, instead of one fixed-ratio picture with cards positioned over it. It stretches with the width and needs about 600px of height; on phones the columns become two across with the piles still shown. The view buttons and the full-screen button share the top row.

Layout update 2: on a page 900px wide or more the scene is the arch again, but its x positions are fractions of the measured page width (\`TwinScene.tsx\`), so the teams spread across the whole width of a TV or a laptop alike; below 900px the teams become two columns, each with its own small pile. The earlier cap on width from the window height is gone.

Scene drill-down: piles are no longer clickable and the step picker is gone. Hovering a pile shows how many records are waiting today (real records, never the simulated date), the three that have waited longest and a link to Current state, which already has the full lists. SME signature and Needs attention link to Current state too.

### Projection window (replaces the Scenarios tab)
The Scenarios tab is gone. The Overview has a **Projection** button that opens a two-panel window (`ScenarioPanel.tsx` inside a modal in `index.tsx`): the five dials, the horizon, "Describe a change", "Set a goal" and Settings on the left; the backlog chart, headline and result row on the right. The dials are the same state as the dials on the scene (`ScenarioState.tsx`), so a change in either place shows in the other at once, and Reset clears both. `?view=scenarios` still opens the window. The guide is now "Projection: test a change".

Projection summary: the three metric cards and the shaded-columns note are gone from the Projection window. The space under the chart holds the day panel and a "What the change does" card (`ProjectionSummary.tsx`) comparing the change with "if nothing changes". The built-in wording (`projectionSummary.ts`) shows at once; for a real change the assistant (`POST /twin/projection-summary`, `ai-backend/twin_scenario.py`) replaces it when it answers. The page sends only numbers and short labels (no names or records); the backend accepts the wording only if every number in it was one it was given, and otherwise the built-in wording stays. Deploy `twin_scenario.py` with `app.py`.

SMEs card and notice chip: the scene has an **SMEs** card (and a grey pile) between Delivery and Head of dept. review: everything currently waiting on an SME, meaning Delivery records they must respond to or confirm plus MOVs they must sign. It has no dial (the model has no SME response time) and clicking it goes to Current state. The critical notice is now a slim chip in the top row beside the view buttons instead of sitting inside the scene. Delivery's grey-cube line names who each record waits on, from the record's own owner.

Temporary: the full-screen button is removed, and the top row (History, Current state, Projection and the critical notice) is hidden for users. Bring it back by setting `TOP_ROW_VISIBLE = true` in `TwinScene.tsx`, or per browser with `localStorage.setItem("twinTopRow","show")` (the browser preview does this). While it is hidden the other views are reachable only by link (`?view=history`, `?view=current`, `?view=scenarios` for the Projection window). The "Turn a dial" hint under the core is gone.
