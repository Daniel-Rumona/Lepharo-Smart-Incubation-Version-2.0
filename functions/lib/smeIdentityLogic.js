"use strict";
// Pure rules for linking an SME login to its participant record
// (docs/sme-identity-migration-plan.md): users/{uid}.participantId and
// participants/{id}.uid. Shared by the linkMySmeAccount callable and
// createPlatformUser; scripts/sme-identity-plan.cjs applies the same rules in bulk.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickOwnParticipant = exports.participantIsLogins = exports.decideSmeLink = exports.isSmeRole = exports.normEmail = void 0;
const clean = (value) => String(value ?? "").trim();
const normEmail = (value) => clean(value).toLowerCase();
exports.normEmail = normEmail;
const normRole = (value) => clean(value).toLowerCase().replace(/\s+/g, "_");
const isSmeRole = (role) => normRole(role) === "incubatee";
exports.isSmeRole = isSmeRole;
/**
 * Whether login `uid` may be linked to `participantId`, and what is missing.
 * Never overwrites: a link already pointing elsewhere on either side refuses.
 * `otherClaimantUids` are other logins whose users.participantId is already this participant.
 */
function decideSmeLink(input) {
    const { uid, user, participantId, participant } = input;
    if (!user || !(0, exports.isSmeRole)(user.role))
        return { ok: false, reason: "not_sme" };
    if (!participant)
        return { ok: false, reason: "participant_missing" };
    const linkedId = clean(user.participantId);
    if (linkedId && linkedId !== participantId)
        return { ok: false, reason: "user_linked_elsewhere" };
    const linkedUid = clean(participant.uid);
    if (linkedUid && linkedUid !== uid)
        return { ok: false, reason: "participant_linked_elsewhere" };
    if ((input.otherClaimantUids || []).some((other) => other && other !== uid)) {
        return { ok: false, reason: "participant_claimed" };
    }
    return {
        ok: true,
        userPatch: linkedId ? null : { participantId },
        participantPatch: linkedUid ? null : { uid },
    };
}
exports.decideSmeLink = decideSmeLink;
/**
 * Whether a participant is this login's by id: it carries the login's uid, or the login
 * created it (createdByUid) and it is not linked to anyone yet.
 */
const participantIsLogins = (uid, data) => {
    const linkedUid = clean(data.uid);
    return linkedUid ? linkedUid === uid : clean(data.createdByUid) === uid;
};
exports.participantIsLogins = participantIsLogins;
/**
 * Which participant belongs to a login that is not linked yet: one that is the login's
 * by id (participantIsLogins), else the one participant with its email. Several matches
 * pick nothing.
 */
function pickOwnParticipant(input) {
    const unique = Array.from(new Map(input.candidates.map((c) => [c.id, c])).values());
    const byUid = unique.filter((c) => (0, exports.participantIsLogins)(input.uid, c.data));
    if (byUid.length)
        return byUid.length === 1 ? byUid[0].id : null;
    const email = (0, exports.normEmail)(input.email);
    if (!email)
        return null;
    const byEmail = unique.filter((c) => (0, exports.normEmail)(c.data.email) === email);
    return byEmail.length === 1 ? byEmail[0].id : null;
}
exports.pickOwnParticipant = pickOwnParticipant;
//# sourceMappingURL=smeIdentityLogic.js.map