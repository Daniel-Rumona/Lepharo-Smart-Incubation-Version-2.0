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
exports.agentCancelAction = exports.agentConfirmAction = exports.agentProposeAction = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const config_1 = require("./config");
const inAppNotifications_1 = require("./inAppNotifications");
const emailCampaigns_1 = require("./emailCampaigns");
const complianceExpiry_1 = require("./complianceExpiry");
const whatsappStaff_1 = require("./whatsappStaff");
const agentActionsLogic_1 = require("./agentActionsLogic");
/**
 * Write actions for the web assistant. The ai-backend only drafts a proposal;
 * this module is the authority. agentProposeAction checks the caller's role and
 * scope, resolves every id and stores a pending proposal with a readable
 * preview. Nothing is written until the same user calls agentConfirmAction,
 * which re-validates and then executes. Every outcome lands in auditLogs.
 */
const CALLABLE_CORS = [
    "http://localhost:5173",
    "https://lepharosmartinc.co.za",
    "https://www.lepharosmartinc.co.za",
];
const PROPOSALS = "agentProposals";
const PROPOSAL_TTL_MS = 30 * 60 * 1000;
const clean = (value) => String(value ?? "").trim();
/* ----------------------------------------------------------------- identity */
async function loadIdentity(uid, email) {
    let snapshot = await firebase_1.db.collection("users").doc(uid).get();
    if (!snapshot.exists) {
        for (const [field, value] of [["uid", uid], ["authUid", uid], ["email", email]]) {
            if (!value)
                continue;
            const found = await firebase_1.db.collection("users").where(field, "==", value).limit(1).get();
            if (!found.empty) {
                snapshot = found.docs[0];
                break;
            }
        }
    }
    if (!snapshot.exists)
        throw new https_1.HttpsError("permission-denied", "We couldn't find your staff profile.");
    const data = snapshot.data() || {};
    const role = clean(data.role);
    return {
        kind: "staff",
        id: snapshot.id,
        uid,
        name: clean(data.name) || clean(data.displayName) || clean(data.email) || "Staff member",
        role,
        roleGroup: (0, whatsappStaff_1.roleGroupOf)(role),
        email: clean(data.email) || email || null,
        phoneNumber: "",
        departmentId: clean(data.departmentId) || null,
        branchId: clean(data.assignedBranch || data.branchId) || null,
        channel: "web",
        assignedPrograms: Array.isArray(data.assignedPrograms) ? data.assignedPrograms.map(clean).filter(Boolean) : [],
    };
}
const ownerIds = (identity) => Array.from(new Set([identity.id, identity.uid || ""].filter(Boolean)));
/** Managers see every SME; coordinators only those they support or whose programme they hold. */
async function participantInScope(identity, participantId, programId) {
    if (["system_admin", "director", "hod"].includes(identity.roleGroup))
        return true;
    if (identity.roleGroup !== "coordinator")
        return false;
    if (programId && identity.assignedPrograms.includes(programId))
        return true;
    const owned = await firebase_1.db.collection("assignedInterventions")
        .where("participantId", "==", participantId)
        .where("assigneeId", "in", ownerIds(identity))
        .limit(1)
        .get();
    return !owned.empty;
}
const participantLabel = (participant, id) => clean(participant?.beneficiaryName) || clean(participant?.companyName) || clean(participant?.name) || `SME ${id.slice(0, 6)}`;
async function acceptedProgramId(participantId) {
    const applications = await firebase_1.db.collection("applications").where("participantId", "==", participantId).get();
    const accepted = applications.docs.find((doc) => clean(doc.data().applicationStatus).toLowerCase() === "accepted");
    return accepted ? clean(accepted.data().programId) || null : null;
}
/* --------------------------------------------------------------- validators */
async function previewNudge(identity, raw) {
    const message = (0, agentActionsLogic_1.shortText)(raw.message, 500);
    if (!message)
        throw new whatsappStaff_1.UserError("What should the nudge say?");
    const ids = (0, agentActionsLogic_1.cleanIdList)(raw.participantIds);
    if (!ids.length)
        throw new whatsappStaff_1.UserError("Which SMEs should get the nudge?");
    const lines = [];
    const skipped = [];
    const recipients = [];
    for (const id of ids) {
        const snapshot = await firebase_1.db.collection("participants").doc(id).get();
        if (!snapshot.exists) {
            skipped.push(`${id.slice(0, 8)}…: not found`);
            continue;
        }
        const name = participantLabel(snapshot.data(), id);
        const programId = await acceptedProgramId(id);
        if (!(await participantInScope(identity, id, programId))) {
            skipped.push(`${name}: outside the SMEs you support`);
            continue;
        }
        recipients.push({ participantId: id, name, programId });
        lines.push(name);
    }
    if (!recipients.length)
        throw new whatsappStaff_1.UserError(`None of those SMEs can be nudged. ${skipped.join("; ")}`);
    return {
        headline: `Send an in-app nudge to ${recipients.length} SME${recipients.length === 1 ? "" : "s"}: "${message}"`,
        lines,
        skipped,
        params: { message, recipients },
    };
}
async function previewComplianceReminder(identity, raw) {
    const ids = (0, agentActionsLogic_1.cleanIdList)(raw.participantIds);
    if (!ids.length)
        throw new whatsappStaff_1.UserError("Which SMEs should get a compliance reminder?");
    const lines = [];
    const skipped = [];
    const recipients = [];
    for (const id of ids) {
        const outstanding = await (0, complianceExpiry_1.outstandingComplianceForParticipant)(id);
        const name = participantLabel(outstanding.participant, id);
        if (!outstanding.application) {
            skipped.push(`${name}: no accepted application`);
            continue;
        }
        if (!(await participantInScope(identity, id, outstanding.programId))) {
            skipped.push(`${name}: outside the SMEs you support`);
            continue;
        }
        if (!outstanding.items.length) {
            skipped.push(`${name}: nothing outstanding`);
            continue;
        }
        const email = clean(outstanding.participant?.email || outstanding.application?.email).toLowerCase();
        if (!email.includes("@")) {
            skipped.push(`${name}: no email address on file`);
            continue;
        }
        recipients.push({
            participantId: id,
            name,
            email,
            programId: outstanding.programId,
            programName: outstanding.programName || "your incubation programme",
            issues: outstanding.items.slice(0, 20),
        });
        lines.push(`${name}: ${outstanding.items.slice(0, 3).join("; ")}${outstanding.items.length > 3 ? ` (+${outstanding.items.length - 3} more)` : ""}`);
    }
    if (!recipients.length)
        throw new whatsappStaff_1.UserError(`No reminders to send. ${skipped.join("; ")}`);
    return {
        headline: `Email and notify ${recipients.length} SME${recipients.length === 1 ? "" : "s"} about outstanding compliance documents`,
        lines,
        skipped,
        params: { recipients },
    };
}
async function previewTask(identity, raw) {
    const title = (0, agentActionsLogic_1.shortText)(raw.title, 160);
    if (!title)
        throw new whatsappStaff_1.UserError("What should the task be called?");
    const description = (0, agentActionsLogic_1.shortText)(raw.description, 1500);
    const priority = ["low", "medium", "high", "urgent"].includes(clean(raw.priority).toLowerCase())
        ? clean(raw.priority).toLowerCase()
        : "medium";
    const dueDate = raw.dueDate ? (0, agentActionsLogic_1.validDate)(raw.dueDate) : null;
    if (raw.dueDate && !dueDate)
        throw new whatsappStaff_1.UserError("I couldn't read that due date. Please give it as YYYY-MM-DD.");
    if (!dueDate)
        throw new whatsappStaff_1.UserError("When is the task due?");
    const programId = clean(raw.programId) && clean(raw.programId) !== "all"
        ? clean(raw.programId)
        : identity.assignedPrograms.length === 1 ? identity.assignedPrograms[0] : "";
    if (!programId)
        throw new whatsappStaff_1.UserError("Which programme is this task for? Pick a programme at the top of the page first.");
    const departmentId = identity.departmentId;
    if (!departmentId)
        throw new whatsappStaff_1.UserError("Your profile has no department, so tasks can't be filed for you yet.");
    const assigneeIds = (0, agentActionsLogic_1.cleanIdList)(raw.assigneeIds);
    const assignees = [];
    const names = [];
    if (!assigneeIds.length) {
        assignees.push({ userId: identity.uid || identity.id, branchId: identity.branchId, departmentId });
        names.push("you");
    }
    for (const id of assigneeIds) {
        const snapshot = await firebase_1.db.collection("users").doc(id).get();
        const data = snapshot.data();
        if (!snapshot.exists || !data)
            throw new whatsappStaff_1.UserError("One of those people couldn't be found.");
        if (clean(data.departmentId) !== departmentId) {
            throw new whatsappStaff_1.UserError(`${clean(data.name) || "That person"} isn't in your department, so you can't give them a task.`);
        }
        assignees.push({ userId: clean(data.uid) || snapshot.id, branchId: clean(data.assignedBranch || data.branchId) || null, departmentId });
        names.push(clean(data.name) || clean(data.email) || "a colleague");
    }
    let participantId = null;
    let participantName = null;
    if (clean(raw.participantId)) {
        participantId = clean(raw.participantId);
        const snapshot = await firebase_1.db.collection("participants").doc(participantId).get();
        if (!snapshot.exists)
            throw new whatsappStaff_1.UserError("I couldn't find that SME.");
        participantName = participantLabel(snapshot.data(), participantId);
    }
    return {
        headline: `Create a ${priority}-priority task: "${title}"`,
        lines: [
            `Due: ${dueDate}`,
            `For: ${names.join(", ")}`,
            ...(participantName ? [`SME: ${participantName}`] : []),
            ...(description ? [`Details: ${description}`] : []),
        ],
        skipped: [],
        params: { title, description, priority, dueDate, programId, departmentId, assignees, participantId, participantName },
    };
}
async function previewSchedule(identity, raw) {
    const validated = await (0, whatsappStaff_1.validateSchedule)(identity, raw);
    const [headline, ...lines] = validated.summary.split("\n");
    return { headline, lines, skipped: [], params: validated.params };
}
async function previewAssignIntervention(identity, raw) {
    const participantId = clean(raw.participantId);
    const interventionId = clean(raw.interventionId);
    if (!participantId || !interventionId)
        throw new whatsappStaff_1.UserError("Which SME and which intervention?");
    const [participantSnapshot, interventionSnapshot] = await Promise.all([
        firebase_1.db.collection("participants").doc(participantId).get(),
        firebase_1.db.collection("interventions").doc(interventionId).get(),
    ]);
    if (!participantSnapshot.exists)
        throw new whatsappStaff_1.UserError("I couldn't find that SME.");
    if (!interventionSnapshot.exists)
        throw new whatsappStaff_1.UserError("I couldn't find that intervention in the catalogue.");
    const programId = await acceptedProgramId(participantId);
    if (!(await participantInScope(identity, participantId, programId))) {
        throw new whatsappStaff_1.UserError("That SME is outside the SMEs you support.", "not_permitted");
    }
    const intervention = interventionSnapshot.data() || {};
    if (identity.roleGroup === "hod" && identity.departmentId && clean(intervention.departmentId) && clean(intervention.departmentId) !== identity.departmentId) {
        throw new whatsappStaff_1.UserError("That intervention belongs to another department.", "not_permitted");
    }
    const dueDate = raw.dueDate ? (0, agentActionsLogic_1.validDate)(raw.dueDate) : null;
    let assigneeName = null;
    const assigneeId = clean(raw.assigneeId) || null;
    if (assigneeId) {
        const snapshot = await firebase_1.db.collection("users").doc(assigneeId).get();
        if (!snapshot.exists)
            throw new whatsappStaff_1.UserError("I couldn't find that assignee.");
        assigneeName = clean(snapshot.data()?.name) || clean(snapshot.data()?.email) || null;
    }
    const smeName = participantLabel(participantSnapshot.data(), participantId);
    const title = clean(intervention.title || intervention.interventionTitle || intervention.name) || "Intervention";
    return {
        headline: `Assign "${title}" to ${smeName}`,
        lines: [
            ...(assigneeName ? [`Responsible: ${assigneeName}`] : []),
            ...(dueDate ? [`Due: ${dueDate}`] : []),
            "Opens the Assignments form filled in, so you can check sessions and recurrence before saving.",
        ],
        skipped: [],
        params: { participantId, interventionId, assigneeId, dueDate },
        handoff: { kind: "assign_intervention", state: { participantId, interventionId, assigneeId, dueDate } },
    };
}
const PREVIEWERS = {
    send_nudge: previewNudge,
    send_compliance_reminder: previewComplianceReminder,
    create_task: previewTask,
    schedule_appointment: previewSchedule,
    assign_intervention: previewAssignIntervention,
};
async function execute(identity, kind, preview, proposalId) {
    const params = preview.params;
    if (kind === "send_nudge") {
        let sent = 0;
        for (const recipient of params.recipients) {
            const uid = await (0, inAppNotifications_1.uidForParticipant)(recipient.participantId, null);
            if (!uid)
                continue;
            await (0, inAppNotifications_1.notifyInApp)({
                type: "agent_nudge",
                message: params.message,
                recipientIds: [uid],
                participantId: recipient.participantId,
                programId: recipient.programId,
                senderId: identity.uid,
                senderName: identity.name,
                agentProposalId: proposalId,
                link: "/incubatee",
            });
            sent += 1;
        }
        const missing = params.recipients.length - sent;
        return { message: `Nudge sent to ${sent} SME${sent === 1 ? "" : "s"}.${missing ? ` ${missing} have no login yet, so they were skipped.` : ""}` };
    }
    if (kind === "send_compliance_reminder") {
        let sent = 0;
        const failed = [];
        for (const recipient of params.recipients) {
            try {
                await (0, emailCampaigns_1.deliverComplianceReminder)({
                    to: recipient.email,
                    name: recipient.name,
                    programName: recipient.programName,
                    participantId: recipient.participantId,
                    programId: recipient.programId,
                    issues: recipient.issues,
                });
                sent += 1;
            }
            catch (error) {
                logger.warn("agent_compliance_reminder_failed", { participantId: recipient.participantId, error: String(error) });
                failed.push(recipient.name);
            }
        }
        if (!sent)
            throw new whatsappStaff_1.UserError("The reminder emails couldn't be sent. Please try again shortly.");
        return { message: `Compliance reminders sent to ${sent} SME${sent === 1 ? "" : "s"}.${failed.length ? ` Failed for: ${failed.join(", ")}.` : ""}` };
    }
    if (kind === "create_task") {
        const now = firebase_1.admin.firestore.FieldValue.serverTimestamp();
        const ref = await firebase_1.db.collection("tasks").add({
            title: params.title,
            description: params.description,
            programId: params.programId,
            priority: params.priority,
            status: "todo",
            startAt: null,
            dueAt: firebase_1.admin.firestore.Timestamp.fromDate(new Date(`${params.dueDate}T17:00:00+02:00`)),
            departmentId: params.departmentId,
            assignees: params.assignees,
            interventionId: null,
            participantId: params.participantId,
            createdVia: "assistant",
            createdBy: identity.uid || identity.id,
            createdAt: now,
            updatedAt: now,
        });
        logger.info("agent_task_created", { taskId: ref.id });
        return { message: `Task "${params.title}" created, due ${params.dueDate}.` };
    }
    if (kind === "schedule_appointment")
        return { message: await (0, whatsappStaff_1.executeSchedule)(identity, params) };
    if (kind === "assign_intervention") {
        return { message: "Opening the Assignments form with this filled in.", handoff: preview.handoff };
    }
    throw new whatsappStaff_1.UserError("I don't know how to do that one.");
}
/* ------------------------------------------------------------------ callables */
async function audit(identity, event, proposalId, kind, extra) {
    try {
        await firebase_1.db.collection("auditLogs").add({
            type: `agent_action_${event}`,
            when: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            actor: { uid: identity.uid, email: identity.email, role: identity.role, name: identity.name },
            target: { collection: PROPOSALS, id: proposalId },
            context: { kind, channel: "web", ...extra },
        });
    }
    catch (error) {
        logger.error("agent_audit_failed", { proposalId, error: String(error) });
    }
}
const requireAuth = (auth) => {
    if (!auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    return { uid: auth.uid, email: clean(auth.token?.email).toLowerCase() };
};
exports.agentProposeAction = (0, https_1.onCall)({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 120 }, async (request) => {
    const { uid, email } = requireAuth(request.auth);
    const kind = clean(request.data?.kind);
    if (!(kind in PREVIEWERS))
        throw new https_1.HttpsError("invalid-argument", "That action isn't supported.");
    const identity = await loadIdentity(uid, email);
    if (!agentActionsLogic_1.KIND_ROLE_GROUPS[kind].includes(identity.roleGroup)) {
        return { ok: false, reason: "Your role can't do that from the assistant." };
    }
    const raw = request.data?.params && typeof request.data.params === "object" ? request.data.params : {};
    let preview;
    try {
        preview = await PREVIEWERS[kind](identity, raw);
    }
    catch (error) {
        if (error instanceof whatsappStaff_1.UserError)
            return { ok: false, reason: error.message };
        throw error;
    }
    const ref = await firebase_1.db.collection(PROPOSALS).add({
        userId: uid,
        userName: identity.name,
        role: identity.role,
        kind,
        channel: "web",
        raw,
        preview,
        status: "pending",
        sessionId: clean(request.data?.sessionId) || null,
        createdAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: firebase_1.admin.firestore.Timestamp.fromMillis(Date.now() + PROPOSAL_TTL_MS),
    });
    await audit(identity, "proposed", ref.id, kind, { count: preview.lines.length });
    return {
        ok: true,
        proposalId: ref.id,
        kind,
        headline: preview.headline,
        lines: preview.lines.slice(0, agentActionsLogic_1.MAX_RECIPIENTS),
        skipped: preview.skipped,
        handoff: !!preview.handoff,
    };
});
exports.agentConfirmAction = (0, https_1.onCall)({ ...config_1.BREVO_EGRESS, region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 300 }, async (request) => {
    const { uid, email } = requireAuth(request.auth);
    const proposalId = clean(request.data?.proposalId);
    if (!proposalId)
        throw new https_1.HttpsError("invalid-argument", "Which proposal?");
    const ref = firebase_1.db.collection(PROPOSALS).doc(proposalId);
    // Claim it first so a double click can never run it twice.
    const claimed = await firebase_1.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.data();
        if (!snapshot.exists || !data || data.userId !== uid)
            return { error: "That proposal wasn't found." };
        if (data.status !== "pending")
            return { error: `That proposal is already ${data.status}.` };
        if ((data.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
            transaction.update(ref, { status: "expired" });
            return { error: "That proposal expired. Ask again and I'll prepare it fresh." };
        }
        transaction.update(ref, { status: "running", confirmedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
        return { data };
    });
    if ("error" in claimed)
        return { ok: false, message: claimed.error };
    const data = claimed.data;
    const kind = data.kind;
    const identity = await loadIdentity(uid, email);
    try {
        if (!agentActionsLogic_1.KIND_ROLE_GROUPS[kind]?.includes(identity.roleGroup))
            throw new whatsappStaff_1.UserError("Your role can no longer do that.");
        // Re-check against the data as it is now, not as it was when proposed.
        const preview = await PREVIEWERS[kind](identity, data.raw || {});
        const outcome = await execute(identity, kind, preview, proposalId);
        await ref.update({
            status: outcome.handoff ? "handed_off" : "executed",
            result: outcome.message,
            executedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        });
        await audit(identity, outcome.handoff ? "handed_off" : "executed", proposalId, kind, { result: outcome.message });
        return { ok: true, message: outcome.message, handoff: outcome.handoff || null };
    }
    catch (error) {
        const message = error instanceof whatsappStaff_1.UserError ? error.message : "Something went wrong while doing that. Nothing further was changed.";
        await ref.update({ status: "failed", result: message });
        await audit(identity, "failed", proposalId, kind, { result: message, error: error instanceof whatsappStaff_1.UserError ? null : String(error) });
        if (!(error instanceof whatsappStaff_1.UserError))
            logger.error("agent_action_failed", { proposalId, kind, error: String(error) });
        return { ok: false, message };
    }
});
exports.agentCancelAction = (0, https_1.onCall)({ region: "us-central1", cors: CALLABLE_CORS }, async (request) => {
    const { uid } = requireAuth(request.auth);
    const ref = firebase_1.db.collection(PROPOSALS).doc(clean(request.data?.proposalId) || "-");
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.userId !== uid || snapshot.data()?.status !== "pending")
        return { ok: false };
    await ref.update({ status: "cancelled", cancelledAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
    return { ok: true };
});
//# sourceMappingURL=agentActions.js.map