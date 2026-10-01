import * as logger from "firebase-functions/logger";
import { onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "./emailShared";
import { participant as resolveParticipant } from "./workflowEmailFunctions";
import {
  deriveConfidence,
  dueAtFrom,
  followUpDays,
  hasDeliverableFile,
  isConfirmed,
  isFacilitatorAnswer,
  isSmeAnswer,
  shouldEscalate,
  shouldRemind,
  smeToAssessment,
} from "./outcomeFollowUpLogic";

// Outcome check-backs.
//
//   1. When an assignment is confirmed and its intervention asks for a
//      check-back, outcomeFollowUps/{assignmentId} is created with the due
//      date and a frozen copy of what was intended.
//   2. A daily cron reminds the facilitator (in-app + email, both with
//      one-tap answer buttons) once it is due, and the SME too if the HOD
//      asked for that. The HOD is told if it is still unanswered.
//   3. Answers arrive as a patch on the follow-up doc (from the bell, an
//      email link, or the Check-backs page). The trigger below turns each
//      answer into an append-only outcomeAssessments record and updates the
//      summary cached on the assignment. Clients never write assessments.

const REGION = "us-central1";
const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();

const asDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
};

async function resolveAssignee(assignment: any): Promise<{ email: string; name: string }> {
  const id = clean(assignment.assigneeId);
  let email = lower(assignment.assigneeEmail);
  let name = clean(assignment.assigneeName);
  if (id && !email.includes("@")) {
    for (const collection of ["users", "coordinators", "operationsStaff"]) {
      const snap = await db.collection(collection).doc(id).get();
      const data = snap.data() as any;
      if (data?.email) {
        email = lower(data.email);
        name = name || clean(data.name || data.fullName);
        break;
      }
    }
  }
  return { email: email.includes("@") ? email : "", name: name || "Facilitator" };
}

async function findIncubateeUid(email: string | null): Promise<string | null> {
  if (!email) return null;
  const snap = await db.collection("users").where("email", "==", lower(email)).limit(5).get();
  const match = snap.docs.find((doc) => lower((doc.data() as any).role) === "incubatee");
  return match ? match.id : null;
}

