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
exports.devPlanReminderCron = exports.sendDevPlanReminders = exports.onDevPlanEditRequestEmail = exports.remindSmmeDpConfirmation = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const syntheticData_1 = require("./syntheticData");
const emailHelpers_1 = require("./emailHelpers");
const emailShared_1 = require("./emailShared");
const brevoClient_1 = require("./brevoClient");
const inAppNotifications_1 = require("./inAppNotifications");
const movRecipients_1 = require("./movRecipients");
const config_1 = require("./config");
const departmentRoles_1 = require("./departmentRoles");
const normalizeEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
exports.remindSmmeDpConfirmation = (0, https_1.onRequest)({ ...config_1.BREVO_EGRESS, region: "us-central1", cors: true }, (req, res) => {
    (async () => {
        let programId;
        let participantId;
        let email = "";
        try {
            const authHeader = (req.headers.authorization || "").toString();
            const match = authHeader.match(/^Bearer (.+)$/);
            if (!match)
                return res.status(401).json({ ok: false, error: "Missing or invalid auth." });
            await emailShared_1.admin.auth().verifyIdToken(match[1]);
            const { programId: bodyProgramId, participantId: bodyParticipantId, reminderFromDeptId, reminderFromDeptName, submittedCount, totalCount, } = req.body || {};
            programId = bodyProgramId;
            participantId = bodyParticipantId;
            if (!programId || !participantId || !reminderFromDeptName) {
                return res.status(400).json({ ok: false, error: "Missing required fields." });
            }
            const appsRef = emailShared_1.admin.firestore().collection("applications");
            const q1 = await appsRef
                .where("programId", "==", programId)
                .where("participantId", "==", participantId)
                .limit(1)
                .get();
            const appDoc = !q1.empty ? q1.docs[0].data() : null;
            if ((0, syntheticData_1.suppressRecordNotifications)(appDoc) || (0, syntheticData_1.suppressRecordNotifications)({ programId, participantId })) {
                return res.status(200).json({ ok: true, suppressed: true });
            }
            const rawEmail = appDoc?.email || appDoc?.applicantEmail || appDoc?.participantEmail || "";
            email = normalizeEmail(rawEmail);
            if (!email || !isValidEmail(email)) {
                logger.warn("remindSmmeDpConfirmation.invalid_email", {
                    participantId,
                    programId: programId || null,
                    rawEmail,
                });
                return res.status(422).json({ ok: false, error: "Invalid participant email." });
            }
            const name = appDoc?.beneficiaryName || appDoc?.participantName || "there";
            const confirmUrl = `${emailShared_1.APP_BASE_URL}/incubatee/roadmap` +
                `?programId=${encodeURIComponent(programId)}` +
                `&participantId=${encodeURIComponent(participantId)}` +
                (reminderFromDeptId ? `&deptId=${encodeURIComponent(reminderFromDeptId)}` : "");
            const { subject, html, text } = (0, emailHelpers_1.buildSmmeDpReminderEmail)({
                name,
                programName: null,
                confirmUrl,
                deptConfirmed: submittedCount,
                deptTotal: totalCount,
                reminderFromDeptName,
            });
            const { messageId } = await (0, brevoClient_1.sendViaBrevo)({ to: email, subject, html, text, tags: ["dev-plan-sme-reminder"] });
            await (0, inAppNotifications_1.notifyInApp)({
                type: "dev_plan_confirmation_reminder",
                message: `${reminderFromDeptName} is waiting for you to confirm your development plan (${submittedCount}/${totalCount} departments confirmed).`,
                recipientIds: [await (0, inAppNotifications_1.uidForParticipant)(participantId, email)],
                participantId,
                programId,
                link: confirmUrl.slice(emailShared_1.APP_BASE_URL.length),
            });
            await (0, brevoClient_1.logBrevoSend)({
                type: "DEV_PLAN_SME_REMINDER",
                to: email,
                subject,
                status: "sent",
                messageId,
                participantId,
                programId,
            });
            return res.status(200).json({ ok: true, sent: 1 });
        }
        catch (err) {
            const msg = String(err?.message || "");
            const looksLikeInvalidRecipient = /invalid recipient|user unknown|no such user|recipient rejected|550|invalid email/i.test(msg);
            await (0, brevoClient_1.logBrevoSend)({
                type: "DEV_PLAN_SME_REMINDER",
                to: email,
                subject: "Developmental Plan confirmation reminder",
                status: "failed",
                error: msg,
                participantId,
                programId,
            });
            if (looksLikeInvalidRecipient && email) {
                const suppressRef = emailShared_1.admin.firestore().collection("emailSuppressions").doc(email);
                await suppressRef.set({
                    to: email,
                    reason: "invalid_recipient",
                    source: "remindSmmeDpConfirmation",
                    type: "DEV_PLAN_SME_REMINDER",
                    programId: programId || null,
                    participantId,
                    lastError: msg,
                    updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            logger.error("remindSmmeDpConfirmation.failed", { message: msg, stack: err?.stack });
            return res.status(500).json({ ok: false, error: msg || "Failed." });
        }
    })();
});
const SKIP_DEPT_ROLES = ['monitoring', 'inhouseFinance', 'rom', 'hr', 'stakeholder'];
async function loadAllDepartments() {
    const { roles, departments } = await (0, departmentRoles_1.loadDepartmentRoles)();
    const out = [];
    for (const data of departments) {
        const name = String(data.name || '').trim();
        if (!name)
            continue;
        if (SKIP_DEPT_ROLES.some((role) => (0, departmentRoles_1.departmentHasRole)(data.id, role, roles, departments)))
            continue;
        const emailsSet = new Set();
        const candidates = [data.email, data.primaryEmail, data.secondaryEmail].filter((v) => typeof v === 'string');
        candidates.forEach((e) => {
            const trimmed = e.trim();
            if (trimmed.includes('@'))
                emailsSet.add(trimmed);
        });
        out.push({ id: data.id, name, emails: Array.from(emailsSet) });
    }
    return out;
}
async function getParticipantMetaCached(participantId, cache) {
    const cached = cache.get(participantId);
    if (cached)
        return cached;
    const appsSnap = await emailShared_1.db.collection('applications').where('participantId', '==', participantId).limit(1).get();
    const app = appsSnap.empty ? undefined : appsSnap.docs[0].data();
    const meta = {
        participantId,
        beneficiaryName: app?.beneficiaryName || app?.participantName || 'Unknown SME',
        programName: app?.programName || 'Program',
    };
    cache.set(participantId, meta);
    return meta;
}
function getPendingDepartmentsForPlan(plan, departments) {
    const confirmedMap = plan.confirmedByDeptId || {};
    return departments.filter((dept) => !confirmedMap[dept.id]);
}
async function runDevPlanReminderOnce(triggerLabel, opts) {
    const transporter = (0, emailShared_1.getTransporter)();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@lepharo.co.za';
    const { programId } = opts;
    const departments = await loadAllDepartments();
    if (!departments.length)
        return { departmentsWithPending: 0, totalDeptEmails: 0, totalPendingAssignments: 0 };
    let plansQuery = emailShared_1.db.collection('diagnosticPlans');
    if (programId)
        plansQuery = plansQuery.where('programId', '==', programId);
    const plansSnap = await plansQuery.get();
    if (plansSnap.empty)
        return { departmentsWithPending: 0, totalDeptEmails: 0, totalPendingAssignments: 0 };
    const participantCache = new Map();
    const pendingByDept = new Map();
    for (const planDoc of plansSnap.docs) {
        const data = planDoc.data();
        if ((0, syntheticData_1.suppressRecordNotifications)(data, planDoc.id))
            continue;
        const participantId = String(data.participantId || planDoc.id);
        const meta = await getParticipantMetaCached(participantId, participantCache);
        const pendingDepartments = getPendingDepartmentsForPlan(data, departments);
        if (!pendingDepartments.length)
            continue;
        for (const dept of pendingDepartments) {
            if (!pendingByDept.has(dept.id))
                pendingByDept.set(dept.id, { dept, items: [] });
            pendingByDept.get(dept.id).items.push({ participantId, beneficiaryName: meta.beneficiaryName, programName: meta.programName });
        }
    }
    if (!pendingByDept.size)
        return { departmentsWithPending: 0, totalDeptEmails: 0, totalPendingAssignments: 0 };
    const planUrl = `${emailShared_1.APP_BASE_URL.replace(/\/$/, '')}/operations/plan`;
    let totalDeptEmails = 0;
    let totalPendingAssignments = 0;
    for (const { dept, items } of pendingByDept.values()) {
        const deptName = dept.name;
        totalPendingAssignments += items.length;
        const recipients = dept.emails.map(email => ({ email }));
        if (!recipients.length)
            continue;
        const subject = `Pending Developmental Plan confirmations – ${deptName}`;
        const rowsHtml = items.map(it => `
<tr>
<td style="padding:4px 8px;border-bottom:1px solid #eee">${it.beneficiaryName}</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee">${it.programName}</td>
</tr>`).join('');
        const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi ${deptName} team,</p>
<p>The following SMEs still require <b>departmental confirmation</b> for their Developmental Plans:</p>
<table style="border-collapse:collapse;font-size:14px;margin:8px 0;min-width:320px">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">SME</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">Program</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<p>Please log in and confirm here:<br/><a href="${planUrl}" target="_blank">${planUrl}</a></p>
<p style="margin-top:16px">Regards,<br/><b>Lepharo Smart Inc AI</b></p>
</div>
`;
        const text = `Pending Developmental Plan confirmations for department ${deptName}:
` +
            items.map(it => `- ${it.beneficiaryName} (${it.programName || 'Program'})`).join('\n') +
            `\nLink: ${planUrl}\nRegards,\nLepharo Smart Inc AI`;
        for (const r of recipients) {
            await transporter.sendMail({ from, to: r.email, subject, html, text });
            totalDeptEmails++;
        }
    }
    const summaryRowsHtml = [...pendingByDept.values()].map(({ dept: { name: deptName }, items }) => `
<tr>
<td style="padding:4px 8px;border-bottom:1px solid #eee">${deptName}</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${items.length}</td>
</tr>`).join('');
    const now = new Date();
    const summarySubject = `Summary: Pending Developmental Plan confirmations (${now.toLocaleDateString('en-ZA')} ${now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })})`;
    const summaryHtml = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi ROM,</p>
<p>Here is the current summary of <b>pending Developmental Plan confirmations</b> by department:</p>
<table style="border-collapse:collapse;font-size:14px;margin:8px 0;min-width:260px">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">Department</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #ccc">SMEs Pending</th></tr></thead>
<tbody>${summaryRowsHtml}</tbody>
</table>
<p>Total departments with outstanding confirmations: <b>${pendingByDept.size}</b></p>
<p>Total SME–department assignments pending: <b>${totalPendingAssignments}</b></p>
<p style="margin-top:16px">Regards,<br/><b>Lepharo Smart Inc AI</b></p>
</div>
`;
    const summaryText = 'Pending Developmental Plan confirmations by department:\n' +
        [...pendingByDept.values()].map(({ dept: { name: deptName }, items }) => `- ${deptName}: ${items.length}`).join('\n') +
        `\nTotal SME–department assignments pending: ${totalPendingAssignments}\nRegards,\nLepharo Smart Inc AI`;
    const summaryRecipients = ['mel@lepharo.co.za', 'daniel@quantilytix.co.za', 'egar@lepharo.co.za'];
    await transporter.sendMail({
        from,
        to: summaryRecipients.join(','),
        subject: summarySubject,
        html: summaryHtml,
        text: summaryText,
    });
    logger.info('devPlanReminder.done', { trigger: triggerLabel, departmentsWithPending: pendingByDept.size, totalDeptEmails, totalPendingAssignments });
    return { departmentsWithPending: pendingByDept.size, totalDeptEmails, totalPendingAssignments };
}
exports.onDevPlanEditRequestEmail = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "devPlanEditRequests/{reqId}" }, async (event) => {
    try {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!after)
            return;
        const reqId = String(event.params.reqId);
        const transporter = (0, emailShared_1.getTransporter)();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const prevStatus = String(before?.status || "").toLowerCase();
        const nextStatus = String(after?.status || "").toLowerCase();
        const isCreate = !before;
        const becamePending = prevStatus !== "pending" && nextStatus === "pending";
        if (isCreate || becamePending) {
            const alreadySent = after?.notifications?.editRequestEmail?.created?.sentAt ?? null;
            if (!alreadySent) {
                const meRecipients = await (0, emailShared_1.getMERecipients)();
                if (meRecipients.length) {
                    const [programName, participantName] = await Promise.all([
                        (0, emailShared_1.getProgramName)(after.programId || null),
                        (0, emailShared_1.getParticipantName)(after.participantId || null),
                    ]);
                    const email = buildDevPlanEditRequestCreatedEmail({
                        requesterName: (0, emailShared_1.safeStr)(after.requesterName, "Requester"),
                        requesterDeptName: (0, emailShared_1.safeStr)(after.requesterDeptName, "Department"),
                        participantName: (0, emailShared_1.safeStr)(participantName, "SME"),
                        programName,
                        reason: (0, emailShared_1.safeStr)(after.reason, ""),
                        requestId: reqId,
                    });
                    await transporter.sendMail({
                        from,
                        to: from,
                        bcc: meRecipients,
                        subject: email.subject,
                        html: email.html,
                        text: email.text,
                    });
                    await event.data.after.ref.set({
                        notifications: {
                            editRequestEmail: {
                                created: {
                                    sentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                                    to: meRecipients,
                                },
                            },
                        },
                        updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    logger.info("onDevPlanEditRequestEmail.created_sent", { reqId, sentTo: meRecipients.length });
                    await (0, inAppNotifications_1.notifyInApp)({
                        type: "dev_plan_edit_requested",
                        message: `${(0, emailShared_1.safeStr)(after.requesterName, "A department")} requested to edit the development plan for ${(0, emailShared_1.safeStr)(participantName, "an SME")}.`,
                        recipientIds: await (0, movRecipients_1.uidsForEmails)(meRecipients),
                        devPlanEditRequestId: reqId,
                        participantId: after.participantId,
                        programId: after.programId,
                        link: "/operations/inquiries",
                    });
                }
            }
        }
        const becameApproved = prevStatus !== "approved" && nextStatus === "approved";
        const becameRejected = prevStatus !== "rejected" && nextStatus === "rejected";
        if (becameApproved || becameRejected) {
            const decision = becameApproved ? "approved" : "rejected";
            const alreadySent = after?.notifications?.editRequestEmail?.[decision]?.sentAt ?? null;
            if (alreadySent)
                return;
            const to = String(after.requesterEmail || "").trim();
            if (!to || !to.includes("@")) {
                logger.warn("onDevPlanEditRequestEmail.skip_no_requester_email", { reqId, decision });
                return;
            }
            const [programName, participantName] = await Promise.all([
                (0, emailShared_1.getProgramName)(after.programId || null),
                (0, emailShared_1.getParticipantName)(after.participantId || null),
            ]);
            const email = buildDevPlanEditRequestDecisionEmail({
                requesterName: (0, emailShared_1.safeStr)(after.requesterName, "there"),
                participantName: (0, emailShared_1.safeStr)(participantName, "SME"),
                programName,
                decision: decision,
                meByName: after.meRespondedByName ? String(after.meRespondedByName) : null,
                meReason: after.meResponseReason ? String(after.meResponseReason) : null,
                requestReason: (0, emailShared_1.safeStr)(after.reason, ""),
                requestId: reqId,
            });
            await transporter.sendMail({ from, to, subject: email.subject, html: email.html, text: email.text });
            await (0, inAppNotifications_1.notifyInApp)({
                type: `dev_plan_edit_${decision}`,
                message: `Your development plan edit request for ${(0, emailShared_1.safeStr)(participantName, "the SME")} was ${decision}.`,
                recipientIds: [after.requesterUid || await (0, movRecipients_1.uidsForEmails)([to]).then((u) => u[0])],
                devPlanEditRequestId: reqId,
                participantId: after.participantId,
                programId: after.programId,
            });
            await event.data.after.ref.set({
                notifications: {
                    editRequestEmail: {
                        [decision]: {
                            sentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                            to,
                        },
                    },
                },
                updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            logger.info("onDevPlanEditRequestEmail.decision_sent", { reqId, decision, to });
        }
    }
    catch (e) {
        logger.error("onDevPlanEditRequestEmail.failed", { err: String(e) });
    }
});
function buildDevPlanEditRequestCreatedEmail(opts) {
    const url = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/operations/inquiries`;
    const subject = `Developmental Plan Edit Request: ${opts.participantName}`;
    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi M&E,</p>
<p>A department has submitted a <b>Request To Edit</b> for a confirmed Developmental Plan.</p>
<table style="border-collapse:collapse;font-size:14px;margin:10px 0;min-width:340px">
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>SME</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.participantName}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Program</b></td><td style="padding:6px 10px;border:1px solid #eee">${(0, emailShared_1.safeStr)(opts.programName, "—")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Requester</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.requesterName} (${opts.requesterDeptName})</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Reason</b></td><td style="padding:6px 10px;border:1px solid #eee">${(opts.reason || "").replace(/\n/g, "<br/>")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Request ID</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.requestId}</td></tr>
</table>
<p>
Review and respond here:<br/>
<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
</p>
<p style="margin-top:16px">
Regards,<br/>
<b>Lepharo Smart Inc AI</b>
</p>
</div>
`;
    const text = `M&E: A department submitted a Developmental Plan edit request.
SME: ${opts.participantName}
Program: ${(0, emailShared_1.safeStr)(opts.programName, "—")}
Requester: ${opts.requesterName} (${opts.requesterDeptName})
Reason: ${opts.reason}
Request ID: ${opts.requestId}
Review: ${url}
`;
    return { subject, html, text };
}
function buildDevPlanEditRequestDecisionEmail(opts) {
    const url = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/operations/plan`;
    const ok = opts.decision === "approved";
    const subject = ok
        ? `Edit Request Approved: ${opts.participantName}`
        : `Edit Request Rejected: ${opts.participantName}`;
    const decisionLine = ok
        ? `M&E approved your request to edit the Developmental Plan.`
        : `M&E rejected your request to edit the Developmental Plan.`;
    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi ${opts.requesterName},</p>
<p>${decisionLine}</p>
<table style="border-collapse:collapse;font-size:14px;margin:10px 0;min-width:340px">
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>SME</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.participantName}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Program</b></td><td style="padding:6px 10px;border:1px solid #eee">${(0, emailShared_1.safeStr)(opts.programName, "—")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Your request</b></td><td style="padding:6px 10px;border:1px solid #eee">${(opts.requestReason || "").replace(/\n/g, "<br/>")}</td></tr>
${ok ? "" : `<tr><td style="padding:6px 10px;border:1px solid #eee"><b>M&E response</b></td><td style="padding:6px 10px;border:1px solid #eee">${(0, emailShared_1.safeStr)(opts.meReason, "No reason provided.")}</td></tr>`}
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Responded by</b></td><td style="padding:6px 10px;border:1px solid #eee">${(0, emailShared_1.safeStr)(opts.meByName, "M&E")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Request ID</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.requestId}</td></tr>
</table>
<p>
Open the plan here:<br/>
<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
</p>
<p style="margin-top:16px">
Regards,<br/>
<b>Lepharo Smart Inc AI</b>
</p>
</div>
`;
    const text = `${decisionLine}
SME: ${opts.participantName}
Program: ${(0, emailShared_1.safeStr)(opts.programName, "—")}
Your request: ${opts.requestReason}
${ok ? "" : `M&E response: ${(0, emailShared_1.safeStr)(opts.meReason, "No reason provided.")}
`}Responded by: ${(0, emailShared_1.safeStr)(opts.meByName, "M&E")}
Request ID: ${opts.requestId}
Link: ${url}
`;
    return { subject, html, text };
}
exports.sendDevPlanReminders = (0, https_1.onRequest)({ region: 'us-central1', cors: true }, async (req, res) => {
    try {
        const authHeader = (req.headers.authorization || '').toString();
        const match = authHeader.match(/^Bearer (.+)$/);
        if (!match) {
            res.status(401).json({ ok: false, error: 'Missing or invalid auth.' });
            return;
        }
        await emailShared_1.admin.auth().verifyIdToken(match[1]);
        const body = (req.body || {});
        const result = await runDevPlanReminderOnce('http', { programId: body.programId || null });
        res.status(200).json({
            ok: true,
            sent: result.totalDeptEmails,
            departmentsWithPending: result.departmentsWithPending,
            totalPendingAssignments: result.totalPendingAssignments,
        });
    }
    catch (err) {
        logger.error('sendDevPlanReminders.failed', { message: err?.message, stack: err?.stack });
        res.status(500).json({ ok: false, error: err?.message || 'Failed to send dev plan reminders.' });
    }
});
exports.devPlanReminderCron = (0, scheduler_1.onSchedule)({
    region: 'us-central1',
    schedule: '0 9 * * *',
    timeZone: 'Africa/Johannesburg',
}, async () => {
    try {
        await runDevPlanReminderOnce('cron', {});
    }
    catch (err) {
        logger.error('devPlanReminderCron.failed', { error: String(err) });
    }
});
//# sourceMappingURL=emailDevPlan.js.map