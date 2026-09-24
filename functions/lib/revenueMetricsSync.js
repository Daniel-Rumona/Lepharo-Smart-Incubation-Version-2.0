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
exports.revenueMetricsSyncCron = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("./firebase");
// QuantNow has no Firestore persistence of its own - the Finance page reads it
// live, per SME company, keyed by email (see routes/operations/finance/index.tsx).
// The KPI engine can't do that fan-out on every Tracker page view (one HTTP call
// per company, against a Render-hosted API that cold-starts), so this cron mirrors
// each company's monthly revenue into participantMonthlyMetrics once a day - the
// same collection kpiCalculationService.ts already reads for the "metrics" source,
// so "Monthly Revenue" KPIs need no engine changes, only this data to exist.
const QUANTNOW_BASE_URL = "https://quantnow-sa1e.onrender.com";
const REVENUE_HISTORY_MONTHS = 12;
const CONCURRENCY = 5;
const BATCH_WRITE_SIZE = 450;
const clean = (value) => String(value ?? "").trim();
const normalizeEmail = (value) => clean(value).toLowerCase();
// Mirrors isExcludedScopedCompanyEmail in routes/operations/finance/index.tsx -
// keeps demo/internal QuantNow accounts out of real KPI data.
const isExcludedCompanyEmail = (value) => {
    const email = normalizeEmail(value);
    if (!email)
        return true;
    return (email.endsWith("@example.com") ||
        email.endsWith("@lepharo.co.za") ||
        email.endsWith("@quantilytix.co.za") ||
        email === "lepharo@gmail.com");
};
const isAcceptedApplication = (application) => clean(application.applicationStatus || application.decision?.status).toLowerCase() === "accepted";
async function getQuantNowToken() {
    const email = process.env.QX_FINANCE_EMAIL;
    const password = process.env.QX_FINANCE_PASSWORD;
    if (!email || !password) {
        throw new Error("Missing env: QX_FINANCE_EMAIL / QX_FINANCE_PASSWORD");
    }
    const res = await fetch(`${QUANTNOW_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
        throw new Error(data?.message || `QuantNow login failed (${res.status})`);
    }
    return data.token;
}
async function fetchAllCompanies(token) {
    const res = await fetch(`${QUANTNOW_BASE_URL}/admin/all-memberships`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data?.message || `QuantNow all-memberships failed (${res.status})`);
    }
    return Array.isArray(data?.companies) ? data.companies : [];
}
async function fetchCompanyMonthlyRevenue(email) {
    const url = new URL(`${QUANTNOW_BASE_URL}/api/stats/public/revenue-monthly`);
    url.searchParams.set("email", email);
    url.searchParams.set("months", String(REVENUE_HISTORY_MONTHS));
    const res = await fetch(url.toString());
    if (!res.ok)
        return [];
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.months) ? data.months : Array.isArray(data) ? data : [];
    return rows
        .map((row) => ({ month: clean(row.month), revenue: Number(row.revenue || 0) }))
        .filter((row) => Boolean(row.month));
}
// QuantNow's "month" value isn't documented as a fixed format - accept either a
// YYYY-MM(-DD) key or anything Date can parse, and skip the row rather than guess.
function parseMonthKey(raw) {
    const isoMatch = /^(\d{4})-(\d{2})/.exec(raw);
    if (isoMatch)
        return { year: Number(isoMatch[1]), month: Number(isoMatch[2]) };
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
    }
    return null;
}
async function runInBatches(items, size, worker) {
    for (let i = 0; i < items.length; i += size) {
        await Promise.allSettled(items.slice(i, i + size).map(worker));
    }
}
exports.revenueMetricsSyncCron = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "0 5 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    maxInstances: 1,
}, async () => {
    const heartbeatRef = firebase_1.db.collection("systemHeartbeats").doc("revenueMetricsSyncCron");
    let companies;
    try {
        const token = await getQuantNowToken();
        companies = await fetchAllCompanies(token);
    }
    catch (error) {
        const message = String(error?.message || error);
        logger.error("revenueMetricsSyncCron.loginOrListFailed", { error: message });
        await heartbeatRef.set({ lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: message }, { merge: true });
        return;
    }
    const [participantsSnap, applicationsSnap] = await Promise.all([
        firebase_1.db.collection("participants").get(),
        firebase_1.db.collection("applications").get(),
    ]);
    const participants = participantsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const acceptedApplications = applicationsSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(isAcceptedApplication);
    // First email match wins - same simplification the Finance page makes
    // (findMatchingParticipant treats an ambiguous multi-match as no match).
    const participantsByEmail = new Map();
    participants.forEach((participant) => {
        const email = normalizeEmail(participant.email);
        if (email && !participantsByEmail.has(email))
            participantsByEmail.set(email, participant);
    });
    let companiesMatched = 0;
    let companiesSkipped = 0;
    let fetchErrors = 0;
    const rowsToWrite = [];
    await runInBatches(companies, CONCURRENCY, async (company) => {
        const companyEmail = normalizeEmail(company?.email);
        if (!companyEmail || isExcludedCompanyEmail(companyEmail)) {
            companiesSkipped += 1;
            return;
        }
        const matchedParticipant = participantsByEmail.get(companyEmail) || null;
        const directApplications = acceptedApplications.filter((application) => normalizeEmail(application.email || application.applicantEmail) === companyEmail);
        const matchingApplications = directApplications.length > 0
            ? directApplications
            : matchedParticipant
                ? acceptedApplications.filter((application) => clean(application.participantId) === matchedParticipant.id)
                : [];
        if (!matchingApplications.length) {
            companiesSkipped += 1;
            return;
        }
        const programIds = Array.from(new Set(matchingApplications.map((application) => clean(application.programId)).filter(Boolean)));
        if (!programIds.length) {
            companiesSkipped += 1;
            return;
        }
        let monthlyRows;
        try {
            monthlyRows = await fetchCompanyMonthlyRevenue(companyEmail);
        }
        catch (error) {
            logger.warn("revenueMetricsSyncCron.companyFetchFailed", { companyEmail, error: String(error) });
            fetchErrors += 1;
            return;
        }
        if (!monthlyRows.length) {
            companiesSkipped += 1;
            return;
        }
        const participantId = matchedParticipant?.id || null;
        // Condition fields KPI "Conditions" can filter on - gender/ageGroup/stage/
        // applicationStatus/province/gapGroup live on the application, sector on the
        // participant (see SOURCE_CONFIGS.metrics in routes/kpis/index.tsx and the
        // matching ensureSuggestions collection choice).
        const sourceApplication = matchingApplications[0];
        const enrichment = {
            sector: clean(matchedParticipant?.sector) || null,
            gapGroup: clean(sourceApplication?.gapGroup) || null,
            gender: clean(sourceApplication?.gender) || null,
            ageGroup: clean(sourceApplication?.ageGroup) || null,
            stage: clean(sourceApplication?.stage) || null,
            applicationStatus: clean(sourceApplication?.applicationStatus) || null,
            province: clean(sourceApplication?.province) || null,
        };
        for (const programId of programIds) {
            for (const row of monthlyRows) {
                const parsedMonth = parseMonthKey(row.month);
                if (!parsedMonth)
                    continue;
                const sourceMonth = `${parsedMonth.year}-${String(parsedMonth.month).padStart(2, "0")}`;
                const docId = `revenue_${participantId || companyEmail}_${programId}_${sourceMonth}`;
                rowsToWrite.push({
                    docId,
                    data: {
                        participantId,
                        companyEmail,
                        programId,
                        monthlyRevenue: row.revenue,
                        sourceMonth,
                        createdAt: firebase_1.admin.firestore.Timestamp.fromDate(new Date(Date.UTC(parsedMonth.year, parsedMonth.month - 1, 1))),
                        source: "quantnow-revenue-sync",
                        ...enrichment,
                        updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
                    },
                });
            }
        }
        companiesMatched += 1;
    });
    for (let offset = 0; offset < rowsToWrite.length; offset += BATCH_WRITE_SIZE) {
        const batch = firebase_1.db.batch();
        rowsToWrite.slice(offset, offset + BATCH_WRITE_SIZE).forEach(({ docId, data }) => {
            batch.set(firebase_1.db.collection("participantMonthlyMetrics").doc(docId), data, { merge: true });
        });
        await batch.commit();
    }
    const summary = {
        companiesScanned: companies.length,
        companiesMatched,
        companiesSkipped,
        fetchErrors,
        rowsWritten: rowsToWrite.length,
    };
    logger.info("revenueMetricsSyncCron.complete", summary);
    await heartbeatRef.set({
        lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        lastStatus: fetchErrors > 0 && companiesMatched === 0 ? "failed" : "ok",
        lastError: null,
        ...summary,
    }, { merge: true });
});
//# sourceMappingURL=revenueMetricsSync.js.map