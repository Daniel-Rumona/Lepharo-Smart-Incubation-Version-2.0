import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { APP_BASE_URL, admin, db, sendStatusChangeNotification } from "./emailShared";
import { participantComplianceRecords, requirementStates } from "./complianceExpiry";
import { uidForParticipant } from "./inAppNotifications";
import { sendWhatsAppAlert } from "./whatsappAlerts";
import { isConfirmed } from "./outcomeFollowUpLogic";
import { isDepartmentInRole } from "./departmentRoles";
import { isSyntheticData } from "./syntheticData";
import { bidHistory, contractTotals, overdueMilestones, type Milestone } from "./bidPipelineLogic";
import {
  STAGES,
  buildPassport,
  matchOpportunity,
  parseBeeLevel,
  parsePercent,
  rankMatches,
  yesNo,
  type OpportunityRequirements,
  type Passport,
  type PassportInput,
  type StageKey,
} from "./supplierReadinessLogic";

// Market linkage, phase 1: the supplier readiness passport, matching SMEs to
// an opportunity, and inviting the matched SMEs.
//
// Everything is worked out here, from the same records the compliance
// reminders use, so the passport, the matches and the SME's own view agree.
// Opportunities (marketOpportunities) are staff-only; an SME sees only its own
// invitation (opportunityInterests), which carries a copy of what it needs.

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();

// Mirrors staffRoles() in firestore.rules.
const STAFF_ROLES = new Set([
  "system_admin", "system admin", "superadmin", "admin", "director", "operations", "head of department", "hod",
  "headofdepartment", "projectadmin", "project admin", "project_admin", "center coordinator", "center_coordinator",
  "coordinator", "receptionist", "employee", "hr", "projectmanager", "consultant", "auxiliary",
]);

async function requireUser(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const user = (await db.collection("users").doc(uid).get()).data() || {};
  return { uid, user, isStaff: STAFF_ROLES.has(lower(user.role)) };
}

/** Opportunities are run by the Market Linkages department only, for now (mirrors firestore.rules). */
async function requireMarketLinkages(uid: string | undefined) {
  const caller = await requireUser(uid);
  if (!caller.isStaff || !(await isDepartmentInRole(clean(caller.user.departmentId), "marketLinkages"))) {
    throw new HttpsError("permission-denied", "Only the Market Linkages department can do this.");
  }
  return caller;
}

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/* --------------------------------------------------------------- passport */

const WITHDRAWN = new Set(["cancelled", "declined"]);

