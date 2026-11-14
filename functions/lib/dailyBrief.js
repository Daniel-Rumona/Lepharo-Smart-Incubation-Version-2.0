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
exports.buildMyDailyBrief = exports.dailyBriefCron = exports.holdForDigest = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const cronHeartbeat_1 = require("./cronHeartbeat");
const emailShared_1 = require("./emailShared");
const dailyBriefLogic_1 = require("./dailyBriefLogic");
/**
 * Daily digest. Someone who turns it on (users/{uid}.dailyDigest.enabled) stops getting the scheduled
 * reminder emails one by one: holdForDigest() saves each as a digestItems row instead. On weekdays at
 * 09:30, after the morning reminder jobs, the brief gathers those rows and the person's in-app
 * notifications since their last brief, stores it as dailyBriefs/{uid}__{date} (the Data Assistant
 * shows it) and sends one email. People not on digest are unaffected, and anything a person triggers
 * directly (a colleague's nudge, invitations, approvals) still sends at once.
 */
const ITEMS = "digestItems";
const BRIEFS = "dailyBriefs";
const CALLABLE_CORS = ["http://localhost:5173", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"];
// In-app notifications the brief already covers as held reminders.
const COVERED_NOTIFICATION_TYPES = new Set(["mov_stage_reminder"]);
const LOOKBACK_MS = 4 * 24 * 3600 * 1000; // a long weekend at most
const clean = (value) => String(value ?? "").trim();
const millis = (value) => value?.toMillis?.() ?? (value ? new Date(value).getTime() : 0);
let cached = null;
/** Everyone on digest, by email. Cached briefly so a reminder job's loop reads it once. */
async function digestUsersByEmail() {
    if (cached && Date.now() - cached.at < 60000)
        return cached.byEmail;
    const snapshot = await emailShared_1.db.collection("users").where("dailyDigest.enabled", "==", true).get();
    const byEmail = new Map();
    snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const email = clean(data.email).toLowerCase();
        if (email)
            byEmail.set(email, { uid: clean(data.uid || data.authUid) || doc.id, docId: doc.id, email, name: clean(data.name || data.displayName), lastBriefAt: millis(data.dailyDigest?.lastBriefAt) });
    });
    cached = { at: Date.now(), byEmail };
    return byEmail;
}
/**
 * Splits a reminder's recipients: people on digest get it saved for their brief, everyone else is
 * returned to be emailed now. If anything goes wrong reading digest settings, everyone is emailed.
 */
