import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { admin, db } from "./emailShared";

const REGION = "us-central1";

function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Lepharo Smart Incubation</title>
<style>
  body { font-family: Arial, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 40px 16px; }
  .card { max-width: 440px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { line-height: 1.6; color: #374151; }
  button { display: inline-block; padding: 12px 24px; background: #0ea5e9; color: #fff; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; margin-top: 8px; }
  button.danger { background: #dc2626; }
  button.primary { background: #16a34a; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function message(title: string, body: string): string {
  return page(title, `<p>${escapeHtml(body)}</p>`);
}

function confirmPage(label: string, token: string): string {
  return page(label, `
    <p>Click below to confirm: <strong>${escapeHtml(label)}</strong></p>
    <form method="POST" action="?token=${encodeURIComponent(token)}">
      <button type="submit">${escapeHtml(label)}</button>
    </form>
  `);
}

/**
 * One-click (two-step) email action endpoint. The GET a recipient reaches
 * from an email button only renders a confirmation page and changes nothing
 * -- this matters because corporate email scanners (Outlook Safe Links etc.)
 * auto-fetch links to check for malware, which would silently burn a
 * single-use token before the real recipient ever saw the email if the GET
 * itself applied the action. The confirmation page's own button POSTs back
 * to this same endpoint, and that POST is what actually applies the change.
 *
 * Tokens are minted by notificationEmailFanout.ts into notificationActions/{token}
 * -- see firestore.rules, that collection is Cloud-Functions-only.
 */
export const notificationAction = onRequest(
  { region: REGION, cors: false },
  async (req, res) => {
    const token = String(req.query.token || req.body?.token || "").trim();
    if (!token) {
      res.status(400).send(message("Invalid link", "This link is missing its token."));
      return;
    }

    const ref = db.collection("notificationActions").doc(token);

    if (req.method === "GET") {
      try {
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).send(message("Invalid link", "This link isn't valid. It may already have been used, or the notification it belongs to was removed."));
          return;
        }
        const data = snap.data()!;
        if (data.used) {
          const when = data.usedAt?.toDate ? data.usedAt.toDate().toLocaleString() : "";
          res.status(200).send(message("Already completed", `This action was already completed${when ? ` on ${when}` : ""}.`));
          return;
        }
        if (data.expiresAt?.toMillis && data.expiresAt.toMillis() < Date.now()) {
          await ref.update({ resultStatus: "expired" });
          res.status(200).send(message("Link expired", "This link has expired. Please sign in to the app to complete this action."));
          return;
        }
        res.status(200).send(confirmPage(String(data.label || data.actionId || "Confirm"), token));
      } catch (err: any) {
        logger.error("notification_action.get_failed", { token, error: String(err?.message || err) });
        res.status(500).send(message("Something went wrong", "We couldn't load this link. Please try again or sign in to the app."));
      }
      return;
    }

    if (req.method === "POST") {
      try {
        const result = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { status: "missing" as const };
          const data = snap.data()!;
          if (data.used) return { status: "already_used" as const };
          if (data.expiresAt?.toMillis && data.expiresAt.toMillis() < Date.now()) {
            tx.update(ref, { resultStatus: "expired" });
            return { status: "expired" as const };
          }

          const targetRef = db.collection(String(data.targetCollection)).doc(String(data.targetDocId));
          tx.update(targetRef, data.patch || {});
          tx.update(ref, {
            used: true,
            usedAt: admin.firestore.FieldValue.serverTimestamp(),
            usedByIp: req.ip || null,
            resultStatus: "applied",
          });
          if (data.notificationId) {
            tx.update(db.collection("notifications").doc(String(data.notificationId)), {
              actionsLog: admin.firestore.FieldValue.arrayUnion({
                actionId: data.actionId,
                at: admin.firestore.Timestamp.now(),
                via: "email-link",
                result: "applied",
              }),
            });
          }
          return { status: "applied" as const, label: data.label || data.actionId };
        });

        if (result.status === "missing") {
          res.status(404).send(message("Invalid link", "This link isn't valid."));
          return;
        }
        if (result.status === "already_used") {
          res.status(200).send(message("Already completed", "This action was already completed."));
          return;
        }
        if (result.status === "expired") {
          res.status(200).send(message("Link expired", "This link has expired. Please sign in to the app to complete this action."));
          return;
        }
        res.status(200).send(message("Done", `"${result.label}" was completed successfully.`));
      } catch (err: any) {
        logger.error("notification_action.post_failed", { token, error: String(err?.message || err) });
        res.status(500).send(message("Something went wrong", "We couldn't complete this action. Please try again or sign in to the app."));
      }
      return;
    }

    res.status(405).send(message("Not allowed", "Unsupported request."));
  },
);
