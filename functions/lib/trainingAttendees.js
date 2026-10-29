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
exports.deleteTrainingSme = exports.manageTrainingAttendee = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const crypto = __importStar(require("crypto"));
const firebase_1 = require("./firebase");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const departmentRoles_1 = require("./departmentRoles");
const syntheticData_1 = require("./syntheticData");
/*
 * The people a Training Academy SME sends: its director (the enrollment's own
 * person, trainingAttendees/{enrollmentId}_director) and its employees. Staff
 * and the SME's director both manage them through this one callable, which
 * also creates each person's training_sme login. Employees can't call it.
 * See docs/training-academy-certification-and-employees-plan.md.
 */
const STAFF_ROLES = ["operations", "coordinator", "system_admin", "superadmin", "director", "projectadmin"];
const DEFAULT_PASSWORD = "Password@1";
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_URL = process.env.APP_LOGIN_URL || "https://lepharosmartinc.co.za/login";
const str = (v) => (typeof v === "string" ? v.trim() : "");
const directorAttendeeId = (enrollmentId) => `${enrollmentId}_director`;
const id = (value) => {
    const v = str(value);
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(v))
        throw new https_1.HttpsError("invalid-argument", "Invalid identifier.");
    return v;
};
const fail = (message) => {
    throw new https_1.HttpsError("failed-precondition", message);
};
/**
 * Staff, or the SME's own director: a training_sme login on this enrollment
 * with trainingRole director, or (before the backfill sets that) the
 * enrollment's own login. An employee is never allowed.
 */
async function authorise(uid, enrollmentId, enrollment) {
    const profile = (await firebase_1.db.doc(`users/${uid}`).get()).data() || {};
    const role = str(profile.role).toLowerCase();
    const name = str(profile.name) || str(profile.email) || "Someone";
    if (STAFF_ROLES.includes(role))
        return { uid, name, kind: "staff" };
    const isDirector = profile.trainingRole === "director" || (profile.trainingRole === undefined && str(enrollment.userId) === uid);
    if (role === "training_sme" && isDirector && str(profile.participantId) === enrollmentId) {
        return { uid, name, kind: "director" };
    }
    throw new https_1.HttpsError("permission-denied", "Only Training Academy staff or this SME's director can manage its people.");
}
async function loadEnrollment(enrollmentId) {
    const snap = await firebase_1.db.doc(`trainingEnrollments/${enrollmentId}`).get();
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", "This SME's enrollment no longer exists.");
    return snap.data();
}
const syntheticMark = (enrollmentId, enrollment) => (0, syntheticData_1.isSyntheticData)(enrollment, enrollmentId) ? { dataOrigin: "synthetic", suppressNotifications: true } : {};
function categoriesFor(input, training) {
    const allowed = new Set(Array.isArray(training?.categories) ? training.categories : []);
    const list = Array.isArray(input) ? input.map(str).filter(Boolean) : [];
    return Array.from(new Set(list.filter((c) => allowed.has(c))));
}
function idDocumentOf(value) {
    const v = value;
    return v && str(v.url) ? { url: str(v.url), name: str(v.name) || "ID copy" } : null;
}
/** One person per email across every training, so a login always means one person. */
async function assertEmailFree(email, exceptAttendeeId) {
    const taken = await firebase_1.db.collection("trainingAttendees").where("email", "==", email).where("status", "==", "active").limit(2).get();
    if (taken.docs.some((d) => d.id !== exceptAttendeeId))
        fail("Someone with this email is already registered for a training.");
}
/** The director's record, created from the enrollment the first time it's needed (before the backfill has run). */
async function ensureDirector(enrollmentId, enrollment, caller) {
    const ref = firebase_1.db.doc(`trainingAttendees/${directorAttendeeId(enrollmentId)}`);
    const existing = await ref.get();
    if (existing.exists)
        return { id: ref.id, data: existing.data() };
    const listed = (Array.isArray(enrollment.documents) ? enrollment.documents : []).find((d) => str(d?.label).toLowerCase() === "id copy" && str(d?.url));
    const now = new Date().toISOString();
    const data = {
        enrollmentId,
        trainingId: str(enrollment.trainingId),
        kind: "director",
        // Their existing invitations were sent to them as the attendee.
        attends: !(await firebase_1.db.collection("appointments").where("smeId", "==", enrollmentId).limit(1).get()).empty,
        name: str(enrollment.name) || str(enrollment.companyName),
        email: str(enrollment.email).toLowerCase(),
        phone: str(enrollment.details?.phone) || null,
        idNumber: str(enrollment.details?.idNumber) || null,
        idDocument: idDocumentOf(listed || enrollment.idDocument),
        categories: Array.isArray(enrollment.categories) ? enrollment.categories : [],
        ...(str(enrollment.userId) ? { userId: str(enrollment.userId) } : {}),
        status: "active",
        addedBy: { uid: caller.uid, role: caller.kind },
        ...syntheticMark(enrollmentId, enrollment),
        createdAt: now,
        updatedAt: now,
    };
    await ref.create(data);
    // Invitations now name the director, so their login must know who it is
    // (firestore.rules matches attendeeId against users.trainingAttendeeId).
    if (str(enrollment.userId)) {
        const user = (await firebase_1.db.doc(`users/${str(enrollment.userId)}`).get()).data();
        if (user?.role === "training_sme" && (!str(user.participantId) || str(user.participantId) === enrollmentId)) {
            await firebase_1.db.doc(`users/${str(enrollment.userId)}`).set({ trainingRole: "director", trainingAttendeeId: ref.id, participantId: enrollmentId, ...(str(user.trainingId) ? {} : { trainingId: str(enrollment.trainingId) }) }, { merge: true });
        }
    }
    return { id: ref.id, data };
}
/**
 * Creates the person's restricted training_sme login and links it. Never for
 * synthetic records, and never over an existing account. Returns why no login
 * was created, or null.
 */
