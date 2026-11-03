import { admin, db } from "./firebase";
import { candidatePhoneValues, clean, normalizePhone } from "./whatsappCommon";
import { isDepartmentInRole } from "./departmentRoles";
import { participantComplianceRecords, requirementStates } from "./complianceExpiry";

/**
 * Staff side of the Lepharo WhatsApp gateway. The ai-backend decides what a staff
 * member is asking for; this module is the authority that checks the sender's role,
 * validates every value, and is the only place that reads or writes Firestore.
 * Writes are two-phase: propose_action stores a validated proposal, and nothing is
 * written until the same user confirms it with confirm_proposal.
 */

export type StaffIdentity = {
  kind: "staff";
  id: string;
  uid: string | null;
  name: string;
  role: string;
  roleGroup: RoleGroup;
  email: string | null;
  phoneNumber: string;
  departmentId: string | null;
  branchId: string | null;
  /** users.assignedPrograms (or the older assignedProgramId): a coordinator's programmes. */
  assignedProgramIds?: string[];
  /** Where the request came from; recorded as createdVia. Defaults to WhatsApp. */
  channel?: "whatsapp" | "web";
};

export type RoleGroup =
  | "system_admin"
  | "director"
  | "hod"
  | "coordinator"
  | "receptionist"
  | "employee"
  | "external"
  | "unknown";

export type GatewayResult = { status: number; body: Record<string, unknown> };

const roleKey = (role: unknown) => clean(role).toLowerCase().replace(/[\s_-]/g, "");

export const roleGroupOf = (role: unknown): RoleGroup => {
  const key = roleKey(role);
  if (key === "systemadmin") return "system_admin";
  if (key === "director") return "director";
  if (["operations", "headofdepartment", "headsofdepartment"].includes(key)) return "hod";
  if (["projectadmin", "coordinator"].includes(key)) return "coordinator";
  if (key === "receptionist") return "receptionist";
  if (["employee", "consultant", "projectmanager", "auxiliary"].includes(key)) return "employee";
  if (["funder", "government"].includes(key)) return "external";
  return "unknown";
};

const TIME_ZONE = "Africa/Johannesburg";
// South Africa and Zimbabwe do not observe daylight saving, so the offset is fixed.
const TZ_OFFSET = "+02:00";

export class UserError extends Error {
  constructor(message: string, readonly code = "invalid_request") {
    super(message);
  }
}

const ok = (body: Record<string, unknown>): GatewayResult => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): GatewayResult => ({
  status,
  body: { ok: false, error, ...extra },
});

export const sastParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

const todaySast = () => sastParts(new Date()).date;

const validDate = (value: unknown): string | null => {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text;
};

const validTime = (value: unknown): string | null => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(clean(value));
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
};

const shortText = (value: unknown, max: number) => clean(value).replace(/\s+/g, " ").slice(0, max);

const formatWhen = (date: Date | null) => {
  if (!date) return null;
  const { date: day, time } = sastParts(date);
  return `${day} ${time}`;
};

/* ------------------------------------------------------------------ identity */

export async function resolveStaffByPhone(phoneNumber: string): Promise<StaffIdentity | null> {
  const digits = normalizePhone(phoneNumber);
  if (digits.length < 8) return null;

  const matches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const candidate of candidatePhoneValues(digits)) {
    for (const field of ["phone", "phoneNumber"]) {
      const snapshot = await db.collection("users").where(field, "==", candidate).limit(3).get();
      snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
    }
  }

  let rows: FirebaseFirestore.DocumentSnapshot[] = Array.from(matches.values());
  if (rows.length !== 1) {
    // Read only the phone fields; whole user documents overflow the function's memory.
    const suffix = digits.slice(-9);
    const snapshot = await db.collection("users").select("phone", "phoneNumber").limit(2000).get();
    const ids = snapshot.docs
      .filter((doc) => {
        const data = doc.data() || {};
        return [data.phone, data.phoneNumber].some((stored) => {
          const normalized = normalizePhone(stored);
          return suffix.length >= 8 && normalized.length >= 8 && normalized.slice(-9) === suffix;
        });
      })
      .map((doc) => doc.id);
    rows = ids.length === 1 ? [await db.collection("users").doc(ids[0]).get()] : [];
  }
  if (rows.length !== 1) return null;

  return staffIdentityFromUser(rows[0].id, rows[0].data() || {}, phoneNumber);
}

/** A staff member as the WhatsApp assistant sees them, from their users document. */
export function staffIdentityFromUser(id: string, data: FirebaseFirestore.DocumentData, phoneNumber = ""): StaffIdentity {
  const role = clean(data.role);
  return {
    kind: "staff",
    id,
    uid: clean(data.uid) || null,
    name: clean(data.name) || clean(data.displayName) || clean(data.email) || "there",
    role,
    roleGroup: roleGroupOf(role),
    email: clean(data.email) || null,
    phoneNumber: clean(data.phone || data.phoneNumber) || phoneNumber,
    departmentId: clean(data.departmentId) || null,
    branchId: clean(data.assignedBranch || data.branchId) || null,
    assignedProgramIds: idList(Array.isArray(data.assignedPrograms) ? data.assignedPrograms : [data.assignedProgramId]),
  };
}

// Program references are stored as ids, numbers or { id } objects.
const idList = (values: unknown[]) =>
  values.map((value: any) => clean(typeof value === "object" && value ? value.id : value)).filter(Boolean);

export const ownerIds = (identity: StaffIdentity) => Array.from(new Set([identity.id, identity.uid || ""].filter(Boolean)));
const isOwnedBy = (identity: StaffIdentity, assigneeId: unknown) => ownerIds(identity).includes(clean(assigneeId));

/* --------------------------------------------------------------- programmes */

// The programmes a staff member works in, mirroring the web app's programme switcher
// (src/components/layout/index.tsx): coordinators get their assigned programmes, project
// admins and receptionists their branch's, operations the programmes their department takes
// part in (or that list no departments), everyone else every active programme.
// Trainings are not offered on WhatsApp.
type ProgrammeOption = { id: string; name: string };

const ALL_PROGRAMMES = "all";
const ALL_PROGRAMMES_LABEL = "All programmes";
const canSeeAllProgrammes = (identity: StaffIdentity) => ["system_admin", "director", "hod"].includes(identity.roleGroup);

