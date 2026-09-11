import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import nodemailer from "nodemailer";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type DeliveryStatus = "sent" | "failed";

export type EmailLogMeta = {
  type?: string;
  participantId?: string;
  programId?: string;
};

export type SendMailOptionsWithMeta = nodemailer.SendMailOptions & {
  __meta?: EmailLogMeta;
};

function flattenAddresses(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenAddresses);
  if (typeof value === "object" && value.address) return [String(value.address)];
  return String(value)
    .split(/[;,]+/)
    .map((part) => {
      const angleAddress = part.match(/<([^>]+)>/);
      return (angleAddress?.[1] || part).trim().toLowerCase();
    })
    .filter(Boolean);
}

async function writeDeliveryLogs(
  options: SendMailOptionsWithMeta,
  status: DeliveryStatus,
  details: {
    error?: string | null;
    messageId?: string | null;
    accepted?: any[];
    rejected?: any[];
    response?: string | null;
  } = {}
) {
  const bcc = flattenAddresses(options.bcc);
  const recipients = bcc.length
    ? bcc
    : [...flattenAddresses(options.to), ...flattenAddresses(options.cc)];
  const uniqueRecipients = [...new Set(recipients)];
  const rows = uniqueRecipients.length ? uniqueRecipients : ["(recipient unavailable)"];
  const subject = String(options.subject || "(no subject)");
  const meta = options.__meta || {};
  const batch = db.batch();

  rows.forEach((to) => {
    const ref = db.collection("emailLogs").doc();
    batch.set(ref, {
      type: meta.type || "SYSTEM_EMAIL",
      source: "firebase-functions",
      to,
      subject,
      status,
      error: details.error || null,
      messageId: details.messageId || null,
      accepted: (details.accepted || []).map(String),
      rejected: (details.rejected || []).map(String),
      transportResponse: details.response || null,
      participantId: meta.participantId || null,
      programId: meta.programId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    // Logging must never turn a successfully accepted SMTP message into a failure.
    logger.error("email_delivery_log.write_failed", {
      subject,
      recipients: rows,
      error: String(error),
    });
  }
}

/**
 * Adds Firestore delivery-attempt logging to a Nodemailer transport.
 *
 * "sent" means the configured SMTP server accepted the message. Final inbox
 * delivery or a later bounce requires provider webhooks and is not asserted here.
 */
export function withEmailDeliveryLogging(
  transport: nodemailer.Transporter
): nodemailer.Transporter {
  const sendMail = transport.sendMail.bind(transport);

  transport.sendMail = (async (options: SendMailOptionsWithMeta, callback?: any) => {
    try {
      const info: any = await sendMail(options);
      await writeDeliveryLogs(options, "sent", {
        messageId: info?.messageId || null,
        accepted: info?.accepted || [],
        rejected: info?.rejected || [],
        response: info?.response || null,
      });
      if (typeof callback === "function") callback(null, info);
      return info;
    } catch (error: any) {
      await writeDeliveryLogs(options, "failed", {
        error: String(error?.message || error),
        response: String(error?.response || "") || null,
      });
      if (typeof callback === "function") {
        callback(error);
        return undefined as any;
      }
      throw error;
    }
  }) as any;

  return transport;
}
