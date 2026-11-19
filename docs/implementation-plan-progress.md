# Implementation plan progress review

The Documentation Hub's **Check Progress** action sends the selected saved document ID to `POST /plans/check-progress`. The request uses a Firebase bearer token; it does not send client-supplied delivery totals or file URLs.

The AI backend authenticates the user, checks programme/department access, downloads the current saved plan from the same Firebase project's Storage bucket, and reads programme-scoped Firestore records. It filters those records to the plan's department before sending a compact snapshot to Gemini. This review does not modify documents, delivery records or validation status.

## Result

- Short assessment and milestone status distribution.
- Recorded assignment completion and MOV approval totals, explicitly separate from plan completion.
- Plan excerpts, targets, due dates and date-confidence labels for each milestone.
- Supporting record references, next steps and evidence limitations.
- Reviewer output is normalized: unknown references are discarded; unsupported completion claims become Needs evidence; planned development-plan entries cannot prove completion.

Sources are `assignedInterventions`, `movDocuments`, `consolidatedMOVs`, `groupInterventionDeliveries`, `diagnosticPlans` and `appointmentSessions`. Each programme query is bounded to 3,001 records to detect truncation; up to 200 matching details per collection are supplied to AI. Sampling is disclosed and prevents an overall green result. The plan's own file is read; attachments to delivery records are not read or independently verified.

## Deployment

Deploy the frontend and updated `ai-backend` together. The backend needs its existing `FIREBASE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY` and optional `GEMINI_MODEL` configuration. The service account needs read access to Firestore and the implementation-plan Storage objects. Its Firebase project must match the frontend. No new Python package or Firestore index is required.

The UI uses the existing `VITE_AI_BACKEND_URL`. Unsupported/oversized documents, unavailable AI, permission failures, timeouts and missing live data produce explicit retryable errors rather than fabricated progress. The current document reader supports PDF, DOCX, PPTX, images and text; legacy DOC/XLS and Excel plans should be exported to PDF first.

## Checks

From `ai-backend`: `py -3.12 -m unittest test_plan_progress test_plan_progress_endpoint -v` (or the deployment environment's Python executable).

Endpoint tests mock storage, authentication and model responses; they do not verify a live Gemini response or deployment.
