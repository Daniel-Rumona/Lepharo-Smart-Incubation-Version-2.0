import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "./firebase";

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

const clean = (value: unknown) => String(value ?? "").trim();
const normalizeEmail = (value: unknown) => clean(value).toLowerCase();

// Mirrors isExcludedScopedCompanyEmail in routes/operations/finance/index.tsx -
// keeps demo/internal QuantNow accounts out of real KPI data.
const isExcludedCompanyEmail = (value: unknown) => {
  const email = normalizeEmail(value);
  if (!email) return true;
  return (
    email.endsWith("@example.com") ||
    email.endsWith("@lepharo.co.za") ||
    email.endsWith("@quantilytix.co.za") ||
    email === "lepharo@gmail.com"
  );
};

const isAcceptedApplication = (application: any) =>
  clean(application.applicationStatus || application.decision?.status).toLowerCase() === "accepted";

async function getQuantNowToken(): Promise<string> {
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
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) {
    throw new Error(data?.message || `QuantNow login failed (${res.status})`);
  }
  return data.token as string;
}

async function fetchAllCompanies(token: string): Promise<any[]> {
  const res = await fetch(`${QUANTNOW_BASE_URL}/admin/all-memberships`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `QuantNow all-memberships failed (${res.status})`);
  }
  return Array.isArray(data?.companies) ? data.companies : [];
}

type MonthlyRevenueRow = { month: string; revenue: number };

async function fetchCompanyMonthlyRevenue(email: string): Promise<MonthlyRevenueRow[]> {
  const url = new URL(`${QUANTNOW_BASE_URL}/api/stats/public/revenue-monthly`);
  url.searchParams.set("email", email);
  url.searchParams.set("months", String(REVENUE_HISTORY_MONTHS));

  const res = await fetch(url.toString());
  if (!res.ok) return [];

  const data: any = await res.json().catch(() => ({}));
  const rows = Array.isArray(data?.months) ? data.months : Array.isArray(data) ? data : [];

  return rows
    .map((row: any) => ({ month: clean(row.month), revenue: Number(row.revenue || 0) }))
    .filter((row: MonthlyRevenueRow) => Boolean(row.month));
}

// QuantNow's "month" value isn't documented as a fixed format - accept either a
// YYYY-MM(-DD) key or anything Date can parse, and skip the row rather than guess.
function parseMonthKey(raw: string): { year: number; month: number } | null {
  const isoMatch = /^(\d{4})-(\d{2})/.exec(raw);
  if (isoMatch) return { year: Number(isoMatch[1]), month: Number(isoMatch[2]) };

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
  }
  return null;
}

async function runInBatches<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(worker));
  }
}

type RevenueRowWrite = {
  docId: string;
  data: FirebaseFirestore.DocumentData;
};

export const revenueMetricsSyncCron = onSchedule(
  {
    region: "us-central1",
    schedule: "0 5 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    const heartbeatRef = db.collection("systemHeartbeats").doc("revenueMetricsSyncCron");

    let companies: any[];
    try {
      const token = await getQuantNowToken();
      companies = await fetchAllCompanies(token);
    } catch (error: any) {
      const message = String(error?.message || error);
      logger.error("revenueMetricsSyncCron.loginOrListFailed", { error: message });
      await heartbeatRef.set(
        { lastRunAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: message },
        { merge: true }
      );
      return;
    }

    const [participantsSnap, applicationsSnap] = await Promise.all([
      db.collection("participants").get(),
      db.collection("applications").get(),
    ]);

    const participants = participantsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
    const acceptedApplications = applicationsSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter(isAcceptedApplication);

    // First email match wins - same simplification the Finance page makes
    // (findMatchingParticipant treats an ambiguous multi-match as no match).
    const participantsByEmail = new Map<string, any>();
    participants.forEach((participant) => {
      const email = normalizeEmail(participant.email);
      if (email && !participantsByEmail.has(email)) participantsByEmail.set(email, participant);
    });

    let companiesMatched = 0;
    let companiesSkipped = 0;
    let fetchErrors = 0;
    const rowsToWrite: RevenueRowWrite[] = [];

    await runInBatches(companies, CONCURRENCY, async (company) => {
      const companyEmail = normalizeEmail(company?.email);
      if (!companyEmail || isExcludedCompanyEmail(companyEmail)) {
        companiesSkipped += 1;
        return;
      }

      const matchedParticipant = participantsByEmail.get(companyEmail) || null;

      const directApplications = acceptedApplications.filter(
        (application) => normalizeEmail(application.email || application.applicantEmail) === companyEmail
      );
      const matchingApplications = directApplications.length > 0
        ? directApplications
        : matchedParticipant
          ? acceptedApplications.filter((application) => clean(application.participantId) === matchedParticipant.id)
          : [];

      if (!matchingApplications.length) {
        companiesSkipped += 1;
        return;
      }

      const programIds = Array.from(
        new Set(matchingApplications.map((application) => clean(application.programId)).filter(Boolean))
      );
      if (!programIds.length) {
        companiesSkipped += 1;
        return;
      }

      let monthlyRows: MonthlyRevenueRow[];
      try {
        monthlyRows = await fetchCompanyMonthlyRevenue(companyEmail);
      } catch (error) {
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
          if (!parsedMonth) continue;

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
              createdAt: admin.firestore.Timestamp.fromDate(
                new Date(Date.UTC(parsedMonth.year, parsedMonth.month - 1, 1))
              ),
              source: "quantnow-revenue-sync",
              ...enrichment,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          });
        }
      }

      companiesMatched += 1;
    });

    for (let offset = 0; offset < rowsToWrite.length; offset += BATCH_WRITE_SIZE) {
      const batch = db.batch();
      rowsToWrite.slice(offset, offset + BATCH_WRITE_SIZE).forEach(({ docId, data }) => {
        batch.set(db.collection("participantMonthlyMetrics").doc(docId), data, { merge: true });
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
    await heartbeatRef.set(
      {
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastStatus: fetchErrors > 0 && companiesMatched === 0 ? "failed" : "ok",
        lastError: null,
        ...summary,
      },
      { merge: true }
    );
  }
);
