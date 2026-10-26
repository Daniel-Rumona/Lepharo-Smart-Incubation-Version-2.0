import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "./firebase";
import {
  buildTwinRecord,
  comparePeers,
  getParticipantId,
  peerProfileOf,
  TWIN_STAFF_ROLES,
  type AnyDoc,
  type DigitalTwinRecord,
  type PeerProfile,
  type TwinSources,
} from "./twin/rules";

// Digital twin: one record per SME per programme application, recalculated
// every night from data the platform already holds (see the Digital Twin Build
// Plan). Every number comes from ./twin/rules, the same code the web app's live
// twin screen runs, so a saved record and the screen can never disagree.
//
//   digitalTwins/{participantId}_{programId}             today's record
//   digitalTwins/{participantId}_{programId}/days/{date} one record per day
//
// Past days are never edited. A recalculation only replaces today's day record.
// Only this server code writes; firestore.rules lets staff read and no browser write.

const TWINS = "digitalTwins";
const BATCH_WRITE_SIZE = 200; // two writes per twin: current record and its day record

const STAFF_ROLES = new Set(TWIN_STAFF_ROLES);

// Same reminder types the Risk Register counts as contact with the SME.
const REMINDER_EMAIL_TYPES = [
  "DEV_PLAN_SME_REMINDER",
  "INTERVENTION_REMINDER",
  "COMPLIANCE_REMINDER",
  "COMPLIANCE_EXPIRY_REMINDER",
];

const clean = (value: unknown) => String(value ?? "").trim();

const isAcceptedApplication = (application: AnyDoc) =>
  clean(application.applicationStatus || application.decision?.status).toLowerCase() === "accepted";

const docsOf = (snapshot: FirebaseFirestore.QuerySnapshot): AnyDoc[] =>
  snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as AnyDoc) }));

const groupBy = (items: AnyDoc[], keyOf: (item: AnyDoc) => string | string[]) => {
  const groups = new Map<string, AnyDoc[]>();
  items.forEach((item) => {
    const keys = ([] as string[]).concat(keyOf(item)).map(clean).filter(Boolean);
    keys.forEach((key) => {
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    });
  });
  return groups;
};

/** Firestore rejects undefined; records are plain JSON, so round-trip them. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type SourceIndex = {
  participants: Map<string, AnyDoc>;
  programs: Map<string, AnyDoc>;
  departments: AnyDoc[];
  assignments: Map<string, AnyDoc[]>;
  plans: Map<string, AnyDoc[]>;
  movs: Map<string, AnyDoc[]>;
  compliance: Map<string, AnyDoc[]>;
  challenges: Map<string, AnyDoc[]>;
  reminders: Map<string, AnyDoc[]>;
  metrics: Map<string, AnyDoc[]>;
  jobs: Map<string, AnyDoc[]>;
};

function sourcesFor(application: AnyDoc, index: SourceIndex): TwinSources {
  const participantId = getParticipantId(application);
  return {
    application,
    participant: index.participants.get(participantId) || {},
    program: index.programs.get(clean(application.programId)) || null,
    diagnosticPlans: index.plans.get(participantId) || [],
    assignments: index.assignments.get(participantId) || [],
    departments: index.departments,
    movs: index.movs.get(participantId) || [],
    complianceUploads: index.compliance.get(clean(application.id)) || [],
    challenges: index.challenges.get(participantId) || [],
    reminderEmails: index.reminders.get(participantId) || [],
    monthlyMetrics: index.metrics.get(participantId) || [],
    jobContracts: index.jobs.get(participantId) || [],
  };
}

/** Reads every source collection once and groups by SME, instead of querying per SME. */
async function loadAllSources(): Promise<{ applications: AnyDoc[]; index: SourceIndex }> {
  const [
    applications,
    participants,
    programs,
    departments,
    assignments,
    plans,
    movs,
    compliance,
    challenges,
    reminders,
    metrics,
    jobs,
  ] = await Promise.all([
    db.collection("applications").get(),
    db.collection("participants").get(),
    db.collection("programs").get(),
    db.collection("departments").get(),
    db.collection("assignedInterventions").get(),
    db.collection("diagnosticPlans").get(),
    db.collection("movDocuments").get(),
    db.collectionGroup("complianceDocuments").get(),
    db.collection("operationalChallenges").get(),
    db.collection("emailLogs").where("type", "in", REMINDER_EMAIL_TYPES).get(),
    db.collection("participantMonthlyMetrics").get(),
    db.collection("hseJobContracts").get(),
  ]);

  const complianceByApplication = new Map<string, AnyDoc[]>();
  compliance.docs.forEach((snapshot) => {
    const applicationRef = snapshot.ref.parent.parent;
    if (!applicationRef || applicationRef.parent.id !== "applications") return;
    const list = complianceByApplication.get(applicationRef.id) || [];
    list.push({ id: snapshot.id, ...(snapshot.data() as AnyDoc) });
    complianceByApplication.set(applicationRef.id, list);
  });

  return {
    applications: docsOf(applications).filter(isAcceptedApplication),
    index: {
      participants: new Map(docsOf(participants).map((item) => [item.id, item])),
      programs: new Map(docsOf(programs).map((item) => [item.id, item])),
      departments: docsOf(departments),
      assignments: groupBy(docsOf(assignments), (item) => item.participantId),
      plans: groupBy(docsOf(plans), (item) => item.participantId),
      movs: groupBy(docsOf(movs), (item) => item.participantId || item.smmeId),
      compliance: complianceByApplication,
      challenges: groupBy(docsOf(challenges), (item) => (Array.isArray(item.smeIds) ? item.smeIds : [])),
      reminders: groupBy(docsOf(reminders), (item) => item.participantId),
      metrics: groupBy(docsOf(metrics), (item) => item.participantId),
      jobs: groupBy(docsOf(jobs), (item) => item.participantId),
    },
  };
}

