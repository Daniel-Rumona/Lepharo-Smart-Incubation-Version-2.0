import { useCallback, useEffect, useState } from "react";
import { Timestamp, collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase";
import type { Appointment, AppointmentSession, SmeConfirmation } from "@/types/appointment";
import type { TrainingPlanSession } from "./trainingStorage";
import { orderedPlan, planSessionLabel } from "./trainingPlan";
import { useMyEnrollment } from "./useMyEnrollment";

/** One person from the company invited to a session (shown to the director). */
export type AgendaPerson = {
  invitationId: string;
  attendeeId: string | null;
  name: string;
  kind: "director" | "employee" | null;
  confirmation: SmeConfirmation;
  attended: boolean;
  isMe: boolean;
};

export type AgendaEntry = {
  key: string;
  title: string;
  /** Shared by every occurrence of a repeating plan session. */
  seriesId?: string;
  description: string;
  topics: string[];
  /** The training category the session is for; null means everyone. */
  category?: string | null;
  courseIds: string[];
  startAt: Date | null;
  endAt: Date | null;
  deliveryMethod: string;
  location: string | null;
  meetingLink: string | null;
  facilitatorName: string;
  /** Booked session state; absent while the session is only planned. */
  status?: AppointmentSession["status"];
  /** The signed-in person's own invitation, if they are invited. */
  invitationId?: string;
  confirmation?: SmeConfirmation;
  attended?: boolean;
  /** Director only: everyone from the company invited to this session (themselves included). */
  people: AgendaPerson[];
};

/** Company-wide counts, without names: what an employee may see of colleagues. */
export type CompanyTotals = { invitations: number; held: number; attended: number; people: number };

const toDate = (value: unknown): Date | null =>
  value instanceof Timestamp ? value.toDate() : typeof value === "string" && value ? new Date(value) : null;

/**
 * The signed-in training SME's agenda: their training's plan sessions, joined
 * to the appointment invitations each booked session created (see
 * trainingPlan.ts), plus any other appointment the company was invited to.
 * A director sees every session and everyone invited from the company; an
 * employee sees only their own invitations and the planned sessions of their
 * categories.
 */
export function useMyAgenda() {
  const base = useMyEnrollment();
  const { enrollmentId, attendee, role, training, categories } = base;
  const [entries, setEntries] = useState<AgendaEntry[]>([]);
  const [companyTotals, setCompanyTotals] = useState<CompanyTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const myAttendeeId = attendee?.id || "";
  const isDirector = role === "director";

  useEffect(() => {
    if (base.loading) return;
    if (!enrollmentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "appointments"), where("smeId", "==", enrollmentId)));
        const companyInvitations = snap.docs
          .map((d) => ({ ...(d.data() as Appointment), id: d.id }))
          .filter((a) => a.status !== "cancelled" && a.appointmentSessionId);
        // An invitation without a person was sent to the whole SME before its people were set up: the director's.
        const isMine = (a: Appointment) => (a.attendeeId ? a.attendeeId === myAttendeeId : isDirector);
        const invitations = isDirector ? companyInvitations : companyInvitations.filter(isMine);
        const sessions = new Map<string, AppointmentSession>();
        await Promise.all(
          [...new Set(companyInvitations.map((a) => a.appointmentSessionId))].map(async (id) => {
            const s = await getDoc(doc(db, "appointmentSessions", id));
            if (s.exists()) sessions.set(id, s.data() as AppointmentSession);
          })
        );
        const bySession = new Map<string, (Appointment & { id: string })[]>();
        invitations.forEach((a) => bySession.set(a.appointmentSessionId, [...(bySession.get(a.appointmentSessionId) || []), a]));
        const peopleOf = (sessionId: string): AgendaPerson[] =>
          isDirector
            ? (bySession.get(sessionId) || []).map((a) => ({
                invitationId: a.id,
                attendeeId: a.attendeeId || null,
                name: a.attendeeName || a.smeName,
                kind: a.attendeeKind || (a.attendeeId ? null : "director"),
                confirmation: a.smeConfirmation,
                attended: a.attendance?.status === "attended",
                isMe: isMine(a),
              }))
            : [];
        const own = (sessionId: string) => (bySession.get(sessionId) || []).find(isMine);

        const fromPlan = (p: TrainingPlanSession): AgendaEntry => {
          const booked = p.appointmentSessionId ? sessions.get(p.appointmentSessionId) : undefined;
          const invitation = p.appointmentSessionId ? own(p.appointmentSessionId) : undefined;
          const invitedAnyone = !!p.appointmentSessionId && !!bySession.get(p.appointmentSessionId)?.length;
          return {
            key: p.id,
            title: planSessionLabel(p),
            seriesId: p.series?.id,
            description: p.description,
            topics: p.topics,
            category: p.category || null,
            courseIds: p.courseIds,
            startAt: booked ? toDate(booked.startAt) : toDate(p.startAt),
            endAt: booked ? toDate(booked.endAt) : toDate(p.endAt),
            deliveryMethod: booked?.deliveryMethod || p.deliveryMethod,
            location: booked ? booked.location : p.location || null,
            meetingLink: booked ? booked.meetingLink : p.meetingLink || null,
            facilitatorName: booked?.assigneeName || p.facilitatorName,
            status: booked?.status === "cancelled" ? "cancelled" : booked && invitedAnyone ? booked.status : undefined,
            invitationId: invitation?.id,
            confirmation: invitation?.smeConfirmation,
            attended: invitation?.attendance?.status === "attended",
            people: p.appointmentSessionId ? peopleOf(p.appointmentSessionId) : [],
          };
        };
        // An employee sees booked sessions only when invited, and planned ones only for their categories.
        const visibleToMe = (p: TrainingPlanSession) =>
          isDirector ||
          (p.appointmentSessionId
            ? !!own(p.appointmentSessionId)
            : !p.category || !categories.length || categories.includes(p.category));
        const plan = orderedPlan(training?.plan || []).filter(visibleToMe);
        const planned = new Set((training?.plan || []).map((p) => p.appointmentSessionId).filter(Boolean));
        const others: AgendaEntry[] = [...bySession.entries()]
          .filter(([sessionId]) => !planned.has(sessionId) && sessions.has(sessionId))
          .map(([sessionId, list]) => {
            const s = sessions.get(sessionId)!;
            const invitation = own(sessionId);
            return {
              key: list[0].id,
              title: s.title || list[0].interventionTitle,
              description: (s.plannedCoverage || []).join(" "),
              topics: s.plannedTopics || [],
              category: s.category || null,
              courseIds: [],
              startAt: toDate(s.startAt),
              endAt: toDate(s.endAt),
              deliveryMethod: s.deliveryMethod,
              location: s.location,
              meetingLink: s.meetingLink,
              facilitatorName: s.assigneeName,
              status: s.status,
              invitationId: invitation?.id,
              confirmation: invitation?.smeConfirmation,
              attended: invitation?.attendance?.status === "attended",
              people: peopleOf(sessionId),
            };
          });
        const all = [...plan.map(fromPlan), ...others].filter((e) => e.status !== "cancelled");
        const dated = all.filter((e) => e.startAt).sort((a, b) => a.startAt!.getTime() - b.startAt!.getTime());

        // Counts only: an employee sees company totals, never colleagues' names.
        const heldSessions = new Set(
          [...sessions.entries()].filter(([, s]) => s.status === "completed").map(([id]) => id)
        );
        const heldInvitations = companyInvitations.filter((a) => heldSessions.has(a.appointmentSessionId));
        const totals: CompanyTotals = {
          invitations: heldInvitations.length,
          held: heldSessions.size,
          attended: heldInvitations.filter((a) => a.attendance?.status === "attended").length,
          people: new Set(companyInvitations.map((a) => a.attendeeId || "sme")).size,
        };
        if (!cancelled) {
          setEntries([...dated, ...all.filter((e) => !e.startAt)]);
          setCompanyTotals(totals);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your agenda.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base.loading, enrollmentId, myAttendeeId, isDirector, training, categories, retry]);

  /** Marks one invitation's reply in the loaded entries (the viewer's own, or a colleague's for the director). */
  const applyReply = (invitationIds: Set<string>, confirmation: SmeConfirmation) =>
    setEntries((list) =>
      list.map((e) => ({
        ...e,
        ...(e.invitationId && invitationIds.has(e.invitationId) ? { confirmation } : {}),
        people: e.people.map((p) => (invitationIds.has(p.invitationId) ? { ...p, confirmation } : p)),
      }))
    );

  /**
   * The rules let a person change only their own response fields on their
   * invitation; the director may also answer for the company's people.
   */
  const respond = useCallback(async (invitationId: string, confirmation: SmeConfirmation, reason?: string) => {
    await updateDoc(doc(db, "appointments", invitationId), {
      smeConfirmation: confirmation,
      smeDeclineReason: confirmation === "declined" ? reason || null : null,
      updatedAt: Timestamp.now(),
    });
    applyReply(new Set([invitationId]), confirmation);
  }, []);

  /** Confirms every upcoming, booked occurrence of a series the viewer hasn't confirmed yet. */
  const respondSeries = useCallback(
    async (seriesId: string) => {
      const now = Date.now();
      const targets = entries.filter(
        (e) => e.seriesId === seriesId && e.invitationId && e.confirmation !== "confirmed" && e.startAt && e.startAt.getTime() > now
      );
      await Promise.all(
        targets.map((e) => updateDoc(doc(db, "appointments", e.invitationId!), { smeConfirmation: "confirmed", smeDeclineReason: null, updatedAt: Timestamp.now() }))
      );
      applyReply(new Set(targets.map((e) => e.invitationId!)), "confirmed");
      return targets.length;
    },
    [entries]
  );

  const now = Date.now();
  // Upcoming: the viewer's sessions, or for a director any session someone from the company is invited to.
  const upcoming = entries.filter(
    (e) => e.startAt && (e.endAt || e.startAt).getTime() >= now && e.status !== "completed" && (e.invitationId || e.people.length || !e.status)
  );

  return {
    ...base,
    entries,
    upcoming,
    companyTotals,
    agendaLoading: base.loading || loading,
    agendaError: error,
    respond,
    respondSeries,
    reload: () => setRetry((n) => n + 1),
  };
}
