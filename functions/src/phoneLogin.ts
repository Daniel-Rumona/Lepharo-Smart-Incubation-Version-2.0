import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { createHash, randomBytes } from "crypto";
import { admin, db } from "./firebase";
import { linkSmeIdentity } from "./smeIdentity";
import { isSmeRole } from "./smeIdentityLogic";
import {
  CODE_TTL_MS,
  decideCodeCheck,
  decideCodeSend,
  hashLoginCode,
  newLoginCode,
  normalizeLoginPhone,
  recentSends,
  type CodePurpose,
  type StoredCode,
} from "./phoneLoginLogic";

// SME phone sign-in (docs/sme-identity-migration-plan.md, Phase 5). A six-digit code goes to the
// number on WhatsApp (the router's "login_code" dispatch, an authentication template); a correct
// code returns a custom token for the login that number belongs to.
//
//   phoneIndex/{digits}      -> { uid, source }   one login per number; server-only
//   smeLoginCodes/{digits}   -> hashed code, purpose, expiry, attempts, recent sends; server-only
//   smeLoginCodeIps/{ipHash} -> recent sends from one caller IP; server-only
//
// An existing SME's number is the one it confirmed for WhatsApp updates (onSmeWhatsAppNumber keeps
// the index in step); a phone-only SME's is the one it registered or staff added it with.

const clean = (value: unknown) => String(value ?? "").trim();
const indexRef = (digits: string) => db.collection("phoneIndex").doc(digits);
const codeRef = (digits: string) => db.collection("smeLoginCodes").doc(digits);
const ipRef = (request: CallableRequest) => db.collection("smeLoginCodeIps").doc(
  createHash("sha256").update(clean(request.rawRequest?.ip) || "unknown").digest("hex").slice(0, 40),
);
const INACTIVE = new Set(["inactive", "disabled", "deleted"]);
const NEUTRAL_CODE_ERROR = "That code is wrong or has expired. Request a new one.";

function requirePhone(value: unknown) {
  const digits = normalizeLoginPhone(value);
  if (!digits) throw new HttpsError("invalid-argument", "Enter a valid mobile number, e.g. 082 123 4567.");
  return digits;
}

/** The SME login a number belongs to, if it may sign in. */
async function smeLoginFor(digits: string): Promise<string | null> {
  const entry = await indexRef(digits).get();
  const uid = clean(entry.get("uid"));
  if (!uid) return null;
  const [user, authUser] = await Promise.all([
    db.collection("users").doc(uid).get(),
    admin.auth().getUser(uid).catch(() => null),
  ]);
  if (!user.exists || !isSmeRole(user.get("role")) || INACTIVE.has(clean(user.get("status")).toLowerCase())) return null;
  if (!authUser || authUser.disabled) return null;
  return uid;
}

/** Sends the code through the router's dispatch endpoint. Never throws. */
async function dispatchLoginCode(digits: string, code: string, dedupeKey: string): Promise<boolean> {
  const url = clean(process.env.WHATSAPP_DISPATCH_URL);
  const secret = clean(process.env.WHATSAPP_DISPATCH_SECRET);
  if (!url || !secret) {
    logger.error("phoneLogin.dispatchNotConfigured");
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-whatsapp-dispatch-secret": secret },
      body: JSON.stringify({ engine: "LPH", type: "login_code", to: digits, code, dedupeKey }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) logger.warn("phoneLogin.dispatchRejected", { status: response.status });
    return response.ok;
  } catch (error) {
    logger.warn("phoneLogin.dispatchFailed", { error: String(error) });
    return false;
  }
}

/**
 * Checks a code for `purpose` and uses it up when right. A wrong code costs an attempt.
 * Throws a neutral error on any failure.
 */
async function consumeCode(digits: string, code: string, purpose: CodePurpose, uid?: string) {
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(codeRef(digits));
    const stored = (snap.data() || null) as (StoredCode & { sends?: number[] }) | null;
    const decision = decideCodeCheck({ now, stored, code, purpose, uid });
    if (decision.ok) {
      // Keep the send history for the rate limit; drop the code itself.
      transaction.set(codeRef(digits), { sends: recentSends(stored?.sends, now) });
      return;
    }
    if (decision.burnsAttempt) transaction.update(codeRef(digits), { attempts: (stored?.attempts || 0) + 1 });
    throw new HttpsError("permission-denied", decision.reason === "too_many_attempts"
      ? "Too many wrong codes. Request a new one."
      : NEUTRAL_CODE_ERROR);
  });
}

