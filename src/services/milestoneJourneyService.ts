import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { departmentNameOf, loadDepartmentRoles } from "@/services/departmentRoles";
import {
  formatDeliveryMethod,
  getAppointmentGroupKey,
  getAttendanceStatus,
} from "@/services/appointmentService";

export type JourneyScope = "sme" | "operations";

export type JourneyMonth = {
  key: string;
  label: string;
  appointments: number;
  attendedAppointments: number;
  completedInterventions: number;
  roadmapConfirmations: number;
  participantIds: string[];
  /** The SMEs behind participantIds, by name, for the "SMEs helped" page. */
  participants: { id: string; name: string }[];
  feedback: JourneyFeedback[];
  topics: string[];
  activities: JourneyActivity[];
};

export type JourneyFeedback = {
  id: string;
  message: string;
  smeName?: string;
  rating?: number;
};

export type JourneyActivity = {
  id: string;
  kind: "appointment" | "intervention" | "roadmap";
  title: string;
  department?: string;
  detail?: string;
  detailLabel?: string;
  participantIds?: string[];
  /** Appointments only: how it was delivered, e.g. "In Person" or "Virtual". */
  delivery?: string;
  /** Appointments only: how many SMEs were invited and how many attended. */
  invited?: number;
  attended?: number;
};

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (date: Date) =>
  date.toLocaleDateString("en-ZA", { month: "short", year: "numeric" });

const coveredTopicsFor = (item: any) => {
  const latest = item?.sessionCoverage?.latest;
  const values = [
    ...(Array.isArray(latest?.coveredPoints) ? latest.coveredPoints : []),
    ...(latest?.held === true && latest?.notes ? [latest.notes] : []),
  ];
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
};

