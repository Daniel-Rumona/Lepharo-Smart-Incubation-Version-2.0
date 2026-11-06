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
exports.SAMPLE_VALUES = exports.renderCertificate = exports.templateFields = exports.normalizeCode = exports.verificationCodeFor = void 0;
const crypto = __importStar(require("crypto"));
const pdf_lib_1 = require("pdf-lib");
const QRCode = __importStar(require("qrcode"));
const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1: easy to read back
/** 16 characters from an HMAC of the certificate's identity, shown as XXXX-XXXX-XXXX-XXXX. */
function verificationCodeFor(secret, c) {
    const mac = crypto.createHmac("sha256", secret).update([c.id, c.certificateNumber, c.recipientName, c.trainingId, c.issuedAt].join("|")).digest();
    let code = "";
    for (let i = 0; i < 16; i++)
        code += BASE32[mac[i] % BASE32.length];
    return code.match(/.{4}/g).join("-");
}
exports.verificationCodeFor = verificationCodeFor;
/** A code as typed or scanned (any case, with or without dashes), or "" if it can't be one. */
function normalizeCode(value) {
    const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return raw.length === 16 ? raw.match(/.{4}/g).join("-") : "";
}
exports.normalizeCode = normalizeCode;
/** The form-field names of a template: its placeholders. */
async function templateFields(templateBytes) {
    const pdf = await pdf_lib_1.PDFDocument.load(templateBytes);
    const fields = pdf.getForm().getFields().map((f) => f.getName());
    return {
        fields,
        signatureFields: fields.filter((f) => /^signature_\d+$/.test(f)),
        hasRecipientName: fields.includes("recipientName"),
        hasQr: fields.includes("verificationQr"),
    };
}
exports.templateFields = templateFields;
/** Draws an image into the rectangle of a form field, keeping its aspect ratio, and removes the field. */
async function drawIntoField(pdf, form, name, image, kind) {
    const field = form.getFields().find((f) => f.getName() === name);
    if (!field)
        return;
    const embedded = kind === "png" ? await pdf.embedPng(image) : await pdf.embedJpg(image);
    for (const widget of field.acroField.getWidgets()) {
        const rect = widget.getRectangle();
        const pageRef = widget.P();
        const page = pdf.getPages().find((p) => p.ref === pageRef) || pdf.getPages()[0];
        const scale = Math.min(rect.width / embedded.width, rect.height / embedded.height);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        page.drawImage(embedded, { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h });
    }
    form.removeField(field);
}
/**
 * Fills the text fields that have values, draws the signatures and (when
 * issuing) the verification QR, and flattens so nothing stays editable.
 * Without a verify URL it is a preview and is watermarked as one.
 */
async function renderCertificate(templateBytes, values, signatures, verifyUrl) {
    const pdf = await pdf_lib_1.PDFDocument.load(templateBytes);
    const form = pdf.getForm();
    for (const field of form.getFields()) {
        if (field instanceof pdf_lib_1.PDFTextField && values[field.getName()] !== undefined)
            field.setText(values[field.getName()]);
    }
    for (const s of signatures) {
        if (s.image)
            await drawIntoField(pdf, form, s.field, s.image.bytes, s.image.kind);
    }
    if (verifyUrl && form.getFields().some((f) => f.getName() === "verificationQr")) {
        const png = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 300 });
        await drawIntoField(pdf, form, "verificationQr", new Uint8Array(png), "png");
    }
    form.flatten();
    if (!verifyUrl) {
        pdf.getPages().forEach((page) => {
            const { width, height } = page.getSize();
            page.drawText("PREVIEW", { x: width * 0.22, y: height * 0.45, size: Math.min(width, height) / 5, color: (0, pdf_lib_1.rgb)(0.85, 0.2, 0.2), opacity: 0.25 });
        });
    }
    return pdf.save();
}
exports.renderCertificate = renderCertificate;
/** Sample values for a template preview. */
exports.SAMPLE_VALUES = {
    recipientName: "Thandi Mokoena",
    companyName: "Mokoena Bakery (Pty) Ltd",
    trainingName: "Business Skills Programme",
    categories: "Finance, Marketing",
    completionDate: "27 October 2026",
    startDate: "1 August 2026",
    endDate: "27 October 2026",
    certificateNumber: "LPH-TA-2026-000123",
    verificationCode: "7KQ2-M9XD-4HPA-W3RT",
    centreName: "Polokwane",
    signatory1Name: "Academy Head",
    signatory1Title: "Head of Training Academy",
};
//# sourceMappingURL=certificatePdf.js.map