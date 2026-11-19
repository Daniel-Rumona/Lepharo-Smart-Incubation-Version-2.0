"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLoginAccess = exports.STAFF_EMAIL_DOMAIN = void 0;
// Who may sign in while the pilot guard is on (PILOT_RECIPIENTS_ONLY=true, the
// live project): anyone with an @quantilytix.co.za email, and the people on the
// training list in pilotSettings/recipients, by email or by phone (phone-only
// SME logins). With the guard off (the dev project) everyone may sign in.
//
// The web app asks this after every sign-in and on every restored session, and
// signs the user out when it answers false.
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const pilotGuard_1 = require("./pilotGuard");
exports.STAFF_EMAIL_DOMAIN = "@quantilytix.co.za";
const clean = (value) => String(value ?? "").trim();
exports.checkLoginAccess = (0, https_1.onCall)({ timeoutSeconds: 20 }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Sign in first.");
    if (!(0, pilotGuard_1.pilotModeOn)())
        return { allowed: true };
    const tokenEmail = clean(request.auth?.token?.email).toLowerCase();
    if (tokenEmail.endsWith(exports.STAFF_EMAIL_DOMAIN) && request.auth?.token?.email_verified !== false) {
        return { allowed: true };
    }
    const [user, authUser, phoneEntries] = await Promise.all([
        firebase_1.db.collection("users").doc(uid).get(),
        firebase_1.admin.auth().getUser(uid).catch(() => null),
        firebase_1.db.collection("phoneIndex").where("uid", "==", uid).limit(5).get(),
    ]);
    const emails = new Set([tokenEmail, clean(user.get("email")).toLowerCase()].filter(Boolean));
    for (const email of emails) {
        if (await (0, pilotGuard_1.pilotAllowsEmail)(email))
            return { allowed: true };
    }
    const phones = new Set([authUser?.phoneNumber, user.get("phone"), ...phoneEntries.docs.map(entry => entry.id)]
        .map(clean)
        .filter(Boolean));
    for (const phone of phones) {
        if (await (0, pilotGuard_1.pilotAllowsPhone)(phone))
            return { allowed: true };
    }
    logger.info("login_access.denied", { uid });
    return { allowed: false };
});
//# sourceMappingURL=loginAccess.js.map