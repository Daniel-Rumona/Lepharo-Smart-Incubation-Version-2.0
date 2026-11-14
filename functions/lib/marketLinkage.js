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
exports.inviteToMarketOpportunity = exports.matchMarketOpportunity = exports.requirementsOf = exports.getSupplierPassport = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const emailShared_1 = require("./emailShared");
const complianceExpiry_1 = require("./complianceExpiry");
const inAppNotifications_1 = require("./inAppNotifications");
const whatsappAlerts_1 = require("./whatsappAlerts");
const outcomeFollowUpLogic_1 = require("./outcomeFollowUpLogic");
const departmentRoles_1 = require("./departmentRoles");
const syntheticData_1 = require("./syntheticData");
const bidPipelineLogic_1 = require("./bidPipelineLogic");
const supplierReadinessLogic_1 = require("./supplierReadinessLogic");
// Market linkage, phase 1: the supplier readiness passport, matching SMEs to
// an opportunity, and inviting the matched SMEs.
//
// Everything is worked out here, from the same records the compliance
// reminders use, so the passport, the matches and the SME's own view agree.
// Opportunities (marketOpportunities) are staff-only; an SME sees only its own
// invitation (opportunityInterests), which carries a copy of what it needs.
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
// Mirrors staffRoles() in firestore.rules.
const STAFF_ROLES = new Set([
    "system_admin", "system admin", "superadmin", "admin", "director", "operations", "head of department", "hod",
    "headofdepartment", "projectadmin", "project admin", "project_admin", "center coordinator", "center_coordinator",
    "coordinator", "receptionist", "employee", "hr",
]);
async function requireUser(uid) {
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    const user = (await emailShared_1.db.collection("users").doc(uid).get()).data() || {};
    return { uid, user, isStaff: STAFF_ROLES.has(lower(user.role)) };
}
/** Opportunities are run by the Market Linkages department only, for now (mirrors firestore.rules). */
async function requireMarketLinkages(uid) {
    const caller = await requireUser(uid);
    if (!caller.isStaff || !(await (0, departmentRoles_1.isDepartmentInRole)(clean(caller.user.departmentId), "marketLinkages"))) {
        throw new https_1.HttpsError("permission-denied", "Only the Market Linkages department can do this.");
    }
    return caller;
}
const toDate = (value) => {
    if (!value)
        return null;
    if (typeof value.toDate === "function")
        return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};
