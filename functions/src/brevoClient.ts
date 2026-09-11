import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "./emailShared";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";

export type BrevoSendInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
};

/**
 * Sends via Brevo's transactional API (not their SMTP relay) because only the API
 * path fires the bounce/complaint webhook events this app relies on for delivery
 * status -- see emailBounceWebhook.ts.
 */
export async function sendViaBrevo(input: BrevoSendInput): Promise<{ messageId: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("Missing env: BREVO_API_KEY");

  const senderEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
  const senderName = process.env.MAIL_FROM_NAME || "Smart Incubation Support";
  if (!senderEmail) throw new Error("Missing env: MAIL_FROM_EMAIL");

  const res = await fetch(BREVO_SEND_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
      tags: input.tags,
    }),
  });

  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.message || data?.code || `Brevo API error (${res.status})`;
    throw new Error(message);
  }

  return { messageId: String(data?.messageId || "") };
}

export type EmailLogInput = {
  type: string;
  to: string;
  subject: string;
  status: "sent" | "failed";
  messageId?: string | null;
  error?: string | null;
  participantId?: string | null;
  programId?: string | null;
};

/** Mirrors the field shape emailDelivery.ts's withEmailDeliveryLogging already writes,
 * so every existing reader (frontend risk register, /admin/email) works unchanged. */
export async function logBrevoSend(input: EmailLogInput) {
  try {
    await db.collection("emailLogs").add({
      type: input.type,
      source: "brevo-api",
      to: String(input.to || "").toLowerCase(),
      subject: input.subject,
      status: input.status,
      error: input.error || null,
      messageId: input.messageId || null,
      accepted: input.status === "sent" ? [input.to] : [],
      rejected: input.status === "failed" ? [input.to] : [],
      transportResponse: null,
      participantId: input.participantId || null,
      programId: input.programId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("brevo_send_log.write_failed", { subject: input.subject, to: input.to, error: String(error) });
  }
}

/**
 * Brevo auto-expires an API key after 90 days with no API activity (warning emails
 * go out on day 83 and day 90 -- see
 * https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys).
 * A read-only "get account details" call is enough to count as activity without any
 * side effects (no email sent, no data changed, doesn't touch the daily send quota).
 */
async function pingBrevoAccount(): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("Missing env: BREVO_API_KEY");

  const res = await fetch(BREVO_ACCOUNT_URL, {
    method: "GET",
    headers: { "api-key": apiKey, "Accept": "application/json" },
  });

  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new Error(data?.message || `Brevo API error (${res.status})`);
  }
}

export const brevoApiKeepAlive = onSchedule(
  { region: "us-central1", schedule: "0 3 * * 1", timeZone: "Africa/Johannesburg" },
  async () => {
    const ref = db.collection("systemHeartbeats").doc("brevoApiKeepAlive");
    try {
      await pingBrevoAccount();
      await ref.set(
        { lastPingAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "ok", lastError: null },
        { merge: true }
      );
    } catch (error: any) {
      const message = String(error?.message || error);
      logger.error("brevo_api_keep_alive.failed", { error: message });
      await ref.set(
        { lastPingAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: message },
        { merge: true }
      );
    }
  }
);
