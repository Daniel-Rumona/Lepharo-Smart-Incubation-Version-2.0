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
exports.getProgramProjectAdmins = exports.resolvePackProgramId = exports.uidsForEmails = exports.resolveMovDepartmentId = exports.getDepartmentHods = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const emailShared_1 = require("./emailShared");
/** HODs of one department: operations-role users carrying that departmentId. */
async function getDepartmentHods(departmentId) {
    const target = { emails: [], uids: [] };
    try {
        const snap = await emailShared_1.db
            .collection("users")
            .where("role", "==", "operations")
            .where("departmentId", "==", departmentId)
            .get();
        for (const u of snap.docs) {
            const email = String(u.data().email || "").trim().toLowerCase();
            if (email.includes("@"))
                target.emails.push(email);
            target.uids.push(u.id);
        }
    }
    catch (error) {
        logger.warn("movStageReminderCron.hodLookupFailed", { departmentId, error: String(error) });
    }
    return target;
}
exports.getDepartmentHods = getDepartmentHods;
/**
 * The MOV's own departmentId, else its intervention's. Older MOVs may lack
 * the field; the intervention is the source of truth for ownership.
 */
const interventionDeptCache = new Map();
async function resolveMovDepartmentId(mov) {
    const direct = String(mov.departmentId || "").trim();
    if (direct)
        return direct;
    const interventionId = String(mov.interventionId || "").trim();
    if (!interventionId)
        return null;
    if (interventionDeptCache.has(interventionId))
        return interventionDeptCache.get(interventionId) ?? null;
    let resolved = null;
    try {
        const snap = await emailShared_1.db.collection("interventions").doc(interventionId).get();
        resolved = String(snap.data()?.departmentId || "").trim() || null;
    }
    catch (error) {
        logger.warn("movStageReminderCron.interventionLookupFailed", { interventionId, error: String(error) });
    }
    interventionDeptCache.set(interventionId, resolved);
    return resolved;
}
exports.resolveMovDepartmentId = resolveMovDepartmentId;
/** Firebase uids for a list of emails, so in-app notifications can target people instead of a whole role. */
async function uidsForEmails(emails) {
    const uids = new Set();
    const unique = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
    for (let i = 0; i < unique.length; i += 10) {
        try {
            const snap = await emailShared_1.db.collection("users").where("email", "in", unique.slice(i, i + 10)).get();
            snap.docs.forEach((d) => uids.add(d.id));
        }
        catch (error) {
            logger.warn("uidsForEmails.failed", { error: String(error) });
        }
    }
    return Array.from(uids);
}
exports.uidsForEmails = uidsForEmails;
/**
 * The programme a pack (or MOV) belongs to: its own programId, else the
 * first of its MOVs that names one.
 */
function resolvePackProgramId(pack) {
    const direct = String(pack?.programId || "").trim();
    if (direct)
        return direct;
    const items = Array.isArray(pack?.interventions) ? pack.interventions : Array.isArray(pack?.interventionsSnapshot) ? pack.interventionsSnapshot : [];
    const fromItem = items.map((item) => String(item?.programId || "").trim()).find(Boolean);
    return fromItem || null;
}
exports.resolvePackProgramId = resolvePackProgramId;
/** A programme's managing branch, read the same way the app scopes a project admin's programmes. */
async function programBranchId(programId) {
    try {
        const program = (await emailShared_1.db.collection("programs").doc(programId).get()).data();
        if (!program)
            return null;
        const assigned = program.assignedBranch;
        const id = program.normalizedAssignedBranchId || program.branchId || (typeof assigned === "string" ? assigned : assigned?.id) || program.assignedBranchId;
        return String(id || "").trim() || null;
    }
    catch (error) {
        logger.warn("programBranchId.failed", { programId, error: String(error) });
        return null;
    }
}
/**
 * The Center Coordinators (project admins) of a programme: those assigned to
 * the branch that manages it. Empty when the programme has no branch or
 * nobody is assigned to it; callers decide on a fallback.
 */
async function getProgramProjectAdmins(programId) {
    const target = { emails: [], uids: [] };
    const id = String(programId || "").trim();
    if (!id)
        return target;
    const branchId = await programBranchId(id);
    if (!branchId)
        return target;
    try {
        const snap = await emailShared_1.db.collection("users").where("role", "==", "projectadmin").where("assignedBranch", "==", branchId).get();
        for (const u of snap.docs) {
            const email = String(u.data().email || "").trim().toLowerCase();
            if (email.includes("@"))
                target.emails.push(email);
            target.uids.push(u.id);
        }
    }
    catch (error) {
        logger.warn("getProgramProjectAdmins.failed", { programId: id, branchId, error: String(error) });
    }
    return target;
}
exports.getProgramProjectAdmins = getProgramProjectAdmins;
//# sourceMappingURL=movRecipients.js.map