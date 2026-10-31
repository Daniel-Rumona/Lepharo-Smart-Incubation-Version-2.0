import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { admin, db } from "./firebase";
import { isHrManagerProfile, isDepartmentInRole } from "./departmentRoles";
import { chunkArray } from "./utils/firestore";
import { lineManagerPatches, type StaffProfile } from "./lineManagerLogic";

const BATCH_SIZE = 400;
const clean = (value: unknown) => String(value ?? "").trim();

/** Fields that can change who someone's default line manager is. */
const WATCHED_FIELDS = ["role", "departmentId", "assignedBranch", "branchId", "status", "lineManagerSource"];

/** IPM records that carry the employee's lineManagerId for access rules. */
const PERFORMANCE_COLLECTIONS = ["employeePerformanceCompacts", "employeePerformanceReviews"];

async function loadStaff(): Promise<StaffProfile[]> {
  const snapshot = await db
    .collection("users")
    .select("role", "departmentId", "assignedBranch", "branchId", "status", "lineManagerId", "lineManagerSource")
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<StaffProfile, "id">) }));
}

/** Bring every non-manual employee's lineManagerId to its default. */
async function applyDefaultLineManagers(staff: StaffProfile[]) {
  const patches = lineManagerPatches(staff);
  for (const chunk of chunkArray(patches, BATCH_SIZE)) {
    const batch = db.batch();
    for (const patch of chunk) {
      batch.update(db.collection("users").doc(patch.id), {
        lineManagerId: patch.lineManagerId ?? admin.firestore.FieldValue.delete(),
      });
    }
    await batch.commit();
  }
  return patches.length;
}

/**
 * Any change to a role, department, branch or status can move someone's
 * default manager, including everyone who reported to the person who changed.
 * The org is small, so recompute everyone; only real differences are written,
 * and lineManagerId is not watched, so the writes do not retrigger this.
 */
export const onUserLineManagerInputs = onDocumentWritten("users/{uid}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  const changed = WATCHED_FIELDS.some((field) => clean(before[field]) !== clean(after[field]));
  if (!changed) return;

  const updated = await applyDefaultLineManagers(await loadStaff());
  if (updated) logger.info("[lineManagers] defaults refreshed", { trigger: event.params.uid, updated });
});

/**
 * HR or the CEO: recompute every default line manager and stamp the current
 * manager onto older IPM records that predate lineManagerId.
 */
export const recalculateLineManagers = onCall(async (req) => {
  const callerUid = req.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be signed in.");

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() || {};
  const callerRole = clean(caller.role).toLowerCase();
  const allowed =
    ["system_admin", "superadmin", "director"].includes(callerRole) ||
    (await isHrManagerProfile(caller)) ||
    (await isDepartmentInRole(clean(caller.departmentId), "hr"));
  if (!allowed) throw new HttpsError("permission-denied", "Only HR or the CEO can recalculate line managers.");

  const staff = await loadStaff();
  const usersUpdated = await applyDefaultLineManagers(staff);

  // Re-read so the stamp uses the managers just written.
  const managerById = new Map((await loadStaff()).map((person) => [person.id, clean(person.lineManagerId)]));
  let recordsUpdated = 0;
  for (const collection of PERFORMANCE_COLLECTIONS) {
    const snapshot = await db.collection(collection).get();
    const missing = snapshot.docs.filter((doc) => !clean(doc.get("lineManagerId")));
    for (const chunk of chunkArray(missing, BATCH_SIZE)) {
      const batch = db.batch();
      let writes = 0;
      for (const doc of chunk) {
        const employeeUid = clean(doc.get("employeeAuthUid") || doc.get("employeeId"));
        const managerId = managerById.get(employeeUid);
        if (!managerId) continue;
        batch.update(doc.ref, { lineManagerId: managerId });
        writes += 1;
      }
      if (writes) await batch.commit();
      recordsUpdated += writes;
    }
  }

  logger.info("[lineManagers] recalculated", { callerUid, usersUpdated, recordsUpdated });
  return { usersUpdated, recordsUpdated };
});
