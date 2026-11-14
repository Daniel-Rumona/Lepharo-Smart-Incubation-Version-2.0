/**
 * The session prep brief: pure shaping of what is already recorded about an SME
 * and an intervention, so sessionCopilotLogic.test.cjs runs without Firebase.
 * sessionCopilot.ts reads Firestore and checks access; this decides what to show.
 */

export type BriefSession = {
  date: string; // ISO
  held: boolean | null;
  title: string;
  summary: string;
  reasonNotHeld: string;
  attendance: string; // attended | partially_attended | no_show | unverified | ""
  actions: string[];
  nextFocus: string;
};

export type BriefInput = {
  sessionStart: string; // ISO, the session being prepared for
  sessions: BriefSession[]; // every session of this intervention, any order
  plannedSessions: number;
  attendanceByAppointment: Record<string, { outcome?: string } | undefined>;
};

export type BriefHistory = {
  previous: BriefSession[]; // most recent first, at most `limit`
  heldCount: number;
  attendedCount: number;
  noShowCount: number;
  plannedSessions: number;
  openActions: string[]; // agreed at the last held session
  lastFocus: string; // what the last session said to do next
};

const clean = (value: unknown) => String(value ?? "").trim();

/** Earlier sessions only, newest first, plus the tallies and what was agreed last time. */
export function summariseHistory(input: BriefInput, limit = 3): BriefHistory {
  const before = input.sessions
    .filter((session) => session.date && session.date < input.sessionStart)
    .sort((a, b) => b.date.localeCompare(a.date));
  const recorded = before.filter((session) => session.held !== null);
  const outcomes = Object.values(input.attendanceByAppointment || {}).map((record) => clean(record?.outcome));
  const lastHeld = recorded.find((session) => session.held);
  return {
    previous: recorded.slice(0, limit),
    heldCount: recorded.filter((session) => session.held).length,
    attendedCount: outcomes.filter((outcome) => outcome === "attended").length,
    noShowCount: outcomes.filter((outcome) => outcome === "no_show").length,
    plannedSessions: Math.max(1, Number(input.plannedSessions) || 1),
    openActions: (lastHeld?.actions || []).map(clean).filter(Boolean).slice(0, 6),
    lastFocus: clean(lastHeld?.nextFocus),
  };
}

export type MetricRow = { month: string; revenue: number | null; jobs: number | null };

/** The latest month with figures, and the change from three months before it. */
export function businessSnapshot(rows: MetricRow[]) {
  const sorted = rows.filter((row) => /^\d{4}-\d{2}$/.test(row.month)).sort((a, b) => a.month.localeCompare(b.month));
  const latest = [...sorted].reverse().find((row) => row.revenue !== null || row.jobs !== null);
  if (!latest) return null;
  const [year, month] = latest.month.split("-").map(Number);
  const earlierKey = new Date(Date.UTC(year, month - 1 - 3, 1)).toISOString().slice(0, 7);
  const earlier = sorted.find((row) => row.month === earlierKey) || null;
  const change = (now: number | null, then: number | null | undefined) =>
    now === null || then === null || then === undefined ? null : now - then;
  return {
    month: latest.month,
    revenue: latest.revenue,
    jobs: latest.jobs,
    revenueChangePercent: latest.revenue !== null && earlier?.revenue
      ? Math.round(((latest.revenue - earlier.revenue) / earlier.revenue) * 1000) / 10
      : null,
    jobsChange: change(latest.jobs, earlier?.jobs),
  };
}

/** Who may see an SME's brief: the session's own facilitator, their department, or managers. */
export function canSeeBrief(
  viewer: { role: string; ids: string[]; email: string; departmentId: string },
  appointment: { assigneeId: string; assigneeEmail: string; departmentId: string }
) {
  const role = viewer.role.toLowerCase().replace(/\s+/g, "_");
  if (["director", "operations", "projectadmin", "system_admin", "superadmin"].includes(role)) return true;
  if (role !== "coordinator") return false;
  if (appointment.assigneeId && viewer.ids.includes(appointment.assigneeId)) return true;
  if (appointment.assigneeEmail && viewer.email && appointment.assigneeEmail.toLowerCase() === viewer.email.toLowerCase()) return true;
  return Boolean(viewer.departmentId && viewer.departmentId === appointment.departmentId);
}
