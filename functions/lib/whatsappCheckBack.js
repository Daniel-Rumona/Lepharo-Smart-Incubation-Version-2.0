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
exports.recordCheckBackTap = exports.sendCheckBackWhatsApp = exports.whatsappConfigured = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const syntheticData_1 = require("./syntheticData");
const emailShared_1 = require("./emailShared");
const whatsappCommon_1 = require("./whatsappCommon");
const whatsappStaff_1 = require("./whatsappStaff");
const whatsappCheckBackLogic_1 = require("./whatsappCheckBackLogic");
// Sends an outcome check-back to WhatsApp and records the answer when a button
// is tapped. Sending goes through the router's dispatch endpoint (the router
// owns the WhatsApp credentials); answering comes back through the gateway.
// Nothing here may break the reminder job: every failure is logged and swallowed.
const lower = (value) => (0, whatsappCommon_1.clean)(value).toLowerCase();
async function post(dispatch) {
    const url = (0, whatsappCommon_1.clean)(process.env.WHATSAPP_DISPATCH_URL);
    const secret = (0, whatsappCommon_1.clean)(process.env.WHATSAPP_DISPATCH_SECRET);
    if (!url || !secret)
        return "failed";
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-whatsapp-dispatch-secret": secret },
            body: JSON.stringify(dispatch),
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
            logger.warn("whatsappCheckBack.dispatchRejected", { status: response.status, followUpId: dispatch.followUpId });
            return "failed";
        }
        return "sent";
    }
    catch (error) {
        logger.warn("whatsappCheckBack.dispatchFailed", { followUpId: dispatch.followUpId, error: String(error) });
        return "failed";
    }
}
const whatsappConfigured = () => !!(0, whatsappCommon_1.clean)(process.env.WHATSAPP_DISPATCH_URL) && !!(0, whatsappCommon_1.clean)(process.env.WHATSAPP_DISPATCH_SECRET);
exports.whatsappConfigured = whatsappConfigured;
async function staffNumber(assigneeId) {
    for (const collection of ["users", "coordinators", "operationsStaff"]) {
        const data = (await emailShared_1.db.collection(collection).doc(assigneeId).get()).data();
        const number = (0, whatsappCommon_1.normalizePhone)(data?.phone || data?.phoneNumber);
        if (number.length >= 9)
            return number;
    }
    return "";
}
/** The SME's WhatsApp number, only if they said yes to WhatsApp updates. */
async function smeConsentedNumber(email) {
    if (!email)
        return "";
    const snap = await emailShared_1.db.collection("users").where("email", "==", lower(email)).limit(5).get();
    const match = snap.docs.find((doc) => {
        const data = doc.data();
        return lower(data.role) === "incubatee" && data.whatsappConsent?.status === "granted";
    });
    return match ? (0, whatsappCommon_1.normalizePhone)(match.data().whatsappConsent?.number) : "";
}
/**
 * Message the facilitator (every reminder) and, once, the SME if the HOD asked
 * for their view and they agreed to WhatsApp. "skipped" means there was nobody
 * or nothing to send to; "failed" means we tried and it did not go.
 */
async function sendCheckBackWhatsApp(followUpId, followUp, options) {
    const result = { facilitator: "skipped", sme: "skipped" };
    if ((0, syntheticData_1.suppressRecordNotifications)(followUp, followUpId))
        return result;
    if (!(0, exports.whatsappConfigured)())
        return result;
    try {
        const to = await staffNumber((0, whatsappCommon_1.clean)(followUp.assigneeId));
        if (to) {
            result.facilitator = await post((0, whatsappCheckBackLogic_1.facilitatorDispatch)({
                followUpId,
                to,
                facilitatorName: followUp.assigneeName,
                interventionTitle: followUp.interventionTitle,
                smeName: followUp.participantName,
            }));
        }
    }
    catch (error) {
        logger.warn("whatsappCheckBack.facilitatorFailed", { followUpId, error: String(error) });
        result.facilitator = "failed";
    }
    if (options.sendToSme) {
        try {
            const to = await smeConsentedNumber((0, whatsappCommon_1.clean)(followUp.participantEmail));
            if (to) {
                result.sme = await post((0, whatsappCheckBackLogic_1.smeDispatch)({
                    followUpId,
                    to,
                    smeName: followUp.participantName,
                    interventionTitle: followUp.interventionTitle,
                }));
            }
        }
        catch (error) {
            logger.warn("whatsappCheckBack.smeFailed", { followUpId, error: String(error) });
            result.sme = "failed";
        }
    }
    return result;
}
exports.sendCheckBackWhatsApp = sendCheckBackWhatsApp;
/**
 * A button tap relayed by the router. Works out who tapped from their phone
 * number, applies the rules in whatsappCheckBackLogic, and records the answer
 * by patching the follow-up, which is exactly what the app and email do, so
 * the same trigger turns it into an assessment.
 */
async function recordCheckBackTap(input) {
    const followUpId = (0, whatsappCommon_1.clean)(input.followUpId);
    if (!followUpId)
        return { recorded: false, reply: "I could not find that check-back." };
    const ref = emailShared_1.db.collection("outcomeFollowUps").doc(followUpId);
    const snapshot = await ref.get();
    const followUp = (snapshot.data() || {});
    const staff = await (0, whatsappStaff_1.resolveStaffByPhone)(input.phoneNumber);
    const staffOwnerIds = staff ? [staff.id, staff.uid || ""].filter(Boolean) : [];
    // An SME may reply from the number they gave consent on, even if their profile number differs.
    const digits = (0, whatsappCommon_1.normalizePhone)(input.phoneNumber);
    let smeConsentNumberMatches = false;
    if (digits && (0, whatsappCommon_1.clean)(followUp.participantEmail)) {
        for (const candidate of (0, whatsappCommon_1.candidatePhoneValues)(digits)) {
            const owners = await emailShared_1.db.collection("users").where("whatsappConsent.number", "==", candidate).limit(3).get();
            if (owners.docs.some((doc) => lower(doc.data().email) === lower(followUp.participantEmail))) {
                smeConsentNumberMatches = true;
                break;
            }
        }
    }
    const decision = (0, whatsappCheckBackLogic_1.decideFollowUpTap)({
        followUp,
        staffOwnerIds,
        participantIds: input.smeParticipantIds,
        smeConsentNumberMatches,
        code: (0, whatsappCommon_1.clean)(input.code).toUpperCase(),
    });
    if (!decision.ok)
        return { recorded: false, reply: decision.reply };
    await ref.update(decision.patch);
    return { recorded: true, reply: decision.reply };
}
exports.recordCheckBackTap = recordCheckBackTap;
//# sourceMappingURL=whatsappCheckBack.js.map