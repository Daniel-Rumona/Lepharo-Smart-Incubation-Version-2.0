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
exports.onReportRequested = exports.generateReportCallable = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_1 = require("../firebase");
const lib_1 = require("./lib");
const registry_1 = require("./registry");
/**
 * Where reports are asked for. The web app calls generateReport and downloads the file it returns. On
 * WhatsApp the gateway queues a reportRequests document (building a deck can take longer than a chat reply
 * may wait); onReportRequested builds it and has the router send the file into the chat, which WhatsApp
 * allows because the person messaged in the last 24 hours.
 */
const REPORT_RUNTIME = { region: "us-central1", timeoutSeconds: 300, memory: "1GiB" };
exports.generateReportCallable = (0, https_1.onCall)(REPORT_RUNTIME, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to generate reports.");
    const user = await firebase_1.db.collection("users").doc(request.auth.uid).get();
    if (!user.exists)
        throw new https_1.HttpsError("permission-denied", "Your profile could not be found.");
    try {
        const result = await (0, registry_1.generateReport)({ id: user.id, data: user.data() }, (0, lib_1.clean)(request.data?.reportId), (0, lib_1.clean)(request.data?.month), "web");
        return { url: result.url, fileName: result.fileName, title: result.title };
    }
    catch (error) {
        if (error instanceof registry_1.ReportError) {
            throw new https_1.HttpsError(error.message === "invalid_month" ? "invalid-argument" : "permission-denied", error.message === "invalid_month" ? "Choose a month that has started." : "You can't generate this report.");
        }
        if (String(error).includes("no_assigned_centre"))
            throw new https_1.HttpsError("failed-precondition", "Your profile has no assigned centre.");
        logger.error("Report generation failed", { reportId: request.data?.reportId, error: String(error) });
        throw new https_1.HttpsError("internal", "The report could not be generated. Please try again.");
    }
});
/** Sends a WhatsApp message through the router's dispatch (it owns the WhatsApp credentials). */
async function dispatch(body) {
    const url = (0, lib_1.clean)(process.env.WHATSAPP_DISPATCH_URL);
    const secret = (0, lib_1.clean)(process.env.WHATSAPP_DISPATCH_SECRET);
    if (!url || !secret)
        throw new Error("WhatsApp dispatch is not configured.");
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-whatsapp-dispatch-secret": secret },
        body: JSON.stringify({ engine: "LPH", ...body }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
        throw new Error(`WhatsApp dispatch rejected (${response.status}).`);
}
exports.onReportRequested = (0, firestore_1.onDocumentCreated)({ ...REPORT_RUNTIME, document: "reportRequests/{requestId}" }, async (event) => {
    const request = event.data?.data();
    if (!event.data || !request)
        return;
    const ref = event.data.ref;
    const phone = (0, lib_1.clean)(request.phone);
    try {
        const user = await firebase_1.db.collection("users").doc((0, lib_1.clean)(request.userId)).get();
        if (!user.exists)
            throw new registry_1.ReportError("report_not_permitted");
        const result = await (0, registry_1.generateReport)({ id: user.id, data: user.data() }, (0, lib_1.clean)(request.reportId), (0, lib_1.clean)(request.month), "whatsapp");
        await dispatch({
            type: "document",
            to: phone,
            url: result.url,
            filename: result.fileName,
            caption: `\u{1F4CA} ${result.title}`,
            dedupeKey: `report:${event.params.requestId}`,
        });
        await ref.update({ status: "sent", path: result.path, completedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
    }
    catch (error) {
        logger.error("WhatsApp report request failed", { requestId: event.params.requestId, error: String(error) });
        await ref.update({ status: "failed", error: String(error).slice(0, 300), completedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
        await dispatch({
            type: "notice",
            to: phone,
            text: "Sorry - I couldn't prepare that report. Please try again later, or generate it on the Lepharo platform.",
            dedupeKey: `report-failed:${event.params.requestId}`,
        }).catch((notice) => logger.warn("Report failure notice not sent", { error: String(notice) }));
    }
});
//# sourceMappingURL=reportFunctions.js.map