function attachPeers(records: DigitalTwinRecord[], extraPeers: PeerProfile[] = []) {
  const profiles = [...records.map(peerProfileOf), ...extraPeers];
  records.forEach((record) => {
    record.peers = comparePeers(peerProfileOf(record), profiles);
  });
}

async function writeRecords(records: DigitalTwinRecord[]) {
  for (let offset = 0; offset < records.length; offset += BATCH_WRITE_SIZE) {
    const batch = db.batch();
    records.slice(offset, offset + BATCH_WRITE_SIZE).forEach((record) => {
      const data = plain(record);
      const ref = db.collection(TWINS).doc(record.twinId);
      batch.set(ref, { ...data, savedAt: admin.firestore.FieldValue.serverTimestamp() });
      batch.set(ref.collection("days").doc(record.day), data);
    });
    await batch.commit();
  }
}

export const digitalTwinNightly = onSchedule(
  {
    region: "us-central1",
    // After revenueMetricsSyncCron (05:00) so today's revenue is included.
    schedule: "30 5 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
  },
  async () => {
    const heartbeatRef = db.collection("systemHeartbeats").doc("digitalTwinNightly");
    const now = new Date();
    try {
      const { applications, index } = await loadAllSources();
      const records: DigitalTwinRecord[] = [];
      let failed = 0;
      applications.forEach((application) => {
        if (!getParticipantId(application)) return;
        try {
          records.push(buildTwinRecord(sourcesFor(application, index), { now, source: "daily" }));
        } catch (error) {
          failed += 1;
          logger.warn("digitalTwinNightly.recordFailed", { applicationId: application.id, error: String(error) });
        }
      });
      attachPeers(records);
      await writeRecords(records);

      const summary = { applications: applications.length, recordsWritten: records.length, failed };
      logger.info("digitalTwinNightly.complete", summary);
      await heartbeatRef.set(
        { lastRunAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "ok", lastError: null, ...summary },
        { merge: true }
      );
    } catch (error: any) {
      const message = String(error?.message || error);
      logger.error("digitalTwinNightly.failed", { error: message });
      await heartbeatRef.set(
        { lastRunAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: message },
        { merge: true }
      );
    }
  }
);

/** "Recalculate now": recomputes one SME and replaces today's record. Staff only. */
export const recalculateDigitalTwin = onCall({ region: "us-central1", timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to recalculate a twin.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data() || {};
  const role = clean(caller.role).toLowerCase().replace(/\s+/g, "_");
  if (!STAFF_ROLES.has(role)) throw new HttpsError("permission-denied", "The digital twin is for staff only.");

  const applicationId = clean(request.data?.applicationId);
  if (!applicationId) throw new HttpsError("invalid-argument", "applicationId is required.");
  const applicationSnap = await db.collection("applications").doc(applicationId).get();
  if (!applicationSnap.exists) throw new HttpsError("not-found", "Application not found.");
  const application: AnyDoc = { id: applicationSnap.id, ...(applicationSnap.data() as AnyDoc) };
  const participantId = getParticipantId(application);
  if (!participantId) throw new HttpsError("failed-precondition", "This application is not linked to an SME yet.");
  const programId = clean(application.programId);

  const byParticipant = (name: string, field = "participantId") =>
    db.collection(name).where(field, "==", participantId).get().then(docsOf);

  const [participantSnap, programSnap, departments, assignments, plans, movs, uploads, challenges, reminders, metrics, jobs, twins] =
    await Promise.all([
      db.collection("participants").doc(participantId).get(),
      programId ? db.collection("programs").doc(programId).get() : Promise.resolve(null),
      db.collection("departments").get().then(docsOf),
      byParticipant("assignedInterventions"),
      byParticipant("diagnosticPlans"),
      byParticipant("movDocuments"),
      db.collection("applications").doc(applicationId).collection("complianceDocuments").get().then(docsOf),
      db.collection("operationalChallenges").where("smeIds", "array-contains", participantId).get().then(docsOf),
      byParticipant("emailLogs").then((rows) => rows.filter((row) => REMINDER_EMAIL_TYPES.includes(clean(row.type)))),
      byParticipant("participantMonthlyMetrics"),
      byParticipant("hseJobContracts"),
      db.collection(TWINS).get(),
    ]);

  const record = buildTwinRecord(
    {
      application,
      participant: participantSnap.exists ? { id: participantSnap.id, ...(participantSnap.data() as AnyDoc) } : {},
      program: programSnap && programSnap.exists ? (programSnap.data() as AnyDoc) : null,
      diagnosticPlans: plans,
      assignments,
      departments,
      movs,
      complianceUploads: uploads,
      challenges,
      reminderEmails: reminders,
      monthlyMetrics: metrics,
      jobContracts: jobs,
    },
    { now: new Date(), source: "manual" }
  );

  // Peers come from everyone else's latest saved record.
  const otherProfiles = twins.docs
    .filter((item) => item.id !== record.twinId)
    .map((item) => peerProfileOf(item.data() as DigitalTwinRecord));
  attachPeers([record], otherProfiles);
  await writeRecords([record]);
  return plain(record);
});

