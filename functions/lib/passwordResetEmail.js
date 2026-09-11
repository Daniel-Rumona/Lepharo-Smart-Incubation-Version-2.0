"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendLoggedPasswordResetEmail = void 0;
const crypto_1 = require("crypto");
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const emailShared_1 = require("./emailShared");
const GENERIC_RESULT = { ok: true };
exports.sendLoggedPasswordResetEmail = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const email = String(request.data?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new https_1.HttpsError("invalid-argument", "Enter a valid email address.");
    }
    const key = (0, crypto_1.createHash)("sha256").update(email).digest("hex");
    const ref = emailShared_1.db.collection("passwordResetRateLimits").doc(key);
    const now = Date.now();
    const allowed = await emailShared_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const last = snap.data()?.lastRequestedAt?.toMillis?.() || 0;
        if (now - last < 60000)
            return false;
        tx.set(ref, {
            lastRequestedAt: emailShared_1.admin.firestore.Timestamp.fromMillis(now),
            expiresAt: emailShared_1.admin.firestore.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
        }, { merge: true });
        return true;
    });
    if (!allowed)
        return GENERIC_RESULT;
    let link;
    try {
        link = await emailShared_1.admin.auth().generatePasswordResetLink(email, {
            url: `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/login`,
        });
    }
    catch (error) {
        if (error?.code === "auth/user-not-found")
            return GENERIC_RESULT;
        throw new https_1.HttpsError("internal", "Password reset email could not be prepared.");
    }
    const subject = "Reset your Smart Incubation password";
    try {
        await (0, emailShared_1.getTransporter)().sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
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
    }
    catch (error) {
        logger.error("sendLoggedPasswordResetEmail.sendMail failed", {
            email,
            err: String(error?.response || error?.message || error),
        });
        throw new https_1.HttpsError("internal", "The password reset email could not be sent right now. Please try again shortly or contact support.");
    }
    return GENERIC_RESULT;
});
//# sourceMappingURL=passwordResetEmail.js.map