async function holdForDigest(emails, item) {
    const unique = [...new Set(emails.map((email) => clean(email).toLowerCase()).filter((email) => email.includes("@")))];
    if (!unique.length)
        return [];
    let digest;
    try {
        digest = await digestUsersByEmail();
    }
    catch (error) {
        logger.warn("daily_digest.lookup_failed", { error: String(error) });
        return unique;
    }
    const held = unique.filter((email) => digest.has(email));
    if (!held.length)
        return unique;
    const batch = emailShared_1.db.batch();
    held.forEach((email) => {
        const user = digest.get(email);
        batch.set(emailShared_1.db.collection(ITEMS).doc(), {
            ...item,
            uid: user.uid,
            email,
            createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            briefedAt: null,
        });
    });
    try {
        await batch.commit();
    }
    catch (error) {
        logger.warn("daily_digest.hold_failed", { error: String(error) });
        return unique; // never lose a reminder: send it after all
    }
    return unique.filter((email) => !digest.has(email));
}
exports.holdForDigest = holdForDigest;
async function itemsFor(uid, now, lastBriefAt) {
    const since = now - LOOKBACK_MS;
    const [held, notifications] = await Promise.all([
        emailShared_1.db.collection(ITEMS).where("uid", "==", uid).where("briefedAt", "==", null).get(),
        emailShared_1.db.collection("notifications").where("recipientIds", "array-contains", uid).orderBy("createdAt", "desc").limit(60).get(),
    ]);
    const items = held.docs.map((doc) => {
        const data = doc.data();
        return {
            category: data.category,
            title: clean(data.title),
            detail: clean(data.detail),
            link: clean(data.link) || "/",
            dedupeKey: clean(data.dedupeKey),
            createdAt: millis(data.createdAt) || now,
        };
    });
    // In-app notifications since the person's last brief, so the brief is the whole picture.
    const after = Math.max(since, lastBriefAt);
    notifications.docs.forEach((doc) => {
        const data = doc.data();
        const at = millis(data.createdAt);
        if (at <= after || COVERED_NOTIFICATION_TYPES.has(clean(data.type)))
            return;
        const message = clean(data.message || data.body);
        items.push({
            // A watch or chaser the person set is what they asked to hear about, so it leads the brief.
            category: ["watch_triggered", "chaser_update"].includes(clean(data.type)) ? "watch" : "notification",
            title: clean(data.title) || message.slice(0, 90) || "Notification",
            detail: clean(data.title) ? message.slice(0, 160) : "",
            link: clean(data.link) || "/",
            dedupeKey: doc.id,
            createdAt: at,
        });
    });
    return { items, heldRefs: held.docs.map((doc) => doc.ref) };
}
/** Builds (and stores) one person's brief for today. Emails it only when asked and there is something in it. */
async function briefFor(user, options) {
    const now = options.now ?? Date.now();
    const date = (0, dailyBriefLogic_1.sastDate)(now);
    const { items, heldRefs } = await itemsFor(user.uid, now, user.lastBriefAt);
    const brief = (0, dailyBriefLogic_1.buildBrief)(items, date);
    const ref = emailShared_1.db.collection(BRIEFS).doc(`${user.uid}__${date}`);
    await ref.set({ uid: user.uid, ...brief, createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(), emailedAt: null }, { merge: true });
    if (options.email && brief.total > 0) {
        const { subject, html, text } = (0, dailyBriefLogic_1.renderBriefEmail)(user.name, brief, emailShared_1.APP_BASE_URL);
        await (0, emailShared_1.sendStatusChangeNotification)([user.email], subject, html, text);
        await ref.set({ emailedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    if (options.email) {
        await emailShared_1.db.collection("users").doc(user.docId).set({ dailyDigest: { lastBriefAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
    }
    if (options.email && heldRefs.length) {
        // Only the scheduled send clears the held items; a preview leaves them for the morning.
        for (let at = 0; at < heldRefs.length; at += 400) {
            const batch = emailShared_1.db.batch();
            heldRefs.slice(at, at + 400).forEach((itemRef) => batch.update(itemRef, { briefedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() }));
            await batch.commit();
        }
    }
    return brief;
}
exports.dailyBriefCron = (0, cronHeartbeat_1.scheduledJob)("dailyBriefCron", { region: "us-central1", schedule: "30 9 * * 1-5", timeZone: "Africa/Johannesburg", timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 }, async () => {
    cached = null;
    const users = [...(await digestUsersByEmail()).values()];
    let sent = 0;
    let failed = 0;
    for (const user of users) {
        try {
            const brief = await briefFor(user, { email: true });
            if (brief.total)
                sent++;
        }
        catch (error) {
            failed++;
            logger.error("daily_brief.failed", { uid: user.uid, error: String(error) });
        }
    }
    logger.info("daily_brief.done", { users: users.length, sent, failed });
});
/** The caller's brief for today, built now (nothing is emailed or cleared). For the Data Assistant. */
exports.buildMyDailyBrief = (0, https_1.onCall)({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 60 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    const profile = (await emailShared_1.db.collection("users").doc(request.auth.uid).get()).data() || {};
    const user = {
        uid: request.auth.uid,
        docId: request.auth.uid,
        email: clean(profile.email || request.auth.token?.email).toLowerCase(),
        name: clean(profile.name || profile.displayName),
        lastBriefAt: millis(profile.dailyDigest?.lastBriefAt),
    };
    return briefFor(user, { email: false });
});
//# sourceMappingURL=dailyBrief.js.map