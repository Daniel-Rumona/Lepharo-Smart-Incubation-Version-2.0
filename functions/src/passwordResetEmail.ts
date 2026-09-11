import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { admin, APP_BASE_URL, db, getTransporter } from "./emailShared";

const GENERIC_RESULT = { ok: true };

export const sendLoggedPasswordResetEmail = onCall(
  { region: "us-central1" },
  async (request) => {
    const email = String(request.data?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "Enter a valid email address.");
    }

    const key = createHash("sha256").update(email).digest("hex");
    const ref = db.collection("passwordResetRateLimits").doc(key);
    const now = Date.now();
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const last = snap.data()?.lastRequestedAt?.toMillis?.() || 0;
      if (now - last < 60_000) return false;
      tx.set(ref, {
        lastRequestedAt: admin.firestore.Timestamp.fromMillis(now),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
      }, { merge: true });
      return true;
    });
    if (!allowed) return GENERIC_RESULT;

    let link: string;
    try {
      link = await admin.auth().generatePasswordResetLink(email, {
        url: `${APP_BASE_URL.replace(/\/$/, "")}/login`,
      });
    } catch (error: any) {
      if (error?.code === "auth/user-not-found") return GENERIC_RESULT;
      throw new HttpsError("internal", "Password reset email could not be prepared.");
    }

    const subject = "Reset your Smart Incubation password";
    try {
      await getTransporter().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER!,
        to: email,
        subject,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
          <h2>Password reset</h2>
          <p>We received a request to reset your Smart Incubation password.</p>
          <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px">Reset Password</a></p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>`,
        text: `Reset your Smart Incubation password using this link:\n${link}\n\nIf you did not request this, ignore this email.`,
      });
    } catch (error: any) {
      logger.error("sendLoggedPasswordResetEmail.sendMail failed", {
        email,
        err: String(error?.response || error?.message || error),
      });
      throw new HttpsError(
        "internal",
        "The password reset email could not be sent right now. Please try again shortly or contact support.",
      );
    }
    return GENERIC_RESULT;
  },
);
