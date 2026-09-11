"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = exports.SMTP_FROM = exports.SMTP_PASS = exports.SMTP_USER = exports.SMTP_PORT = exports.SMTP_HOST = exports.sendSystemEmail = void 0;
// mailer.ts
const nodemailer_1 = __importDefault(require("nodemailer"));
let transporter = null;
function requireEnv(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`Missing env: ${name}`);
    return value;
}
function getTransporter() {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT || 587);
        const secure = process.env.SMTP_SECURE == null
            ? port === 465
            : process.env.SMTP_SECURE.trim().toLowerCase() === "true";
        transporter = nodemailer_1.default.createTransport({
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
async function sendSystemEmail(input) {
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
exports.sendSystemEmail = sendSystemEmail;
// Backwards-compatible exports (used by older modules)
exports.SMTP_HOST = process.env.SMTP_HOST;
exports.SMTP_PORT = process.env.SMTP_PORT;
exports.SMTP_USER = process.env.SMTP_USER;
exports.SMTP_PASS = process.env.SMTP_PASS;
exports.SMTP_FROM = process.env.SMTP_FROM || process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
async function sendEmail(args) {
    return sendSystemEmail(args);
}
exports.sendEmail = sendEmail;
//# sourceMappingURL=mailer.js.map