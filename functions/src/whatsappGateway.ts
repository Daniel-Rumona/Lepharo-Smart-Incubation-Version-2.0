import { onRequest } from "firebase-functions/v2/https";
import { admin, db } from "./firebase";

type GatewayAction =
  | "resolve_identity"
  | "get_appointment"
  | "get_upcoming_appointments"
  | "get_meeting_link"
  | "get_food_menu"
  | "appointment_accept"
  | "appointment_decline"
  | "appointment_reschedule_request"
  | "select_food_items";

type GatewayRequest = {
  action?: GatewayAction;
  phoneNumber?: string;
  appointmentId?: string;
  reason?: string | null;
  requestedDate?: string | null;
  requestedTime?: string | null;
  requestedDateText?: string | null;
  requestedTimeText?: string | null;
  foodItems?: string[];
};

type ParticipantIdentity = {
  id: string;
  participantIds: string[];
  participantName: string;
  phoneNumber: string;
  email: string | null;
  programId: string | null;
  uid: string | null;
};

const normalizePhone = (value: unknown) => String(value || "").replace(/[^0-9]/g, "");
const clean = (value: unknown) => String(value || "").trim();

const json = (res: any, status: number, body: unknown) => {
  res.status(status).json(body);
};

const gatewaySecret = () => clean(process.env.WHATSAPP_GATEWAY_SECRET);

const isAuthorized = (req: any) => {
  const expected = gatewaySecret();
  const supplied = clean(req.get("X-WhatsApp-Gateway-Secret"));
  return Boolean(expected && supplied && supplied === expected);
};

const candidatePhoneValues = (digits: string) => {
  const values = new Set<string>();
  if (!digits) return [];
  values.add(digits);
  values.add(`+${digits}`);

  if (digits.startsWith("27") && digits.length >= 11) {
    values.add(`0${digits.slice(2)}`);
  }
  if (digits.startsWith("263") && digits.length >= 12) {
    values.add(`0${digits.slice(3)}`);
  }

  return Array.from(values);
};

const participantNameFrom = (data: any) =>
  clean(data?.beneficiaryName) ||
  clean(data?.participantName) ||
  clean(data?.businessName) ||
  clean(data?.companyName) ||
  clean(data?.name) ||
  "SME";

const participantIdsFrom = (id: string, data: any) => Array.from(new Set([
  id,
  clean(data?.participantId),
  clean(data?.uid),
].filter(Boolean)));

async function resolveParticipantByPhone(phoneNumber: string): Promise<ParticipantIdentity | null> {
  const digits = normalizePhone(phoneNumber);
  if (digits.length < 8) return null;

  const candidates = candidatePhoneValues(digits);
  const exactMatches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  for (const candidate of candidates) {
    const snapshot = await db.collection("participants").where("phone", "==", candidate).limit(3).get();
    snapshot.docs.forEach((doc) => exactMatches.set(doc.id, doc));
  }

  let matches = Array.from(exactMatches.values());

  if (matches.length !== 1) {
    const suffix = digits.slice(-9);
    const snapshot = await db.collection("participants").limit(1000).get();
    matches = snapshot.docs.filter((doc) => {
      const stored = normalizePhone(doc.data()?.phone);
      return suffix.length >= 8 && stored.length >= 8 && stored.slice(-9) === suffix;
    });
  }

  if (matches.length !== 1) return null;

  const match = matches[0];
  const data = match.data() || {};
  return {
    id: match.id,
    participantIds: participantIdsFrom(match.id, data),
    participantName: participantNameFrom(data),
    phoneNumber: clean(data.phone) || phoneNumber,
    email: clean(data.email) || null,
    programId: clean(data.programId) || null,
    uid: clean(data.uid) || null,
  };
}

const timestampToIso = (value: any): string | null => {
  try {
    if (value?.toDate && typeof value.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value || null;
    return null;
  } catch {
    return null;
  }
};

// A v5 appointment (SME invitation) carries no schedule/delivery/food data of
// its own; those live on the appointmentSessions document it points to via
// appointmentSessionId. Every summary and mutation here works off the joined
// pair, matching the canonical shapes in src/types/appointment.ts.
const appointmentSummary = (id: string, data: any, session: any) => ({
  id,
  interventionTitle: clean(data?.interventionTitle) || clean(session?.interventionTitle) || "Appointment",
  assigneeName: clean(data?.assigneeName) || null,
  date: session?.startAt?.toDate ? session.startAt.toDate().toISOString().slice(0, 10) : null,
  startTime: timestampToIso(session?.startAt),
  endTime: timestampToIso(session?.endAt),
  deliveryMode: clean(session?.deliveryMethod) || null,
  meetingLink: clean(session?.meetingLink) || null,
  location: clean(session?.location) || null,
  status: clean(data?.status) || "scheduled",
  smeConfirmation: clean(data?.smeConfirmation) || "pending",
  programId: clean(data?.programId) || null,
});

async function fetchSessionsByIds(ids: string[]): Promise<Map<string, any>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map<string, any>();
  const chunkSize = 10;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const snapshot = await db.collection("appointmentSessions")
      .where(admin.firestore.FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => result.set(doc.id, doc.data() || {}));
  }
  return result;
}

