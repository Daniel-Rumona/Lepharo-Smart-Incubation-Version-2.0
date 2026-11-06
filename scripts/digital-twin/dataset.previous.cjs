require("../node26-shim.cjs");
const { Timestamp } = require("firebase-admin").firestore;
const crypto = require("node:crypto");
const VERSION = "1.0.0";
const RUN = "dtseed_20261009_v1";
const REF = "2026-10-09T08:00:00.000Z";
const DAY = 86400000;
const DEPARTMENTS = [
  {
    id: "9bu8xeGsQu4O1NVV73Du",
    name: "Legal Advisory Services",
    title: "Contract Management",
    deliverable: "Sample contract register",
    outcome: "The business consistently maintains its contract register.",
  },
  {
    id: "Gyx2pYnOPZZ2DlGPRkZd",
    name: "Financial Compliance",
    title: "Cash Flow Planning",
    deliverable: "Sample cash flow plan",
    outcome: "The business uses its cash flow plan for monthly decisions.",
  },
  {
    id: "BOYnwuCpmRjzcJqZG6Vj",
    name: "Marketing and Communication",
    title: "Customer Pipeline Development",
    deliverable: "Sample customer pipeline",
    outcome: "The business records and follows up qualified customer leads.",
  },
  {
    id: "FnbBdir2lWjcDaH75Bj9",
    name: "Training Academy",
    title: "Business Record Keeping",
    deliverable: "Sample record keeping workbook",
    outcome: "The business maintains complete monthly operating records.",
  },
];
const BRANCHES = [
  { id: "yYA7BNWDc6muS0FnhiaO", name: "Rustenburg", code: "RUS" },
  { id: "TtIlYJ5EFS2gHgluBsos", name: "Springs (Head Office)", code: "SPR" },
];
// Both demo programmes run from the Rustenburg centre. BRANCHES stays the list of centres the
// twin knows about (Springs keeps its capacity calendar), but no demo programme sits in Springs.
const PROGRAM_BRANCHES = [BRANCHES[0], BRANCHES[0]];
const CASES = [
  "achieved",
  "partial",
  "not_yet",
  "disputed",
  "unanswered",
  "delayed",
  "sustained",
  "reversal",
  "awaiting_smme",
  "awaiting_hod",
  "queried",
  "rejected",
  "scheduled",
  "in_delivery",
  "cancelled",
  "declined",
  "reassignment",
  "group",
  "recurring",
  "followup_future",
];
const stamp = (value) => Timestamp.fromDate(new Date(value));
const offset = (days, hours = 0) =>
  Timestamp.fromMillis(Date.parse(REF) + days * DAY + hours * 3600000);
const add = (at, days) => Timestamp.fromMillis(at.toMillis() + days * DAY);
const pad = (n) => String(n).padStart(3, "0");
const id = (kind, n) => `${RUN}_${kind}_${n}`;
const meta = (scenarioKey) => ({
  dataOrigin: "synthetic",
  suppressNotifications: true,
  seedRunId: RUN,
  generatorVersion: VERSION,
  scenarioKey,
});
function encode(value) {
  if (value instanceof Timestamp)
    return { $timestamp: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, encode(v)])
    );
  return value;
}
function decode(value) {
  if (value?.$timestamp) return stamp(value.$timestamp);
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, decode(v)])
    );
  return value;
}
const hash = (value) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(encode(value)))
    .digest("hex");
