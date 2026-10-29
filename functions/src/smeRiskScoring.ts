import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "./firebase";
import { suppressRecordNotifications } from "./syntheticData";
import { assessComplianceDocuments, loadComplianceContext } from "./complianceExpiry";
import { departmentIdsForRole } from "./departmentRoles";
import { notifyInApp } from "./inAppNotifications";
import {
  RiskLevel,
  computeRiskScore,
  deriveRiskInputs,
  riskTrend,
  shouldAlert,
  suggestNextStep,
} from "./smeRiskLogic";

/**
 * Nightly SME early warning. Scores every SME with an accepted application using
 * the register's formula plus the early-warning signals (smeRiskLogic.ts), saves
 * smeRiskSnapshots/{participantId} with the reasons, trend, suggested next step and
 * a short history, and alerts the people who support an SME when it moves up into
 * High or Critical. The snapshot's previous level is the ledger: an SME that stays
 * at the same level is never alerted twice.
 */

const SNAPSHOTS = "smeRiskSnapshots";
const HISTORY_LENGTH = 12;
const BATCH_SIZE = 400;

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();

const groupBy = <T>(rows: T[], key: (row: T) => string) => {
  const out = new Map<string, T[]>();
  rows.forEach((row) => {
    const id = key(row);
    if (!id) return;
    const list = out.get(id) || [];
    list.push(row);
    out.set(id, list);
  });
  return out;
};

const monthOf = (row: any) => {
  const source = clean(row.sourceMonth);
  if (/^\d{4}-\d{2}$/.test(source)) return source;
  const date = row.createdAt?.toDate?.();
  return date ? date.toISOString().slice(0, 7) : "";
};

