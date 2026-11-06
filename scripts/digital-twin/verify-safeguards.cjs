const fs = require("node:fs");
const path = require("node:path");
const { REQUIRED_FUNCTIONS } = require("./seed.cjs");
const { hash } = require("./dataset.cjs");
const dir = path.resolve(__dirname, "../../artifacts/digital-twin");
const inventory = JSON.parse(
  fs.readFileSync(path.join(dir, "deployed-functions.json"), "utf8")
);
const guardFiles = [
  "emailInquiries.ts",
  "inquiryReferral.ts",
  "syntheticData.ts",
  "emailApplications.ts",
  "emailAppointments.ts",
  "workflowEmailFunctions.ts",
  "outcomeFollowUps.ts",
  "movStageReminders.ts",
  "workflowQueryReminders.ts",
  "complianceExpiry.ts",
  "moaFlag.ts",
  "emailDevPlan.ts",
  "notificationEmailFanout.ts",
  "pushNotifications.ts",
  "movReminders.ts",
  "syncAssignedInterventions.ts",
  "whatsappCheckBack.ts",
  "syncCoordinatorPrograms.ts",
];
const filesByFunction = {
  onInquiryCreatedNotifyStaff: ['emailInquiries.ts'],
  notifyInquirySpecialist: ['inquiryReferral.ts'],
  onApplicationDecisionEmail: ['emailApplications.ts'],
  onAppointmentWriteNotifyIncubatee: ['emailAppointments.ts'],
  appointmentCompletionNotifier: ['emailAppointments.ts'],
  onAssignedInterventionEmail: ['workflowEmailFunctions.ts'],
  onAssignmentConfirmedScheduleFollowUp: ['outcomeFollowUps.ts'],
  outcomeFollowUpReminderCron: ['outcomeFollowUps.ts', 'whatsappCheckBack.ts'],
  onOutcomeFollowUpAnswered: ['outcomeFollowUps.ts'],
  movStageReminderCron: ['movStageReminders.ts'],
  workflowQueryReminderCron: ['workflowQueryReminders.ts'],
  complianceExpiryReminderCron: ['complianceExpiry.ts'],
  requireMoaAfter3Months: ['moaFlag.ts'],
  devPlanReminderCron: ['emailDevPlan.ts'],
  sendDevPlanReminders: ['emailDevPlan.ts'],
  remindSmmeDpConfirmation: ['emailDevPlan.ts'],
  onNotificationCreatedEmail: ['notificationEmailFanout.ts'],
  onNotificationCreatedPush: ['pushNotifications.ts'],
  remindMovOwner: ['movReminders.ts'],
  sendInterventionReminderEmail: ['workflowEmailFunctions.ts'],
  syncAssignedInterventionsDenorm: ['syncAssignedInterventions.ts'],
  syncProgramToBranchCoordinators: ['syncCoordinatorPrograms.ts'],
};
const functions = REQUIRED_FUNCTIONS.map((id) => {
  const threshold = Math.max(...['syntheticData.ts', ...filesByFunction[id]].map(f => fs.statSync(path.resolve(__dirname, '../../functions/src', f)).mtimeMs));
  const found = inventory.find(
    (f) => f.id === id && f.region === "us-central1"
  );
  if (
    !found ||
    found.state !== "ACTIVE" ||
    Date.parse(found.updatedAt) < threshold
  )
    throw new Error(`Safeguard not active after local edit: ${id}`);
  return found;
});
const receipt = {
  projectId: "lepharo-smart-inc",
  deploymentVerifiedAt: new Date().toISOString(),
  functionSetHash: hash(REQUIRED_FUNCTIONS),
  functions,
  sourceHashes: Object.fromEntries(
    guardFiles.map((f) => [
      f,
      hash(
        fs.readFileSync(
          path.resolve(__dirname, "../../functions/src", f),
          "utf8"
        )
      ),
    ])
  ),
};
fs.writeFileSync(
  path.join(dir, "safeguard-receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    verified: true,
    functions: functions.length,
    deploymentVerifiedAt: receipt.deploymentVerifiedAt,
  })
);
