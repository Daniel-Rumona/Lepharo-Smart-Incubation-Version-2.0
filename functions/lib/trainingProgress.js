"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeTrainingProgress = exports.onTrainingCertificateWritten = exports.onTrainingDefaultsWritten = exports.onTrainingRulesUpdated = exports.onTrainingEnrollmentUpdated = exports.onTrainingAttendeeWritten = exports.onTrainingCourseProgressWritten = exports.onTrainingSessionUpdated = exports.onTrainingInvitationWritten = exports.recomputeEnrollment = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("./firebase");
const trainingProgressDomain_1 = require("./trainingProgressDomain");
/*
 * Keeps Training Academy certification progress current: each person's
 * trainingAttendees.progress and the company's name-free totals in
 * trainingCompanyProgress/{enrollmentId}. One SME (enrollment) is recomputed
 * at a time from its invitations, sessions, courses, documents and
 * certificates; the triggers below decide which SMEs a change touches.
 * See docs/training-academy-certification-and-employees-plan.md, section 4.
 */
const REGION = "us-central1";
const STAFF_ROLES = ["operations", "coordinator", "system_admin", "superadmin", "director", "projectadmin"];
const str = (v) => (typeof v === "string" ? v.trim() : "");
const isTrainingGroup = (groupKey) => str(groupKey).startsWith("training:");
const directorAttendeeId = (enrollmentId) => `${enrollmentId}_director`;
/** A session counts once it was held: completed, or coverage says it took place (and not that it didn't). */
const wasHeld = (s) => !!s && s.status !== "cancelled" && s.coverage?.held !== false && (s.status === "completed" || s.coverage?.held === true);
/** Course facts for a learner (by uid), from their academyEnrollments and the course revision they took. */
async function courseFacts(uid, courseIds, titles) {
    return Promise.all(courseIds.map(async (courseId) => {
        const enrollment = (await firebase_1.db.doc(`academyEnrollments/${uid}_${courseId}`).get()).data();
        if (!enrollment)
            return { courseId, title: titles.get(courseId) || "a course", required: 1, completed: 0, scores: [] };
        const version = (await firebase_1.db.doc(`academyVersions/${courseId}_${enrollment.revision}`).get()).data();
        const items = Array.isArray(version?.items) ? version.items : [];
        const required = items.filter((i) => i.required);
        const progress = enrollment.items || {};
        return {
            courseId,
            title: str(version?.title) || titles.get(courseId) || "a course",
            required: required.length,
            completed: required.filter((i) => progress[i.id]?.status === "completed").length,
            scores: items
                .filter((i) => (i.kind === "quiz" || i.kind === "test") && typeof progress[i.id]?.score === "number")
                .map((i) => progress[i.id].score),
        };
    }));
}
/** Recomputes every person of one SME and the company totals. Writes only what changed. */
async function recomputeEnrollment(enrollmentId) {
    const enrollmentSnap = await firebase_1.db.doc(`trainingEnrollments/${enrollmentId}`).get();
    if (!enrollmentSnap.exists)
        return;
    const enrollment = enrollmentSnap.data();
    const trainingId = str(enrollment.trainingId);
    if (!trainingId)
        return;
    const [trainingSnap, settingsSnap, attendeesSnap, invitationsSnap, certificatesSnap] = await Promise.all([
        firebase_1.db.doc(`trainings/${trainingId}`).get(),
        firebase_1.db.doc("trainingSettings/certification").get(),
        firebase_1.db.collection("trainingAttendees").where("enrollmentId", "==", enrollmentId).get(),
        firebase_1.db.collection("appointments").where("smeId", "==", enrollmentId).get(),
        firebase_1.db.collection("trainingCertificates").where("enrollmentId", "==", enrollmentId).get(),
    ]);
    const training = trainingSnap.data() || {};
    const settings = (0, trainingProgressDomain_1.effectiveCertification)(settingsSnap.data(), training.certification);
    const now = new Date().toISOString();
    // Plan sessions and series, so any occurrence of a required series counts.
    const plan = Array.isArray(training.plan) ? training.plan : [];
    const groupOf = new Map(plan.map((p) => [str(p.id), str(p.series?.id) || str(p.id)]));
    const categoryOf = new Map(plan.map((p) => [str(p.id), str(p.category) || null]));
    const planTitles = {};
    plan.forEach((p) => (planTitles[groupOf.get(str(p.id))] = str(p.title)));
    const invitations = invitationsSnap.docs
        .map((d) => d.data())
        .filter((a) => isTrainingGroup(a.groupKey) && a.status !== "cancelled" && str(a.appointmentSessionId));
    const sessions = new Map();
    await Promise.all([...new Set(invitations.map((a) => str(a.appointmentSessionId)))].map(async (id) => {
        sessions.set(id, (await firebase_1.db.doc(`appointmentSessions/${id}`).get()).data());
    }));
    const factOf = (a) => {
        const session = sessions.get(str(a.appointmentSessionId));
        const planId = str(a.subInterventionId);
        return {
            planGroup: groupOf.get(planId) || planId || null,
            category: str(session?.category) || categoryOf.get(planId) || null,
            held: wasHeld(session),
            attended: a.attendance?.status === "attended",
        };
    };
    const certificates = certificatesSnap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((c) => c.status === "issued");
    const companyMissing = (0, trainingProgressDomain_1.missingCompanyDocuments)(enrollment, training.requiredDocuments);
    const courseTitles = new Map();
    const requiredCourses = (settings.rules.requiredCourseIds || []).filter((id) => (training.courseIds || []).includes(id));
    const people = attendeesSnap.docs.length
        ? attendeesSnap.docs.map((d) => ({ id: d.id, data: d.data() }))
        : [{ id: null, data: { kind: "director", attends: true, status: "active", categories: enrollment.categories || [], userId: enrollment.userId } }];
    const results = [];
    for (const person of people) {
        const p = person.data;
        if (p.status === "withdrawn")
            continue;
        const isDirector = p.kind === "director";
        const attendeeId = person.id || directorAttendeeId(enrollmentId);
        // An invitation without a person was sent to the whole SME before its people were set up: the director's.
        const theirs = invitations.filter((a) => (str(a.attendeeId) ? str(a.attendeeId) === attendeeId : isDirector)).map(factOf);
        // Courses are the director's for now.
        const userId = str(p.userId);
        const courses = isDirector && userId ? await courseFacts(userId, requiredCourses, courseTitles) : null;
        const personMissing = [...companyMissing];
        if (!isDirector && !str(p.idNumber))
            personMissing.push("ID number");
        if (!isDirector && !p.idDocument)
            personMissing.push("ID copy");
        const certificate = certificates.find((c) => (person.id ? c.attendeeId === person.id : false));
        const progress = (0, trainingProgressDomain_1.evaluate)({
            rules: settings.rules,
            invitations: theirs,
            categories: Array.isArray(p.categories) ? p.categories : [],
            courses,
            planTitles,
            documentsOk: personMissing.length === 0,
            documentsMissing: personMissing,
            overridden: !!p.eligibilityOverride,
            certificateId: certificate?.id || null,
            now,
        });
        results.push({ person, progress });
    }
    // Write each person's progress; the trainingAttendees trigger ignores progress-only changes.
    await Promise.all(results
        .filter(({ person, progress }) => person.id && (0, trainingProgressDomain_1.progressChanged)(person.data.progress, progress))
        .map(({ person, progress }) => firebase_1.db.doc(`trainingAttendees/${person.id}`).update({ progress })));
    const attending = results.filter(({ person }) => person.data.attends !== false);
    const all = attending.flatMap(({ person }) => invitations.filter((a) => (str(a.attendeeId) ? str(a.attendeeId) === person.id : person.data.kind === "director")));
    const facts = all.map(factOf);
    const held = facts.filter((f) => f.held);
    const attendedCount = held.filter((f) => f.attended).length;
    // Company mode: the SME as a whole against the same rules.
    let companyEligibility;
    let companyCertificateId = null;
    if (settings.awardTo === "company") {
        const director = results.find(({ person }) => person.data.kind === "director");
        const directorUid = str(director?.person.data.userId);
        companyCertificateId = certificates.find((c) => !c.attendeeId)?.id || null;
        companyEligibility = (0, trainingProgressDomain_1.evaluate)({
            rules: settings.rules,
            invitations: facts,
            categories: [...new Set(attending.flatMap(({ person }) => (Array.isArray(person.data.categories) ? person.data.categories : [])))],
            courses: directorUid ? await courseFacts(directorUid, requiredCourses, courseTitles) : null,
            planTitles,
            documentsOk: companyMissing.length === 0,
            documentsMissing: companyMissing,
            overridden: !!enrollment.certificationOverride,
            certificateId: companyCertificateId,
            now,
        }).eligibility;
    }
    const summary = {
        enrollmentId,
        trainingId,
        people: results.length,
        attendingPeople: attending.length,
        sessionsHeld: new Set(all.filter((a) => wasHeld(sessions.get(str(a.appointmentSessionId)))).map((a) => str(a.appointmentSessionId))).size,
        attendances: attendedCount,
        invitations: held.length,
        attendancePercent: held.length ? Math.round((attendedCount / held.length) * 100) : 0,
        eligiblePeople: results.filter(({ progress }) => progress.eligibility.status === "eligible").length,
        certifiedPeople: results.filter(({ progress }) => progress.eligibility.status === "certified").length,
        certificationEnabled: settings.enabled,
        awardTo: settings.awardTo,
        ...(companyEligibility ? { companyEligibility, companyCertificateId } : {}),
        // Copied so staff lists and synthetic filters don't need the enrollment.
        ...(enrollment.dataOrigin === "synthetic" ? { dataOrigin: "synthetic" } : {}),
        updatedAt: now,
    };
    await firebase_1.db.doc(`trainingCompanyProgress/${enrollmentId}`).set(summary);
}
exports.recomputeEnrollment = recomputeEnrollment;
async function recomputeMany(enrollmentIds, reason) {
    for (const id of new Set([...enrollmentIds].filter(Boolean))) {
        try {
            await recomputeEnrollment(id);
        }
        catch (error) {
            logger.error("trainingProgress.recompute_failed", { enrollmentId: id, reason, err: String(error) });
        }
    }
}
async function enrollmentsOfTraining(trainingId) {
    const snap = await firebase_1.db.collection("trainingEnrollments").where("trainingId", "==", trainingId).get();
    return snap.docs.filter((d) => d.data().status !== "unassigned").map((d) => d.id);
}
const changed = (before, after, keys) => keys.some((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
/** An invitation's attendance or RSVP changed. */
exports.onTrainingInvitationWritten = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "appointments/{apptId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const data = after || before;
    if (!data || !isTrainingGroup(data.groupKey))
        return;
    // Replies don't affect eligibility; attendance does.
    if (before && after && !changed(before, after, ["attendance", "status", "attendeeId"]))
        return;
    await recomputeMany([str(data.smeId)], "invitation");
});
/** A session was held, or its coverage recorded. */
exports.onTrainingSessionUpdated = (0, firestore_1.onDocumentUpdated)({ region: REGION, document: "appointmentSessions/{sessionId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || !isTrainingGroup(after.groupKey))
        return;
    if (!changed(before, after, ["status", "coverage", "category"]))
        return;
    const invitations = await firebase_1.db.collection("appointments").where("appointmentSessionId", "==", event.params.sessionId).get();
    await recomputeMany(invitations.docs.map((d) => str(d.data().smeId)), "session");
});
/** A director's course progress moved. */
exports.onTrainingCourseProgressWritten = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "academyEnrollments/{id}" }, async (event) => {
    const data = event.data?.after?.data() || event.data?.before?.data();
    const uid = str(data?.learnerId);
    if (!uid)
        return;
    const profile = (await firebase_1.db.doc(`users/${uid}`).get()).data();
    if (profile?.role !== "training_sme" || profile.trainingRole === "employee")
        return;
    await recomputeMany([str(profile.participantId)], "course");
});
/** A person was added, edited, withdrawn or given an override (their progress alone changing is ignored). */
exports.onTrainingAttendeeWritten = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "trainingAttendees/{attendeeId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const data = after || before;
    if (!data)
        return;
    if (before && after && !changed(before, after, ["attends", "categories", "status", "eligibilityOverride", "idNumber", "idDocument", "userId"]))
        return;
    await recomputeMany([str(data.enrollmentId)], "attendee");
});
/** The SME's documents, categories, status or company override changed. */
exports.onTrainingEnrollmentUpdated = (0, firestore_1.onDocumentUpdated)({ region: REGION, document: "trainingEnrollments/{enrollmentId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!changed(before, after, ["documents", "categories", "status", "trainingId", "certificationOverride", "idDocument", "qualificationDocument", "cvDocument", "registrationFormDocument"]))
        return;
    await recomputeMany([event.params.enrollmentId], "enrollment");
});
/** The training's rules, plan, courses or required documents changed. */
exports.onTrainingRulesUpdated = (0, firestore_1.onDocumentUpdated)({ region: REGION, document: "trainings/{trainingId}" }, async (event) => {
    if (!changed(event.data?.before.data(), event.data?.after.data(), ["certification", "plan", "courseIds", "requiredDocuments"]))
        return;
    await recomputeMany(await enrollmentsOfTraining(event.params.trainingId), "training");
});
/** The global defaults changed: every SME in a training. */
exports.onTrainingDefaultsWritten = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "trainingSettings/{settingId}" }, async (event) => {
    if (event.params.settingId !== "certification")
        return;
    const snap = await firebase_1.db.collection("trainingEnrollments").where("status", "in", ["enrolled", "discontinued"]).get();
    await recomputeMany(snap.docs.map((d) => d.id), "defaults");
});
/** A certificate was issued or revoked. */
exports.onTrainingCertificateWritten = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "trainingCertificates/{certificateId}" }, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (before?.status === after?.status)
        return;
    await recomputeMany([str((after || before)?.enrollmentId)], "certificate");
});
/** Staff: recompute one SME, a whole training, or (no arguments) every enrolled SME. Used after migration. */
exports.recomputeTrainingProgress = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 540 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    const role = str((await firebase_1.db.doc(`users/${request.auth.uid}`).get()).data()?.role).toLowerCase();
    if (!STAFF_ROLES.includes(role))
        throw new https_1.HttpsError("permission-denied", "Only Training Academy staff can recompute progress.");
    const enrollmentId = str(request.data?.enrollmentId);
    const trainingId = str(request.data?.trainingId);
    const ids = enrollmentId
        ? [enrollmentId]
        : trainingId
            ? await enrollmentsOfTraining(trainingId)
            : (await firebase_1.db.collection("trainingEnrollments").where("status", "in", ["enrolled", "discontinued"]).get()).docs.map((d) => d.id);
    await recomputeMany(ids, "manual");
    return { recomputed: ids.length };
});
//# sourceMappingURL=trainingProgress.js.map