/** Everything the passport needs for one SME, read where the rest of the app reads it. */
async function loadPassportInput(participantId: string): Promise<PassportInput | null> {
  const records = await participantComplianceRecords(participantId);
  if (!records.application) return null;
  const participant = records.participant || {};
  const application = records.application.data || {};

  const [risk, assignments, history, gaps] = await Promise.all([
    db.collection("smeRiskSnapshots").doc(participantId).get(),
    db.collection("assignedInterventions").where("participantId", "==", participantId).get(),
    db.collection("monthlyPerformance").doc(participantId).collection("history").orderBy("createdAt", "desc").limit(12).get(),
    db.collection("gapAnalysis").where("participantId", "==", participantId).get(),
  ]);

  const rows = history.docs.map((doc) => doc.data() as any);
  const revenues = rows.map((row) => Number(row.revenue)).filter((value) => Number.isFinite(value));
  const latestHeadcount = rows.find((row) => row.headPermanent != null || row.headTemporary != null);

  const gap = gaps.docs
    .map((doc) => doc.data() as any)
    .sort((a, b) => (toDate(b.submittedAt)?.getTime() || 0) - (toDate(a.submittedAt)?.getTime() || 0))[0];
  // Gap analysis market-linkage questions (src/routes/gap/sections.ts marketLinkageQ).
  const market = Array.isArray(gap?.sections?.marketLinkage) ? gap.sections.marketLinkage : [];
  const answer = (index: number) => yesNo(market[index]?.answer);

  const riskData = risk.exists ? risk.data() as any : null;
  // Same "finished" test as outcome follow-ups; withdrawn assignments don't count at all.
  const activeAssignments = assignments.docs.map((doc) => doc.data()).filter((row) => !WITHDRAWN.has(lower(row.assignmentStatus)));
  return {
    participantId,
    name: clean(participant.beneficiaryName || participant.companyName || application.beneficiaryName || application.businessName) || "SME",
    sector: clean(participant.sector || application.sector),
    province: clean(participant.province || application.province || application.region),
    town: clean(participant.town || participant.city || application.city),
    beeLevel: parseBeeLevel(participant.beeLevel ?? application.beeLevel),
    beeNonCompliant: /non[- ]?compliant/i.test(clean(participant.beeLevel ?? application.beeLevel)),
    ownership: {
      black: parsePercent(participant.blackOwnedPercent ?? application.blackOwnedPercent),
      women: parsePercent(participant.femaleOwnedPercent ?? application.femaleOwnedPercent),
      youth: parsePercent(participant.youthOwnedPercent ?? application.youthOwnedPercent),
    },
    registrations: {
      incomeTaxNumber: clean(participant.incomeTaxNumber),
      vatNumber: clean(participant.vatNumber),
      csdNumber: clean(participant.csdNumber),
      taxCompliancePin: clean(participant.taxCompliancePin),
    },
    compliance: requirementStates(records.documents, records.requirements).map((state) => ({
      key: state.key,
      title: state.title,
      status: state.status,
      expires: state.expires,
    })),
    risk: riskData && typeof riskData.score === "number" ? { score: riskData.score, level: clean(riskData.level) } : null,
    interventions: {
      completed: activeAssignments.filter((row) => isConfirmed(row)).length,
      total: activeAssignments.length,
    },
    performance: {
      annualRevenue: revenues.length ? revenues.reduce((sum, value) => sum + value, 0) : null,
      employees: latestHeadcount ? (Number(latestHeadcount.headPermanent) || 0) + (Number(latestHeadcount.headTemporary) || 0) : null,
      monthsReported: revenues.length,
    },
    capability: { csdRegistered: answer(0), clientList: answer(2), tradeReferences: answer(4), capacity: answer(5) },
  };
}

/** Dates become ISO strings so the passport crosses the callable boundary intact. */
const serialisePassport = (passport: Passport) => ({
  ...passport,
  compliance: {
    ...passport.compliance,
    items: passport.compliance.items.map((item) => ({ ...item, expires: item.expires ? item.expires.toISOString() : null })),
  },
  input: { ...passport.input, compliance: undefined },
});

export const getSupplierPassport = onCall({ timeoutSeconds: 60 }, async (request) => {
  const caller = await requireUser(request.auth?.uid);
  const participantId = clean(request.data?.participantId);
  if (!participantId) throw new HttpsError("invalid-argument", "Which SME?");
  if (!caller.isStaff && clean(caller.user.participantId) !== participantId) {
    // email fallback until Phase 4 (docs/sme-identity-migration-plan.md): only for logins not linked yet.
    const participant = clean(caller.user.participantId)
      ? null
      : (await db.collection("participants").doc(participantId).get()).data();
    const callerEmail = lower(request.auth?.token.email);
    if (!callerEmail || lower(participant?.email) !== callerEmail) {
      throw new HttpsError("permission-denied", "You can only see your own passport.");
    }
  }
  const input = await loadPassportInput(participantId);
  if (!input) throw new HttpsError("failed-precondition", "This SME has no accepted application yet.");
  const [market, track] = await Promise.all([loadBidHistory(participantId), loadContractRecord(participantId)]);
  return { ...serialisePassport(buildPassport(input)), bids: market, contracts: track };
});

/** The SME's record across every opportunity it was invited to. */
async function loadBidHistory(participantId: string) {
  const snap = await db.collection("opportunityInterests").where("participantId", "==", participantId).get();
  return bidHistory(snap.docs.map((doc) => ({ status: doc.get("status"), lostReason: doc.get("lostReason") })));
}

const toMilestones = (rows: unknown): Milestone[] =>
  (Array.isArray(rows) ? rows : []).map((row: any, index) => ({
    id: clean(row?.id) || String(index),
    title: clean(row?.title),
    dueDate: toDate(row?.dueDate),
    amount: Number(row?.amount) || 0,
    status: ["delivered", "paid"].includes(row?.status) ? row.status : "pending",
  }));

