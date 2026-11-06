const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { loadTs } = require("../../scripts/digital-twin/validate.cjs");
const guards = loadTs("functions/src/syntheticData.ts");
test("ordinary records remain eligible; flags and scoped IDs suppress synthetic records", () => {
  assert.equal(
    guards.suppressRecordNotifications({
      programId: "real",
      participantId: "real",
    }),
    false
  );
  assert.equal(
    guards.suppressRecordNotifications({ suppressNotifications: false }),
    false
  );
  for (const record of [
    { suppressNotifications: true },
    { dataOrigin: "synthetic" },
    { programId: "dtseed_demo" },
    { participantId: "dtseed_demo" },
    { target: { id: "dtseed_demo" } },
    { actionTarget: { docId: "dtseed_demo" } },
    { context: { participantId: "dtseed_demo" } },
  ])
    assert.equal(guards.suppressRecordNotifications(record), true);
  assert.equal(guards.suppressRecordNotifications({}, "dtseed_demo"), true);
  assert.equal(guards.suppressRecordNotifications(null), false);
});
test("server-created records retain synthetic provenance without undefined fields", () => {
  assert.deepEqual(
    guards.syntheticMetadata({ programId: "dtseed_demo", seedRunId: "test" }),
    { dataOrigin: "synthetic", suppressNotifications: true, seedRunId: "test" }
  );
  assert.deepEqual(guards.syntheticMetadata({ programId: "ordinary" }), {});
});
function handlerModule(name, collectionRows = {}, documentRows = {}) {
  const effects = [];
  const forbidden =
    (name) =>
    (...args) => {
      effects.push(name);
      throw new Error(`Unexpected side effect: ${name}`);
    };
  const query = (collection) => ({
    where() {
      return this;
    },
    limit() {
      return this;
    },
    get: async () => {
      const docs = (collectionRows[collection] || []).map((data, i) => ({
        id: `dtseed_test_${i}`,
        data: () => data,
        ref: { update: forbidden("update"), set: forbidden("set") },
      }));
      return {
        docs,
        size: docs.length,
        empty: !docs.length,
        forEach: (fn) => docs.forEach(fn),
      };
    },
    doc: id => {
      const key = `${collection}/${id}`;
      if (!(key in documentRows)) return forbidden('document lookup')();
      return {get: async () => ({exists: true, data: () => documentRows[key]})};
    },
    add: forbidden("notification write"),
  });
  const db = { collection: query, collectionGroup: query };
  const admin = {
    auth: () => ({ verifyIdToken: async () => ({ uid: 'staff' }), getUserByEmail: forbidden('recipient lookup') }),
    firestore: {
      Timestamp: {
        fromDate: (d) => d,
        now: () => ({ toDate: () => new Date() }),
      },
      FieldValue: { serverTimestamp: () => new Date() },
    },
    apps: [{}],
  };
  const shared = new Proxy(
    {
      db,
      admin,
      APP_BASE_URL: "https://example.invalid",
      getTransporter: () => ({ sendMail: forbidden("email send") }),
    },
    { get: (o, k) => (k in o ? o[k] : forbidden(String(k))) }
  );
  const file = path.join(__dirname, name + ".ts"),
    m = new Module(file, module);
  m.require = (key) => {
    if (key === "./syntheticData") return guards;
    if (key === "./outcomeFollowUpLogic")
      return loadTs("functions/src/outcomeFollowUpLogic.ts");
    if (key === "./packStatus") return loadTs("functions/src/packStatus.ts");
    if (key === "./reminderCadence")
      return { moderateCadencePhase: () => "week-1" };
    if (key.includes("firebase-functions/v2/"))
      return new Proxy(
        {},
        {
          get:
            () =>
            (...args) =>
              args.at(-1),
        }
      );
    if (key === "firebase-functions/logger")
      return { info() {}, warn() {}, error() {} };
    if (key === "./emailShared" || key === "./firebase") return shared;
    if (key === "./departmentRoles")
      return {
        loadDepartmentRoles: async () => ({ roles: {}, departments: [] }),
        departmentIdsForRole: async () => [],
        isDepartmentInRole: async () => false,
        departmentNameOf: async (_id, fallback = "") => fallback,
      };
    if (key === "firebase-admin") return admin;
    if (key === "./notificationEmailRegistry")
      return {
        NOTIFICATION_REGISTRY: {
          intervention_reminder: {
            email: { resolveRecipient: forbidden("resolve recipient") },
          },
        },
      };
    return new Proxy({}, { get: () => forbidden(key) });
  };
  m._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    file
  );
  return { handlers: m.exports, effects };
}
const fixture = {
  dataOrigin: "synthetic",
  programId: "dtseed_test",
  participantId: "dtseed_test",
  applicationStatus: "accepted",
  status: "scheduled",
  type: "intervention_reminder",
  dueAt: { toDate: () => new Date("2020-01-01") },
  remindersSent: 0,
  createdAt: { toDate: () => new Date("2020-01-01") },
};
test('manual MOV reminders suppress app-generated IDs within a demo programme', async () => {
  const {handlers, effects} = handlerModule('movReminders', {}, {
    'users/reviewer': {role: 'system_admin'},
    'movDocuments/random-app-id': {programId: 'dtseed_demo', status: 'awaiting_hod'},
  });
  const result = await handlers.remindMovOwner({auth: {uid: 'reviewer'}, data: {collection: 'movDocuments', id: 'random-app-id'}});
  assert.equal(result.suppressed, true);
  assert.deepEqual(effects, []);
});
test('synthetic SME inquiries skip email even when the notification source matches', async () => {
  const { handlers, effects } = handlerModule('emailInquiries');
  await handlers.onInquiryCreatedNotifyStaff({params: {inquiryId: 'random-id'}, data: {
    before: {data: () => undefined}, after: {data: () => ({source: 'SME', branchId: 'branch', programId: 'dtseed_demo'})}
  }});
  assert.deepEqual(effects, []);
});
test('synthetic inquiry referrals suppress email and notification after authorization', async () => {
  const { handlers, effects } = handlerModule('inquiryReferral', {}, {
    'users/staff': {role: 'receptionist', assignedBranch: 'branch'},
    'inquiries/random-id': {branchId: 'branch', programId: 'dtseed_demo'},
  });
  let status, body;
  const res = {set() {}, status(value) {status=value; return this}, json(value) {body=value}};
  await handlers.notifyInquirySpecialist({method: 'POST', headers: {authorization: 'Bearer token'}, body: {
    inquiryId: 'random-id', specialistName: 'Test', specialistEmail: 'test@example.invalid', subject: 'Test', text: 'Test'
  }}, res);
  assert.equal(status, 200);
  assert.equal(body.suppressed, true);
  assert.equal(body.emailed, false);
  assert.deepEqual(effects, []);
});
for (const [file, handler] of [
  ["emailApplications", "onApplicationDecisionEmail"],
  ["emailAppointments", "onAppointmentWriteNotifyIncubatee"],
  ["workflowEmailFunctions", "onAssignedInterventionEmail"],
  ["notificationEmailFanout", "onNotificationCreatedEmail"],
  ["pushNotifications", "onNotificationCreatedPush"],
  ["syncCoordinatorPrograms", "syncProgramToBranchCoordinators"],
])
  test(`${handler} skips before any lookup or notification`, async () => {
    const { handlers, effects } = handlerModule(file);
    await handlers[handler]({
      params: {
        appId: "dtseed_test",
        apptId: "dtseed_test",
        assignmentId: "dtseed_test",
        notificationId: "dtseed_test",
        programId: "dtseed_test",
      },
      data: {
        before: { exists: false, data: () => undefined },
        after: { exists: true, data: () => fixture },
      },
    });
    assert.deepEqual(effects, []);
  });
for (const [file, handler, collection] of [
  ["outcomeFollowUps", "outcomeFollowUpReminderCron", "outcomeFollowUps"],
  ["movStageReminders", "movStageReminderCron", "consolidatedMOVs"],
  ["workflowQueryReminders", "workflowQueryReminderCron", "workflowQueries"],
  ["moaFlag", "requireMoaAfter3Months", "applications"],
  ["complianceExpiry", "complianceExpiryReminderCron", "applications"],
  ["emailAppointments", "appointmentCompletionNotifier", "appointments"],
])
  test(`${handler} skips synthetic backlog before side effects`, async () => {
    const { handlers, effects } = handlerModule(file, {
      [collection]: [fixture],
    });
    await handlers[handler]();
    assert.deepEqual(effects, []);
  });
