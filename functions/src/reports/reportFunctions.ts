import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { admin, db } from "../firebase";
import { clean } from "./lib";
import { generateReport, ReportError } from "./registry";

/**
 * Where reports are asked for. The web app calls generateReport and downloads the file it returns. On
 * WhatsApp the gateway queues a reportRequests document (building a deck can take longer than a chat reply
 * may wait); onReportRequested builds it and has the router send the file into the chat, which WhatsApp
 * allows because the person messaged in the last 24 hours.
 */

const REPORT_RUNTIME = { region: "us-central1", timeoutSeconds: 300, memory: "1GiB" as const };

export const generateReportCallable = onCall(REPORT_RUNTIME, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to generate reports.");
  const user = await db.collection("users").doc(request.auth.uid).get();
  if (!user.exists) throw new HttpsError("permission-denied", "Your profile could not be found.");
  try {
    const result = await generateReport({ id: user.id, data: user.data()! }, clean(request.data?.reportId), clean(request.data?.month), "web");
    return { url: result.url, fileName: result.fileName, title: result.title };
  } catch (error) {
    if (error instanceof ReportError) {
      throw new HttpsError(error.message === "invalid_month" ? "invalid-argument" : "permission-denied",
        error.message === "invalid_month" ? "Choose a month that has started." : "You can't generate this report.");
    }
    if (String(error).includes("no_assigned_centre")) throw new HttpsError("failed-precondition", "Your profile has no assigned centre.");
    logger.error("Report generation failed", { reportId: request.data?.reportId, error: String(error) });
    throw new HttpsError("internal", "The report could not be generated. Please try again.");
  }
});

/** Sends a WhatsApp message through the router's dispatch (it owns the WhatsApp credentials). */
async function dispatch(body: Record<string, unknown>) {
  const url = clean(process.env.WHATSAPP_DISPATCH_URL);
  const secret = clean(process.env.WHATSAPP_DISPATCH_SECRET);
  if (!url || !secret) throw new Error("WhatsApp dispatch is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-whatsapp-dispatch-secret": secret },
    body: JSON.stringify({ engine: "LPH", ...body }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`WhatsApp dispatch rejected (${response.status}).`);
}

export const onReportRequested = onDocumentCreated(
  { ...REPORT_RUNTIME, document: "reportRequests/{requestId}" },
  async (event) => {
    const request = event.data?.data();
    if (!event.data || !request) return;
    const ref = event.data.ref;
    const phone = clean(request.phone);
    try {
      const user = await db.collection("users").doc(clean(request.userId)).get();
      if (!user.exists) throw new ReportError("report_not_permitted");
      const result = await generateReport({ id: user.id, data: user.data()! }, clean(request.reportId), clean(request.month), "whatsapp");
      await dispatch({
        type: "document",
        to: phone,
        url: result.url,
        filename: result.fileName,
        caption: `\u{1F4CA} ${result.title}`,
        dedupeKey: `report:${event.params.requestId}`,
      });
      await ref.update({ status: "sent", path: result.path, completedAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (error) {
      logger.error("WhatsApp report request failed", { requestId: event.params.requestId, error: String(error) });
      await ref.update({ status: "failed", error: String(error).slice(0, 300), completedAt: admin.firestore.FieldValue.serverTimestamp() });
      await dispatch({
        type: "notice",
        to: phone,
        text: "Sorry - I couldn't prepare that report. Please try again later, or generate it on the Lepharo platform.",
        dedupeKey: `report-failed:${event.params.requestId}`,
      }).catch((notice) => logger.warn("Report failure notice not sent", { error: String(notice) }));
    }
  },
);
