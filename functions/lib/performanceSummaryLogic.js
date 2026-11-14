"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarise = exports.currentPhase = exports.isRunning = exports.PHASE_LABEL = void 0;
const ipmReminderLogic_1 = require("./ipmReminderLogic");
exports.PHASE_LABEL = { compacting: "Compacting", midYear: "Mid-year reviews", yearEnd: "Year-end reviews" };
/** A cycle is running from the start of compacting until its year-end window closes. */
function isRunning(cycle, today) {
    const day = today.slice(0, 10);
    const lastDay = [cycle.endDate, cycle.windows.yearEnd.to].sort().pop();
    return cycle.status !== "closed" && day >= cycle.windows.compacting.from && day <= lastDay;
}
exports.isRunning = isRunning;
/** The window open today, or else the one that opened most recently. */
function currentPhase(cycle, today) {
    const day = today.slice(0, 10);
    const order = ["compacting", "midYear", "yearEnd"];
    const open = order.find((phase) => day >= cycle.windows[phase].from && day <= cycle.windows[phase].to);
    if (open)
        return { phase: open, open: true };
    const started = order.filter((phase) => day >= cycle.windows[phase].from);
    return { phase: started.length ? started[started.length - 1] : "compacting", open: false };
}
exports.currentPhase = currentPhase;
function summarise(cycle, today, staff, directorId) {
    const { phase, open } = currentPhase(cycle, today);
    const compacts = { agreed: 0, awaitingSignature: 0, notStarted: 0 };
    let noLineManager = 0;
    let overdue = 0;
    const queued = [];
    const reviewPhase = phase === "compacting" ? null : phase;
    const reviews = reviewPhase
        ? { phase: reviewPhase, notStarted: 0, inProgress: 0, awaitingCalibration: 0, awaitingValidation: 0, disputed: 0, validated: 0 }
        : null;
    for (const person of staff) {
        if (!person.lineManagerId)
            noLineManager += 1;
        const status = (0, ipmReminderLogic_1.compactStatus)(person.compact?.signoff || {});
        if (status === "agreed" || status === "hr-checked")
            compacts.agreed += 1;
        else if (status === "draft")
            compacts.notStarted += 1;
        else
            compacts.awaitingSignature += 1;
        if (reviews && reviewPhase) {
            const record = person.reviews[reviewPhase];
            const stage = (0, ipmReminderLogic_1.reviewStage)(record);
            if (!record)
                reviews.notStarted += 1;
            else if (stage === "validated")
                reviews.validated += 1;
            else if (stage === "validation")
                reviews.awaitingValidation += 1;
            else if (stage === "calibration")
                reviews.awaitingCalibration += 1;
            else if (stage === "disputed")
                reviews.disputed += 1;
            else
                reviews.inProgress += 1;
        }
        for (const action of (0, ipmReminderLogic_1.outstandingActions)(cycle, today, person)) {
            if (action.overdue)
                overdue += 1;
            if ((0, ipmReminderLogic_1.recipientsOf)(action, person.lineManagerId, { hr: [], ceo: [directorId] }).includes(directorId)) {
                queued.push({ action, recipient: directorId, cycleLabel: cycle.label });
            }
        }
    }
    const names = new Map(staff.map((person) => [person.uid, person.name]));
    const lines = (0, ipmReminderLogic_1.digestLines)(queued, (uid) => names.get(uid) || "a colleague").get(directorId) || [];
    return {
        cycle: cycle.label,
        phase,
        phaseOpen: open,
        phaseClosesOn: cycle.windows[phase].to,
        staff: staff.length,
        noLineManager,
        compacts,
        reviews,
        overdue,
        waitingOnYou: [...lines].sort((a, b) => Number(b.overdue) - Number(a.overdue)).map(({ text, overdue: late }) => ({ text, overdue: late })),
    };
}
exports.summarise = summarise;
//# sourceMappingURL=performanceSummaryLogic.js.map