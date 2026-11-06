import * as logger from "firebase-functions/logger";
import { scheduledJob } from "./cronHeartbeat";
import { APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";
import { notifyInApp } from "./inAppNotifications";
import { departmentHasRole, loadDepartmentRoles } from "./departmentRoles";
import { isActiveProfile, normalizeStaffRole } from "./lineManagerLogic";
import { suppressRecordNotifications } from "./syntheticData";
import {
  cycleNeedsReminders,
  digestLines,
  outstandingActions,
  recipientsOf,
  weekKey,
  type DigestLine,
  type IpmCycle,
  type IpmReview,
  type OutstandingAction,
  type PhaseKey,
} from "./ipmReminderLogic";

// Chases the IPM process (compacts, check-ins, reviews, calibration and
// validation) for every cycle HR has switched reminders on for. Each person
// gets at most one digest a week of everything waiting on them; a review
// that needs booking within the week goes out the day it comes up.

const clean = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

/** Test and control logins: the performance page leaves them out, so do reminders. */
const isControlEmail = (email: unknown) => clean(email).toLowerCase().endsWith("@quantilytix.co.za");

/** Today's date in South Africa, where the schedule runs. */
function todayInJohannesburg(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(now);
}

function performanceLink(role: string) {
  const base = APP_BASE_URL.replace(/\/$/, "");
  if (role === "director") return `${base}/director/hr/performance`;
  if (role === "operations" || role === "hr") return `${base}/operations/hr/performance`;
  return `${base}/performance`;
}

function digestEmail(name: string, lines: DigestLine[], link: string) {
  const ordered = [...lines].sort((a, b) => Number(b.overdue) - Number(a.overdue));
  const subject = `Performance management: ${lines.length} item${lines.length === 1 ? "" : "s"} waiting on you`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
    <h2 style="color:#1457a6">Performance management</h2>
    <p>Hi ${escapeHtml(name) || "there"}, these are waiting on you:</p>
    <ul>${ordered.map((line) => `<li>${line.overdue ? '<strong style="color:#b42318">Overdue:</strong> ' : ""}${escapeHtml(line.text)}</li>`).join("")}</ul>
    <p><a href="${escapeHtml(link)}">Open Performance</a></p>
  </div>`;
  const text = [
    "Performance management",
    "",
    `Hi ${name || "there"}, these are waiting on you:`,
    ...ordered.map((line) => `- ${line.overdue ? "OVERDUE: " : ""}${line.text}`),
    "",
    `Open Performance: ${link}`,
  ].join("\n");
  return { subject, html, text };
}

type Person = { id: string; name: string; email: string; role: string; data: FirebaseFirestore.DocumentData };

export async function runIpmReminders(today: string) {
  const cycles = (await db.collection("performanceCycles").get()).docs
    .map((doc) => ({ ...(doc.data() as IpmCycle), id: doc.id }))
    .filter((cycle) => cycleNeedsReminders(cycle, today));
  if (!cycles.length) return { cycles: 0, sent: 0 };

  const [usersSnap, departmentRoles, checkInSnap] = await Promise.all([
    db.collection("users").get(),
    loadDepartmentRoles(),
    db.collection("performanceCheckIns").select("employeeAuthUid", "date").get(),
  ]);
  const people = new Map<string, Person>();
  usersSnap.docs.forEach((doc) => {
    const data = doc.data();
    people.set(doc.id, {
      id: doc.id,
      name: clean(data.name || data.fullName) || clean(data.email).split("@")[0],
      email: clean(data.email).toLowerCase(),
      role: normalizeStaffRole(data.role),
      data,
    });
  });
  const reachable = (person?: Person) =>
    !!person && !!person.role && isActiveProfile({ id: person.id, ...person.data }) && !suppressRecordNotifications(person.data, person.id);
  const hr = [...people.values()]
    .filter((p) => reachable(p) && (p.role === "hr" || departmentHasRole(clean(p.data.departmentId), "hr", departmentRoles.roles, departmentRoles.departments)))
    .map((p) => p.id);
  const ceo = [...people.values()].filter((p) => reachable(p) && p.role === "director").map((p) => p.id);

  // The CEO's own performance is agreed with the board, outside this process.
  const employees = [...people.values()].filter((p) => p.role && p.role !== "director" && isActiveProfile({ id: p.id, ...p.data }) && !isControlEmail(p.email));
  const checkInDates = new Map<string, string[]>();
  checkInSnap.docs.forEach((doc) => {
    const uid = clean(doc.get("employeeAuthUid"));
    checkInDates.set(uid, [...(checkInDates.get(uid) || []), clean(doc.get("date"))]);
  });

  const queued: { action: OutstandingAction; recipient: string; cycleLabel: string; cycleId: string }[] = [];
  let suppressed = 0;
  for (const cycle of cycles) {
    const [compactSnap, reviewSnap] = await Promise.all([
      db.collection("employeePerformanceCompacts").where("cycleId", "==", cycle.id).get(),
      db.collection("performanceReviews").where("cycleId", "==", cycle.id).get(),
    ]);
    const compacts = new Map(compactSnap.docs.map((doc) => [clean(doc.get("employeeAuthUid") || doc.get("employeeId")), doc.data()]));
    const reviews = new Map<string, Partial<Record<PhaseKey, IpmReview>>>();
    reviewSnap.docs.forEach((doc) => {
      const uid = clean(doc.get("employeeAuthUid"));
      reviews.set(uid, { ...(reviews.get(uid) || {}), [doc.get("phase")]: doc.data() as IpmReview });
    });

    for (const employee of employees) {
      const uid = clean(employee.data.uid || employee.data.authUid || employee.id);
      const lineManagerId = clean(employee.data.lineManagerId) || null;
      const actions = outstandingActions(cycle, today, {
        uid,
        lineManagerId,
        compact: compacts.get(uid) || null,
        checkInDates: checkInDates.get(uid) || [],
        reviews: reviews.get(uid) || {},
      });
      // Seeded demo staff never chase anyone.
      if (suppressRecordNotifications(employee.data, employee.id)) {
        suppressed += actions.length;
        continue;
      }
      for (const action of actions) {
        for (const recipient of recipientsOf(action, lineManagerId, { hr, ceo })) {
          if (reachable(people.get(recipient))) queued.push({ action, recipient, cycleLabel: cycle.label, cycleId: cycle.id });
        }
      }
    }
  }

  const lines = digestLines(queued, (uid) => people.get(uid)?.name || "a colleague");
  const week = weekKey(today);
  let sent = 0;
  for (const [recipient, recipientLines] of lines) {
    const person = people.get(recipient);
    if (!person) continue;
    const weekly = db.collection("ipmReminderLog").doc(`${recipient}_${week}`);
    // A review to book goes out the day it comes up, even mid-week; once per review.
    const bookings = queued
      .filter((q) => q.recipient === recipient && q.action.kind === "book-review")
      .map((q) => db.collection("ipmReminderLog").doc(`book_${q.cycleId}_${q.action.phase}_${q.action.employeeUid}`));
    const [weeklySnap, ...bookingSnaps] = await Promise.all([weekly.get(), ...bookings.map((ref) => ref.get())]);
    const newBookings = bookings.filter((_, i) => !bookingSnaps[i].exists);
    if (weeklySnap.exists && !newBookings.length) continue;

    const link = performanceLink(person.role);
    const { subject, html, text } = digestEmail(person.name, recipientLines, link);
    try {
      if (person.email.includes("@")) await sendStatusChangeNotification([person.email], subject, html, text);
    } catch (error) {
      logger.error("ipmReminderCron.emailFailed", { recipient, error: String(error) });
    }
    await notifyInApp({
      type: "ipm_reminder",
      message: recipientLines.length === 1
        ? `Performance: ${recipientLines[0].text}.`
        : `Performance: ${recipientLines.length} items are waiting on you.`,
      recipientIds: [recipient],
      link: link.replace(APP_BASE_URL.replace(/\/$/, ""), ""),
    });
    const sentAt = new Date();
    await Promise.all([
      weekly.set({ recipient, week, items: recipientLines.map((l) => l.text), sentAt }),
      ...newBookings.map((ref) => ref.set({ recipient, sentAt })),
    ]);
    sent += 1;
  }

  return { cycles: cycles.length, actions: queued.length, recipients: lines.size, sent, suppressed };
}

export const ipmReminderCron = scheduledJob("ipmReminderCron",
  {
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const summary = await runIpmReminders(todayInJohannesburg());
    logger.info("ipmReminderCron.complete", summary);
    return summary;
  }
);
