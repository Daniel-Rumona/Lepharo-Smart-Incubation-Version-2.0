"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuantNowFinanceToken = exports.loginToQuantNow = exports.QUANTNOW_SECRETS = exports.qxFinancePassword = exports.qxFinanceEmail = exports.QUANTNOW_BASE_URL = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firebase_1 = require("./firebase");
// The QuantNow finance-admin login lives in Google Secret Manager, never in
// .env files, Vercel variables or the browser bundle. Set it once with:
//   firebase functions:secrets:set QX_FINANCE_EMAIL
//   firebase functions:secrets:set QX_FINANCE_PASSWORD
// Browsers call getQuantNowFinanceToken and only ever receive the session token.
exports.QUANTNOW_BASE_URL = "https://quantnow-sa1e.onrender.com";
exports.qxFinanceEmail = (0, params_1.defineSecret)("QX_FINANCE_EMAIL");
exports.qxFinancePassword = (0, params_1.defineSecret)("QX_FINANCE_PASSWORD");
/** Add to the `secrets` option of any function that calls loginToQuantNow. */
exports.QUANTNOW_SECRETS = [exports.qxFinanceEmail, exports.qxFinancePassword];
/** Server-side QuantNow login with the finance-admin account. */
async function loginToQuantNow() {
    const email = exports.qxFinanceEmail.value();
    const password = exports.qxFinancePassword.value();
    if (!email || !password) {
        throw new Error("QuantNow secrets QX_FINANCE_EMAIL / QX_FINANCE_PASSWORD are not set.");
    }
    const res = await fetch(`${exports.QUANTNOW_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
        throw new Error(data?.message || `QuantNow login failed (${res.status})`);
    }
    const user = data.user
        ? { user_id: data.user.user_id, email: data.user.email, name: data.user.name }
        : null;
    return { token: String(data.token), user };
}
exports.loginToQuantNow = loginToQuantNow;
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
const roleKey = (role) => String(role ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
exports.getQuantNowFinanceToken = (0, https_1.onCall)({
    region: "us-central1",
    cors: ["http://localhost:5173", "http://localhost:5182", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"],
    secrets: exports.QUANTNOW_SECRETS,
    timeoutSeconds: 60, // Render cold starts can take a while
}, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    const profile = (await firebase_1.db.collection("users").doc(request.auth.uid).get()).data();
    if (!FINANCE_ROLES.has(roleKey(profile?.role || request.auth.token?.role))) {
        throw new https_1.HttpsError("permission-denied", "Finance data is for staff only.");
    }
    try {
        return await loginToQuantNow();
    }
    catch (error) {
        throw new https_1.HttpsError("unavailable", error?.message || "Could not sign in to QuantNow.");
    }
});
//# sourceMappingURL=quantNowAuth.js.map