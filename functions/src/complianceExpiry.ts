import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  APP_BASE_URL,
  db,
  sendStatusChangeNotification,
} from "./emailShared";
import { logBrevoSend, sendViaBrevo } from "./brevoClient";
import { createComplianceExpiryInAppNotifications } from "./complianceExpiryInApp";

const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const normalizeKey = (value: unknown) => lower(value)
  .replace(/[_\s]+/g, "-")
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-+|-+$/g, "");

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function reminderPhase(daysUntilExpiry: number) {
  if (daysUntilExpiry < 0) {
    return `expired-week-${Math.floor(Math.abs(daysUntilExpiry) / 7)}`;
  }
  if (daysUntilExpiry <= 1) return "expiring-1-day";
  if (daysUntilExpiry <= 7) return "expiring-7-days";
  if (daysUntilExpiry <= 14) return "expiring-14-days";
  return "expiring-30-days";
}

function isRomDepartment(value: unknown) {
  const department = lower(value).replace(/\s+/g, " ");
  return department === "rom" || department.startsWith("rom ") ||
    department.includes("recruitment, onboarding and maintenance");
}

function isActiveUser(user: any) {
  return !["inactive", "disabled", "deleted"].includes(lower(user?.status));
}

function documentKey(document: any) {
  return normalizeKey(
    document?.presetId ||
    document?.slug ||
    document?.key ||
    document?.type ||
    document?.documentName ||
    document?.title ||
    document?.id
  );
}

function documentTitle(document: any) {
  return clean(document?.documentName || document?.title || document?.type || documentKey(document) || "Compliance document");
}

function emailAddress(value: unknown) {
  const email = lower(value);
  return email.includes("@") ? email : "";
}

async function loadRecipientDirectory() {
  const [departmentSnapshot, userSnapshot] = await Promise.all([
    db.collection("departments").get(),
    db.collection("users").get(),
  ]);
  const romDepartmentIds = new Set(
    departmentSnapshot.docs
      .filter(item => isRomDepartment(item.data().name || item.data().departmentName))
      .map(item => item.id)
  );
  return {
    romDepartmentIds,
    users: userSnapshot.docs,
  };
}

function resolveRecipients(
  application: any,
  program: any,
  directory: Awaited<ReturnType<typeof loadRecipientDirectory>>
): { staff: string[]; staffUids: string[]; smeEmail: string | null } {
  const { romDepartmentIds, users } = directory;
  const assignedCoordinatorIds = new Set(
    (Array.isArray(program?.assignedCoordinators) ? program.assignedCoordinators : [])
      .map(clean)
      .filter(Boolean)
  );
  const programId = clean(application?.programId);
  const recipients = new Set<string>();
  const recipientUids = new Set<string>();

  users.forEach(snapshot => {
    const user = snapshot.data() as any;
    if (!isActiveUser(user)) return;
    const inRom = romDepartmentIds.has(clean(user.departmentId)) ||
      isRomDepartment(user.departmentName || user.department);
    if (!inRom) return;

    const role = lower(user.role);
    const isHod = role === "operations";
    const assignedPrograms = Array.isArray(user.assignedPrograms)
      ? user.assignedPrograms.map(clean)
      : [];
    const isProjectCoordinator = role === "coordinator" && (
      assignedCoordinatorIds.has(snapshot.id) ||
      assignedCoordinatorIds.has(clean(user.uid)) ||
      (programId && assignedPrograms.includes(programId))
    );
    if (isHod || isProjectCoordinator) {
      const email = emailAddress(user.email);
      if (email) {
        recipients.add(email);
        recipientUids.add(snapshot.id);
      }
    }
  });

  const smeEmail = emailAddress(
    application?.email ||
    application?.applicantEmail ||
    application?.contactEmail ||
    application?.profile?.email
  );
  // Staff (ROM/HOD/coordinators) keep getting the existing BCC notification below;
  // the SME's own copy is sent (and tracked) separately -- see the cron loop.
  // staffUids feeds the additive in-app notification only (complianceExpiryInApp.ts)
  // -- it does not change who gets emailed or when.
  return { staff: Array.from(recipients), staffUids: Array.from(recipientUids), smeEmail };
}

type DueDocument = {
  key: string;
  title: string;
  expiryDate: Date;
  daysUntilExpiry: number;
  status: "expired" | "expiring-soon";
  phase: string;
  source: any;
};

