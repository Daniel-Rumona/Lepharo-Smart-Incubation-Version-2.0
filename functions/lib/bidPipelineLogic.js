"use strict";
// Pure rules for the bid pipeline and supply contracts (market linkage, phase
// 2). No Firestore here so it can be unit tested (bidPipelineLogic.test.cjs).
// The app mirrors the stage and reason lists in src/services/marketLinkage.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.bidHistory = exports.overdueMilestones = exports.contractTotals = exports.stageMessage = exports.lostReason = exports.LOST_REASONS = exports.isClosedStage = exports.canMove = exports.isBidStage = exports.BID_STAGES = void 0;
const clean = (value) => String(value ?? "").trim();
/* ------------------------------------------------------------------ stages */
exports.BID_STAGES = ["invited", "interested", "declined", "shortlisted", "submitted", "awarded", "lost", "withdrawn"];
/** Where Market Linkages may move a bid from each stage. The SME only ever answers invited ↔ interested/declined. */
const NEXT = {
    invited: ["interested", "declined", "withdrawn"],
    interested: ["shortlisted", "submitted", "lost", "withdrawn"],
    declined: ["interested"],
    shortlisted: ["submitted", "lost", "withdrawn"],
    submitted: ["awarded", "lost", "withdrawn"],
    awarded: [],
    lost: [],
    withdrawn: [],
};
const isBidStage = (value) => exports.BID_STAGES.includes(clean(value));
exports.isBidStage = isBidStage;
const canMove = (from, to) => NEXT[from].includes(to);
exports.canMove = canMove;
const isClosedStage = (stage) => NEXT[stage].length === 0;
exports.isClosedStage = isClosedStage;
/* ------------------------------------------------------------ lost reasons */
/** Why a bid was lost, and the support that would most likely fix it next time. */
exports.LOST_REASONS = [
    { key: "price", label: "Price too high", support: "Tender pricing and costing support" },
    { key: "compliance", label: "Compliance documents missing or expired", support: "Bring compliance documents up to date before the next bid" },
    { key: "bbbee", label: "B-BBEE level or ownership", support: "B-BBEE rating support" },
    { key: "capacity", label: "Not enough capacity or equipment", support: "Capacity building: equipment funding or a joint venture" },
    { key: "experience", label: "Not enough track record or references", support: "Build a track record with smaller contracts and trade references" },
    { key: "quality", label: "Quality or technical standard", support: "Quality management (QMS) support" },
    { key: "late", label: "Late or incomplete submission", support: "Bid preparation support: checklists and earlier submission" },
    { key: "other", label: "Other", support: "Discuss the buyer's feedback with the Market Linkages team" },
];
const lostReason = (key) => exports.LOST_REASONS.find((reason) => reason.key === clean(key)) || null;
exports.lostReason = lostReason;
/* ---------------------------------------------------------- notifications */
/** What the SME is told when a bid moves; null when the change needs no message (their own answer, or staff housekeeping). */
function stageMessage(stage, context) {
    const title = clean(context.title) || "the opportunity";
    const buyer = clean(context.buyer);
    switch (stage) {
        case "shortlisted":
            return { headline: `Shortlisted: ${title}`, details: "Lepharo has shortlisted your business. We'll help you prepare the bid.", whatsapp: true };
        case "submitted":
            return { headline: `Bid submitted: ${title}`, details: `Your bid has been submitted${buyer ? ` to ${buyer}` : ""}. We'll let you know the outcome.`, whatsapp: false };
        case "awarded":
            return { headline: `You won: ${title}`, details: `Congratulations, ${buyer || "the buyer"} awarded your business the contract. Your contract and milestones are in the app.`, whatsapp: true };
        case "lost": {
            const reason = (0, exports.lostReason)(context.lostReason);
            const parts = [
                reason ? `Reason: ${reason.label}.` : "",
                clean(context.lostNote),
                reason ? `Next time: ${reason.support}.` : "",
            ].filter(Boolean);
            return { headline: `Not successful: ${title}`, details: parts.join(" ") || "The bid was not successful this time.", whatsapp: true };
        }
        default:
            return null;
    }
}
exports.stageMessage = stageMessage;
/** Value, delivered and paid totals for a contract's milestones. */
function contractTotals(value, milestones) {
    const sum = (status) => milestones.filter((m) => status.includes(m.status)).reduce((total, m) => total + (Number(m.amount) || 0), 0);
    const scheduled = milestones.reduce((total, m) => total + (Number(m.amount) || 0), 0);
    return {
        value,
        scheduled,
        /** Value not yet split into milestones; a warning, not an error. */
        unscheduled: Math.max(0, value - scheduled),
        delivered: sum(["delivered", "paid"]),
        paid: sum(["paid"]),
    };
}
exports.contractTotals = contractTotals;
/** A contract is overdue when a milestone is past its due date and not yet delivered. */
const overdueMilestones = (milestones, now = new Date()) => milestones.filter((m) => m.status === "pending" && m.dueDate && m.dueDate.getTime() < now.getTime());
exports.overdueMilestones = overdueMilestones;
/** An SME's record across every opportunity it was invited to. */
function bidHistory(stages) {
    const count = (list) => stages.filter((s) => list.includes(clean(s.status))).length;
    const won = count(["awarded"]);
    const lost = count(["lost"]);
    const tally = new Map();
    stages.filter((s) => clean(s.status) === "lost").forEach((s) => {
        const key = (0, exports.lostReason)(s.lostReason)?.key || "other";
        tally.set(key, (tally.get(key) || 0) + 1);
    });
    return {
        invited: stages.length,
        interested: count(["interested", "shortlisted", "submitted", "awarded", "lost"]),
        submitted: count(["submitted", "awarded", "lost"]),
        won,
        lost,
        winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
        lostReasons: [...tally.entries()]
            .map(([key, n]) => ({ ...(0, exports.lostReason)(key), count: n }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
}
exports.bidHistory = bidHistory;
//# sourceMappingURL=bidPipelineLogic.js.map