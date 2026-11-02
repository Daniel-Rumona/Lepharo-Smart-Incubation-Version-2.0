// Pure rules for linking an SME login to its participant record
// (docs/sme-identity-migration-plan.md): users/{uid}.participantId and
// participants/{id}.uid. Shared by the linkMySmeAccount callable and
// createPlatformUser; scripts/sme-identity-plan.cjs applies the same rules in bulk.

const clean = (value: unknown) => String(value ?? "").trim();
export const normEmail = (value: unknown) => clean(value).toLowerCase();
const normRole = (value: unknown) => clean(value).toLowerCase().replace(/\s+/g, "_");

export const isSmeRole = (role: unknown) => normRole(role) === "incubatee";

export type LinkRefusal =
  | "not_sme"
  | "participant_missing"
  | "user_linked_elsewhere"
  | "participant_linked_elsewhere"
  | "participant_claimed";

// One shape rather than a union: functions/ compiles without strictNullChecks,
// which a union on `ok` would need to narrow.
export type LinkDecision = {
  ok: boolean;
  reason?: LinkRefusal;
  userPatch?: { participantId: string } | null;
  participantPatch?: { uid: string } | null;
};

/**
 * Whether login `uid` may be linked to `participantId`, and what is missing.
 * Never overwrites: a link already pointing elsewhere on either side refuses.
 * `otherClaimantUids` are other logins whose users.participantId is already this participant.
 */
export function decideSmeLink(input: {
  uid: string;
  user: Record<string, any> | null;
  participantId: string;
  participant: Record<string, any> | null;
  otherClaimantUids?: string[];
}): LinkDecision {
  const { uid, user, participantId, participant } = input;
  if (!user || !isSmeRole(user.role)) return { ok: false, reason: "not_sme" };
  if (!participant) return { ok: false, reason: "participant_missing" };

  const linkedId = clean(user.participantId);
  if (linkedId && linkedId !== participantId) return { ok: false, reason: "user_linked_elsewhere" };
  const linkedUid = clean(participant.uid);
  if (linkedUid && linkedUid !== uid) return { ok: false, reason: "participant_linked_elsewhere" };
  if ((input.otherClaimantUids || []).some((other) => other && other !== uid)) {
    return { ok: false, reason: "participant_claimed" };
  }

  return {
    ok: true,
    userPatch: linkedId ? null : { participantId },
    participantPatch: linkedUid ? null : { uid },
  };
}

/**
 * Which participant belongs to a login that is not linked yet: one already carrying
 * its uid, else the one participant with its email. Several matches pick nothing.
 */
export function pickOwnParticipant(input: {
  uid: string;
  email: string;
  candidates: { id: string; data: Record<string, any> }[];
}): string | null {
  const unique = Array.from(new Map(input.candidates.map((c) => [c.id, c])).values());
  const byUid = unique.filter((c) => clean(c.data.uid) === input.uid);
  if (byUid.length) return byUid.length === 1 ? byUid[0].id : null;

  const email = normEmail(input.email);
  if (!email) return null;
  const byEmail = unique.filter((c) => normEmail(c.data.email) === email);
  return byEmail.length === 1 ? byEmail[0].id : null;
}
