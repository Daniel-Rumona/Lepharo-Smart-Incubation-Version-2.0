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
exports.governanceMeetingReminderCron = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailShared_1 = require("./emailShared");
const TIME_ZONE = "Africa/Johannesburg";
const REMIND_AFTER_MINUTES = 30;
const MAX_REMINDERS = 3;
const REMINDER_GAP_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECIPIENT = "daniel@quantilytix.co.za";
/** Current wall-clock date parts in the schedule's time zone. */
function localNow(now) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        weekday: "short",
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return {
        date: `${get("year")}-${get("month")}-${get("day")}`,
        year: Number(get("year")),
        month: Number(get("month")),
        day: Number(get("day")),
        minutes: Number(get("hour")) * 60 + Number(get("minute")),
        weekday,
    };
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
function occursToday(schedule, today) {
    if (today.date < schedule.startDate)
        return false;
    if (schedule.frequency === "monthly") {
        const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
        return today.day === Math.min(schedule.dayOfMonth || 1, lastDay);
    }
    if (today.weekday !== schedule.weekday)
        return false;
    if (schedule.frequency === "weekly")
        return true;
    return Math.floor(daysBetween(schedule.startDate, today.date) / 7) % 2 === 0;
}
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
function buildEmail(schedule, meetingId, date, isFollowUp) {
    const base = `${emailShared_1.APP_BASE_URL}/admin/features?confirmMeeting=${encodeURIComponent(meetingId)}`;
    const yes = `${base}&answer=yes`;
    const no = `${base}&answer=no`;
    const subject = `${isFollowUp ? "Reminder: " : ""}Did your meeting with ${(0, emailShared_1.safeStr)(schedule.withName, "the requestee")} take place?`;
    const text = [
        `Your recurring meeting "${schedule.title}" with ${schedule.withName} was scheduled for ${date} at ${schedule.time}.`,
        "",
        `Yes, it was held: ${yes}`,
        `No, it was not held: ${no}`,
    ].join("\n");
    const button = (href, label, color) => `<a href="${href}" style="display:inline-block;padding:12px 26px;margin-right:12px;border-radius:999px;background:${color};color:#ffffff;text-decoration:none;font-weight:600">${label}</a>`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171321">
    <h2 style="margin-bottom:4px">Was the meeting held?</h2>
    <p style="color:#5F6472;margin-top:0">${isFollowUp ? "Still waiting for your confirmation." : "A quick confirmation keeps the governance report accurate."}</p>
    <div style="border:1px solid #D9DCE7;border-radius:12px;padding:16px;margin:16px 0">
      <div style="font-weight:700;font-size:16px">${esc(schedule.title)}</div>
      <div style="color:#5F6472">With ${esc(schedule.withName)} &middot; ${esc(date)} at ${esc(schedule.time)}</div>
    </div>
    <p>${button(yes, "Yes, it was held", "#243FFF")}${button(no, "No, it was not", "#C94B5E")}</p>
  </div>`;
    return { subject, text, html };
}
async function sendReminder(schedule, meetingId, date, isFollowUp) {
    const transporter = (0, emailShared_1.getTransporter)();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const content = buildEmail(schedule, meetingId, date, isFollowUp);
    await transporter.sendMail({
        from,
        to: schedule.reminderEmail || DEFAULT_RECIPIENT,
        subject: content.subject,
        html: content.html,
        text: content.text,
    });
}
/**
 * Turns recurring meeting schedules into a pending meeting on each occurrence
 * day, emails the organiser 30 minutes after the start time asking whether it
 * was held, and nudges once a day (up to 3 times) while it stays unanswered.
 */
exports.governanceMeetingReminderCron = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "*/15 * * * *",
    timeZone: TIME_ZONE,
    timeoutSeconds: 120,
    maxInstances: 1,
}, async () => {
    const now = new Date();
    const today = localNow(now);
    const schedules = await emailShared_1.db.collection("governanceMeetingSchedules").where("active", "==", true).get();
    let created = 0;
    let reminded = 0;
    for (const snap of schedules.docs) {
        const schedule = snap.data();
        if (!occursToday(schedule, today))
            continue;
        const [hh, mm] = String(schedule.time || "09:00").split(":").map(Number);
        if (today.minutes < hh * 60 + mm + REMIND_AFTER_MINUTES)
            continue;
        const meetingRef = emailShared_1.db.collection("governanceMeetings").doc(`${snap.id}_${today.date}`);
        try {
            const existing = await meetingRef.get();
            if (!existing.exists) {
                await meetingRef.set({
                    source: "recurring",
                    scheduleId: snap.id,
                    occurrenceDate: today.date,
                    title: schedule.title,
                    status: "pending",
                    withName: schedule.withName,
                    meetingDate: today.date,
                    dueDate: "",
                    discussion: "",
                    challenges: [],
                    requests: "",
                    relatedFeatureIds: [],
                    createdFeatureIds: [],
                    createdBy: schedule.createdBy || "system",
                    createdByName: schedule.createdByName || "Recurring schedule",
                    remindersSent: 0,
                    createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                });
                created += 1;
            }
            const meeting = (existing.exists ? existing.data() : { status: "pending", remindersSent: 0 });
            if (meeting.status !== "pending")
                continue;
            const sent = Number(meeting.remindersSent || 0);
            const lastAt = meeting.lastReminderAt?.toMillis?.() || 0;
            if (sent >= MAX_REMINDERS || (sent > 0 && now.getTime() - lastAt < REMINDER_GAP_MS))
                continue;
            await sendReminder(schedule, meetingRef.id, today.date, sent > 0);
            await meetingRef.update({
                remindersSent: sent + 1,
                lastReminderAt: emailShared_1.admin.firestore.Timestamp.now(),
            });
            reminded += 1;
        }
        catch (error) {
            logger.error("governanceMeetingReminderCron.failed", { scheduleId: snap.id, error: String(error) });
        }
    }
    // Follow-up nudges for earlier occurrences that are still unanswered.
    const open = await emailShared_1.db
        .collection("governanceMeetings")
        .where("source", "==", "recurring")
        .where("status", "==", "pending")
        .get();
    for (const snap of open.docs) {
        const meeting = snap.data();
        if (meeting.occurrenceDate === today.date)
            continue;
        const sent = Number(meeting.remindersSent || 0);
        const lastAt = meeting.lastReminderAt?.toMillis?.() || 0;
        if (sent >= MAX_REMINDERS || now.getTime() - lastAt < REMINDER_GAP_MS || today.minutes < 8 * 60)
            continue;
        const scheduleSnap = await emailShared_1.db.collection("governanceMeetingSchedules").doc(String(meeting.scheduleId)).get();
        if (!scheduleSnap.exists)
            continue;
        try {
            await sendReminder(scheduleSnap.data(), snap.id, meeting.occurrenceDate, true);
            await snap.ref.update({ remindersSent: sent + 1, lastReminderAt: emailShared_1.admin.firestore.Timestamp.now() });
            reminded += 1;
        }
        catch (error) {
            logger.error("governanceMeetingReminderCron.followUpFailed", { meetingId: snap.id, error: String(error) });
        }
    }
    logger.info("governanceMeetingReminderCron.complete", { created, reminded });
});
//# sourceMappingURL=governanceMeetingReminders.js.map