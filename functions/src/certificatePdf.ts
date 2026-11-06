import * as crypto from "crypto";
import { PDFDocument, PDFForm, PDFTextField, rgb } from "pdf-lib";
import * as QRCode from "qrcode";

/*
 * Certificate PDFs and verification codes, without Firestore or Storage, so
 * certificatePdf.test.cjs can run them on a real fillable PDF. Used by
 * trainingCertificates.ts.
 */

export type SignatureImage = { field: string; image: { bytes: Uint8Array; kind: "png" | "jpg" } | null };

const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1: easy to read back

/** 16 characters from an HMAC of the certificate's identity, shown as XXXX-XXXX-XXXX-XXXX. */
export function verificationCodeFor(
  secret: string,
  c: { id: string; certificateNumber: string; recipientName: string; trainingId: string; issuedAt: string }
) {
  const mac = crypto.createHmac("sha256", secret).update([c.id, c.certificateNumber, c.recipientName, c.trainingId, c.issuedAt].join("|")).digest();
  let code = "";
  for (let i = 0; i < 16; i++) code += BASE32[mac[i] % BASE32.length];
  return code.match(/.{4}/g)!.join("-");
}

/** A code as typed or scanned (any case, with or without dashes), or "" if it can't be one. */
export function normalizeCode(value: unknown) {
  const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 16 ? raw.match(/.{4}/g)!.join("-") : "";
}

/** The form-field names of a template: its placeholders. */
export async function templateFields(templateBytes: Uint8Array) {
  const pdf = await PDFDocument.load(templateBytes);
  const fields = pdf.getForm().getFields().map((f) => f.getName());
  return {
    fields,
    signatureFields: fields.filter((f) => /^signature_\d+$/.test(f)),
    hasRecipientName: fields.includes("recipientName"),
    hasQr: fields.includes("verificationQr"),
  };
}

/** Draws an image into the rectangle of a form field, keeping its aspect ratio, and removes the field. */
async function drawIntoField(pdf: PDFDocument, form: PDFForm, name: string, image: Uint8Array, kind: "png" | "jpg") {
  const field = form.getFields().find((f) => f.getName() === name);
  if (!field) return;
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
export async function renderCertificate(
  templateBytes: Uint8Array,
  values: Record<string, string>,
  signatures: SignatureImage[],
  verifyUrl: string | null
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField && values[field.getName()] !== undefined) field.setText(values[field.getName()]);
  }
  for (const s of signatures) {
    if (s.image) await drawIntoField(pdf, form, s.field, s.image.bytes, s.image.kind);
  }
  if (verifyUrl && form.getFields().some((f) => f.getName() === "verificationQr")) {
    const png = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 300 });
    await drawIntoField(pdf, form, "verificationQr", new Uint8Array(png), "png");
  }
  form.flatten();
  if (!verifyUrl) {
    pdf.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      page.drawText("PREVIEW", { x: width * 0.22, y: height * 0.45, size: Math.min(width, height) / 5, color: rgb(0.85, 0.2, 0.2), opacity: 0.25 });
    });
  }
  return pdf.save();
}

/** Sample values for a template preview. */
export const SAMPLE_VALUES: Record<string, string> = {
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
