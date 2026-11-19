# SME incubation status

SME Overview now offers Active, Inactive, Dormant and Potential Exit, with status filtering, a change-status dialog and a required audit reason. Inactive is a temporary participation pause; Dormant is a longer-term pause. Staff choose these two statuses; no unapproved time thresholds distinguish them. Previously exited SMEs retain Exited but it is not offered as a new manual status.

The countdown uses actual recorded participation in the application's programme: attended appointments, individual session attendance on assignments, completed individual interventions, and participant-confirmed completion. Scheduled meetings, absent attendees, cancelled work, copied group completion and generic record edits do not count. Unscoped legacy activity is accepted when linked to the same SME/application.

At 80 complete days without participation, the SME moves to Potential Exit. At 90 days it becomes qualified for exit review, with no automatic exit. If there is no participation history, acceptance/joining/creation supplies a clearly labelled onboarding baseline. Missing or invalid dates pause automatic qualification. A manual status change does not reset the clock. New participation restores Active; corrections and deleted attendance are recalculated from source records.

Statuses are stored per application, to avoid mixing programme enrolments. The status change, reason, actor, timestamp and activity used for the decision are retained on the application. ROM/onboarding staff and system administrators can use the callable. External SME accounts cannot directly edit these lifecycle fields.

The daily job runs at 06:00 Africa/Johannesburg; appointment and assignment writes refresh affected SMEs sooner. The list also calculates current status from loaded activity. Excel imports distinguish Inactive from Dormant. New manual SMEs default to Active.

The Dummy toolbar action, modal, generation helper and dummy-only delete action have been removed. Existing Firestore records are untouched by this source change.

## Deployment

Deploy Firestore rules and these functions before releasing the frontend:

- setSmeIncubationStatus
- onSmeAssignmentActivity
- onSmeAppointmentActivity
- smeIncubationStatusCron

The preceding acceptance-email feature additionally requires onApplicationDecisionEmail. Nothing in this task deploys services or sends emails.

## Verification

Run `node --test functions/src/smeIncubationLogic.test.cjs functions/src/smeIncubationStatus.test.cjs functions/src/smeIncubationImport.test.cjs` for boundary dates, activity evidence, recovery, permission enforcement, import normalisation and filtering. Authenticated browser and live scheduler verification remain deployment checks.
