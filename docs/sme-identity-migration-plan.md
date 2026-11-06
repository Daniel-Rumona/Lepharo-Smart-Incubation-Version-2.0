# SME identity migration: email → uid + participantId

Decided 2026-10-31. SMEs stop being identified by email. Email becomes optional contact data,
so SMEs without an email can sign in by phone (WhatsApp code).

## Target model

- **Identity** = Firebase Auth `uid`, linked both ways to the SME's participant record:
  - `users/{uid}.participantId` (already a privileged field; only staff/functions can set it)
  - `participants/{id}.uid`
- **Applications** carry `participantId` (and `uid`). Email/`applicantEmail` stay as contact fields only.
- **Everything SME-owned** is keyed by `participantId` (appointments `smeId`, follow-ups, interests,
  responses, attendance, etc.). Photos/signatures are looked up by `uid`.
- **Phone** is a unique sign-in identifier for SMEs, enforced by a server-owned index
  (`phoneIndex/{e164}` → `{ uid, participantId }`).
- **Email**, when present, is just another sign-in method on the same uid. Changing it no longer
  needs a cascade (`updateUserEmailCascade`) for SMEs.

## Phases

Order matters: link first, then switch writers and readers, then tighten rules, then add phone login.
During phases 1–3 everything accepts **both** participantId and email, so nothing breaks mid-way.
Run every phase against `lepharo-smart-inc` (test) before `lph-smart-inc` (production).

### Phase 1 — Link existing SMEs (backfill) — built 2026-10-31
- `scripts/backfill-sme-identity.cjs` (planning in `scripts/sme-identity-plan.cjs`, tests in
  `scripts/sme-identity-plan.test.cjs`). For each `incubatee` login it finds the participant by, in
  order: existing `users.participantId`, a participant already carrying its `uid`, then auth email
  (else users doc email) = `participants.email`, case-insensitive. Exactly one → fills whichever of
  `users.participantId` / `participants.uid` is missing. Never overwrites.
- Reports, doesn't guess: no participant, no email, several matches, participant linked to another
  login, participant claimed by several logins, `users.participantId` pointing nowhere. Also counts
  applications without (or with a missing) participantId, for Phases 2–3. Applications are not changed.
- Report (ids only): `scripts/sme-identity-backfill-report-<project>.json`.
- `flagFirstLogin` in `src/routes/applications/applicationDecision.ts` now finds the login by
  `users.participantId` (it used to treat the participantId as a users doc id), else by email.
- Test project `lepharo-smart-inc`: applied — 65 SME logins, 60 already linked by seed data, 5 linked,
  0 left alone. A re-run plans nothing.

**Running it on live (`lph-smart-inc`)** — after Phase 2 is deployed there, and again just before Phase 4:

```bash
node -r ./scripts/node26-shim.cjs scripts/backfill-sme-identity.cjs --key=<path-to-lph-smart-inc-key.json>
node -r ./scripts/node26-shim.cjs scripts/backfill-sme-identity.cjs --key=<path-to-lph-smart-inc-key.json> --apply --project=lph-smart-inc
```

Resolve every "left alone" entry by hand before Phase 4, or those SMEs lose access when the email
fallback is removed.

SMEs could edit `participants.uid` on their own record until the Phase 2 rules change; deploy those
rules before anything trusts `uid`.

### Phase 2 — Writers record the link — built 2026-10-31
- `functions/src/smeIdentity.ts`: `linkSmeIdentity(uid, participantId)` links both sides in one
  transaction, never overwriting (rules in `smeIdentityLogic.ts`, tests in `smeIdentityLogic.test.cjs`).
  Callable `linkMySmeAccount({ participantId? })`: the signed-in SME links its own login. With an id,
  the participant must already carry its uid or email; without, it links the one participant that does.
- `createPlatformUser` takes `participantId` for `incubatee` logins and links them (response `smeLink`).
  `inviteSme(input, participantId)` passes it, from the onboarding form and the Excel import.
