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
exports.onOpportunityInterestStage = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const whatsappAlerts_1 = require("./whatsappAlerts");
const syntheticData_1 = require("./syntheticData");
const bidPipelineLogic_1 = require("./bidPipelineLogic");
// Market linkage, phase 2: tells people when a bid moves. Stages are written
// by the app (the SME answers its invitation; Market Linkages moves the rest,
// both checked by firestore.rules), so every change is caught here in one place.
const clean = (value) => String(value ?? "").trim();
const escapeHtml = (value) => clean(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
exports.onOpportunityInterestStage = (0, firestore_1.onDocumentUpdated)({ region: "us-central1", document: "opportunityInterests/{interestId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || clean(before.status) === clean(after.status) || !(0, bidPipelineLogic_1.isBidStage)(after.status))
        return;
    const interestId = event.params.interestId;
    const stage = after.status;
    const title = clean(after.opportunity?.title) || "the opportunity";
    const name = clean(after.participantName) || "The SME";
    try {
        // The SME answered: let the officer who invited them know.
        if (stage === "interested" || stage === "declined") {
            await (0, inAppNotifications_1.notifyInApp)({
                type: "market_opportunity_answer",
                message: stage === "interested"
                    ? `${name} is interested in "${title}".`
                    : `${name} passed on "${title}".`,
                recipientIds: [clean(after.invitedBy)],
                opportunityId: after.opportunityId,
                participantId: after.participantId,
                link: "/market-linkage",
            });
            return;
        }
        const note = (0, bidPipelineLogic_1.stageMessage)(stage, {
            title,
            buyer: after.opportunity?.buyer,
            lostReason: after.lostReason,
            lostNote: after.lostNote,
        });
        if (!note)
            return;
        // Seeded SMEs get the in-app record but never a real email or WhatsApp.
        const quiet = (0, syntheticData_1.suppressRecordNotifications)(after, interestId);
        const email = clean(after.participantEmail).toLowerCase();
        const uid = await (0, inAppNotifications_1.uidForParticipant)(after.participantId, email);
        await (0, inAppNotifications_1.notifyInApp)({
            type: `market_bid_${stage}`,
            message: `${note.headline}. ${note.details}`,
            recipientIds: [uid],
            opportunityId: after.opportunityId,
            participantId: after.participantId,
            link: "/incubatee/opportunities",
        });
        if (quiet)
            return;
        const link = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/incubatee/opportunities`;
        if (email.includes("@")) {
            await (0, emailShared_1.sendStatusChangeNotification)([email], note.headline, `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
            <h2 style="color:#1457a6">${escapeHtml(note.headline)}</h2>
            <p>${escapeHtml(note.details)}</p>
            <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Open your opportunities</a></p>
          </div>`, `${note.headline}\n${note.details}\n${link}`).catch((error) => logger.warn("onOpportunityInterestStage.emailFailed", { interestId, error: String(error) }));
        }
        if (note.whatsapp && uid) {
            await (0, whatsappAlerts_1.sendWhatsAppAlert)(uid, { name, headline: note.headline.slice(0, 120), details: note.details.slice(0, 500) }, `bid:${interestId}:${stage}`);
        }
    }
    catch (error) {
        logger.error("onOpportunityInterestStage.failed", { interestId, stage, error: String(error) });
    }
});
//# sourceMappingURL=bidPipeline.js.map