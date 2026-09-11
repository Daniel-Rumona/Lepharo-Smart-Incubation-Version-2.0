# Lepharo Smart Incubation Platform

A role-based incubation management platform for Lepharo. It runs the full lifecycle of an
SME through an incubation programme: public inquiry, registration and onboarding, gap
analysis, diagnostic planning, intervention delivery, evidence and compliance capture,
monitoring and evaluation reporting, and funder-facing analytics.

The system is a React single-page application (installable as a PWA) on top of Firebase,
with a Python AI service for document and language work.

---

## Table of contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Roles and access model](#roles-and-access-model)
- [What the UI covers](#what-the-ui-covers)
- [Domain services](#domain-services)
- [Backend: Cloud Functions](#backend-cloud-functions)
- [Backend: AI service](#backend-ai-service)
- [Data layer](#data-layer)
- [File storage](#file-storage)
- [Documents and reporting output](#documents-and-reporting-output)
- [Offline, PWA and notifications](#offline-pwa-and-notifications)
- [Running locally](#running-locally)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Repository layout](#repository-layout)
- [Maintenance scripts](#maintenance-scripts)
- [Security notes](#security-notes)

---

## Architecture

```
                        +------------------------------+
   Browser / PWA  ----->|  React SPA (Vite, Refine)     |
                        |  src/  ~500 TS/TSX modules    |
                        +-------+--------------+--------+
                                |              |
              Firebase Web SDK  |              |  HTTPS (fetch)
                                v              v
     +----------------------------------+   +---------------------------+
     |  Firebase                        |   |  AI service (FastAPI)     |
     |  - Auth                          |   |  ai-backend/app.py        |
     |  - Firestore (rules-enforced)    |   |  Google Gemini            |
     |  - Cloud Storage                 |   |  Firebase Admin (reads)   |
     |  - Cloud Messaging               |   +---------------------------+
     |  - Cloud Functions (Node 22)     |
     |      functions/src               |
     +--------------+-------------------+
                    |
      Brevo email . Google OAuth . WhatsApp gateway
```

The browser talks to Firestore directly. There is no REST API layer in front of the
database. Authorisation is enforced by `firestore.rules` and `storage.rules`, not by the
client. Cloud Functions handle everything the client must not do: privileged admin
operations, outbound email, scheduled jobs, and cross-collection syncs. The AI service is
a separate stateless HTTP service that the client calls directly with a Firebase ID token.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| UI framework | React 18, TypeScript 5.2, Vite 5 |
| App scaffolding | Refine (`@refinedev/core`, `@refinedev/antd`), React Router v6 |
| Component library | Ant Design 5, MUI, Tailwind 4, styled-components, Emotion |
| Charts | Highcharts, Ant Design Plots, Nivo |
| Calendars and boards | FullCalendar, dnd-kit, hello-pangea/dnd |
| State and data | Firebase Web SDK 11, TanStack Query, React Context |
| Serverless | Firebase Cloud Functions v2 on Node 22 |
| AI service | Python, FastAPI, Google GenAI (Gemini), Firebase Admin |
| Documents | docx, docxtemplater, pptxgenjs, jsPDF, ExcelJS, PDFKit |
| Offline | vite-plugin-pwa with a hand-written Workbox service worker |

---

## Roles and access model

Eight roles are defined in [src/types/types.ts](src/types/types.ts). Each one gets its own
route tree, navigation and dashboard.

| Role | Scope | Primary surface |
| --- | --- | --- |
| `admin` | Company-wide | User management, backend console, email monitor, feature governance |
| `director` | Company-wide | Strategic, operations and onboarding dashboards, executive reporting |
| `operations` | Department-scoped | The largest surface: assignments, HR, finance, M&E, reporting |
| `coordinator` | Global | Intervention delivery, feedback, MOVs, allocated participants |
| `projectadmin` | Branch-scoped (centre coordinator) | Inquiries, follow-ups, impact, MOVs, branch reports |
| `receptionist` | Branch-scoped | Inquiry intake, contacts, follow-ups, branch reports |
| `incubatee` | Own record | Roadmap, interventions, documents, compliance, metrics, feedback |
| `funder` | Global read | Portfolio analytics, approval queues, disbursements |

Two extra scoping concepts sit alongside the role:

- **Department scoping** applies only to `operations` users. Departments drive the
  specialist dashboards under [src/components/dashboards](src/components/dashboards):
  finance, HR, HSE, legal, linkage, marketing, PDS, ROM, stakeholder, training, wellness.
- **Branch scoping** applies to `receptionist` and `projectadmin`, and controls which
  inquiries, participants and reports a user can see.

Authentication uses Firebase email and password sign-in through a Refine auth provider in
[src/providers/auth.ts](src/providers/auth.ts). Sessions persist in IndexedDB so the
installed PWA opens signed in. Idle sessions are bounded by
[src/utils/idleSession.ts](src/utils/idleSession.ts). A "view as" facility in
[src/contexts/IdentityContext.tsx](src/contexts/IdentityContext.tsx) lets privileged users
preview another role per tab without changing the signed-in account.

---

## What the UI covers

Routes live under [src/routes](src/routes), grouped by role. The main functional areas:

**Public and intake.** Landing page, login, password reset, registration and onboarding
wizard, SME inquiry submission, and an applicant tracker for people who have applied but
are not yet participants.

**Inquiry to participant pipeline.** Receptionists capture inquiries, reply to them, and
schedule follow-ups. Centre coordinators triage the same records at branch level. Approved
applicants move through participant onboarding into the programme.

**Gap analysis.** A dedicated form builder and viewer under `src/routes/gap` produces a
gap assessment per participant, with response review, confirmation and a mapping modal
that links identified gaps to catalogue interventions.

**Diagnostic and development planning.** Diagnostic plans are drafted, confirmed and
version-controlled, with an edit-request workflow and reminder emails to the SME when a
plan is awaiting confirmation.

**Intervention delivery.** A catalogue of interventions is assigned to participants, either
individually or as group deliveries. The system tracks recurrence, completion, facilitator
assignment, session attendance registers, coverage photos, and per-intervention evidence.

**Appointments and scheduling.** FullCalendar-based scheduling with session records,
attendance capture, session review stories, coverage carousels, notice board, and a
WhatsApp channel through which participants accept, decline or request rescheduling.

**Compliance.** Required-document tracking per participant, expiry monitoring, reminder
emails, and AI-assisted verification of uploaded documents.

**MOVs and evidence.** Means-of-verification documents are uploaded, reviewed and
consolidated, with a workflow email trail and reminder cron. Separate MOV workspaces exist
for operations, coordinators and centre coordinators.

**Monitoring and evaluation.** The monitoring reports area includes a departmental
interventions drilldown, facilitator performance, incubatee insights, a province map, and
an SME risk register with analytics, flagged-reason panels, risk outlook and simulation.

**Collaborative reporting.** A full multi-contributor report builder under
`src/routes/operations/reports/collaborative`: template editor and management, report
workspace, narrative block editor, structured table editor, per-block comments and history,
contributor assignments, extracted document preview, and a preview and export page.

**Other reporting.** ROM reports, stakeholder reports, HRM reports, universal reports,
executive quarterly reports, monthly and programme summary reports with embedded charts.

**KPIs and growth.** KPI definitions, targets, target revisions with an audit trail, a KPI
tracker view, growth-score components and a milestone journey visualisation.

**HR and internal operations.** Employees, leave requests and leave calendar, payroll,
performance reviews and compacts, timesheets with a clock-in page, and quality objectives.

**Finance.** In-house finance dashboard, invoices, payments, verifications, requests and
finance reports.

**Resources.** A resource catalogue, allocations, internal resources, and a request and
approval flow shared with project managers.

**Funder view.** Portfolio analytics, SME listings, approval queues, supporting documents
and fund disbursement tracking.

**Cross-cutting UI.** Guided tours (`guide-me`), story viewer, surveys with response
capture, task management, document generation modals, contract signing with signature
capture, branch and department management, feature governance and release notes, dark mode,
and a PWA update prompt.

---

## Domain services

Business logic sits in [src/services](src/services) rather than in components. Roughly
fifty modules, including:

- Assignment lifecycle, intervention completion, recurrence and metrics
- Group intervention delivery and group lifecycle
- Appointment scheduling, sessions and attendance registers
- Compliance resolution and verification
- Diagnostic plans, follow-ups, inquiries and pre-incubation documents
- Growth score, KPI calculation, milestone journey
- MOV handling, POE generation and POE sync
- Document, PDF and quality-objective PDF generation
- Branch, department, department capability and system settings
- Feature governance, resource requests, proposals, survey extraction, AI assistant

A handful have companion `.test.cjs` files run directly with Node.

---

## Backend: Cloud Functions

Source in [functions/src](functions/src), Node 22, Firebase Functions v2, deployed to
`us-central1`. Grouped by concern:

| Module | Responsibility |
| --- | --- |
| `emailFunctions` | Generic send endpoint, application decision emails, task emails, deadline notifier |
| `emailAppointments` | Appointment notifications to incubatees, completion notifier cron |
| `emailCampaigns` | Queued mail campaigns, system status broadcast, admin test email, account-creation resends, application-received and compliance-reminder emails |
| `emailDevPlan` | Development plan confirmation reminders, edit-request emails, reminder cron |
| `emailInquiries` | Staff notification when an inquiry is created |
| `emailMov` | MOV workflow emails and a reminder cron |
| `emailBounceWebhook` | Brevo webhook for bounces and suppressions |
| `emailDelivery`, `emailShared`, `emailHelpers`, `brevoClient`, `mail/mailer` | Delivery plumbing, logging and templates |
| `adminTools` | List auth users, cascade email updates, employee account status, cascade user deletion, repair missing intervention records |
| `userManagement` | Create platform users, admin password reset |
| `authFunctions` | Google OAuth start and callback, health check |
| `passwordResetEmail` | Branded password reset mail |
| `workflowEmailFunctions` | Workflow-stage notifications |
| `moaFlag` | Memorandum of agreement flagging |
| `complianceExpiry` | Scheduled compliance expiry checks |
| `syncAssignedInterventions`, `syncCoordinatorPrograms` | Cross-collection consistency syncs |
| `pushNotifications` | Fan-out of notification documents to FCM |
| `whatsappGateway` | HTTP gateway for the WhatsApp bot: identity resolution, appointment lookup, meeting links, accept, decline and reschedule requests |

Email delivery goes through Brevo, with delivery logs and a suppression list stored in
Firestore and surfaced in the admin email monitor.

---

## Backend: AI service

[ai-backend](ai-backend) is a FastAPI application using Google Gemini and Firebase Admin.
It is deployed separately (a Hugging Face Space by default) and called from the browser.

| Endpoint | Purpose |
| --- | --- |
| `GET /health`, `GET /` | Liveness |
| `GET /schema` | Returns the Firestore schema the agent reasons over |
| `POST /chat` | Page-aware assistant; resolves page context and dispatches read-only Firestore tools |
| `POST /api/chat` | WhatsApp conversational entry point |
| `POST /sentiment` | Feedback sentiment analysis |
| `POST /compliance/verify` | Checks an uploaded document against a required-document definition |
| `POST /surveys/extract-questions` | Pulls structured questions out of an uploaded survey file |
| `POST /gap/intervention-mapping` | Maps gap-analysis findings to catalogue interventions |
| `POST /template-detection` | Detects the structure of an uploaded report template |
| `POST /report-writing` | Drafts narrative report blocks |

Supporting modules: `firestore_tools.py` and `firestore_transport.py` for data access,
`page_registry.py` and `tools_dispatcher.py` for page-scoped tool selection,
`schema_registry.py` for the schema description, `gap_mapping.py` for the mapping logic,
and `whatsapp.py` plus `whatsapp_actions.py` for the messaging agent.

---

## Data layer

Firestore is the single source of truth. Access rules are in
[firestore.rules](firestore.rules) and composite indexes in
[firestore.indexes.json](firestore.indexes.json).

Principal collections referenced from application code:

**People and org.** `users`, `participants`, `applications`, `consultants`,
`coordinators`, `operations`, `operationsStaff`, `departments`, `branches`,
`branchAssignmentAudit`, `hrPositions`

**Programme delivery.** `programs`, `programRequirements`, `interventions`,
`assignedInterventions`, `interventionRequests`, `groupInterventionDeliveries`,
`diagnosticPlans`, `dpChangeRequests`, `devPlanEditRequests`, `gapAnalysis`, `linkages`,
`hseJobContracts`

**Scheduling.** `appointments`, `appointmentSessions`, `events`, `attendanceCenters`,
`noticeBoard`, `followUps`

**Intake.** `inquiries`, `inquiryReplies`

**Evidence and compliance.** `movDocuments`, `consolidatedMOVs`, `agreementTemplates`,
`libraryMaterials`, `successStories`, `successStoryAttachments`

**Measurement.** `kpiDefinitions`, `kpiTargets`, `kpiTargetRevisions`,
`kpiTargetAuditLogs`, `monthlyPerformance`, `participantMonthlyMetrics`,
`qualityObjectives`, `operationalChallenges`, `smeFeedback`

**HR and finance.** `leaveRequests`, `timesheets`, `employeePerformanceReviews`,
`employeePerformanceCompacts`, `invoices`, `resources`, `resourceRequests`,
`resourceAllocations`, `projectProposals`, `proposalCounters`

**Forms and system.** `formTemplates`, `departmentForms`, `sentForms`, `tasks`,
`tutorials`, `notifications`, `emailLogs`, `emailSuppressions`, `featureGovernance`,
`governanceMeetings`, `stakeholderEngagements`, `dataExportSettings`, `system_settings`,
`userSessions`, `loginEvents`, `systemErrors`

Firestore runs with a persistent IndexedDB cache and multi-tab coordination. Cache
ownership is guarded per tab in [src/lib/firestoreCache.ts](src/lib/firestoreCache.ts);
a tab that cannot claim the cache falls back to memory. Two consequences callers must
allow for: a query never run while online resolves empty rather than erroring, and rules
are not evaluated locally, so a queued offline write can still be rejected on reconnect.

---

## File storage

Cloud Storage paths and their rules are in [storage.rules](storage.rules):

- `library/{userId}/{fileName}` — library materials
- `intervention-evidence/{programId}/{participantId}/{assignmentId}/{fileName}` — delivery evidence
- `participant_documents/{fileName}` — participant uploads
- `agreements/{participantId}/{fileName}` — signed agreements
- `projectProposals/{companyCode}/{proposalId}/{folder}/{fileName}` — proposal packs
- `feature-releases/{releaseId}/{fileName}` — release note attachments

A path audit lives in [docs/storage-paths-audit.md](docs/storage-paths-audit.md).

---

## Documents and reporting output

Generation happens client-side except where a function needs to attach a file to an email.

| Format | Library | Used for |
| --- | --- | --- |
| Word | `docx`, `docxtemplater`, `pizzip`, `html-docx-js` | Monthly reports, gap reports, templated contracts |
| PDF | `jspdf`, `jspdf-autotable`, `pdfkit` (functions) | Contracts, quality objectives, POEs |
| PowerPoint | `pptxgenjs` | Feature governance decks |
| Excel and CSV | `exceljs`, `xlsx`, `json2csv`, `react-csv` | Data exports |
| Images | `html2canvas`, `html-to-image` | Chart capture inside generated documents |
| Archives | `jszip` | Bundled downloads |

Chart rendering for documents goes through
[src/utils/reportChartRenderer.tsx](src/utils/reportChartRenderer.tsx) and the
`consolidatedReportCharts` and `monthlyReportCharts` helpers.

---

## Offline, PWA and notifications

The app installs as a standalone PWA. The service worker in [src/sw.ts](src/sw.ts) is
hand-written rather than generated, because it also carries the Firebase Cloud Messaging
handlers. Precaching is limited to the app shell and its static vendor chunks. The roughly
two hundred route chunks, images, data and templates are runtime-cached instead, so the
first install stays small. New workers never activate silently. The user is prompted by
[src/components/pwa/UpdatePrompt.tsx](src/components/pwa/UpdatePrompt.tsx).

Push notifications are subscribed via
[src/hooks/usePushNotifications.ts](src/hooks/usePushNotifications.ts) and delivered by the
`onNotificationCreatedPush` function, which fans a Firestore notification document out to
registered FCM tokens.

---

## Running locally

Requires Node 20 for the app and Node 22 for the functions.

```bash
npm install
npm run dev
```

Build and preview the production bundle:

```bash
npm run build
npm run preview
```

Cloud Functions:

```bash
cd functions && npm install && npm run build && npm run serve
```

AI service:

```bash
cd ai-backend && pip install -r requirements.txt && uvicorn app:app --reload --port 8000
```

Point the app at a local AI service by setting `VITE_AI_BACKEND_URL=http://localhost:8000`.

---

## Environment variables

Create a `.env` in the project root. Every `VITE_`-prefixed value is compiled into the
public browser bundle, so nothing secret belongs there.

| Variable | Purpose |
| --- | --- |
| `VITE_AI_BACKEND_URL` | Base URL of the FastAPI AI service |
| `VITE_FIREBASE_VAPID_KEY` | Web push VAPID key for Firebase Cloud Messaging |

Firebase web configuration is not an environment variable. It is checked in at
[src/firebaseConfig.ts](src/firebaseConfig.ts), which is correct: Firebase web config is
public by design and access is governed by the rules files.

Server-side configuration for the functions is read from the Firebase environment, notably
`APP_BASE_URL` and the Brevo credentials. The AI service reads its Gemini credentials and
Firebase Admin credentials from its own environment.

---

## Deployment

**Frontend** deploys to Vercel. [vercel.json](vercel.json) sets the Vite build, rewrites
all paths to `index.html` for client-side routing, and forces revalidation on `sw.js` and
the web manifest so an update prompt is never blocked by a cached worker.

**Functions, rules and indexes** deploy through the Firebase CLI using
[firebase.json](firebase.json). The functions codebase builds with `tsc` as a predeploy
step.

```bash
firebase deploy --only functions
```

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

**AI service** deploys independently to its own host.

---

## Repository layout

```
src/
  App.tsx              Route tree, providers, lazy route loading
  main.tsx             Entry point
  routes/              ~190 route modules, grouped by role
  components/          Shared UI, dashboards, guards, layout, modals
  services/            Domain logic, framework-free
  providers/           Refine auth, data and live providers
  contexts/            Identity, theme, login prompt, SME jobs
  hooks/               Auth, identity, push, branch hours
  lib/                 Cross-cutting helpers and Firestore cache management
  utils/               Report builders, document generation, navigation
  types/               Shared domain types
  firebase.ts          SDK initialisation
  sw.ts                Service worker
functions/src/         Cloud Functions
ai-backend/            FastAPI AI service
docs/                  PRDs, delivery tasks, user guides, troubleshooting
scripts/               One-off migration and repair scripts
public/                Static assets, icons, templates
firestore.rules        Authorisation rules
storage.rules          Storage authorisation rules
```

---

## Maintenance scripts

[scripts](scripts) holds guarded one-off migrations and repairs, each of which writes a
JSON report next to itself so a run can be audited or reverted. They cover duplicate
consolidated MOVs, swapped MOV department names, appointment-to-assignment link repair,
split appointment session merges, group intervention delivery migration, missing
intervention reference repair, pre-incubation signing reverts, and zero-complete progress
cleanup. Several have matching revert scripts and backup files.

The only one wired into npm:

```bash
npm run sync:intervention-records
```

These scripts use Firebase Admin credentials and bypass security rules. Read the script and
take a backup before running one against production.

---

## Security notes

- Authorisation lives entirely in `firestore.rules` and `storage.rules`. Any new collection
  needs a matching rule; the default is deny.
- The client never holds privileged credentials. Anything requiring the Admin SDK belongs in
  a Cloud Function.
- Anything prefixed `VITE_` is public. Treat the built bundle as readable by anyone.
- Admin service account keys must never be committed. Keep them out of the tree or covered
  by `.gitignore` before pushing.
