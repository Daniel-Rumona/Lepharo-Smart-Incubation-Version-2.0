// Who may sign in while the pilot guard is on (PILOT_RECIPIENTS_ONLY=true, the
// live project): anyone with an @quantilytix.co.za email, and the testers listed
// in pilotSettings/recipients, by email or by phone (phone-only
// SME logins). With the guard off (the dev project) everyone may sign in.
//
// The web app asks this after every sign-in and on every restored session, and
// signs the user out when it answers false.
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { admin, db } from "./firebase";
import { pilotAllowsEmail, pilotAllowsPhone, pilotModeOn } from "./pilotGuard";

export const STAFF_EMAIL_DOMAIN = "@quantilytix.co.za";

const clean = (value: unknown) => String(value ?? "").trim();

export const checkLoginAccess = onCall({ timeoutSeconds: 20 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!pilotModeOn()) return { allowed: true };

  const tokenEmail = clean(request.auth?.token?.email).toLowerCase();
  if (tokenEmail.endsWith(STAFF_EMAIL_DOMAIN) && request.auth?.token?.email_verified !== false) {
    return { allowed: true };
  }

  const [user, authUser, phoneEntries] = await Promise.all([
    db.collection("users").doc(uid).get(),
    admin.auth().getUser(uid).catch(() => null),
    db.collection("phoneIndex").where("uid", "==", uid).limit(5).get(),
  ]);

  const emails = new Set([tokenEmail, clean(user.get("email")).toLowerCase()].filter(Boolean));
  for (const email of emails) {
    if (await pilotAllowsEmail(email)) return { allowed: true };
  }

  const phones = new Set(
    [authUser?.phoneNumber, user.get("phone"), ...phoneEntries.docs.map(entry => entry.id)]
      .map(clean)
      .filter(Boolean),
  );
  for (const phone of phones) {
    if (await pilotAllowsPhone(phone)) return { allowed: true };
  }

  logger.info("login_access.denied", { uid });
  return { allowed: false };
});
