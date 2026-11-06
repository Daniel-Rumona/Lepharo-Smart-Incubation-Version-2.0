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
exports.onMovLateConfirmation = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const movRecipients_1 = require("./movRecipients");
const syntheticData_1 = require("./syntheticData");
// Late MOV confirmations.
//
// An MOV belongs to the monthly consolidated pack of its due month (an
// intervention assigned on 31 Jul or 1 Aug and due 31 Aug is August's work).
// When the SME only confirms it after that month's pack was submitted, the
// department's HODs are told, so it isn't missed:
//   - pack still awaiting the Center Coordinator: approve the MOV, then use
//     Update Pack to add it;
//   - pack already confirmed or validated: it goes into the next open month.
const REGION = "us-central1";
const clean = (value) => String(value ?? "").trim();
/** Same test as isSmeConfirmedMov on the client. */
const isSmeConfirmed = (mov) => mov?.smmeAccepted === true ||
    ["confirmed", "accepted", "complete", "completed"].includes(clean(mov?.participantCompletionStatus).toLowerCase()) ||
    !!mov?.smmeAcceptedAt ||
    !!mov?.smmeSignedAt;
const asDate = (value) => {
    if (!value)
        return null;
    if (typeof value?.toDate === "function")
        return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};
/** YYYY-MM in South African time, so a due date of 31 Aug 23:00 stays in August. */
const monthKeyOf = (date) => new Date(date.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 7);
const monthLabel = (key) => {
    const [year, month] = key.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
};
/** The MOV's due date: on the MOV, else on its assignment, else when the work started. */
async function dueDateOf(mov) {
    const direct = asDate(mov.dueDate);
    if (direct)
        return direct;
    const assignmentId = clean(mov.assignedInterventionId);
    if (assignmentId) {
        try {
            const snap = await emailShared_1.db.collection("assignedInterventions").doc(assignmentId).get();
            const due = asDate(snap.data()?.dueDate);
            if (due)
                return due;
        }
        catch (error) {
            logger.warn("movLateConfirmation.assignmentLookupFailed", { assignmentId, error: String(error) });
        }
    }
    return asDate(mov.assignmentCreatedAt) || asDate(mov.periodStart) || asDate(mov.interventionDate);
}
exports.onMovLateConfirmation = (0, firestore_1.onDocumentUpdated)({ document: "movDocuments/{movId}", region: REGION }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    // Only the moment the SME confirms, not every later edit.
    if (isSmeConfirmed(before) || !isSmeConfirmed(after))
        return;
    if ((0, syntheticData_1.suppressRecordNotifications)(after, event.params.movId))
        return;
    const due = await dueDateOf(after);
    if (!due)
        return;
    const departmentId = await (0, movRecipients_1.resolveMovDepartmentId)(after);
    if (!departmentId) {
        logger.warn("movLateConfirmation.noDepartment", { movId: event.params.movId });
        return;
    }
    const month = monthKeyOf(due);
    let packQuery = emailShared_1.db.collection("consolidatedMOVs").where("departmentId", "==", departmentId).where("month", "==", month);
    if (clean(after.programId))
        packQuery = packQuery.where("programId", "==", clean(after.programId));
    const packs = await packQuery.limit(1).get();
    if (packs.empty)
        return; // Its month hasn't been packed yet: it's simply on time.
    const pack = packs.docs[0].data();
    const steps = (Array.isArray(pack.approvals) ? pack.approvals : []).map((a) => a?.step);
    const locked = steps.includes("final_confirmation") || steps.includes("validation");
    const hods = await (0, movRecipients_1.getDepartmentHods)(departmentId);
    const company = clean(after.smmeCompanyName) || "An SME";
    const title = clean(after.interventionTitle) || "an intervention";
    const dueMonth = monthLabel(month);
    const nextStep = locked
        ? `${dueMonth}'s pack is already confirmed, so once approved it goes into the next open month's pack.`
        : `Open it to approve it and add it to the ${dueMonth} pack (still waiting for the CC).`;
    await (0, inAppNotifications_1.notifyInApp)({
        type: "mov_late_confirmation",
        message: `Late MOV: ${company} confirmed “${title}”, due in ${dueMonth}. ${nextStep}`,
        recipientIds: hods.uids,
        // Opens this MOV directly; approving it there offers to add it to the open pack.
        link: `/operations/movs?mov=${encodeURIComponent(event.params.movId)}`,
        movId: event.params.movId,
        programId: clean(after.programId) || null,
        dueMonth: month,
        packLocked: locked,
    });
});
//# sourceMappingURL=movLateConfirmation.js.map