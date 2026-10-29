"use strict";
/**
 * Pure rules for the web assistant's write actions (no Firebase imports, so the
 * tests in agentActionsLogic.test.cjs run without emulators).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validDate = exports.cleanIdList = exports.shortText = exports.MAX_RECIPIENTS = exports.KIND_ROLE_GROUPS = void 0;
/** Who may run each action. Mirrors ROLE_ALLOWED_PROPOSALS in ai-backend/agent_proposals.py, but this list is the one enforced. */
exports.KIND_ROLE_GROUPS = {
    send_nudge: ["system_admin", "director", "hod", "coordinator"],
    send_compliance_reminder: ["system_admin", "hod", "coordinator"],
    create_task: ["system_admin", "director", "hod", "coordinator"],
    schedule_appointment: ["hod", "coordinator", "employee"],
    assign_intervention: ["hod", "coordinator"],
};
exports.MAX_RECIPIENTS = 50;
const clean = (value) => String(value ?? "").trim();
const shortText = (value, max) => clean(value).replace(/\s+/g, " ").slice(0, max);
exports.shortText = shortText;
/** Distinct document ids, at most MAX_RECIPIENTS; anything path-like is dropped. */
function cleanIdList(value) {
    const list = Array.isArray(value) ? value : value == null ? [] : [value];
    const ids = list
        .map((item) => clean(item))
        .filter((item) => item && item.length <= 200 && !item.includes("/"));
    return Array.from(new Set(ids)).slice(0, exports.MAX_RECIPIENTS);
}
exports.cleanIdList = cleanIdList;
function validDate(value) {
    const text = clean(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
        return null;
    const parsed = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text;
}
exports.validDate = validDate;
//# sourceMappingURL=agentActionsLogic.js.map