- `applicant/profile.tsx` links right after the SME creates its participant record.
- `IdentityContext` repairs unlinked SME logins in the background, once per session
  (`repairSmeLink`). This covers SMEs created before Phase 2, dummy SMEs (their participant already
  carries `uid`), and SMEs who self-registered against a record staff had added.
- `firestore.rules`: SMEs can no longer set or change `participants.uid`.
- Already in place, no change needed: invitations (`smeId`), outcome follow-ups and opportunity
  interests (`participantId`) already store the participant next to the email. `checkedInEmails` /
  `attendanceSessionGroupEmails` are derived on read from v5 invitations, so they move in Phase 3.
  Survey responses already prefer participantId, then uid; Phase 3 gives them `user.participantId`.
- Applications created by the SME (`registration/onboarding`) already carry `participantId`.
- Deploy order: functions first (`linkMySmeAccount`, `createPlatformUser`), then rules, then the app.
- Test project `lepharo-smart-inc` (2026-10-31): `linkMySmeAccount` and the rules are deployed.
  Checked with a throwaway SME: links both sides, a second call is a no-op, claiming another SME's
  record is refused, and the SME cannot change `participants.uid`. `createPlatformUser` is **not**
  redeployed yet: the project also has an unrelated `createPlatformUser` callable in `africa-south1`,
  and a filtered deploy wants to delete it. Deploy interactively and answer **No** to the deletion
  prompt. Until then, invited SMEs are linked by the sign-in repair instead.

### Phase 3 — Readers use participantId — built 2026-11-03
Every reader now finds the SME by `participantId` / `uid` first. Email lookups remain only as a
fallback, each marked "email fallback until Phase 4", for logins not linked yet and old records.
- **Client resolver**: `src/services/smeIdentity.ts` — `resolveSmeParticipantId`, `getSmeParticipant`
  (`users.participantId`, else email). `src/lib/acceptedApplication.ts` — `getSmeApplications`,
  `getSmeAcceptedApplication` (by participantId, plus the email query until Phase 4).
- **SME side**: login routing, workspace gate (`layout/index.tsx`), WelcomeWizard, POPIA check,
  dev-plan resolver + SmeWaiting/roadmap/plan-review/opportunities, growth score, milestone journey,
  incubatee dashboard/analytics/appointments/feedback/gap-analysis/group/inquiries/interventions/moa/
  resources, applicant profile/portal/tracker, onboarding, shared calendar, AppointmentCheckIn,
  gap form, pre-incubation contract signature. Pages no longer bail out when the login has no email.
  - Inquiries now store `participantId` and list by `submittedBy` + `participantId` (they used to
    query `participantId == uid` and never matched).
  - Resource requests store `requestedByUid`; `firestore.rules` lets the SME read/create by it.
- **Staff side**: photos and signatures by `users.participantId` / `participants.uid`; ROM and
  reports join participants by id; attendance carries `checkedInParticipantIds` /
  `checkedOutParticipantIds` / `attendanceSessionGroupParticipantIds` next to the email lists and
  matches on them first (`appointmentService.getAttendanceStatus` too).
- **Functions**: `uidForParticipant` checks `users.participantId` first; compliance-expiry in-app,
  outcome follow-ups, WhatsApp check-back/alerts/STOP, supplier passport resolve by participantId.
  `deleteUserCascade` no longer needs an email, never sweeps by a blank one, and for an SME deletes
  its participant, applications and assigned interventions by participantId (only if no other login
  claims that participant) — the same records the email sweep removed before.
- **ai-backend**: `get_participant_by_user`, `get_applications_by_user`, `get_inquiries_by_user`,
  `get_intake_submissions_by_user` replace the `*_by_email` tools (email as their fallback);
  `_verified_user` and programme scope use `profile.participantId`.
