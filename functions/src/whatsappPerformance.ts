import { db } from "./firebase";
import { clean } from "./whatsappCommon";
import { GatewayResult, StaffIdentity } from "./whatsappStaff";
import { isActiveProfile, normalizeStaffRole } from "./lineManagerLogic";
import type { IpmCycle, IpmReview, PhaseKey } from "./ipmReminderLogic";
import { isRunning, StaffState, summarise } from "./performanceSummaryLogic";

/**
 * "Performance" on WhatsApp for the director (the CEO in the IPM toolkit): each running performance cycle,
 * how far compacts and reviews have got, and what is waiting on them (validations, and the people they
 * line-manage). Read-only; the work itself is done on the Performance page. The same people as that page
 * and the reminder job (ipmReminders.ts): active staff, not the director, not test (control) logins.
 */

const ok = (body: Record<string, unknown>): GatewayResult => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status: number, error: string): GatewayResult => ({ status, body: { ok: false, error } });
const isControlEmail = (email: unknown) => clean(email).toLowerCase().endsWith("@quantilytix.co.za");

const todayInJohannesburg = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

export async function performanceSummary(identity: StaffIdentity): Promise<GatewayResult> {
  if (identity.roleGroup !== "director") return fail(403, "not_permitted");
  const today = todayInJohannesburg();
  const cycles = (await db.collection("performanceCycles").get()).docs
    .map((doc) => ({ ...(doc.data() as IpmCycle), id: doc.id }))
    .filter((cycle) => cycle.windows?.compacting && cycle.windows?.midYear && cycle.windows?.yearEnd && isRunning(cycle, today))
    .sort((a, b) => clean(b.startDate).localeCompare(clean(a.startDate)));
  if (!cycles.length) return ok({ cycles: [] });

  const [usersSnap, checkInSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("performanceCheckIns").select("employeeAuthUid", "date").get(),
  ]);
  const checkInDates = new Map<string, string[]>();
  checkInSnap.docs.forEach((doc) => {
    const uid = clean(doc.get("employeeAuthUid"));
    checkInDates.set(uid, [...(checkInDates.get(uid) || []), clean(doc.get("date"))]);
  });
  const staff = usersSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data(), role: normalizeStaffRole(doc.data().role) }))
    .filter((p) => p.role && p.role !== "director" && isActiveProfile({ id: p.id, ...p.data }) && !isControlEmail(p.data.email));

  const summaries = [];
  for (const cycle of cycles.slice(0, 2)) {
    const [compactSnap, reviewSnap] = await Promise.all([
      db.collection("employeePerformanceCompacts").where("cycleId", "==", cycle.id).get(),
      db.collection("performanceReviews").where("cycleId", "==", cycle.id).get(),
    ]);
    const compacts = new Map(compactSnap.docs.map((doc) => [clean(doc.get("employeeAuthUid") || doc.get("employeeId")), doc.data()]));
    const reviews = new Map<string, Partial<Record<PhaseKey, IpmReview>>>();
    reviewSnap.docs.forEach((doc) => {
      const uid = clean(doc.get("employeeAuthUid"));
      reviews.set(uid, { ...(reviews.get(uid) || {}), [doc.get("phase")]: doc.data() as IpmReview });
    });
    const states: StaffState[] = staff.map((p) => {
      const uid = clean(p.data.uid || p.data.authUid || p.id);
      return {
        uid,
        name: clean(p.data.name || p.data.fullName) || clean(p.data.email).split("@")[0] || "A colleague",
        lineManagerId: clean(p.data.lineManagerId) || null,
        compact: (compacts.get(uid) as any) || null,
        checkInDates: checkInDates.get(uid) || [],
        reviews: reviews.get(uid) || {},
      };
    });
    summaries.push(summarise(cycle, today, states, identity.id));
  }
  return ok({ cycles: summaries });
}