/** Supply contracts won through market linkage: how many, their value and what has been paid. */
async function loadContractRecord(participantId: string) {
  const snap = await db.collection("supplyContracts").where("participantId", "==", participantId).get();
  let value = 0;
  let paid = 0;
  let overdue = 0;
  snap.docs.forEach((doc) => {
    const data = doc.data();
    const milestones = toMilestones(data.milestones);
    const totals = contractTotals(Number(data.value) || 0, milestones);
    value += totals.value;
    paid += totals.paid;
    overdue += overdueMilestones(milestones).length;
  });
  return { count: snap.size, value, paid, overdueMilestones: overdue };
}

/* ---------------------------------------------------------------- matching */

const STAGE_KEYS = new Set(STAGES.map((stage) => stage.key));
const list = (value: unknown) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : []);
const percentOrUndefined = (value: unknown) => {
  const number = parsePercent(value);
  return number === null ? undefined : number;
};

export function requirementsOf(opportunity: any): OpportunityRequirements {
  const r = opportunity?.requirements || {};
  const minStage = clean(r.minStage) as StageKey;
  return {
    sectors: list(r.sectors),
    provinces: list(r.provinces),
    documents: list(r.documents),
    maxBeeLevel: parseBeeLevel(r.maxBeeLevel),
    ownership: { black: percentOrUndefined(r.ownership?.black), women: percentOrUndefined(r.ownership?.women), youth: percentOrUndefined(r.ownership?.youth) },
    requireCsd: r.requireCsd === true,
    minStage: STAGE_KEYS.has(minStage) ? minStage : null,
  };
}

/** Accepted SMEs, one per participant; only the opportunity's programme when it has one. */
async function acceptedParticipantIds(programId: string): Promise<string[]> {
  const snapshot = programId
    ? await db.collection("applications").where("programId", "==", programId).get()
    : await db.collection("applications").get();
  const ids = new Set<string>();
  snapshot.docs.forEach((doc) => {
    const data = doc.data() as any;
    if (lower(data.applicationStatus) === "accepted" && clean(data.participantId)) ids.add(clean(data.participantId));
  });
  return [...ids];
}

export const matchMarketOpportunity = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const caller = await requireMarketLinkages(request.auth?.uid);
  const opportunityId = clean(request.data?.opportunityId);
  const ref = db.collection("marketOpportunities").doc(opportunityId);
  const snapshot = opportunityId ? await ref.get() : null;
  if (!snapshot?.exists) throw new HttpsError("not-found", "Opportunity not found.");
  const opportunity = snapshot.data() as any;

  const requirements = requirementsOf(opportunity);
  const closingDate = toDate(opportunity.closingDate);
  const ids = await acceptedParticipantIds(clean(opportunity.programId));

  const matches = [];
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = await Promise.all(ids.slice(offset, offset + 10).map(async (id) => {
      try {
        const input = await loadPassportInput(id);
        return input ? matchOpportunity(buildPassport(input), requirements, closingDate) : null;
      } catch (error) {
        logger.warn("matchMarketOpportunity.passportFailed", { participantId: id, error: String(error) });
        return null;
      }
    }));
    matches.push(...batch.filter((item): item is NonNullable<typeof item> => !!item));
  }

  const ranked = rankMatches(matches);
  await ref.update({
    matches: ranked,
    matchSummary: { considered: ranked.length, eligible: ranked.filter((match) => match.eligible).length },
    matchedAt: admin.firestore.FieldValue.serverTimestamp(),
    matchedBy: caller.uid,
  });
  return { matches: ranked };
});

/* ----------------------------------------------------------------- invites */

const formatDate = (date: Date | null) =>
  date ? new Date(date.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10) : "";

