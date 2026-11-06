import * as logger from "firebase-functions/logger";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db, getParticipantName } from "./emailShared";
import { notifyInApp } from "./inAppNotifications";
import { getDepartmentHods } from "./movRecipients";
import { suppressRecordNotifications } from "./syntheticData";

/**
 * When an SME confirms a department's part of their development plan, that
 * department's HODs get an in-app notice that they can start assigning the
 * work. In-app only: the type is not in NOTIFICATION_REGISTRY, so no email
 * goes out, and nothing is sent on WhatsApp.
 */

// SME sign-off lives in two maps (the roadmap and the plan builder write
// different ones); a department counts as confirmed when either says so.
const isOn = (value: any) => value === true || (value && typeof value === "object" && value.confirmed === true);

const confirmedDeptIds = (plan: any): Set<string> => {
  const ids = new Set<string>();
  for (const map of [plan?.incubateeDepartmentConfirmationsByDeptId, plan?.smmeConfirmedByDeptId]) {
    Object.entries(map || {}).forEach(([id, value]) => {
      if (isOn(value)) ids.add(id);
    });
  }
  return ids;
};

/** The department's HODs; a sub-department with none falls back to its parent's. */
async function hodUidsFor(departmentId: string): Promise<{ uids: string[]; name: string }> {
  const snap = await db.collection("departments").doc(departmentId).get();
  const dept = (snap.data() || {}) as any;
  const name = String(dept.name || dept.departmentName || "your department");
  const own = await getDepartmentHods(departmentId);
  if (own.uids.length) return { uids: own.uids, name };
  const parentId = String(dept.parentDepartmentId || "").trim();
  if (!parentId) return { uids: [], name };
  return { uids: (await getDepartmentHods(parentId)).uids, name };
}

export const onDevPlanSmeConfirmedNotifyHod = onDocumentUpdated(
  { region: "us-central1", document: "diagnosticPlans/{planId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    const planId = String(event.params.planId);
    if (suppressRecordNotifications(after, planId)) return;

    const was = confirmedDeptIds(before);
    const newlyConfirmed = Array.from(confirmedDeptIds(after)).filter((id) => !was.has(id));
    if (!newlyConfirmed.length) return;

    const participantId = String(after.participantId || "").trim() || null;
    const smeName = (await getParticipantName(participantId)) || "An SME";

    await Promise.all(
      newlyConfirmed.map(async (departmentId) => {
        try {
          const { uids, name } = await hodUidsFor(departmentId);
          if (!uids.length) {
            logger.info("devPlanSmeConfirmed.noHods", { planId, departmentId });
            return;
          }
          await notifyInApp({
            type: "dev_plan_sme_confirmed",
            message: `${smeName} has confirmed ${name}'s part of their development plan. You can now assign the interventions.`,
            recipientIds: uids,
            link: "/operations/assignments",
            participantId,
            participantName: smeName,
            departmentId,
            diagnosticPlanId: planId,
          });
        } catch (error) {
          logger.warn("devPlanSmeConfirmed.failed", { planId, departmentId, error: String(error) });
        }
      })
    );
  }
);
