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
exports.complianceExpiryReminderCron = exports.loadComplianceContext = exports.assessComplianceDocuments = exports.outstandingComplianceForParticipant = void 0;
const crypto = __importStar(require("crypto"));
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const syntheticData_1 = require("./syntheticData");
const emailShared_1 = require("./emailShared");
const brevoClient_1 = require("./brevoClient");
const complianceExpiryInApp_1 = require("./complianceExpiryInApp");
const config_1 = require("./config");
const departmentRoles_1 = require("./departmentRoles");
const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const escapeHtml = (value) => clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
const normalizeKey = (value) => lower(value)
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
function asDate(value) {
    if (!value)
        return null;
    if (typeof value?.toDate === "function")
        return value.toDate();
    if (typeof value?.seconds === "number")
        return new Date(value.seconds * 1000);
    if (value instanceof Date)
        return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function startOfDay(value) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function reminderPhase(daysUntilExpiry) {
    if (daysUntilExpiry < 0) {
        return `expired-week-${Math.floor(Math.abs(daysUntilExpiry) / 7)}`;
    }
    if (daysUntilExpiry <= 1)
        return "expiring-1-day";
    if (daysUntilExpiry <= 7)
        return "expiring-7-days";
    if (daysUntilExpiry <= 14)
        return "expiring-14-days";
    return "expiring-30-days";
}
function isActiveUser(user) {
    return !["inactive", "disabled", "deleted"].includes(lower(user?.status));
}
function documentKey(document) {
    return normalizeKey(document?.presetId ||
        document?.slug ||
        document?.key ||
        document?.type ||
        document?.documentName ||
        document?.title ||
        document?.id);
}
function documentTitle(document) {
    return clean(document?.documentName || document?.title || document?.type || documentKey(document) || "Compliance document");
}
function emailAddress(value) {
    const email = lower(value);
    return email.includes("@") ? email : "";
}
async function loadRecipientDirectory() {
    const [romIds, userSnapshot] = await Promise.all([
        (0, departmentRoles_1.departmentIdsForRole)("rom"),
        emailShared_1.db.collection("users").get(),
    ]);
    const romDepartmentIds = new Set(romIds);
    return {
        romDepartmentIds,
        users: userSnapshot.docs,
    };
}
function resolveRecipients(application, program, directory) {
    const { romDepartmentIds, users } = directory;
    const assignedCoordinatorIds = new Set((Array.isArray(program?.assignedCoordinators) ? program.assignedCoordinators : [])
        .map(clean)
        .filter(Boolean));
    const programId = clean(application?.programId);
    const recipients = new Set();
    const recipientUids = new Set();
    users.forEach(snapshot => {
        const user = snapshot.data();
        if (!isActiveUser(user))
            return;
        if (!romDepartmentIds.has(clean(user.departmentId)))
            return;
        const role = lower(user.role);
        const isHod = role === "operations";
        const assignedPrograms = Array.isArray(user.assignedPrograms)
            ? user.assignedPrograms.map(clean)
            : [];
        const isProjectCoordinator = role === "coordinator" && (assignedCoordinatorIds.has(snapshot.id) ||
            assignedCoordinatorIds.has(clean(user.uid)) ||
            (programId && assignedPrograms.includes(programId)));
        if (isHod || isProjectCoordinator) {
            const email = emailAddress(user.email);
            if (email) {
                recipients.add(email);
                recipientUids.add(snapshot.id);
            }
        }
    });
    const smeEmail = emailAddress(application?.email ||
        application?.applicantEmail ||
        application?.contactEmail ||
        application?.profile?.email);
    // Staff (ROM/HOD/coordinators) keep getting the existing BCC notification below;
    // the SME's own copy is sent (and tracked) separately -- see the cron loop.
    // staffUids feeds the additive in-app notification only (complianceExpiryInApp.ts)
    // -- it does not change who gets emailed or when.
    return { staff: Array.from(recipients), staffUids: Array.from(recipientUids), smeEmail };
}
// The programme's upload requirements, keyed like normalizeComplianceRequirement
// in src/services/complianceResolver.ts. Department setups are subsets of this
// list, so the programme list is what the SME is held to.
function uploadRequirements(rows) {
    return rows
        .filter(row => lower(row?.kind || row?.type) !== "agreement" && !row?.agreementId)
        .map(row => {
        const hasExpiry = Boolean(row?.hasExpiry || row?.expiryRule);
        const months = Number(row?.expiryMonths ?? row?.expiryRule?.months);
        return {
            key: normalizeKey(row?.presetId || row?.key || row?.preset || row?.id || row?.title || row?.name),
            title: clean(row?.title || row?.name),
            expiryMonths: hasExpiry && Number.isFinite(months) && months > 0 ? months : 0,
        };
    })
        .filter(requirement => requirement.key);
}
// Mirrors complianceEffectiveExpiry in the app: the validity period from the
// issue date wins, otherwise the stored expiryDate. Months clamp to the last
// day (31 Jan + 1 month = 28/29 Feb), as dayjs does on the staff page.
function effectiveExpiry(document, requirement) {
    const issueDate = asDate(document.issueDate);
    if (requirement.expiryMonths > 0 && issueDate) {
        const expiry = new Date(issueDate);
        expiry.setDate(1);
        expiry.setMonth(expiry.getMonth() + requirement.expiryMonths);
        const lastDay = new Date(expiry.getFullYear(), expiry.getMonth() + 1, 0).getDate();
        expiry.setDate(Math.min(issueDate.getDate(), lastDay));
        return expiry;
    }
    return asDate(document.expiryDate);
}
function documentTime(document) {
    return asDate(document?.updatedAt)?.getTime() ??
        asDate(document?.createdAt)?.getTime() ??
        asDate(document?.uploadedAt)?.getTime() ??
        0;
}
// Documents that need replacing for another reason are handled by review, not
// by expiry reminders.
const NOT_REMINDED_STATUSES = ["missing", "invalid", "rejected", "queried"];
function findDueDocuments(documents, now, requirements) {
    return requirements.flatMap(requirement => {
        // The newest upload for this requirement, matched on its key or its title;
        // on a tie the subcollection copy beats the embedded one.
        const document = documents
            .filter(item => !item?.agreementId && (documentKey(item) === requirement.key ||
            (requirement.title && normalizeKey(item?.type || item?.documentName || item?.title) === normalizeKey(requirement.title))))
            .sort((a, b) => documentTime(b) - documentTime(a) ||
            (b._subcollection ? 1 : 0) - (a._subcollection ? 1 : 0))[0];
        if (!document)
            return [];
        if (NOT_REMINDED_STATUSES.includes(lower(document.status)))
            return [];
        const key = requirement.key;
        const expiryDate = effectiveExpiry(document, requirement);
        if (!expiryDate)
            return [];
        const daysUntilExpiry = Math.ceil((startOfDay(expiryDate).getTime() - startOfDay(now).getTime()) / DAY_MS);
        if (daysUntilExpiry > EXPIRING_SOON_DAYS)
            return [];
        const status = daysUntilExpiry < 0 ? "expired" : "expiring-soon";
        return [{
                key,
                title: requirement.title || documentTitle(document),
                expiryDate,
                daysUntilExpiry,
                status,
                phase: reminderPhase(daysUntilExpiry),
                source: document,
            }];
    });
}
/**
 * Everything one SME still owes on compliance, as short lines for a reminder:
 * requirements with no upload, uploads sent back for replacing, and documents
 * that have expired or expire within 30 days. Used by the assistant's
 * "send compliance reminder" action.
 */
async function outstandingComplianceForParticipant(participantId, now = new Date()) {
    const [participantSnapshot, applicationsSnapshot] = await Promise.all([
        emailShared_1.db.collection("participants").doc(participantId).get(),
        emailShared_1.db.collection("applications").where("participantId", "==", participantId).get(),
    ]);
    const participant = participantSnapshot.exists ? participantSnapshot.data() : {};
    const application = applicationsSnapshot.docs
        .find(item => lower(item.data().applicationStatus) === "accepted");
    if (!application)
        return { participant, application: null, programId: null, programName: "", items: [] };
    const data = application.data();
    const programId = clean(data.programId);
    const [programSnapshot, legacySnapshot, subcollection] = await Promise.all([
        programId ? emailShared_1.db.collection("programs").doc(programId).get() : Promise.resolve(null),
        programId ? emailShared_1.db.collection("programs").doc(programId).collection("requiredDocs").get() : Promise.resolve(null),
        application.ref.collection("complianceDocuments").get(),
    ]);
    const program = programSnapshot?.exists ? programSnapshot.data() : {};
    const rows = Array.isArray(program?.programRequirements) && program.programRequirements.length
        ? program.programRequirements
        : (legacySnapshot?.docs || []).map(item => {
            const row = item.data();
            return {
                key: item.id,
                title: row.title || item.id,
                kind: row.type === "agreement" ? "agreement" : "upload",
                hasExpiry: Boolean(row.expiryRule),
                expiryMonths: row.expiryRule?.months ?? null,
            };
        });
    const requirements = uploadRequirements(rows);
    const embedded = Array.isArray(participant.complianceDocuments) && participant.complianceDocuments.length
        ? participant.complianceDocuments
        : Array.isArray(data.complianceDocuments) ? data.complianceDocuments : [];
    const documents = [
        ...embedded,
        ...subcollection.docs.map(item => ({ id: item.id, ...item.data(), _subcollection: true })),
    ];
    const { items } = assessComplianceDocuments(documents, requirements, now);
    return { participant, application: { id: application.id, ...data }, programId, programName: clean(program?.name || program?.title), items };
}
exports.outstandingComplianceForParticipant = outstandingComplianceForParticipant;
/** Counts and reminder lines for one SME's documents against its programme's requirements. */
function assessComplianceDocuments(documents, requirements, now) {
    const counts = { missing: 0, queried: 0, rejected: 0, expired: 0 };
    const items = [];
    for (const requirement of requirements) {
        const latest = documents
            .filter(item => !item?.agreementId && (documentKey(item) === requirement.key ||
            (requirement.title && normalizeKey(item?.type || item?.documentName || item?.title) === normalizeKey(requirement.title))))
            .sort((a, b) => documentTime(b) - documentTime(a))[0];
        const title = requirement.title || (latest ? documentTitle(latest) : requirement.key);
        const status = lower(latest?.status);
        if (!latest || status === "missing") {
            counts.missing += 1;
            items.push(`${title}: not uploaded yet`);
            continue;
        }
        if (NOT_REMINDED_STATUSES.includes(status)) {
            if (status === "queried")
                counts.queried += 1;
            else
                counts.rejected += 1;
            items.push(`${title}: needs to be uploaded again (${status})`);
        }
    }
    for (const due of findDueDocuments(documents, now, requirements)) {
        if (due.status === "expired")
            counts.expired += 1;
        items.push(due.status === "expired"
            ? `${due.title}: expired on ${due.expiryDate.toISOString().slice(0, 10)}`
            : `${due.title}: expires on ${due.expiryDate.toISOString().slice(0, 10)}`);
    }
    return { counts, items };
}
exports.assessComplianceDocuments = assessComplianceDocuments;
/**
 * Everything needed to assess every SME's compliance in one pass: programme
 * requirements (with the legacy requiredDocs fallback) and the subcollection
 * documents per application. Used by the nightly SME risk job.
 */
async function loadComplianceContext() {
    const [complianceSnapshot, programSnapshot, legacyRequirementSnapshot] = await Promise.all([
        emailShared_1.db.collectionGroup("complianceDocuments").get(),
        emailShared_1.db.collection("programs").get(),
        emailShared_1.db.collectionGroup("requiredDocs").get(),
    ]);
    const programs = new Map(programSnapshot.docs.map(item => [item.id, item.data()]));
    const subcollectionDocuments = new Map();
    complianceSnapshot.docs.forEach(snapshot => {
        const applicationRef = snapshot.ref.parent.parent;
        if (!applicationRef || applicationRef.parent.id !== "applications")
            return;
        const existing = subcollectionDocuments.get(applicationRef.id) || [];
        existing.push({ id: snapshot.id, ...snapshot.data(), _subcollection: true });
        subcollectionDocuments.set(applicationRef.id, existing);
    });
    const legacyRequirements = new Map();
    legacyRequirementSnapshot.docs.forEach(snapshot => {
        const programRef = snapshot.ref.parent.parent;
        if (!programRef || programRef.parent.id !== "programs")
            return;
        const row = snapshot.data();
        const existing = legacyRequirements.get(programRef.id) || [];
        existing.push({
            key: snapshot.id,
            title: row.title || snapshot.id,
            kind: row.type === "agreement" ? "agreement" : "upload",
            hasExpiry: Boolean(row.expiryRule),
            expiryMonths: row.expiryRule?.months ?? null,
        });
        legacyRequirements.set(programRef.id, existing);
    });
    const requirementsFor = (programId) => {
        const program = programs.get(programId);
        const rows = Array.isArray(program?.programRequirements) && program.programRequirements.length
            ? program.programRequirements
            : legacyRequirements.get(programId) || [];
        return uploadRequirements(rows);
    };
    return { programs, subcollectionDocuments, requirementsFor };
}
exports.loadComplianceContext = loadComplianceContext;
function notificationId(applicationId, document) {
    return crypto.createHash("sha256")
        .update([
        applicationId,
        document.key,
        document.expiryDate.toISOString().slice(0, 10),
        document.phase,
    ].join("|"))
        .digest("hex");
}
function buildReminderContent(application, due) {
    const smeName = clean(application.beneficiaryName ||
        application.companyName ||
        application.businessName ||
        application.applicantName ||
        "SME");
    const expired = due.filter(item => item.status === "expired").length;
    const expiring = due.length - expired;
    const subject = `Compliance action required: ${smeName}`;
    const items = due.map(item => {
        const date = item.expiryDate.toISOString().slice(0, 10);
        const label = item.status === "expired"
            ? `Expired ${Math.abs(item.daysUntilExpiry)} day${Math.abs(item.daysUntilExpiry) === 1 ? "" : "s"} ago`
            : `Expires in ${item.daysUntilExpiry} day${item.daysUntilExpiry === 1 ? "" : "s"}`;
        return `${item.title} — ${label} (${date})`;
    });
    const staffUrl = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/compliance`;
    const smeUrl = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/incubatee/compliance`;
    const intro = [
        expired ? `${expired} document${expired === 1 ? " has" : "s have"} expired.` : "",
        expiring ? `${expiring} document${expiring === 1 ? " is" : "s are"} expiring within ${EXPIRING_SOON_DAYS} days.` : "",
    ].filter(Boolean).join(" ");
    return {
        subject,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:720px;margin:auto">
      <h2 style="color:#1457a6">Compliance document reminder</h2>
      <p><strong>${escapeHtml(smeName)}</strong>: ${escapeHtml(intro)}</p>
      <ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p>SME: <a href="${escapeHtml(smeUrl)}">open your compliance documents</a><br/>
      ROM staff: <a href="${escapeHtml(staffUrl)}">open compliance tracking</a></p>
      <p>Please replace expired documents and review documents approaching expiry.</p>
      <p>Regards,<br/>Lepharo Smart Incubator</p>
    </div>`,
        text: [
            "Compliance document reminder",
            "",
            `${smeName}: ${intro}`,
            "",
            ...items.map(item => `- ${item}`),
            "",
            `SME compliance: ${smeUrl}`,
            `ROM compliance tracking: ${staffUrl}`,
            "",
            "Please replace expired documents and review documents approaching expiry.",
        ].join("\n"),
    };
}
exports.complianceExpiryReminderCron = (0, scheduler_1.onSchedule)({
    ...config_1.BREVO_EGRESS,
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const now = new Date();
    const [applicationsSnapshot, complianceSnapshot, programSnapshot, legacyRequirementSnapshot, participantSnapshot, recipientDirectory,] = await Promise.all([
        emailShared_1.db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"]).get(),
        emailShared_1.db.collectionGroup("complianceDocuments").get(),
        emailShared_1.db.collection("programs").get(),
        emailShared_1.db.collectionGroup("requiredDocs").get(),
        emailShared_1.db.collection("participants").get(),
        loadRecipientDirectory(),
    ]);
    const programs = new Map(programSnapshot.docs.map(item => [item.id, item.data()]));
    const participants = new Map(participantSnapshot.docs.map(item => [item.id, item.data()]));
    const subcollectionDocuments = new Map();
    complianceSnapshot.docs.forEach(snapshot => {
        const applicationRef = snapshot.ref.parent.parent;
        if (!applicationRef || applicationRef.parent.id !== "applications")
            return;
        const existing = subcollectionDocuments.get(applicationRef.id) || [];
        existing.push({ id: snapshot.id, ...snapshot.data(), _subcollection: true });
        subcollectionDocuments.set(applicationRef.id, existing);
    });
    // Older programmes only have the requiredDocs mirror, as the app's resolver
    // falls back to.
    const legacyRequirements = new Map();
    legacyRequirementSnapshot.docs.forEach(snapshot => {
        const programRef = snapshot.ref.parent.parent;
        if (!programRef || programRef.parent.id !== "programs")
            return;
        const row = snapshot.data();
        const existing = legacyRequirements.get(programRef.id) || [];
        existing.push({
            key: snapshot.id,
            title: row.title || snapshot.id,
            kind: row.type === "agreement" ? "agreement" : "upload",
            hasExpiry: Boolean(row.expiryRule),
            expiryMonths: row.expiryRule?.months ?? null,
        });
        legacyRequirements.set(programRef.id, existing);
    });
    const requirementsFor = (programId) => {
        const program = programs.get(programId);
        const rows = Array.isArray(program?.programRequirements) && program.programRequirements.length
            ? program.programRequirements
            : legacyRequirements.get(programId) || [];
        return uploadRequirements(rows);
    };
    let applicationsNotified = 0;
    let documentsNotified = 0;
    for (const applicationSnapshot of applicationsSnapshot.docs) {
        const application = applicationSnapshot.data();
        if ((0, syntheticData_1.suppressRecordNotifications)(application, applicationSnapshot.id))
            continue;
        // Embedded documents come from where the app reads them: the
        // participant's array when it has entries, else the application's.
        const participant = participants.get(clean(application.participantId)) || {};
        const embedded = Array.isArray(participant.complianceDocuments) && participant.complianceDocuments.length
            ? participant.complianceDocuments
            : Array.isArray(application.complianceDocuments)
                ? application.complianceDocuments
                : [];
        const program = programs.get(clean(application.programId)) || {};
        const due = findDueDocuments([
            ...embedded,
            ...(subcollectionDocuments.get(applicationSnapshot.id) || []),
        ], now, requirementsFor(clean(application.programId)));
        if (!due.length)
            continue;
        const unsent = [];
        for (const document of due) {
            const ledger = await emailShared_1.db.collection("complianceExpiryNotifications")
                .doc(notificationId(applicationSnapshot.id, document))
                .get();
            if (!ledger.exists)
                unsent.push(document);
        }
        if (!unsent.length)
            continue;
        const recipientApplication = {
            ...application,
            email: application.email ||
                application.applicantEmail ||
                participant.email ||
                participant.contactEmail,
        };
        const { staff, staffUids, smeEmail } = resolveRecipients(recipientApplication, program, recipientDirectory);
        if (!staff.length && !smeEmail) {
            logger.warn("complianceExpiryReminderCron.noRecipients", {
                applicationId: applicationSnapshot.id,
                programId: clean(application.programId),
            });
            continue;
        }
        const content = buildReminderContent(application, unsent);
        const participantId = clean(application.participantId) || null;
        const programId = clean(application.programId) || null;
        await (0, complianceExpiryInApp_1.createComplianceExpiryInAppNotifications)({
            applicationId: applicationSnapshot.id,
            participantId,
            programId,
            staffUids,
            smeEmail,
            due: unsent,
            recipientDirectory,
        });
        if (staff.length) {
            await (0, emailShared_1.sendStatusChangeNotification)(staff, content.subject, content.html, content.text);
        }
        if (smeEmail) {
            try {
                const { messageId } = await (0, brevoClient_1.sendViaBrevo)({
                    to: smeEmail,
                    subject: content.subject,
                    html: content.html,
                    text: content.text,
                    tags: ["compliance-expiry-reminder"],
                });
                await (0, brevoClient_1.logBrevoSend)({
                    type: "COMPLIANCE_EXPIRY_REMINDER",
                    to: smeEmail,
                    subject: content.subject,
                    status: "sent",
                    messageId,
                    participantId,
                    programId,
                });
            }
            catch (err) {
                const msg = String(err?.message || err);
                await (0, brevoClient_1.logBrevoSend)({
                    type: "COMPLIANCE_EXPIRY_REMINDER",
                    to: smeEmail,
                    subject: content.subject,
                    status: "failed",
                    error: msg,
                    participantId,
                    programId,
                });
                logger.error("complianceExpiryReminderCron.smeEmailFailed", {
                    applicationId: applicationSnapshot.id,
                    error: msg,
                });
            }
        }
        const batch = emailShared_1.db.batch();
        unsent.forEach(document => {
            const ref = emailShared_1.db.collection("complianceExpiryNotifications")
                .doc(notificationId(applicationSnapshot.id, document));
            batch.set(ref, {
                applicationId: applicationSnapshot.id,
                participantId: clean(application.participantId),
                programId: clean(application.programId),
                documentKey: document.key,
                documentTitle: document.title,
                expiryDate: document.expiryDate.toISOString().slice(0, 10),
                complianceStatus: document.status,
                reminderPhase: document.phase,
                recipientCount: staff.length + (smeEmail ? 1 : 0),
                sentAt: new Date(),
            });
        });
        await batch.commit();
        applicationsNotified += 1;
        documentsNotified += unsent.length;
    }
    logger.info("complianceExpiryReminderCron.complete", {
        applicationsScanned: applicationsSnapshot.size,
        applicationsNotified,
        documentsNotified,
    });
});
//# sourceMappingURL=complianceExpiry.js.map