const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export const inviteToMarketOpportunity = onCall({ timeoutSeconds: 120 }, async (request) => {
  const caller = await requireMarketLinkages(request.auth?.uid);
  const opportunityId = clean(request.data?.opportunityId);
  const participantIds = list(request.data?.participantIds).slice(0, 100);
  if (!opportunityId || !participantIds.length) throw new HttpsError("invalid-argument", "Choose at least one SME.");

  const snapshot = await db.collection("marketOpportunities").doc(opportunityId).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Opportunity not found.");
  const opportunity = snapshot.data() as any;
  if (lower(opportunity.status) === "closed") throw new HttpsError("failed-precondition", "This opportunity is closed.");
  const matchById = new Map<string, any>((opportunity.matches || []).map((match: any) => [match.participantId, match]));

  const closingDate = toDate(opportunity.closingDate);
  const closing = formatDate(closingDate);
  const title = clean(opportunity.title) || "A new opportunity";
  const buyer = clean(opportunity.buyer);
  const link = `${APP_BASE_URL.replace(/\/$/, "")}/incubatee/opportunities`;

  const results: Array<{ participantId: string; status: "invited" | "already-invited"; whatsapp: boolean; email: boolean }> = [];
  for (const participantId of participantIds) {
    const interestRef = db.collection("opportunityInterests").doc(`${opportunityId}__${participantId}`);
    if ((await interestRef.get()).exists) {
      results.push({ participantId, status: "already-invited", whatsapp: false, email: false });
      continue;
    }
    const participant = (await db.collection("participants").doc(participantId).get()).data() || {};
    const email = lower(participant.email);
    const name = clean(participant.beneficiaryName || participant.companyName) || matchById.get(participantId)?.name || "SME";

    // The SME sees this copy, never the opportunity itself (which holds every SME's match).
    await interestRef.set({
      opportunityId,
      participantId,
      participantName: name,
      participantEmail: email || null,
      status: "invited",
      opportunity: {
        title,
        buyer: buyer || null,
        summary: clean(opportunity.summary || opportunity.description).slice(0, 1200) || null,
        closingDate: closingDate ? admin.firestore.Timestamp.fromDate(closingDate) : null,
        value: clean(opportunity.value) || null,
        location: clean(opportunity.location) || null,
        documents: list(opportunity.requirements?.documents),
      },
      match: matchById.has(participantId)
        ? { eligible: !!matchById.get(participantId).eligible, gaps: matchById.get(participantId).gaps || [] }
        : null,
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: caller.uid,
      respondedAt: null,
    });

    const uid = await uidForParticipant(participantId, email);
    const headline = `Opportunity: ${title}`.slice(0, 120);
    const details = [buyer && `Buyer: ${buyer}`, closing && `Closes ${closing}`, "Open the Lepharo app to say if you're interested"]
      .filter(Boolean).join(" · ");

    if (uid) {
      await db.collection("notifications").add({
        type: "market_opportunity_invite",
        message: `${headline}${closing ? ` (closes ${closing})` : ""}. Let us know if you're interested.`,
        recipientIds: [uid],
        participantId,
        opportunityId,
        link: "/incubatee/opportunities",
        createdAt: new Date(),
        readBy: {},
      });
    }

    let emailed = false;
    // Seeded SMEs get the in-app record but never a real email or WhatsApp.
    const quiet = isSyntheticData({ participantId }, participantId);
    if (!quiet && email.includes("@")) {
      try {
        await sendStatusChangeNotification(
          [email],
          headline,
          `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
            <h2 style="color:#1457a6">${escapeHtml(title)}</h2>
            <p>Hi ${escapeHtml(name)}, Lepharo has matched your business to this opportunity.</p>
            <p>${[buyer && `<strong>Buyer:</strong> ${escapeHtml(buyer)}`, closing && `<strong>Closes:</strong> ${escapeHtml(closing)}`].filter(Boolean).join("<br/>")}</p>
            <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Tell us if you're interested</a></p>
          </div>`,
          `${title}\n${details}\n${link}`
        );
        emailed = true;
      } catch (error) {
        logger.warn("inviteToMarketOpportunity.emailFailed", { participantId, error: String(error) });
      }
    }

    // WhatsApp only for SMEs who agreed to it (the alert sender checks consent and dedupes).
    const whatsapp = uid && !quiet ? await sendWhatsAppAlert(uid, { name, headline, details }, `opportunity:${opportunityId}:${participantId}`) : false;

    results.push({ participantId, status: "invited", whatsapp, email: emailed });
  }

  await snapshot.ref.update({
    invitedCount: admin.firestore.FieldValue.increment(results.filter((result) => result.status === "invited").length),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { results };
});