export async function runSmeRiskScoring(now = new Date()) {
  const [
    applicationsSnapshot,
    participantsSnapshot,
    assignmentsSnapshot,
    appointmentsSnapshot,
    metricsSnapshot,
    followUpsSnapshot,
    queriesSnapshot,
    suppressionsSnapshot,
    snapshotsSnapshot,
    usersSnapshot,
    compliance,
    romDepartmentIds,
  ] = await Promise.all([
    db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"]).get(),
    db.collection("participants").get(),
    db.collection("assignedInterventions").get(),
    db.collection("appointments").get(),
    db.collection("participantMonthlyMetrics").get(),
    db.collection("outcomeFollowUps").where("dueAt", "<=", admin.firestore.Timestamp.fromDate(now)).get(),
    db.collection("workflowQueries").where("status", "in", ["open", "answered"]).get(),
    db.collection("emailSuppressions").get(),
    db.collection(SNAPSHOTS).get(),
    db.collection("users").get(),
    loadComplianceContext(),
    departmentIdsForRole("rom"),
  ]);

  const participants = new Map(participantsSnapshot.docs.map((doc) => [doc.id, doc.data() as any]));
  const assignments = groupBy(assignmentsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() as any })), (row) => clean(row.participantId));
  const appointments = groupBy(appointmentsSnapshot.docs.map((doc) => doc.data() as any), (row) => clean(row.smeId));
  const metrics = groupBy(metricsSnapshot.docs.map((doc) => doc.data() as any), (row) => clean(row.participantId));
  const followUps = groupBy(followUpsSnapshot.docs.map((doc) => doc.data() as any), (row) => clean(row.participantId));
  const queries = groupBy(queriesSnapshot.docs.map((doc) => doc.data() as any), (row) => clean(row.context?.participantId));
  const bounced = new Set(suppressionsSnapshot.docs.map((doc) => clean(doc.data().participantId)).filter(Boolean));
  const previous = new Map(snapshotsSnapshot.docs.map((doc) => [doc.id, doc.data() as any]));

  const users = usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() as any }))
    .filter((user) => !["inactive", "disabled", "deleted"].includes(lower(user.status)));
  const uidOf = (user: any) => clean(user.uid) || user.id;
  const userById = new Map(users.map((user) => [user.id, user]));
  const romHeads = users
    .filter((user) => lower(user.role) === "operations" && romDepartmentIds.includes(clean(user.departmentId)))
    .map(uidOf);
  const programCoordinators = (programId: string) => users
    .filter((user) => ["coordinator", "projectadmin"].includes(lower(user.role)))
    .filter((user) => Array.isArray(user.assignedPrograms) && user.assignedPrograms.map(clean).includes(programId))
    .map(uidOf);

  // One accepted application per SME: the most recently updated.
  const applicationByParticipant = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of applicationsSnapshot.docs) {
    const participantId = clean(doc.data().participantId);
    if (!participantId) continue;
    const current = applicationByParticipant.get(participantId);
    const time = (snapshot: FirebaseFirestore.QueryDocumentSnapshot) =>
      snapshot.data().updatedAt?.toMillis?.() ?? snapshot.updateTime.toMillis();
    if (!current || time(doc) > time(current)) applicationByParticipant.set(participantId, doc);
  }

  const writes: { id: string; data: Record<string, unknown> }[] = [];
  const alerts: { participantId: string; name: string; level: RiskLevel; reasons: string[]; recipients: string[]; programId: string }[] = [];
  const dateKey = now.toISOString().slice(0, 10);

  for (const [participantId, applicationDoc] of applicationByParticipant) {
    const application = applicationDoc.data() as any;
    if (suppressRecordNotifications(application, applicationDoc.id)) continue;
    const participant = participants.get(participantId) || {};
    if (suppressRecordNotifications(participant, participantId)) continue;
    const programId = clean(application.programId);

    const embedded = Array.isArray(participant.complianceDocuments) && participant.complianceDocuments.length
      ? participant.complianceDocuments
      : Array.isArray(application.complianceDocuments) ? application.complianceDocuments : [];
    const { counts } = assessComplianceDocuments(
      [...embedded, ...(compliance.subcollectionDocuments.get(applicationDoc.id) || [])],
      compliance.requirementsFor(programId),
      now
    );

    const smeAssignments = assignments.get(participantId) || [];
    const inputs = deriveRiskInputs({
      assignments: smeAssignments,
      appointments: appointments.get(participantId) || [],
      monthlyRevenue: (metrics.get(participantId) || [])
        .map((row) => ({ month: monthOf(row), revenue: Number(row.monthlyRevenue) }))
        .filter((row) => row.month && Number.isFinite(row.revenue)),
      followUps: followUps.get(participantId) || [],
      openQueries: (queries.get(participantId) || []).length,
      emailBounced: bounced.has(participantId),
      compliance: counts,
    }, now.getTime());

    const result = computeRiskScore(inputs);
    const before = previous.get(participantId);
    const reasons = result.breakdown.filter((item) => item.delta > 0 && item.label !== "Recently serviced");
    const suggestion = suggestNextStep(result);

    // People who support this SME: its active assignees plus the programme's coordinators.
    const assigneeUids = Array.from(new Set(smeAssignments
      .filter((row) => !["cancelled", "completed"].includes(lower(row.assignmentStatus)))
      .map((row) => {
        const user = userById.get(clean(row.assigneeId));
        return user ? uidOf(user) : clean(row.assigneeId);
      })
      .filter(Boolean)));
    const ownerIds = Array.from(new Set([...assigneeUids, ...programCoordinators(programId)]));

    const history = [
      ...(Array.isArray(before?.history) ? before.history : []).filter((entry: any) => entry?.date !== dateKey),
      { date: dateKey, score: result.score, level: result.level },
    ].slice(-HISTORY_LENGTH);

    writes.push({
      id: participantId,
      data: {
        participantId,
        participantName: clean(participant.beneficiaryName) || clean(participant.companyName) || clean(participant.name) || clean(application.beneficiaryName) || "SME",
        programId: programId || null,
        score: result.score,
        level: result.level,
        previousScore: typeof before?.score === "number" ? before.score : null,
        previousLevel: before?.level || null,
        trend: riskTrend(before?.score, result.score),
        reasons: reasons.map((item) => ({ label: item.label, points: item.delta, driver: item.key || null })),
        suggestion,
        ownerIds,
        inputs,
        history,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
        // A level only counts as alerted once someone has actually been told.
        alertedLevel: before?.alertedLevel || null,
      },
    });

    // The first score for an SME is a baseline, not news: alerting on it would flood
    // everyone with every already-high SME the first night the job runs.
    if (before && shouldAlert(before.level || null, result.level)) {
      alerts.push({
        participantId,
        name: clean(participant.beneficiaryName) || clean(participant.companyName) || "An SME",
        level: result.level,
        reasons: reasons.slice(0, 3).map((item) => item.label),
        recipients: Array.from(new Set([...ownerIds, ...romHeads])),
        programId,
      });
    }
  }

  for (let offset = 0; offset < writes.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    writes.slice(offset, offset + BATCH_SIZE).forEach(({ id, data }) => batch.set(db.collection(SNAPSHOTS).doc(id), data));
    await batch.commit();
  }

  for (const alert of alerts) {
    await notifyInApp({
      type: "sme_risk_rising",
      message: `${alert.name} is now ${alert.level} risk: ${alert.reasons.join("; ")}.`,
      recipientIds: alert.recipients,
      participantId: alert.participantId,
      participantName: alert.name,
      programId: alert.programId || null,
      link: "/operations/participants/risk",
    });
    await db.collection(SNAPSHOTS).doc(alert.participantId).update({ alertedLevel: alert.level, alertedAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  return { scored: writes.length, alerted: alerts.length };
}

export const smeRiskScoringCron = onSchedule(
  {
    region: "us-central1",
    schedule: "0 6 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
  },
  async () => {
    const heartbeatRef = db.collection("systemHeartbeats").doc("smeRiskScoringCron");
    try {
      const result = await runSmeRiskScoring();
      logger.info("sme_risk_scoring.done", result);
      await heartbeatRef.set({ lastRunAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "ok", ...result }, { merge: true });
    } catch (error) {
      logger.error("sme_risk_scoring.failed", { error: String(error) });
      await heartbeatRef.set(
        { lastRunAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: String(error) },
        { merge: true }
      );
      throw error;
    }
  }
);