- **Still email-gated (Phase 5)**: some in-app notices are only sent once an SME email is found
  (application decision, MOA flag, intervention reminders, compliance expiry with no email).
- **Not touched**: external finance joins (stay email).
- Test project: rules deployed 2026-11-03. Functions and ai-backend not deployed yet.

### Phase 4 — Rules — built 2026-11-03, NOT deployed
- `firestore.rules`: `isMyEmail` is gone. `ownsParticipant(pid)` = `users.participantId == pid`;
  applications by `participantId` only; users docs readable by `uid` only; invitations by `smeId`;
  outcome follow-up answers by `participantId`; resource requests by `requestedByUid`.
- Participants: readable/editable by the linked login (`users.participantId` or `uid`), or — before
  linking — by the login that created it (`createdByUid`). An SME without a participant may create
  exactly its own (`createdByUid` = itself, no `uid`); `uid` and `createdByUid` are immutable.
  `applicant/profile.tsx` writes `createdByUid`; `linkMySmeAccount` accepts it as ownership.
- Backfill now also stamps `requestedByUid` on older resource requests (`planRequestOwners`).
  Test project: applied (7 stamped); re-run plans nothing; 65/65 SMEs linked.
- Rules checked with the Firebase Rules test API (23 cases, all pass): own records allowed, email
  alone grants nothing, new applicant creates/edits only its own record, SME with no email works.
  Run: `RULES_TOKEN="$(gcloud auth print-access-token)" node <scratch>/api-probe.cjs <repo>`.
- **Deploy order (each project):** Phase 3 app (Vercel) + functions + ai-backend live → backfill
  dry run clean (fix every "left alone" entry) → `--apply` → `linkMySmeAccount` with createdByUid →
  then these rules. Deploying the rules first breaks the current Vercel build for SMEs.
- The email fallbacks left in code by Phase 3 become dead once these rules are live (their queries
  are denied and caught); remove them afterwards.
- Known risk kept: `linkMySmeAccount` still links by an unverified login email when no id matches
  (same trust the old email rules gave). Consider requiring `email_verified` once SMEs verify.

### Phase 5 — Phone sign-in — built 2026-11-03, NOT deployed
Decisions (2026-11-03): codes go on WhatsApp through a Meta **authentication** template; an existing
SME's sign-in number is the one it confirmed for WhatsApp updates; staff and SMEs can both create
phone-only accounts.
- `functions/src/phoneLogin.ts` (rules in `phoneLoginLogic.ts`, tests in `phoneLoginLogic.test.cjs`):
  - `requestSmeLoginCode({ phone, purpose })` — purpose `login` | `register` | `change`. 6-digit code,
    salted hash only, 5 min expiry, 5 tries, 1 min between codes, 5 per number and 20 per IP an hour.
    Same reply whether or not a code was sent.
  - `verifySmeLoginCode` → custom token for the SME login the number belongs to.
  - `registerSmeByPhone({ phone, code, name })` → creates a phone-only incubatee login.
  - `createSmeLoginByPhone({ participantId, phone, name })` — staff (same roles as createPlatformUser),
    linked to the participant at once. `inviteSme` uses it when the main contact has no email; the
    director email is now optional on the onboarding form and import.
  - `changeMyLoginPhone({ phone, code })` — signed-in SME, code sent to the new number.
  - `onSmeWhatsAppNumber` — keeps `phoneIndex` on the SME's confirmed WhatsApp number (never takes a
    number another login has; never moves a registered phone sign-in).
- Collections `phoneIndex`, `smeLoginCodes`, `smeLoginCodeIps` are server-only (`firestore.rules`
  `phoneLoginCollections()`, excluded from the staff and super-admin catch-all).
- Router (`smart-incubation/functions/src/whatsappBot.ts`): dispatch type `login_code` sends template
  `LPH_LOGIN_CODE_TEMPLATE` (default `lph_login_code`, lang `LPH_LOGIN_CODE_TEMPLATE_LANG`) with the
  code as body variable and copy-code button; the code is never stored in `whatsappOutboundMessages`.
