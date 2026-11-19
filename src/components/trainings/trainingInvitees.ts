import type { TrainingAttendee, TrainingEnrollment } from './trainingStorage'

export const matchesTrainingCategory = (categories: string[] | undefined, category?: string | null) =>
    !category || !!categories?.includes(category)

/** Invitees for a session: one per attending person, or (SMEs whose people aren't on record yet) the enrollment itself. */
export type TrainingInvitee = { enrollment: TrainingEnrollment; attendee: TrainingAttendee | null };

/**
 * Who a training session invites. Enrolled SMEs' active, attending people in
 * the session's category (everyone when it has none). An enrolled SME with no
 * people on record yet (before the backfill) is invited as before, without a
 * person, so nothing changes for it until its people exist.
 */
export function trainingInvitees(
  enrollments: TrainingEnrollment[],
  attendees: TrainingAttendee[],
  category?: string | null
): TrainingInvitee[] {
  const byCompany = new Map<string, TrainingAttendee[]>();
  attendees.forEach((a) => byCompany.set(a.enrollmentId, [...(byCompany.get(a.enrollmentId) || []), a]));
  return enrollments
    .filter((e) => e.status === "enrolled")
    .flatMap((enrollment): TrainingInvitee[] => {
      const people = byCompany.get(enrollment.id);
      if (!people?.length) {
        return matchesTrainingCategory(enrollment.categories, category) ? [{ enrollment, attendee: null }] : [];
      }
      return people
        .filter((a) => a.status === "active" && a.attends && matchesTrainingCategory(a.categories, category))
        .map((attendee) => ({ enrollment, attendee }));
    });
}

/** "smeId" for an SME invited without a person, "smeId|attendeeId" otherwise: matches an invitation to its invitee. */
export const inviteeKey = (smeId: string, attendeeId?: string | null) => (attendeeId ? `${smeId}|${attendeeId}` : smeId);