const subInterventionFor = (item: any) =>
  [
    item?.subInterventionTitle,
    item?.subInterventionName,
    item?.subIntervention,
    item?.assignedIntervention?.subInterventionTitle,
    item?.assignment?.subInterventionTitle,
    item?.sourceAssignment?.subInterventionTitle,
    item?.snapshot?.selectedSubIntervention?.title,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || undefined;

const isCompleted = (item: any) =>
  [
    item?.assignmentStatus,
    item?.status,
    item?.participantCompletionStatus,
  ].some((status) =>
    ["completed", "confirmed"].includes(String(status || "").toLowerCase())
  );

const addMonth = (
  months: Map<string, JourneyMonth>,
  date: Date,
  update: Partial<JourneyMonth> & {
    topics?: string[];
    activities?: JourneyActivity[];
  }
) => {
  const key = monthKey(date);
  const current = months.get(key) || {
    key,
    label: monthLabel(date),
    appointments: 0,
    attendedAppointments: 0,
    completedInterventions: 0,
    roadmapConfirmations: 0,
    participantIds: [],
    participants: [],
    feedback: [],
    topics: [],
    activities: [],
  };
  current.appointments += update.appointments || 0;
  current.attendedAppointments += update.attendedAppointments || 0;
  current.completedInterventions += update.completedInterventions || 0;
  current.roadmapConfirmations += update.roadmapConfirmations || 0;
  current.participantIds = Array.from(
    new Set([...current.participantIds, ...(update.participantIds || [])])
  );
  (update.participants || []).forEach((participant) => {
    if (!current.participants.some((item) => item.id === participant.id))
      current.participants.push(participant);
  });
  current.feedback = [...current.feedback, ...(update.feedback || [])];
  current.topics = Array.from(
    new Set([...current.topics, ...(update.topics || [])])
  );
  current.activities = [...current.activities, ...(update.activities || [])];
  months.set(key, current);
};

export async function loadMilestoneJourney(args: {
  scope: JourneyScope;
  email?: string | null;
  participantId?: string | null;
  departmentId?: string | null;
  departmentIds?: string[];
  programId?: string | null;
}): Promise<JourneyMonth[]> {
  const months = new Map<string, JourneyMonth>();
  const { departments } = await loadDepartmentRoles();
  const departmentLabel = (data: any) =>
    departmentNameOf(String(data?.departmentId || "").trim(), departments, "") || undefined;

  if (args.scope === "sme") {
    const email = String(args.email || "").trim();
    if (!email) return [];
    const suppliedParticipantId = String(args.participantId || "").trim();
    const emailCandidates = Array.from(new Set([email, email.toLowerCase()]));
    const participantSnapshots = await Promise.all(
      emailCandidates.map((candidate) =>
        getDocs(
          query(collection(db, "participants"), where("email", "==", candidate))
        )
      )
    );
    const matchedParticipant = participantSnapshots.find(
      (snapshot) => !snapshot.empty
    )?.docs[0];
    const participantId = suppliedParticipantId || matchedParticipant?.id;
    if (!participantId) return [];

    const [appointmentsSnapshot, interventionsSnapshot, plansSnapshot] =
      await Promise.all([
        getDocs(
          query(
            collection(db, "appointments"),
            where("smeId", "==", participantId)
          )
        ),
        getDocs(
          query(
            collection(db, "assignedInterventions"),
            where("participantId", "==", participantId)
          )
        ),
        getDocs(
          query(
            collection(db, "diagnosticPlans"),
            where("participantId", "==", participantId)
          )
        ),
      ]);

    const sessionEntries = await Promise.all(
      appointmentsSnapshot.docs.map(async (item) => {
        const appointment = item.data() as any;
        const sessionId = String(appointment?.appointmentSessionId || "").trim();
        if (!sessionId) return [item.id, null] as const;
        const session = await getDoc(doc(db, "appointmentSessions", sessionId));
        return [item.id, session.exists() ? (session.data() as any) : null] as const;
      })
    );
    const sessionsByAppointmentId = new Map(sessionEntries);

    appointmentsSnapshot.docs.forEach((item) => {
      const appointment = item.data() as any;
      const session = sessionsByAppointmentId.get(item.id);
      const coverage = session?.coverage;
      const data = {
        ...appointment,
        date: session?.startAt || appointment?.createdAt,
        startTime: session?.startAt,
        sessionTitle: session?.title || appointment?.sessionTitle,
        sessionCoverage: coverage
          ? {
              latest: {
                held: coverage.held,
                coveredPoints: coverage.coveredPoints,
                notes: coverage.outcomeSummary,
              },
            }
          : undefined,
      };
      if (String(data?.status || "").toLowerCase() === "cancelled") return;
      const attended =
        String(data?.attendance?.status || "").toLowerCase() === "attended";
      if (!attended) return;
      const date = toDate(data?.date || data?.startTime || data?.createdAt);
      if (date)
        addMonth(months, date, {
          appointments: 1,
          attendedAppointments: 1,
          topics: coveredTopicsFor(data),
          activities: [
            {
              id: `appointment-${item.id}`,
              kind: "appointment",
              title: String(
                data?.sessionTitle ||
                  data?.interventionTitle ||
                  data?.title ||
                  "Support appointment"
              ),
              department:
                String(data?.departmentName || data?.department || "").trim() ||
                undefined,
              detail: coveredTopicsFor(data).join(", ") || undefined,
              detailLabel: "Covered",
            },
          ],
        });
    });
    interventionsSnapshot.docs.forEach((item) => {
      const data = item.data() as any;
      if (!isCompleted(data)) return;
      const completedDate = toDate(
        data?.completedAt || data?.updatedAt || data?.createdAt
      );
      if (completedDate)
        addMonth(months, completedDate, {
          completedInterventions: 1,
          activities: [
            {
              id: `intervention-${item.id}`,
              kind: "intervention",
              title: String(
                data?.interventionTitle ||
                  data?.title ||
                  "Intervention completed"
              ),
              department: departmentLabel(data),
              detail: subInterventionFor(data),
              detailLabel: "Sub-intervention",
            },
          ],
        });
    });
    plansSnapshot.docs.forEach((item) => {
      const plan = item.data() as any;
      const confirmations =
        plan?.incubateeDepartmentConfirmationsByDeptId ||
        plan?.incubateeDepartmentConfirmations ||
        {};
      Object.values(confirmations).forEach((confirmation: any) => {
        if (!(confirmation?.confirmed === true || confirmation === true))
          return;
        const date = toDate(confirmation?.confirmedAt);
        if (date)
          addMonth(months, date, {
            roadmapConfirmations: 1,
            activities: [
              {
                id: `roadmap-${item.id}-${String(
                  confirmation?.confirmedAt || ""
                )}`,
                kind: "roadmap",
                title: "Roadmap area confirmed",
              },
            ],
          });
      });
    });
  } else {
    const departmentIds = Array.from(
      new Set(
        [args.departmentId, ...(args.departmentIds || [])]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    if (!departmentIds.length) return [];
    const programId = String(args.programId || "").trim();
    const appointmentConstraints = [] as ReturnType<typeof where>[];
    const interventionConstraints = [] as ReturnType<typeof where>[];
    if (programId) {
      appointmentConstraints.push(where("programId", "==", programId));
      interventionConstraints.push(where("programId", "==", programId));
    }
    const [appointmentsSnapshot, interventionsSnapshot] = await Promise.all([
      getDocs(query(collection(db, "appointments"), ...appointmentConstraints)),
      getDocs(
        query(
          collection(db, "assignedInterventions"),
          ...interventionConstraints
        )
      ),
    ]);
    const assignmentDepartmentById = new Map<string, string>();
    const departmentAssignments = interventionsSnapshot.docs.filter((item) => {
      const data = item.data() as any;
      const assignmentDepartmentId = String(data?.departmentId || "").trim();
      if (assignmentDepartmentId) {
        assignmentDepartmentById.set(item.id, assignmentDepartmentId);
      }
      return departmentIds.includes(assignmentDepartmentId);
    });
    const departmentAppointments = appointmentsSnapshot.docs.filter((item) => {
      const data = item.data() as any;
      const assignedDepartmentId = String(
        assignmentDepartmentById.get(
          String(data?.assignedInterventionId || "")
        ) ||
          data?.departmentId ||
          ""
      ).trim();
      return departmentIds.includes(assignedDepartmentId);
    });
    // The appointments workspace displays one grouped session, not one record
    // per participating SME. Use the same session identity here so its totals
    // match the appointments metrics.
    const appointmentGroups = new Map<
      string,
      {
        id: string;
        data: any;
        participantIds: Set<string>;
        names: Map<string, string>;
        invited: Set<string>;
        attended: Set<string>;
      }
    >();
    departmentAppointments.forEach((item) => {
      const data = item.data() as any;
      if (String(data?.status || "").toLowerCase() === "cancelled") return;
      const groupKey = getAppointmentGroupKey({ ...data, id: item.id });
      const isGroup = Boolean(data?.isGroupAppointment && groupKey);
      const key = isGroup ? `group-${groupKey}` : `single-${item.id}`;
      const participantId = String(
        data?.participantId || data?.beneficiaryId || ""
      ).trim();
      const current = appointmentGroups.get(key) || {
        id: item.id,
        data,
        participantIds: new Set<string>(),
        names: new Map<string, string>(),
        invited: new Set<string>(),
        attended: new Set<string>(),
      };
      // Each record is one SME's invitation to the session.
      const inviteeKey = participantId || item.id;
      current.invited.add(inviteeKey);
      const attendance = getAttendanceStatus(data, data);
      if (attendance === "checked-in" || attendance === "checked-out")
        current.attended.add(inviteeKey);
      if (participantId) {
        current.participantIds.add(participantId);
        const name = String(
          data?.participantName ||
            data?.beneficiaryName ||
            data?.companyName ||
            data?.smeName ||
            ""
        ).trim();
        if (name) current.names.set(participantId, name);
      }
      appointmentGroups.set(key, current);
    });
    appointmentGroups.forEach(({ id, data, participantIds, names, invited, attended }) => {
      const date = toDate(data?.date || data?.startTime || data?.createdAt);
      if (date)
        addMonth(months, date, {
          appointments: 1,
          participantIds: Array.from(participantIds),
          participants: Array.from(participantIds).map((participantId) => ({
            id: participantId,
            name: names.get(participantId) || "",
          })),
          topics: coveredTopicsFor(data),
          activities: [
            {
              id: `appointment-${id}`,
              kind: "appointment",
              title: String(
                data?.sessionTitle ||
                  data?.interventionTitle ||
                  data?.title ||
                  "Support appointment"
              ),
              department:
                String(data?.departmentName || data?.department || "").trim() ||
                undefined,
              detail: coveredTopicsFor(data).join(", ") || undefined,
              detailLabel: "Covered",
              participantIds: Array.from(participantIds),
              delivery: formatDeliveryMethod(data) === "-" ? undefined : formatDeliveryMethod(data),
              invited: invited.size,
              attended: attended.size,
            },
          ],
        });
    });
    departmentAssignments.forEach((item) => {
      const data = item.data() as any;
      if (!isCompleted(data)) return;
      const completedDate = toDate(
        data?.completedAt || data?.updatedAt || data?.createdAt
      );
      if (completedDate)
        addMonth(months, completedDate, {
          completedInterventions: 1,
          participantIds: [
            String(data?.participantId || data?.beneficiaryId || "").trim(),
          ].filter(Boolean),
          participants: [
            {
              id: String(data?.participantId || data?.beneficiaryId || "").trim(),
              name: String(
                data?.participantName ||
                  data?.beneficiaryName ||
                  data?.companyName ||
                  data?.businessName ||
                  ""
              ).trim(),
            },
          ].filter((participant) => participant.id),
          feedback: String(data?.feedback?.comments || "").trim()
            ? [
                {
                  id: item.id,
                  message: String(data.feedback.comments).trim(),
                  smeName:
                    String(
                      data?.participantName || data?.beneficiaryName || ""
                    ).trim() || undefined,
                  rating:
                    typeof data?.feedback?.rating === "number"
                      ? data.feedback.rating
                      : undefined,
                },
              ]
            : [],
          activities: [
            {
              id: `intervention-${item.id}`,
              kind: "intervention",
              title: String(
                data?.interventionTitle ||
                  data?.title ||
                  "Intervention completed"
              ),
              department: departmentLabel(data),
              detail: subInterventionFor(data),
              detailLabel: "Sub-intervention",
              participantIds: [
                String(data?.participantId || data?.beneficiaryId || "").trim(),
              ].filter(Boolean),
            },
          ],
        });
    });
  }

  return Array.from(months.values()).sort((left, right) =>
    left.key.localeCompare(right.key)
  );
}
