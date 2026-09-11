import { onRequest } from "firebase-functions/v2/https";
import { admin, db } from "./firebase";

type GatewayAction =
  | "resolve_identity"
  | "get_appointment"
  | "get_upcoming_appointments"
  | "get_meeting_link"
  | "appointment_accept"
  | "appointment_decline"
  | "appointment_reschedule_request";

type GatewayRequest = {
  action?: GatewayAction;
  phoneNumber?: string;
  appointmentId?: string;
  reason?: string | null;
  requestedDate?: string | null;
  requestedTime?: string | null;
  requestedDateText?: string | null;
  requestedTimeText?: string | null;
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

const appointmentSummary = (id: string, data: any) => ({
  id,
  participantId: clean(data?.participantId),
  interventionTitle: clean(data?.snapshot?.interventionTitle) || clean(data?.interventionTitle) || "Appointment",
  participantName: clean(data?.snapshot?.beneficiaryName) || clean(data?.participantName) || null,
  assigneeName: clean(data?.snapshot?.assigneeName) || clean(data?.assigneeName) || clean(data?.consultantName) || null,
  departmentName: clean(data?.snapshot?.departmentName) || clean(data?.departmentName) || null,
  date: clean(data?.schedule?.dateKey) || clean(data?.date) || null,
  startTime: timestampToIso(data?.schedule?.startAt || data?.startTime) || clean(data?.schedule?.startTime) || null,
  endTime: timestampToIso(data?.schedule?.endAt || data?.endTime) || clean(data?.schedule?.endTime) || null,
  deliveryMode: clean(data?.delivery?.mode) || clean(data?.deliveryMethod) || null,
  meetingLink: clean(data?.delivery?.meeting?.link) || clean(data?.meetingLink) || null,
  location: clean(data?.delivery?.location?.venue) || clean(data?.delivery?.location?.address) || clean(data?.location) || null,
  status: clean(data?.status) || "scheduled",
  beneficiaryConfirmation: clean(data?.beneficiaryConfirmation) || clean(data?.userConfirmation) || "pending",
  programId: clean(data?.programId) || null,
});

async function appointmentForParticipant(appointmentId: string, identity: ParticipantIdentity) {
  if (!appointmentId) return null;
  const snapshot = await db.collection("appointments").doc(appointmentId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  const participantId = clean(data.participantId);
  if (!identity.participantIds.includes(participantId)) return null;
  return { ref: snapshot.ref, id: snapshot.id, data };
}

async function upcomingAppointments(identity: ParticipantIdentity) {
  const rows = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const participantId of identity.participantIds) {
    const snapshot = await db.collection("appointments")
      .where("participantId", "==", participantId)
      .limit(100)
      .get();
    snapshot.docs.forEach((doc) => rows.set(doc.id, doc));
  }

  const now = Date.now();
  return Array.from(rows.values())
    .filter((doc) => {
      const data = doc.data() || {};
      const status = clean(data.status).toLowerCase();
      if (["cancelled", "completed"].includes(status)) return false;
      const start = data?.schedule?.startAt?.toDate?.() || data?.startTime?.toDate?.() || null;
      return !start || start.getTime() >= now - 60 * 60 * 1000;
    })
    .sort((a, b) => {
      const aData = a.data() || {};
      const bData = b.data() || {};
      const aTime = aData?.schedule?.startAt?.toMillis?.() || aData?.startTime?.toMillis?.() || Number.MAX_SAFE_INTEGER;
      const bTime = bData?.schedule?.startAt?.toMillis?.() || bData?.startTime?.toMillis?.() || Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })
    .slice(0, 10)
    .map((doc) => appointmentSummary(doc.id, doc.data()));
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
          appointment: appointmentSummary(appointment.id, appointment.data),
        });
        return;
      }

      if (action === "get_meeting_link") {
        const summary = appointmentSummary(appointment.id, appointment.data);
        json(res, 200, {
          ok: true,
          matched: true,
          identity,
          appointment: summary,
          meetingLink: summary.meetingLink,
        });
        return;
      }

      if (action === "appointment_accept") {
        await appointment.ref.set({
          beneficiaryConfirmation: "confirmed",
          userConfirmation: "confirmed",
          beneficiaryConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmationSource: "whatsapp",
          confirmationPhone: normalizePhone(phoneNumber),
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
          beneficiaryConfirmation: "declined",
          userConfirmation: "declined",
          declineReason: reason,
          beneficiaryDeclinedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmationSource: "whatsapp",
          confirmationPhone: normalizePhone(phoneNumber),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        json(res, 200, { ok: true, action, appointmentId, status: "declined" });
        return;
      }

      if (action === "appointment_reschedule_request") {
        await appointment.ref.set({
          rescheduleRequest: {
            status: "requested",
            reasonText: clean(payload.reason) || null,
            requestedDate: clean(payload.requestedDate) || null,
            requestedTime: clean(payload.requestedTime) || null,
            requestedDateText: clean(payload.requestedDateText) || null,
            requestedTimeText: clean(payload.requestedTimeText) || null,
            requestedVia: "whatsapp",
            requestedByParticipantId: identity.id,
            requestedByName: identity.participantName,
            requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        json(res, 200, { ok: true, action, appointmentId, status: "requested" });
        return;
      }

      json(res, 400, { ok: false, error: "unsupported_action" });
    } catch (error) {
      console.error("lphWhatsAppGateway.failed", error);
      json(res, 500, { ok: false, error: "processing_error" });
    }
  },
);
