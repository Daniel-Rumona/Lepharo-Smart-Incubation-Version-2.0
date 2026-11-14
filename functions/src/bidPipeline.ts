import * as logger from "firebase-functions/logger";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";
import { notifyInApp, uidForParticipant } from "./inAppNotifications";
import { sendWhatsAppAlert } from "./whatsappAlerts";
import { suppressRecordNotifications } from "./syntheticData";
import { isBidStage, stageMessage } from "./bidPipelineLogic";

// Market linkage, phase 2: tells people when a bid moves. Stages are written
// by the app (the SME answers its invitation; Market Linkages moves the rest,
// both checked by firestore.rules), so every change is caught here in one place.

const clean = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export const onOpportunityInterestStage = onDocumentUpdated(
  { region: "us-central1", document: "opportunityInterests/{interestId}" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || clean(before.status) === clean(after.status) || !isBidStage(after.status)) return;
    const interestId = event.params.interestId;
    const stage = after.status;
    const title = clean(after.opportunity?.title) || "the opportunity";
    const name = clean(after.participantName) || "The SME";

    try {
      // The SME answered: let the officer who invited them know.
      if (stage === "interested" || stage === "declined") {
        await notifyInApp({
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

      const note = stageMessage(stage, {
        title,
        buyer: after.opportunity?.buyer,
        lostReason: after.lostReason,
        lostNote: after.lostNote,
      });
      if (!note) return;
      // Seeded SMEs get the in-app record but never a real email or WhatsApp.
      const quiet = suppressRecordNotifications(after, interestId);

      const email = clean(after.participantEmail).toLowerCase();
      const uid = await uidForParticipant(after.participantId, email);
      await notifyInApp({
        type: `market_bid_${stage}`,
        message: `${note.headline}. ${note.details}`,
        recipientIds: [uid],
        opportunityId: after.opportunityId,
        participantId: after.participantId,
        link: "/incubatee/opportunities",
      });

      if (quiet) return;
      const link = `${APP_BASE_URL.replace(/\/$/, "")}/incubatee/opportunities`;
      if (email.includes("@")) {
        await sendStatusChangeNotification(
          [email],
          note.headline,
          `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
            <h2 style="color:#1457a6">${escapeHtml(note.headline)}</h2>
            <p>${escapeHtml(note.details)}</p>
            <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Open your opportunities</a></p>
          </div>`,
          `${note.headline}\n${note.details}\n${link}`
        ).catch((error) => logger.warn("onOpportunityInterestStage.emailFailed", { interestId, error: String(error) }));
      }
      if (note.whatsapp && uid) {
        await sendWhatsAppAlert(uid, { name, headline: note.headline.slice(0, 120), details: note.details.slice(0, 500) }, `bid:${interestId}:${stage}`);
      }
    } catch (error) {
      logger.error("onOpportunityInterestStage.failed", { interestId, stage, error: String(error) });
    }
  }
);