const BUCKET = "lepharo-smart-inc.firebasestorage.app";
function evidenceAssets() {
  return DEPARTMENTS.map((dept, d) => {
    const path = `synthetic/${RUN}/sample-${d}.txt`,
      token = hash({ RUN, d }).slice(0, 32);
    return {
      path,
      token,
      content: `SYNTHETIC DEVELOPMENT SAMPLE - NOT REAL BUSINESS EVIDENCE\n\n${dept.deliverable}\nDataset: ${RUN}\nDepartment: ${dept.name}\n\nExample record: review business records, identify gaps, agree actions, and review adoption at follow-up.\nNo genuine signature, invoice, or business outcome is asserted.\n`,
      url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(
        path
      )}?alt=media&token=${token}`,
    };
  });
}

function generate() {
  const records = [];
  const refs = new Map();
  const expectations = {
    lifecycle: {},
    movStages: {},
    outcomeCases: {},
    groups: [],
  };
  const put = (collection, key, data, scenario = "foundation") => {
    const path = `${collection}/${key}`;
    if (refs.has(path)) throw new Error(`Duplicate fixture ${path}`);
    const row = { path, data: { id: key, ...meta(scenario), ...data } };
    records.push(row);
    refs.set(path, row.data);
    return row.data;
  };
  const actors = DEPARTMENTS.map((dept, d) => {
    const actor = {
      id: id("facilitator", d),
      uid: id("facilitator", d),
      name: `[DEMO] ${dept.name} Facilitator`,
      email: `dtseed.facilitator.${d}@example.invalid`,
      role: "coordinator",
      departmentId: dept.id,
      departmentName: dept.name,
      phone: "",
      assignedPrograms: [id("program", 0), id("program", 1)],
      branchIds: BRANCHES.map((b) => b.id),
      status: "active",
      createdAt: offset(-365),
      updatedAt: offset(-365),
    };
    put("coordinators", actor.id, actor);
    // No Auth users/passwords and no real staff contact or signatures are copied.
    put("syntheticActors", actor.id, actor);
    put("syntheticActors", id("hod", d), {
      name: `[DEMO] ${dept.name} Reviewer`,
      role: "operations",
      departmentId: dept.id,
      email: `dtseed.hod.${d}@example.invalid`,
    });
    return actor;
  });
  for (const [role, name] of [
    ["cc", "Centre Coordinator"],
    ["me", "M&E Reviewer"],
  ])
    put("syntheticActors", id(role, 0), {
      name: `[DEMO] ${name}`,
      role,
      email: `dtseed.${role}@example.invalid`,
    });
  for (let p = 0; p < 2; p++) {
    const b = PROGRAM_BRANCHES[p];
    put("programs", id("program", p), {
      name: `[DEMO Twin] ${p ? "Enterprise Growth" : "Incubation Foundations"}`,
      code: `DTT${p + 1}`,
      codeSource: "manual",
      description:
        "Synthetic digital twin development dataset. Not real programme performance.",
      status: "active",
      type: "incubation",
      cohortYear: 2026,
      maxCapacity: 60,
      assignedBranch: { id: b.id, name: b.name },
      branchId: b.id,
      assignedCoordinators: actors.map((a) => a.id),
      assignedFunder: null,
      startDate: offset(-365),
      endDate: offset(180),
      budget: 1200000,
      eligibilityCriteria: [],
      programRequirements: [],
      createdAt: offset(-365),
      updatedAt: offset(-365),
    });
  }
  const definitions = DEPARTMENTS.map((dept, d) =>
    put("interventions", id("intervention", d), {
      interventionTitle: `[DEMO] ${dept.title}`,
      departmentId: dept.id,
      areaOfSupport: dept.name,
      compulsory: false,
      assignmentMode: d === 1 ? "recurring" : "once-off",
      recurring: d === 1,
      recurrencePreset: d === 1 ? "monthly" : "as-needed",
      frequency: d === 1 ? "monthly" : "as-needed",
      recurrence: d === 1 ? { every: 1, unit: "month" } : null,
      hasSubInterventions: false,
      subInterventions: [],
      definitionVersion: 1,
      defaultPlannedSessions: 1,
      outcomeDef: {
        origin: "manual",
        deliverable: {
          name: dept.deliverable,
          description: "Synthetic sample for development only.",
          required: true,
        },
        intendedOutcome: dept.outcome,
        outcomeType: "process_implemented",
        acceptedMechanisms: [
          "deliverable",
          "facilitator_observation",
          "sme_self_report",
        ],
        checkAdoption: true,
        followUp: { required: true, smeCheckIn: true },
        followUpAfterDays: 30,
      },
      createdAt: offset(-365),
      updatedAt: offset(-365),
    })
  );
  const participants = [];
  for (let i = 0; i < 60; i++) {
    const p = i % 2,
      b = PROGRAM_BRANCHES[p],
      pid = id("sme", pad(i + 1)),
      applicationId = id("application", pad(i + 1)),
      name = `[DEMO] ${
        ["Metsi", "Lefa", "Kopano", "Naledi", "Thuto"][i % 5]
      } Enterprise ${pad(i + 1)}`;
    const revenue = {},
      headcount = {};
    for (let m = 0; m < 12; m++) {
      const month = new Date(Date.UTC(2025, 9 + m, 1))
        .toISOString()
        .slice(0, 7);
      const rate = [0.045, -0.025, 0, 0.015][i % 4],
        base = 20000 + i * 1700;
      revenue[month] = Math.round(base * (1 + rate * m));
      headcount[month] = {
        permanent: Math.max(
          1,
          3 +
            (i % 7) +
            (i % 4 === 0
              ? Math.floor(m / 4)
              : i % 4 === 1
              ? -Math.floor(m / 5)
              : 0)
        ),
        temporary: m % 3 === 0 ? 1 : 0,
      };
      put(
        "participantMonthlyMetrics",
        id("metric", `${pad(i + 1)}_${month}`),
        {
          participantId: pid,
          programId: id("program", p),
          branchId: b.id,
          month,
          sourceMonth: month,
          year: Number(month.slice(0, 4)),
          revenue: revenue[month],
          monthlyRevenue: revenue[month],
          headcountPermanent: headcount[month].permanent,
          headcountTemporary: headcount[month].temporary,
          createdAt: stamp(`${month}-01T00:00:00Z`),
          recordedAt: stamp(`${month}-28T12:00:00Z`),
          source: "synthetic_history",
          currency: "ZAR",
        },
        "business_measurements"
      );
    }
    const common = {
      participantId: pid,
      uid: pid,
      email: `dtseed.sme.${pad(i + 1)}@example.invalid`,
      phone: "",
      participantName: name,
      beneficiaryName: name,
      businessName: name,
      companyName: name,
      programId: id("program", p),
      programName: refs.get(`programs/${id("program", p)}`).name,
      branchId: b.id,
      branchName: b.name,
      branchCode: b.code,
      applicationStatus: "accepted",
      stage: "incubation",
      smmeNo: `DEMO-${pad(i + 1)}`,
      sector: ["Manufacturing", "Services", "Agriculture"][i % 3],
      province: b.id === BRANCHES[0].id ? "North West" : "Gauteng",
      createdAt: offset(-365),
      updatedAt: offset(-1),
      acceptedAt: offset(-360),
      gapAnalysisStatus: "completed",
      complianceDocuments: [
        {
          id: `sample_registration`,
          documentName: "Sample business registration",
          status: i % 5 === 0 ? "expired" : "valid",
          expiryDate: offset(i % 5 === 0 ? -15 : 120),
          dataOrigin: "synthetic",
          verificationNote:
            "Fixture status only; no real document or signature.",
        },
      ],
      profile: {
        businessName: name,
        sector: ["Manufacturing", "Services", "Agriculture"][i % 3],
      },
      interventions: { assigned: [], completed: [] },
    };
    const participant = put(
      "participants",
      pid,
      {
        ...common,
        interventions: { assigned: [], completed: [] },
        applicationId,
        revenueHistory: { monthly: revenue },
        headcountHistory: { monthly: headcount },
      },
      ["growth", "decline", "stable", "gradual"][i % 4]
    );
    put(
      "applications",
      applicationId,
      {
        ...common,
        interventions: { assigned: [], completed: [] },
        applicantEmail: common.email,
        applicantName: name,
        submittedAt: offset(-363),
        moaSigned: false,
        needsMOA: true,
        moaStatus: "Required",
      },
      "accepted_application"
    );
    put(
      "users",
      pid,
      {
        name,
        email: common.email,
        role: "incubatee",
        participantId: pid,
        programId: common.programId,
        assignedPrograms: [common.programId],
        branchId: b.id,
        assignedBranch: b.id,
        accountStatus: "active",
        phone: "",
        whatsappConsent: { status: "not_granted" },
        createdAt: offset(-365),
        updatedAt: offset(-1),
      },
      "synthetic_profile_no_auth"
    );
    participants.push(participant);
    const confirmedByDeptId = {},
      incubateeDepartmentConfirmationsByDeptId = {};
    DEPARTMENTS.forEach((d, j) => {
      confirmedByDeptId[d.id] = {
        confirmed: true,
        departmentId: d.id,
        departmentName: d.name,
        confirmedBy: id("hod", j),
        confirmedAt: offset(-350),
        deliveryMethod: "In-person",
      };
      incubateeDepartmentConfirmationsByDeptId[d.id] = {
        confirmed: true,
        confirmedAt: offset(-349),
        confirmedByEmail: common.email,
      };
    });
    put(
      "diagnosticPlans",
      id("plan", pad(i + 1)),
      {
        participantId: pid,
        programId: common.programId,
        interventions: definitions.map((iv) => ({
          id: iv.id,
          title: iv.interventionTitle,
          departmentId: iv.departmentId,
          area: iv.areaOfSupport,
          source: "Required",
        })),
        confirmedByDeptId,
        incubateeDepartmentConfirmationsByDeptId,
        createdAt: offset(-355),
        updatedAt: offset(-349),
      },
      "confirmed_diagnostic_plan"
    );
  }
  const packGroups = new Map();
  const event = (entityId, eventType, at, extra = {}) =>
    put(
      "syntheticHistory",
      id("event", `${entityId}_${eventType}`),
      { entityId, eventType, occurredAt: at, recordedAt: at, ...extra },
      "historical_transition"
    );
  for (let i = 0; i < 60; i++)
    for (let cycle = 0; cycle < 5; cycle++) {
      const s = participants[i],
        scenario = CASES[(i + cycle * 3) % CASES.length],
        d = scenario === "recurring" ? 1 : (i + cycle) % 4,
        dept = DEPARTMENTS[d],
        actor = actors[d],
        iv = definitions[d];
      const aid = id("assignment", `${pad(i + 1)}_${cycle + 1}`),
        grouped = scenario === "group",
        missingGroupAttendance = grouped && i % 3 === 0;
      const done =
        [
          "achieved",
          "partial",
          "not_yet",
          "disputed",
          "unanswered",
          "delayed",
          "sustained",
          "reversal",
          "awaiting_hod",
          "queried",
          "recurring",
          "followup_future",
        ].includes(scenario) ||
        (grouped && !missingGroupAttendance);
      const delivered =
        done || ["awaiting_smme", "rejected", "in_delivery"].includes(scenario);
      const future = scenario === "scheduled";
      let deliveryDay =
        cycle === 4
          ? -60 - (i % 12)
          : [-320, -250, -180, -110][cycle] + (i % 12);
      if (future) deliveryDay = 7 + (i % 12) * 7;
      if (scenario === "followup_future") deliveryDay = -10;
      if (grouped) deliveryDay = [-320, -250, -180, -110, -65][cycle]; // shared, coherent session date
      const start = offset(deliveryDay),
        end = add(start, 1 / 24),
        createdAt = offset(Math.min(deliveryDay - 14, -1)),
        confirmedAt = add(end, 1);
      const groupKey = grouped
        ? id("group", `${cycle}_${s.programId}_${d}`)
        : null;
      const sessionId = grouped
          ? id("session", groupKey)
          : id("session", `${pad(i + 1)}_${cycle + 1}`),
        appointmentId = id("appointment", `${pad(i + 1)}_${cycle + 1}`);
      const hasSession = !["reassignment"].includes(scenario);
      const movId =
        done || ["awaiting_smme", "rejected"].includes(scenario)
          ? id("mov", `${pad(i + 1)}_${cycle + 1}`)
          : null;
      const lifecycle =
        scenario === "cancelled"
          ? "cancelled"
          : scenario === "declined"
          ? "participant-declined"
          : scenario === "reassignment"
          ? "needs-reassignment"
          : done
          ? "completed"
          : scenario === "rejected"
          ? "participant-rejected"
          : scenario === "awaiting_smme"
          ? "awaiting-participant-confirmation"
          : future || missingGroupAttendance
          ? "awaiting-participant-acceptance"
          : "in-delivery";
      const evidence =
        delivered && i % 4 !== 0
          ? [
              {
                link: evidenceAssets()[d].url,
                label: `DEMO sample-${d}.txt`,
                originalName: `DEMO sample-${d}.txt`,
                type: "poe",
                role: "deliverable",
                dataOrigin: "synthetic",
              },
            ]
          : [];
      const assignment = put(
        "assignedInterventions",
        aid,
        {
          participantId: s.id,
          participantName: s.participantName,
          smmeNo: s.smmeNo,
          programId: s.programId,
          branchId: s.branchId,
          departmentId: dept.id,
          areaOfSupport: dept.name,
          interventionId: iv.id,
          interventionTitle: iv.interventionTitle,
          assigneeId: actor.id,
          assigneeName: actor.name,
          assigneeEmail: actor.email,
          assigneeRole: "coordinator",
          assignmentStatus: done
            ? "completed"
            : scenario === "cancelled" || scenario === "declined"
            ? "cancelled"
            : scenario === "reassignment"
            ? "needs-reassignment"
            : future
            ? "assigned"
            : "in-progress",
          assigneeAcceptanceStatus:
            scenario === "reassignment" ? "declined" : "accepted",
          participantAcceptanceStatus:
            scenario === "declined"
              ? "declined"
              : future || missingGroupAttendance
              ? "pending"
              : "accepted",
          assigneeCompletionStatus:
            done || ["awaiting_smme", "rejected"].includes(scenario)
              ? "completed"
              : "pending",
          participantCompletionStatus: done
            ? "confirmed"
            : scenario === "rejected"
            ? "rejected"
            : "pending",
          assigneeAcceptedAt: createdAt,
          participantAcceptedAt:
            future || missingGroupAttendance ? null : add(createdAt, 1),
          assigneeCompletedAt:
            done || ["awaiting_smme", "rejected"].includes(scenario)
              ? end
              : null,
          participantConfirmedAt: done ? confirmedAt : null,
          completedAt: done ? confirmedAt : null,
          participantDeclineReason:
            scenario === "declined"
              ? "Synthetic case: timing unsuitable."
              : null,
          participantCompletionRejectionReason:
            scenario === "rejected"
              ? "Synthetic case: deliverable incomplete."
              : null,
          createdAt,
          assignedAt: createdAt,
          updatedAt: done ? confirmedAt : delivered ? end : createdAt,
          dueDate: add(start, 7),
          schemaVersion: 3,
          hasSubInterventions: false,
          subInterventionId: null,
          subInterventionTitle: null,
          definitionVersion: 1,
          definitionSnapshot: {
            version: 1,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            deliverableName: iv.outcomeDef.deliverable.name,
            outcomeDef: iv.outcomeDef,
            capturedAt: createdAt,
          },
          groupKey,
          type: grouped ? "group" : "singular",
          groupedAt: grouped ? createdAt : null,
          cycleKey: start.toDate().toISOString().slice(0, 7),
          recurrence: iv.recurrence || null,
          scheduleMode: iv.assignmentMode,
          plannedSessions: scenario === "in_delivery" ? 2 : 1,
          tracking: { sessionsLogged: delivered ? 1 : 0 },
          computedProgress:
            done || ["awaiting_smme", "rejected"].includes(scenario)
              ? 100
              : scenario === "in_delivery"
              ? 50
              : 0,
          progressUpdates: delivered
            ? [
                {
                  createdAt: end,
                  by: actor.id,
                  note: "Synthetic session: reviewed records and agreed actions.",
                  resources: [],
                },
              ]
            : [],
          resources: evidence,
          sessionAttendanceByAppointment: delivered
            ? {
                [appointmentId]: {
                  held: true,
                  outcome: "attended",
                  recordedAt: end,
                },
              }
            : missingGroupAttendance
            ? {
                [appointmentId]: {
                  held: true,
                  outcome: "absent",
                  recordedAt: end,
                },
              }
            : {},
          lastAppointmentId: hasSession ? appointmentId : null,
          lastAppointmentAt: hasSession ? start : null,
          movDocumentId: movId,
          reassignmentHistory: [],
          seedHydration: true,
        },
        scenario
      );
      expectations.lifecycle[aid] = lifecycle;
      event(aid, "assigned", createdAt, {
        programId: s.programId,
        participantId: s.id,
      });
      if (delivered)
        event(aid, "delivered", end, {
          programId: s.programId,
          participantId: s.id,
        });
      if (done)
        event(aid, "confirmed", confirmedAt, {
          programId: s.programId,
          participantId: s.id,
        });
      if (hasSession) {
        let session = refs.get(`appointmentSessions/${sessionId}`);
        if (!session)
          session = put(
            "appointmentSessions",
            sessionId,
            {
              schemaVersion: 5,
              programId: s.programId,
              branchId: s.branchId,
              departmentId: dept.id,
              interventionId: iv.id,
              interventionTitle: iv.interventionTitle,
              cycleKey: assignment.cycleKey,
              groupKey,
              sessionType: grouped ? "group" : "individual",
              assigneeId: actor.id,
              assigneeName: actor.name,
              assigneeEmail: actor.email,
              assigneeRole: "coordinator",
              title: `${iv.interventionTitle} session`,
              startAt: start,
              endAt: end,
              deliveryMethod: "in_person",
              location: `[DEMO] ${PROGRAM_BRANCHES[i % 2].name} room`,
              meetingLink: null,
              plannedTopics: [],
              plannedCoverage: [
                "Review records",
                "Agree and practise next steps",
              ],
              status:
                delivered || grouped
                  ? "completed"
                  : scenario === "cancelled" || scenario === "declined"
                  ? "cancelled"
                  : "scheduled",
              coverage: {
                held: delivered || grouped ? true : future ? null : false,
                outcomeSummary:
                  delivered || grouped
                    ? "Synthetic session: operational records reviewed."
                    : null,
                coveredPoints:
                  delivered || grouped
                    ? ["Review records", "Agree next steps"]
                    : [],
                reasonNotHeld:
                  scenario === "cancelled"
                    ? "Cancelled in synthetic scenario"
                    : null,
                recordedAt: delivered || grouped ? end : null,
                recordedById: delivered || grouped ? actor.id : null,
              },
              attendanceSession: null,
              attendanceSummary: {
                invitedCount: 0,
                attendedCount: 0,
                checkedInCount: 0,
                checkedOutCount: 0,
              },
              foodMenu: [],
              createdAt,
              updatedAt: delivered || grouped ? end : createdAt,
              completedAt: delivered || grouped ? end : null,
            },
            scenario
          );
        session.attendanceSummary.invitedCount++;
        if (delivered) {
          session.attendanceSummary.attendedCount++;
          session.attendanceSummary.checkedInCount++;
          session.attendanceSummary.checkedOutCount++;
        }
        put(
          "appointments",
          appointmentId,
          {
            schemaVersion: 5,
            programId: s.programId,
            branchId: s.branchId,
            departmentId: dept.id,
            assignedInterventionId: aid,
            appointmentSessionId: sessionId,
            smeId: s.id,
            smeName: s.participantName,
            smeEmail: s.email,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            subInterventionId: null,
            subInterventionTitle: null,
            cycleKey: assignment.cycleKey,
            assigneeId: actor.id,
            assigneeName: actor.name,
            assigneeEmail: actor.email,
            assigneeRole: "coordinator",
            groupKey,
            status: session.status,
            smeConfirmation:
              scenario === "declined"
                ? "declined"
                : future || missingGroupAttendance
                ? "pending"
                : "confirmed",
            smeDeclineReason: assignment.participantDeclineReason,
            attendance: {
              status: delivered
                ? "attended"
                : missingGroupAttendance
                ? "absent"
                : "expected",
              checkedInAt: delivered ? start : null,
              checkedOutAt: delivered ? end : null,
            },
            foodSelections: [],
            createdAt,
            updatedAt: delivered || grouped ? end : createdAt,
            completedAt: delivered || grouped ? end : null,
          },
          scenario
        );
      }
      if (movId) {
        const status =
          scenario === "in_delivery"
            ? "draft"
            : scenario === "awaiting_smme"
            ? "awaiting_smme"
            : scenario === "awaiting_hod"
            ? "awaiting_hod"
            : scenario === "queried"
            ? "queried"
            : scenario === "rejected"
            ? "rejected"
            : "approved";
        const mov = put(
          "movDocuments",
          movId,
          {
            agreementId: "mov",
            sourceType: "assignedIntervention",
            assignedInterventionId: aid,
            diagnosticPlanId: id("plan", pad(i + 1)),
            programId: s.programId,
            programName: s.programName,
            branchId: s.branchId,
            departmentId: dept.id,
            departmentName: dept.name,
            areaOfSupport: dept.name,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            participantId: s.id,
            smmeId: s.id,
            smmeName: s.participantName,
            smmeCompanyName: s.participantName,
            smmeNo: s.smmeNo,
            facilitatorId: actor.id,
            facilitatorName: actor.name,
            facilitatorEmail: actor.email,
            facilitatorSignatureUrl: "",
            smmeSignatureUrl: "",
            syntheticApprovalNote:
              "Fixture approvals only; no authentic signatures.",
            status,
            createdAt: end,
            updatedAt: done ? add(confirmedAt, 1) : end,
            completedAt: end,
            interventionDate: start,
            periodStart: createdAt,
            periodEnd: end,
            smmeAccepted: done,
            smmeSignedAt: done ? confirmedAt : null,
            approvedByHod: status === "approved",
            hodApprovedAt: status === "approved" ? add(confirmedAt, 1) : null,
            approvedByUid: status === "approved" ? id("hod", d) : null,
            resources: [],
            progressUpdates: assignment.progressUpdates,
            appointmentInterventions: [
              {
                title: iv.interventionTitle,
                date: start,
                deliveryMethod: "in-person",
                signature: "",
              },
            ],
          },
          scenario
        );
        expectations.movStages[movId] =
          status === "approved" ? "hod_approved" : status;
        mov.resources = evidence;
        if (status === "draft") mov.completedAt = null;
        if (status === "approved" && i % 5 !== 0) {
          const month = start.toDate().toISOString().slice(0, 7),
            key = `${s.programId}_${d}_${month}`;
          if (!packGroups.has(key))
            packGroups.set(key, {
              key,
              month,
              department: dept,
              programId: s.programId,
              movs: [],
            });
          packGroups.get(key).movs.push(mov);
        }
      }
      if (done) {
        const followId = aid,
          dueAt = add(confirmedAt, 30),
          unknown = scenario === "unanswered" || scenario === "followup_future";
        const answer =
          scenario === "partial"
            ? "partial"
            : scenario === "not_yet" || scenario === "delayed"
            ? "not_yet"
            : "achieved";
        const smeAnswer =
          scenario === "disputed"
            ? "no"
            : answer === "achieved"
            ? "yes"
            : answer === "partial"
            ? "partly"
            : "no";
        const answeredAt = add(dueAt, 2),
          note = `Synthetic ${scenario} observation; not a real business outcome.`;
        const f = put(
          "outcomeFollowUps",
          followId,
          {
            assignedInterventionId: aid,
            participantId: s.id,
            participantName: s.participantName,
            participantEmail: s.email,
            programId: s.programId,
            departmentId: dept.id,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            assigneeId: actor.id,
            assigneeName: actor.name,
            assigneeEmail: actor.email,
            deliverableName: iv.outcomeDef.deliverable.name,
            intendedOutcome: iv.outcomeDef.intendedOutcome,
            outcomeType: "process_implemented",
            afterDays: 30,
            dueAt,
            smeCheckIn: true,
            status: unknown
              ? dueAt.toMillis() > Date.parse(REF)
                ? "scheduled"
                : "due"
              : "answered",
            remindersSent: scenario === "unanswered" ? 2 : 0,
            lastRemindedAt: scenario === "unanswered" ? add(dueAt, 3) : null,
            smeNotified: false,
            createdAt: confirmedAt,
            ...(!unknown
              ? {
                  answer,
                  answerNote: note,
                  answeredAt,
                  answeredBy: actor.id,
                  answeredVia: "synthetic_seed",
                  smeAnswer,
                  smeAnsweredAt: answeredAt,
                }
              : {}),
          },
          scenario
        );
        expectations.outcomeCases[aid] = scenario;
        if (!unknown) {
          const assessment = (suffix, at, value, role) =>
            put(
              "outcomeAssessments",
              id("assessment", `${aid}_${suffix}`),
              {
                followUpId: followId,
                assignedInterventionId: aid,
                participantId: s.id,
                participantName: s.participantName,
                interventionId: iv.id,
                interventionTitle: iv.interventionTitle,
                programId: s.programId,
                departmentId: dept.id,
                kind: "follow_up",
                at,
                assessment: value,
                note,
                by: role === "sme" ? s.id : actor.id,
                byRole: role,
                via: "synthetic_seed",
                confidence:
                  role === "sme" ? "self_reported" : "facilitator_verified",
                evidence: [],
              },
              scenario
            );
          assessment("facilitator", answeredAt, answer, "facilitator");
          assessment(
            "sme",
            answeredAt,
            smeAnswer === "yes"
              ? "achieved"
              : smeAnswer === "partly"
              ? "partial"
              : "not_yet",
            "sme"
          );
          assignment.outcome = {
            status: answer,
            confidence: "facilitator_verified",
            lastAssessedAt: answeredAt,
            smeStatus:
              smeAnswer === "yes"
                ? "achieved"
                : smeAnswer === "partly"
                ? "partial"
                : "not_yet",
            smeAssessedAt: answeredAt,
          };
          assignment.updatedAt = answeredAt;
          if (["delayed", "sustained", "reversal"].includes(scenario)) {
            const later = add(answeredAt, 14),
              next = scenario === "reversal" ? "not_yet" : "achieved";
            assessment("later_facilitator", later, next, "facilitator");
            assignment.outcome.status = next;
            assignment.outcome.lastAssessedAt = later;
            assignment.updatedAt = later;
          }
        }
      }
      if (["queried", "rejected", "reassignment"].includes(scenario))
        put(
          "workflowQueries",
          id("query", aid),
          {
            schemaVersion: 2,
            programId: s.programId,
            type:
              scenario === "rejected"
                ? "completion-rejected"
                : "delivery-query",
            message: `Synthetic ${scenario}: review required.`,
            status: "open",
            raisedById: s.id,
            raisedBy: {
              name: s.participantName,
              email: s.email,
              role: "incubatee",
            },
            resolverId: actor.id,
            resolver: {
              name: actor.name,
              email: actor.email,
              role: "coordinator",
              departmentId: dept.id,
            },
            assignedAt: end,
            target: {
              type: scenario === "queried" ? "mov" : "assigned-intervention",
              id: scenario === "queried" ? movId : aid,
            },
            context: {
              participantId: s.id,
              interventionId: iv.id,
              interventionTitle: iv.interventionTitle,
              departmentName: dept.name,
              ...(movId ? { movId } : {}),
            },
            createdAt: end,
            updatedAt: end,
          },
          scenario
        );
      const entry = {
        assignedInterventionId: aid,
        interventionId: iv.id,
        title: iv.interventionTitle,
        areaOfSupport: dept.name,
        dueDate: assignment.dueDate,
      };
      const app = refs.get(`applications/${s.applicationId}`);
      if (
        assignment.participantAcceptanceStatus === "accepted" &&
        assignment.assigneeAcceptanceStatus === "accepted"
      ) {
        s.interventions.assigned.push({
          ...entry,
          status: "assigned",
          acceptedAt: assignment.participantAcceptedAt,
        });
        app.interventions.assigned.push({
          ...entry,
          status: "assigned",
          acceptedAt: assignment.participantAcceptedAt,
        });
      }
      if (done) {
        s.interventions.completed.push({
          ...entry,
          status: "completed",
          completedAt: confirmedAt,
        });
        app.interventions.completed.push({
          ...entry,
          status: "completed",
          completedAt: confirmedAt,
        });
      }
    }
  let packIndex = 0;
  for (const group of packGroups.values()) {
    const statuses = [
        "awaiting_cc",
        "awaiting_me",
        "validated",
        "invoice_redeemable",
      ],
      status = statuses[packIndex++ % 4];
    const createdAt = Timestamp.fromMillis(
      Math.max(...group.movs.map((m) => m.hodApprovedAt.toMillis())) + DAY
    );
    const approvals = [
      {
        step: "hod_submission",
        date: createdAt,
        by: id("hod", DEPARTMENTS.indexOf(group.department)),
        name: "[DEMO] HOD",
        signatureUrl: "",
      },
    ];
    if (status !== "awaiting_cc")
      approvals.push({
        step: "final_confirmation",
        date: add(createdAt, 1),
        by: id("cc", 0),
        name: "[DEMO] Centre Coordinator",
        signatureUrl: "",
      });
    const pid = id("pack", group.key);
    put(
      "consolidatedMOVs",
      pid,
      {
        programId: group.programId,
        departmentId: group.department.id,
        department: group.department.name,
        month: group.month,
        range: {
          from: stamp(`${group.month}-01T00:00:00Z`),
          to: stamp(
            new Date(
              Date.UTC(
                Number(group.month.slice(0, 4)),
                Number(group.month.slice(5, 7)),
                0,
                23,
                59,
                59
              )
            ).toISOString()
          ),
        },
        interventions: group.movs.map((m) => ({ ...m })),
        totalItems: group.movs.length,
        approvals,
        status,
        createdAt,
        updatedAt: add(createdAt, 2),
        hodUid: approvals[0].by,
        hodName: approvals[0].name,
        hodSignatureUrl: "",
        invoiceAttachment: null,
        syntheticApprovalNote:
          "Generated approval states; no genuine signature or invoice.",
        ...(status === "invoice_redeemable"
          ? { invoiceRedeemableAt: add(createdAt, 3) }
          : {}),
      },
      `pack_${status}`
    );
    for (const mov of group.movs) {
      mov.consolidatedMovId = pid;
      if (["validated", "invoice_redeemable"].includes(status)) {
        mov.monitoringApproved = true;
        mov.monitoringApprovedAt = add(createdAt, 2);
        mov.monitoringValidation = {
          status: "validated",
          validatedAt: add(createdAt, 2),
          validatedBy: id("me", 0),
        };
      }
      expectations.movStages[mov.id] = {
        awaiting_cc: "in_pack",
        awaiting_me: "cc_confirmed",
        validated: "me_validated",
        invoice_redeemable: "invoice_redeemable",
      }[status];
    }
  }
  for (const row of records.filter((r) =>
    r.path.startsWith("outcomeAssessments/")
  )) {
    const a = refs.get(
      `assignedInterventions/${row.data.assignedInterventionId}`
    );
    if (row.data.byRole !== "sme" && a.resources.length) {
      row.data.confidence = "artefact_supported";
      row.data.evidence = [
        {
          sourceType: "deliverable",
          sourceRef: { collection: "assignedInterventions", id: a.id },
        },
      ];
      a.outcome.confidence = "artefact_supported";
    }
  }
  for (const session of records
    .filter((r) => r.path.startsWith("appointmentSessions/") && r.data.groupKey)
    .map((r) => r.data)) {
    const members = records
      .filter(
        (r) =>
          r.path.startsWith("assignedInterventions/") &&
          r.data.groupKey === session.groupKey
      )
      .map((r) => r.data);
    put(
      "groupInterventionDeliveries",
      session.groupKey,
      {
        schemaVersion: 1,
        groupKey: session.groupKey,
        programId: session.programId,
        departmentId: session.departmentId,
        interventionId: session.interventionId,
        interventionTitle: session.interventionTitle,
        assigneeId: session.assigneeId,
        assigneeName: session.assigneeName,
        assigneeEmail: session.assigneeEmail,
        progress: 100,
        deliveryStatus: "completed",
        evidence: members.find((a) => a.resources.length)?.resources || [],
        progressUpdates:
          members.find((a) => a.progressUpdates.length)?.progressUpdates || [],
        sourceAssignmentIds: members.map((a) => a.id),
        sessionsCompleted: 1,
        plannedSessions: 1,
        latestCoverage: session.coverage,
        coverageHistory: [session.coverage],
        createdAt: session.createdAt,
        updatedAt: session.endAt,
        completedAt: session.endAt,
      },
      "shared_delivery_mixed_attendance"
    );
  }
  for (let d = 0; d < 4; d++)
    put(
      "twinCapacityCalendars",
      id("capacity", d),
      {
        departmentId: DEPARTMENTS[d].id,
        assigneeId: actors[d].id,
        programIds: [id("program", 0), id("program", 1)],
        timezone: "Africa/Johannesburg",
        effectiveFrom: offset(-365),
        effectiveTo: offset(180),
        weeklyAvailableHours: [16, 12, 20, 18][d],
        workingDays: [1, 2, 3, 4, 5],
        reviewWindowsPerWeek: 2,
        serviceMinutes: 60,
        groupCapacity: 10,
        leave: [{ from: offset(14), to: offset(18) }],
        currency: "ZAR",
        hourlyCost: 350,
        assumptionSource: "synthetic_configuration",
      },
      "capacity_assumptions"
    );
  for (const s of records.filter(
    (r) => r.path.startsWith("appointmentSessions/") && r.data.groupKey
  ))
    expectations.groups.push({
      id: s.data.id,
      invited: s.data.attendanceSummary.invitedCount,
      attended: s.data.attendanceSummary.attendedCount,
    });
  const counts = {};
  for (const r of records)
    counts[r.path.split("/")[0]] = (counts[r.path.split("/")[0]] || 0) + 1;
  return {
    seedRunId: RUN,
    generatorVersion: VERSION,
    referenceDate: REF,
    projectId: "lepharo-smart-inc",
    counts,
    records,
    expectations,
  };
}
module.exports = {
  generate,
  encode,
  decode,
  hash,
  meta,
  evidenceAssets,
  BUCKET,
  RUN,
  VERSION,
  REF,
  DEPARTMENTS,
  BRANCHES,
  PROGRAM_BRANCHES,
  CASES,
};
