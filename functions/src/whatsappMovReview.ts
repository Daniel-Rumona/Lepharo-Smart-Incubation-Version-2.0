import { admin, db } from "./firebase";
import { clean } from "./whatsappCommon";
import { GatewayResult, inProgramme, programmeFilter, StaffIdentity } from "./whatsappStaff";
import {
  awaitingReview,
  checkQueryMessage,
  hasEvidence,
  hiddenFrom,
  MAX_LISTED,
  orderForReview,
  QUERY_TYPE_LABELS,
  QUERY_TYPES,
  QueryType,
  reviewRow,
} from "./movReviewLogic";

/**
 * Heads of department approving or querying their department's MOVs on WhatsApp. The same writes as
 * the web MOV workspace (approve and raiseQuery in src/routes/operations/movs/useMovWorkspace.ts):
 * approving resolves the HOD's own open queries on the MOV; a query goes to the MOV's facilitator as a
 * workflowQueries document (onWorkflowQueryChanged notifies them) and turns the MOV "queried".
 *
 * Only the MOVs of the HOD's own department, in the programme they are looking at, that the SME has
 * confirmed and that are neither approved nor queried. Undoing an approval, deciding SME delivery
 * disputes and submitting the monthly pack stay on the web. The assistant asks before every write.
 */

const ok = (body: Record<string, unknown>): GatewayResult => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status: number, error: string): GatewayResult => ({ status, body: { ok: false, error } });
const drafts = db.collection("whatsappMovQueryDrafts");
const DRAFT_TTL_MS = 30 * 60 * 1000;

const isHod = (identity: StaffIdentity) => identity.roleGroup === "hod" && !!identity.departmentId;

type Loaded = { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData };

/** The MOV, if it is one this HOD may decide now; otherwise the reason as an error code. */
async function reviewable(identity: StaffIdentity, movId: unknown): Promise<Loaded | GatewayResult> {
  const id = clean(movId);
  if (!id) return fail(400, "mov_not_found");
  const snapshot = await db.collection("movDocuments").doc(id).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || clean(data.departmentId) !== identity.departmentId || hiddenFrom(data, identity.email)) {
    return fail(404, "mov_not_found");
  }
  if (!inProgramme(await programmeFilter(identity), data.programId)) return fail(404, "mov_not_found");
  if (data.approvedByHod === true) return fail(409, "mov_already_approved");
  if (clean(data.status).toLowerCase() === "queried") return fail(409, "mov_already_queried");
  if (!awaitingReview(data)) return fail(409, "mov_not_ready");
  return { ref: snapshot.ref, data };
}

const isResult = (value: Loaded | GatewayResult): value is GatewayResult => "status" in value && "body" in value;

async function openQueries(movId: string) {
  const snapshot = await db.collection("workflowQueries").where("context.movId", "==", movId).get();
  return snapshot.docs.filter((doc) => !clean(doc.data().context?.consolidatedMovId) && clean(doc.data().status || "open").toLowerCase() !== "resolved");
}

const hodIds = (identity: StaffIdentity) => new Set([identity.uid || "", identity.id].filter(Boolean));

async function departmentName(identity: StaffIdentity) {
  if (!identity.departmentId) return null;
  return clean((await db.collection("departments").doc(identity.departmentId).get()).data()?.name) || null;
}

const actorOf = async (identity: StaffIdentity) => ({
  name: identity.name || null,
  email: identity.email ? identity.email.toLowerCase() : null,
  role: identity.role || null,
  departmentId: identity.departmentId || null,
  departmentName: await departmentName(identity),
});

/** "To review" for this HOD, oldest first. */
export async function movReviewPending(identity: StaffIdentity): Promise<GatewayResult> {
  if (!isHod(identity)) return fail(403, "not_permitted");
  const filter = await programmeFilter(identity);
  const snapshot = await db.collection("movDocuments").where("departmentId", "==", identity.departmentId).get();
  const rows = orderForReview(snapshot.docs
    .filter((doc) => awaitingReview(doc.data()) && inProgramme(filter, doc.data().programId) && !hiddenFrom(doc.data(), identity.email))
    .map((doc) => reviewRow(doc.id, doc.data())));
  return ok({ movs: rows.slice(0, MAX_LISTED), total: rows.length, programme: filter.label });
}

