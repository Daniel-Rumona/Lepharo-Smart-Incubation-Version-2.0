import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "./firebase";

// The QuantNow finance-admin login lives in Google Secret Manager, never in
// .env files, Vercel variables or the browser bundle. Set it once with:
//   firebase functions:secrets:set QX_FINANCE_EMAIL
//   firebase functions:secrets:set QX_FINANCE_PASSWORD
// Browsers call getQuantNowFinanceToken and only ever receive the session token.

export const QUANTNOW_BASE_URL = "https://quantnow-sa1e.onrender.com";
export const qxFinanceEmail = defineSecret("QX_FINANCE_EMAIL");
export const qxFinancePassword = defineSecret("QX_FINANCE_PASSWORD");
/** Add to the `secrets` option of any function that calls loginToQuantNow. */
export const QUANTNOW_SECRETS = [qxFinanceEmail, qxFinancePassword];

export type QuantNowLogin = { token: string; user: { user_id?: string; email?: string; name?: string } | null };

/** Server-side QuantNow login with the finance-admin account. */
export async function loginToQuantNow(): Promise<QuantNowLogin> {
  const email = qxFinanceEmail.value();
  const password = qxFinancePassword.value();
  if (!email || !password) {
    throw new Error("QuantNow secrets QX_FINANCE_EMAIL / QX_FINANCE_PASSWORD are not set.");
  }

  const res = await fetch(`${QUANTNOW_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) {
    throw new Error(data?.message || `QuantNow login failed (${res.status})`);
  }
  const user = data.user
    ? { user_id: data.user.user_id, email: data.user.email, name: data.user.name }
    : null;
  return { token: String(data.token), user };
}

// Lepharo staff plus platform admins. SMEs, funders and government viewers
// never get the finance-admin token.
const FINANCE_ROLES = new Set([
  "director",
  "operations",
  "headofdepartment",
  "headsofdepartment",
  "hod",
  "projectadmin",
  "centercoordinator",
  "coordinator",
  "hr",
  "employee",
  "receptionist",
  "receiptionist",
  "finance",
  "systemadmin",
  "superadmin",
]);
const roleKey = (role: unknown) => String(role ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");

export const getQuantNowFinanceToken = onCall(
  {
    region: "us-central1",
    cors: ["http://localhost:5173", "http://localhost:5182", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"],
    secrets: QUANTNOW_SECRETS,
    timeoutSeconds: 60, // Render cold starts can take a while
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in again.");
    const profile = (await db.collection("users").doc(request.auth.uid).get()).data();
    if (!FINANCE_ROLES.has(roleKey(profile?.role || request.auth.token?.role))) {
      throw new HttpsError("permission-denied", "Finance data is for staff only.");
    }
    try {
      return await loginToQuantNow();
    } catch (error: any) {
      throw new HttpsError("unavailable", error?.message || "Could not sign in to QuantNow.");
    }
  }
);