function configuredExpiry(document: any, program: any) {
  const direct = asDate(document.expiryDate);
  if (direct) return direct;
  const issueDate = asDate(document.issueDate);
  if (!issueDate) return null;
  const key = documentKey(document);
  const requirements = Array.isArray(program?.programRequirements)
    ? program.programRequirements
    : [];
  const requirement = requirements.find((item: any) => {
    const requirementKey = normalizeKey(
      item?.presetId || item?.preset || item?.key || item?.id || item?.title || item?.name
    );
    return requirementKey === key;
  });
  const months = Number(requirement?.expiryMonths ?? requirement?.expiryRule?.months);
  if (!requirement?.hasExpiry && !requirement?.expiryRule) return null;
  if (!Number.isFinite(months) || months <= 0) return null;
  const calculated = new Date(issueDate);
  calculated.setMonth(calculated.getMonth() + months);
  return calculated;
}

function findDueDocuments(documents: any[], now: Date, program: any): DueDocument[] {
  const byKey = new Map<string, any>();
  documents.forEach(document => {
    const key = documentKey(document);
    if (key) byKey.set(key, document);
  });

  return Array.from(byKey.entries()).flatMap(([key, document]) => {
    const expiryDate = configuredExpiry(document, program);
    if (!expiryDate) return [];
    const daysUntilExpiry = Math.ceil(
      (startOfDay(expiryDate).getTime() - startOfDay(now).getTime()) / DAY_MS
    );
    if (daysUntilExpiry > EXPIRING_SOON_DAYS) return [];
    const status = daysUntilExpiry < 0 ? "expired" : "expiring-soon";
    return [{
      key,
      title: documentTitle(document),
      expiryDate,
      daysUntilExpiry,
      status,
      phase: reminderPhase(daysUntilExpiry),
      source: document,
    }];
  });
}

function notificationId(applicationId: string, document: DueDocument) {
  return crypto.createHash("sha256")
    .update([
      applicationId,
      document.key,
      document.expiryDate.toISOString().slice(0, 10),
      document.phase,
    ].join("|"))
    .digest("hex");
}

