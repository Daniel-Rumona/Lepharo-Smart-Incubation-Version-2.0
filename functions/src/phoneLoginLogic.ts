// Pure rules for SME phone sign-in (docs/sme-identity-migration-plan.md, Phase 5):
// normalising numbers, the one-time codes and their limits. phoneLogin.ts does the I/O.

import { createHash, randomInt } from "crypto";

export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
/** A new code for the same number no sooner than this. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Codes per number, and per caller IP, in any rolling hour. */
export const MAX_SENDS_PER_NUMBER_HOUR = 5;
export const MAX_SENDS_PER_IP_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

export type CodePurpose = "login" | "register" | "change";

/**
 * A phone number as international digits without "+", e.g. "27821234567", or null.
 * A leading 0 is a South African national number. Anything else must already carry
 * its country code (+ or 00 prefix, or bare digits starting with one).
 */
export function normalizeLoginPhone(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^0-9]/g, "");
  if (raw.startsWith("00") || (digits.startsWith("00") && !raw.startsWith("+"))) digits = digits.replace(/^00/, "");
  else if (!raw.startsWith("+") && digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  if (digits.startsWith("270")) digits = `27${digits.slice(3)}`;
  if (digits.startsWith("27")) return digits.length === 11 ? digits : null;
  return digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0") ? digits : null;
}

export const newLoginCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const hashLoginCode = (code: string, salt: string) =>
  createHash("sha256").update(`${salt}:${String(code).trim()}`).digest("hex");

/** Send timestamps (ms) still inside the rolling hour. */
export const recentSends = (sends: number[] | undefined, now: number) =>
  (Array.isArray(sends) ? sends : []).filter((at) => typeof at === "number" && now - at < HOUR_MS);

// Flat shapes, not unions: functions/ compiles without strictNullChecks, which a union on `ok` needs to narrow.
export type SendDecision = { ok: boolean; reason?: "cooldown" | "number_limit" | "ip_limit"; retryAfterMs?: number };

/** Whether another code may go to this number now. */
export function decideCodeSend(input: { now: number; numberSends?: number[]; ipSends?: number[] }): SendDecision {
  const numberSends = recentSends(input.numberSends, input.now);
  const ipSends = recentSends(input.ipSends, input.now);
  const last = numberSends.length ? Math.max(...numberSends) : 0;
  if (last && input.now - last < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", retryAfterMs: RESEND_COOLDOWN_MS - (input.now - last) };
  }
  if (numberSends.length >= MAX_SENDS_PER_NUMBER_HOUR) {
    return { ok: false, reason: "number_limit", retryAfterMs: HOUR_MS - (input.now - Math.min(...numberSends)) };
  }
  if (ipSends.length >= MAX_SENDS_PER_IP_HOUR) {
    return { ok: false, reason: "ip_limit", retryAfterMs: HOUR_MS - (input.now - Math.min(...ipSends)) };
  }
  return { ok: true };
}

export type StoredCode = {
  codeHash?: string;
  salt?: string;
  purpose?: CodePurpose;
  expiresAt?: number;
  attempts?: number;
  /** For "change": the signed-in login that asked. */
  uid?: string;
};

export type VerifyDecision = {
  ok: boolean;
  reason?: "no_code" | "expired" | "too_many_attempts" | "wrong_code" | "wrong_purpose";
  burnsAttempt?: boolean;
};

/** Whether `code` matches the stored one for `purpose`. A wrong code uses up an attempt. */
export function decideCodeCheck(input: { now: number; stored?: StoredCode | null; code: string; purpose: CodePurpose; uid?: string }): VerifyDecision {
  const stored = input.stored;
  if (!stored?.codeHash || !stored.salt) return { ok: false, reason: "no_code", burnsAttempt: false };
  if (stored.purpose !== input.purpose || (input.purpose === "change" && stored.uid !== input.uid)) {
    return { ok: false, reason: "wrong_purpose", burnsAttempt: false };
  }
  if (!stored.expiresAt || input.now > stored.expiresAt) return { ok: false, reason: "expired", burnsAttempt: false };
  if ((stored.attempts || 0) >= MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts", burnsAttempt: false };
  if (!/^\d{6}$/.test(String(input.code || "").trim()) || hashLoginCode(input.code, stored.salt) !== stored.codeHash) {
    return { ok: false, reason: "wrong_code", burnsAttempt: true };
  }
  return { ok: true };
}
