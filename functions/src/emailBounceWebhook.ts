import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { admin, db } from "./emailShared";

// Brevo's docs are inconsistent between "hard_bounce" and "hardBounce" across doc
// versions, so events are normalized (lowercased, separators stripped) before
// matching.
function normalizeEvent(value: any): string {
  return String(value || "").toLowerCase().replace(/[_\s-]+/g, "");
}

const HARD_BOUNCE_EVENTS = new Set(["hardbounce", "blocked", "invalid", "spam"]);
const SOFT_BOUNCE_EVENTS = new Set(["softbounce", "deferred"]);

/**
 * Receives Brevo transactional webhook events (bounce/complaint/deferred) and
 * updates the emailLogs/emailSuppressions collections the app already reads from.
 * Brevo does not sign webhook requests, so this endpoint is protected by a shared
 * bearer token configured when the webhook is registered (see the plan's curl
 * command) -- BREVO_WEBHOOK_TOKEN must match on both sides.
 */
export const brevoEmailWebhook = onRequest(
  { region: "us-central1", cors: false },
  async (req, res) => {
    const expectedToken = process.env.BREVO_WEBHOOK_TOKEN;
    const authHeader = String(req.headers.authorization || "");
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!expectedToken || !match || match[1] !== expectedToken) {
      res.status(401).json({ ok: false, error: "Unauthorized." });
      return;
    }

    try {
      const body = req.body || {};
      const event = normalizeEvent(body.event);
      const email = String(body.email || "").trim().toLowerCase();
      const messageId = String(body["message-id"] || "").trim();
      const reason = String(body.reason || body.event || "").trim();

      if (!email) {
        res.status(200).json({ ok: true, skipped: "no email in payload" });
        return;
      }

      let matchedLog: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      if (messageId) {
        const snap = await db.collection("emailLogs").where("messageId", "==", messageId).limit(1).get();
        if (!snap.empty) matchedLog = snap.docs[0];
      }
      const matchedData: any = matchedLog?.data() || {};

      if (HARD_BOUNCE_EVENTS.has(event)) {
        if (matchedLog) {
          await matchedLog.ref.update({ status: "bounced", error: reason || event });
        }

        await db.collection("emailSuppressions").doc(email).set(
          {
            to: email,
            reason: reason || event || "bounced",
            source: "brevo-webhook",
            type: matchedData.type || null,
            participantId: matchedData.participantId || null,
            programId: matchedData.programId || null,
            lastError: reason || event || "bounced",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else if (SOFT_BOUNCE_EVENTS.has(event) && matchedLog) {
        // Transient -- note it on the log for visibility, but don't suppress the
        // address; it isn't necessarily bad.
        await matchedLog.ref.update({ error: reason || event });
      }

      res.status(200).json({ ok: true });
    } catch (error: any) {
      logger.error("brevo_email_webhook.failed", { error: String(error?.message || error) });
      // Still respond 200 -- a bug on our side shouldn't make Brevo hammer retries;
      // the failure is logged for investigation instead.
      res.status(200).json({ ok: false });
    }
  }
);