function buildReminderContent(application: any, due: DueDocument[]) {
  const smeName = clean(
    application.beneficiaryName ||
    application.companyName ||
    application.businessName ||
    application.applicantName ||
    "SME"
  );
  const expired = due.filter(item => item.status === "expired").length;
  const expiring = due.length - expired;
  const subject = `Compliance action required: ${smeName}`;
  const items = due.map(item => {
    const date = item.expiryDate.toISOString().slice(0, 10);
    const label = item.status === "expired"
      ? `Expired ${Math.abs(item.daysUntilExpiry)} day${Math.abs(item.daysUntilExpiry) === 1 ? "" : "s"} ago`
      : `Expires in ${item.daysUntilExpiry} day${item.daysUntilExpiry === 1 ? "" : "s"}`;
    return `${item.title} — ${label} (${date})`;
  });
  const staffUrl = `${APP_BASE_URL.replace(/\/$/, "")}/compliance`;
  const smeUrl = `${APP_BASE_URL.replace(/\/$/, "")}/incubatee/documents/compliance`;
  const intro = [
    expired ? `${expired} document${expired === 1 ? " has" : "s have"} expired.` : "",
    expiring ? `${expiring} document${expiring === 1 ? " is" : "s are"} expiring within ${EXPIRING_SOON_DAYS} days.` : "",
  ].filter(Boolean).join(" ");

  return {
    subject,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:720px;margin:auto">
      <h2 style="color:#1457a6">Compliance document reminder</h2>
      <p><strong>${escapeHtml(smeName)}</strong>: ${escapeHtml(intro)}</p>
      <ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p>SME: <a href="${escapeHtml(smeUrl)}">open your compliance documents</a><br/>
      ROM staff: <a href="${escapeHtml(staffUrl)}">open compliance tracking</a></p>
      <p>Please replace expired documents and review documents approaching expiry.</p>
      <p>Regards,<br/>Lepharo Smart Incubator</p>
    </div>`,
    text: [
      "Compliance document reminder",
      "",
      `${smeName}: ${intro}`,
      "",
      ...items.map(item => `- ${item}`),
      "",
      `SME compliance: ${smeUrl}`,
      `ROM compliance tracking: ${staffUrl}`,
      "",
      "Please replace expired documents and review documents approaching expiry.",
    ].join("\n"),
  };
}

export const complianceExpiryReminderCron = onSchedule(
  {
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const [
      applicationsSnapshot,
      complianceSnapshot,
      programSnapshot,
      participantSnapshot,
      recipientDirectory,
    ] = await Promise.all([
      db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"]).get(),
      db.collectionGroup("complianceDocuments").get(),
      db.collection("programs").get(),
      db.collection("participants").get(),
      loadRecipientDirectory(),
    ]);
    const programs = new Map(programSnapshot.docs.map(item => [item.id, item.data()]));
    const participants = new Map(participantSnapshot.docs.map(item => [item.id, item.data()]));
    const subcollectionDocuments = new Map<string, any[]>();
    complianceSnapshot.docs.forEach(snapshot => {
      const applicationRef = snapshot.ref.parent.parent;
      if (!applicationRef || applicationRef.parent.id !== "applications") return;
      const existing = subcollectionDocuments.get(applicationRef.id) || [];
      existing.push({ id: snapshot.id, ...snapshot.data() });
      subcollectionDocuments.set(applicationRef.id, existing);
    });

    let applicationsNotified = 0;
    let documentsNotified = 0;

    for (const applicationSnapshot of applicationsSnapshot.docs) {
      const application = applicationSnapshot.data() as any;
      const embedded = Array.isArray(application.complianceDocuments)
        ? application.complianceDocuments
        : [];
      const program = programs.get(clean(application.programId)) || {};
      const due = findDueDocuments([
        ...embedded,
        ...(subcollectionDocuments.get(applicationSnapshot.id) || []),
      ], now, program);
      if (!due.length) continue;

      const unsent: DueDocument[] = [];
      for (const document of due) {
        const ledger = await db.collection("complianceExpiryNotifications")
          .doc(notificationId(applicationSnapshot.id, document))
          .get();
        if (!ledger.exists) unsent.push(document);
      }
      if (!unsent.length) continue;

      const participant = participants.get(clean(application.participantId)) || {};
      const recipientApplication = {
        ...application,
        email: application.email ||
          application.applicantEmail ||
          participant.email ||
          participant.contactEmail,
      };
      const { staff, staffUids, smeEmail } = resolveRecipients(recipientApplication, program, recipientDirectory);
      if (!staff.length && !smeEmail) {
        logger.warn("complianceExpiryReminderCron.noRecipients", {
          applicationId: applicationSnapshot.id,
          programId: clean(application.programId),
        });
        continue;
      }

      const content = buildReminderContent(application, unsent);
      const participantId = clean(application.participantId) || null;
      const programId = clean(application.programId) || null;

      await createComplianceExpiryInAppNotifications({
        applicationId: applicationSnapshot.id,
        participantId,
        programId,
        staffUids,
        smeEmail,
        due: unsent,
        recipientDirectory,
      });

      if (staff.length) {
        await sendStatusChangeNotification(staff, content.subject, content.html, content.text);
      }

      if (smeEmail) {
        try {
          const { messageId } = await sendViaBrevo({
            to: smeEmail,
            subject: content.subject,
            html: content.html,
            text: content.text,
            tags: ["compliance-expiry-reminder"],
          });
          await logBrevoSend({
            type: "COMPLIANCE_EXPIRY_REMINDER",
            to: smeEmail,
            subject: content.subject,
            status: "sent",
            messageId,
            participantId,
            programId,
          });
        } catch (err: any) {
          const msg = String(err?.message || err);
          await logBrevoSend({
            type: "COMPLIANCE_EXPIRY_REMINDER",
            to: smeEmail,
            subject: content.subject,
            status: "failed",
            error: msg,
            participantId,
            programId,
          });
          logger.error("complianceExpiryReminderCron.smeEmailFailed", {
            applicationId: applicationSnapshot.id,
            error: msg,
          });
        }
      }

      const batch = db.batch();
      unsent.forEach(document => {
        const ref = db.collection("complianceExpiryNotifications")
          .doc(notificationId(applicationSnapshot.id, document));
        batch.set(ref, {
          applicationId: applicationSnapshot.id,
          participantId: clean(application.participantId),
          programId: clean(application.programId),
          documentKey: document.key,
          documentTitle: document.title,
          expiryDate: document.expiryDate.toISOString().slice(0, 10),
          complianceStatus: document.status,
          reminderPhase: document.phase,
          recipientCount: staff.length + (smeEmail ? 1 : 0),
          sentAt: new Date(),
        });
      });
      await batch.commit();
      applicationsNotified += 1;
      documentsNotified += unsent.length;
    }

    logger.info("complianceExpiryReminderCron.complete", {
      applicationsScanned: applicationsSnapshot.size,
      applicationsNotified,
      documentsNotified,
    });
  }
);
