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
exports.appointmentCompletionNotifier = exports.onAppointmentWriteNotifyIncubatee = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailHelpers_1 = require("./emailHelpers");
const emailShared_1 = require("./emailShared");
const timestampKey = (value) => {
    if (typeof value?.toMillis === "function")
        return String(value.toMillis());
    if (value instanceof Date)
        return String(value.getTime());
    return String(value || "");
};
const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
async function resolveAppointmentAssigneeEmail(appt) {
    const direct = String(appt.assigneeEmail || "").trim().toLowerCase();
    if (direct.includes("@"))
        return direct;
    const ids = Array.from(new Set([
        appt.assigneeId,
        appt.consultantId,
    ].map(value => String(value || "").trim()).filter(Boolean)));
    for (const id of ids) {
        for (const collectionName of ["coordinators", "consultants", "users"]) {
            const snap = await emailShared_1.db.collection(collectionName).doc(id).get().catch(() => null);
            const email = String(snap?.data()?.email || "").trim().toLowerCase();
            if (email.includes("@"))
                return email;
        }
    }
    return "";
}
async function notifyAssigneeOfRescheduleProposal(apptId, appt) {
    const request = appt.rescheduleRequest || {};
    const proposals = Array.isArray(request.proposals) ? request.proposals : [];
    if (!proposals.length)
        return;
    const recipient = await resolveAppointmentAssigneeEmail(appt);
    if (!recipient) {
        logger.warn("appointment_reschedule_proposal.skip_no_assignee_email", { apptId });
        return;
    }
    const base = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
    const actionPath = String(appt.assigneeRole || "").toLowerCase() === "operations"
        ? "/operations/interventions/appointments"
        : "/coordinator/appointments";
    const actionUrl = `${base}${actionPath}`;
    const rows = proposals.map((proposal, index) => {
        const start = (0, emailShared_1.toDate)(proposal.startTime);
        const end = (0, emailShared_1.toDate)(proposal.endTime);
        const time = start && end
            ? `${start.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`
            : "Time unavailable";
        return `<li><strong>Option ${index + 1}:</strong> ${escapeHtml(proposal.date || "")} ${escapeHtml(time)}</li>`;
    }).join("");
    const participantName = appt.participantName || request.proposedByName || "The SME";
    const interventionTitle = appt.interventionTitle || "Appointment";
    const subject = `Alternative appointment times proposed: ${interventionTitle}`;
    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px;color:#111827">
  <p>Hi ${escapeHtml(appt.assigneeName || appt.consultantName || "there")},</p>
  <p><strong>${escapeHtml(participantName)}</strong> declined the current appointment for <strong>${escapeHtml(interventionTitle)}</strong> and proposed alternative times.</p>
  <p><strong>Reason:</strong> ${escapeHtml(request.reasonText || "Not provided")}</p>
  <ul>${rows}</ul>
  <p>Open the appointment details to accept one of these options or choose a different time.</p>
  <p><a href="${actionUrl}" style="display:inline-block;padding:11px 18px;background:#1677ff;color:#fff;text-decoration:none;border-radius:7px;font-weight:600">Review Proposed Times</a></p>
  <p>Regards,<br/><strong>Lepharo Smart Incubation System</strong></p>
</div>`;
    const text = [
        `${participantName} declined the current appointment for ${interventionTitle}.`,
        `Reason: ${request.reasonText || "Not provided"}`,
        ...proposals.map((proposal, index) => {
            const start = (0, emailShared_1.toDate)(proposal.startTime);
            const end = (0, emailShared_1.toDate)(proposal.endTime);
            const time = start && end
                ? `${start.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`
                : "Time unavailable";
            return `Option ${index + 1}: ${proposal.date || ""} ${time}`;
        }),
        `Review: ${actionUrl}`,
    ].join("\n");
    const transporter = (0, emailShared_1.getTransporter)();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await transporter.sendMail({ from, to: recipient, subject, html, text });
    logger.info("appointment_reschedule_proposal.sent", { apptId, to: recipient });
}
exports.onAppointmentWriteNotifyIncubatee = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "appointments/{apptId}" }, async (event) => {
    try {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!after)
            return;
        const proposalSubmitted = after.rescheduleRequest?.status === "proposed" &&
            timestampKey(after.rescheduleRequest?.proposedAt) !==
                timestampKey(before?.rescheduleRequest?.proposedAt);
        if (proposalSubmitted) {
            try {
                await notifyAssigneeOfRescheduleProposal(event.params.apptId, after);
            }
            catch (error) {
                logger.error("appointment_reschedule_proposal.failed", {
                    apptId: event.params.apptId,
                    err: String(error),
                });
            }
        }
        const created = !before && !!after;
        const cancelled = !!before && before.status !== "cancelled" && after.status === "cancelled";
        // Only customer-facing appointment fields constitute an update. Metadata,
        // confirmation flags and this function's own delivery marker must not
        // recursively generate another email.
        const rescheduled = !!before && !cancelled && (0, emailHelpers_1.coreChanged)(before, after);
        if (!created && !rescheduled && !cancelled)
            return;
        const pSnap = await emailShared_1.db.collection("participants").doc(after.participantId).get().catch(() => null);
        const participantEmail = pSnap?.data()?.email || null;
        const participantName = pSnap?.data()?.beneficiaryName || after.participantName || "Participant";
        const participantPhone = pSnap?.data()?.phone || null;
        if (!participantEmail) {
            logger.warn("appointment_notify.skip_no_email", { apptId: event.params.apptId, participantId: after.participantId });
            return;
        }
        const start = (0, emailShared_1.toDate)(after.startTime);
        const end = (0, emailShared_1.toDate)(after.endTime);
        if (!start || !end) {
            logger.warn("appointment_notify.skip_no_times", { apptId: event.params.apptId });
            return;
        }
        const transporter = (0, emailShared_1.getTransporter)();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const subjectBase = `${after.interventionTitle} with ${after.consultantName}`;
        const subject = cancelled ? `Cancelled: ${subjectBase}` : rescheduled ? `Updated: ${subjectBase}` : `Appointment Scheduled: ${subjectBase}`;
        const html = (0, emailHelpers_1.buildAppointmentEmailHTML)({ appt: after, start, end, participantName, participantPhone, type: cancelled ? "cancelled" : rescheduled ? "updated" : "created" });
        const ics = cancelled ? undefined : {
            filename: "appointment.ics",
            content: (0, emailHelpers_1.buildICS)({ uid: `${event.params.apptId}@lepharosmartinc.co.za`, appt: after, start, end, organizerEmail: from }),
            contentType: "text/calendar; method=PUBLISH; charset=UTF-8",
        };
        await transporter.sendMail({
            from,
            to: participantEmail,
            subject,
            html,
            text: `Appointment ${cancelled ? "cancelled" : rescheduled ? "updated" : "scheduled"}: ${after.interventionTitle} with ${after.consultantName}
When: ${after.date} ${start.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
Where: ${(0, emailShared_1.formatWhere)(after, participantPhone)}`,
            attachments: ics ? [ics] : undefined,
        });
        logger.info("appointment_notify.sent", {
            apptId: event.params.apptId,
            to: participantEmail,
            type: created ? "created" : cancelled ? "cancelled" : "updated",
        });
        await event.data.after.ref.set({
            notificationFlags: {
                lastSentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                lastType: created ? "created" : cancelled ? "cancelled" : "updated",
            },
        }, { merge: true });
    }
    catch (e) {
        logger.error("onAppointmentWriteNotifyIncubatee.failed", { err: String(e) });
    }
});
function buildAppointmentCompletionEmail(opts) {
    const { consultantName, participantName, interventionTitle, date, startTime, endTime, updateUrl } = opts;
    const fmt = (d) => d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
    const subject = `Coverage required: ${interventionTitle}`;
    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px;color:#111827">
  <p>Hi ${consultantName || "there"},</p>
  <p>Your session with <strong>${participantName}</strong> for <strong>${interventionTitle}</strong> has ended.</p>
  <p>Please record whether the meeting took place and add the required coverage. If it did not take place, select the reason so the outcome is visible to Operations.</p>
  <table style="border-collapse:collapse;font-size:14px;margin:12px 0;min-width:320px">
    <tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Date</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${date}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Time</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${fmt(startTime)} – ${fmt(endTime)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Participant</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${participantName}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Intervention</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${interventionTitle}</td></tr>
  </table>
  <p style="margin:16px 0 8px">Click below to open the appointment and record its coverage:</p>
  <a href="${updateUrl}" target="_blank" rel="noopener noreferrer"
     style="display:inline-block;background:#0ea5e9;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;line-height:20px;">
    Add Meeting Coverage
  </a>
  <p style="margin-top:16px;font-size:12px;color:#6b7280">
    If the button above doesn't work, copy and paste this link in your browser:<br/>
    <a href="${updateUrl}" style="color:#0ea5e9;word-break:break-all;">${updateUrl}</a>
  </p>
  <p style="margin-top:24px">Regards,<br/><b>Lepharo Smart Incubation System</b></p>
</div>`;
    const text = [
        `Hi ${consultantName || "there"},`,
        ``,
        `Your session with ${participantName} for "${interventionTitle}" has ended.`,
        `Date: ${date}`,
        `Time: ${fmt(startTime)} – ${fmt(endTime)}`,
        ``,
        `Please record whether the meeting took place and add its coverage:`,
        updateUrl,
        ``,
        `Regards,`,
        `Lepharo Smart Incubation System`,
    ].join("\n");
    return { subject, html, text };
}
exports.appointmentCompletionNotifier = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "*/30 * * * *",
    timeZone: "Africa/Johannesburg",
}, async () => {
    const now = emailShared_1.admin.firestore.Timestamp.now();
    const transporter = (0, emailShared_1.getTransporter)();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const base = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
    const snap = await emailShared_1.db
        .collection("appointments")
        .where("status", "in", ["scheduled", "pending", "in_progress", "completed"])
        .where("endTime", "<=", now)
        .limit(500)
        .get();
    if (snap.empty)
        return;
    const reminderDay = new Date().toLocaleDateString("en-CA", {
        timeZone: "Africa/Johannesburg",
    });
    const uncoveredGroups = new Map();
    for (const appointmentDoc of snap.docs) {
        const appointment = appointmentDoc.data();
        if (appointment.sessionCoverage?.latest)
            continue;
        const groupKey = String(appointment.appointmentGroupKey || appointmentDoc.id);
        const members = uncoveredGroups.get(groupKey) || [];
        members.push(appointmentDoc);
        uncoveredGroups.set(groupKey, members);
    }
    for (const [groupKey, appointmentDocs] of uncoveredGroups) {
        const representativeDoc = appointmentDocs[0];
        const appt = representativeDoc.data();
        const apptId = representativeDoc.id;
        const alreadyRemindedToday = appointmentDocs.every(appointmentDoc => {
            const appointment = appointmentDoc.data();
            return appointment.coverageReminder?.lastSentDay === reminderDay ||
                appointment.coverageReminder?.lastAttemptDay === reminderDay;
        });
        if (alreadyRemindedToday)
            continue;
        try {
            const recipientEmail = await resolveAppointmentAssigneeEmail(appt);
            if (!recipientEmail) {
                logger.warn("appointmentCompletionNotifier.no_email", {
                    apptId,
                    assigneeId: appt.assigneeId || appt.consultantId,
                });
                await Promise.all(appointmentDocs.map(appointmentDoc => appointmentDoc.ref.set({
                    coverageReminder: {
                        ...appointmentDoc.data().coverageReminder,
                        lastAttemptDay: reminderDay,
                    },
                    updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true })));
                continue;
            }
            const updateUrl = String(appt.assigneeRole || "").toLowerCase() === "operations"
                ? `${base}/operations/interventions/appointments`
                : `${base}/coordinator/appointments`;
            const startDate = (0, emailShared_1.toDate)(appt.startTime);
            const endDate = (0, emailShared_1.toDate)(appt.endTime);
            if (!startDate || !endDate) {
                logger.warn("appointmentCompletionNotifier.no_times", { apptId });
                continue;
            }
            const { subject, html, text } = buildAppointmentCompletionEmail({
                consultantName: appt.assigneeName || appt.consultantName || "Facilitator",
                participantName: appointmentDocs.length > 1
                    ? `${appointmentDocs.length} SMEs`
                    : appt.participantName || "Participant",
                interventionTitle: appt.interventionTitle || "Intervention",
                date: appt.date,
                startTime: startDate,
                endTime: endDate,
                updateUrl,
            });
            await transporter.sendMail({ from, to: recipientEmail, subject, html, text });
            await Promise.all(appointmentDocs.map(appointmentDoc => {
                const appointment = appointmentDoc.data();
                return appointmentDoc.ref.set({
                    appointmentEndedEmailSent: true,
                    coverageReminder: {
                        ...appointment.coverageReminder,
                        lastSentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                        lastSentDay: reminderDay,
                        lastAttemptDay: reminderDay,
                        sentCount: Number(appointment.coverageReminder?.sentCount || 0) + 1,
                    },
                    updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }));
            logger.info("appointmentCompletionNotifier.sent", {
                apptId,
                groupKey,
                appointmentCount: appointmentDocs.length,
                to: recipientEmail,
                updateUrl,
            });
        }
        catch (e) {
            logger.error("appointmentCompletionNotifier.failed", { apptId, err: String(e) });
        }
    }
});
//# sourceMappingURL=emailAppointments.js.map