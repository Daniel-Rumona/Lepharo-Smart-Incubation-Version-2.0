"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lphWhatsAppGateway = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const whatsappCommon_1 = require("./whatsappCommon");
const whatsappStaff_1 = require("./whatsappStaff");
const json = (res, status, body) => {
    res.status(status).json(body);
};
const gatewaySecret = () => (0, whatsappCommon_1.clean)(process.env.WHATSAPP_GATEWAY_SECRET);
const isAuthorized = (req) => {
    const expected = gatewaySecret();
    const supplied = (0, whatsappCommon_1.clean)(req.get("X-WhatsApp-Gateway-Secret"));
    return Boolean(expected && supplied && supplied === expected);
};
const participantNameFrom = (data) => (0, whatsappCommon_1.clean)(data?.beneficiaryName) ||
    (0, whatsappCommon_1.clean)(data?.participantName) ||
    (0, whatsappCommon_1.clean)(data?.businessName) ||
    (0, whatsappCommon_1.clean)(data?.companyName) ||
    (0, whatsappCommon_1.clean)(data?.name) ||
    "SME";
const participantIdsFrom = (id, data) => Array.from(new Set([
    id,
    (0, whatsappCommon_1.clean)(data?.participantId),
    (0, whatsappCommon_1.clean)(data?.uid),
].filter(Boolean)));
async function resolveParticipantByPhone(phoneNumber) {
    const digits = (0, whatsappCommon_1.normalizePhone)(phoneNumber);
    if (digits.length < 8)
        return null;
    const candidates = (0, whatsappCommon_1.candidatePhoneValues)(digits);
    const exactMatches = new Map();
    for (const candidate of candidates) {
        const snapshot = await firebase_1.db.collection("participants").where("phone", "==", candidate).limit(3).get();
        snapshot.docs.forEach((doc) => exactMatches.set(doc.id, doc));
    }
    let matches = Array.from(exactMatches.values());
    if (matches.length !== 1) {
        const suffix = digits.slice(-9);
        const snapshot = await firebase_1.db.collection("participants").limit(1000).get();
        matches = snapshot.docs.filter((doc) => {
            const stored = (0, whatsappCommon_1.normalizePhone)(doc.data()?.phone);
            return suffix.length >= 8 && stored.length >= 8 && stored.slice(-9) === suffix;
        });
    }
    if (matches.length !== 1)
        return null;
    const match = matches[0];
    const data = match.data() || {};
    return {
        id: match.id,
        participantIds: participantIdsFrom(match.id, data),
        participantName: participantNameFrom(data),
        phoneNumber: (0, whatsappCommon_1.clean)(data.phone) || phoneNumber,
        email: (0, whatsappCommon_1.clean)(data.email) || null,
        programId: (0, whatsappCommon_1.clean)(data.programId) || null,
        uid: (0, whatsappCommon_1.clean)(data.uid) || null,
        kind: "sme",
        name: participantNameFrom(data),
        role: "incubatee",
    };
}
// A v5 appointment (SME invitation) carries no schedule/delivery/food data of
// its own; those live on the appointmentSessions document it points to via
// appointmentSessionId. Every summary and mutation here works off the joined
// pair, matching the canonical shapes in src/types/appointment.ts.
const appointmentSummary = (id, data, session) => ({
    id,
    interventionTitle: (0, whatsappCommon_1.clean)(data?.interventionTitle) || (0, whatsappCommon_1.clean)(session?.interventionTitle) || "Appointment",
    assigneeName: (0, whatsappCommon_1.clean)(data?.assigneeName) || null,
    date: session?.startAt?.toDate ? session.startAt.toDate().toISOString().slice(0, 10) : null,
    startTime: (0, whatsappCommon_1.timestampToIso)(session?.startAt),
    endTime: (0, whatsappCommon_1.timestampToIso)(session?.endAt),
    deliveryMode: (0, whatsappCommon_1.clean)(session?.deliveryMethod) || null,
    meetingLink: (0, whatsappCommon_1.clean)(session?.meetingLink) || null,
    location: (0, whatsappCommon_1.clean)(session?.location) || null,
    status: (0, whatsappCommon_1.clean)(data?.status) || "scheduled",
    smeConfirmation: (0, whatsappCommon_1.clean)(data?.smeConfirmation) || "pending",
    programId: (0, whatsappCommon_1.clean)(data?.programId) || null,
});
async function fetchSessionsByIds(ids) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const result = new Map();
    const chunkSize = 10;
    for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        if (!chunk.length)
            continue;
        const snapshot = await firebase_1.db.collection("appointmentSessions")
            .where(firebase_1.admin.firestore.FieldPath.documentId(), "in", chunk)
            .get();
        snapshot.docs.forEach((doc) => result.set(doc.id, doc.data() || {}));
    }
    return result;
}
async function appointmentForParticipant(appointmentId, identity) {
    if (!appointmentId)
        return null;
    const snapshot = await firebase_1.db.collection("appointments").doc(appointmentId).get();
    if (!snapshot.exists)
        return null;
    const data = snapshot.data() || {};
    const smeId = (0, whatsappCommon_1.clean)(data.smeId);
    if (!identity.participantIds.includes(smeId))
        return null;
    const sessionId = (0, whatsappCommon_1.clean)(data.appointmentSessionId);
    const sessionSnapshot = sessionId ? await firebase_1.db.collection("appointmentSessions").doc(sessionId).get() : null;
    const session = sessionSnapshot?.exists ? sessionSnapshot.data() || {} : {};
    return { ref: snapshot.ref, id: snapshot.id, data, session };
}
async function upcomingAppointments(identity) {
    const rows = new Map();
    for (const participantId of identity.participantIds) {
        const snapshot = await firebase_1.db.collection("appointments")
            .where("smeId", "==", participantId)
            .limit(100)
            .get();
        snapshot.docs.forEach((doc) => rows.set(doc.id, doc));
    }
    const candidates = Array.from(rows.values()).filter((doc) => {
        const status = (0, whatsappCommon_1.clean)(doc.data()?.status).toLowerCase();
        return !["cancelled", "completed"].includes(status);
    });
    const sessions = await fetchSessionsByIds(candidates.map((doc) => (0, whatsappCommon_1.clean)(doc.data()?.appointmentSessionId)));
    const now = Date.now();
    return candidates
        .map((doc) => ({ doc, session: sessions.get((0, whatsappCommon_1.clean)(doc.data()?.appointmentSessionId)) || {} }))
        .filter(({ session }) => {
        const start = session?.startAt?.toDate?.() || null;
        return !start || start.getTime() >= now - 60 * 60 * 1000;
    })
        .sort((a, b) => {
        const aTime = a.session?.startAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        const bTime = b.session?.startAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
    })
        .slice(0, 10)
        .map(({ doc, session }) => appointmentSummary(doc.id, doc.data(), session));
}
exports.lphWhatsAppGateway = (0, https_1.onRequest)({
    region: "us-central1",
    invoker: "public",
    secrets: ["WHATSAPP_GATEWAY_SECRET"],
}, async (req, res) => {
    if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
    }
    if (!isAuthorized(req)) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return;
    }
    const payload = (req.body || {});
    const action = payload.action;
    const phoneNumber = (0, whatsappCommon_1.clean)(payload.phoneNumber);
    if (!action || !phoneNumber) {
        json(res, 400, { ok: false, error: "invalid_request" });
        return;
    }
    try {
        const identity = await resolveParticipantByPhone(phoneNumber);
        if (!identity) {
            // Not an SME: this may be a Lepharo staff member with the number on their user profile.
            const staff = await (0, whatsappStaff_1.resolveStaffByPhone)(phoneNumber);
            if (!staff) {
                json(res, 200, { ok: true, matched: false });
                return;
            }
            if (action === "resolve_identity") {
                json(res, 200, {
                    ok: true,
                    matched: true,
                    identity: {
                        id: staff.id,
                        participantIds: [],
                        participantName: staff.name,
                        phoneNumber: staff.phoneNumber,
                        email: staff.email,
                        programId: null,
                        uid: staff.uid,
                        kind: "staff",
                        name: staff.name,
                        role: staff.role,
                        roleGroup: staff.roleGroup,
                        departmentId: staff.departmentId,
                        branchId: staff.branchId,
                    },
                });
                return;
            }
            if (!whatsappStaff_1.STAFF_ACTIONS.has(action)) {
                json(res, 403, { ok: false, error: "action_not_available_for_staff" });
                return;
            }
            const result = await (0, whatsappStaff_1.handleStaffAction)(action, staff, payload);
            json(res, result.status, result.body);
            return;
        }
        if (action === "resolve_identity") {
            json(res, 200, { ok: true, matched: true, identity });
            return;
        }
        if (action === "get_upcoming_appointments") {
            const appointments = await upcomingAppointments(identity);
            json(res, 200, { ok: true, matched: true, identity, appointments });
            return;
        }
        const appointmentId = (0, whatsappCommon_1.clean)(payload.appointmentId);
        const appointment = await appointmentForParticipant(appointmentId, identity);
        if (!appointment) {
            json(res, 404, { ok: false, error: "appointment_not_found_or_not_authorized" });
            return;
        }
        if (action === "get_appointment") {
            json(res, 200, {
                ok: true,
                matched: true,
                identity,
                appointment: appointmentSummary(appointment.id, appointment.data, appointment.session),
            });
            return;
        }
        if (action === "get_meeting_link") {
            const summary = appointmentSummary(appointment.id, appointment.data, appointment.session);
            json(res, 200, {
                ok: true,
                matched: true,
                identity,
                appointment: summary,
                meetingLink: summary.meetingLink,
            });
            return;
        }
        if (action === "get_food_menu") {
            const menu = Array.isArray(appointment.session?.foodMenu) ? appointment.session.foodMenu : [];
            const selections = Array.isArray(appointment.data?.foodSelections) ? appointment.data.foodSelections : [];
            json(res, 200, {
                ok: true,
                matched: true,
                identity,
                foodMenu: menu.map((item) => ({
                    id: (0, whatsappCommon_1.clean)(item?.id),
                    name: (0, whatsappCommon_1.clean)(item?.name),
                    category: (0, whatsappCommon_1.clean)(item?.category),
                })).filter((item) => item.id && item.name),
                foodSelections: selections,
            });
            return;
        }
        if (action === "appointment_accept") {
            await appointment.ref.set({
                smeConfirmation: "confirmed",
                updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            json(res, 200, { ok: true, action, appointmentId, status: "confirmed" });
            return;
        }
        if (action === "appointment_decline") {
            const reason = (0, whatsappCommon_1.clean)(payload.reason);
            if (!reason) {
                json(res, 400, { ok: false, error: "decline_reason_required" });
                return;
            }
            await appointment.ref.set({
                smeConfirmation: "declined",
                smeDeclineReason: reason,
                updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            json(res, 200, { ok: true, action, appointmentId, status: "declined" });
            return;
        }
        if (action === "appointment_reschedule_request") {
            // The v5 schema has no standalone "reschedule while still pending" state:
            // smeRescheduleRequest only carries concrete slot proposals attached to a
            // decline, and WhatsApp has no slot picker to produce those. Recording the
            // request as a decline with the requested wording folded into the reason
            // keeps it visible to the programme team without inventing a status the
            // rest of the app does not know how to read.
            const whenText = [(0, whatsappCommon_1.clean)(payload.requestedDateText), (0, whatsappCommon_1.clean)(payload.requestedTimeText)]
                .filter(Boolean)
                .join(" at ");
            const reasonText = [
                `Requested reschedule via WhatsApp${whenText ? ` to ${whenText}` : ""}`,
                (0, whatsappCommon_1.clean)(payload.reason),
            ].filter(Boolean).join(" — ");
            await appointment.ref.set({
                smeConfirmation: "declined",
                smeDeclineReason: reasonText,
                updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            json(res, 200, { ok: true, action, appointmentId, status: "declined" });
            return;
        }
        if (action === "select_food_items") {
            const menu = Array.isArray(appointment.session?.foodMenu) ? appointment.session.foodMenu : [];
            const requested = Array.isArray(payload.foodItems) ? payload.foodItems.map(whatsappCommon_1.clean).filter(Boolean) : [];
            const chosen = requested
                .map((name) => menu.find((item) => (0, whatsappCommon_1.clean)(item?.name).toLowerCase() === name.toLowerCase()))
                .filter(Boolean)
                .map((item) => (0, whatsappCommon_1.clean)(item.id))
                .filter(Boolean);
            if (!chosen.length) {
                json(res, 400, {
                    ok: false,
                    error: "no_matching_food_items",
                    foodMenu: menu.map((item) => (0, whatsappCommon_1.clean)(item?.name)).filter(Boolean),
                });
                return;
            }
            const foodSelections = Array.from(new Set(chosen)).map((menuItemId) => ({ menuItemId, quantity: 1 }));
            await appointment.ref.set({
                foodSelections,
                updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            json(res, 200, { ok: true, action, appointmentId, foodSelections });
            return;
        }
        json(res, 400, { ok: false, error: "unsupported_action" });
    }
    catch (error) {
        console.error("lphWhatsAppGateway.failed", error);
        json(res, 500, { ok: false, error: "processing_error" });
    }
});
//# sourceMappingURL=whatsappGateway.js.map