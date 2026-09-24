import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";

// Chases manually-tracked KPIs (kpiDefinitions.trackingMode === "manual") that
// have a target set for the current reporting period but no recorded actual
// yet - the department responsible gets an email + in-app/push notification
// once per period, not once per day.

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

function isActiveUser(user: any) {
  return !["inactive", "disabled", "deleted"].includes(lower(user?.status));
}

function currentQuarterKey(now: Date) {
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `${now.getFullYear()}-Q${quarter}`;
}

function currentMonthKey(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function reminderDocId(kpiId: string, periodKey: string) {
  return `${kpiId}__${periodKey}`;
}

// "operations" is this system's HOD/department-manager role - the same
// mapping complianceExpiryReminderCron uses to resolve a department head.
async function resolveDepartmentRecipients(departmentId: string): Promise<{ uid: string; email: string }[]> {
  if (!departmentId) return [];
  const snapshot = await db.collection("users").where("departmentId", "==", departmentId).get();
  const recipients: { uid: string; email: string }[] = [];
  snapshot.docs.forEach((doc) => {
    const user = doc.data() as any;
    if (!isActiveUser(user)) return;
    if (lower(user.role) !== "operations") return;
    const email = lower(user.email);
    if (email.includes("@")) recipients.push({ uid: doc.id, email });
  });
  return recipients;
}

export const kpiManualUpdateReminderCron = onSchedule(
  {
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const kpiSnapshot = await db.collection("kpiDefinitions")
      .where("trackingMode", "==", "manual")
      .where("active", "==", true)
      .get();

    let remindersSent = 0;

    for (const kpiSnap of kpiSnapshot.docs) {
      const kpi = kpiSnap.data() as any;
      const cadence = kpi.reminderCadence === "monthly" ? "monthly" : "quarterly";
      const periodKey = cadence === "monthly" ? currentMonthKey(now) : currentQuarterKey(now);

      const targetSnap = await db.collection("kpiTargets")
        .where("kpiId", "==", kpiSnap.id)
        .where("periodKey", "==", periodKey)
        .limit(1)
        .get();
      if (targetSnap.empty) continue; // no target committed for the current period yet

      const target = targetSnap.docs[0].data() as any;
      if (target.actual !== undefined && target.actual !== null) continue; // already updated

      const ledgerRef = db.collection("kpiReminderNotifications").doc(reminderDocId(kpiSnap.id, periodKey));
      const ledgerSnap = await ledgerRef.get();
      if (ledgerSnap.exists) continue; // already reminded for this KPI + period

      const departmentId = clean(kpi.leadDepartmentId) || clean(kpi.departmentId);
      const recipients = await resolveDepartmentRecipients(departmentId);
      if (!recipients.length) {
        logger.warn("kpiManualUpdateReminderCron.noRecipients", { kpiId: kpiSnap.id, departmentId });
        continue;
      }

      const kpiLabel = clean(kpi.kpiLabel) || "KPI";
      const departmentLabel = clean(kpi.department);
      const trackerUrl = `${APP_BASE_URL.replace(/\/$/, "")}/kpis/track`;
      const subject = `KPI update needed: ${kpiLabel}`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
        <h2 style="color:#1457a6">KPI update reminder</h2>
        <p><strong>${escapeHtml(kpiLabel)}</strong>${departmentLabel ? ` (${escapeHtml(departmentLabel)})` : ""} has no recorded actual for <strong>${escapeHtml(periodKey)}</strong> yet.</p>
        <p>This KPI is tracked manually - please enter this period's actual figure.</p>
        <p><a href="${escapeHtml(trackerUrl)}">Open the KPI Tracker</a></p>
      </div>`;
      const text = [
        "KPI update reminder",
        "",
        `${kpiLabel}${departmentLabel ? ` (${departmentLabel})` : ""} has no recorded actual for ${periodKey} yet.`,
        "This KPI is tracked manually - please enter this period's actual figure.",
        "",
        `Open the KPI Tracker: ${trackerUrl}`,
      ].join("\n");

      const emails = recipients.map((r) => r.email);
      const uids = recipients.map((r) => r.uid);

      try {
        await sendStatusChangeNotification(emails, subject, html, text);
      } catch (error) {
        logger.error("kpiManualUpdateReminderCron.emailFailed", { kpiId: kpiSnap.id, error: String(error) });
      }

      await db.collection("notifications").add({
        type: "kpi_manual_update_reminder",
        message: `Update needed: ${kpiLabel} has no recorded actual for ${periodKey}.`,
        recipientIds: uids,
        recipientRoles: ["operations"],
        kpiId: kpiSnap.id,
        kpiLabel,
        periodKey,
        createdAt: new Date(),
        readBy: {},
      });

      await ledgerRef.set({
        kpiId: kpiSnap.id,
        kpiLabel,
        periodKey,
        departmentId,
        recipientCount: recipients.length,
        sentAt: new Date(),
      });

      remindersSent += 1;
    }

    logger.info("kpiManualUpdateReminderCron.complete", {
      kpisScanned: kpiSnapshot.size,
      remindersSent,
    });
  }
);