async function appointmentForParticipant(appointmentId: string, identity: ParticipantIdentity) {
  if (!appointmentId) return null;
  const snapshot = await db.collection("appointments").doc(appointmentId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  const smeId = clean(data.smeId);
  if (!identity.participantIds.includes(smeId)) return null;
  const sessionId = clean(data.appointmentSessionId);
  const sessionSnapshot = sessionId ? await db.collection("appointmentSessions").doc(sessionId).get() : null;
  const session = sessionSnapshot?.exists ? sessionSnapshot.data() || {} : {};
  return { ref: snapshot.ref, id: snapshot.id, data, session };
}

async function upcomingAppointments(identity: ParticipantIdentity) {
  const rows = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const participantId of identity.participantIds) {
    const snapshot = await db.collection("appointments")
      .where("smeId", "==", participantId)
      .limit(100)
      .get();
    snapshot.docs.forEach((doc) => rows.set(doc.id, doc));
  }

  const candidates = Array.from(rows.values()).filter((doc) => {
    const status = clean(doc.data()?.status).toLowerCase();
    return !["cancelled", "completed"].includes(status);
  });

  const sessions = await fetchSessionsByIds(
    candidates.map((doc) => clean(doc.data()?.appointmentSessionId)),
  );

  const now = Date.now();
  return candidates
    .map((doc) => ({ doc, session: sessions.get(clean(doc.data()?.appointmentSessionId)) || {} }))
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

export const lphWhatsAppGateway = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    secrets: ["WHATSAPP_GATEWAY_SECRET"],
  },
  async (req, res): Promise<void> => {
    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    if (!isAuthorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const payload = (req.body || {}) as GatewayRequest;
    const action = payload.action;
    const phoneNumber = clean(payload.phoneNumber);

    if (!action || !phoneNumber) {
      json(res, 400, { ok: false, error: "invalid_request" });
      return;
    }

    try {
      const identity = await resolveParticipantByPhone(phoneNumber);
      if (!identity) {
        json(res, 200, { ok: true, matched: false });
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

      const appointmentId = clean(payload.appointmentId);
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
          foodMenu: menu.map((item: any) => ({
            id: clean(item?.id),
            name: clean(item?.name),
            category: clean(item?.category),
          })).filter((item: any) => item.id && item.name),
          foodSelections: selections,
        });
        return;
      }

      if (action === "appointment_accept") {
        await appointment.ref.set({
          smeConfirmation: "confirmed",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        json(res, 200, { ok: true, action, appointmentId, status: "confirmed" });
        return;
      }

      if (action === "appointment_decline") {
        const reason = clean(payload.reason);
        if (!reason) {
          json(res, 400, { ok: false, error: "decline_reason_required" });
          return;
        }
        await appointment.ref.set({
          smeConfirmation: "declined",
          smeDeclineReason: reason,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        const whenText = [clean(payload.requestedDateText), clean(payload.requestedTimeText)]
          .filter(Boolean)
          .join(" at ");
        const reasonText = [
          `Requested reschedule via WhatsApp${whenText ? ` to ${whenText}` : ""}`,
          clean(payload.reason),
        ].filter(Boolean).join(" — ");
        await appointment.ref.set({
          smeConfirmation: "declined",
          smeDeclineReason: reasonText,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        json(res, 200, { ok: true, action, appointmentId, status: "declined" });
        return;
      }

      if (action === "select_food_items") {
        const menu = Array.isArray(appointment.session?.foodMenu) ? appointment.session.foodMenu : [];
        const requested = Array.isArray(payload.foodItems) ? payload.foodItems.map(clean).filter(Boolean) : [];
        const chosen = requested
          .map((name) => menu.find((item: any) => clean(item?.name).toLowerCase() === name.toLowerCase()))
          .filter(Boolean)
          .map((item: any) => clean(item.id))
          .filter(Boolean);
        if (!chosen.length) {
          json(res, 400, {
            ok: false,
            error: "no_matching_food_items",
            foodMenu: menu.map((item: any) => clean(item?.name)).filter(Boolean),
          });
          return;
        }
        const foodSelections = Array.from(new Set(chosen)).map((menuItemId) => ({ menuItemId, quantity: 1 }));
        await appointment.ref.set({
          foodSelections,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        json(res, 200, { ok: true, action, appointmentId, foodSelections });
        return;
      }

      json(res, 400, { ok: false, error: "unsupported_action" });
    } catch (error) {
      console.error("lphWhatsAppGateway.failed", error);
      json(res, 500, { ok: false, error: "processing_error" });
    }
  },
);
