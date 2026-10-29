import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { admin, db } from "./firebase";
import { isSyntheticData } from "./syntheticData";
import { ImpactSme, ImpactTreatment, measureAll } from "./impactLogic";

/**
 * Monthly "which interventions are working" job. Reads revenue (QuantNow sync in
 * participantMonthlyMetrics, falling back to the SME's own monthlyPerformance
 * history), SME-confirmed completions and their check-back outcomes, and writes one
 * interventionImpact/{programId}__{interventionId} document per pair with the
 * measured lift (impactLogic.ts). Demo (seeded) data is included and marked
 * `demo: true`, so the method can be proven on the test project and the same code
 * reports real results once real revenue arrives.
 */

const RESULTS = "interventionImpact";
const BATCH_SIZE = 400;
const REFRESH_ROLES = ["system_admin", "superadmin", "director", "operations"];

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const isMonth = (value: string) => /^\d{4}-\d{2}$/.test(value);

const monthOfDate = (value: any): string => {
  const date = value?.toDate?.() ?? (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 7) : "";
};

const SME_CONFIRMED = ["confirmed", "done", "completed"];
const OUTCOMES = ["achieved", "partial", "not_yet"];

export async function runInterventionImpact() {
  const [applicationsSnapshot, participantsSnapshot, metricsSnapshot, historySnapshot, assignmentsSnapshot] = await Promise.all([
    db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"]).get(),
    db.collection("participants").get(),
    db.collection("participantMonthlyMetrics").get(),
    db.collectionGroup("history").get(),
    db.collection("assignedInterventions").get(),
  ]);

  const participants = new Map(participantsSnapshot.docs.map((doc) => [doc.id, doc.data() as any]));

  const revenue = new Map<string, Record<string, number>>();
  const put = (participantId: string, month: string, value: number, overwrite: boolean) => {
    if (!participantId || !isMonth(month) || !Number.isFinite(value)) return;
    const series = revenue.get(participantId) || {};
    if (overwrite || series[month] === undefined) series[month] = value;
    revenue.set(participantId, series);
  };
  // QuantNow is the system of record; the SME's own report only fills gaps.
  metricsSnapshot.docs.forEach((doc) => {
    const row = doc.data() as any;
    const month = isMonth(clean(row.sourceMonth)) ? clean(row.sourceMonth) : monthOfDate(row.createdAt);
    put(clean(row.participantId), month, Number(row.monthlyRevenue), true);
  });
  historySnapshot.docs.forEach((doc) => {
    const parent = doc.ref.parent.parent;
    if (!parent || parent.parent.id !== "monthlyPerformance") return;
    const row = doc.data() as any;
    const month = isMonth(clean(row.month)) ? clean(row.month) : monthOfDate(row.createdAt);
    if (row.revenue !== undefined && row.revenue !== null) put(parent.id, month, Number(row.revenue), false);
  });

  const smes: ImpactSme[] = [];
  const programOf = new Map<string, string>();
  for (const doc of applicationsSnapshot.docs) {
    const application = doc.data() as any;
    const participantId = clean(application.participantId);
    const programId = clean(application.programId);
    if (!participantId || !programId || programOf.has(participantId)) continue;
    programOf.set(participantId, programId);
    const participant = participants.get(participantId) || {};
    smes.push({
      id: participantId,
      programId,
      sector: lower(participant.sector || participant.industry),
      synthetic: isSyntheticData(participant, participantId) || isSyntheticData(application, doc.id),
      revenue: revenue.get(participantId) || {},
    });
  }

  const treatments: ImpactTreatment[] = [];
  for (const doc of assignmentsSnapshot.docs) {
    const row = doc.data() as any;
    if (!SME_CONFIRMED.includes(lower(row.participantCompletionStatus))) continue;
    const participantId = clean(row.participantId);
    const interventionId = clean(row.interventionId);
    const month = monthOfDate(row.completedAt || row.assigneeCompletedAt || row.updatedAt);
    const programId = clean(row.programId) || programOf.get(participantId) || "";
    if (!participantId || !interventionId || !month || !programId) continue;
    const outcome = lower(row.outcome?.status);
    treatments.push({
      participantId,
      programId,
      interventionId,
      interventionTitle: clean(row.interventionTitle) || interventionId,
      month,
      outcome: OUTCOMES.includes(outcome) ? outcome as ImpactTreatment["outcome"] : null,
    });
  }

  const results = measureAll(smes, treatments);
  const runId = new Date().toISOString();
  const keep = new Set(results.map((result) => `${result.programId}__${result.interventionId}`));

  const writes = results.map((result) => ({
    ref: db.collection(RESULTS).doc(`${result.programId}__${result.interventionId}`),
    data: { ...result, runId, computedAt: admin.firestore.FieldValue.serverTimestamp() },
  }));
  const stale = (await db.collection(RESULTS).get()).docs.filter((doc) => !keep.has(doc.id));
  for (let offset = 0; offset < writes.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    writes.slice(offset, offset + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
  for (let offset = 0; offset < stale.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    stale.slice(offset, offset + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const summary = {
    pairs: results.length,
    reportable: results.filter((result) => result.status === "reportable").length,
    early: results.filter((result) => result.status === "early").length,
    smesWithRevenue: smes.filter((sme) => Object.keys(sme.revenue).length > 0).length,
    completions: treatments.length,
    runId,
  };
  await db.collection("systemHeartbeats").doc("interventionImpact").set({
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    lastStatus: "ok",
    ...summary,
  }, { merge: true });
  return summary;
}

export const interventionImpactCron = onSchedule(
  {
    region: "us-central1",
    schedule: "30 5 1 * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
  },
  async () => {
    try {
      logger.info("intervention_impact.done", await runInterventionImpact());
    } catch (error) {
      logger.error("intervention_impact.failed", { error: String(error) });
      await db.collection("systemHeartbeats").doc("interventionImpact").set({
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastStatus: "failed",
        lastError: String(error),
      }, { merge: true });
      throw error;
    }
  }
);

/** Lets a manager recompute now instead of waiting for the 1st of the month. */
export const refreshInterventionImpact = onCall(
  {
    region: "us-central1",
    cors: ["http://localhost:5173", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"],
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in again.");
    const user = (await db.collection("users").doc(request.auth.uid).get()).data();
    const role = lower(user?.role || request.auth.token?.role).replace(/\s+/g, "_");
    if (!REFRESH_ROLES.includes(role)) throw new HttpsError("permission-denied", "Only managers can refresh impact results.");
    return runInterventionImpact();
  }
);
