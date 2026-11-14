// Pure rules for proposal pipeline notifications. No Firestore here so it can
// be unit tested (proposalNotificationLogic.test.cjs). Statuses mirror
// src/types/proposal.ts.

const clean = (value: unknown) => String(value ?? "").trim();

export type Channel = "inApp" | "email" | "whatsapp";

/** Someone on a proposal's team, by login uid. Department and centre owners are resolved to people by the caller. */
export type TeamMember = { uid: string; role: "owner" | "contributor" | "creator" };

export type OwnerTarget =
  | { kind: "person"; uid: string }
  | { kind: "department"; departmentId: string }
  | { kind: "centre"; branchId: string }
  | { kind: "none" };

/** Who owns the proposal, as something the trigger can turn into people. */
export function ownerTarget(data: any): OwnerTarget {
  const owner = data?.owner || {};
  const id = clean(owner.id);
  if (!id) return { kind: "none" };
  if (owner.type === "Department") return { kind: "department", departmentId: id };
  if (owner.type === "Centre") return { kind: "centre", branchId: id };
  return { kind: "person", uid: id };
}

/** Owned by a department or centre, whose people the caller looks up. */
export const ownsAsGroup = (data: any) => ["department", "centre"].includes(ownerTarget(data).kind);

/** The people named on a proposal by uid: an individual owner, contributors and whoever created it. */
export function teamMembers(data: any): TeamMember[] {
  const members = new Map<string, TeamMember>();
  const add = (uid: unknown, role: TeamMember["role"]) => {
    const id = clean(uid);
    if (id && !members.has(id)) members.set(id, { uid: id, role });
  };
  const owner = ownerTarget(data);
  if (owner.kind === "person") add(owner.uid, "owner");
  (Array.isArray(data?.contributors) ? data.contributors : []).forEach((person: any) => add(person?.id, "contributor"));
  add(data?.createdBy?.id, "creator");
  return [...members.values()];
}

/** Which channels a move into each status uses. Moves inside preparation stay in-app only. */
const STATUS_CHANNELS: Record<string, Channel[]> = {
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

export const statusChannels = (status: unknown): Channel[] => STATUS_CHANNELS[clean(status)] || ["inApp"];

export const proposalLabel = (data: any) => {
  const number = clean(data?.proposalNumber);
  const title = clean(data?.title) || "Untitled proposal";
  return number ? `${number} "${title}"` : `"${title}"`;
};

export type ProposalEvent = {
  kind: "created" | "status" | "added";
  /** uids to tell; the person who made the change is never among them. */
  recipientIds: string[];
  /** Also tell the people behind a department or centre owner (resolved by the caller). */
  includeOwnerGroup: boolean;
  channels: Channel[];
  headline: string;
  details: string;
  dedupeKey: string;
};

/**
 * What changed on a proposal write, and who hears about it. `before` is null
 * on create. `note` is the progress note from the status change, when known.
 */
export function proposalEvents(
  proposalId: string,
  before: any | null,
  after: any | null,
  note?: string | null
): ProposalEvent[] {
  if (!after) return [];
  const label = proposalLabel(after);
  const client = clean(after.clientName);
  const actor = clean(after.updatedBy?.id || after.createdBy?.id);
  const actorName = clean(after.updatedBy?.name || after.createdBy?.name) || "A colleague";
  const others = (uids: string[]) => uids.filter((uid) => uid && uid !== actor);
  const team = teamMembers(after);
  const events: ProposalEvent[] = [];

  if (!before) {
    const owner = team.filter((member) => member.role === "owner").map((member) => member.uid);
    const contributors = team.filter((member) => member.role === "contributor").map((member) => member.uid);
    const forClient = client ? ` for ${client}` : "";
    if (others(owner).length || ownsAsGroup(after)) {
      events.push({
        kind: "created",
        recipientIds: others(owner),
        includeOwnerGroup: ownsAsGroup(after),
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
      includeOwnerGroup: ownsAsGroup(after),
      channels: statusChannels(toStatus),
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
  const ownerChangedToGroup = ownsAsGroup(after) &&
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

/* ------------------------------------------------------------- deadlines */

/** Statuses where the proposal has not gone to the client yet, so a submission deadline still matters. */
export const PRE_SUBMISSION_STATUSES = ["Draft", "In preparation"];

export type DeadlineReminder = { key: "week" | "twoDays" | "today" | "overdue"; channels: Channel[]; headline: string; details: string };

/**
 * The reminder due for a submission deadline on `today` (both YYYY-MM-DD in
 * SAST), or null. Each key goes out once per deadline: 7 days before, 2 days
 * before, on the day, and the day after.
 */
export function deadlineReminder(data: any, deadline: string, today: string): DeadlineReminder | null {
  if (!PRE_SUBMISSION_STATUSES.includes(clean(data?.status)) || data?.isArchived === true) return null;
  const days = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(days)) return null;
  const label = proposalLabel(data);
  const due = new Date(`${deadline}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  if (days === 7) return { key: "week", channels: ["inApp", "email"], headline: `${label} is due in a week`, details: `The submission deadline is ${due} and it is still ${clean(data.status)}.` };
  if (days === 2) return { key: "twoDays", channels: ["inApp", "email"], headline: `${label} is due in 2 days`, details: `The submission deadline is ${due} and it is still ${clean(data.status)}.` };
  if (days === 0) return { key: "today", channels: ["inApp", "email", "whatsapp"], headline: `${label} is due today`, details: `Today is the submission deadline and it is still ${clean(data.status)}.` };
  if (days === -1) return { key: "overdue", channels: ["inApp", "email", "whatsapp"], headline: `${label} missed its deadline`, details: `The submission deadline was ${due} and it was not marked as submitted. Update its status or deadline.` };
  return null;
}
