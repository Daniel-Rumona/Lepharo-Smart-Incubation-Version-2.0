import { admin, db } from "../firebase";
import { clean, monthLabel } from "./lib";
import { recentMonths, REPORTS, reportsFor, validMonth } from "./registry";

/**
 * Reports on WhatsApp, for the gateway: what this person may request, and queueing a request. The
 * build and the file arrive later (onReportRequested in reportFunctions.ts).
 */

type GatewayResult = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): GatewayResult => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status: number, error: string): GatewayResult => ({ status, body: { ok: false, error } });

export const reportAccess = (user: FirebaseFirestore.DocumentData | undefined) => !!user && reportsFor(user).length > 0;

export function reportOptions(user: FirebaseFirestore.DocumentData | undefined): GatewayResult {
  if (!user) return fail(403, "not_permitted");
  return ok({ reports: reportsFor(user), months: recentMonths() });
}

export async function requestReport(userId: string, user: FirebaseFirestore.DocumentData | undefined, phoneNumber: string, payload: any) {
  const report = REPORTS.find((item) => item.id === clean(payload.reportId));
  if (!user || !report || !report.allowed(user)) return fail(403, "report_not_permitted");
  const month = clean(payload.month);
  if (!validMonth(month)) return fail(400, "invalid_month");
  // One request per report and month per person every two minutes, so a double tap builds it once.
  const window = Math.floor(Date.now() / (2 * 60 * 1000));
  const ref = db.collection("reportRequests").doc(`${userId}_${report.id}_${month}_${window}`);
  try {
    await ref.create({
      userId,
      phone: clean(phoneNumber).replace(/[^0-9]/g, ""),
      reportId: report.id,
      month,
      channel: "whatsapp",
      status: "queued",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    if (error?.code !== 6 && !String(error?.message || "").includes("ALREADY_EXISTS")) throw error;
    return ok({ queued: true, duplicate: true, title: report.title, monthLabel: monthLabel(month) });
  }
  return ok({ queued: true, title: report.title, monthLabel: monthLabel(month) });
}
