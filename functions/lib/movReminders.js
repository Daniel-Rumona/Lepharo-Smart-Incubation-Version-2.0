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
exports.remindMovOwner = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const syntheticData_1 = require("./syntheticData");
const https_1 = require("firebase-functions/v2/https");
const emailShared_1 = require("./emailShared");
const movRecipients_1 = require("./movRecipients");
const workflowEmailFunctions_1 = require("./workflowEmailFunctions");
const packStatus_1 = require("./packStatus");
const departmentRoles_1 = require("./departmentRoles");
const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (value) => String(value ?? "").trim();
/**
 * Same people who may open the Control Tower: ROM and M&E (operations
 * department users), project admins, and system admins.
 */
async function canRemind(caller) {
    const role = clean(caller.role).toLowerCase();
    if (role === "system_admin" || role === "projectadmin")
        return true;
    if (role !== "operations")
        return false;
    const departmentId = clean(caller.departmentId);
    return (await (0, departmentRoles_1.isDepartmentInRole)(departmentId, "rom")) || (await (0, departmentRoles_1.isDepartmentInRole)(departmentId, "monitoring"));
}
const withUids = async (role, emails, path, ask) => ({
    role,
    emails,
    uids: await (0, movRecipients_1.uidsForEmails)(emails),
    path,
    ask,
});
/** HODs of the document's department, or null when the department / HOD can't be found. */
async function hodGroup(doc, path, ask) {
    const departmentId = await (0, movRecipients_1.resolveMovDepartmentId)(doc);
    if (!departmentId)
        return null;
    const hods = await (0, movRecipients_1.getDepartmentHods)(departmentId);
    return hods.emails.length ? { role: "HOD", emails: hods.emails, uids: hods.uids, path, ask } : null;
}
/** The facilitator on a MOV (facilitator* fields) or on an assignment (assignee* fields). */
async function facilitatorGroup(doc, path, ask) {
    const person = await (0, workflowEmailFunctions_1.assignee)({
        assigneeEmail: doc.facilitatorEmail ?? doc.assigneeEmail,
        assigneeId: doc.facilitatorId ?? doc.assigneeId,
        assigneeName: doc.facilitatorName ?? doc.assigneeName,
    });
    return person.email ? withUids("Facilitator", [person.email], path, ask) : null;
}
/** The SME, found the same way the existing "remind SME" action finds them. */
async function smeGroup(doc, ask) {
    const person = await (0, workflowEmailFunctions_1.participant)({
        participantId: doc.participantId ?? doc.beneficiaryId ?? doc.smmeId,
        participantEmail: doc.participantEmail ?? doc.smmeEmail,
        participantName: doc.participantName ?? doc.beneficiaryName,
    });
    return person.email ? withUids("SME", [person.email], "/incubatee/interventions", ask) : null;
}
const compact = (items) => items.filter((item) => item !== null);
async function resolveGroups(target, doc, request) {
    const status = clean(doc.status);
    if (target.collection === "movDocuments") {
        if (status === "awaiting_smme") {
            return { groups: compact([await smeGroup(doc, "confirm the work delivered to you so the MOV can move on")]), empty: "No contact email was found for this SME." };
        }
        if (status === "awaiting_hod" || status === "approved") {
            // `approved` with no pack is also the HOD's job: they still have to submit the monthly pack.
            const ask = status === "awaiting_hod" ? "approve this MOV" : "include this approved MOV in the monthly pack";
            return { groups: compact([await hodGroup(doc, "/operations/movs", ask)]), empty: `No HOD is on file for ${clean(doc.departmentName) || "this department"}.` };
        }
        if (status === "queried" || status === "rejected") {
            // The facilitator has to answer or fix it; the HOD raised it, so keeps it in view.
            const groups = compact([
                await facilitatorGroup(doc, "/coordinator/movs", status === "queried" ? "respond to the query raised on this MOV" : "fix and resubmit this rejected MOV"),
                await hodGroup(doc, "/operations/movs", status === "queried" ? "follow up on the query still open on this MOV" : "follow up on this rejected MOV"),
            ]);
            return { groups, empty: "Neither the facilitator nor a HOD could be found for this MOV." };
        }
        throw new https_1.HttpsError("failed-precondition", "There is no one to remind at this MOV stage.");
    }
    if (target.collection === "consolidatedMOVs") {
        const packStatus = (0, packStatus_1.normalizePackStatus)(status);
        if (packStatus === packStatus_1.PACK_STATUS.AWAITING_CC) {
            // The programme's own Center Coordinator; every project admin only if none is linked.
            const own = await (0, movRecipients_1.getProgramProjectAdmins)((0, movRecipients_1.resolvePackProgramId)(doc));
            const emails = own.emails.length ? own.emails : await (0, emailShared_1.getCCRecipients)();
            return { groups: emails.length ? [await withUids("CC", emails, "/projectadmin/movs", "confirm this MOV pack")] : [], empty: "No project admin recipients found." };
        }
        if (packStatus === packStatus_1.PACK_STATUS.AWAITING_ME) {
            const emails = await (0, emailShared_1.getMERecipients)();
            return { groups: emails.length ? [await withUids("M&E", emails, "/operations/monitoring/movs", "validate this MOV pack")] : [], empty: "No M&E recipients found." };
        }
        throw new https_1.HttpsError("failed-precondition", "There is no one to remind at this pack stage.");
    }
    // assignedInterventions: the client says which kind of delivery stall this is.
    const state = clean(request.state);
    switch (state) {
        case "awaiting-acceptance":
            return { groups: compact([await smeGroup(doc, "respond to the appointment for this intervention")]), empty: "No contact email was found for this SME." };
        case "awaiting-confirmation":
            return { groups: compact([await smeGroup(doc, "confirm completion of this intervention")]), empty: "No contact email was found for this SME." };
        case "in-delivery":
            return { groups: compact([await facilitatorGroup(doc, "/coordinator/allocated", "deliver and record this intervention")]), empty: "No facilitator email found." };
        case "declined":
            return {
                groups: compact([
                    await facilitatorGroup(doc, "/coordinator/allocated", "reschedule this intervention - the SME declined"),
                    await hodGroup(doc, "/operations/assignments", "follow up on this intervention - the SME declined"),
                ]),
                empty: "Neither the facilitator nor a HOD could be found.",
            };
        case "rejected":
            return {
                groups: compact([
                    await facilitatorGroup(doc, "/coordinator/allocated", "redo or correct this intervention - the SME rejected completion"),
                    await hodGroup(doc, "/operations/assignments", "follow up on this intervention - the SME rejected completion"),
                ]),
                empty: "Neither the facilitator nor a HOD could be found.",
            };
        case "needs-reassignment":
            return { groups: compact([await hodGroup(doc, "/operations/assignments", "reassign this intervention to a facilitator")]), empty: `No HOD is on file for ${clean(doc.departmentName) || "this department"}.` };
        default:
            throw new https_1.HttpsError("invalid-argument", "Unknown delivery state.");
    }
}
const describe = (target, doc) => {
    if (target.collection === "consolidatedMOVs") {
        return `${clean(doc.department) || "a department"}'s ${clean(doc.month)} MOV pack`.replace(/\s+/g, " ");
    }
    const who = clean(doc.beneficiaryName || doc.participantName) || "a participant";
    const what = clean(doc.interventionTitle) || "intervention";
    return target.collection === "movDocuments" ? `the MOV for ${who} (${what})` : `the ${what} intervention for ${who}`;
};
/**
 * Manual "nudge" from the Control Tower. Works out who has to act next for the
 * item's current state (SME, facilitator, HOD, Centre Coordinator or M&E),
 * emails each group a message tailored to what they must do, adds an in-app
 * notification, and records the reminder on the document so the team can see
 * who chased what. One reminder per document per day.
 */
