"use strict";
/**
 * The session prep brief: pure shaping of what is already recorded about an SME
 * and an intervention, so sessionCopilotLogic.test.cjs runs without Firebase.
 * sessionCopilot.ts reads Firestore and checks access; this decides what to show.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.canSeeBrief = exports.businessSnapshot = exports.summariseHistory = void 0;
const clean = (value) => String(value ?? "").trim();
/** Earlier sessions only, newest first, plus the tallies and what was agreed last time. */
function summariseHistory(input, limit = 3) {
    const before = input.sessions
        .filter((session) => session.date && session.date < input.sessionStart)
        .sort((a, b) => b.date.localeCompare(a.date));
    const recorded = before.filter((session) => session.held !== null);
    const outcomes = Object.values(input.attendanceByAppointment || {}).map((record) => clean(record?.outcome));
    const lastHeld = recorded.find((session) => session.held);
    return {
        previous: recorded.slice(0, limit),
        heldCount: recorded.filter((session) => session.held).length,
        attendedCount: outcomes.filter((outcome) => outcome === "attended").length,
        noShowCount: outcomes.filter((outcome) => outcome === "no_show").length,
        plannedSessions: Math.max(1, Number(input.plannedSessions) || 1),
        openActions: (lastHeld?.actions || []).map(clean).filter(Boolean).slice(0, 6),
        lastFocus: clean(lastHeld?.nextFocus),
    };
}
exports.summariseHistory = summariseHistory;
/** The latest month with figures, and the change from three months before it. */
function businessSnapshot(rows) {
    const sorted = rows.filter((row) => /^\d{4}-\d{2}$/.test(row.month)).sort((a, b) => a.month.localeCompare(b.month));
    const latest = [...sorted].reverse().find((row) => row.revenue !== null || row.jobs !== null);
    if (!latest)
        return null;
    const [year, month] = latest.month.split("-").map(Number);
    const earlierKey = new Date(Date.UTC(year, month - 1 - 3, 1)).toISOString().slice(0, 7);
    const earlier = sorted.find((row) => row.month === earlierKey) || null;
    const change = (now, then) => now === null || then === null || then === undefined ? null : now - then;
    return {
        month: latest.month,
        revenue: latest.revenue,
        jobs: latest.jobs,
        revenueChangePercent: latest.revenue !== null && earlier?.revenue
            ? Math.round(((latest.revenue - earlier.revenue) / earlier.revenue) * 1000) / 10
            : null,
        jobsChange: change(latest.jobs, earlier?.jobs),
    };
}
exports.businessSnapshot = businessSnapshot;
/** Who may see an SME's brief: the session's own facilitator, their department, or managers. */
function canSeeBrief(viewer, appointment) {
    const role = viewer.role.toLowerCase().replace(/\s+/g, "_");
    if (["director", "operations", "projectadmin", "system_admin", "superadmin"].includes(role))
        return true;
    if (role !== "coordinator")
        return false;
    if (appointment.assigneeId && viewer.ids.includes(appointment.assigneeId))
        return true;
    if (appointment.assigneeEmail && viewer.email && appointment.assigneeEmail.toLowerCase() === viewer.email.toLowerCase())
        return true;
    return Boolean(viewer.departmentId && viewer.departmentId === appointment.departmentId);
}
exports.canSeeBrief = canSeeBrief;
//# sourceMappingURL=sessionCopilotLogic.js.map