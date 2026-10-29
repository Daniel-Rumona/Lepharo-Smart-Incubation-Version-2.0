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
exports.onDevPlanSmeConfirmedNotifyHod = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const movRecipients_1 = require("./movRecipients");
const syntheticData_1 = require("./syntheticData");
/**
 * When an SME confirms a department's part of their development plan, that
 * department's HODs get an in-app notice that they can start assigning the
 * work. In-app only: the type is not in NOTIFICATION_REGISTRY, so no email
 * goes out, and nothing is sent on WhatsApp.
 */
// SME sign-off lives in two maps (the roadmap and the plan builder write
// different ones); a department counts as confirmed when either says so.
const isOn = (value) => value === true || (value && typeof value === "object" && value.confirmed === true);
const confirmedDeptIds = (plan) => {
    const ids = new Set();
    for (const map of [plan?.incubateeDepartmentConfirmationsByDeptId, plan?.smmeConfirmedByDeptId]) {
        Object.entries(map || {}).forEach(([id, value]) => {
            if (isOn(value))
                ids.add(id);
        });
    }
    return ids;
};
/** The department's HODs; a sub-department with none falls back to its parent's. */
async function hodUidsFor(departmentId) {
    const snap = await emailShared_1.db.collection("departments").doc(departmentId).get();
    const dept = (snap.data() || {});
    const name = String(dept.name || dept.departmentName || "your department");
    const own = await (0, movRecipients_1.getDepartmentHods)(departmentId);
    if (own.uids.length)
        return { uids: own.uids, name };
    const parentId = String(dept.parentDepartmentId || "").trim();
    if (!parentId)
        return { uids: [], name };
    return { uids: (await (0, movRecipients_1.getDepartmentHods)(parentId)).uids, name };
}
exports.onDevPlanSmeConfirmedNotifyHod = (0, firestore_1.onDocumentUpdated)({ region: "us-central1", document: "diagnosticPlans/{planId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after)
        return;
    const planId = String(event.params.planId);
    if ((0, syntheticData_1.suppressRecordNotifications)(after, planId))
        return;
    const was = confirmedDeptIds(before);
    const newlyConfirmed = Array.from(confirmedDeptIds(after)).filter((id) => !was.has(id));
    if (!newlyConfirmed.length)
        return;
    const participantId = String(after.participantId || "").trim() || null;
    const smeName = (await (0, emailShared_1.getParticipantName)(participantId)) || "An SME";
    await Promise.all(newlyConfirmed.map(async (departmentId) => {
        try {
            const { uids, name } = await hodUidsFor(departmentId);
            if (!uids.length) {
                logger.info("devPlanSmeConfirmed.noHods", { planId, departmentId });
                return;
            }
            await (0, inAppNotifications_1.notifyInApp)({
                type: "dev_plan_sme_confirmed",
                message: `${smeName} has confirmed ${name}'s part of their development plan. You can now assign the interventions.`,
                recipientIds: uids,
                link: "/operations/assignments",
                participantId,
                participantName: smeName,
                departmentId,
                diagnosticPlanId: planId,
            });
        }
        catch (error) {
            logger.warn("devPlanSmeConfirmed.failed", { planId, departmentId, error: String(error) });
        }
    }));
});
//# sourceMappingURL=devPlanSmeConfirmed.js.map