/** One MOV, with what approving it would mean. */
export async function movReviewDetail(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  if (!isHod(identity)) return fail(403, "not_permitted");
  const loaded = await reviewable(identity, payload.movId);
  if (isResult(loaded)) return loaded;
  const mine = hodIds(identity);
  const open = await openQueries(loaded.ref.id);
  const ownOpen = open.filter((doc) => mine.has(clean(doc.data().raisedById))).length;
  return ok({
    mov: reviewRow(loaded.ref.id, loaded.data),
    ownOpenQueries: ownOpen,
    otherOpenQueries: open.length - ownOpen,
    canQuery: !!clean(loaded.data.facilitatorId),
  });
}

/** Approve, as the web's Approve button does. */
export async function movReviewApprove(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  if (!isHod(identity)) return fail(403, "not_permitted");
  const loaded = await reviewable(identity, payload.movId);
  if (isResult(loaded)) return loaded;
  const now = admin.firestore.Timestamp.now();
  const actor = await actorOf(identity);
  const actorId = identity.uid || identity.id;
  const mine = hodIds(identity);
  const own = (await openQueries(loaded.ref.id)).filter((doc) => mine.has(clean(doc.data().raisedById)));
  const batch = db.batch();
  own.forEach((doc) => batch.update(doc.ref, {
    status: "resolved",
    resolution: { notes: "Resolved when the MOV was approved.", attachmentUrl: null, resolvedById: actorId, resolvedBy: actor, resolvedAt: now },
    thread: admin.firestore.FieldValue.arrayUnion({ kind: "closed", message: "Resolved when the MOV was approved.", attachmentUrls: [], byId: actorId, by: actor, at: now }),
    updatedAt: now,
  }));
  batch.update(loaded.ref, {
    approvedByHod: true,
    hodApprovedAt: now,
    hodApprovedByUid: identity.uid || null,
    hodApprovedByName: identity.name || null,
    hodApprovedByEmail: identity.email || null,
    updatedAt: now,
    status: "approved",
    approvalHistory: admin.firestore.FieldValue.arrayUnion({ action: "approved", at: now, byUid: identity.uid || null, byName: identity.name || null, via: "whatsapp" }),
  });
  await batch.commit();
  const row = reviewRow(loaded.ref.id, loaded.data);
  return ok({ approved: true, sme: row.sme, intervention: row.intervention, evidence: hasEvidence(loaded.data), resolvedQueries: own.length });
}

/** Keep the query the HOD wrote, so they can check it before it is sent. */
export async function movReviewQueryDraft(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  if (!isHod(identity)) return fail(403, "not_permitted");
  const loaded = await reviewable(identity, payload.movId);
  if (isResult(loaded)) return loaded;
  if (!clean(loaded.data.facilitatorId)) return fail(409, "mov_no_facilitator");
  const type = (QUERY_TYPES as readonly string[]).includes(clean(payload.type)) ? clean(payload.type) as QueryType : "general-query";
  const checked = checkQueryMessage(payload.message);
  if ("problem" in checked) return fail(400, checked.problem);
  await drafts.doc(identity.id).set({ movId: loaded.ref.id, type, message: checked.message, createdAt: Date.now() });
  const row = reviewRow(loaded.ref.id, loaded.data);
  return ok({ draft: { movId: row.movId, sme: row.sme, intervention: row.intervention, facilitator: row.facilitator, typeLabel: QUERY_TYPE_LABELS[type], message: checked.message } });
}

