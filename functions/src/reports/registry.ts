import * as crypto from "crypto";
import { admin, db } from "../firebase";
import { loadExecutiveData, renderExecutiveReport, Requester } from "./executiveReport";
import { loadNationalData, renderNationalReport } from "./nationalReport";
import { clean, monthLabel, sastDateKey } from "./lib";

/**
 * Every report the platform can generate, who may request each one, and how it is built. The web app (the
 * generateReport callable) and WhatsApp (reportRequests, see reportFunctions.ts) both go through here, so a
 * report is the same wherever it is asked for. To offer reports to another role - Operations, by department,
 * for example - add definitions with their own `allowed` and builders; delivery needs no change.
 */

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  /** Whether this users document may request the report. */
  allowed: (user: FirebaseFirestore.DocumentData) => boolean;
  build: (requester: Requester, month: string) => Promise<{ buffer: Buffer; fileName: string; title: string }>;
};

const roleKey = (role: unknown) => clean(role).toLowerCase().replace(/[\s_-]/g, "");

/** A centre coordinator (projectadmin) with a centre: their reports cover that centre. */
const centreCoordinator = (user: FirebaseFirestore.DocumentData) =>
  roleKey(user.role) === "projectadmin" && !!clean(user.assignedBranch);

export const REPORTS: ReportDefinition[] = [
  {
    id: "executive",
    title: "Executive Report",
    description: "Monthly executive & operations report for your centre",
    allowed: centreCoordinator,
    build: async (requester, month) => renderExecutiveReport(await loadExecutiveData(requester, month)),
  },
  {
    id: "national",
    title: "National Report",
    description: "Interventions progress for your centre, for the national meeting",
    allowed: centreCoordinator,
    build: async (requester, month) => renderNationalReport(await loadNationalData(requester, month)),
  },
];

/** The reports this person may request, as shown in a picker. */
export const reportsFor = (user: FirebaseFirestore.DocumentData) =>
  REPORTS.filter((report) => report.allowed(user)).map(({ id, title, description }) => ({ id, title, description }));

/** A YYYY-MM month that has started (reports are about the past or the current month). */
export const validMonth = (month: unknown) => {
  const text = clean(month);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) && text <= sastDateKey(new Date()).slice(0, 7);
};

/** This month and the previous one, the choices offered on WhatsApp. */
export const recentMonths = () => {
  const current = sastDateKey(new Date()).slice(0, 7);
  const [year, month] = current.split("-").map(Number);
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  return [current, previous].map((value) => ({ month: value, label: monthLabel(value) }));
};

export class ReportError extends Error {}

/** Builds a report, stores it with a download link and logs it. */
export async function generateReport(requester: Requester, reportId: string, month: string, channel: "web" | "whatsapp") {
  const report = REPORTS.find((item) => item.id === reportId);
  if (!report || !report.allowed(requester.data)) throw new ReportError("report_not_permitted");
  if (!validMonth(month)) throw new ReportError("invalid_month");

  const built = await report.build(requester, month);
  const bucket = admin.storage().bucket();
  const path = `reports/${clean(requester.data.assignedBranch) || requester.id}/${report.id}/${month}/${Date.now()}_${built.fileName}`;
  const token = crypto.randomUUID();
  await bucket.file(path).save(built.buffer, {
    resumable: false,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // uploadedBy names the requester on the system admin's Storage page (storageBrowser.ts).
    metadata: { metadata: { firebaseStorageDownloadTokens: token, uploadedBy: requester.id } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  await db.collection("generatedReports").add({
    reportId: report.id,
    month,
    branchId: clean(requester.data.assignedBranch) || null,
    requestedBy: requester.id,
    requestedByName: clean(requester.data.name || requester.data.email),
    channel,
    path,
    fileName: built.fileName,
    size: built.buffer.length,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { url, fileName: built.fileName, title: built.title, path };
}
