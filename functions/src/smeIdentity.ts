import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "./firebase";
import { decideSmeLink, normEmail, participantIsLogins, pickOwnParticipant, type LinkDecision } from "./smeIdentityLogic";

// Links an SME login to its participant record, both ways
// (docs/sme-identity-migration-plan.md, Phase 2). users.participantId is a
// privileged field, so only this server code writes it.

const clean = (value: unknown) => String(value ?? "").trim();

/** Links login `uid` to `participantId` in one transaction. Never overwrites an existing link. */
export async function linkSmeIdentity(uid: string, participantId: string): Promise<LinkDecision> {
  const userRef = db.collection("users").doc(uid);
  const participantRef = db.collection("participants").doc(participantId);
  return db.runTransaction(async (transaction) => {
    const [userSnap, participantSnap, claimants] = await Promise.all([
      transaction.get(userRef),
      transaction.get(participantRef),
      transaction.get(db.collection("users").where("participantId", "==", participantId).limit(5)),
    ]);
    const decision = decideSmeLink({
      uid,
      user: userSnap.exists ? userSnap.data() || {} : null,
      participantId,
      participant: participantSnap.exists ? participantSnap.data() || {} : null,
      otherClaimantUids: claimants.docs.map((doc) => doc.id),
    });
    if (decision.ok) {
      if (decision.userPatch) transaction.update(userRef, decision.userPatch);
      if (decision.participantPatch) transaction.update(participantRef, decision.participantPatch);
    }
    return decision;
  });
}

/** Participants that could belong to a login: carrying its uid, created by it, or with its email as stored or lower-cased. */
async function candidateParticipants(uid: string, email: string) {
  const queries = [
    db.collection("participants").where("uid", "==", uid).limit(5).get(),
    db.collection("participants").where("createdByUid", "==", uid).limit(5).get(),
  ];
  const emails = Array.from(new Set([email, normEmail(email)].filter(Boolean)));
  emails.forEach((value) => queries.push(db.collection("participants").where("email", "==", value).limit(5).get()));
  const snaps = await Promise.all(queries);
  return snaps.flatMap((snap) => snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
}

/**
 * The signed-in SME links its own login. With a participantId (just after saving its
 * profile) that participant must already be the caller's: carrying its uid, created by it
 * and not linked yet, or with its email.
 * Without one, the caller's participant is found the same way and linked only if exactly
 * one matches. Answers { participantId } when linked, else { participantId: null, reason }.
 */
export const linkMySmeAccount = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = clean(request.auth?.uid);
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = clean(request.auth?.token.email);

  const user = (await db.collection("users").doc(uid).get()).data();
  const linkedId = clean(user?.participantId);
  const askedId = clean(request.data?.participantId);
  if (linkedId && (!askedId || askedId === linkedId)) {
    // Fills participants.uid if the other side is still missing.
    const decision = await linkSmeIdentity(uid, linkedId);
    return decision.ok ? { participantId: linkedId } : { participantId: null, reason: decision.reason };
  }

  const candidates = await candidateParticipants(uid, email);
  let participantId: string | null;
  if (askedId) {
    const asked = candidates.find((c) => c.id === askedId) ||
      await db.collection("participants").doc(askedId).get().then((snap) => snap.exists ? { id: snap.id, data: snap.data() || {} } : null);
    const owns = !!asked && (participantIsLogins(uid, asked.data) ||
      (!clean(asked.data.uid) && !!email && normEmail(asked.data.email) === normEmail(email)));
    if (!owns) throw new HttpsError("permission-denied", "That SME record is not yours.");
    participantId = askedId;
  } else {
    participantId = pickOwnParticipant({ uid, email, candidates });
    if (!participantId) return { participantId: null, reason: "no_unique_participant" };
  }

  const decision = await linkSmeIdentity(uid, participantId);
  if (!decision.ok) {
    logger.warn("linkMySmeAccount.refused", { uid, participantId, reason: decision.reason });
    return { participantId: null, reason: decision.reason };
  }
  return { participantId };
});
