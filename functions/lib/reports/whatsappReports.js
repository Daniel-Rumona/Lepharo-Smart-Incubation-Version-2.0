"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestReport = exports.reportOptions = exports.reportAccess = void 0;
const firebase_1 = require("../firebase");
const lib_1 = require("./lib");
const registry_1 = require("./registry");
const ok = (body) => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status, error) => ({ status, body: { ok: false, error } });
const reportAccess = (user) => !!user && (0, registry_1.reportsFor)(user).length > 0;
exports.reportAccess = reportAccess;
function reportOptions(user) {
    if (!user)
        return fail(403, "not_permitted");
    return ok({ reports: (0, registry_1.reportsFor)(user), months: (0, registry_1.recentMonths)() });
}
exports.reportOptions = reportOptions;
async function requestReport(userId, user, phoneNumber, payload) {
    const report = registry_1.REPORTS.find((item) => item.id === (0, lib_1.clean)(payload.reportId));
    if (!user || !report || !report.allowed(user))
        return fail(403, "report_not_permitted");
    const month = (0, lib_1.clean)(payload.month);
    if (!(0, registry_1.validMonth)(month))
        return fail(400, "invalid_month");
    // One request per report and month per person every two minutes, so a double tap builds it once.
    const window = Math.floor(Date.now() / (2 * 60 * 1000));
    const ref = firebase_1.db.collection("reportRequests").doc(`${userId}_${report.id}_${month}_${window}`);
    try {
        await ref.create({
            userId,
            phone: (0, lib_1.clean)(phoneNumber).replace(/[^0-9]/g, ""),
            reportId: report.id,
            month,
            channel: "whatsapp",
            status: "queued",
            createdAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (error) {
        if (error?.code !== 6 && !String(error?.message || "").includes("ALREADY_EXISTS"))
            throw error;
        return ok({ queued: true, duplicate: true, title: report.title, monthLabel: (0, lib_1.monthLabel)(month) });
    }
    return ok({ queued: true, title: report.title, monthLabel: (0, lib_1.monthLabel)(month) });
}
exports.requestReport = requestReport;
//# sourceMappingURL=whatsappReports.js.map