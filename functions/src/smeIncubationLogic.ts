export const SME_STATUSES = ['Active', 'Inactive', 'Dormant', 'Potential Exit'] as const;
export type SmeStatus = typeof SME_STATUSES[number] | 'Exited';
export const POTENTIAL_EXIT_DAYS = 80;
export const EXIT_QUALIFICATION_DAYS = 90;
const DAY = 86_400_000;
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function normalizeSmeStatus(value: unknown): SmeStatus {
  const status = lower(value);
  if (status === 'potential exit') return 'Potential Exit';
  if (status === 'inactive' || /^non[ -]?active$/.test(status)) return 'Inactive';
  if (status === 'dormant') return 'Dormant';
  if (status === 'exited' || status === 'exit') return 'Exited';
  return 'Active';
}

export function activityTime(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.seconds === 'number' ? value.seconds * 1000
    : value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}

/** Actual participation dates only: scheduling and generic edits never count. */
export function latestSmeActivity(assignments: any[], appointments: any[], now: number): number | null {
  const times: number[] = [];
  const add = (value: any) => {
    const time = activityTime(value);
    if (time !== null && time <= now) times.push(time);
  };
  for (const row of assignments) {
    if (['cancelled', 'canceled'].includes(lower(row.assignmentStatus))) continue;
    // Group completion can be copied to non-attendees: require individual confirmation.
    if (row.participantConfirmedAt) add(row.participantConfirmedAt);
    if (!row.groupKey && !row.isGroupAssignment && !row.groupId && lower(row.assignmentStatus) === 'completed') add(row.completedAt || row.assigneeCompletedAt);
    for (const entry of Object.values(row.sessionAttendanceByAppointment || {}) as any[]) {
      if (entry?.held !== false && lower(entry?.outcome) === 'attended') {
        add(entry.date || entry.attendedAt || entry.recordedAt);
      }
    }
  }
  for (const row of appointments) {
    if (['cancelled', 'canceled'].includes(lower(row.status))) continue;
    if (['absent', 'no_show', 'no-show'].includes(lower(row.attendance?.status))) continue;
    if (row.attendance?.checkedInAt) add(row.attendance.checkedInAt);
    else if (lower(row.attendance?.status) === 'attended') add(row.completedAt || row.date);
  }
  return times.length ? Math.max(...times) : null;
}

export function incubationState(application: any, participant: any = {}, lastActivity: number | null = null, now = Date.now()) {
  const previous = normalizeSmeStatus(application.incubationStatus ?? participant.incubationStatus);
  const recorded = activityTime(application.lastParticipationAt);
  const actual = [lastActivity, recorded].filter((t): t is number => t !== null && t <= now);
  const latest = actual.length ? Math.max(...actual) : null;
  const joined = [application.acceptedAt, application.dateAccepted, application.joinedAt, application.createdAt,
    participant.joinedAt, participant.createdAt].map(activityTime).find(t => t !== null && t <= now) ?? null;
  // Onboarding is a baseline, never presented as a participation event.
  const baseline = latest ?? joined;
  const days = baseline === null ? null : Math.max(0, Math.floor((now - baseline) / DAY));
  const changed = activityTime(application.incubationStatusChangedAt);
  const activityAtChange = activityTime(application.incubationStatusActivityAt);
  let status = previous;
  if (previous !== 'Exited') {
    if (days !== null && days >= POTENTIAL_EXIT_DAYS) status = 'Potential Exit';
    else if (latest !== null && changed !== null && latest > (activityAtChange ?? changed)) status = 'Active';
  }
  return {
    status,
    lastParticipationAt: latest === null ? null : new Date(latest).toISOString(),
    inactivityBaselineAt: baseline === null ? null : new Date(baseline).toISOString(),
    inactivityBaselineSource: latest !== null ? 'participation' : joined !== null ? 'onboarding' : 'unknown',
    inactiveDays: days,
    exitQualified: status !== 'Exited' && days !== null && days >= EXIT_QUALIFICATION_DAYS,
  };
}