- App: `PhoneCodeForm` on login ("Sign in with phone (WhatsApp)") and registration ("No email?
  Register with phone"), desktop and mobile; `src/services/phoneLogin.ts`.
- Backfill also fills `phoneIndex` from SMEs' confirmed WhatsApp numbers (shared numbers reported,
  not indexed). Test project: nothing to index yet.
- Checked on the test project with the functions run locally against a fake router (19 checks):
  staff add-by-phone + link, code send/limits/wrong/reuse, hash-only storage, neutral replies,
  phone registration, number change. Screens checked in the browser (desktop + mobile).
- **To go live:** create and get Meta approval for the `lph_login_code` authentication template;
  deploy the router; deploy the functions; Phase 4 rules must be live first, because a phone-only SME
  creates its participant record by `createdByUid` (the current rules only allow it by email).
- Email still gates some SME in-app notices (Phase 3 note); `sendViaBrevo` callers already skip a
  missing address.

## Known exceptions

- **External finance/revenue system** joins companies to SMEs by email
  (`revenueMetricsSync.ts`, `ProjectAdminProgramPulse.tsx`, `operations/finance`, finance dashboard).
  It is external, so these joins stay email-based. SMEs without email won't match until that system
  stores a participantId.
- **training_sme** already uses `users.participantId` (trainingEnrollments id). Training attendees are
  still unique per email (`trainingAttendees.ts`); out of scope unless training SMEs also need phone login.

## Inventory (2026-10-31)

Paths relative to the repo root. `functions/lib`, `layout/backup.tsx`, `user-management/back.tsx` excluded.

### A. Rules
- `firestore.rules:56-67` — `isMyEmail`, `ownsParticipant` (email fallback is what works today).
- `firestore.rules:68-74` — `ownsApplicationData` / `ownsApplication` on `email`/`applicantEmail`.
- `firestore.rules:191` — users read by `isMyEmail(email)`.
- `firestore.rules:365-377` — `isInvitationPerson` via `smeEmail`.
- `firestore.rules:537-543` — outcomeFollowUps `participantEmail`.
- `firestore.rules:1142-1163` — participants/applications ownership and email immutability.
- `firestore.rules:1243-1256` — responses doc id = email; resourceRequests `requestedByEmail`.
- `storage.rules` — already participantId/applicationId keyed.

### B. Client, SME side
- Helpers: `src/lib/acceptedApplication.ts:24-58`, `src/services/devPlanConfirmationService.ts:68-93`,
  `src/services/popiaConsent.ts:30-41`, `src/services/growthScoreService.ts:52-67`,
  `src/services/milestoneJourneyService.ts:150-163`.
- Login/layout: `src/routes/login/index.tsx:182-191, 395-450, 656-711`,
  `src/components/modals/WelcomeWizard.tsx:240-248, 726, 747`, `src/components/layout/index.tsx:743-748`.
- Incubatee pages: `incubatee/index.tsx:515-532`, `analytics:97-114`, `appointments:200-248`,
  `documents/compliance:404-411`, `documents/hub:226-240`, `feedback:255-272`, `gap-analysis:62-107`,
  `group:159-181`, `inquiries:85-91`, `interventions:274-313`, `metrics:97-121`, `moa:110-148`,
  `resources:119-146`, `plan-review:54,78` (all under `src/routes/incubatee/`).
- Shared: `src/routes/shared/calendar/index.tsx:525-560, 790-884`,
  `src/components/shared/AppointmentCheckIn.tsx:132-171`, `src/components/surveys/response/index.tsx:216-256`,
  `src/components/modals/Contracts/POPIA.tsx:50-63`, `PreIncubationContract.tsx:152-154`,
  `src/routes/gap/new/form.tsx:55-132`.
