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
exports.generateReport = exports.ReportError = exports.recentMonths = exports.validMonth = exports.reportsFor = exports.REPORTS = void 0;
const crypto = __importStar(require("crypto"));
const firebase_1 = require("../firebase");
const executiveReport_1 = require("./executiveReport");
const nationalReport_1 = require("./nationalReport");
const lib_1 = require("./lib");
const roleKey = (role) => (0, lib_1.clean)(role).toLowerCase().replace(/[\s_-]/g, "");
/** A centre coordinator (projectadmin) with a centre: their reports cover that centre. */
const centreCoordinator = (user) => roleKey(user.role) === "projectadmin" && !!(0, lib_1.clean)(user.assignedBranch);
exports.REPORTS = [
    {
        id: "executive",
        title: "Executive Report",
        description: "Monthly executive & operations report for your centre",
        allowed: centreCoordinator,
        build: async (requester, month) => (0, executiveReport_1.renderExecutiveReport)(await (0, executiveReport_1.loadExecutiveData)(requester, month)),
    },
    {
        id: "national",
        title: "National Report",
        description: "Interventions progress for your centre, for the national meeting",
        allowed: centreCoordinator,
        build: async (requester, month) => (0, nationalReport_1.renderNationalReport)(await (0, nationalReport_1.loadNationalData)(requester, month)),
    },
];
/** The reports this person may request, as shown in a picker. */
const reportsFor = (user) => exports.REPORTS.filter((report) => report.allowed(user)).map(({ id, title, description }) => ({ id, title, description }));
exports.reportsFor = reportsFor;
/** A YYYY-MM month that has started (reports are about the past or the current month). */
const validMonth = (month) => {
    const text = (0, lib_1.clean)(month);
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) && text <= (0, lib_1.sastDateKey)(new Date()).slice(0, 7);
};
exports.validMonth = validMonth;
/** This month and the previous one, the choices offered on WhatsApp. */
const recentMonths = () => {
    const current = (0, lib_1.sastDateKey)(new Date()).slice(0, 7);
    const [year, month] = current.split("-").map(Number);
    const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
    return [current, previous].map((value) => ({ month: value, label: (0, lib_1.monthLabel)(value) }));
};
exports.recentMonths = recentMonths;
class ReportError extends Error {
}
exports.ReportError = ReportError;
/** Builds a report, stores it with a download link and logs it. */
async function generateReport(requester, reportId, month, channel) {
    const report = exports.REPORTS.find((item) => item.id === reportId);
    if (!report || !report.allowed(requester.data))
        throw new ReportError("report_not_permitted");
    if (!(0, exports.validMonth)(month))
        throw new ReportError("invalid_month");
    const built = await report.build(requester, month);
    const bucket = firebase_1.admin.storage().bucket();
    const path = `reports/${(0, lib_1.clean)(requester.data.assignedBranch) || requester.id}/${report.id}/${month}/${Date.now()}_${built.fileName}`;
    const token = crypto.randomUUID();
    await bucket.file(path).save(built.buffer, {
        resumable: false,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        // uploadedBy names the requester on the system admin's Storage page (storageBrowser.ts).
        metadata: { metadata: { firebaseStorageDownloadTokens: token, uploadedBy: requester.id } },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    await firebase_1.db.collection("generatedReports").add({
        reportId: report.id,
        month,
        branchId: (0, lib_1.clean)(requester.data.assignedBranch) || null,
        requestedBy: requester.id,
        requestedByName: (0, lib_1.clean)(requester.data.name || requester.data.email),
        channel,
        path,
        fileName: built.fileName,
        size: built.buffer.length,
        createdAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    return { url, fileName: built.fileName, title: built.title, path };
}
exports.generateReport = generateReport;
//# sourceMappingURL=registry.js.map