/** The facilitator as the query's resolver: resolveWorkflowQueryActor in src/services/workflowQueryService.ts. */
async function resolverFor(mov: FirebaseFirestore.DocumentData) {
  const candidate = clean(mov.facilitatorId);
  for (const name of ["users", "coordinators", "consultants"]) {
    const snapshot = await db.collection(name).doc(candidate).get();
    if (!snapshot.exists) continue;
    const profile = snapshot.data() || {};
    if (name === "users") return { uid: snapshot.id, profileId: snapshot.id, profile };
    const authUid = clean(profile.authUid || profile.uid);
    if (authUid) {
      const user = await db.collection("users").doc(authUid).get();
      if (user.exists) return { uid: authUid, profileId: snapshot.id, profile: { ...profile, ...user.data() } };
    }
  }
  const email = clean(mov.facilitatorEmail).toLowerCase();
  if (email) {
    const matches = await db.collection("users").where("email", "==", email).get();
    if (matches.size === 1) return { uid: matches.docs[0].id, profileId: matches.docs[0].id, profile: matches.docs[0].data() };
  }
  return null;
}

/** Send the drafted query: raiseQuery in the web workspace. */
export async function movReviewQuerySend(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  if (!isHod(identity)) return fail(403, "not_permitted");
  const draftRef = drafts.doc(identity.id);
  const draft = (await draftRef.get()).data();
  if (!draft || clean(draft.movId) !== clean(payload.movId) || Date.now() - Number(draft.createdAt || 0) > DRAFT_TTL_MS) {
    return fail(409, "no_query_draft");
  }
  const loaded = await reviewable(identity, draft.movId);
  if (isResult(loaded)) return loaded;
  const mov = loaded.data;
  const resolver = await resolverFor(mov);
  if (!resolver) return fail(409, "mov_no_facilitator");
  const programId = clean(mov.programId);
  if (!programId) return fail(409, "mov_no_programme");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const actor = await actorOf(identity);
  const profile = resolver.profile || {};
  await db.collection("workflowQueries").add({
    schemaVersion: 2,
    programId,
    type: draft.type,
    message: draft.message,
    status: "open",
    raisedById: identity.uid || identity.id,
    raisedBy: { ...actor, role: (identity.role || "").toLowerCase() },
    resolverId: resolver.uid,
    resolverProfileId: resolver.profileId,
    resolver: {
      name: clean(profile.name || profile.displayName || mov.facilitatorName) || null,
      email: clean(profile.email || mov.facilitatorEmail).toLowerCase() || null,
      role: clean(profile.role || mov.facilitatorRole) || "coordinator",
      departmentId: clean(profile.departmentId) || null,
      departmentName: clean(profile.departmentName) || null,
    },
    assignedAt: now,
    target: { type: "mov", id: loaded.ref.id },
    context: {
      interventionId: clean(mov.interventionId) || null,
      interventionTitle: clean(mov.interventionTitle) || null,
      movId: loaded.ref.id,
      participantId: clean(mov.beneficiaryId || mov.smmeId) || null,
      departmentName: clean(mov.departmentName) || actor.departmentName,
      raisedVia: "whatsapp",
    },
    createdAt: now,
    updatedAt: now,
  });
  await loaded.ref.update({ status: "queried", approvedByHod: false, updatedAt: admin.firestore.Timestamp.now() });
  await draftRef.delete();
  const row = reviewRow(loaded.ref.id, mov);
  return ok({ queried: true, sme: row.sme, intervention: row.intervention, facilitator: row.facilitator });
}

export async function movReviewCancel(identity: StaffIdentity): Promise<GatewayResult> {
  await drafts.doc(identity.id).delete();
  return ok({ cancelled: true });
}

export const MOV_REVIEW_ACTIONS: Record<string, (identity: StaffIdentity, payload: any) => Promise<GatewayResult>> = {
  mov_review_pending: movReviewPending,
  mov_review_detail: movReviewDetail,
  mov_review_approve: movReviewApprove,
  mov_review_query_draft: movReviewQueryDraft,
  mov_review_query_send: movReviewQuerySend,
  mov_review_cancel: movReviewCancel,
};
