// Pilot guard: while testers try this version on the live project, outgoing
// email, WhatsApp and push reach only the people listed in
// pilotSettings/recipients ({ emails: string[], phones: string[] }).
//
// It is on when PILOT_RECIPIENTS_ONLY=true (functions/.env.lph-smart-inc), so
// the dev project is unaffected. It fails closed: if the list is missing or
// unreadable, nothing is sent. Messages to anyone else are dropped and logged
// (pilot_guard.*), never queued, so turning the guard off later does not
// release a backlog.
import * as logger from "firebase-functions/logger";
import { admin } from "./firebase";

const CACHE_MS = 60_000;

type Allowlist = { emails: Set<string>; phones: Set<string> };
let cached: { at: number; list: Allowlist } | null = null;

export function pilotModeOn(): boolean {
  return String(process.env.PILOT_RECIPIENTS_ONLY || "").trim().toLowerCase() === "true";
}

const normalEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();

// The last nine digits identify a South African mobile whether it is written
// +27 82 ..., 27 82 ... or 082 ....
function phoneKey(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

async function allowlist(): Promise<Allowlist> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.list;
  let list: Allowlist = { emails: new Set(), phones: new Set() };
  try {
    const data = (await admin.firestore().doc("pilotSettings/recipients").get()).data() || {};
    list = {
      emails: new Set((Array.isArray(data.emails) ? data.emails : []).map(normalEmail).filter(Boolean)),
      phones: new Set((Array.isArray(data.phones) ? data.phones : []).map(phoneKey).filter(Boolean)),
    };
  } catch (error) {
    logger.error("pilot_guard.allowlist_unreadable", { error: String(error) });
  }
  cached = { at: Date.now(), list };
  return list;
}

export async function pilotAllowsEmail(address: unknown): Promise<boolean> {
  if (!pilotModeOn()) return true;
  const email = normalEmail(address);
  return email !== "" && (await allowlist()).emails.has(email);
}

export async function pilotAllowsPhone(phone: unknown): Promise<boolean> {
  if (!pilotModeOn()) return true;
  const key = phoneKey(phone);
  return key !== "" && (await allowlist()).phones.has(key);
}

// nodemailer accepts "a@x.com, Name <b@y.com>", an array of those, or
// { name, address } objects. Returns the bare address of one entry.
function addressOf(entry: unknown): string {
  if (entry && typeof entry === "object") return normalEmail((entry as any).address);
  const text = String(entry ?? "");
  const angled = text.match(/<([^>]+)>/);
  return normalEmail(angled ? angled[1] : text);
}

function entriesOf(value: unknown): unknown[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(entriesOf);
  if (typeof value === "string") return value.split(",").map(part => part.trim()).filter(Boolean);
  return [value];
}

/**
 * Narrows a mail's to/cc/bcc to allowed recipients. Returns null when nobody
 * is left, so the caller skips the send.
 */
export async function pilotFilterMail<T extends { to?: any; cc?: any; bcc?: any; subject?: any }>(
  mail: T
): Promise<T | null> {
  if (!pilotModeOn()) return mail;
  const list = await allowlist();
  const keep = (value: unknown) => entriesOf(value).filter(entry => list.emails.has(addressOf(entry)));
  const to = keep(mail.to), cc = keep(mail.cc), bcc = keep(mail.bcc);
  const dropped = entriesOf(mail.to).length + entriesOf(mail.cc).length + entriesOf(mail.bcc).length -
    (to.length + cc.length + bcc.length);
  if (dropped > 0) logger.info("pilot_guard.email_recipients_dropped", { subject: String(mail.subject || ""), dropped });
  if (!to.length && !cc.length && !bcc.length) {
    logger.info("pilot_guard.email_skipped", { subject: String(mail.subject || "") });
    return null;
  }
  return {
    ...mail,
    to: to.length ? to : undefined,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
  } as T;
}

/** Result returned in place of a send the guard skipped. */
export const PILOT_SKIPPED_INFO = Object.freeze({
  messageId: "pilot-skipped",
  accepted: [] as string[],
  rejected: [] as string[],
  response: "skipped by pilot guard",
  pilotSkipped: true,
});

/**
 * Wraps a nodemailer transport so every send goes through pilotFilterMail.
 * A mail with pilotExempt: true is sent as is; that is for mail that must reach
 * real users during the pilot, such as application decisions.
 */
export function withPilotGuard<T extends { sendMail: (...args: any[]) => any }>(transport: T): T {
  const rawSendMail = transport.sendMail.bind(transport);
  transport.sendMail = (async (options: any, callback?: any) => {
    try {
      const { pilotExempt, ...mail } = options || {};
      const guarded = pilotExempt === true ? mail : await pilotFilterMail(mail);
      const info = guarded ? await rawSendMail(guarded) : PILOT_SKIPPED_INFO;
      if (typeof callback === "function") callback(null, info);
      return info;
    } catch (error) {
      if (typeof callback === "function") {
        callback(error);
        return undefined;
      }
      throw error;
    }
  }) as any;
  return transport;
}
