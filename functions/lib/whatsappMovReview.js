"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOV_REVIEW_ACTIONS = exports.movReviewCancel = exports.movReviewQuerySend = exports.movReviewQueryDraft = exports.movReviewApprove = exports.movReviewDetail = exports.movReviewPending = void 0;
const firebase_1 = require("./firebase");
const whatsappCommon_1 = require("./whatsappCommon");
const whatsappStaff_1 = require("./whatsappStaff");
const movReviewLogic_1 = require("./movReviewLogic");
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
const ok = (body) => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status, error) => ({ status, body: { ok: false, error } });
const drafts = firebase_1.db.collection("whatsappMovQueryDrafts");
const DRAFT_TTL_MS = 30 * 60 * 1000;
const isHod = (identity) => identity.roleGroup === "hod" && !!identity.departmentId;
/** The MOV, if it is one this HOD may decide now; otherwise the reason as an error code. */
async function reviewable(identity, movId) {
    const id = (0, whatsappCommon_1.clean)(movId);
    if (!id)
        return fail(400, "mov_not_found");
    const snapshot = await firebase_1.db.collection("movDocuments").doc(id).get();
    const data = snapshot.data();
    if (!snapshot.exists || !data || (0, whatsappCommon_1.clean)(data.departmentId) !== identity.departmentId || (0, movReviewLogic_1.hiddenFrom)(data, identity.email)) {
        return fail(404, "mov_not_found");
    }
    if (!(0, whatsappStaff_1.inProgramme)(await (0, whatsappStaff_1.programmeFilter)(identity), data.programId))
        return fail(404, "mov_not_found");
    if (data.approvedByHod === true)
        return fail(409, "mov_already_approved");
    if ((0, whatsappCommon_1.clean)(data.status).toLowerCase() === "queried")
        return fail(409, "mov_already_queried");
    if (!(0, movReviewLogic_1.awaitingReview)(data))
        return fail(409, "mov_not_ready");
    return { ref: snapshot.ref, data };
}
const isResult = (value) => "status" in value && "body" in value;
async function openQueries(movId) {
    const snapshot = await firebase_1.db.collection("workflowQueries").where("context.movId", "==", movId).get();
    return snapshot.docs.filter((doc) => !(0, whatsappCommon_1.clean)(doc.data().context?.consolidatedMovId) && (0, whatsappCommon_1.clean)(doc.data().status || "open").toLowerCase() !== "resolved");
}
const hodIds = (identity) => new Set([identity.uid || "", identity.id].filter(Boolean));
async function departmentName(identity) {
    if (!identity.departmentId)
        return null;
    return (0, whatsappCommon_1.clean)((await firebase_1.db.collection("departments").doc(identity.departmentId).get()).data()?.name) || null;
}
const actorOf = async (identity) => ({
    name: identity.name || null,
    email: identity.email ? identity.email.toLowerCase() : null,
    role: identity.role || null,
    departmentId: identity.departmentId || null,
    departmentName: await departmentName(identity),
});
/** "To review" for this HOD, oldest first. */
async function movReviewPending(identity) {
    if (!isHod(identity))
        return fail(403, "not_permitted");
    const filter = await (0, whatsappStaff_1.programmeFilter)(identity);
    const snapshot = await firebase_1.db.collection("movDocuments").where("departmentId", "==", identity.departmentId).get();
    const rows = (0, movReviewLogic_1.orderForReview)(snapshot.docs
        .filter((doc) => (0, movReviewLogic_1.awaitingReview)(doc.data()) && (0, whatsappStaff_1.inProgramme)(filter, doc.data().programId) && !(0, movReviewLogic_1.hiddenFrom)(doc.data(), identity.email))
        .map((doc) => (0, movReviewLogic_1.reviewRow)(doc.id, doc.data())));
    return ok({ movs: rows.slice(0, movReviewLogic_1.MAX_LISTED), total: rows.length, programme: filter.label });
}
exports.movReviewPending = movReviewPending;
/** One MOV, with what approving it would mean. */
async function movReviewDetail(identity, payload) {
    if (!isHod(identity))
        return fail(403, "not_permitted");
    const loaded = await reviewable(identity, payload.movId);
    if (isResult(loaded))
        return loaded;
    const mine = hodIds(identity);
    const open = await openQueries(loaded.ref.id);
    const ownOpen = open.filter((doc) => mine.has((0, whatsappCommon_1.clean)(doc.data().raisedById))).length;
    return ok({
        mov: (0, movReviewLogic_1.reviewRow)(loaded.ref.id, loaded.data),
        ownOpenQueries: ownOpen,
        otherOpenQueries: open.length - ownOpen,
        canQuery: !!(0, whatsappCommon_1.clean)(loaded.data.facilitatorId),
    });
}
exports.movReviewDetail = movReviewDetail;
/** Approve, as the web's Approve button does. */
async function movReviewApprove(identity, payload) {
    if (!isHod(identity))
        return fail(403, "not_permitted");
    const loaded = await reviewable(identity, payload.movId);
    if (isResult(loaded))
        return loaded;
    const now = firebase_1.admin.firestore.Timestamp.now();
    const actor = await actorOf(identity);
    const actorId = identity.uid || identity.id;
    const mine = hodIds(identity);
    const own = (await openQueries(loaded.ref.id)).filter((doc) => mine.has((0, whatsappCommon_1.clean)(doc.data().raisedById)));
    const batch = firebase_1.db.batch();
    own.forEach((doc) => batch.update(doc.ref, {
        status: "resolved",
        resolution: { notes: "Resolved when the MOV was approved.", attachmentUrl: null, resolvedById: actorId, resolvedBy: actor, resolvedAt: now },
        thread: firebase_1.admin.firestore.FieldValue.arrayUnion({ kind: "closed", message: "Resolved when the MOV was approved.", attachmentUrls: [], byId: actorId, by: actor, at: now }),
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
        approvalHistory: firebase_1.admin.firestore.FieldValue.arrayUnion({ action: "approved", at: now, byUid: identity.uid || null, byName: identity.name || null, via: "whatsapp" }),
    });
    await batch.commit();
    const row = (0, movReviewLogic_1.reviewRow)(loaded.ref.id, loaded.data);
    return ok({ approved: true, sme: row.sme, intervention: row.intervention, evidence: (0, movReviewLogic_1.hasEvidence)(loaded.data), resolvedQueries: own.length });
}
exports.movReviewApprove = movReviewApprove;
/** Keep the query the HOD wrote, so they can check it before it is sent. */
async function movReviewQueryDraft(identity, payload) {
    if (!isHod(identity))
        return fail(403, "not_permitted");
    const loaded = await reviewable(identity, payload.movId);
    if (isResult(loaded))
        return loaded;
    if (!(0, whatsappCommon_1.clean)(loaded.data.facilitatorId))
        return fail(409, "mov_no_facilitator");
    const type = movReviewLogic_1.QUERY_TYPES.includes((0, whatsappCommon_1.clean)(payload.type)) ? (0, whatsappCommon_1.clean)(payload.type) : "general-query";
    const checked = (0, movReviewLogic_1.checkQueryMessage)(payload.message);
    if ("problem" in checked)
        return fail(400, checked.problem);
    await drafts.doc(identity.id).set({ movId: loaded.ref.id, type, message: checked.message, createdAt: Date.now() });
    const row = (0, movReviewLogic_1.reviewRow)(loaded.ref.id, loaded.data);
    return ok({ draft: { movId: row.movId, sme: row.sme, intervention: row.intervention, facilitator: row.facilitator, typeLabel: movReviewLogic_1.QUERY_TYPE_LABELS[type], message: checked.message } });
}
exports.movReviewQueryDraft = movReviewQueryDraft;
/** The facilitator as the query's resolver: resolveWorkflowQueryActor in src/services/workflowQueryService.ts. */
async function resolverFor(mov) {
    const candidate = (0, whatsappCommon_1.clean)(mov.facilitatorId);
    for (const name of ["users", "coordinators", "consultants"]) {
        const snapshot = await firebase_1.db.collection(name).doc(candidate).get();
        if (!snapshot.exists)
            continue;
        const profile = snapshot.data() || {};
        if (name === "users")
            return { uid: snapshot.id, profileId: snapshot.id, profile };
        const authUid = (0, whatsappCommon_1.clean)(profile.authUid || profile.uid);
        if (authUid) {
            const user = await firebase_1.db.collection("users").doc(authUid).get();
            if (user.exists)
                return { uid: authUid, profileId: snapshot.id, profile: { ...profile, ...user.data() } };
        }
    }
    const email = (0, whatsappCommon_1.clean)(mov.facilitatorEmail).toLowerCase();
    if (email) {
        const matches = await firebase_1.db.collection("users").where("email", "==", email).get();
        if (matches.size === 1)
            return { uid: matches.docs[0].id, profileId: matches.docs[0].id, profile: matches.docs[0].data() };
    }
    return null;
}
/** Send the drafted query: raiseQuery in the web workspace. */
async function movReviewQuerySend(identity, payload) {
    if (!isHod(identity))
        return fail(403, "not_permitted");
    const draftRef = drafts.doc(identity.id);
    const draft = (await draftRef.get()).data();
    if (!draft || (0, whatsappCommon_1.clean)(draft.movId) !== (0, whatsappCommon_1.clean)(payload.movId) || Date.now() - Number(draft.createdAt || 0) > DRAFT_TTL_MS) {
        return fail(409, "no_query_draft");
    }
    const loaded = await reviewable(identity, draft.movId);
    if (isResult(loaded))
        return loaded;
    const mov = loaded.data;
    const resolver = await resolverFor(mov);
    if (!resolver)
        return fail(409, "mov_no_facilitator");
    const programId = (0, whatsappCommon_1.clean)(mov.programId);
    if (!programId)
        return fail(409, "mov_no_programme");
    const now = firebase_1.admin.firestore.FieldValue.serverTimestamp();
    const actor = await actorOf(identity);
    const profile = resolver.profile || {};
    await firebase_1.db.collection("workflowQueries").add({
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
            name: (0, whatsappCommon_1.clean)(profile.name || profile.displayName || mov.facilitatorName) || null,
            email: (0, whatsappCommon_1.clean)(profile.email || mov.facilitatorEmail).toLowerCase() || null,
            role: (0, whatsappCommon_1.clean)(profile.role || mov.facilitatorRole) || "coordinator",
            departmentId: (0, whatsappCommon_1.clean)(profile.departmentId) || null,
            departmentName: (0, whatsappCommon_1.clean)(profile.departmentName) || null,
        },
        assignedAt: now,
        target: { type: "mov", id: loaded.ref.id },
        context: {
            interventionId: (0, whatsappCommon_1.clean)(mov.interventionId) || null,
            interventionTitle: (0, whatsappCommon_1.clean)(mov.interventionTitle) || null,
            movId: loaded.ref.id,
            participantId: (0, whatsappCommon_1.clean)(mov.beneficiaryId || mov.smmeId) || null,
            departmentName: (0, whatsappCommon_1.clean)(mov.departmentName) || actor.departmentName,
            raisedVia: "whatsapp",
        },
        createdAt: now,
        updatedAt: now,
    });
    await loaded.ref.update({ status: "queried", approvedByHod: false, updatedAt: firebase_1.admin.firestore.Timestamp.now() });
    await draftRef.delete();
    const row = (0, movReviewLogic_1.reviewRow)(loaded.ref.id, mov);
    return ok({ queried: true, sme: row.sme, intervention: row.intervention, facilitator: row.facilitator });
}
exports.movReviewQuerySend = movReviewQuerySend;
async function movReviewCancel(identity) {
    await drafts.doc(identity.id).delete();
    return ok({ cancelled: true });
}
exports.movReviewCancel = movReviewCancel;
exports.MOV_REVIEW_ACTIONS = {
    mov_review_pending: movReviewPending,
    mov_review_detail: movReviewDetail,
    mov_review_approve: movReviewApprove,
    mov_review_query_draft: movReviewQueryDraft,
    mov_review_query_send: movReviewQuerySend,
    mov_review_cancel: movReviewCancel,
};
//# sourceMappingURL=whatsappMovReview.js.map