"use strict";
// Pure rules for proposal pipeline notifications. No Firestore here so it can
// be unit tested (proposalNotificationLogic.test.cjs). Statuses mirror
// src/types/proposal.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.deadlineReminder = exports.PRE_SUBMISSION_STATUSES = exports.proposalEvents = exports.proposalLabel = exports.statusChannels = exports.teamMembers = exports.ownsAsGroup = exports.ownerTarget = void 0;
const clean = (value) => String(value ?? "").trim();
/** Who owns the proposal, as something the trigger can turn into people. */
function ownerTarget(data) {
    const owner = data?.owner || {};
    const id = clean(owner.id);
    if (!id)
        return { kind: "none" };
    if (owner.type === "Department")
        return { kind: "department", departmentId: id };
    if (owner.type === "Centre")
        return { kind: "centre", branchId: id };
    return { kind: "person", uid: id };
}
exports.ownerTarget = ownerTarget;
/** Owned by a department or centre, whose people the caller looks up. */
const ownsAsGroup = (data) => ["department", "centre"].includes(ownerTarget(data).kind);
exports.ownsAsGroup = ownsAsGroup;
/** The people named on a proposal by uid: an individual owner, contributors and whoever created it. */
function teamMembers(data) {
    const members = new Map();
    const add = (uid, role) => {
        const id = clean(uid);
        if (id && !members.has(id))
            members.set(id, { uid: id, role });
    };
    const owner = ownerTarget(data);
    if (owner.kind === "person")
        add(owner.uid, "owner");
    (Array.isArray(data?.contributors) ? data.contributors : []).forEach((person) => add(person?.id, "contributor"));
    add(data?.createdBy?.id, "creator");
    return [...members.values()];
}
exports.teamMembers = teamMembers;
/** Which channels a move into each status uses. Moves inside preparation stay in-app only. */
const STATUS_CHANNELS = {
    Draft: ["inApp"],
    "In preparation": ["inApp"],
    Submitted: ["inApp", "email"],
    "Under review": ["inApp", "email"],
    Accepted: ["inApp", "email", "whatsapp"],
    "SLA signed": ["inApp", "email"],
    "Awaiting order number": ["inApp", "email"],
    "Implementation planning": ["inApp", "email"],
    "Ready for activation": ["inApp", "email"],
    Active: ["inApp", "email", "whatsapp"],
    Rejected: ["inApp", "email", "whatsapp"],
    Archived: ["inApp"],
};
const statusChannels = (status) => STATUS_CHANNELS[clean(status)] || ["inApp"];
exports.statusChannels = statusChannels;
const proposalLabel = (data) => {
    const number = clean(data?.proposalNumber);
    const title = clean(data?.title) || "Untitled proposal";
    return number ? `${number} "${title}"` : `"${title}"`;
};
exports.proposalLabel = proposalLabel;
/**
 * What changed on a proposal write, and who hears about it. `before` is null
 * on create. `note` is the progress note from the status change, when known.
 */
