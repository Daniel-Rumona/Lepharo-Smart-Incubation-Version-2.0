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
exports.onInterventionReminderQueuedEmail = exports.onAssignedInterventionEmail = exports.onInterventionRequestDecisionEmail = exports.onResourceRequestDecisionEmail = exports.onLeaveRequestDecisionEmail = exports.sendInterventionReminderEmail = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const emailShared_1 = require("./emailShared");
const brevoClient_1 = require("./brevoClient");
const REGION = "us-central1";
const FROM = () => process.env.SMTP_FROM || process.env.SMTP_USER;
const LOGIN_URL = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
/** Sends and logs a direct SME intervention reminder without creating a
 * notifications document. The client supplies only the assignment context;
 * the recipient is resolved server-side from the participant record. */
exports.sendInterventionReminderEmail = (0, https_1.onRequest)({ region: REGION, cors: true }, (req, res) => {
    (async () => {
        let recipientEmail = null;
        let participantId = '';
        let programId = null;
        let subject = 'Reminder: action required on your intervention';
        try {
            const match = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
            if (!match)
                return res.status(401).json({ ok: false, error: 'Missing or invalid auth.' });
            await emailShared_1.admin.auth().verifyIdToken(match[1]);
            const body = req.body || {};
            participantId = clean(body.participantId);
            programId = clean(body.programId) || null;
            const interventionTitle = clean(body.interventionTitle) || 'your intervention';
            const participantName = clean(body.participantName);
            const reminderReason = clean(body.reminderReason) || 'confirmation';
            if (!participantId)
                return res.status(400).json({ ok: false, error: 'Missing participantId.' });
            const recipient = await participant({
                participantId,
                participantEmail: body.participantEmail,
                participantName,
            });
            recipientEmail = recipient.email;
            if (!recipientEmail)
                return res.status(422).json({ ok: false, error: 'No valid participant email found.' });
            subject = `Reminder: action required for ${interventionTitle}`;
            const action = reminderReason === 'confirmation'
                ? 'Please confirm completion of this intervention in the incubatee dashboard.'
                : 'Please review and respond to this intervention in the incubatee dashboard.';
            const content = buildNotificationContent('Intervention reminder', [
                `Hello ${recipient.name || participantName || 'there'},`,
                action,
                interventionTitle,
            ], '/incubatee/interventions');
            const { messageId } = await (0, brevoClient_1.sendViaBrevo)({ to: recipientEmail, subject, html: content.html, text: content.text, tags: ['intervention-reminder'] });
            await (0, brevoClient_1.logBrevoSend)({ type: 'INTERVENTION_REMINDER', to: recipientEmail, subject, status: 'sent', messageId, participantId, programId });
            return res.status(200).json({ ok: true, sent: 1, email: recipientEmail });
        }
        catch (err) {
            const error = String(err?.message || err);
            await (0, brevoClient_1.logBrevoSend)({ type: 'INTERVENTION_REMINDER', to: recipientEmail || '', subject, status: 'failed', error, participantId: participantId || null, programId });
            logger.error('sendInterventionReminderEmail.failed', { error, participantId, programId });
            return res.status(500).json({ ok: false, error: error || 'Failed to send reminder.' });
        }
    })();
});
function clean(value) {
    return String(value ?? "").trim();
}
function email(value) {
    const result = clean(value).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null;
}
function esc(value) {
    return clean(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function status(value) {
    return clean(value).toLowerCase();
}
function changedTo(before, after, allowed) {
    const next = status(after.status);
    return allowed.includes(next) && (!before || status(before.status) !== next);
}
function notificationPatch(key, state, to) {
    return {
        [`emailNotifications.${key}.${state}.sentAt`]: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        [`emailNotifications.${key}.${state}.to`]: to,
    };
}
function buildNotificationContent(heading, lines, actionPath) {
    const safeLines = lines.filter(Boolean);
    const actionUrl = actionPath ? `${LOGIN_URL}${actionPath}` : LOGIN_URL;
    const html = `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6">
    <h2>${esc(heading)}</h2>
    ${safeLines.map((line) => `<p>${esc(line)}</p>`).join("")}
    <p><a href="${esc(actionUrl)}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px">Open Smart Incubation</a></p>
    <p>Regards,<br><b>Lepharo Smart Incubation System</b></p>
  </div>`;
    const text = `${heading}\n\n${safeLines.join("\n\n")}\n\nOpen Smart Incubation: ${actionUrl}`;
    return { html, text };
}
async function send(to, subject, heading, lines, actionPath) {
    const { html, text } = buildNotificationContent(heading, lines, actionPath);
    await (0, emailShared_1.getTransporter)().sendMail({ from: FROM(), to, subject, html, text });
}
async function userEmail(data) {
    const direct = [
        data.userEmail, data.requesterEmail, data.requestedByEmail,
        data.participantEmail, data.applicantEmail, data.email,
    ].map(email).find(Boolean);
    if (direct)
        return direct;
    if (email(data.requestedBy))
        return email(data.requestedBy);
    const id = clean(data.userId || data.requesterId || data.requestedByUid);
    if (!id)
        return null;
    const snap = await emailShared_1.db.collection("users").doc(id).get();
    return email(snap.data()?.email);
}
async function participant(data) {
    const direct = email(data.participantEmail || data.applicantEmail || data.userEmail);
    const id = clean(data.participantId);
    if (direct)
        return { email: direct, name: clean(data.participantName || data.beneficiaryName) || "Participant" };
    if (id) {
        const p = await emailShared_1.db.collection("participants").doc(id).get();
        if (p.exists) {
            const d = p.data() || {};
            return {
                email: email(d.email || d.contactEmail),
                name: clean(d.beneficiaryName || d.participantName || data.participantName) || "Participant",
            };
        }
        const apps = await emailShared_1.db.collection("applications").where("participantId", "==", id).limit(1).get();
        if (!apps.empty) {
            const d = apps.docs[0].data();
            return {
                email: email(d.applicantEmail || d.email),
                name: clean(d.applicantName || d.businessOwnerName || data.participantName) || "Participant",
            };
        }
    }
    return { email: null, name: clean(data.participantName || data.beneficiaryName) || "Participant" };
}
async function assignee(data) {
    const direct = email(data.assigneeEmail);
    const id = clean(data.assigneeId);
    if (direct)
        return { email: direct, name: clean(data.assigneeName) || "Facilitator" };
    if (id) {
        for (const collection of ["coordinators", "users"]) {
            const snap = await emailShared_1.db.collection(collection).doc(id).get();
            if (snap.exists) {
                const d = snap.data() || {};
                const found = email(d.email);
                if (found)
                    return { email: found, name: clean(d.name || d.displayName || data.assigneeName) || "Facilitator" };
            }
        }
    }
    return { email: null, name: clean(data.assigneeName) || "Facilitator" };
}
exports.onLeaveRequestDecisionEmail = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "leaveRequests/{requestId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || !changedTo(before, after, ["approved", "rejected"]))
        return;
    const decision = status(after.status);
    const to = await userEmail(after);
    if (!to)
        return logger.warn("leave_email.no_recipient", { requestId: event.params.requestId });
    await send(to, `Leave request ${decision}`, "Leave request decision", [
        `Hello ${clean(after.userName) || "there"},`,
        `Your ${clean(after.type || after.leaveType) || "leave"} request has been ${decision}.`,
        after.from || after.startDate ? `From: ${clean(after.from || after.startDate)}` : "",
        after.to || after.endDate ? `To: ${clean(after.to || after.endDate)}` : "",
        decision === "rejected" && after.rejectionReason ? `Reason: ${clean(after.rejectionReason)}` : "",
    ], "/operations/hr/leave");
    await event.data.after.ref.update(notificationPatch("leaveDecision", decision, to));
});
exports.onResourceRequestDecisionEmail = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "resourceRequests/{requestId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || !changedTo(before, after, ["approved", "rejected"]))
        return;
    const decision = status(after.status);
    const to = await userEmail(after);
    if (!to)
        return logger.warn("resource_email.no_recipient", { requestId: event.params.requestId });
    await send(to, `Resource request ${decision}`, "Resource request decision", [
        `Your request for ${clean(after.resourceName) || "a resource"} has been ${decision}.`,
        after.purpose ? `Purpose: ${clean(after.purpose)}` : "",
        decision === "rejected" && after.rejectionReason ? `Reason: ${clean(after.rejectionReason)}` : "",
    ], "/resources/internal");
    await event.data.after.ref.update(notificationPatch("resourceDecision", decision, to));
});
exports.onInterventionRequestDecisionEmail = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "interventionRequests/{requestId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || !changedTo(before, after, ["accepted", "approved", "rejected", "declined"]))
        return;
    const decision = status(after.status);
    const recipient = await participant(after);
    if (!recipient.email)
        return logger.warn("intervention_request_email.no_recipient", { requestId: event.params.requestId });
    await send(recipient.email, `Intervention request ${decision}`, "Intervention request decision", [
        `Hello ${recipient.name},`,
        `Your request for ${clean(after.interventionTitle || after.areaOfSupport) || "an intervention"} has been ${decision}.`,
        after.reason ? `Your request: ${clean(after.reason)}` : "",
        (decision === "rejected" || decision === "declined") && after.rejectionReason
            ? `Reason: ${clean(after.rejectionReason)}` : "",
    ], "/incubatee/interventions");
    await event.data.after.ref.update(notificationPatch("interventionDecision", decision, recipient.email));
});
exports.onAssignedInterventionEmail = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "assignedInterventions/{assignmentId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after)
        return;
    const ref = event.data.after.ref;
    const title = clean(after.interventionTitle || after.title) || "Intervention";
    if (!before || clean(before.assigneeId) !== clean(after.assigneeId)) {
        const assigned = await assignee(after);
        const sme = await participant(after);
        if (assigned.email) {
            await send(assigned.email, `Intervention assigned: ${title}`, "New intervention assignment", [
                `Hello ${assigned.name},`,
                `${title} has been assigned to you for ${sme.name}.`,
                after.dueDate ? `Due date: ${clean(after.dueDate)}` : "",
            ], "/coordinator/allocated");
            await ref.update(notificationPatch("assignment", "assignee", assigned.email));
        }
        if (sme.email) {
            await send(sme.email, `Intervention assigned: ${title}`, "Your intervention has been assigned", [
                `Hello ${sme.name},`,
                `${title} has been assigned to ${assigned.name}.`,
                "Please sign in to review and accept the intervention.",
            ], "/incubatee/interventions");
            await ref.update(notificationPatch("assignment", "participant", sme.email));
        }
    }
    if (before && status(before.assigneeCompletionStatus) !== "completed" &&
        status(after.assigneeCompletionStatus) === "completed") {
        const sme = await participant(after);
        if (sme.email) {
            await send(sme.email, `Please confirm completion: ${title}`, "Completion confirmation required", [
                `Hello ${sme.name},`,
                `The facilitator marked ${title} as completed.`,
                "Please review the work and confirm or reject completion.",
            ], "/incubatee/interventions");
            await ref.update(notificationPatch("assignmentLifecycle", "completionRequested", sme.email));
        }
    }
    if (before && status(before.participantAcceptanceStatus) !== status(after.participantAcceptanceStatus) &&
        ["accepted", "declined"].includes(status(after.participantAcceptanceStatus))) {
        const assigned = await assignee(after);
        if (assigned.email) {
            const decision = status(after.participantAcceptanceStatus);
            await send(assigned.email, `Participant ${decision}: ${title}`, "Intervention acceptance update", [
                `${clean(after.participantName) || "The participant"} has ${decision} ${title}.`,
            ], "/coordinator/allocated");
            await ref.update(notificationPatch("assignmentLifecycle", `participant${decision}`, assigned.email));
        }
    }
    if (before && status(before.participantCompletionStatus) !== status(after.participantCompletionStatus) &&
        ["confirmed", "rejected"].includes(status(after.participantCompletionStatus))) {
        const assigned = await assignee(after);
        if (assigned.email) {
            const decision = status(after.participantCompletionStatus);
            await send(assigned.email, `Completion ${decision}: ${title}`, "Completion review update", [
                `${clean(after.participantName) || "The participant"} has ${decision} completion of ${title}.`,
            ], "/coordinator/allocated");
            await ref.update(notificationPatch("assignmentLifecycle", `completion${decision}`, assigned.email));
        }
    }
});
exports.onInterventionReminderQueuedEmail = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "notifications/{notificationId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (before || !after || status(after.type) !== "intervention_reminder")
        return;
    const recipient = await participant(after);
    if (!recipient.email)
        return logger.warn("intervention_reminder_email.no_recipient", { notificationId: event.params.notificationId });
    const title = clean(after.interventionTitle) || "your intervention";
    const subject = `Reminder: action required for ${title}`;
    const { html, text } = buildNotificationContent("Intervention reminder", [
        `Hello ${recipient.name},`,
        clean(after.message) || (status(after.reminderReason) === "completion"
            ? "Please confirm completion of your intervention."
            : "Please accept the intervention assigned to you."),
    ], "/incubatee/interventions");
    const participantId = clean(after.participantId) || null;
    const programId = clean(after.programId) || null;
    try {
        const { messageId } = await (0, brevoClient_1.sendViaBrevo)({ to: recipient.email, subject, html, text, tags: ["intervention-reminder"] });
        await (0, brevoClient_1.logBrevoSend)({ type: "INTERVENTION_REMINDER", to: recipient.email, subject, status: "sent", messageId, participantId, programId });
    }
    catch (err) {
        const msg = String(err?.message || err);
        await (0, brevoClient_1.logBrevoSend)({ type: "INTERVENTION_REMINDER", to: recipient.email, subject, status: "failed", error: msg, participantId, programId });
        logger.error("intervention_reminder_email.failed", { notificationId: event.params.notificationId, error: msg });
        return;
    }
    await event.data.after.ref.update({
        emailSentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        emailSentTo: recipient.email,
    });
});
//# sourceMappingURL=workflowEmailFunctions.js.map