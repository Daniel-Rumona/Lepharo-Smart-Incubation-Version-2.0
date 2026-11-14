import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { APP_BASE_URL, getCCRecipients, getMERecipients, sendStatusChangeNotification } from "./emailShared";
import { notifyInApp } from "./inAppNotifications";
import { getProgramProjectAdmins, resolvePackProgramId, uidsForEmails } from "./movRecipients";
import { suppressRecordNotifications } from "./syntheticData";

// Monthly MOV pack hand-offs, as they happen (the daily stage reminders still
// chase anything left waiting):
//   - HOD submits a pack            -> the programme's Center Coordinator is told (in-app + email)
//   - HOD updates a pack awaiting CC -> the programme's Center Coordinator is told what changed
//   - CC confirms the pack           -> M&E is told it's ready to validate
// In-app (and push) for all three; the submission email is sent here directly. The types
// aren't in NOTIFICATION_REGISTRY, so the in-app write never triggers a second email.

const REGION = "us-central1";
const clean = (value: unknown) => String(value ?? "").trim();

const steps = (pack: any): string[] => (Array.isArray(pack?.approvals) ? pack.approvals : []).map((a: any) => clean(a?.step));

const monthLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key || "this month";
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
};

const itemCount = (pack: any) =>
  (Array.isArray(pack?.interventions) ? pack.interventions : Array.isArray(pack?.interventionsSnapshot) ? pack.interventionsSnapshot : []).length ||
  Number(pack?.totalItems || 0);

const millis = (value: any): number => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Same look as buildPackReminderEmail, without the "Reminder:" framing.
function buildPackSubmittedEmail(subject: string, message: string, actionUrl: string) {
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;">
      <p>Hi there,</p>
      <p>${escapeHtml(message)}</p>
      <p><a href="${actionUrl}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:6px;">Review the MOV pack</a></p>
      <p>Regards,<br/>Lepharo Smart Incubation System</p>
    </div>`;
  const text = `${message}

Review it here: ${actionUrl}

Regards,
Lepharo Smart Incubation System`;
  return { subject, html, text };
}

export const onMovPackChanged = onDocumentWritten(
  { document: "consolidatedMOVs/{packId}", region: REGION },
  async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    if (!after) return;
    if (suppressRecordNotifications(after, event.params.packId)) return;

    const department = clean(after.department) || "A department";
    const month = monthLabel(clean(after.month));
    const base = { packId: event.params.packId, programId: clean(after.programId) || null, packMonth: clean(after.month) };
    const stepsBefore = before ? steps(before) : [];
    const stepsAfter = steps(after);
    const confirmedByCc = stepsAfter.includes("final_confirmation");

    // The project admins of the branch that runs this pack's programme; all of them
    // only when the programme has no one linked, so the pack is never left unseen.
    const notifyCc = async (type: string, message: string, email?: { subject: string }) => {
      const programId = resolvePackProgramId(after);
      const own = await getProgramProjectAdmins(programId);
      let recipientIds = own.uids;
      let emails = own.emails;
      if (!recipientIds.length) {
        logger.warn("onMovPackChanged.noProgramCc", { packId: event.params.packId, programId });
        emails = await getCCRecipients();
        recipientIds = await uidsForEmails(emails);
      }
      await notifyInApp({ ...base, type, message, link: "/projectadmin/movs", recipientIds });
      if (!email) return;
      // The email is best-effort: the in-app notification above already went out.
      try {
        const content = buildPackSubmittedEmail(email.subject, message, `${APP_BASE_URL.replace(/\/$/, "")}/projectadmin/movs`);
        await sendStatusChangeNotification(emails, content.subject, content.html, content.text);
      } catch (error) {
        logger.error("onMovPackChanged.emailFailed", { packId: event.params.packId, type, error: String(error) });
      }
    };

    // Submitted: in-app and email, so the CC hears of it before the 2-day reminder.
    if (!before) {
      await notifyCc(
        "mov_pack_submitted",
        `${department} submitted its ${month} MOV pack (${plural(itemCount(after), "MOV")}) for your confirmation.`,
        { subject: `MOV pack ready for your confirmation: ${department}, ${month}` }
      );
      return;
    }

    // Updated by the HOD while it still waits for the CC.
    const update = after.lastHodUpdate;
    if (!confirmedByCc && update && millis(update.at) !== millis(before.lastHodUpdate?.at)) {
      const changes = [
        Number(update.added) > 0 ? `${plural(Number(update.added), "MOV")} added` : null,
        Number(update.removed) > 0 ? `${plural(Number(update.removed), "MOV")} removed` : null,
        update.invoiceReplaced ? "invoice replaced" : null,
      ].filter(Boolean);
      await notifyCc(
        "mov_pack_updated",
        `${department} updated its ${month} MOV pack${changes.length ? ` (${changes.join(", ")})` : ""}. Please review it before confirming.`
      );
    }

    // Confirmed by the CC: over to M&E.
    if (!stepsBefore.includes("final_confirmation") && confirmedByCc) {
      await notifyInApp({
        ...base,
        type: "mov_pack_confirmed",
        message: `The Center Coordinator confirmed ${department}'s ${month} MOV pack (${plural(itemCount(after), "MOV")}). It's ready for M&E validation.`,
        link: "/operations/monitoring/movs",
        recipientIds: await uidsForEmails(await getMERecipients()),
      });
    }
  }
);
