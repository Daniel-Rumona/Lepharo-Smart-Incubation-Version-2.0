# Training Academy: certification progress and multiple employees per SME

Status: **proposal, decisions recorded 2026-10-27, nothing built**. No code, rules or Firestore data has changed. Section 9 records the user's answers; sections 2–8 and 11 are updated to match them.

---

## 1. What exists today (findings)

### 1.1 A training SME is not a `participants` record

The Training Academy has its own identity model. It is separate from the incubatee model.

| Concept | Where | Notes |
|---|---|---|
| Training | `trainings/{id}` (`src/components/trainings/trainingStorage.ts` `Training`) | `categories[]`, `courseIds[]`, `plan[]` (`TrainingPlanSession`), `requiredDocuments`, `requiredDetails`. Doubles as a programme (`programId = training.id`). |
| SME | `trainingEnrollments/{id}` (`TrainingEnrollment`) | A record for **one person**: `name`, `email`, `companyName`, `categories[]`, `documents[]` (ID copy, CV, …), `details`, `userId`, `status`. |
| SME login | `users/{uid}` created by `provisionAccount()` → `createPlatformUser` | `role: "training_sme"`, `participantId = trainingEnrollmentId`, `trainingEnrollmentId`, `trainingId`, `companyName`. One login per enrollment. |
| Plan session booking | `trainingPlan.ts` `scheduleTrainingSession()` | One group `appointmentSessions` doc (`groupKey = training:{trainingId}:{planSessionId}`, `interventionId = training_{trainingId}`) plus **one `appointments` invitation per enrollment** (`smeId = enrollment.id`). The invitation ID is deterministic: `appointment_{safe(sessionId__smeId)}`. |
| Plan session category | none | `TrainingPlanSession` has `topics[]` (picked from `training.categories` as tags) but **no category field**, so a session cannot be targeted at a category's SMEs. |
| SME portal | `/training/*` (`SmeDashboard`, `SmePlan`, `LearnerCatalog`) | Data comes from `useMyEnrollment` (reads `users.participantId` → `trainingEnrollments`) and `useMyAgenda` (`appointments where smeId == enrollment.id`). |
| Route lock | `src/components/layout/index.tsx` ~L380 | `training_sme` is redirected to `/training` on any other path. Its programme is locked by reading `trainingEnrollments/{participantId}` (~L647). |
| Course progress | `academyEnrollments` (learner = uid), `functions/src/academy.ts` `mayTakeCourse()` | Progress is tracked **per auth uid**. `mayTakeCourse` requires `enrollment.userId === uid`, so a second login on the same enrollment would be refused. |
| QR check-in | `src/components/shared/AppointmentCheckIn.tsx`, route `/meeting-checkin` (outside the layout, so not caught by the training lock) | Finds the session by `attendanceSession.token`. It then finds **the first** invitation in that session whose `smeEmail` equals the user's email, or whose `smeId` is in the viewer's identity ids (`uid`, `participantId`, …). It sets `attendance.status = attended` in a transaction and bumps `attendanceSummary`. |

The suggested starting points `IdentityContext` / `resolveIncubateeParticipantId` and the SME `directors` array belong to the **incubatee** (`participants`) model. The Training Academy does not use them. `directors` exists only in the gap-analysis question bank and the welcome wizard. So the "director" for a training SME is simply the enrollment's own person and login.

### 1.2 Firestore rules that matter

- `trainingEnrollments`: staff (`academyAuthor()`) read/write; a `training_sme` reads **only the enrollment whose `userId == auth.uid`**. The record holds the person's ID copy and qualification documents.
- `appointments`:
  - Read is open to every signed-in user.
  - `isOwnSmeResponse()` matches `smeId == uid`, `smeId == currentUser().participantId` or `smeEmail == currentUser().email`. It allows only RSVP fields to change.
  - **`isQrInvitationCheckIn()` has no identity check at all.** Any signed-in user can mark any invitation `attended` while its session's QR is active. Only the client enforces identity. This needs fixing anyway, and it becomes more serious with several logins per company.
  - `canonicalAppointment()` uses `keys().hasOnly([...])`. Any new invitation field (e.g. `attendeeId`) must be added there, or creates and updates are rejected.
- `agreementTemplates`: only `system_admin` may write. Training staff could not manage certificate templates there.

### 1.3 Existing agreement and signing pattern (to reuse)

- **Signature asset:** each user uploads one signature image in Account settings (`SignatureSection.tsx` → `users.signatureURL`). Signing flows refuse to continue without it (`AppointmentResponseSheet.tsx`, `PendingDevPlanPrompt.tsx`).
- **Signed-record meta** (POPIA, MOA, pre-incubation contract): `signedAgreements.{id} = { acceptedAt, userAgent, version, textHash, signer: { uid, email, name, signatureURL }, pdfUrl, pdfPath }`.
- **Two-party signing:** the MOA stores the incubatee's signature first. A centre coordinator (ROM) later countersigns (`romSigned`, `romSignatureURL`, `romSignerName`, `romSignerTitle`, `romSignedAt*`).
- **Document generation:**
  - Contracts are built in code (`moa.pages.ts` uses the `docx` lib) or rendered HTML → `generateAndUploadContractPDF()` (html2canvas + jsPDF → Storage `agreements/{participantId}/…`).
  - `agreementTemplates` docs hold **metadata only** (form no, revision, version, renderer, signing route), not an uploaded file.