/* --------------------------------------------------------------- passport */
const WITHDRAWN = new Set(["cancelled", "declined"]);
/** Everything the passport needs for one SME, read where the rest of the app reads it. */
async function loadPassportInput(participantId) {
    const records = await (0, complianceExpiry_1.participantComplianceRecords)(participantId);
    if (!records.application)
        return null;
    const participant = records.participant || {};
    const application = records.application.data || {};
    const [risk, assignments, history, gaps] = await Promise.all([
        emailShared_1.db.collection("smeRiskSnapshots").doc(participantId).get(),
        emailShared_1.db.collection("assignedInterventions").where("participantId", "==", participantId).get(),
        emailShared_1.db.collection("monthlyPerformance").doc(participantId).collection("history").orderBy("createdAt", "desc").limit(12).get(),
        emailShared_1.db.collection("gapAnalysis").where("participantId", "==", participantId).get(),
    ]);
    const rows = history.docs.map((doc) => doc.data());
    const revenues = rows.map((row) => Number(row.revenue)).filter((value) => Number.isFinite(value));
    const latestHeadcount = rows.find((row) => row.headPermanent != null || row.headTemporary != null);
    const gap = gaps.docs
        .map((doc) => doc.data())
        .sort((a, b) => (toDate(b.submittedAt)?.getTime() || 0) - (toDate(a.submittedAt)?.getTime() || 0))[0];
    // Gap analysis market-linkage questions (src/routes/gap/sections.ts marketLinkageQ).
    const market = Array.isArray(gap?.sections?.marketLinkage) ? gap.sections.marketLinkage : [];
    const answer = (index) => (0, supplierReadinessLogic_1.yesNo)(market[index]?.answer);
    const riskData = risk.exists ? risk.data() : null;
    // Same "finished" test as outcome follow-ups; withdrawn assignments don't count at all.
    const activeAssignments = assignments.docs.map((doc) => doc.data()).filter((row) => !WITHDRAWN.has(lower(row.assignmentStatus)));
    return {
        participantId,
        name: clean(participant.beneficiaryName || participant.companyName || application.beneficiaryName || application.businessName) || "SME",
        sector: clean(participant.sector || application.sector),
        province: clean(participant.province || application.province || application.region),
        town: clean(participant.town || participant.city || application.city),
        beeLevel: (0, supplierReadinessLogic_1.parseBeeLevel)(participant.beeLevel ?? application.beeLevel),
        beeNonCompliant: /non[- ]?compliant/i.test(clean(participant.beeLevel ?? application.beeLevel)),
        ownership: {
            black: (0, supplierReadinessLogic_1.parsePercent)(participant.blackOwnedPercent ?? application.blackOwnedPercent),
            women: (0, supplierReadinessLogic_1.parsePercent)(participant.femaleOwnedPercent ?? application.femaleOwnedPercent),
            youth: (0, supplierReadinessLogic_1.parsePercent)(participant.youthOwnedPercent ?? application.youthOwnedPercent),
        },
        registrations: {
            incomeTaxNumber: clean(participant.incomeTaxNumber),
            vatNumber: clean(participant.vatNumber),
            csdNumber: clean(participant.csdNumber),
            taxCompliancePin: clean(participant.taxCompliancePin),
        },
        compliance: (0, complianceExpiry_1.requirementStates)(records.documents, records.requirements).map((state) => ({
            key: state.key,
            title: state.title,
            status: state.status,
            expires: state.expires,
        })),
        risk: riskData && typeof riskData.score === "number" ? { score: riskData.score, level: clean(riskData.level) } : null,
        interventions: {
            completed: activeAssignments.filter((row) => (0, outcomeFollowUpLogic_1.isConfirmed)(row)).length,
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
const serialisePassport = (passport) => ({
    ...passport,
    compliance: {
        ...passport.compliance,
        items: passport.compliance.items.map((item) => ({ ...item, expires: item.expires ? item.expires.toISOString() : null })),
    },
    input: { ...passport.input, compliance: undefined },
});
exports.getSupplierPassport = (0, https_1.onCall)({ timeoutSeconds: 60 }, async (request) => {
    const caller = await requireUser(request.auth?.uid);
    const participantId = clean(request.data?.participantId);
    if (!participantId)
        throw new https_1.HttpsError("invalid-argument", "Which SME?");
    if (!caller.isStaff && clean(caller.user.participantId) !== participantId) {
        // email fallback until Phase 4 (docs/sme-identity-migration-plan.md): only for logins not linked yet.
        const participant = clean(caller.user.participantId)
            ? null
            : (await emailShared_1.db.collection("participants").doc(participantId).get()).data();
        const callerEmail = lower(request.auth?.token.email);
        if (!callerEmail || lower(participant?.email) !== callerEmail) {
            throw new https_1.HttpsError("permission-denied", "You can only see your own passport.");
        }
    }
    const input = await loadPassportInput(participantId);
    if (!input)
        throw new https_1.HttpsError("failed-precondition", "This SME has no accepted application yet.");
    const [market, track] = await Promise.all([loadBidHistory(participantId), loadContractRecord(participantId)]);
    return { ...serialisePassport((0, supplierReadinessLogic_1.buildPassport)(input)), bids: market, contracts: track };
});
/** The SME's record across every opportunity it was invited to. */
async function loadBidHistory(participantId) {
    const snap = await emailShared_1.db.collection("opportunityInterests").where("participantId", "==", participantId).get();
    return (0, bidPipelineLogic_1.bidHistory)(snap.docs.map((doc) => ({ status: doc.get("status"), lostReason: doc.get("lostReason") })));
}
const toMilestones = (rows) => (Array.isArray(rows) ? rows : []).map((row, index) => ({
    id: clean(row?.id) || String(index),
    title: clean(row?.title),
    dueDate: toDate(row?.dueDate),
    amount: Number(row?.amount) || 0,
    status: ["delivered", "paid"].includes(row?.status) ? row.status : "pending",
}));
/** Supply contracts won through market linkage: how many, their value and what has been paid. */
async function loadContractRecord(participantId) {
    const snap = await emailShared_1.db.collection("supplyContracts").where("participantId", "==", participantId).get();
    let value = 0;
    let paid = 0;
    let overdue = 0;
    snap.docs.forEach((doc) => {
        const data = doc.data();
        const milestones = toMilestones(data.milestones);
        const totals = (0, bidPipelineLogic_1.contractTotals)(Number(data.value) || 0, milestones);
        value += totals.value;
        paid += totals.paid;
        overdue += (0, bidPipelineLogic_1.overdueMilestones)(milestones).length;
    });
    return { count: snap.size, value, paid, overdueMilestones: overdue };
}
/* ---------------------------------------------------------------- matching */
const STAGE_KEYS = new Set(supplierReadinessLogic_1.STAGES.map((stage) => stage.key));
const list = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : []);
const percentOrUndefined = (value) => {
    const number = (0, supplierReadinessLogic_1.parsePercent)(value);
    return number === null ? undefined : number;
};
function requirementsOf(opportunity) {
    const r = opportunity?.requirements || {};
    const minStage = clean(r.minStage);
    return {
        sectors: list(r.sectors),
        provinces: list(r.provinces),
        documents: list(r.documents),
        maxBeeLevel: (0, supplierReadinessLogic_1.parseBeeLevel)(r.maxBeeLevel),
        ownership: { black: percentOrUndefined(r.ownership?.black), women: percentOrUndefined(r.ownership?.women), youth: percentOrUndefined(r.ownership?.youth) },
        requireCsd: r.requireCsd === true,
        minStage: STAGE_KEYS.has(minStage) ? minStage : null,
    };
}
exports.requirementsOf = requirementsOf;
/** Accepted SMEs, one per participant; only the opportunity's programme when it has one. */
async function acceptedParticipantIds(programId) {
    const snapshot = programId
        ? await emailShared_1.db.collection("applications").where("programId", "==", programId).get()
        : await emailShared_1.db.collection("applications").get();
    const ids = new Set();
    snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (lower(data.applicationStatus) === "accepted" && clean(data.participantId))
            ids.add(clean(data.participantId));
    });
    return [...ids];
}
exports.matchMarketOpportunity = (0, https_1.onCall)({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const caller = await requireMarketLinkages(request.auth?.uid);
    const opportunityId = clean(request.data?.opportunityId);
    const ref = emailShared_1.db.collection("marketOpportunities").doc(opportunityId);
    const snapshot = opportunityId ? await ref.get() : null;
    if (!snapshot?.exists)
        throw new https_1.HttpsError("not-found", "Opportunity not found.");
    const opportunity = snapshot.data();
    const requirements = requirementsOf(opportunity);
    const closingDate = toDate(opportunity.closingDate);
    const ids = await acceptedParticipantIds(clean(opportunity.programId));
    const matches = [];
    for (let offset = 0; offset < ids.length; offset += 10) {
        const batch = await Promise.all(ids.slice(offset, offset + 10).map(async (id) => {
            try {
                const input = await loadPassportInput(id);
                return input ? (0, supplierReadinessLogic_1.matchOpportunity)((0, supplierReadinessLogic_1.buildPassport)(input), requirements, closingDate) : null;
            }
            catch (error) {
                logger.warn("matchMarketOpportunity.passportFailed", { participantId: id, error: String(error) });
                return null;
            }
        }));
        matches.push(...batch.filter((item) => !!item));
    }
    const ranked = (0, supplierReadinessLogic_1.rankMatches)(matches);
    await ref.update({
        matches: ranked,
        matchSummary: { considered: ranked.length, eligible: ranked.filter((match) => match.eligible).length },
        matchedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        matchedBy: caller.uid,
    });
    return { matches: ranked };
});
/* ----------------------------------------------------------------- invites */
const formatDate = (date) => date ? new Date(date.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10) : "";
const escapeHtml = (value) => clean(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
exports.inviteToMarketOpportunity = (0, https_1.onCall)({ timeoutSeconds: 120 }, async (request) => {
    const caller = await requireMarketLinkages(request.auth?.uid);
    const opportunityId = clean(request.data?.opportunityId);
    const participantIds = list(request.data?.participantIds).slice(0, 100);
    if (!opportunityId || !participantIds.length)
        throw new https_1.HttpsError("invalid-argument", "Choose at least one SME.");
    const snapshot = await emailShared_1.db.collection("marketOpportunities").doc(opportunityId).get();
    if (!snapshot.exists)
        throw new https_1.HttpsError("not-found", "Opportunity not found.");
    const opportunity = snapshot.data();
    if (lower(opportunity.status) === "closed")
        throw new https_1.HttpsError("failed-precondition", "This opportunity is closed.");
    const matchById = new Map((opportunity.matches || []).map((match) => [match.participantId, match]));
    const closingDate = toDate(opportunity.closingDate);
    const closing = formatDate(closingDate);
    const title = clean(opportunity.title) || "A new opportunity";
    const buyer = clean(opportunity.buyer);
    const link = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/incubatee/opportunities`;
    const results = [];
    for (const participantId of participantIds) {
        const interestRef = emailShared_1.db.collection("opportunityInterests").doc(`${opportunityId}__${participantId}`);
        if ((await interestRef.get()).exists) {
            results.push({ participantId, status: "already-invited", whatsapp: false, email: false });
            continue;
        }
        const participant = (await emailShared_1.db.collection("participants").doc(participantId).get()).data() || {};
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
                closingDate: closingDate ? emailShared_1.admin.firestore.Timestamp.fromDate(closingDate) : null,
                value: clean(opportunity.value) || null,
                location: clean(opportunity.location) || null,
                documents: list(opportunity.requirements?.documents),
            },
            match: matchById.has(participantId)
                ? { eligible: !!matchById.get(participantId).eligible, gaps: matchById.get(participantId).gaps || [] }
                : null,
            invitedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            invitedBy: caller.uid,
            respondedAt: null,
        });
        const uid = await (0, inAppNotifications_1.uidForParticipant)(participantId, email);
        const headline = `Opportunity: ${title}`.slice(0, 120);
        const details = [buyer && `Buyer: ${buyer}`, closing && `Closes ${closing}`, "Open the Lepharo app to say if you're interested"]
            .filter(Boolean).join(" · ");
        if (uid) {
            await emailShared_1.db.collection("notifications").add({
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
        const quiet = (0, syntheticData_1.isSyntheticData)({ participantId }, participantId);
        if (!quiet && email.includes("@")) {
            try {
                await (0, emailShared_1.sendStatusChangeNotification)([email], headline, `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
            <h2 style="color:#1457a6">${escapeHtml(title)}</h2>
            <p>Hi ${escapeHtml(name)}, Lepharo has matched your business to this opportunity.</p>
            <p>${[buyer && `<strong>Buyer:</strong> ${escapeHtml(buyer)}`, closing && `<strong>Closes:</strong> ${escapeHtml(closing)}`].filter(Boolean).join("<br/>")}</p>
            <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Tell us if you're interested</a></p>
          </div>`, `${title}\n${details}\n${link}`);
                emailed = true;
            }
            catch (error) {
                logger.warn("inviteToMarketOpportunity.emailFailed", { participantId, error: String(error) });
            }
        }
        // WhatsApp only for SMEs who agreed to it (the alert sender checks consent and dedupes).
        const whatsapp = uid && !quiet ? await (0, whatsappAlerts_1.sendWhatsAppAlert)(uid, { name, headline, details }, `opportunity:${opportunityId}:${participantId}`) : false;
        results.push({ participantId, status: "invited", whatsapp, email: emailed });
    }
    await snapshot.ref.update({
        invitedCount: emailShared_1.admin.firestore.FieldValue.increment(results.filter((result) => result.status === "invited").length),
        updatedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    return { results };
});
//# sourceMappingURL=marketLinkage.js.map