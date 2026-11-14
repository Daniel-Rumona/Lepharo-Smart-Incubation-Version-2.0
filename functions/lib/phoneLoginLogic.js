"use strict";
// Pure rules for SME phone sign-in (docs/sme-identity-migration-plan.md, Phase 5):
// normalising numbers, the one-time codes and their limits. phoneLogin.ts does the I/O.
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideCodeCheck = exports.decideCodeSend = exports.recentSends = exports.hashLoginCode = exports.newLoginCode = exports.normalizeLoginPhone = exports.MAX_SENDS_PER_IP_HOUR = exports.MAX_SENDS_PER_NUMBER_HOUR = exports.RESEND_COOLDOWN_MS = exports.MAX_ATTEMPTS = exports.CODE_TTL_MS = void 0;
const crypto_1 = require("crypto");
exports.CODE_TTL_MS = 5 * 60 * 1000;
exports.MAX_ATTEMPTS = 5;
/** A new code for the same number no sooner than this. */
exports.RESEND_COOLDOWN_MS = 60 * 1000;
/** Codes per number, and per caller IP, in any rolling hour. */
exports.MAX_SENDS_PER_NUMBER_HOUR = 5;
exports.MAX_SENDS_PER_IP_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
/**
 * A phone number as international digits without "+", e.g. "27821234567", or null.
 * A leading 0 is a South African national number. Anything else must already carry
 * its country code (+ or 00 prefix, or bare digits starting with one).
 */
function normalizeLoginPhone(input) {
    const raw = String(input ?? "").trim();
    if (!raw)
        return null;
    let digits = raw.replace(/[^0-9]/g, "");
    if (raw.startsWith("00") || (digits.startsWith("00") && !raw.startsWith("+")))
        digits = digits.replace(/^00/, "");
    else if (!raw.startsWith("+") && digits.startsWith("0"))
        digits = `27${digits.slice(1)}`;
    if (digits.startsWith("270"))
        digits = `27${digits.slice(3)}`;
    if (digits.startsWith("27"))
        return digits.length === 11 ? digits : null;
    return digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0") ? digits : null;
}
exports.normalizeLoginPhone = normalizeLoginPhone;
const newLoginCode = () => String((0, crypto_1.randomInt)(0, 1000000)).padStart(6, "0");
exports.newLoginCode = newLoginCode;
const hashLoginCode = (code, salt) => (0, crypto_1.createHash)("sha256").update(`${salt}:${String(code).trim()}`).digest("hex");
exports.hashLoginCode = hashLoginCode;
/** Send timestamps (ms) still inside the rolling hour. */
const recentSends = (sends, now) => (Array.isArray(sends) ? sends : []).filter((at) => typeof at === "number" && now - at < HOUR_MS);
exports.recentSends = recentSends;
/** Whether another code may go to this number now. */
function decideCodeSend(input) {
    const numberSends = (0, exports.recentSends)(input.numberSends, input.now);
    const ipSends = (0, exports.recentSends)(input.ipSends, input.now);
    const last = numberSends.length ? Math.max(...numberSends) : 0;
    if (last && input.now - last < exports.RESEND_COOLDOWN_MS) {
        return { ok: false, reason: "cooldown", retryAfterMs: exports.RESEND_COOLDOWN_MS - (input.now - last) };
    }
    if (numberSends.length >= exports.MAX_SENDS_PER_NUMBER_HOUR) {
        return { ok: false, reason: "number_limit", retryAfterMs: HOUR_MS - (input.now - Math.min(...numberSends)) };
    }
    if (ipSends.length >= exports.MAX_SENDS_PER_IP_HOUR) {
        return { ok: false, reason: "ip_limit", retryAfterMs: HOUR_MS - (input.now - Math.min(...ipSends)) };
    }
    return { ok: true };
}
exports.decideCodeSend = decideCodeSend;
/** Whether `code` matches the stored one for `purpose`. A wrong code uses up an attempt. */
function decideCodeCheck(input) {
    const stored = input.stored;
    if (!stored?.codeHash || !stored.salt)
        return { ok: false, reason: "no_code", burnsAttempt: false };
    if (stored.purpose !== input.purpose || (input.purpose === "change" && stored.uid !== input.uid)) {
        return { ok: false, reason: "wrong_purpose", burnsAttempt: false };
    }
    if (!stored.expiresAt || input.now > stored.expiresAt)
        return { ok: false, reason: "expired", burnsAttempt: false };
    if ((stored.attempts || 0) >= exports.MAX_ATTEMPTS)
        return { ok: false, reason: "too_many_attempts", burnsAttempt: false };
    if (!/^\d{6}$/.test(String(input.code || "").trim()) || (0, exports.hashLoginCode)(input.code, stored.salt) !== stored.codeHash) {
        return { ok: false, reason: "wrong_code", burnsAttempt: true };
    }
    return { ok: true };
}
exports.decideCodeCheck = decideCodeCheck;
//# sourceMappingURL=phoneLoginLogic.js.map