exports.remindMovOwner = (0, https_1.onCall)({ timeoutSeconds: 60 }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const raw = clean(request.data?.collection);
    const collection = raw === "consolidatedMOVs" ? "consolidatedMOVs" : raw === "assignedInterventions" ? "assignedInterventions" : "movDocuments";
    const target = { collection, id: clean(request.data?.id) };
    if (!target.id)
        throw new https_1.HttpsError("invalid-argument", "Provide the record id.");
    const note = clean(request.data?.note).slice(0, 500);
    const callerSnap = await emailShared_1.db.collection("users").doc(callerUid).get();
    const caller = (callerSnap.data() || {});
    if (!callerSnap.exists || !(await canRemind(caller))) {
        throw new https_1.HttpsError("permission-denied", "You are not allowed to send reminders.");
    }
    const ref = emailShared_1.db.collection(target.collection).doc(target.id);
    const snap = await ref.get();
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", "That record no longer exists.");
    const doc = snap.data();
    if ((0, syntheticData_1.suppressRecordNotifications)(doc, target.id)) {
        return { ok: true, suppressed: true, reason: "Synthetic data does not send reminders." };
    }
    const lastAt = doc.lastManualReminder?.at?.toDate?.() ?? null;
    if (lastAt && Date.now() - lastAt.getTime() < DAY_MS) {
        const by = clean(doc.lastManualReminder?.byName) || "someone";
        throw new https_1.HttpsError("resource-exhausted", `Already reminded today by ${by}. Try again tomorrow.`);
    }
    const { groups, empty } = await resolveGroups(target, doc, request.data || {});
    if (!groups.length)
        throw new https_1.HttpsError("failed-precondition", empty);
    const callerName = clean(caller.name || caller.displayName || caller.email) || "A colleague";
    const base = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
    const subject = describe(target, doc);
    for (const group of groups) {
        const text = `${callerName} is asking for your action: please ${group.ask} - ${subject}.` + (note ? ` Note: "${note}"` : "");
        const content = (0, emailShared_1.buildPackReminderEmail)(group.role, text, `${base}${group.path}`);
        try {
            await (0, emailShared_1.sendStatusChangeNotification)(group.emails, content.subject, content.html, content.text);
        }
        catch (error) {
            logger.error("remindMovOwner.emailFailed", { target, role: group.role, error: String(error) });
        }
        // In-app copy only where we know the person's account; the email always goes out.
        if (group.uids.length) {
            await emailShared_1.db.collection("notifications").add({
                type: "mov_manual_reminder",
                message: text,
                recipientIds: group.uids,
                movCollection: target.collection,
                movId: target.id,
                link: group.path,
                createdAt: new Date(),
                readBy: {},
            });
        }
    }
    const audience = groups.map((g) => g.role).join(" + ");
    const entry = {
        at: emailShared_1.admin.firestore.Timestamp.now(),
        byUid: callerUid,
        byName: callerName,
        owner: audience,
        note: note || null,
        count: groups.reduce((sum, g) => sum + g.emails.length, 0),
    };
    await ref.update({
        lastManualReminder: entry,
        manualReminders: emailShared_1.admin.firestore.FieldValue.arrayUnion(entry),
    });
    return { sent: entry.count, owner: audience, audience };
});
//# sourceMappingURL=movReminders.js.map