/**
 * Asks for a WhatsApp code. `purpose`: "login" (the number belongs to an SME), "register" (a new
 * phone-only SME) or "change" (the signed-in SME moves its login to this number). The reply is the
 * same whether or not a code was sent, so the endpoint can't be used to find registered numbers;
 * only the rate limits answer differently.
 */
export const requestSmeLoginCode = onCall({ timeoutSeconds: 30 }, async (request) => {
  const purpose = clean(request.data?.purpose || "login") as CodePurpose;
  if (!["login", "register", "change"].includes(purpose)) throw new HttpsError("invalid-argument", "Unknown purpose.");
  const digits = requirePhone(request.data?.phone);
  const callerUid = clean(request.auth?.uid);
  if (purpose === "change" && !callerUid) throw new HttpsError("unauthenticated", "Sign in first.");

  const owner = clean((await indexRef(digits).get()).get("uid"));
  const shouldSend =
    purpose === "login" ? !!(await smeLoginFor(digits)) :
    purpose === "register" ? !owner :
    !owner || owner === callerUid;

  const now = Date.now();
  const code = newLoginCode();
  const salt = randomBytes(16).toString("hex");
  const ip = ipRef(request);
  await db.runTransaction(async (transaction) => {
    const [codeSnap, ipSnap] = await Promise.all([transaction.get(codeRef(digits)), transaction.get(ip)]);
    const numberSends = recentSends(codeSnap.get("sends"), now);
    const ipSends = recentSends(ipSnap.get("sends"), now);
    const decision = decideCodeSend({ now, numberSends, ipSends });
    if (!decision.ok) {
      throw new HttpsError("resource-exhausted", `Please wait ${Math.ceil((decision.retryAfterMs || 0) / 1000)} seconds before asking for another code.`);
    }
    transaction.set(ip, { sends: [...ipSends, now] });
    transaction.set(codeRef(digits), shouldSend
      ? {
        codeHash: hashLoginCode(code, salt),
        salt,
        purpose,
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        ...(purpose === "change" ? { uid: callerUid } : {}),
        sends: [...numberSends, now],
      }
      : { sends: [...numberSends, now] });
  });

  if (shouldSend && !(await dispatchLoginCode(digits, code, `${digits}:${now}`))) {
    logger.error("phoneLogin.codeNotSent", { purpose });
  }
  return { ok: true, expiresInSeconds: Math.round(CODE_TTL_MS / 1000) };
});

/** Signs an SME in with the code sent to its number: answers a custom token for its login. */
export const verifySmeLoginCode = onCall({ timeoutSeconds: 30 }, async (request) => {
  const digits = requirePhone(request.data?.phone);
  await consumeCode(digits, clean(request.data?.code), "login");
  const uid = await smeLoginFor(digits);
  if (!uid) throw new HttpsError("permission-denied", NEUTRAL_CODE_ERROR);
  return { token: await admin.auth().createCustomToken(uid) };
});

