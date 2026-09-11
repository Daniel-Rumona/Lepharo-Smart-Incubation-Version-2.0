// mailer.ts
import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE == null
      ? port === 465
      : process.env.SMTP_SECURE.trim().toLowerCase() === "true";
    transporter = nodemailer.createTransport({
      host: requireEnv("SMTP_HOST"),
      port,
      secure,
      auth: {
        user: requireEnv("SMTP_USER"),
        pass: requireEnv("SMTP_PASS"),
      },
    });
  }
  return transporter;
}

type SendEmailInput = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  // optional overrides if you ever need them (rare)
  replyTo?: string;
};

export async function sendSystemEmail(input: SendEmailInput) {
  const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || requireEnv("SMTP_USER");
  const FROM_NAME = process.env.MAIL_FROM_NAME || "Smart Incubation Support";
  const REPLY_TO = input.replyTo || process.env.MAIL_REPLY_TO || FROM_EMAIL;

  const from = `${FROM_NAME} <${FROM_EMAIL}>`;

  return getTransporter().sendMail({
    from,
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: REPLY_TO,
  });
}

// Backwards-compatible exports (used by older modules)
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = process.env.SMTP_PORT;
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const SMTP_FROM = process.env.SMTP_FROM || process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;

export async function sendEmail(args: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string; replyTo?: string }) {
  return sendSystemEmail(args);
}
