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
exports.taskDeadlineNotifier = exports.onTaskWriteSendEmails = exports.onApplicationDecisionEmail = exports.sendEmail = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailHelpers_1 = require("./emailHelpers");
const emailShared_1 = require("./emailShared");
function buildAssignmentEmailHTML(opts) {
    const due = opts.task.dueAt?.toDate?.() ? (0, emailShared_1.fmtDate)(opts.task.dueAt.toDate()) : "—";
    const start = opts.task.startAt?.toDate?.() ? (0, emailShared_1.fmtDate)(opts.task.startAt.toDate()) : "—";
    return `
<div style="font-family: Inter, Helvetica, Arial, sans-serif; line-height:1.55">
<p>Hi ${opts.toName || "there"},</p>
<p>You’ve been <b>assigned</b> a task:</p>
<p><b>${opts.task.title}</b></p>
<p style="margin:8px 0">${(opts.task.description || "").replace(/\n/g, "<br/>")}</p>
<table style="font-size:14px">
<tr><td><b>Program:</b></td><td style="padding-left:8px">${opts.programName || opts.task.programId}</td></tr>
<tr><td><b>Department:</b></td><td style="padding-left:8px">${opts.departmentName || opts.task.departmentId}</td></tr>
<tr><td><b>Start:</b></td><td style="padding-left:8px">${start}</td></tr>
<tr><td><b>Due:</b></td><td style="padding-left:8px">${due}</td></tr>
<tr><td><b>Priority:</b></td><td style="padding-left:8px">${opts.task.priority.toUpperCase()}</td></tr>
</table>
<p style="margin-top:16px">Please log in to update status or add notes.</p>
</div>`;
}
function buildReminderEmailHTML(opts) {
    const due = opts.task.dueAt?.toDate?.() ? (0, emailShared_1.fmtDate)(opts.task.dueAt.toDate()) : "—";
    const severity = opts.type === "overdue" ? "OVERDUE" : "DUE SOON";
    const bannerColor = opts.type === "overdue" ? "#ff4d4f" : "#faad14";
    const bannerText = opts.type === "overdue" ? "Overdue" : "Due within 24 hours";
    return `
<div style="font-family: Inter, Helvetica, Arial, sans-serif; line-height:1.55">
<div style="padding:8px 12px; background:${bannerColor}; color:#fff; display:inline-block; border-radius:6px; font-weight:600">${bannerText}</div>
<p style="margin-top:16px">Hi ${opts.toName || "there"},</p>
<p>The following task is <b>${severity}</b>:</p>
<p><b>${opts.task.title}</b></p>
<p style="margin:8px 0">${(opts.task.description || "").replace(/\n/g, "<br/>")}</p>
<table style="font-size:14px">
<tr><td><b>Program:</b></td><td style="padding-left:8px">${opts.programName || opts.task.programId}</td></tr>
<tr><td><b>Department:</b></td><td style="padding-left:8px">${opts.departmentName || opts.task.departmentId}</td></tr>
<tr><td><b>Due:</b></td><td style="padding-left:8px">${due}</td></tr>
<tr><td><b>Status:</b></td><td style="padding-left:8px">${opts.task.status.toUpperCase()}</td></tr>
<tr><td><b>Priority:</b></td><td style="padding-left:8px">${opts.task.priority.toUpperCase()}</td></tr>
</table>
<p style="margin-top:16px">Please log in and update/complete the task.</p>
</div>`;
}
exports.sendEmail = (0, https_1.onRequest)({ region: "us-central1", invoker: "public" }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method_not_allowed" });
        return;
    }
    const auth = req.headers.authorization || "";
    const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!idToken) {
        res.status(401).json({ ok: false, error: "missing_id_token" });
        return;
    }
    let uid = "";
    try {
        uid = (await emailShared_1.admin.auth().verifyIdToken(idToken)).uid;
    }
    catch {
        res.status(401).json({ ok: false, error: "invalid_id_token" });
        return;
    }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const transporter = (0, emailShared_1.getTransporter)();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const body = (req.body || {});
    try {
        if ("messages" in body && Array.isArray(body.messages)) {
            const list = body.messages;
            if (!list.length) {
                res.status(400).json({ ok: false, error: "messages_required" });
                return;
            }
            if (list.length > 200) {
                res.status(400).json({ ok: false, error: "too_many_recipients_max_200" });
                return;
            }
            let sent = 0;
            for (const m of list) {
                if (!m?.to || !emailRx.test(m.to)) {
                    res.status(400).json({ ok: false, error: "invalid_to_in_messages" });
                    return;
                }
                if (!m?.subject || typeof m.subject !== "string" || m.subject.length > 200) {
                    res.status(400).json({ ok: false, error: "invalid_subject_in_messages" });
                    return;
                }
                await transporter.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text });
                sent++;
            }
            logger.info("email_sent_personalized", { uid, sent });
            res.status(200).json({ ok: true, mode: "personalized", sent });
            return;
        }
        const { to, subject, text, html } = body;
        if (!subject || typeof subject !== "string" || subject.length > 200) {
            res.status(400).json({ ok: false, error: "invalid_subject" });
            return;
        }
        if ((!text && !html) || (text && typeof text !== "string") || (html && typeof html !== "string")) {
            res.status(400).json({ ok: false, error: "invalid_body" });
            return;
        }
        if (typeof to === "string") {
            if (!to || !emailRx.test(to)) {
                res.status(400).json({ ok: false, error: "invalid_to" });
                return;
            }
            const info = await transporter.sendMail({ from, to, subject, text, html });
            logger.info("email_sent_single", { uid, to, subject, messageId: info.messageId });
            res.status(200).json({ ok: true, mode: "single", messageId: info.messageId });
            return;
        }
        if (Array.isArray(to)) {
            const bccList = to.filter(e => emailRx.test(e));
            if (!bccList.length) {
                res.status(400).json({ ok: false, error: "invalid_to_list" });
                return;
            }
            if (bccList.length > 500) {
                res.status(400).json({ ok: false, error: "too_many_recipients_max_500" });
                return;
            }
            const info = await transporter.sendMail({
                from,
                to: from,
                bcc: bccList,
                subject,
                text,
                html,
            });
            logger.info("email_sent_bcc", { uid, count: bccList.length, subject, messageId: info.messageId });
            res.status(200).json({ ok: true, mode: "bcc", sent: bccList.length, messageId: info.messageId });
            return;
        }
        res.status(400).json({ ok: false, error: "missing_to_or_messages" });
        return;
    }
    catch (e) {
        logger.error("email_send_failed", { uid, err: String(e) });
        res.status(502).json({ ok: false, error: "send_failed" });
        return;
    }
});
exports.onApplicationDecisionEmail = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "applications/{appId}" }, async (event) => {
    try {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!after)
            return;
        const prev = String(before?.applicationStatus || "").toLowerCase();
        const next = String(after?.applicationStatus || "").toLowerCase();
        if (prev === next)
            return;
        if (next !== "accepted" && next !== "rejected")
            return;
        const already = after?.notifications?.statusEmail?.[next]?.sentAt ?? null;
        if (already)
            return;
        const to = after?.applicantEmail || after?.email || after?._contact?.email || null;
        if (!to)
            return;
        const name = after?.beneficiaryName || after?.applicantName || after?.businessName || "Applicant";
        const programName = after?.programName || after?.program?.name || null;
        const transporter = (0, emailShared_1.getTransporter)();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        if (next === "accepted") {
            const email = (0, emailHelpers_1.buildAcceptanceEmail)({ name, programName, loginUrl: process.env.APP_LOGIN_URL || "https://lepharosmartinc.co.za/login" });
            await transporter.sendMail({ from, to, subject: email.subject, html: email.html, text: email.text });
        }
        else {
            const { subject, html, text } = (0, emailHelpers_1.buildRejectionEmail)({ name, programName });
            await transporter.sendMail({ from, to, subject, html, text });
        }
        await event.data.after.ref.set({
            notifications: {
                statusEmail: {
                    [next]: {
                        sentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                        to,
                    },
                },
            },
            updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (e) {
        logger.error("onApplicationDecisionEmail.failed", { err: String(e) });
    }
});
exports.onTaskWriteSendEmails = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "tasks/{taskId}" }, async (event) => {
    try {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!after)
            return;
        const taskId = String(event.params.taskId);
        const transporter = (0, emailShared_1.getTransporter)();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const prevIds = new Set((before?.assignees || []).map(a => a.userId));
        const nextIds = new Set((after.assignees || []).map(a => a.userId));
        const added = [...nextIds].filter(id => !prevIds.has(id));
        if (added.length) {
            const consultantMap = await (0, emailShared_1.getConsultantMapByIds)(added);
            const [progSnap, deptSnap] = await Promise.all([
                emailShared_1.db.collection("programs").doc(after.programId).get().catch(() => null),
                emailShared_1.db.collection("departments").doc(after.departmentId).get().catch(() => null),
            ]);
            const programName = progSnap?.exists ? progSnap.data()?.name : null;
            const departmentName = deptSnap?.exists ? deptSnap.data()?.name : null;
            let sent = 0;
            for (const id of added) {
                const c = consultantMap.get(id);
                if (!c?.email)
                    continue;
                const subject = `New Task Assigned: ${after.title}`;
                const html = buildAssignmentEmailHTML({ task: after, taskId, toName: c?.name || null, programName, departmentName });
                const text = `You’ve been assigned a task: ${after.title}\nDue: ${after.dueAt?.toDate?.()?.toISOString() || "—"}`;
                await transporter.sendMail({ from, to: c.email, subject, html, text });
                sent++;
            }
            if (sent)
                logger.info("onTaskWriteSendEmails.assignment_sent", { taskId, sent });
        }
        const becameDone = before?.status !== "done" && after.status === "done";
        if (becameDone && after.createdBy) {
            const creatorSnap = await emailShared_1.db.collection("users").doc(after.createdBy).get().catch(() => null);
            const creatorEmail = creatorSnap?.data()?.email;
            const creatorName = creatorSnap?.data()?.name || null;
            if (creatorEmail) {
                await transporter.sendMail({
                    from,
                    to: creatorEmail,
                    subject: `Task Completed: ${after.title}`,
                    html: `
<div style="font-family:Inter,Arial">
<p>Hi ${creatorName || "there"},</p>
<p>The task <b>${after.title}</b> has been marked <b>Done</b>.</p>
<table style="font-size:14px">
<tr><td><b>Program:</b></td><td style="padding-left:8px">${after.programId || "—"}</td></tr>
<tr><td><b>Department:</b></td><td style="padding-left:8px">${after.departmentId || "—"}</td></tr>
<tr><td><b>Completed at:</b></td><td style="padding-left:8px">${(0, emailShared_1.fmtDate)(new Date())}</td></tr>
</table>
</div>
`,
                    text: `Task completed: ${after.title}`,
                });
                logger.info("onTaskWriteSendEmails.completed_notice_sent", { taskId, to: creatorEmail });
            }
        }
    }
    catch (e) {
        logger.error("onTaskWriteSendEmails.failed", { err: String(e) });
    }
});
exports.taskDeadlineNotifier = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "0 9,13,17 * * *",
    timeZone: "Africa/Johannesburg",
}, async () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const transporter = (0, emailShared_1.getTransporter)();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const q = emailShared_1.db.collection("tasks")
        .where("status", "in", emailShared_1.REMINDER_STATUSES)
        .where("dueAt", "<", emailShared_1.admin.firestore.Timestamp.fromDate(now));
    const snap = await q.limit(1000).get();
    if (snap.empty)
        return;
    for (const d of snap.docs) {
        const task = d.data();
        const taskId = d.id;
        const flags = task.reminderFlags || {};
        if (flags.overdueLastSentDay === todayStr)
            continue;
        const assigneeIds = (task.assignees || []).map(a => a.userId);
        if (!assigneeIds.length)
            continue;
        const consultantMap = await (0, emailShared_1.getConsultantMapByIds)(assigneeIds);
        const [progSnap, deptSnap] = await Promise.all([
            emailShared_1.db.collection("programs").doc(task.programId).get().catch(() => null),
            emailShared_1.db.collection("departments").doc(task.departmentId).get().catch(() => null),
        ]);
        const programName = progSnap?.exists ? progSnap.data()?.name : null;
        const departmentName = deptSnap?.exists ? deptSnap.data()?.name : null;
        let sentAny = false;
        for (const id of assigneeIds) {
            const c = consultantMap.get(id);
            if (!c?.email)
                continue;
            const subject = `Overdue Task: ${task.title}`;
            const html = buildReminderEmailHTML({ task, type: "overdue", toName: c?.name || null, programName, departmentName });
            const text = `The task "${task.title}" is OVERDUE. Due: ${task.dueAt?.toDate?.()?.toISOString() || "—"}`;
            await transporter.sendMail({ from, to: c.email, subject, html, text });
            sentAny = true;
        }
        if (sentAny) {
            await d.ref.set({
                reminderFlags: {
                    ...(task.reminderFlags || {}),
                    overdueLastSentDay: todayStr,
                    lastReminderAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                },
                updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            logger.info("taskDeadlineNotifier.overdue_sent", { taskId });
        }
    }
});
//# sourceMappingURL=emailApplications.js.map