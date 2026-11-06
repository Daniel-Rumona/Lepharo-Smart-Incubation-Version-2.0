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
exports.onMovPackChanged = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const movRecipients_1 = require("./movRecipients");
const syntheticData_1 = require("./syntheticData");
// Monthly MOV pack hand-offs, as they happen (the daily stage reminders still
// chase anything left waiting):
//   - HOD submits a pack            -> the programme's Center Coordinator is told
//   - HOD updates a pack awaiting CC -> the programme's Center Coordinator is told what changed
//   - CC confirms the pack           -> M&E is told it's ready to validate
// In-app (and push) only; the types aren't in NOTIFICATION_REGISTRY, so no extra email.
const REGION = "us-central1";
const clean = (value) => String(value ?? "").trim();
const steps = (pack) => (Array.isArray(pack?.approvals) ? pack.approvals : []).map((a) => clean(a?.step));
const monthLabel = (key) => {
    const [year, month] = key.split("-").map(Number);
    if (!year || !month)
        return key || "this month";
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
};
const itemCount = (pack) => (Array.isArray(pack?.interventions) ? pack.interventions : Array.isArray(pack?.interventionsSnapshot) ? pack.interventionsSnapshot : []).length ||
    Number(pack?.totalItems || 0);
const millis = (value) => {
    if (!value)
        return 0;
    if (typeof value?.toMillis === "function")
        return value.toMillis();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
exports.onMovPackChanged = (0, firestore_1.onDocumentWritten)({ document: "consolidatedMOVs/{packId}", region: REGION }, async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    if (!after)
        return;
    if ((0, syntheticData_1.suppressRecordNotifications)(after, event.params.packId))
        return;
    const department = clean(after.department) || "A department";
    const month = monthLabel(clean(after.month));
    const base = { packId: event.params.packId, programId: clean(after.programId) || null, packMonth: clean(after.month) };
    const stepsBefore = before ? steps(before) : [];
    const stepsAfter = steps(after);
    const confirmedByCc = stepsAfter.includes("final_confirmation");
    // The project admins of the branch that runs this pack's programme; all of them
    // only when the programme has no one linked, so the pack is never left unseen.
    const notifyCc = async (type, message) => {
        const programId = (0, movRecipients_1.resolvePackProgramId)(after);
        const own = await (0, movRecipients_1.getProgramProjectAdmins)(programId);
        let recipientIds = own.uids;
        if (!recipientIds.length) {
            logger.warn("onMovPackChanged.noProgramCc", { packId: event.params.packId, programId });
            recipientIds = await (0, movRecipients_1.uidsForEmails)(await (0, emailShared_1.getCCRecipients)());
        }
        await (0, inAppNotifications_1.notifyInApp)({ ...base, type, message, link: "/projectadmin/movs", recipientIds });
    };
    // Submitted.
    if (!before) {
        await notifyCc("mov_pack_submitted", `${department} submitted its ${month} MOV pack (${plural(itemCount(after), "MOV")}) for your confirmation.`);
        return;
    }
    // Updated by the HOD while it still waits for the CC.
    const update = after.lastHodUpdate;
    if (!confirmedByCc && update && millis(update.at) !== millis(before.lastHodUpdate?.at)) {
        const changes = [
            Number(update.added) > 0 ? `${plural(Number(update.added), "MOV")} added` : null,
            Number(update.removed) > 0 ? `${plural(Number(update.removed), "MOV")} removed` : null,
            update.invoiceReplaced ? "invoice replaced" : null,
        ].filter(Boolean);
        await notifyCc("mov_pack_updated", `${department} updated its ${month} MOV pack${changes.length ? ` (${changes.join(", ")})` : ""}. Please review it before confirming.`);
    }
    // Confirmed by the CC: over to M&E.
    if (!stepsBefore.includes("final_confirmation") && confirmedByCc) {
        await (0, inAppNotifications_1.notifyInApp)({
            ...base,
            type: "mov_pack_confirmed",
            message: `The Center Coordinator confirmed ${department}'s ${month} MOV pack (${plural(itemCount(after), "MOV")}). It's ready for M&E validation.`,
            link: "/operations/monitoring/movs",
            recipientIds: await (0, movRecipients_1.uidsForEmails)(await (0, emailShared_1.getMERecipients)()),
        });
    }
});
//# sourceMappingURL=movPackNotifications.js.map