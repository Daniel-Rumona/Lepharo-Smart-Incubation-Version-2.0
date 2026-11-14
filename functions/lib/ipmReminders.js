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
exports.ipmReminderCron = exports.runIpmReminders = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const cronHeartbeat_1 = require("./cronHeartbeat");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const departmentRoles_1 = require("./departmentRoles");
const lineManagerLogic_1 = require("./lineManagerLogic");
const syntheticData_1 = require("./syntheticData");
const ipmReminderLogic_1 = require("./ipmReminderLogic");
// Chases the IPM process (compacts, check-ins, reviews, calibration and
// validation) for every cycle HR has switched reminders on for. Each person
// gets at most one digest a week of everything waiting on them; a review
// that needs booking within the week goes out the day it comes up.
const clean = (value) => String(value ?? "").trim();
const escapeHtml = (value) => clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
/** Test and control logins: the performance page leaves them out, so do reminders. */
const isControlEmail = (email) => clean(email).toLowerCase().endsWith("@quantilytix.co.za");
/** Today's date in South Africa, where the schedule runs. */
function todayInJohannesburg(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(now);
}
function performanceLink(role) {
    const base = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
    if (role === "director")
        return `${base}/director/hr/performance`;
    if (role === "operations" || role === "hr")
        return `${base}/operations/hr/performance`;
    return `${base}/performance`;
}
function digestEmail(name, lines, link) {
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
async function runIpmReminders(today) {
    const cycles = (await emailShared_1.db.collection("performanceCycles").get()).docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .filter((cycle) => (0, ipmReminderLogic_1.cycleNeedsReminders)(cycle, today));
    if (!cycles.length)
        return { cycles: 0, sent: 0 };
    const [usersSnap, departmentRoles, checkInSnap] = await Promise.all([
        emailShared_1.db.collection("users").get(),
        (0, departmentRoles_1.loadDepartmentRoles)(),
        emailShared_1.db.collection("performanceCheckIns").select("employeeAuthUid", "date").get(),
    ]);
    const people = new Map();
    usersSnap.docs.forEach((doc) => {
        const data = doc.data();
        people.set(doc.id, {
            id: doc.id,
            name: clean(data.name || data.fullName) || clean(data.email).split("@")[0],
            email: clean(data.email).toLowerCase(),
            role: (0, lineManagerLogic_1.normalizeStaffRole)(data.role),
            data,
        });
    });
    const reachable = (person) => !!person && !!person.role && (0, lineManagerLogic_1.isActiveProfile)({ id: person.id, ...person.data }) && !(0, syntheticData_1.suppressRecordNotifications)(person.data, person.id);
    const hr = [...people.values()]
        .filter((p) => reachable(p) && (p.role === "hr" || (0, departmentRoles_1.departmentHasRole)(clean(p.data.departmentId), "hr", departmentRoles.roles, departmentRoles.departments)))
        .map((p) => p.id);
    const ceo = [...people.values()].filter((p) => reachable(p) && p.role === "director").map((p) => p.id);
    // The CEO's own performance is agreed with the board, outside this process.
    const employees = [...people.values()].filter((p) => p.role && p.role !== "director" && (0, lineManagerLogic_1.isActiveProfile)({ id: p.id, ...p.data }) && !isControlEmail(p.email));
    const checkInDates = new Map();
    checkInSnap.docs.forEach((doc) => {
        const uid = clean(doc.get("employeeAuthUid"));
        checkInDates.set(uid, [...(checkInDates.get(uid) || []), clean(doc.get("date"))]);
    });
    const queued = [];
    let suppressed = 0;
    for (const cycle of cycles) {
        const [compactSnap, reviewSnap] = await Promise.all([
            emailShared_1.db.collection("employeePerformanceCompacts").where("cycleId", "==", cycle.id).get(),
            emailShared_1.db.collection("performanceReviews").where("cycleId", "==", cycle.id).get(),
        ]);
        const compacts = new Map(compactSnap.docs.map((doc) => [clean(doc.get("employeeAuthUid") || doc.get("employeeId")), doc.data()]));
        const reviews = new Map();
        reviewSnap.docs.forEach((doc) => {
            const uid = clean(doc.get("employeeAuthUid"));
            reviews.set(uid, { ...(reviews.get(uid) || {}), [doc.get("phase")]: doc.data() });
        });
        for (const employee of employees) {
            const uid = clean(employee.data.uid || employee.data.authUid || employee.id);
            const lineManagerId = clean(employee.data.lineManagerId) || null;
            const actions = (0, ipmReminderLogic_1.outstandingActions)(cycle, today, {
                uid,
                lineManagerId,
                compact: compacts.get(uid) || null,
                checkInDates: checkInDates.get(uid) || [],
                reviews: reviews.get(uid) || {},
            });
            // Seeded demo staff never chase anyone.
            if ((0, syntheticData_1.suppressRecordNotifications)(employee.data, employee.id)) {
                suppressed += actions.length;
                continue;
            }
            for (const action of actions) {
                for (const recipient of (0, ipmReminderLogic_1.recipientsOf)(action, lineManagerId, { hr, ceo })) {
                    if (reachable(people.get(recipient)))
                        queued.push({ action, recipient, cycleLabel: cycle.label, cycleId: cycle.id });
                }
            }
        }
    }
    const lines = (0, ipmReminderLogic_1.digestLines)(queued, (uid) => people.get(uid)?.name || "a colleague");
    const week = (0, ipmReminderLogic_1.weekKey)(today);
    let sent = 0;
    for (const [recipient, recipientLines] of lines) {
        const person = people.get(recipient);
        if (!person)
            continue;
        const weekly = emailShared_1.db.collection("ipmReminderLog").doc(`${recipient}_${week}`);
        // A review to book goes out the day it comes up, even mid-week; once per review.
        const bookings = queued
            .filter((q) => q.recipient === recipient && q.action.kind === "book-review")
            .map((q) => emailShared_1.db.collection("ipmReminderLog").doc(`book_${q.cycleId}_${q.action.phase}_${q.action.employeeUid}`));
        const [weeklySnap, ...bookingSnaps] = await Promise.all([weekly.get(), ...bookings.map((ref) => ref.get())]);
        const newBookings = bookings.filter((_, i) => !bookingSnaps[i].exists);
        if (weeklySnap.exists && !newBookings.length)
            continue;
        const link = performanceLink(person.role);
        const { subject, html, text } = digestEmail(person.name, recipientLines, link);
        try {
            if (person.email.includes("@"))
                await (0, emailShared_1.sendStatusChangeNotification)([person.email], subject, html, text);
        }
        catch (error) {
            logger.error("ipmReminderCron.emailFailed", { recipient, error: String(error) });
        }
        await (0, inAppNotifications_1.notifyInApp)({
            type: "ipm_reminder",
            message: recipientLines.length === 1
                ? `Performance: ${recipientLines[0].text}.`
                : `Performance: ${recipientLines.length} items are waiting on you.`,
            recipientIds: [recipient],
            link: link.replace(emailShared_1.APP_BASE_URL.replace(/\/$/, ""), ""),
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
exports.runIpmReminders = runIpmReminders;
exports.ipmReminderCron = (0, cronHeartbeat_1.scheduledJob)("ipmReminderCron", {
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const summary = await runIpmReminders(todayInJohannesburg());
    logger.info("ipmReminderCron.complete", summary);
    return summary;
});
//# sourceMappingURL=ipmReminders.js.map