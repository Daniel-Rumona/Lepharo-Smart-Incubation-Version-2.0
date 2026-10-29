import * as logger from "firebase-functions/logger";
import { suppressRecordNotifications } from "./syntheticData";
import { db } from "./emailShared";
import { candidatePhoneValues, clean, normalizePhone } from "./whatsappCommon";
import { resolveStaffByPhone } from "./whatsappStaff";
import {
  decideFollowUpTap,
  facilitatorDispatch,
  smeDispatch,
  type CheckBackDispatch,
} from "./whatsappCheckBackLogic";

// Sends an outcome check-back to WhatsApp and records the answer when a button
// is tapped. Sending goes through the router's dispatch endpoint (the router
// owns the WhatsApp credentials); answering comes back through the gateway.
// Nothing here may break the reminder job: every failure is logged and swallowed.

const lower = (value: unknown) => clean(value).toLowerCase();

async function post(dispatch: CheckBackDispatch): Promise<"sent" | "failed"> {
  const url = clean(process.env.WHATSAPP_DISPATCH_URL);
  const secret = clean(process.env.WHATSAPP_DISPATCH_SECRET);
  if (!url || !secret) return "failed";
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
  } catch (error) {
    logger.warn("whatsappCheckBack.dispatchFailed", { followUpId: dispatch.followUpId, error: String(error) });
    return "failed";
  }
}

export const whatsappConfigured = () =>
  !!clean(process.env.WHATSAPP_DISPATCH_URL) && !!clean(process.env.WHATSAPP_DISPATCH_SECRET);

async function staffNumber(assigneeId: string): Promise<string> {
  for (const collection of ["users", "coordinators", "operationsStaff"]) {
    const data = (await db.collection(collection).doc(assigneeId).get()).data() as any;
    const number = normalizePhone(data?.phone || data?.phoneNumber);
    if (number.length >= 9) return number;
  }
  return "";
}

/** The SME's WhatsApp number, only if they said yes to WhatsApp updates. */
async function smeConsentedNumber(email: string): Promise<string> {
  if (!email) return "";
  const snap = await db.collection("users").where("email", "==", lower(email)).limit(5).get();
  const match = snap.docs.find((doc) => {
    const data = doc.data() as any;
    return lower(data.role) === "incubatee" && data.whatsappConsent?.status === "granted";
  });
  return match ? normalizePhone((match.data() as any).whatsappConsent?.number) : "";
}

export type CheckBackSendResult = { facilitator: "sent" | "failed" | "skipped"; sme: "sent" | "failed" | "skipped" };

/**
 * Message the facilitator (every reminder) and, once, the SME if the HOD asked
 * for their view and they agreed to WhatsApp. "skipped" means there was nobody
 * or nothing to send to; "failed" means we tried and it did not go.
 */
export async function sendCheckBackWhatsApp(
  followUpId: string,
  followUp: Record<string, any>,
  options: { sendToSme: boolean }
): Promise<CheckBackSendResult> {
  const result: CheckBackSendResult = { facilitator: "skipped", sme: "skipped" };
  if (suppressRecordNotifications(followUp, followUpId)) return result;
  if (!whatsappConfigured()) return result;

  try {
    const to = await staffNumber(clean(followUp.assigneeId));
    if (to) {
      result.facilitator = await post(
        facilitatorDispatch({
          followUpId,
          to,
          facilitatorName: followUp.assigneeName,
          interventionTitle: followUp.interventionTitle,
          smeName: followUp.participantName,
        })
      );
    }
  } catch (error) {
    logger.warn("whatsappCheckBack.facilitatorFailed", { followUpId, error: String(error) });
    result.facilitator = "failed";
  }

  if (options.sendToSme) {
    try {
      const to = await smeConsentedNumber(clean(followUp.participantEmail));
      if (to) {
        result.sme = await post(
          smeDispatch({
            followUpId,
            to,
            smeName: followUp.participantName,
            interventionTitle: followUp.interventionTitle,
          })
        );
      }
    } catch (error) {
      logger.warn("whatsappCheckBack.smeFailed", { followUpId, error: String(error) });
      result.sme = "failed";
    }
  }
  return result;
}

/**
 * A button tap relayed by the router. Works out who tapped from their phone
 * number, applies the rules in whatsappCheckBackLogic, and records the answer
 * by patching the follow-up, which is exactly what the app and email do, so
 * the same trigger turns it into an assessment.
 */
export async function recordCheckBackTap(input: {
  phoneNumber: string;
  followUpId: string;
  code: string;
  smeParticipantIds: string[];
}): Promise<{ recorded: boolean; reply: string }> {
  const followUpId = clean(input.followUpId);
  if (!followUpId) return { recorded: false, reply: "I could not find that check-back." };

  const ref = db.collection("outcomeFollowUps").doc(followUpId);
  const snapshot = await ref.get();
  const followUp = (snapshot.data() || {}) as Record<string, any>;

  const staff = await resolveStaffByPhone(input.phoneNumber);
  const staffOwnerIds = staff ? [staff.id, staff.uid || ""].filter(Boolean) : [];

  // An SME may reply from the number they gave consent on, even if their profile number differs.
  const digits = normalizePhone(input.phoneNumber);
  let smeConsentNumberMatches = false;
  if (digits && clean(followUp.participantEmail)) {
    for (const candidate of candidatePhoneValues(digits)) {
      const owners = await db.collection("users").where("whatsappConsent.number", "==", candidate).limit(3).get();
      if (owners.docs.some((doc) => lower((doc.data() as any).email) === lower(followUp.participantEmail))) {
        smeConsentNumberMatches = true;
        break;
      }
    }
  }

  const decision = decideFollowUpTap({
    followUp,
    staffOwnerIds,
    participantIds: input.smeParticipantIds,
    smeConsentNumberMatches,
    code: clean(input.code).toUpperCase(),
  });
  if (!decision.ok) return { recorded: false, reply: decision.reply };

  await ref.update(decision.patch);
  return { recorded: true, reply: decision.reply };
}
