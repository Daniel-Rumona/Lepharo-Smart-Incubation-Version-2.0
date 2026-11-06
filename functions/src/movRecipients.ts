import * as logger from "firebase-functions/logger";
import { db } from "./emailShared";

export type HodTarget = { emails: string[]; uids: string[] };

/** HODs of one department: operations-role users carrying that departmentId. */
export async function getDepartmentHods(departmentId: string): Promise<HodTarget> {
  const target: HodTarget = { emails: [], uids: [] };
  try {
    const snap = await db
      .collection("users")
      .where("role", "==", "operations")
      .where("departmentId", "==", departmentId)
      .get();
    for (const u of snap.docs) {
      const email = String((u.data() as any).email || "").trim().toLowerCase();
      if (email.includes("@")) target.emails.push(email);
      target.uids.push(u.id);
    }
  } catch (error) {
    logger.warn("movStageReminderCron.hodLookupFailed", { departmentId, error: String(error) });
  }
  return target;
}

/**
 * The MOV's own departmentId, else its intervention's. Older MOVs may lack
 * the field; the intervention is the source of truth for ownership.
 */
const interventionDeptCache = new Map<string, string | null>();
export async function resolveMovDepartmentId(mov: any): Promise<string | null> {
  const direct = String(mov.departmentId || "").trim();
  if (direct) return direct;
  const interventionId = String(mov.interventionId || "").trim();
  if (!interventionId) return null;
  if (interventionDeptCache.has(interventionId)) return interventionDeptCache.get(interventionId) ?? null;
  let resolved: string | null = null;
  try {
    const snap = await db.collection("interventions").doc(interventionId).get();
    resolved = String((snap.data() as any)?.departmentId || "").trim() || null;
  } catch (error) {
    logger.warn("movStageReminderCron.interventionLookupFailed", { interventionId, error: String(error) });
  }
  interventionDeptCache.set(interventionId, resolved);
  return resolved;
}


/** Firebase uids for a list of emails, so in-app notifications can target people instead of a whole role. */
export async function uidsForEmails(emails: string[]): Promise<string[]> {
  const uids = new Set<string>();
  const unique = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 10) {
    try {
      const snap = await db.collection("users").where("email", "in", unique.slice(i, i + 10)).get();
      snap.docs.forEach((d) => uids.add(d.id));
    } catch (error) {
      logger.warn("uidsForEmails.failed", { error: String(error) });
    }
  }
  return Array.from(uids);
}

/**
 * The programme a pack (or MOV) belongs to: its own programId, else the
 * first of its MOVs that names one.
 */
export function resolvePackProgramId(pack: any): string | null {
  const direct = String(pack?.programId || "").trim();
  if (direct) return direct;
  const items: any[] = Array.isArray(pack?.interventions) ? pack.interventions : Array.isArray(pack?.interventionsSnapshot) ? pack.interventionsSnapshot : [];
  const fromItem = items.map((item) => String(item?.programId || "").trim()).find(Boolean);
  return fromItem || null;
}

/** A programme's managing branch, read the same way the app scopes a project admin's programmes. */
async function programBranchId(programId: string): Promise<string | null> {
  try {
    const program = (await db.collection("programs").doc(programId).get()).data() as any;
    if (!program) return null;
    const assigned = program.assignedBranch;
    const id = program.normalizedAssignedBranchId || program.branchId || (typeof assigned === "string" ? assigned : assigned?.id) || program.assignedBranchId;
    return String(id || "").trim() || null;
  } catch (error) {
    logger.warn("programBranchId.failed", { programId, error: String(error) });
    return null;
  }
}

/**
 * The Center Coordinators (project admins) of a programme: those assigned to
 * the branch that manages it. Empty when the programme has no branch or
 * nobody is assigned to it; callers decide on a fallback.
 */
export async function getProgramProjectAdmins(programId: string | null | undefined): Promise<HodTarget> {
  const target: HodTarget = { emails: [], uids: [] };
  const id = String(programId || "").trim();
  if (!id) return target;
  const branchId = await programBranchId(id);
  if (!branchId) return target;
  try {
    const snap = await db.collection("users").where("role", "==", "projectadmin").where("assignedBranch", "==", branchId).get();
    for (const u of snap.docs) {
      const email = String((u.data() as any).email || "").trim().toLowerCase();
      if (email.includes("@")) target.emails.push(email);
      target.uids.push(u.id);
    }
  } catch (error) {
    logger.warn("getProgramProjectAdmins.failed", { programId: id, branchId, error: String(error) });
  }
  return target;
}