/** Creates an SME login whose only sign-in is this phone number. Returns its uid. */
async function createPhoneLogin(digits: string, name: string, extra: Record<string, unknown>) {
  const uid = db.collection("users").doc().id;
  // Claiming the number first keeps it to one login even when two requests race.
  try {
    await indexRef(digits).create({ uid, source: "phone", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch {
    throw new HttpsError("already-exists", "This number already has an account. Sign in with it instead.");
  }
  try {
    await admin.auth().createUser({ uid, phoneNumber: `+${digits}`, displayName: name || undefined });
  } catch (error: any) {
    await indexRef(digits).delete().catch(() => undefined);
    if (error?.code === "auth/phone-number-already-exists") {
      throw new HttpsError("already-exists", "This number already has an account. Sign in with it instead.");
    }
    throw error;
  }
  await db.collection("users").doc(uid).set({
    uid,
    role: "incubatee",
    name,
    phone: `+${digits}`,
    loginPhone: digits,
    signInMethod: "phone",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
  return uid;
}

/** A new SME registers with only a phone number, proven by the code. Answers a custom token. */
export const registerSmeByPhone = onCall({ timeoutSeconds: 30 }, async (request) => {
  const digits = requirePhone(request.data?.phone);
  const name = clean(request.data?.name).slice(0, 120);
  if (!name) throw new HttpsError("invalid-argument", "Enter your name.");
  await consumeCode(digits, clean(request.data?.code), "register");
  const uid = await createPhoneLogin(digits, name, { firstLoginComplete: true });
  return { token: await admin.auth().createCustomToken(uid) };
});

// Same roles createPlatformUser lets create SME logins (userManagement.ts).
const CREATOR_ROLES = new Set(["director", "system_admin", "hr", "operations", "projectadmin", "center coordinator", "center_coordinator"]);
async function canCreateSmeLogins(uid: string) {
  const caller = (await db.collection("users").doc(uid).get()).data() || {};
  const role = clean(caller.role).toLowerCase();
  if (CREATOR_ROLES.has(role)) return true;
  if (role !== "coordinator") return false;
  const departmentId = clean(caller.departmentId || caller.department?.id);
  return !!departmentId && (await db.collection("departments").doc(departmentId).get()).get("isOnboarding") === true;
}

/**
 * Staff add a login for an SME record whose contact has no email: it signs in with this phone
 * number. The login is linked to the participant straight away.
 */
export const createSmeLoginByPhone = onCall({ timeoutSeconds: 30 }, async (request) => {
  const callerUid = clean(request.auth?.uid);
  if (!callerUid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!(await canCreateSmeLogins(callerUid))) throw new HttpsError("permission-denied", "You can't add SME logins.");
  const participantId = clean(request.data?.participantId);
  const digits = requirePhone(request.data?.phone);
  const name = clean(request.data?.name).slice(0, 120);
  const participant = participantId ? await db.collection("participants").doc(participantId).get() : null;
  if (!participant?.exists) throw new HttpsError("not-found", "That SME record was not found.");
  if (clean(participant.get("uid"))) throw new HttpsError("failed-precondition", "This SME already has a login.");

  const uid = await createPhoneLogin(digits, name || clean(participant.get("participantName")), {
    mustRegister: true,
    createdBy: callerUid,
  });
  const decision = await linkSmeIdentity(uid, participantId);
  if (!decision.ok) logger.warn("createSmeLoginByPhone.linkRefused", { uid, participantId, reason: decision.reason });
  return { uid, linked: decision.ok };
});

/** The signed-in SME moves its phone sign-in to a new number, proven by the code sent there. */
export const changeMyLoginPhone = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = clean(request.auth?.uid);
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const user = (await db.collection("users").doc(uid).get()).data();
  if (!isSmeRole(user?.role)) throw new HttpsError("permission-denied", "Only SME logins sign in by phone.");
  const digits = requirePhone(request.data?.phone);
  await consumeCode(digits, clean(request.data?.code), "change", uid);

  const previous = await db.collection("phoneIndex").where("uid", "==", uid).get();
  await db.runTransaction(async (transaction) => {
    const target = await transaction.get(indexRef(digits));
    if (target.exists && clean(target.get("uid")) !== uid) {
      throw new HttpsError("already-exists", "That number belongs to another account.");
    }
    previous.docs.filter((doc) => doc.id !== digits).forEach((doc) => transaction.delete(doc.ref));
    transaction.set(indexRef(digits), { uid, source: "phone", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(db.collection("users").doc(uid), { loginPhone: digits });
  });
  if (user?.signInMethod === "phone") {
    await admin.auth().updateUser(uid, { phoneNumber: `+${digits}` }).catch((error) =>
      logger.warn("changeMyLoginPhone.authPhoneNotUpdated", { uid, error: String(error) }));
  }
  return { ok: true, phone: `+${digits}` };
});

/**
 * An SME's WhatsApp-update number is also its sign-in number. When an SME confirms or changes it,
 * the index follows -- unless the number already belongs to another login (then it is logged and
 * left), or the SME signs in with a number it registered (source "phone"), which is never moved here.
 */
export const onSmeWhatsAppNumber = onDocumentWritten("users/{uid}", async (event) => {
  const after = event.data?.after?.data();
  if (!after || !isSmeRole(after.role)) return;
  const before = event.data?.before?.data() || {};
  const digits = normalizeLoginPhone(after.whatsappConsent?.number);
  if (!digits || after.whatsappConsent?.status !== "granted") return;
  if (normalizeLoginPhone(before.whatsappConsent?.number) === digits && before.whatsappConsent?.status === "granted") return;

  const uid = event.params.uid;
  const mine = await db.collection("phoneIndex").where("uid", "==", uid).get();
  if (mine.docs.some((doc) => doc.get("source") === "phone")) return;
  await db.runTransaction(async (transaction) => {
    const target = await transaction.get(indexRef(digits));
    if (target.exists) {
      if (clean(target.get("uid")) !== uid) logger.warn("onSmeWhatsAppNumber.numberTaken", { uid });
      return;
    }
    mine.docs.forEach((doc) => transaction.delete(doc.ref));
    transaction.set(indexRef(digits), { uid, source: "whatsappConsent", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
});