- Applicant: `src/routes/applicant/profile.tsx:1007-1014`, `applicant/index.tsx:244-256`,
  `applicant/tracker.tsx:178-193`, `applicant/submit-inquiry.tsx:410-443`,
  `src/routes/registration/onboarding/index.tsx:771-781`.

### C. Client, staff joins
- Applications: `src/routes/applications/applicationData.ts:342-392`, `applicationDecision.ts:22-35, 82`.
- Participant joins: `src/routes/interventions/index.tsx:250-370`, `operations/reports/rom/index.tsx:556-870`,
  `operations/reports/index.tsx:601-612`, `funder/analytics/funderAnalytics.tsx:302-340`,
  `funder/funderDashboard.tsx:226-234`, `funder/smes/index.tsx:295-303`,
  `operations/groupHistory/groupData.ts:97-111`, `operations/success-challenges/index.tsx:646-650`.
- Photos by `users.email`: `shared/appointments/index.tsx:4266-4281`, `services/coordinatorSchedulingService.ts:264-280`,
  `operations/assignments/index.tsx:2192-2213`, `shared/incubatees/participantsData.ts:120-138`,
  `shared/allocated/index.tsx:2341-2347`, `shared/check-backs/index.tsx:99-140`,
  `oversight/interventions/StuckDetailModal.tsx:71-104`.
- Signatures by `users.email`: `services/attendanceRegisterService.ts:216-281`,
  `operations/plan/confirmed/index.tsx:200-215, 566`, `gap/view/GapDetail.tsx:79-339`,
  `components/modals/Contracts/PreIncubationContract.tsx:316-329`.
- Attendance by email: `services/movService.ts:428-578`, `services/appointmentSessionService.ts:154-165`,
  `components/modals/AppointmentDetails.tsx:674-700`, `components/appointments/MandatoryMeetingCoverage.tsx:95-115`,
  `shared/appointments/index.tsx:1892-1914`.
- `smeEmail` stamping: `shared/appointments/index.tsx:426-447, 4708, 4864`,
  `services/coordinatorSchedulingService.ts:427-463`, `operations/assignments/index.tsx:4179-4382`,
  `services/appointmentService.ts:124-126, 551`.
- Other: `components/modals/AppointmentsCalender.tsx:1431-1501`, `components/reports/ReachAnalytics.tsx:202-220`,
  `routes/projectadmin/index.tsx:201-212`, `operations/reports/monitoring/SMERiskRegister/riskEngine.ts:137-147`.
- External finance (stays email): `components/dashboards/projectadmin/ProjectAdminProgramPulse.tsx`,
  `routes/operations/finance/index.tsx`, `components/dashboards/finance/index.tsx`.

### D. Cloud Functions
- `inAppNotifications.ts:51-76` (`uidForParticipant` → `movRecipients.ts:50-58` email step) and its callers:
  `bidPipeline`, `emailApplications`, `emailAppointments`, `emailCampaigns`, `emailDevPlan`, `marketLinkage`,
  `moaFlag`, `workflowEmailFunctions`, `workflowQueryNotifications`.
- `complianceExpiryInApp.ts:50-84`, `outcomeFollowUps.ts:63-193`, `whatsappCheckBack.ts:55-149`,
  `whatsappAlerts.ts:39-45, 200-215`, `marketLinkage.ts:150-154, 308`, `whatsappStaff.ts:968`,
  `whatsappCoverage.ts:324`, `adminTools.ts:147-320, 481-608`, `userManagement.ts:235-346`,
  `sessionCopilot.ts:33-38`. External: `revenueMetricsSync.ts:146-167`.

### E. ai-backend
- `app.py:457-468, 642-646, 722-733, 1728-1752`, `firestore_tools.py:359-370, 453-493`,
  `tools_dispatcher.py:85-169, 254-265, 397-415`, `page_registry.py:7-64`.