const programBranchId = (data: any) =>
  clean(data.normalizedAssignedBranchId) || clean(data.branchId) ||
  clean(typeof data.assignedBranch === "object" && data.assignedBranch ? data.assignedBranch.id : data.assignedBranch);

async function programmesFor(identity: StaffIdentity): Promise<ProgrammeOption[]> {
  const key = roleKey(identity.role);
  let docs = (await db.collection("programs").get()).docs
    .filter((doc) => doc.data().isActive !== false && clean(doc.data().kind) !== "training");
  if (key === "projectadmin" || key === "receptionist") {
    docs = identity.branchId ? docs.filter((doc) => programBranchId(doc.data()) === identity.branchId) : [];
  } else if (key === "coordinator") {
    docs = docs.filter((doc) => (identity.assignedProgramIds || []).includes(doc.id));
  } else if (identity.roleGroup === "hod" && identity.departmentId) {
    docs = docs.filter((doc) => {
      const ids = doc.data().participatingDepartmentIds;
      return !Array.isArray(ids) || ids.length === 0 || ids.includes(identity.departmentId);
    });
  }
  return docs
    .map((doc) => ({ id: doc.id, name: clean(doc.data().name) || clean(doc.data().title) || "Programme" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type ProgrammeContext = {
  options: ProgrammeOption[];
  allowAll: boolean;
  /** The programme being looked at; null with allowAll means all of them. */
  selected: ProgrammeOption | null;
  /** Ask which programme before answering: there is a choice and none was made today. */
  needsChoice: boolean;
};

async function programmeContext(identity: StaffIdentity): Promise<ProgrammeContext> {
  const [options, state] = await Promise.all([
    programmesFor(identity),
    db.collection("whatsappAgentState").doc(identity.id).get(),
  ]);
  const allowAll = canSeeAllProgrammes(identity);
  if (options.length <= 1) return { options, allowAll, selected: options[0] || null, needsChoice: false };

  const data = state.data() || {};
  const stored = clean(data.programId);
  const selected = options.find((option) => option.id === stored) || null;
  const valid = !!selected || (stored === ALL_PROGRAMMES && allowAll);
  return { options, allowAll, selected, needsChoice: !valid || clean(data.programChosenOn) !== todaySast() };
}

type ProgrammeFilter = { ids: Set<string> | null; label: string | null };

/** Programme ids a read is limited to (null: no limit) and the name to show with the result. */
async function programmeFilter(identity: StaffIdentity): Promise<ProgrammeFilter> {
  const { options, allowAll, selected } = await programmeContext(identity);
  if (selected) return { ids: new Set([selected.id]), label: selected.name };
  // No programmes configured for this person: keep the reads as they were rather than empty them.
  if (!options.length) return { ids: null, label: null };
  if (allowAll) return { ids: null, label: ALL_PROGRAMMES_LABEL };
  return { ids: new Set(options.map((option) => option.id)), label: null };
}

const inProgramme = (filter: ProgrammeFilter, programId: unknown) => !filter.ids || filter.ids.has(clean(programId));

/** SMEs with an accepted application to one of the programmes. */
async function acceptedParticipantIds(programIds: Set<string>): Promise<Set<string>> {
  const ids = Array.from(programIds);
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 30) {
    const snapshot = await db.collection("applications")
      .where("programId", "in", ids.slice(i, i + 30))
      .select("participantId", "applicationStatus")
      .get();
    snapshot.docs
      .filter((doc) => clean(doc.data().applicationStatus).toLowerCase() === "accepted")
      .forEach((doc) => found.add(clean(doc.data().participantId)));
  }
  found.delete("");
  return found;
}

async function listProgrammes(identity: StaffIdentity): Promise<GatewayResult> {
  if (identity.roleGroup === "external" || identity.roleGroup === "unknown") return fail(403, "not_permitted");
  const { options, allowAll, selected, needsChoice } = await programmeContext(identity);
  const current = selected || (allowAll && options.length > 1 && !needsChoice ? { id: ALL_PROGRAMMES, name: ALL_PROGRAMMES_LABEL } : null);
  return ok({ programmes: options, allowAll: allowAll && options.length > 1, current, needsChoice });
}

async function selectProgramme(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  if (identity.roleGroup === "external" || identity.roleGroup === "unknown") return fail(403, "not_permitted");
  const programId = clean(payload.programId);
  const { options, allowAll } = await programmeContext(identity);
  const chosen = programId === ALL_PROGRAMMES && allowAll
    ? { id: ALL_PROGRAMMES, name: ALL_PROGRAMMES_LABEL }
    : options.find((option) => option.id === programId);
  if (!chosen) return fail(400, "programme_not_available");
  await db.collection("whatsappAgentState").doc(identity.id).set({
    programId: chosen.id,
    programChosenOn: todaySast(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return ok({ current: chosen });
}

/* -------------------------------------------------------------------- reads */

const tally = (values: string[]) => {
  const counts: Record<string, number> = {};
  values.forEach((value) => {
    const key = value || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
};

// Who a staff member's interventions and sessions cover. A head of department sees their
// department; the overview and the appointment list share this so their numbers agree.
type Scope = "organisation" | "department" | "mine";

const scopeOf = (identity: StaffIdentity): Scope => {
  if (["system_admin", "director", "receptionist"].includes(identity.roleGroup)) return "organisation";
  if (identity.roleGroup === "hod" && identity.departmentId) return "department";
  return "mine";
};

// Sessions that started up to an hour ago still count, so one in progress is not dropped.
const UPCOMING_GRACE_MS = 60 * 60 * 1000;

async function upcomingSessionDocs(identity: StaffIdentity, scope: Scope, programme: ProgrammeFilter) {
  const from = Date.now() - UPCOMING_GRACE_MS;
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  if (scope === "organisation") {
    docs = (await db.collection("appointmentSessions")
      .where("startAt", ">=", admin.firestore.Timestamp.fromMillis(from))
      .orderBy("startAt")
      .limit(200)
      .get()).docs;
  } else if (scope === "department") {
    docs = (await db.collection("appointmentSessions").where("departmentId", "==", identity.departmentId).limit(500).get()).docs;
  } else {
    const found = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const id of ownerIds(identity)) {
      const snapshot = await db.collection("appointmentSessions").where("assigneeId", "==", id).limit(300).get();
      snapshot.docs.forEach((doc) => found.set(doc.id, doc));
    }
    docs = Array.from(found.values());
  }
  return docs
    .filter((doc) => {
      const data = doc.data();
      const start = data.startAt?.toMillis?.() ?? 0;
      return !["cancelled", "completed"].includes(clean(data.status).toLowerCase()) && start >= from &&
        inProgramme(programme, data.programId);
    })
    .sort((a, b) => (a.data().startAt?.toMillis?.() ?? 0) - (b.data().startAt?.toMillis?.() ?? 0));
}

/**
 * Today's sessions for the morning summary: the same scope as the assistant's appointment list
 * (department, organisation or own), across every programme the person works in rather than
 * the one picked on WhatsApp.
 */
export async function sessionsTodayFor(identity: StaffIdentity) {
  const options = await programmesFor(identity);
  const programme: ProgrammeFilter = canSeeAllProgrammes(identity) || !options.length
    ? { ids: null, label: null }
    : { ids: new Set(options.map((option) => option.id)), label: null };
  const today = todaySast();
  return (await upcomingSessionDocs(identity, scopeOf(identity), programme))
    .filter((doc) => sastParts(doc.data().startAt.toDate()).date === today)
    .map((doc) => sessionSummary(doc.id, doc.data()));
}

async function departmentName(identity: StaffIdentity) {
  if (!identity.departmentId) return null;
  const snapshot = await db.collection("departments").doc(identity.departmentId).get();
  return clean(snapshot.data()?.name) || null;
}

async function staffOverview(identity: StaffIdentity): Promise<GatewayResult> {
  if (!["system_admin", "director", "hod"].includes(identity.roleGroup)) return fail(403, "not_permitted");

  const scope = scopeOf(identity);
  const programme = await programmeFilter(identity);
  const assignmentsQuery = scope === "organisation"
    ? db.collection("assignedInterventions")
    : scope === "department"
      ? db.collection("assignedInterventions").where("departmentId", "==", identity.departmentId)
      : db.collection("assignedInterventions").where("assigneeId", "in", ownerIds(identity));
  const organisationSmes = () => programme.ids
    ? acceptedParticipantIds(programme.ids).then((ids) => ids.size)
    : db.collection("participants").count().get().then((snap) => snap.data().count);
  const [assignmentSnapshot, upcoming, participantCount, department] = await Promise.all([
    assignmentsQuery.select("assignmentStatus", "participantId", "programId").get(),
    upcomingSessionDocs(identity, scope, programme),
    scope === "organisation" ? organisationSmes() : null,
    scope === "organisation" ? null : departmentName(identity),
  ]);
  const assignments = assignmentSnapshot.docs.filter((doc) => inProgramme(programme, doc.data().programId));

  const body: Record<string, unknown> = {
    scope,
    departmentName: department,
    programme: programme.label,
    // Outside the organisation view, count the SMEs these interventions are for.
    participants: participantCount ?? new Set(assignments.map((doc) => clean(doc.data().participantId)).filter(Boolean)).size,
    assignments: {
      total: assignments.length,
      byStatus: tally(assignments.map((doc) => clean(doc.data().assignmentStatus).toLowerCase())),
    },
    upcomingSessions: upcoming.length,
  };

  if (identity.roleGroup !== "hod") {
    const users = await db.collection("users").select("role").get();
    body.users = {
      total: users.size,
      byRole: tally(users.docs.map((doc) => clean(doc.data().role).toLowerCase())),
    };
  }
  return ok(body);
}

async function governanceSummary(identity: StaffIdentity): Promise<GatewayResult> {
  if (!["system_admin", "director"].includes(identity.roleGroup)) return fail(403, "not_permitted");

  const [features, meetings] = await Promise.all([
    db.collection("featureGovernance").get(),
    db.collection("governanceMeetings").get(),
  ]);

  const records = features.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
  const pipeline = records
    .filter((record) => record.status !== "released")
    .sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0))
    .slice(0, 6)
    .map((record) => ({
      title: clean(record.title),
      status: clean(record.status),
      progress: Number(record.progress || 0),
      dueDate: clean(record.dueDate) || null,
    }));

  let openChallenges = 0;
  let pendingMeetings = 0;
  meetings.docs.forEach((doc) => {
    const data = doc.data() as any;
    if (data.status === "pending") pendingMeetings += 1;
    if (Array.isArray(data.challenges)) {
      openChallenges += data.challenges.filter((challenge: any) => challenge?.status !== "resolved").length;
    }
  });

  return ok({
    features: {
      total: records.length,
      byStatus: tally(records.map((record) => clean(record.status))),
    },
    pipeline,
    meetings: { total: meetings.size, pending: pendingMeetings },
    openChallenges,
  });
}

const sessionSummary = (id: string, data: any) => {
  const start = data?.startAt?.toDate?.() || null;
  const end = data?.endAt?.toDate?.() || null;
  return {
    id,
    title: clean(data?.title) || clean(data?.interventionTitle) || "Appointment",
    interventionTitle: clean(data?.interventionTitle) || null,
    assigneeName: clean(data?.assigneeName) || null,
    start: formatWhen(start),
    endTime: end ? sastParts(end).time : null,
    deliveryMethod: clean(data?.deliveryMethod) || null,
    location: clean(data?.location) || null,
    meetingLink: clean(data?.meetingLink) || null,
    invited: Number(data?.attendanceSummary?.invitedCount || 0),
    status: clean(data?.status) || "scheduled",
    sessionType: clean(data?.sessionType) || "individual",
  };
};

async function myAppointments(identity: StaffIdentity): Promise<GatewayResult> {
  if (identity.roleGroup === "external" || identity.roleGroup === "unknown") return fail(403, "not_permitted");

  const scope = scopeOf(identity);
  const programme = await programmeFilter(identity);
  const sessions = (await upcomingSessionDocs(identity, scope, programme))
    .filter((doc) => identity.roleGroup !== "receptionist" || sastParts(doc.data().startAt.toDate()).date === todaySast())
    .slice(0, 8)
    .map((doc) => sessionSummary(doc.id, doc.data()));

  return ok({ appointments: sessions, scope, programme: programme.label });
}

const participantLabel = (data: any) =>
  clean(data?.beneficiaryName) || clean(data?.participantName) || clean(data?.businessName) || clean(data?.companyName) || clean(data?.name);

// System administrators oversee the programme: they can view appointments and interventions but
// cannot set them up, so they are excluded from the lookups and actions that exist for scheduling.
const SCHEDULERS: RoleGroup[] = ["hod", "coordinator", "employee"];

async function searchParticipants(identity: StaffIdentity, query: string): Promise<GatewayResult> {
  if (!SCHEDULERS.includes(identity.roleGroup)) return fail(403, "not_permitted");
  const needle = shortText(query, 80).toLowerCase();
  if (needle.length < 2) return fail(400, "query_required");

  const programme = await programmeFilter(identity);
  const enrolled = programme.ids ? await acceptedParticipantIds(programme.ids) : null;
  return ok({ participants: await findParticipants(needle, enrolled), programme: programme.label });
}

/** SMEs whose name contains every word of the needle, limited to the enrolled ids when given. */
async function findParticipants(needle: string, enrolled: Set<string> | null) {
  const snapshot = await db.collection("participants")
    .select("beneficiaryName", "participantName", "businessName", "companyName", "name")
    .limit(2000)
    .get();
  return snapshot.docs
    .filter((doc) => !enrolled || enrolled.has(doc.id))
    .map((doc) => ({ id: doc.id, name: participantLabel(doc.data()) }))
    .filter((row) => row.name && needle.split(" ").every((token) => row.name.toLowerCase().includes(token)))
    .slice(0, 6);
}

/* ---------------------------------------------------------------- documents */

// An SME's documents staff can have sent to them on WhatsApp: the compliance documents on their
// application (complianceDocuments[], each with a type and a storage url) and the signed POPIA
// notice (signedAgreements["popia-act"].pdfUrl, made by src/utils/generateContractPdf.ts).
// Documents are told apart by their type name: the stored keys vary between programmes.
type SmeDocument = {
  key: string;
  label: string;
  url: string;
  fileName: string;
  issued: string | null;
  expires: string | null;
  /** Review state of an upload: pending, valid, invalid, queried, expired, ... */
  status: string | null;
};

const POPIA_KEY = "popia";
const docKey = (label: unknown) => clean(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const isBankDocument = (key: string) => key.includes("bank");
// Words staff use for a document, mapped to part of its key.
const DOCUMENT_ALIASES: Record<string, string> = {
  id: "id-copy",
  "id-document": "id-copy",
  identity: "id-copy",
  bee: "b-bbee",
  bbbee: "b-bbee",
  "b-bbee": "b-bbee",
  tax: "sars",
  tcs: "sars",
  "tax-clearance": "sars",
  address: "proof-of-address",
  "proof-of-residence": "proof-of-address",
  registration: "cipc",
  "company-registration": "cipc",
  agreement: "memorandum-of-agreement",
  moa: "memorandum-of-agreement",
  contract: "pre-incubation-contract",
  gap: "gap-analysis",
  bank: "bank",
  "bank-letter": "bank",
  privacy: POPIA_KEY,
  "popia-act": POPIA_KEY,
};

/**
 * Who may have SME documents sent to them, and whether that includes the Bank Confirmation Letter.
 * System admins and directors oversee everything; operations and coordinators only in the ROM and
 * M&E departments (or their sub-departments). Banking follows the banking-details rule: admins
 * and ROM, not M&E or directors.
 */
export async function documentAccess(identity: StaffIdentity): Promise<{ allowed: boolean; banking: boolean }> {
  if (identity.roleGroup === "system_admin") return { allowed: true, banking: true };
  if (identity.roleGroup === "director") return { allowed: true, banking: false };
  if (!["hod", "coordinator"].includes(identity.roleGroup) || !identity.departmentId) return { allowed: false, banking: false };
  const [rom, monitoring] = await Promise.all([
    isDepartmentInRole(identity.departmentId, "rom"),
    isDepartmentInRole(identity.departmentId, "monitoring"),
  ]);
  return { allowed: rom || monitoring, banking: rom };
}

const millis = (value: any) => value?.toMillis?.() ?? (Date.parse(clean(value)) || 0);
const dateOnly = (value: any) => {
  if (value?.toDate) return sastParts(value.toDate()).date;
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

/**
 * The SME's documents: the newest upload for each of their programme's required documents, read
 * where the compliance pages read them (subcollection and embedded arrays), the signed POPIA
 * notice, and the required documents still missing.
 */
async function smeDocumentsOf(participantId: string) {
  const [records, applications] = await Promise.all([
    participantComplianceRecords(participantId),
    db.collection("applications").where("participantId", "==", participantId).get(),
  ]);
  const applicationId = records.application?.id || null;
  const documents: Array<SmeDocument & { applicationId: string | null }> = [];

  // POPIA is signed once, on whichever application the SME signed it.
  const popia = applications.docs
    .map((doc) => ({ id: doc.id, agreement: doc.data().signedAgreements?.["popia-act"] }))
    .filter((row) => clean(row.agreement?.pdfUrl))
    .sort((a, b) => millis(b.agreement.acceptedAt) - millis(a.agreement.acceptedAt))[0];
  if (popia) {
    documents.push({
      key: POPIA_KEY, label: "POPIA notice", url: clean(popia.agreement.pdfUrl), fileName: "popia.pdf",
      issued: dateOnly(popia.agreement.acceptedAt), expires: null, status: null, applicationId: popia.id,
    });
  }

  const missing: string[] = [];
  if (records.requirements.length) {
    for (const state of requirementStates(records.documents, records.requirements)) {
      if (!state.document) {
        missing.push(state.title);
        continue;
      }
      documents.push({
        key: docKey(state.title), label: state.title, url: clean(state.document.url), fileName: clean(state.document.fileName),
        issued: dateOnly(state.document.issueDate), expires: state.expires ? sastParts(state.expires).date : null,
        status: state.status, applicationId,
      });
    }
  } else {
    // The programme lists no requirements: offer every upload, the newest of each type.
    const newest = new Map<string, SmeDocument & { applicationId: string | null }>();
    const uploaded = [...records.documents].sort((a, b) =>
      millis(b.updatedAt || b.createdAt || b.uploadedAt) - millis(a.updatedAt || a.createdAt || a.uploadedAt));
    for (const item of uploaded) {
      const label = clean(item?.type || item?.documentName || item?.title);
      const key = docKey(label);
      if (!key || newest.has(key) || !clean(item?.url)) continue;
      newest.set(key, {
        key, label, url: clean(item.url), fileName: clean(item.fileName),
        issued: dateOnly(item.issueDate), expires: dateOnly(item.expiryDate), status: clean(item.status).toLowerCase() || null, applicationId,
      });
    }
    documents.push(...newest.values());
  }
  return { documents, missing };
}

/** Documents matching what was asked for: an exact key, an alias, or words of the type name. */
function matchDocuments<T extends { key: string; label: string }>(documents: T[], wanted: string): T[] {
  const key = docKey(wanted);
  const exact = documents.filter((doc) => doc.key === key);
  if (exact.length) return exact;
  const alias = DOCUMENT_ALIASES[key];
  if (alias) return documents.filter((doc) => doc.key.includes(alias));
  const words = key.split("-").filter((word) => word.length > 1);
  return words.length ? documents.filter((doc) => words.every((word) => doc.key.includes(word))) : [];
}

const fileSafe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
const extensionOf = (fileName: string) => (/\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1] || "pdf").toLowerCase();

async function smeDocument(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  const access = await documentAccess(identity);
  if (!access.allowed) return fail(403, "not_permitted");

  // Only SMEs enrolled in a programme this person is looking at.
  const programme = await programmeFilter(identity);
  const enrolled = programme.ids ? await acceptedParticipantIds(programme.ids) : null;
  let participantId = clean(payload.participantId);
  if (participantId && enrolled && !enrolled.has(participantId)) {
    return ok({ found: false, reason: "not_in_programme", programme: programme.label });
  }
  if (!participantId) {
    const needle = shortText(payload.query, 80).toLowerCase();
    if (needle.length < 2) return fail(400, "query_required");
    const matches = await findParticipants(needle, enrolled);
    if (matches.length !== 1) return ok({ found: false, reason: matches.length ? "several_matches" : "no_match", matches });
    participantId = matches[0].id;
  }

  const participant = await db.collection("participants").doc(participantId).get();
  if (!participant.exists) return ok({ found: false, reason: "no_match", matches: [] });
  const name = participantLabel(participant.data()) || "SME";
  const all = await smeDocumentsOf(participantId);
  const visible = all.documents.filter((doc) => access.banking || !isBankDocument(doc.key));
  const today = todaySast();
  const listing = {
    found: true,
    participantId,
    participantName: name,
    documents: visible.map((doc) => ({
      key: doc.key, label: doc.label, issued: doc.issued, expires: doc.expires, expired: !!doc.expires && doc.expires < today,
      status: doc.status,
    })),
    missing: all.missing.filter((label) => access.banking || !isBankDocument(docKey(label))),
  };

  const wanted = shortText(payload.document || payload.documentType, 80);
  if (!wanted || ["list", "all", "documents", "everything"].includes(wanted.toLowerCase())) return ok(listing);
  const wantsBank = isBankDocument(docKey(wanted)) || DOCUMENT_ALIASES[docKey(wanted)] === "bank";
  if (wantsBank && !access.banking) return ok({ ...listing, reason: "bank_letter_not_permitted" });
  const matches = matchDocuments(visible, wanted);
  if (matches.length !== 1) {
    return ok({ ...listing, reason: matches.length ? "several_documents" : "document_not_uploaded", asked: wanted });
  }

  const doc = matches[0];
  await db.collection("whatsappDocumentRequests").add({
    requestedBy: identity.id,
    requestedByName: identity.name,
    requestedByRole: identity.role,
    participantId,
    participantName: name,
    applicationId: (all.documents.find((item) => item.key === doc.key) as any)?.applicationId || null,
    documentType: doc.label,
    channel: identity.channel || "whatsapp",
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ok({
    found: true,
    participantId,
    participantName: name,
    document: {
      url: doc.url,
      filename: `${fileSafe(name)} - ${fileSafe(doc.label)}.${extensionOf(doc.fileName)}`,
      label: doc.label,
      signedOn: doc.key === POPIA_KEY ? doc.issued : null,
      issued: doc.key === POPIA_KEY ? null : doc.issued,
      expires: doc.expires,
      expired: !!doc.expires && doc.expires < today,
      status: doc.status,
    },
  });
}

const INACTIVE_ASSIGNMENT = ["cancelled", "completed", "declined"];

async function searchAssignments(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  if (!SCHEDULERS.includes(identity.roleGroup)) return fail(403, "not_permitted");
  const participantId = clean(payload.participantId);
  const needle = shortText(payload.query, 80).toLowerCase();
  if (!participantId && needle.length < 2) return fail(400, "query_required");
  const programme = await programmeFilter(identity);

  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (participantId) {
    docs = (await db.collection("assignedInterventions").where("participantId", "==", participantId).limit(100).get()).docs;
  } else {
    const found = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const id of ownerIds(identity)) {
      (await db.collection("assignedInterventions").where("assigneeId", "==", id).limit(500).get()).docs
        .forEach((doc) => found.set(doc.id, doc));
    }
    docs = Array.from(found.values());
  }

  const assignments = docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((row) => !INACTIVE_ASSIGNMENT.includes(clean(row.assignmentStatus).toLowerCase()))
    .filter((row) => isOwnedBy(identity, row.assigneeId))
    .filter((row) => inProgramme(programme, row.programId))
    .filter((row) => !needle || clean(row.participantName).toLowerCase().includes(needle))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      participantId: clean(row.participantId),
      participantName: clean(row.participantName),
      interventionTitle: clean(row.interventionTitle),
      subInterventionTitle: clean(row.subInterventionTitle) || null,
      assigneeName: clean(row.assigneeName) || null,
      cycleKey: clean(row.cycleKey) || null,
      grouped: clean(row.type) === "grouped" || !!clean(row.groupKey),
    }));
  return ok({ assignments });
}

/* ---------------------------------------------------------------- proposals */

const ROLE_CHOICES = ["system_admin", "director", "operations", "coordinator", "projectadmin", "receptionist", "employee", "incubatee", "funder"];
const DELIVERY_METHODS = ["in_person", "virtual", "telephonically"];
const DELIVERY_LABEL: Record<string, string> = { in_person: "In person", virtual: "Virtual", telephonically: "Telephonic" };

export type Validated = { params: Record<string, unknown>; summary: string };

function validateLogMeeting(identity: StaffIdentity, raw: any): Validated {
  if (identity.roleGroup !== "system_admin") throw new UserError("Only system administrators can log governance meetings.", "not_permitted");
  const title = shortText(raw.title, 160);
  const withName = shortText(raw.withName, 120);
  if (!title) throw new UserError("What should the meeting be called?");
  if (!withName) throw new UserError("Who was the meeting with?");
  const status = raw.status === "pending" ? "pending" : "held";
  const meetingDate = validDate(raw.meetingDate) || todaySast();
  const discussion = shortText(raw.discussion, 1500);
  const challenges = (Array.isArray(raw.challenges) ? raw.challenges : [])
    .map((item: unknown) => shortText(item, 300))
    .filter(Boolean)
    .slice(0, 10);
  const summary = [
    `Log a governance meeting`,
    `Title: ${title}`,
    `With: ${withName}`,
    `Date: ${meetingDate} (${status === "held" ? "held" : "still to happen"})`,
    discussion ? `Discussed: ${discussion}` : null,
    challenges.length ? `Challenges: ${challenges.join("; ")}` : null,
  ].filter(Boolean).join("\n");
  return { params: { title, withName, status, meetingDate, discussion, challenges }, summary };
}

function validateLogFeature(identity: StaffIdentity, raw: any): Validated {
  if (identity.roleGroup !== "system_admin") throw new UserError("Only system administrators can log features.", "not_permitted");
  const title = shortText(raw.title, 160);
  const description = shortText(raw.description, 1500);
  if (!title) throw new UserError("What is the feature called?");
  if (!description) throw new UserError("Please give me a short description of the feature.");
  const type = raw.type === "pipeline" ? "pipeline" : "request";
  const dueDate = raw.dueDate ? validDate(raw.dueDate) : null;
  if (raw.dueDate && !dueDate) throw new UserError("I couldn't read that target date. Please give it as a date, like 30 September 2026.");
  const roles = Array.from(new Set(
    (Array.isArray(raw.roles) ? raw.roles : []).map((role: unknown) => clean(role).toLowerCase().replace(/[\s-]/g, "_")).filter((role: string) => ROLE_CHOICES.includes(role)),
  ));
  const summary = [
    type === "pipeline" ? "Add a feature to the pipeline" : "Log a feature request",
    `Feature: ${title}`,
    `Description: ${description}`,
    dueDate ? `Target date: ${dueDate}` : null,
    roles.length ? `Affected users: ${roles.join(", ")}` : "Affected users: not set yet (you can add them in the web app)",
  ].filter(Boolean).join("\n");
  return { params: { title, description, type, dueDate, roles }, summary };
}

type ScheduleContext = {
  assignment: any;
  assignmentId: string;
  sessionId: string;
  start: Date;
  end: Date;
  participant: any;
};

const safeKey = (value: string) => encodeURIComponent(value).replace(/%/g, "_");

async function loadSchedule(identity: StaffIdentity, params: any): Promise<ScheduleContext> {
  if (!SCHEDULERS.includes(identity.roleGroup)) {
    throw new UserError("Your role can't set up appointments from WhatsApp.", "not_permitted");
  }
  const assignmentId = clean(params.assignedInterventionId);
  const snapshot = assignmentId ? await db.collection("assignedInterventions").doc(assignmentId).get() : null;
  if (!snapshot?.exists) throw new UserError("I couldn't find that intervention assignment. Tell me which SME it's for and I'll look it up.");
  const assignment = { id: snapshot.id, ...(snapshot.data() as any) };
  if (!isOwnedBy(identity, assignment.assigneeId)) {
    throw new UserError("That intervention is assigned to someone else, so I can't schedule it for you.", "not_permitted");
  }
  if (INACTIVE_ASSIGNMENT.includes(clean(assignment.assignmentStatus).toLowerCase())) {
    throw new UserError("That intervention is no longer active, so I can't book a session for it.");
  }
  if (clean(assignment.type) === "grouped" || clean(assignment.groupKey)) {
    throw new UserError("That is a group intervention. Group sessions need to be scheduled in the web app.");
  }
  if (!clean(assignment.assigneeId)) throw new UserError("That intervention has no responsible person yet. Assign one in the web app first.");

  const date = validDate(params.date);
  const time = validTime(params.time);
  if (!date || !time) throw new UserError("What date and time should the appointment be? For example 30 September at 10:00.");
  const start = new Date(`${date}T${time}:00${TZ_OFFSET}`);
  const minutes = Math.min(480, Math.max(15, Math.round(Number(params.durationMinutes) || 60)));
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  if (start.getTime() <= Date.now()) throw new UserError("That time has already passed. Please choose a future date and time.");
  const hour = Number(time.slice(0, 2));
  if (hour < 6 || hour >= 18) throw new UserError("Appointments must start between 06:00 and 18:00.");

  const created = assignment.createdAt?.toDate?.() || assignment.assignedAt?.toDate?.() || null;
  if (created && date < sastParts(created).date) {
    throw new UserError("The appointment can't be earlier than the date the intervention was assigned.");
  }

  const programId = clean(assignment.programId);
  const sessionId = `session_${safeKey([
    programId, clean(assignment.departmentId), clean(assignment.interventionId), assignmentId, start.getTime(), clean(assignment.assigneeId),
  ].join("__"))}`;
  if ((await db.collection("appointmentSessions").doc(sessionId).get()).exists) {
    throw new UserError("That appointment already exists, so I haven't booked a duplicate.");
  }

  const clash = await db.collection("appointmentSessions").where("assigneeId", "==", clean(assignment.assigneeId)).limit(300).get();
  const overlapping = clash.docs.find((doc) => {
    const data = doc.data();
    if (["cancelled", "postponed", "completed"].includes(clean(data.status).toLowerCase())) return false;
    const s = data.startAt?.toMillis?.() ?? 0;
    const e = data.endAt?.toMillis?.() ?? 0;
    return start.getTime() < e && end.getTime() > s;
  });
  if (overlapping) {
    throw new UserError(`${clean(assignment.assigneeName) || "The assignee"} already has a session at ${formatWhen(overlapping.data().startAt.toDate())}. Please pick another time.`);
  }

  const participantSnapshot = await db.collection("participants").doc(clean(assignment.participantId)).get();
  return { assignment, assignmentId, sessionId, start, end, participant: participantSnapshot.exists ? participantSnapshot.data() : {} };
}

export async function validateSchedule(identity: StaffIdentity, raw: any): Promise<Validated> {
  const context = await loadSchedule(identity, raw);
  const deliveryMethod = DELIVERY_METHODS.includes(clean(raw.deliveryMethod)) ? clean(raw.deliveryMethod) : "in_person";
  const location = deliveryMethod === "in_person" ? shortText(raw.location, 200) : "";
  const meetingLink = deliveryMethod === "virtual" ? shortText(raw.meetingLink, 400) : "";
  if (meetingLink && !/^https?:\/\//i.test(meetingLink)) throw new UserError("The meeting link needs to start with http:// or https://.");
  const durationMinutes = Math.round((context.end.getTime() - context.start.getTime()) / 60000);
  const title = shortText(raw.title, 160) || clean(context.assignment.interventionTitle) || "Appointment";
  const summary = [
    "Schedule an appointment",
    `SME: ${clean(context.assignment.participantName)}`,
    `Intervention: ${clean(context.assignment.interventionTitle)}${clean(context.assignment.subInterventionTitle) ? ` - ${clean(context.assignment.subInterventionTitle)}` : ""}`,
    `When: ${formatWhen(context.start)} (${durationMinutes} min)`,
    `How: ${DELIVERY_LABEL[deliveryMethod]}${location ? ` at ${location}` : ""}${meetingLink ? ` (${meetingLink})` : ""}`,
    `Led by: ${clean(context.assignment.assigneeName) || "the assignee"}`,
    "The SME will be invited to confirm.",
  ].join("\n");
  return {
    params: {
      assignedInterventionId: context.assignmentId,
      date: sastParts(context.start).date,
      time: sastParts(context.start).time,
      durationMinutes,
      deliveryMethod,
      location,
      meetingLink,
      title,
    },
    summary,
  };
}

export async function executeSchedule(identity: StaffIdentity, params: any): Promise<string> {
  const context = await loadSchedule(identity, params);
  const { assignment, participant, sessionId, start, end } = context;
  const deliveryMethod = DELIVERY_METHODS.includes(clean(params.deliveryMethod)) ? clean(params.deliveryMethod) : "in_person";
  const assigneeRole = roleKey(assignment.assigneeRole) === "operations" ? "operations" : "coordinator";
  const assigneeEmail = clean(assignment.assigneeEmail).toLowerCase() || null;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const sessionRef = db.collection("appointmentSessions").doc(sessionId);
  const invitationRef = db.collection("appointments").doc(`appointment_${safeKey(`${sessionId}__${clean(assignment.participantId)}`)}`);

  await db.runTransaction(async (transaction) => {
    const [existingSession, existingInvitation] = await Promise.all([transaction.get(sessionRef), transaction.get(invitationRef)]);
    if (existingSession.exists || existingInvitation.exists) throw new UserError("That appointment already exists, so I haven't booked a duplicate.");

    transaction.set(sessionRef, {
      schemaVersion: 5,
      programId: clean(assignment.programId),
      departmentId: clean(assignment.departmentId),
      interventionId: clean(assignment.interventionId),
      interventionTitle: clean(assignment.interventionTitle),
      cycleKey: clean(assignment.cycleKey) || null,
      groupKey: null,
      sessionType: "individual",
      assigneeId: clean(assignment.assigneeId),
      assigneeName: clean(assignment.assigneeName),
      assigneeEmail,
      assigneeRole,
      title: shortText(params.title, 160) || clean(assignment.interventionTitle) || "Appointment",
      startAt: admin.firestore.Timestamp.fromDate(start),
      endAt: admin.firestore.Timestamp.fromDate(end),
      deliveryMethod,
      location: deliveryMethod === "in_person" ? clean(params.location) || null : null,
      meetingLink: deliveryMethod === "virtual" ? clean(params.meetingLink) || null : null,
      plannedCoverage: [],
      coverage: { held: null, outcomeSummary: null, coveredPoints: [], reasonNotHeld: null, recordedAt: null, recordedById: null },
      attendanceSession: null,
      attendanceSummary: { invitedCount: 1, attendedCount: 0, checkedInCount: 0, checkedOutCount: 0 },
      foodMenu: [],
      status: "scheduled",
      createdVia: identity.channel || "whatsapp",
      createdById: identity.id,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    transaction.set(invitationRef, {
      schemaVersion: 5,
      programId: clean(assignment.programId),
      departmentId: clean(assignment.departmentId),
      assignedInterventionId: context.assignmentId,
      appointmentSessionId: sessionId,
      smeId: clean(assignment.participantId),
      smeName: clean(assignment.participantName),
      smeEmail: clean(participant?.email).toLowerCase() || null,
      interventionId: clean(assignment.interventionId),
      interventionTitle: clean(assignment.interventionTitle),
      subInterventionId: clean(assignment.subInterventionId) || null,
      subInterventionTitle: clean(assignment.subInterventionTitle) || null,
      cycleKey: clean(assignment.cycleKey) || null,
      assigneeId: clean(assignment.assigneeId),
      assigneeName: clean(assignment.assigneeName),
      assigneeEmail,
      assigneeRole,
      groupKey: null,
      status: "scheduled",
      smeConfirmation: "pending",
      smeDeclineReason: null,
      attendance: { status: "expected", checkedInAt: null, checkedOutAt: null },
      foodSelections: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  });

  return `Appointment booked for ${clean(assignment.participantName)} on ${formatWhen(start)}. They'll be invited to confirm.`;
}

const PROPOSAL_TTL_MS = 30 * 60 * 1000;

async function proposeAction(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  const kind = clean(payload.proposalKind);
  const raw = payload.params && typeof payload.params === "object" ? payload.params : {};
  try {
    let validated: Validated;
    if (kind === "log_meeting") validated = validateLogMeeting(identity, raw);
    else if (kind === "log_feature") validated = validateLogFeature(identity, raw);
    else if (kind === "schedule_appointment") validated = await validateSchedule(identity, raw);
    else return fail(400, "unsupported_proposal");

    const previous = await db.collection("whatsappAgentProposals")
      .where("userId", "==", identity.id).where("status", "==", "pending").get();
    await Promise.all(previous.docs.map((doc) => doc.ref.update({ status: "superseded" })));

    const ref = await db.collection("whatsappAgentProposals").add({
      userId: identity.id,
      userName: identity.name,
      role: identity.role,
      kind,
      params: validated.params,
      summary: validated.summary,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PROPOSAL_TTL_MS),
    });
    return ok({ proposalId: ref.id, kind, summary: validated.summary });
  } catch (error) {
    if (error instanceof UserError) return ok({ rejected: true, reason: error.message, code: error.code });
    throw error;
  }
}

async function latestPending(identity: StaffIdentity) {
  const snapshot = await db.collection("whatsappAgentProposals")
    .where("userId", "==", identity.id).where("status", "==", "pending").get();
  return snapshot.docs
    .sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0))[0] || null;
}

async function executeProposal(identity: StaffIdentity, kind: string, params: any): Promise<string> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  if (kind === "log_meeting") {
    const value = validateLogMeeting(identity, params).params as any;
    await db.collection("governanceMeetings").add({
      source: "meeting",
      title: value.title,
      status: value.status,
      withName: value.withName,
      meetingDate: value.meetingDate,
      dueDate: "",
      discussion: value.discussion,
      challenges: value.challenges.map((text: string, index: number) => ({
        id: `challenge-${Date.now()}-${index}`,
        text,
        status: "open",
      })),
      requests: "",
      relatedFeatureIds: [],
      createdFeatureIds: [],
      createdBy: identity.id,
      createdByName: identity.name,
      createdVia: "whatsapp",
      createdAt: now,
      updatedAt: now,
    });
    return `Meeting logged: "${value.title}" with ${value.withName}. You'll find it under Feature Governance > Meetings.`;
  }
  if (kind === "log_feature") {
    const value = validateLogFeature(identity, params).params as any;
    await db.collection("featureGovernance").add({
      programSpecific: false,
      programId: null,
      appliesToAllPrograms: false,
      type: value.type,
      title: value.title,
      description: value.description,
      status: value.type === "pipeline" ? "planned" : "submitted",
      progress: 0,
      dueDate: value.dueDate || null,
      completedAt: null,
      audience: { roles: value.roles, allDepartments: false, departmentIds: [], allBranches: false, branchIds: [] },
      meetings: [],
      whatsNew: { published: false, headline: value.title, summary: value.description, imageUrls: [] },
      createdBy: identity.id,
      createdByName: identity.name,
      createdVia: "whatsapp",
      createdAt: now,
      updatedAt: now,
    });
    return `Logged "${value.title}" as ${value.type === "pipeline" ? "a pipeline feature" : "a feature request"}. It's under Feature Governance.`;
  }
  if (kind === "schedule_appointment") return executeSchedule(identity, params);
  throw new UserError("I don't know how to do that one.");
}

async function confirmProposal(identity: StaffIdentity): Promise<GatewayResult> {
  const pending = await latestPending(identity);
  if (!pending) return ok({ found: false, message: "There's nothing waiting for your confirmation." });
  const data = pending.data();
  if ((data.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
    await pending.ref.update({ status: "expired" });
    return ok({ found: false, message: "That request expired. Tell me again and I'll set it up." });
  }
  try {
    const message = await executeProposal(identity, clean(data.kind), data.params || {});
    await pending.ref.update({ status: "executed", result: message, executedAt: admin.firestore.FieldValue.serverTimestamp() });
    return ok({ found: true, executed: true, message });
  } catch (error) {
    if (error instanceof UserError) {
      await pending.ref.update({ status: "failed", result: error.message });
      return ok({ found: true, executed: false, message: error.message });
    }
    throw error;
  }
}

async function cancelProposal(identity: StaffIdentity): Promise<GatewayResult> {
  const pending = await latestPending(identity);
  if (pending) await pending.ref.update({ status: "cancelled" });
  return ok({ cancelled: !!pending });
}

/* -------------------------------------------------------------------- state */

const MAX_HISTORY = 8;

async function stateGet(identity: StaffIdentity): Promise<GatewayResult> {
  const snapshot = await db.collection("whatsappAgentState").doc(identity.id).get();
  const data = snapshot.data() || {};
  const fresh = (data.updatedAt?.toMillis?.() ?? 0) > Date.now() - 6 * 60 * 60 * 1000;
  return ok({ history: fresh && Array.isArray(data.history) ? data.history : [] });
}

async function stateSet(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  const history = (Array.isArray(payload.history) ? payload.history : [])
    .slice(-MAX_HISTORY)
    .map((turn: any) => ({
      role: turn?.role === "assistant" ? "assistant" : "user",
      text: shortText(turn?.text, 700),
    }))
    .filter((turn: any) => turn.text);
  // Merge, so the chosen programme survives the conversation history being rewritten.
  await db.collection("whatsappAgentState").doc(identity.id).set({
    history,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return ok({ saved: true });
}

/* ----------------------------------------------------------------- dispatch */

export const STAFF_ACTIONS = new Set([
  "staff_overview",
  "governance_summary",
  "my_appointments",
  "search_participants",
  "search_assignments",
  "propose_action",
  "confirm_proposal",
  "cancel_proposal",
  "agent_state_get",
  "agent_state_set",
  "list_programmes",
  "select_programme",
  "sme_document",
]);

export async function handleStaffAction(action: string, identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  switch (action) {
    case "staff_overview": return staffOverview(identity);
    case "governance_summary": return governanceSummary(identity);
    case "my_appointments": return myAppointments(identity);
    case "search_participants": return searchParticipants(identity, clean(payload.query));
    case "search_assignments": return searchAssignments(identity, payload);
    case "propose_action": return proposeAction(identity, payload);
    case "confirm_proposal": return confirmProposal(identity);
    case "cancel_proposal": return cancelProposal(identity);
    case "agent_state_get": return stateGet(identity);
    case "agent_state_set": return stateSet(identity, payload);
    case "list_programmes": return listProgrammes(identity);
    case "select_programme": return selectProgramme(identity, payload);
    case "sme_document": return smeDocument(identity, payload);
    default: return fail(400, "unsupported_action");
  }
}