async function provisionLogin(attendeeId, attendee, enrollmentId, enrollment, training, callerUid) {
    if (attendee.userId)
        return null;
    if (attendee.dataOrigin === "synthetic" || (0, syntheticData_1.isSyntheticData)(enrollment, enrollmentId))
        return "Synthetic record: no login is created.";
    if (enrollment.status !== "enrolled")
        return "The SME isn't enrolled in a training yet, so no login was created.";
    const email = str(attendee.email).toLowerCase();
    if (!EMAIL_RX.test(email))
        return "No valid email address, so no login was created.";
    const isDirector = attendee.kind === "director";
    // The director may already have the enrollment's login: link it rather than make a second one.
    if (isDirector && str(enrollment.userId)) {
        const uid = str(enrollment.userId);
        await firebase_1.db.doc(`users/${uid}`).set({ trainingRole: "director", trainingAttendeeId: attendeeId, trainingId: str(enrollment.trainingId) }, { merge: true });
        await firebase_1.db.doc(`trainingAttendees/${attendeeId}`).update({ userId: uid, updatedAt: new Date().toISOString() });
        return null;
    }
    try {
        await firebase_1.admin.auth().getUserByEmail(email);
        return "An account with this email already exists, so no new login was created.";
    }
    catch (error) {
        if (error?.code !== "auth/user-not-found")
            throw error;
    }
    const user = await firebase_1.admin.auth().createUser({ email, password: DEFAULT_PASSWORD, displayName: str(attendee.name) || email, emailVerified: false });
    await firebase_1.admin.auth().setCustomUserClaims(user.uid, { role: "training_sme", mustChangePassword: true, mustRegister: false });
    const now = firebase_1.admin.firestore.FieldValue.serverTimestamp();
    const companyName = str(enrollment.companyName);
    await firebase_1.db.doc(`users/${user.uid}`).set({
        uid: user.uid,
        email,
        name: str(attendee.name),
        role: "training_sme",
        status: "Active",
        phone: attendee.phone || null,
        mustRegister: false,
        mustChangePassword: true,
        passwordChangedAt: null,
        // participantId is the company for directors and employees alike.
        participantId: enrollmentId,
        trainingEnrollmentId: enrollmentId,
        trainingId: str(enrollment.trainingId),
        trainingAttendeeId: attendeeId,
        trainingRole: isDirector ? "director" : "employee",
        companyName,
        company: companyName,
        firstLoginComplete: true,
        digitalSignature: crypto.createHash("sha256").update(`${user.uid}|${email}|${Date.now()}|${crypto.randomBytes(8).toString("hex")}`).digest("hex"),
        createdAt: now,
        createdBy: callerUid,
        updatedAt: now,
    });
    await firebase_1.db.doc(`trainingAttendees/${attendeeId}`).update({ userId: user.uid, updatedAt: new Date().toISOString() });
    if (isDirector)
        await firebase_1.db.doc(`trainingEnrollments/${enrollmentId}`).update({ userId: user.uid });
    try {
        const trainingName = str(training?.name);
        const name = str(attendee.name) || "there";
        const intro = isDirector
            ? `You have been enrolled${trainingName ? ` in <b>${trainingName}</b>` : " in a training"} with <b>Lepharo</b>, and a portal account has been created for you${companyName ? ` and <b>${companyName}</b>` : ""}.`
            : `<b>${companyName || "Your company"}</b> has registered you for${trainingName ? ` <b>${trainingName}</b>` : " a training"} with <b>Lepharo</b>, and a portal account has been created for you.`;
        const what = isDirector
            ? "In the portal you can see your training dashboard, your appointments and your training plan."
            : "In the portal you can see the company's training progress, confirm the sessions you are invited to, and check in at a session by scanning its QR code.";
        await (0, emailShared_1.getTransporter)().sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: email,
            subject: "Your Lepharo training portal account",
            html: `<p>Hi ${name},</p><p>${intro}</p><p>${what}</p><p>Sign in <a href="${LOGIN_URL}">here</a> with your email address and this temporary password: <b>${DEFAULT_PASSWORD}</b></p><p>Please use the "Sign In" option, not "Create Account". You will be asked to choose a new password the first time you sign in.</p><p>If you were not expecting this email, please disregard it.</p>`,
            text: `Hi ${name},\n\n${intro.replace(/<[^>]+>/g, "")}\n\n${what}\n\nSign in here: ${LOGIN_URL}\nUse your email address and this temporary password: ${DEFAULT_PASSWORD}\n\nPlease use the "Sign In" option, not "Create Account". You will be asked to choose a new password the first time you sign in.\n`,
        });
    }
    catch (error) {
        logger.error("manageTrainingAttendee.welcome_email_failed", { attendeeId, err: String(error) });
    }
    return null;
}
/**
 * Cancels a withdrawn person's invitations to sessions that haven't started,
 * without emailing them, and corrects each session's invited count.
 */