/** 1. Schedule the check-back when the work is confirmed. */
export const onAssignmentConfirmedScheduleFollowUp = onDocumentWritten(
  { region: REGION, document: "assignedInterventions/{assignmentId}" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data() as any;
    if (!after || isConfirmed(before) || !isConfirmed(after)) return;

    const assignmentId = event.params.assignmentId;
    const ref = db.collection("outcomeFollowUps").doc(assignmentId);
    if ((await ref.get()).exists) return;

    const interventionId = clean(after.interventionId);
    if (!interventionId) return;
    const intervention = (await db.collection("interventions").doc(interventionId).get()).data() as any;
    // Prefer what the assignment was created with; fall back to the live definition for older assignments.
    const def = after.definitionSnapshot?.outcomeDef || intervention?.outcomeDef;
    if (!def?.followUp?.required || !clean(def.intendedOutcome)) return;

    const base = asDate(after.participantConfirmedAt) || asDate(after.completedAt) || new Date();
    const days = followUpDays(def);
    const assignee = await resolveAssignee(after);
    const smeContact = await resolveParticipant({ participantId: after.participantId });

    await ref.set({
      assignedInterventionId: assignmentId,
      participantId: clean(after.participantId),
      participantName: clean(after.participantName),
      participantEmail: smeContact.email ? lower(smeContact.email) : "",
      interventionId,
      interventionTitle: clean(after.interventionTitle),
      programId: clean(after.programId) || null,
      departmentId: clean(after.departmentId) || clean(intervention?.departmentId) || null,
      assigneeId: clean(after.assigneeId),
      assigneeName: assignee.name,
      assigneeEmail: assignee.email,
      deliverableName: clean(def.deliverable?.name),
      intendedOutcome: clean(def.intendedOutcome),
      outcomeType: clean(def.outcomeType),
      smeCheckIn: def.followUp.smeCheckIn === true,
      afterDays: days,
      dueAt: admin.firestore.Timestamp.fromDate(dueAtFrom(base, days)),
      status: "scheduled",
      remindersSent: 0,
      lastRemindedAt: null,
      smeNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info("outcomeFollowUp.scheduled", { assignmentId, days });
  }
);

const facilitatorActions = () => [
  { actionId: "achieved", label: "Achieved", style: "primary", patch: { answer: "achieved" } },
  { actionId: "partial", label: "Partially", style: "default", patch: { answer: "partial" } },
  { actionId: "not_yet", label: "Not yet", style: "danger", patch: { answer: "not_yet" } },
];

const smeActions = () => [
  { actionId: "yes", label: "Yes, still using it", style: "primary", patch: { smeAnswer: "yes" } },
  { actionId: "partly", label: "Partly", style: "default", patch: { smeAnswer: "partly" } },
  { actionId: "no", label: "No", style: "danger", patch: { smeAnswer: "no" } },
];

/** 2. Daily reminders. */
export const outcomeFollowUpReminderCron = onSchedule(
  {
    region: REGION,
    schedule: "30 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    // Single-field range query (no composite index); status is filtered below.
    const snapshot = await db.collection("outcomeFollowUps")
      .where("dueAt", "<=", admin.firestore.Timestamp.fromDate(now))
      .get();

    let reminded = 0;
    for (const snap of snapshot.docs) {
      const f = snap.data() as any;
      const state = {
        status: f.status,
        dueAt: asDate(f.dueAt),
        remindersSent: Number(f.remindersSent || 0),
        lastRemindedAt: asDate(f.lastRemindedAt),
      };
      if (f.answer || !shouldRemind(state, now)) continue;

      const sent = state.remindersSent + 1;
      const what = clean(f.deliverableName) || clean(f.interventionTitle) || "the intervention";
      const notificationRef = await db.collection("notifications").add({
        type: "outcome_follow_up",
        message: `Check-back due: has ${clean(f.participantName) || "the SME"} kept up the change from ${clean(f.interventionTitle)}? ${clean(f.intendedOutcome)}`,
        recipientIds: [clean(f.assigneeId)],
        recipientEmail: clean(f.assigneeEmail),
        recipientName: clean(f.assigneeName),
        participantId: clean(f.participantId),
        participantName: clean(f.participantName),
        interventionTitle: clean(f.interventionTitle),
        deliverableName: what,
        intendedOutcome: clean(f.intendedOutcome),
        programId: f.programId || null,
        actionTarget: { collection: "outcomeFollowUps", docId: snap.id },
        actions: facilitatorActions(),
        link: "/coordinator/check-backs",
        reminderNumber: sent,
        createdAt: new Date(),
        readBy: {},
      });

      const patch: Record<string, unknown> = {
        status: "due",
        remindersSent: sent,
        lastRemindedAt: admin.firestore.FieldValue.serverTimestamp(),
        notificationIds: admin.firestore.FieldValue.arrayUnion(notificationRef.id),
      };

      if (f.smeCheckIn === true && f.smeNotified !== true && !f.smeAnswer) {
        const smeUid = await findIncubateeUid(f.participantEmail);
        const smeRef = await db.collection("notifications").add({
          type: "outcome_follow_up_sme",
          message: `A quick question about ${clean(f.interventionTitle)}: are you still using what you put in place?`,
          recipientIds: smeUid ? [smeUid] : [],
          participantId: clean(f.participantId),
          participantName: clean(f.participantName),
          interventionTitle: clean(f.interventionTitle),
          deliverableName: what,
          intendedOutcome: clean(f.intendedOutcome),
          programId: f.programId || null,
          actionTarget: { collection: "outcomeFollowUps", docId: snap.id },
          actions: smeActions(),
          link: "/incubatee/interventions",
          createdAt: new Date(),
          readBy: {},
        });
        patch.smeNotified = true;
        patch.smeNotificationId = smeRef.id;
      }

      if (shouldEscalate(sent)) {
        const hods = await db.collection("users")
          .where("departmentId", "==", clean(f.departmentId))
          .get();
        const hodUids = hods.docs
          .filter((d) => lower((d.data() as any).role) === "operations")
          .map((d) => d.id);
        if (hodUids.length) {
          await db.collection("notifications").add({
            type: "outcome_follow_up_overdue",
            message: `Check-back still unanswered after ${sent} reminders: ${clean(f.interventionTitle)} for ${clean(f.participantName)} (facilitator: ${clean(f.assigneeName)}).`,
            recipientIds: hodUids,
            participantId: clean(f.participantId),
            programId: f.programId || null,
            link: "/coordinator/check-backs",
            createdAt: new Date(),
            readBy: {},
          });
        }
      }

      await snap.ref.update(patch);
      reminded += 1;
    }

    logger.info("outcomeFollowUpReminderCron.complete", { scanned: snapshot.size, reminded });
  }
);

/** 3. Turn answers into append-only assessments and refresh the cached summary. */
export const onOutcomeFollowUpAnswered = onDocumentUpdated(
  { region: REGION, document: "outcomeFollowUps/{followUpId}" },
  async (event) => {
    const before = (event.data?.before.data() || {}) as any;
    const after = (event.data?.after.data() || {}) as any;
    const followUpId = event.params.followUpId;
    const ref = event.data!.after.ref;
    const assignmentRef = db.collection("assignedInterventions").doc(clean(after.assignedInterventionId));

    const base = {
      followUpId,
      assignedInterventionId: clean(after.assignedInterventionId),
      participantId: clean(after.participantId),
      participantName: clean(after.participantName),
      interventionId: clean(after.interventionId),
      interventionTitle: clean(after.interventionTitle),
      programId: after.programId || null,
      departmentId: after.departmentId || null,
      kind: "follow_up",
      at: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!before.answer && isFacilitatorAnswer(after.answer)) {
      const answeredBy = clean(after.answeredBy) || clean(after.assigneeId);
      const byRole = answeredBy === clean(after.assigneeId) ? "facilitator" : "hod";
      const assignment = ((await assignmentRef.get()).data() || {}) as any;
      const confidence = deriveConfidence({ byRole, hasDeliverable: hasDeliverableFile(assignment.resources) });
      const evidence = hasDeliverableFile(assignment.resources)
        ? [{ sourceType: "deliverable", sourceRef: { collection: "assignedInterventions", id: assignmentRef.id } }]
        : [];

      await db.collection("outcomeAssessments").add({
        ...base,
        assessment: after.answer,
        note: clean(after.answerNote).slice(0, 1000),
        by: answeredBy,
        byRole,
        via: clean(after.answeredVia) || "notification",
        confidence,
        evidence,
      });
      await assignmentRef.set({
        outcome: {
          status: after.answer,
          confidence,
          lastAssessedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
      await ref.update({
        status: "answered",
        answeredAt: admin.firestore.FieldValue.serverTimestamp(),
        answeredBy,
      });
      logger.info("outcomeFollowUp.answered", { followUpId, answer: after.answer, byRole });
    }

    if (!before.smeAnswer && isSmeAnswer(after.smeAnswer)) {
      await db.collection("outcomeAssessments").add({
        ...base,
        assessment: smeToAssessment(after.smeAnswer),
        smeAnswer: after.smeAnswer,
        note: "",
        by: clean(after.participantId),
        byRole: "sme",
        via: "notification",
        confidence: deriveConfidence({ byRole: "sme", hasDeliverable: false }),
        evidence: [],
      });
      // The SME's view sits beside the facilitator's; it never overwrites it.
      await assignmentRef.set({
        outcome: { smeStatus: smeToAssessment(after.smeAnswer), smeAssessedAt: admin.firestore.FieldValue.serverTimestamp() },
      }, { merge: true });
      await ref.update({ smeAnsweredAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }
);