function proposalEvents(proposalId, before, after, note) {
    if (!after)
        return [];
    const label = (0, exports.proposalLabel)(after);
    const client = clean(after.clientName);
    const actor = clean(after.updatedBy?.id || after.createdBy?.id);
    const actorName = clean(after.updatedBy?.name || after.createdBy?.name) || "A colleague";
    const others = (uids) => uids.filter((uid) => uid && uid !== actor);
    const team = teamMembers(after);
    const events = [];
    if (!before) {
        const owner = team.filter((member) => member.role === "owner").map((member) => member.uid);
        const contributors = team.filter((member) => member.role === "contributor").map((member) => member.uid);
        const forClient = client ? ` for ${client}` : "";
        if (others(owner).length || (0, exports.ownsAsGroup)(after)) {
            events.push({
                kind: "created",
                recipientIds: others(owner),
                includeOwnerGroup: (0, exports.ownsAsGroup)(after),
                channels: ["inApp", "email"],
                headline: `You own proposal ${label}`,
                details: `${actorName} created ${label}${forClient} and made you the owner.`,
                dedupeKey: `proposal:${proposalId}:created:owner`,
            });
        }
        if (others(contributors).length) {
            events.push({
                kind: "created",
                recipientIds: others(contributors),
                includeOwnerGroup: false,
                channels: ["inApp", "email"],
                headline: `You were added to proposal ${label}`,
                details: `${actorName} created ${label}${forClient} and added you as a contributor.`,
                dedupeKey: `proposal:${proposalId}:created:contributors`,
            });
        }
        return events;
    }
    const fromStatus = clean(before.status);
    const toStatus = clean(after.status);
    if (fromStatus !== toStatus && toStatus) {
        const extra = clean(note);
        const generic = !extra || /^Status changed (from .+ )?to /i.test(extra);
        events.push({
            kind: "status",
            recipientIds: others(team.map((member) => member.uid)),
            includeOwnerGroup: (0, exports.ownsAsGroup)(after),
            channels: (0, exports.statusChannels)(toStatus),
            headline: `${label} is now ${toStatus}`,
            details: `${actorName} moved it from ${fromStatus || "Draft"} to ${toStatus}.${generic ? "" : ` Note: ${extra}`}`,
            dedupeKey: `proposal:${proposalId}:status:${toStatus}:${clean(after.updatedAt?.seconds ?? after.updatedAt?._seconds ?? "")}`,
        });
    }
    // People newly put on the team by an edit hear about it once.
    const previous = new Set(teamMembers(before).map((member) => member.uid));
    const added = team.filter((member) => member.role !== "creator" && !previous.has(member.uid));
    const addedOwner = others(added.filter((member) => member.role === "owner").map((member) => member.uid));
    const addedContributors = others(added.filter((member) => member.role === "contributor").map((member) => member.uid));
    const ownerChangedToGroup = (0, exports.ownsAsGroup)(after) &&
        JSON.stringify(ownerTarget(before)) !== JSON.stringify(ownerTarget(after));
    if (addedOwner.length || ownerChangedToGroup) {
        events.push({
            kind: "added",
            recipientIds: addedOwner,
            includeOwnerGroup: ownerChangedToGroup,
            channels: ["inApp", "email"],
            headline: `You now own proposal ${label}`,
            details: `${actorName} made you the owner of ${label}.`,
            dedupeKey: `proposal:${proposalId}:owner:${addedOwner.join(",") || JSON.stringify(ownerTarget(after))}`,
        });
    }
    if (addedContributors.length) {
        events.push({
            kind: "added",
            recipientIds: addedContributors,
            includeOwnerGroup: false,
            channels: ["inApp", "email"],
            headline: `You were added to proposal ${label}`,
            details: `${actorName} added you as a contributor on ${label}.`,
            dedupeKey: `proposal:${proposalId}:contributors:${addedContributors.join(",")}`,
        });
    }
    return events;
}
exports.proposalEvents = proposalEvents;
/* ------------------------------------------------------------- deadlines */
/** Statuses where the proposal has not gone to the client yet, so a submission deadline still matters. */
exports.PRE_SUBMISSION_STATUSES = ["Draft", "In preparation"];
/**
 * The reminder due for a submission deadline on `today` (both YYYY-MM-DD in
 * SAST), or null. Each key goes out once per deadline: 7 days before, 2 days
 * before, on the day, and the day after.
 */
function deadlineReminder(data, deadline, today) {
    if (!exports.PRE_SUBMISSION_STATUSES.includes(clean(data?.status)) || data?.isArchived === true)
        return null;
    const days = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (!Number.isFinite(days))
        return null;
    const label = (0, exports.proposalLabel)(data);
    const due = new Date(`${deadline}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    if (days === 7)
        return { key: "week", channels: ["inApp", "email"], headline: `${label} is due in a week`, details: `The submission deadline is ${due} and it is still ${clean(data.status)}.` };
    if (days === 2)
        return { key: "twoDays", channels: ["inApp", "email"], headline: `${label} is due in 2 days`, details: `The submission deadline is ${due} and it is still ${clean(data.status)}.` };
    if (days === 0)
        return { key: "today", channels: ["inApp", "email", "whatsapp"], headline: `${label} is due today`, details: `Today is the submission deadline and it is still ${clean(data.status)}.` };
    if (days === -1)
        return { key: "overdue", channels: ["inApp", "email", "whatsapp"], headline: `${label} missed its deadline`, details: `The submission deadline was ${due} and it was not marked as submitted. Update its status or deadline.` };
    return null;
}
exports.deadlineReminder = deadlineReminder;
//# sourceMappingURL=proposalNotificationLogic.js.map