async function cancelFutureInvitations(attendeeId) {
    const snap = await firebase_1.db.collection("appointments").where("attendeeId", "==", attendeeId).get();
    const now = Date.now();
    let cancelled = 0;
    for (const inv of snap.docs) {
        const data = inv.data();
        if (data.status === "cancelled" || data.attendance?.status === "attended" || !data.appointmentSessionId)
            continue;
        const sessionRef = firebase_1.db.doc(`appointmentSessions/${data.appointmentSessionId}`);
        await firebase_1.db.runTransaction(async (tx) => {
            const session = await tx.get(sessionRef);
            const startAt = session.data()?.startAt?.toMillis?.() ?? 0;
            if (!session.exists || startAt <= now)
                return;
            // suppressNotifications keeps the cancellation from emailing someone who has left.
            tx.update(inv.ref, { status: "cancelled", suppressNotifications: true, updatedAt: firebase_1.admin.firestore.Timestamp.now() });
            const summary = session.data()?.attendanceSummary || {};
            tx.update(sessionRef, {
                attendanceSummary: { ...summary, invitedCount: Math.max(Number(summary.invitedCount || 0) - 1, 0) },
                updatedAt: firebase_1.admin.firestore.Timestamp.now(),
            });
            cancelled += 1;
        });
    }
    return cancelled;
}
/** When a director changes the company's people, the training's staff hear about it straight away. */
async function notifyStaff(caller, enrollmentId, enrollment, training, message) {
    if (caller.kind !== "director" || (0, syntheticData_1.isSyntheticData)(enrollment, enrollmentId))
        return;
    const recipients = new Set([str(training?.owner), str(enrollment.owner)].filter(Boolean));
    try {
        const { roles, departments } = await (0, departmentRoles_1.loadDepartmentRoles)();
        const academy = departments.find((d) => d.id === roles.training);
        if (str(academy?.headUserId))
            recipients.add(str(academy.headUserId));
    }
    catch (error) {
        logger.warn("manageTrainingAttendee.academy_head_lookup_failed", { err: String(error) });
    }
    await (0, inAppNotifications_1.notifyInApp)({
        type: "training_people_changed",
        message: `${str(enrollment.companyName) || "An SME"}: ${message}`,
        recipientIds: Array.from(recipients),
        link: "/operations/training/enroll",
        enrollmentId,
    });
}
exports.manageTrainingAttendee = (0, https_1.onCall)({ timeoutSeconds: 60 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    const data = request.data || {};
    const action = str(data.action);
    const now = new Date().toISOString();
    // Every action names the person or, to add one, the company.
    let attendeeRef = null;
    let attendee = null;
    let enrollmentId;
    if (action === "add" || action === "ensureDirector") {
        enrollmentId = id(data.enrollmentId);
    }
    else {
        attendeeRef = firebase_1.db.doc(`trainingAttendees/${id(data.attendeeId)}`);
        const snap = await attendeeRef.get();
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "This person no longer exists.");
        attendee = snap.data();
        enrollmentId = str(attendee.enrollmentId);
    }
    const enrollment = await loadEnrollment(enrollmentId);
    const caller = await authorise(request.auth.uid, enrollmentId, enrollment);
    const trainingId = str(enrollment.trainingId);
    const training = trainingId ? (await firebase_1.db.doc(`trainings/${trainingId}`).get()).data() : undefined;
    if (action === "ensureDirector") {
        const director = await ensureDirector(enrollmentId, enrollment, caller);
        return { attendeeId: director.id };
    }
    if (action === "add") {
        await ensureDirector(enrollmentId, enrollment, caller);
        const name = str(data.name);
        const email = str(data.email).toLowerCase();
        if (!name)
            fail("Enter the person's name.");
        if (!EMAIL_RX.test(email))
            fail("Enter a valid email address: each person needs their own.");
        await assertEmailFree(email);
        const ref = firebase_1.db.collection("trainingAttendees").doc();
        const record = {
            enrollmentId,
            trainingId,
            kind: "employee",
            attends: true,
            name,
            email,
            phone: str(data.phone) || null,
            idNumber: str(data.idNumber) || null,
            idDocument: idDocumentOf(data.idDocument),
            categories: categoriesFor(data.categories, training),
            status: "active",
            addedBy: { uid: caller.uid, role: caller.kind },
            ...syntheticMark(enrollmentId, enrollment),
            createdAt: now,
            updatedAt: now,
        };
        await ref.create(record);
        const loginProblem = data.createLogin === false ? null : await provisionLogin(ref.id, record, enrollmentId, enrollment, training, caller.uid);
        await notifyStaff(caller, enrollmentId, enrollment, training, `${caller.name} added ${name}.`);
        return { attendeeId: ref.id, loginProblem };
    }
    if (!attendeeRef || !attendee)
        throw new https_1.HttpsError("invalid-argument", "Unknown action.");
    if (action === "update") {
        const patch = { updatedAt: now };
        if (data.name !== undefined) {
            if (!str(data.name))
                fail("Enter the person's name.");
            patch.name = str(data.name);
        }
        if (data.phone !== undefined)
            patch.phone = str(data.phone) || null;
        if (data.idNumber !== undefined)
            patch.idNumber = str(data.idNumber) || null;
        if (data.idDocument !== undefined)
            patch.idDocument = idDocumentOf(data.idDocument);
        if (data.categories !== undefined)
            patch.categories = categoriesFor(data.categories, training);
        if (data.email !== undefined && str(data.email).toLowerCase() !== attendee.email) {
            // The email is the login once one exists.
            if (attendee.userId)
                fail("The email can't change once the person has a login.");
            const email = str(data.email).toLowerCase();
            if (!EMAIL_RX.test(email))
                fail("Enter a valid email address.");
            await assertEmailFree(email, attendeeRef.id);
            patch.email = email;
        }
        if (data.attends !== undefined) {
            if (attendee.kind !== "director")
                fail("Employees always attend.");
            patch.attends = data.attends === true;
        }
        await attendeeRef.update(patch);
        return { attendeeId: attendeeRef.id };
    }
    if (action === "createLogin") {
        if (attendee.status !== "active")
            fail("This person has been withdrawn.");
        const loginProblem = await provisionLogin(attendeeRef.id, attendee, enrollmentId, enrollment, training, caller.uid);
        return { attendeeId: attendeeRef.id, loginProblem };
    }
    if (action === "withdraw") {
        if (attendee.kind === "director")
            fail("The director can't be withdrawn; discontinue the SME instead.");
        if (attendee.status === "withdrawn")
            return { attendeeId: attendeeRef.id, cancelledInvitations: 0 };
        const reason = str(data.reason);
        if (!reason)
            fail("Say why this person is being withdrawn.");
        await attendeeRef.update({ status: "withdrawn", withdrawnAt: now, withdrawnBy: caller.uid, withdrawnReason: reason, updatedAt: now });
        // Someone who has left mustn't keep access to the company's training.
        if (str(attendee.userId)) {
            await firebase_1.admin.auth().updateUser(str(attendee.userId), { disabled: true }).catch((error) => logger.error("manageTrainingAttendee.disable_login_failed", { attendeeId: attendeeRef.id, err: String(error) }));
            await firebase_1.db.doc(`users/${str(attendee.userId)}`).set({ status: "Inactive", updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        const cancelledInvitations = await cancelFutureInvitations(attendeeRef.id);
        await notifyStaff(caller, enrollmentId, enrollment, training, `${caller.name} withdrew ${str(attendee.name)} (${reason}).`);
        return { attendeeId: attendeeRef.id, cancelledInvitations };
    }
    throw new https_1.HttpsError("invalid-argument", "Unknown action.");
});
/** The Storage path of a Firebase download URL, or null for anything else. */
const storagePathOf = (url) => {
    const match = /\/o\/([^?]+)/.exec(str(url));
    return match ? decodeURIComponent(match[1]) : null;
};
/**
 * Staff delete an SME completely: for a record added by mistake or twice.
 * Anything with history (attendance recorded, a certificate issued) is
 * refused, because that history must stay: such an SME is discontinued
 * instead. Otherwise everything that belongs to it goes: the enrollment, its
 * people, invitations, progress, unsigned certificates, uploaded files and
 * the training logins that belong to it (never a login another SME uses).
 */
exports.deleteTrainingSme = (0, https_1.onCall)({ timeoutSeconds: 120 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    const role = str((await firebase_1.db.doc(`users/${request.auth.uid}`).get()).data()?.role).toLowerCase();
    if (!STAFF_ROLES.includes(role))
        throw new https_1.HttpsError("permission-denied", "Only Training Academy staff can delete an SME.");
    const enrollmentId = id(request.data?.enrollmentId);
    const enrollmentRef = firebase_1.db.doc(`trainingEnrollments/${enrollmentId}`);
    const enrollment = (await enrollmentRef.get()).data();
    if (!enrollment)
        throw new https_1.HttpsError("not-found", "This SME no longer exists.");
    const [attendeesSnap, invitationsSnap, certificatesSnap] = await Promise.all([
        firebase_1.db.collection("trainingAttendees").where("enrollmentId", "==", enrollmentId).get(),
        firebase_1.db.collection("appointments").where("smeId", "==", enrollmentId).get(),
        firebase_1.db.collection("trainingCertificates").where("enrollmentId", "==", enrollmentId).get(),
    ]);
    const attended = invitationsSnap.docs.filter((d) => d.data().attendance?.status === "attended").length;
    const certified = certificatesSnap.docs.filter((d) => ["issued", "revoked"].includes(d.data().status)).length;
    if (attended || certified) {
        fail(`This SME has ${[attended ? `${attended} attended session${attended === 1 ? "" : "s"}` : "", certified ? `${certified} certificate${certified === 1 ? "" : "s"}` : ""]
            .filter(Boolean)
            .join(" and ")} on record, which must be kept. Discontinue it instead.`);
    }
    // Invitations: deleting one sends no email (the appointment trigger ignores deletions); fix each session's count.
    const perSession = new Map();
    invitationsSnap.docs.forEach((d) => {
        const sessionId = str(d.data().appointmentSessionId);
        if (sessionId && d.data().status !== "cancelled")
            perSession.set(sessionId, (perSession.get(sessionId) || 0) + 1);
    });
    for (const [sessionId, removed] of perSession) {
        const ref = firebase_1.db.doc(`appointmentSessions/${sessionId}`);
        await firebase_1.db.runTransaction(async (tx) => {
            const session = await tx.get(ref);
            if (!session.exists)
                return;
            const summary = session.data()?.attendanceSummary || {};
            tx.update(ref, { attendanceSummary: { ...summary, invitedCount: Math.max(Number(summary.invitedCount || 0) - removed, 0) }, updatedAt: firebase_1.admin.firestore.Timestamp.now() });
        });
    }
    // Logins that belong to this SME only: its own training_sme accounts pointing at this enrollment.
    const candidateUids = new Set([str(enrollment.userId), ...attendeesSnap.docs.map((d) => str(d.data().userId))].filter(Boolean));
    const logins = [];
    for (const uid of candidateUids) {
        const user = (await firebase_1.db.doc(`users/${uid}`).get()).data();
        if (user?.role === "training_sme" && str(user.participantId) === enrollmentId)
            logins.push(uid);
    }
    for (const uid of logins) {
        await firebase_1.admin.auth().deleteUser(uid).catch((error) => {
            if (error?.code !== "auth/user-not-found")
                throw error;
        });
        await firebase_1.db.doc(`users/${uid}`).delete();
    }
    // Uploaded files: the people's ID copies, and the enrollment's own documents.
    const bucket = firebase_1.admin.storage().bucket();
    await bucket.deleteFiles({ prefix: `training_attendees/${enrollmentId}/` }).catch((error) => logger.warn("deleteTrainingSme.attendee_files", { enrollmentId, err: String(error) }));
    const documentUrls = [
        ...(Array.isArray(enrollment.documents) ? enrollment.documents.map((d) => d?.url) : []),
        ...["idDocument", "qualificationDocument", "cvDocument", "registrationFormDocument"].map((k) => enrollment[k]?.url),
    ];
    for (const path of new Set(documentUrls.map(storagePathOf).filter((p) => !!p && p.startsWith("training_enrollments/")))) {
        await bucket.file(path).delete({ ignoreNotFound: true }).catch((error) => logger.warn("deleteTrainingSme.document", { path, err: String(error) }));
    }
    // Firestore records, in batches.
    const refs = [
        ...invitationsSnap.docs.map((d) => d.ref),
        ...attendeesSnap.docs.map((d) => d.ref),
        ...certificatesSnap.docs.map((d) => d.ref),
        firebase_1.db.doc(`trainingCompanyProgress/${enrollmentId}`),
        enrollmentRef,
    ];
    for (let i = 0; i < refs.length; i += 400) {
        const batch = firebase_1.db.batch();
        refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
    logger.info("deleteTrainingSme.done", { enrollmentId, by: request.auth.uid, people: attendeesSnap.size, invitations: invitationsSnap.size, logins: logins.length });
    return { people: attendeesSnap.size, invitations: invitationsSnap.size, logins: logins.length };
});
//# sourceMappingURL=trainingAttendees.js.map