- **Template filling:** `src/utils/docxTemplateFill.ts` already fills uploaded DOCX files with `{{placeholders}}` (docxtemplater + pizzip; used by monitoring reports). It downloads a `.docx` and cannot place signature images (that needs docxtemplater's paid image module) or produce a PDF.

### 1.4 Notifications and synthetic data

- `functions/src/syntheticData.ts` `suppressRecordNotifications()` treats `dataOrigin: "synthetic"`, `suppressNotifications: true` or any `dtseed_` id (incl. `smeId`, `participantId`, `programId`) as synthetic. Appointment emails (`emailAppointments.ts`) honour it.
- `appointmentSchedulingService` copies the synthetic mark from the **assigned intervention**. Training invitations have `assignedInterventionId: ""`, so **training bookings never inherit a synthetic mark**.
- `provisionAccount()` always sends the welcome email (`sendEmail: true`), even for seeded enrollments.

---

## 2. Proposed data model

### 2.1 Company vs. person (multiple employees)

Keep `trainingEnrollments/{enrollmentId}` as **the SME (company)** record. Today's enrollment person becomes the company's **director**. Add a new top-level collection for the people.

```ts
// trainingAttendees/{attendeeId}   (new)
type TrainingAttendee = {
  id: string;
  enrollmentId: string;          // the SME (trainingEnrollments id)
  trainingId: string;            // denormalised for queries/rules
  kind: "director" | "employee";
  /** Whether this person attends sessions. Employees: always true. Director: often false (owner only, Q11). */
  attends: boolean;
  name: string;
  email: string;                 // required for every person (Q8): their login and QR self check-in
  phone?: string | null;
  // Q8 (revised): a person gives only their own identity. Company documents
  // (CIPC, bank confirmation, registration form, …) stay on the enrollment.
  idNumber: string | null;
  idDocument: TrainingDocument | null;   // copy of the ID
  categories: string[];          // subset of training.categories this person attends
  userId?: string;               // their training_sme login, when created
  status: "active" | "withdrawn";
  withdrawnAt?: string; withdrawnBy?: string; withdrawnReason?: string;
  addedBy: { uid: string; role: "staff" | "director" };
  // certification, maintained by the progress function (section 4)
  progress?: AttendeeProgress;
  dataOrigin?: "synthetic" | "real";
  suppressNotifications?: boolean;
  createdAt: string; updatedAt: string; owner: string;
};
```

Why a top-level collection rather than a sub-collection or an array on the enrollment:

- An employee's login must not be able to read the enrollment itself, because it holds the director's ID copy and CV (POPIA). A separate doc can be readable by its own person.
- It can be queried with `where("userId","==",uid)`, and with `where("trainingId","==",…)` for staff lists.
- Writes to it by staff or functions don't race with enrollment edits.

The existing `TrainingEnrollment.name/email/categories/userId/documents/details` stay as they are, as the director's copy, so nothing that reads them today breaks. The director's attendee doc mirrors them (`kind: "director"`), with `attends` set by staff or the director. A director with `attends: false` gets no session invitations and no personal certificate, but still sees the whole company (Q11).

**Employee documents** are uploaded to a new Storage path, `training_attendees/{enrollmentId}/{attendeeId}/{file}`. Staff and that company's director may upload and read; the employee may read their own. Today's `training_enrollments/` path is staff-only and stays as it is.

**Adding and withdrawing people** goes through one callable, `manageTrainingAttendee` (add / update / withdraw / resend login), for both staff and directors (Q2). It checks that a director caller's `participantId` matches the enrollment, validates the training's required details, rejects duplicate emails, creates the Auth user with the existing `createPlatformUser` logic, and never creates real logins or emails for synthetic or `dtseed_` records. When a director adds or withdraws someone, the function notifies the training's staff in-app, so staff know straight away (e.g. someone left).

### 2.2 Users

Both directors and employees keep `role: "training_sme"`, so all existing route gating, login redirect, programme lock and `createPlatformUser` allow-listing keep working. New profile fields:

| Field | Value |
|---|---|
| `participantId` | the **enrollment id**, for both (company scope: agenda, course linking, programme lock) |
| `trainingAttendeeId` | their own `trainingAttendees` id |
| `trainingRole` | `"director" \| "employee"` (a sub-role, not a new role) |
| `trainingId` | already written by `provisionAccount`; the layout lock should read this instead of the enrollment |

Choosing a sub-role over a new `training_employee` role avoids touching the ~10 places that special-case `training_sme` (layout, login, WelcomeWizard, `academy.ts`, `userManagement.ts`, `learnerCourses.ts`, rules). Permissions differ only where `trainingRole` is checked.

### 2.3 Per-attendee invitations (attendance)

**Recommendation: one `appointments` invitation per attendee, not per company.**

New fields on the invitation:

```ts
attendeeId: string | null      // trainingAttendees id; null for non-training invitations
attendeeName: string | null
attendeeKind: "director" | "employee" | null
```

- `smeId` stays the **enrollment id** (company), so `useMyAgenda`'s `smeId ==` query still returns the whole company, and grouping by company is trivial.
- `smeName` stays the company display. `smeEmail` becomes the **attendee's** email, so existing invitation emails and the email-based check-in match go to the right person.
- New invitation id for training: `appointment_{safe(sessionId__enrollmentId__attendeeId)}`. Existing ids stay as they are (see Migration). `inviteToTrainingSession()` must dedupe by `(appointmentSessionId, attendeeId)` from a query, not by id alone.
- `attendanceSummary.invitedCount/attendedCount` now count **people**. The training plan drawer and staff views can show "7 people from 3 SMEs" by grouping invitations by `smeId`.

Why not a single invitation per SME with an `attendees` map:

- The QR check-in transaction, the staff "members" table in `shared/appointments` (one row per invitation, RSVP + attendance columns), coverage patches and appointment emails all already work per invitation. One invitation per person gets per-employee attendance in all of them with small changes.
- A map would need new UI everywhere, plus nested-map diff rules.

The trade-off: any report that counts "SMEs reached" from training invitations must count distinct `smeId`, not invitations. Section 8 lists the places to check.

### 2.4 Session categories

Add `category?: string | null` to `TrainingPlanSession` (one of `training.categories`; null = everyone). When a session is booked or new invitees are added, invite **active attendees whose `categories` include the session's category**, or all active attendees when it has none. This covers "three employees each in a different category session on the same day". It also replaces the free-text use of categories as `topics`.

Also add `category` to the `appointmentSessions` doc (and to the `canonicalSession` key list), so staff screens and the progress function can read it without loading the training plan.

### 2.5 Certification

Rules have **global defaults** in `systemSettings/trainingCertification` (same shape as `rules` + `awardTo` + `templateId` + `signatories` below), edited by Training Academy staff. A training's `certification` overrides only the fields it sets (Q4).

```ts
// on trainings/{id}
certification?: {
  enabled: boolean;
  /**
   * Q1. "attendee" (default): one certificate per attending person.
   * "company": one certificate to the company saying it completed the training
   * (recipientName = companyName); people still have progress, but no personal certificates.
   */
  awardTo: "attendee" | "company";
  templateId: string | null;              // certificateTemplates id
  rules: {
    minAttendancePercent?: number;        // of held sessions the person was invited to
    requiredPlanSessionIds?: string[];    // must have attended each (or one occurrence of each series)
    perCategoryMinSessions?: number;      // attended ≥ N held sessions in each of their categories
    // Courses are director-only for now (Q10), so course rules apply only to a director
    // who attends, and to company-mode awards (via the director's progress).
    requiredCourseIds?: string[];         // academy courses completed (all required items)
    minAverageScore?: number;             // across those courses' assessments
    requiredDocuments?: boolean;          // company documents on the enrollment, and the person's ID number + ID copy, are on file
  };
  /**
   * Q5. Default: one signatory, the Academy head, resolved at signing time as
   * departments/{systemSettings/departmentRoles.training}.headUserId (by role, never by name).
   */
  signatories: { key: string; title: string; userId?: string; departmentRole?: "training" }[];
};

// trainingAttendees/{id}.progress   (written by the progress function only)
type AttendeeProgress = {
  sessionsInvited: number; sessionsHeld: number; sessionsAttended: number;
  attendancePercent: number;
  byCategory: Record<string, { held: number; attended: number }>;
  courses: Record<string, { required: number; completed: number; score?: number }>;
  eligibility: {
    status: "not_started" | "in_progress" | "eligible" | "certified" | "revoked";
    met: string[]; missing: string[];   // human-readable rule results
    override?: { by: string; reason: string; at: string } | null;  // Q4
    evaluatedAt: string;
  };
  certificateId?: string | null;
};

// trainingCompanyProgress/{enrollmentId}   (new, function-written, read-only to the company)
//   aggregates the attendees: counts per person, overall %, eligibility per person,
//   upcoming sessions per person, issued certificates (ids + pdf urls).

// certificateTemplates/{id}   (new)
type CertificateTemplate = {
  name: string; active: boolean; version: number;
  file: { path: string; url: string; kind: "pdf" };
  fields: string[];                 // form-field names found in the PDF on upload
  signatureFields: string[];        // e.g. ["signature_1","signature_2"]
  trainingIds?: string[];           // optional restriction
  createdBy: string; createdAt: string; updatedAt: string;
};

// trainingCertificates/{id}   (new, one per awarded person or company)
type TrainingCertificate = {
  trainingId: string; enrollmentId: string; attendeeId: string | null;
  recipientName: string; companyName: string;
  certificateNumber: string;        // e.g. LPH-TA-2026-000123 from a counter
  templateId: string; templateVersion: number;
  data: Record<string, string>;     // the exact values filled in
  status: "draft" | "pending_signature" | "issued" | "revoked";
  signatures: Record<string, {      // keyed by signatory key
    uid: string; name: string; title: string; signatureURL: string;
    signedAt: string; userAgent: string;
  }>;
  pdfPath?: string; pdfUrl?: string; sha256?: string;
  /** Q9. Printed on the certificate and encoded in its QR; see 5.3. */
  verificationCode?: string;
  issuedAt?: string; revokedAt?: string; revokedReason?: string;
  dataOrigin?: "synthetic" | "real"; suppressNotifications?: boolean;
  createdBy: string; createdAt: string;
};
```

---

## 3. Roles and Firestore rules

| Collection | Staff (`academyAuthor()`) | Director (`trainingRole == director`) | Employee |
|---|---|---|---|
| `trainingEnrollments` | read/write (unchanged) | read own (unchanged, `userId == uid`) | **no access** (documents are private) |
| `trainingAttendees` | read/write | read all where `enrollmentId == currentUser().participantId`; writes only through `manageTrainingAttendee` | read own only (`userId == uid`) — never colleagues (Q6) |
| `trainingCompanyProgress` | read | read where doc id `== currentUser().participantId` | same as director; holds **totals only**, no names or per-person rows (Q6) |
| `trainingCertificates` | read; create drafts | read all of the company's issued certificates | read own issued (`attendeeId == trainingAttendeeId`), and the company certificate in company mode |
| `certificateTemplates` | read/write | none | none |
| writes to progress / certificate signatures / status | **function only** (`allow write: if false` on those fields; signing goes through a callable) | – | – |

Changes to `appointments` rules:

1. Add `attendeeId`, `attendeeName`, `attendeeKind` (and `dataOrigin`, `suppressNotifications`, which the scheduler already writes) to `canonicalAppointment()`'s `hasOnly` list.
2. **`isQrInvitationCheckIn()` gets an identity check.** Either:
   - the invitation has an `attendeeId` and it equals `currentUser().trainingAttendeeId`; or
   - it has none, and the existing `isOwnSmeResponse` identity terms match.

   This closes today's "anyone can mark anyone attended" gap.
3. `isOwnSmeResponse()`: for invitations with an `attendeeId`, that attendee **or the company's director** (`trainingRole == "director"` and `smeId == participantId`) may RSVP (Q3). Employees must not be able to answer colleagues' invitations, although today's `smeId == participantId` term would let them. QR check-in (item 2) stays the attendee's own: the director cannot check anyone in.

Other code paths that assume one login per enrollment, and their changes:

- `academy.ts` `mayTakeCourse()`: **no change for now**. Courses stay director-only (Q10), and its `enrollment.userId === uid` check already admits only the director. Employees' portal has no Courses menu. (Later: per-category courses, see section 11.)
- Layout programme lock (~L647): read `users.trainingId` (already written at provisioning) instead of the enrollment doc, which employees cannot read.
- `useMyEnrollment`: for employees, load `trainingAttendees` + `trainings` + `trainingCompanyProgress` instead of `trainingEnrollments`.
- Login (`routes/login/index.tsx` ~L409): `training_sme` uses `allowRedirect: false`. An employee who scans a QR while signed out goes to `/login?redirect=/meeting-checkin…` but lands on `/training` and never checks in. Allow redirects to `/meeting-checkin` (and only that) for `training_sme`.

---

## 4. Certification progress and eligibility

**Where it is computed:** a Cloud Function (`functions/src/trainingProgress.ts`). The client cannot do it: a director's login cannot read employees' `academyEnrollments` (keyed by learner uid), and staff need a queryable "eligible, not yet certified" list across all SMEs.

- **Triggers** (each recomputes one attendee, then the company summary):
  - `appointments` written with `groupKey` starting `training:` (attendance or RSVP changed);
  - `appointmentSessions` coverage or status changed (a session counts as held only when `coverage.held === true` or `status == completed`);
  - `academyEnrollments` written for a uid that maps to a `trainingAttendees.userId`;
  - `trainings.certification` or `plan` changed (recompute all of the training's attendees);
  - `trainingCertificates` status changed (→ `certified` / `revoked`).
- **Algorithm** (pure function, unit-testable like the existing `*.test.cjs`): gather the attendee's invitations and held sessions, group by session category, and join course progress for their uid. Evaluate each enabled rule into `met[]` / `missing[]`. The status is:
  - `certified` if an issued certificate exists;
  - else `eligible` if all rules are met (or there is an override);
  - else `in_progress` if anything is attended or completed;
  - else `not_started`.
- **Who is evaluated:** only people with `attends: true` (a non-attending director has no personal eligibility).
- **Company mode** (`awardTo: "company"`): the company is eligible when every required plan session and category was attended by at least one of its active attendees, and every other enabled rule is met on the company totals. One certificate is issued to the company.
- **Staff override (Q4):** staff can mark a person (or, in company mode, the company) eligible with a required reason. The override is stored with who and when, shown as "Eligible (override)", and kept in the audit trail.
- **Backfill/recompute:** a callable `recomputeTrainingProgress({ trainingId })` for staff, used after rule edits and at migration.

**How "eligible but not yet certified" is shown:**

- Staff **Training SMEs repository** (`TrainingSmesRepository.tsx`):
  - new Certification column (Not started / x of y requirements / Eligible / Certified) per company, expandable per person;
  - a filter "Eligible – not certified";
  - a bulk action "Prepare certificates" (creates `draft` certificates for the selected people).
- Staff **Training dashboard** (`dashboards/training`): a tile "N eligible awaiting certificate" that links to that filter.
- **Director / employee dashboard** (`SmeDashboard`): a "Certification" card with each rule as a checklist (met / missing). When eligible: "Eligible – your certificate is being prepared". When issued: a download button.

---

## 5. Certificate template, fill and sign flow

### 5.1 Template format: fillable PDF (recommended)

Staff upload a designed certificate as a **PDF with named form fields** (made in Word → PDF + Acrobat, Canva → Acrobat, or LibreOffice). Field names are the placeholders:

`recipientName`, `companyName`, `trainingName`, `categories`, `completionDate`, `startDate`, `endDate`, `certificateNumber`, `centreName`, `signatory1Name`, `signatory1Title`, … and `signature_1`, `signature_2` (field rectangles where signature images are drawn), plus optional `verificationQr`.

Why PDF rather than DOCX with `{{…}}` (the `docxTemplateFill.ts` approach):

- Certificates are one-page designed artwork that must come out as a PDF.
- DOCX → PDF needs LibreOffice on a server.
- Placing signature images in DOCX needs docxtemplater's paid image module.

`pdf-lib` (MIT, no native deps, works in the browser and in Functions) fills form fields by name, draws PNG signatures into a field's rectangle, adds a QR, and flattens the result. This adds one dependency (`pdf-lib`) to `functions/` (and to `src/` for the live preview).

If the user prefers a DOCX template with `{{placeholders}}` to match monitoring reports, see Q7. That route needs a conversion service.

Template manager: a new **Certificate templates** tab in the Training Academy area. It copies the table/modal style of `AgreementTemplatesManager.tsx` but lives in its own collection, because `agreementTemplates` is system-admin-only and metadata-only. On upload, the client reads the PDF's field names with pdf-lib and saves `fields` / `signatureFields`. It warns about unknown names and missing required ones (`recipientName`). It also shows a **preview** filled with sample data.

### 5.2 Fill → sign → issue

1. **Prepare (staff):** from the eligible list, "Prepare certificates" creates `trainingCertificates` in `draft`. It snapshots `data` (names, dates, categories) and a `certificateNumber` from a `certificateCounters/{year}` transaction. Staff can correct the recipient name before signing (common with ID-spelling issues).
2. **Send for signature:** status → `pending_signature`. The signatory (by default the **Academy head**, Q5; resolved by department role, see 2.5) sees a **"Certificates to sign"** queue: a new staff page, plus a dashboard badge and an in-app notification. Extra signatories can be configured later without changing the flow.
3. **Sign (signatory):** they review the filled preview (client-rendered with pdf-lib, no signatures yet), then click **Sign** for one or **Sign all selected**. Same rule as the existing flows: if `users.signatureURL` is missing, they are sent to Account settings → Signature first.
   - The click calls a callable `signTrainingCertificates({ ids })`.
   - The function checks that the caller is a listed signatory for each certificate.
   - It writes `signatures.{key} = { uid, name, title, signatureURL, signedAt, userAgent }`. This is the same meta shape as `signedAgreements.*.signer`.
4. **Issue (function):** when the last required signature lands, the function:
   - loads the template from Storage, fills the fields, draws each signature image into its `signature_n` rectangle, draws the verification QR, and flattens;
   - uploads to `certificates/{trainingId}/{certificateId}.pdf`, stores `pdfPath`, `pdfUrl` and `sha256`;
   - sets `issued`, then the progress trigger flips the attendee to `certified`.

   Generating on the server means the issued PDF cannot be forged from the client, and the hash allows later verification.
5. **Deliver:** the director and the recipient see it on their dashboard. An optional email with the PDF goes through the existing Brevo mailer, **suppressed for synthetic records** (section 7).
6. **Revoke/reissue (staff):** `revoked` with a reason. Reissue creates a new certificate with a new number. The old number stays revoked.

### 5.3 Verification (Q9: both QR and a cryptographic code)

- At issue time the function computes `verificationCode = base32(HMAC-SHA256(secret, certificateId | certificateNumber | recipientName | trainingId | issuedAt))`, truncated to 16 characters and shown in groups (`7KQ2-M9XD-…`). The secret lives in Secret Manager (`CERTIFICATE_VERIFY_SECRET`); it is never in the client or in Firestore.
- The code is printed on the certificate, and a QR encodes `https://<app>/verify-certificate?c=<code>`.
- A public page `/verify-certificate` (outside the login, like `/meeting-checkin`) calls an unauthenticated, rate-limited HTTP function. The function looks the certificate up by code, recomputes the HMAC, and returns only: recipient name, company, training, issue date, status (valid / revoked) and the PDF's `sha256`. Someone holding a PDF can compare its hash to confirm it was not altered.
- A forged code fails the HMAC check even if someone guesses the format; a revoked certificate shows as revoked.

---

## 6. UI changes

### Staff

- **Enrol SME drawer / form** (`EnrollSmeForm.tsx`, `EnrollSme.tsx`): a new **People** section with a director row (from the enrollment, with an "Attends sessions" switch) and an Add employee button. The employee form asks only for name, email (required), phone, ID number and ID copy, plus categories ⊆ the training's. Per person: Create login / Resend welcome / Withdraw (with reason). Changes made by the director show who added or withdrew whom. The company `categories` becomes the union of the attending people's categories.
- **Training plan** (`TrainingPlanDrawer.tsx`):
  - a **Category** select per plan session;
  - booking and "Invite new" use attendees filtered by category;
  - the "x/y attended" line counts people, with a per-session **roster** grouped by company: Company → person, RSVP, attended, check-in time.
- **Appointments → session detail** (`routes/shared/appointments/index.tsx`, members tab): each row already is an invitation. Show **"Company · Person"** (`smeName · attendeeName`) and group rows by `smeId`, so staff see which employees attended. Manual attendance and check-out already resolve an exact invitation. Change its matching from `smeEmail || smeId` to `attendeeId`, because `smeId` is no longer unique per session.
- **Training SMEs repository:** company rows expand to people. Progress and certification columns, the eligible filter and bulk "Prepare certificates" are in section 4.
- **Certificate templates** tab and **Certificates to sign** page (section 5).

### Director (existing `/training` portal, `trainingRole = director`)

- **Dashboard:**
  - existing tiles become company-wide;
  - a new **Team** card with one line per person: categories, sessions attended / held, course progress, certification status;
  - a **Certification** checklist and issued certificates.
- **Agenda:** all company sessions, each showing which people are invited, with Confirm / Decline on **any** of the company's invitations (Q3). No QR check-in on others' behalf.
- **People** page (new, director only): add employees (name, email, ID number, ID copy), withdraw someone who left (with reason), resend a login. All go through `manageTrainingAttendee`, and staff are notified.
- **Courses:** unchanged; courses stay with the director (Q10).

### Employee (`trainingRole = employee`)

- **Menu:** Dashboard and Agenda only (no Courses, Q10).
- **Dashboard:** company **totals** only (e.g. "company: 12 of 18 sessions attended, 2 of 4 people eligible"), read-only, from `trainingCompanyProgress`, plus their own progress, certification checklist and certificate. No colleague names or rows (Q6).
- **Agenda:** **their own** invitations only, with Confirm / Decline.
- No document, profile-detail or enrollment edits (enforced by the rules, not only by hiding UI).

---

## 7. QR check-in per employee

The flow stays the same: staff start QR attendance on the session and attendees scan the code, which opens `/meeting-checkin?token=…`. Changes:

1. `AppointmentCheckIn.tsx` resolves **the viewer's own invitation**: match by `attendeeId == user.trainingAttendeeId` first, falling back to the existing email/id match only for invitations without `attendeeId`.
   - Today it takes the first invitation whose `smeId` is in the viewer's ids. With per-person invitations that share `smeId = enrollmentId`, an employee could check in a colleague. **This must change before multiple logins go live.**
2. Not invited to this session (e.g. the session is for another category): show a "this session is for your colleague(s) X" message. Staff can add them on the spot with the existing "Invite new" action, after which they rescan.
3. Signed-out scan → login → back to the check-in page (the login redirect fix in section 3).
4. The rules enforce the same identity (section 3, item 2).
5. Fallback for employees with no email or login (Q8): staff mark them attended manually from the session roster, which already works per invitation.

---

## 8. Migration and rollout

Write all of this as dry-run-first scripts under `scripts/`, in the style of `scripts/scope-notification-audience.cjs`. Run them against an emulator or export first. **Nothing touches live Firestore without the user's approval.**

1. **Rules first:** deploy rules that accept the new fields and collections, with the old behaviour still valid (additive), so old clients keep working.
2. **Attendees backfill:** for every `trainingEnrollments` doc, create `trainingAttendees/{enrollmentId}_director` (`kind: director`, name, email, categories, userId, ID number from `details.idNumber` and the "ID Copy" document when present). Set `attends: true` when the enrollment already has training invitations (they were invited as the attendee), otherwise `false`. Use a deterministic id so re-runs are idempotent. Carry `dataOrigin` / `suppressNotifications` from the enrollment if present.
3. **Users:** for each enrollment `userId`, set `trainingRole: "director"` and `trainingAttendeeId`.
4. **Invitations:** for `appointments` with `groupKey` starting `training:`, set `attendeeId` (the director attendee), `attendeeName` and `attendeeKind`. Do not rename doc ids. History is attributed to the director.
5. **Plan sessions:** `category` stays null (= everyone) until staff set it.
6. **Progress:** run `recomputeTrainingProgress` per training once the function is deployed.
7. **Then ship the client**, then the rules tightening (`isQrInvitationCheckIn` identity, attendee-only RSVP).

Reports to re-check for "invitations = SMEs" assumptions after per-person invitations exist:

- `attendanceSummary` consumers;
- the training dashboard (`useTrainingProgram.ts`);
- appointment completion notifier counts;
- digital-twin event feeds that count appointments;
- WhatsApp staff tools reading appointments.

---

## 9. Decisions (answered 2026-10-27)

| # | Question | Decision |
|---|---|---|
| 1 | Who is certified | Per person by default. A training can switch to **company only** ("Company X completed training Y"): `certification.awardTo`. |
| 2 | Who manages employees | **Staff and the director** both can add and withdraw people. Director changes notify staff (e.g. someone left). |
| 3 | Director acting for employees | Director may **confirm or decline** attendance for any company invitation; **no** QR check-in for others. |
| 4 | Eligibility rules | Set **per training**, falling back to **global defaults**. Staff can **mark someone eligible with a reason**. |
| 5 | Signatories | Default: **the Academy head** (resolved by department role). |
| 6 | Employee visibility | Employees see **company totals and their own progress** only. |
| 7 | Template format | **Fillable PDF** for now. |
| 8 | Employee identity | Every employee has **their own email**, and gives only **their own identity**: name, ID number and ID copy. Company documents (CIPC, bank confirmation, registration, …) stay on the company enrollment. |
| 9 | Verification | **Yes**: QR plus a printed **cryptographic code** (HMAC), checked on a public page. |
| 10 | Courses | **Director only** for now. Later: courses restricted to a category, where the director sees everything (incl. employees' course progress) and employees see their own courses. |
| 11 | Director as attendee | Often **not**; the director is mainly the owner. Director attendance is an opt-in flag (`attends`). |

## 10. Risks and safeguards

- **One-login-per-participant assumptions:**
  - `AppointmentCheckIn` (first-match invitation);
  - `isOwnSmeResponse` (`smeId == participantId` lets any company login answer any company invitation);
  - `mayTakeCourse` (`enrollment.userId === uid`);
  - the layout programme lock (reads the enrollment);
  - staff manual-attendance matching (`smeEmail || smeId`).

  All are covered above. Ship them before any employee login exists.
- **Existing hole:** `isQrInvitationCheckIn()` has no identity check. Worth fixing even if this feature waits.
- **POPIA:** employees must never read `trainingEnrollments` (it holds the director's ID copy and CV). Company progress is exposed through a summary doc instead.
- **Synthetic data:** training bookings don't inherit `dataOrigin` today, because the mark comes from `assignedInterventions`, which trainings don't have. Changes:
  - carry the mark from `trainingEnrollments` / `trainingAttendees` onto invitations and sessions;
  - pass `sendEmail: false` from `provisionAccount` for synthetic or `dtseed_` records;
  - run `suppressRecordNotifications()` in the certificate-issued email and the signing-queue notifications;
  - never create real Auth users for `dtseed_` attendees.
- **Counting:** per-person invitations change the meaning of invitation counts (section 8 list).
- **Rule key lists:** `canonicalAppointment()` / `canonicalSession()` use `hasOnly`. Forgetting a new field breaks scheduling with a permission error.
- **Certificate integrity:** generate and sign server-side only. Clients never write `signatures`, `status`, `pdfUrl` or `sha256`.

---

## 11. Build order

1. Rules + data model + migration scripts (dry run), incl. the QR identity fix and the `attends` flag. **Built 2026-10-27, not deployed or run:**
   - types: `src/types/appointment.ts`, `src/components/trainings/trainingStorage.ts` (`TrainingAttendee`), `src/components/trainings/certification.ts`; schema notes in `firestore-schema/training-academy.json`;
   - rules: `firestore.rules`, `storage.rules`;
   - migration: `scripts/backfill-training-attendees.cjs`, with its planning logic in `scripts/training-attendees-plan.cjs` (tests: `node --test scripts/training-attendees-plan.test.cjs`).
2. `manageTrainingAttendee` callable, Storage path for employee documents, staff People section, session category, per-person invitations, session roster. **Built 2026-10-27, not deployed:**
   - callable: `functions/src/trainingAttendees.ts` (exported from `functions/src/index.ts`): add, update, createLogin, withdraw (disables the login, cancels future invitations silently), ensureDirector; staff are notified of a director's changes;
   - client: `src/components/trainings/attendeeStorage.ts` (people reads, callable wrappers, `trainingInvitees()`), `TrainingPeopleDrawer.tsx` (People column on the SMEs page), `TrainingSessionRoster.tsx` ("Who attended" per booked session);
   - scheduling: `trainingPlan.ts` and `TrainingPlanDrawer.tsx` (per-session category, one invitation per person), `appointmentSchedulingService.ts` (`invitationDocId` with the person; training invitations carry their own synthetic mark);
   - appointments page: rows show "Person · Company"; manual check-out matches the row's own invitation first.
3. Employee logins, portal sub-role (director People page and RSVP-for-others; employee read-only dashboard and own agenda), check-in matching, login redirect fix. **Built 2026-10-27, not deployed:**
   - portal identity: `useMyEnrollment.ts` (role director/employee; employees never read the enrollment), `useMyAgenda.ts` (own invitation per session, the company's people for the director, name-free company totals);
   - pages: `SmePlan.tsx` (director answers for each person; only people check themselves in), `SmeDashboard.tsx` (employee: own attendance, next session, company totals; director: a "Your team" card), `SmePeople.tsx` at `/training/people` (director only);
   - layout: employees see Dashboard and Agenda only and are kept off `/training/courses`; the programme lock reads `users.trainingId`;
   - check-in: `AppointmentCheckIn.tsx` matches a named invitation only to that person, and never matches an employee to an SME-wide invitation (also enforced in `firestore.rules` `isInvitationPerson`); a colleague-only session gets its own message;
   - login: a training SME signing in from a QR code returns to check-in (not on first login, which must change the password first);
   - the function also accepts a director login from before the backfill (the enrollment's own `userId`).
4. Progress function, company totals summary, global certification defaults + per-training overrides, staff override with reason, eligibility column and filter. **Built 2026-10-27, not deployed:**
   - rules engine: `functions/src/trainingProgressDomain.ts` (pure; tests: `node --test functions/src/trainingProgressDomain.test.cjs`);
   - function: `functions/src/trainingProgress.ts` recomputes one SME at a time (each person's `progress`, plus `trainingCompanyProgress/{enrollmentId}`), triggered by invitations, sessions being held, director course progress, people, enrollments, training rules, the defaults and certificates; `recomputeTrainingProgress` callable for staff (run once after the backfill);
   - settings: "Certification defaults" and a per-training certification button on the trainings page (`CertificationSettingsModal.tsx`); a training follows the defaults or sets its own rules (required sessions and courses are per training);
   - staff: Certification column, "Awaiting certificate" tile and filter on the SMEs page; "Mark eligible" with a reason per person (People drawer) or per company in company mode (`certificationStorage.ts`, `EligibilityTag.tsx`);
   - portal: a Certification card with the person's (or company's) checklist; employees' company totals come from the summary doc once it exists.
5. Certificate templates (fillable PDF), prepare / Academy-head sign / server issue, downloads, HMAC verification code + public verify page. **Built 2026-10-28, not deployed:**
   - PDFs and codes: `functions/src/certificatePdf.ts` (pdf-lib 1.17.1 + qrcode 1.5.4, added to `functions/package.json`; tests: `node --test functions/src/certificatePdf.test.cjs`, which fill a real fillable PDF);
   - functions: `functions/src/trainingCertificates.ts`: `certificateTemplateAction` (read a template's fields, watermarked preview), `signTrainingCertificates` (Academy head signs with their profile signature; the last signature issues: number from `certificateCounters/{year}`, fill, signatures, QR, flatten, SHA-256, upload to `certificates/{trainingId}/{id}.pdf`), `revokeTrainingCertificate`, `certificatesToSign`, public `verifyCertificate` (HMAC check, per-instance throttle, max 3 instances);
   - staff: "Certificate templates" drawer and a template choice in certification settings (trainings page); Certificates page at `/operations/training/certificates` (menu: Training → Certificates) with Ready to prepare / To sign / Issued (download, revoke, correct a name before signing);
   - portal: issued certificates with download and code on the dashboard's Certification card;
   - public: `/verify-certificate?c=CODE`;
   - **before deploying:** set the secret (`firebase functions:secrets:set CERTIFICATE_VERIFY_SECRET`), and never change it afterwards (every issued code depends on it). The app itself needs no new dependency: all PDF work is on the server.
6. Later (not in this build): category-restricted courses, with employees taking their own courses and the director seeing everyone's course progress.
