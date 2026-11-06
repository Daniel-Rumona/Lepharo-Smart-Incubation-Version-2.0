import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { PDFDocument } from "pdf-lib";
import { admin, db } from "./firebase";
import { clean } from "./whatsappCommon";
import { scheduledJob } from "./cronHeartbeat";
import { participantComplianceRecords, RequirementState, requirementStates } from "./complianceExpiry";

/**
 * SMEs sending compliance documents on WhatsApp. The router downloads each file from WhatsApp
 * and stages it here (stage_upload); the assistant asks which required document it is
 * (upload_options) and files it once the SME picks (attach_upload). Filing matches the SME's
 * compliance page (src/routes/incubatee/documents/compliance): the file goes under
 * compliance/{applicationId}/, the application's complianceDocuments subcollection gets a
 * pending entry keyed by the requirement (presetId), replacing an older upload of the same
 * requirement, and the upload is then checked by AI and reviewed by staff as usual.
 *
 * WhatsApp sends every photo as its own message, so files are grouped:
 * - Files arriving within BATCH_MS of each other, before the SME has said which document they
 *   are, are one upload (pages of one document), combined into a single PDF when filed.
 * - A file arriving within FOLLOW_MS of a document being filed may be a missed page; the
 *   assistant asks, and append_upload adds it to that document.
 * whatsappUploadBatches/{participantId} points at the upload that is collecting pages and at
 * the last one filed. Files nobody files are deleted by the daily cleanup below.
 */

export type UploadingSme = { participantId: string; name: string; phoneNumber: string };
type UploadResult = { status: number; body: Record<string, unknown> };
type StagedFile = { path: string; fileName: string; mimeType: string; size: number };

const ok = (body: Record<string, unknown>): UploadResult => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status: number, error: string): UploadResult => ({ status, body: { ok: false, error } });

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 15;
const BATCH_MS = 10 * 60 * 1000;
const FOLLOW_MS = 15 * 60 * 1000;
// A staged upload the SME never files is useless after this; the cleanup deletes its files.
const STAGED_MS = 24 * 60 * 60 * 1000;

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
// What pdf-lib can put into one combined PDF. WhatsApp photos always arrive as JPEG.
const COMBINABLE = new Set(["application/pdf", "image/jpeg", "image/png"]);

const batches = db.collection("whatsappUploadBatches");
const uploads = db.collection("whatsappUploads");
const shortText = (value: unknown, max: number) => clean(value).replace(/\s+/g, " ").slice(0, max);
const millis = (value: any) => value?.toMillis?.() ?? 0;

const storedName = (fileName: string, mimeType: string) => {
  const base = clean(fileName).replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(0, 80);
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base || "whatsapp_upload"}.${EXTENSIONS[mimeType] || "bin"}`;
};

const downloadUrl = (bucketName: string, path: string, token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

const dateText = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/** YYYY-MM-DD, not in the future; anything else is treated as not given. */
function issueDateFrom(value: unknown): Date | null {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now() ? null : date;
}

// Same validity rule as complianceEffectiveExpiry: months clamp to the month's last day.
function expiryFrom(issueDate: Date, months: number) {
  const expiry = new Date(issueDate);
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
  expiry.setUTCDate(Math.min(issueDate.getUTCDate(), lastDay));
  return expiry;
}

// What the SME most needs to send comes first.
const STATUS_ORDER = ["missing", "expired", "invalid", "rejected", "queried", "expiring-soon", "pending", "valid"];

const requirementView = (state: RequirementState) => ({
  key: state.key,
  title: state.title,
  status: state.status,
  expires: dateText(state.expires),
  needsIssueDate: state.expiryMonths > 0,
});

const filesOf = (data: any): StagedFile[] => (Array.isArray(data?.files) ? data.files : []);

async function stagedUpload(sme: UploadingSme, uploadId: string) {
  if (!uploadId) return null;
  const snapshot = await uploads.doc(uploadId).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || clean(data.participantId) !== sme.participantId || data.status !== "staged") return null;
  if (millis(data.createdAt) < Date.now() - STAGED_MS) return null;
  return { ref: snapshot.ref, data };
}

/** One file from the router: added to the upload collecting pages, or the start of a new one. */
export async function stageUpload(sme: UploadingSme, payload: any): Promise<UploadResult> {
  const mimeType = clean(payload.mimeType).toLowerCase().split(";")[0];
  if (!EXTENSIONS[mimeType]) return fail(400, "unsupported_file_type");
  const bytes = Buffer.from(clean(payload.dataBase64), "base64");
  if (!bytes.length) return fail(400, "file_required");
  if (bytes.length > MAX_UPLOAD_BYTES) return fail(413, "file_too_large");

  const fileName = shortText(payload.fileName, 120) || storedName("", mimeType);
  const path = `whatsappUploads/${sme.participantId}/${crypto.randomUUID()}_${storedName(fileName, mimeType)}`;
  await admin.storage().bucket().file(path).save(bytes, { contentType: mimeType, resumable: false });
  const file: StagedFile = { path, fileName, mimeType, size: bytes.length };
  const caption = shortText(payload.caption, 300);

  // A transaction, so photos arriving together can't each start their own upload.
  const result = await db.runTransaction(async (transaction) => {
    const batchRef = batches.doc(sme.participantId);
    const batch = (await transaction.get(batchRef)).data() || {};
    const now = Date.now();
    const openId = clean(batch.openUploadId);
    if (openId && millis(batch.openUntil) > now) {
      const open = await transaction.get(uploads.doc(openId));
      const data = open.data();
      if (open.exists && data?.status === "staged" && filesOf(data).length < MAX_PAGES) {
        const files = [...filesOf(data), file];
        transaction.update(open.ref, {
          files,
          ...(caption && !clean(data.caption) ? { caption } : {}),
          lastFileAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.set(batchRef, { openUntil: admin.firestore.Timestamp.fromMillis(now + BATCH_MS) }, { merge: true });
        return { uploadId: open.id, page: files.length };
      }
    }
    // Shortly after a document was filed, a new file may be a page that was missed.
    const filed = batch.lastFiled || null;
    const follows = filed && millis(filed.at) > now - FOLLOW_MS ? clean(filed.uploadId) : "";
    const ref = uploads.doc();
    transaction.set(ref, {
      participantId: sme.participantId,
      phoneNumber: sme.phoneNumber,
      files: [file],
      caption,
      status: "staged",
      ...(follows ? { followsUploadId: follows } : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastFileAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(batchRef, {
      openUploadId: ref.id,
      openUntil: admin.firestore.Timestamp.fromMillis(now + BATCH_MS),
    }, { merge: true });
    return { uploadId: ref.id, page: 1 };
  });
  return ok(result);
}

/** The SME's required documents and where each stands; with an uploadId, also that upload's details. */
export async function uploadOptions(sme: UploadingSme, payload: any): Promise<UploadResult> {
  const uploadId = clean(payload.uploadId);
  const upload = uploadId ? await stagedUpload(sme, uploadId) : null;
  if (uploadId && !upload) return fail(404, "upload_not_found");
  const [records, follows] = await Promise.all([
    participantComplianceRecords(sme.participantId),
    upload?.data.followsUploadId ? uploads.doc(clean(upload.data.followsUploadId)).get() : Promise.resolve(null),
  ]);
  if (!records.application) return ok({ requirements: [], reason: "no_accepted_application" });
  const requirements = requirementStates(records.documents, records.requirements)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    .map(requirementView);
  const followed = follows?.exists && follows.data()?.status === "attached" ? follows.data() : null;
  return ok({
    requirements,
    programName: records.programName,
    ...(upload ? {
      caption: clean(upload.data.caption),
      pages: filesOf(upload.data).length,
      ...(followed ? { follows: { uploadId: follows!.id, title: clean(followed.title) } } : {}),
    } : {}),
  });
}

/** The staged files as one stored file: as they are when there is one, else combined into a PDF. */
async function combinedFile(files: StagedFile[], extra: Array<{ bytes: Buffer; mimeType: string }> = []) {
  const bucket = admin.storage().bucket();
  const parts = [
    ...extra,
    ...await Promise.all(files.map(async (file) => ({ bytes: (await bucket.file(file.path).download())[0], mimeType: file.mimeType }))),
  ];
  if (parts.length === 1) return { bytes: parts[0].bytes, mimeType: parts[0].mimeType };
  const bytes = await combineToPdf(parts);
  return bytes ? { bytes, mimeType: "application/pdf" } : null;
}

/** PDFs and JPEG/PNG photos as one PDF, in order: a PDF's pages, then a page per photo. Null if a part can't be combined. */
export async function combineToPdf(parts: Array<{ bytes: Buffer; mimeType: string }>): Promise<Buffer | null> {
  if (parts.some((part) => !COMBINABLE.has(part.mimeType))) return null;
  const pdf = await PDFDocument.create();
  for (const part of parts) {
    if (part.mimeType === "application/pdf") {
      const source = await PDFDocument.load(part.bytes, { ignoreEncryption: true });
      (await pdf.copyPages(source, source.getPageIndices())).forEach((page) => pdf.addPage(page));
      continue;
    }
    const image = part.mimeType === "image/png" ? await pdf.embedPng(part.bytes) : await pdf.embedJpg(part.bytes);
    // A4 width, keeping the photo's proportions.
    const width = 595;
    const height = (image.height / image.width) * width;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  return Buffer.from(await pdf.save());
}

/** Saves the bytes where the compliance page keeps uploads, with a download link. */
async function storeComplianceFile(applicationId: string, fileName: string, bytes: Buffer, mimeType: string) {
  const bucket = admin.storage().bucket();
  const name = mimeType === "application/pdf" ? storedName(fileName.replace(/\.[a-z0-9]{2,5}$/i, "") + ".pdf", mimeType) : storedName(fileName, mimeType);
  const path = `compliance/${applicationId}/${Date.now()}_${name}`;
  const token = crypto.randomUUID();
  await bucket.file(path).save(bytes, {
    contentType: mimeType,
    resumable: false,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return { path, url: downloadUrl(bucket.name, path, token), fileName: name };
}

async function deleteStagedFiles(files: StagedFile[]) {
  const bucket = admin.storage().bucket();
  await Promise.all(files.map((file) => bucket.file(file.path).delete({ ignoreNotFound: true })));
}

export async function attachUpload(sme: UploadingSme, payload: any): Promise<UploadResult> {
  const upload = await stagedUpload(sme, clean(payload.uploadId));
  if (!upload) return fail(404, "upload_not_found");
  const records = await participantComplianceRecords(sme.participantId);
  if (!records.application) return fail(409, "no_accepted_application");
  const requirement = requirementStates(records.documents, records.requirements)
    .find((state) => state.key === clean(payload.requirementKey));
  if (!requirement) return fail(400, "requirement_not_found");

  const files = filesOf(upload.data);
  const combined = await combinedFile(files);
  if (!combined) return fail(400, "cannot_combine_files");
  const issueDate = issueDateFrom(payload.issueDate);
  const expiryDate = issueDate && requirement.expiryMonths > 0 ? expiryFrom(issueDate, requirement.expiryMonths) : null;
  const application = records.application;
  const stored = await storeComplianceFile(application.id, files.length > 1 ? requirement.title : files[0].fileName, combined.bytes, combined.mimeType);

  // Replace the upload this requirement already has, found as the compliance page finds it.
  const collection = application.ref.collection("complianceDocuments");
  const existing = (await collection.where("presetId", "==", requirement.key).limit(1).get()).docs[0] ||
    (await collection.where("type", "==", requirement.title).limit(1).get()).docs[0] ||
    null;

  const uploadedBy = `${sme.name} (WhatsApp)`;
  const atISO = new Date().toISOString();
  const document = {
    type: requirement.title,
    documentName: requirement.title,
    presetId: requirement.key,
    status: "pending",
    url: stored.url,
    fileName: stored.fileName,
    uploadedBy,
    issueDate,
    expiryDate,
    queryOpen: false,
    queryReason: "",
    createdVia: "whatsapp",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  let documentId: string;
  if (existing) {
    await existing.ref.update({
      ...document,
      aiVerificationNote: admin.firestore.FieldValue.delete(),
      replacedAt: atISO,
      previousFileUrl: clean(existing.data().url),
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: "pending", by: uploadedBy, atISO, reason: "Document replaced by the SME on WhatsApp.",
      }),
    });
    documentId = existing.id;
  } else {
    const created = await collection.add({
      ...document,
      statusHistory: [{ status: "pending", by: uploadedBy, atISO, reason: "Document uploaded by the SME on WhatsApp." }],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    documentId = created.id;
  }

  await deleteStagedFiles(files);
  await upload.ref.update({
    status: "attached",
    filedPath: stored.path,
    applicationId: application.id,
    documentId,
    requirementKey: requirement.key,
    title: requirement.title,
    attachedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Stop collecting pages for it, and remember it so a page sent next can be offered to it.
  await batches.doc(sme.participantId).set({
    openUploadId: admin.firestore.FieldValue.delete(),
    openUntil: admin.firestore.FieldValue.delete(),
    lastFiled: { uploadId: upload.ref.id, at: admin.firestore.Timestamp.now() },
  }, { merge: true });
  return ok({
    applicationId: application.id,
    documentId,
    title: requirement.title,
    pages: files.length,
    issueDate: dateText(issueDate),
    expiryDate: dateText(expiryDate),
    replaced: !!existing,
  });
}

/** Adds a staged upload's files, as pages, to the document the SME filed just before it. */
export async function appendUpload(sme: UploadingSme, payload: any): Promise<UploadResult> {
  const upload = await stagedUpload(sme, clean(payload.uploadId));
  if (!upload) return fail(404, "upload_not_found");
  const target = clean(upload.data.followsUploadId) ? await uploads.doc(clean(upload.data.followsUploadId)).get() : null;
  const filed = target?.data();
  if (!target?.exists || !filed || filed.status !== "attached" || clean(filed.participantId) !== sme.participantId) {
    return fail(409, "nothing_to_add_to");
  }
  const documentRef = db.collection("applications").doc(clean(filed.applicationId))
    .collection("complianceDocuments").doc(clean(filed.documentId));
  const current = await documentRef.get();
  const currentData = current.data();
  if (!current.exists || !currentData) return fail(409, "nothing_to_add_to");
  // Only while it is still the file this conversation filed; a newer upload from the web wins.
  const filedPath = clean(filed.filedPath);
  if (!clean(currentData.url).includes(encodeURIComponent(filedPath))) return fail(409, "document_changed");

  const bucket = admin.storage().bucket();
  const [existingBytes] = await bucket.file(filedPath).download();
  const existingType = filedPath.toLowerCase().endsWith(".pdf") ? "application/pdf"
    : filedPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const files = filesOf(upload.data);
  const combined = await combinedFile(files, [{ bytes: existingBytes, mimeType: existingType }]);
  if (!combined) return fail(400, "cannot_combine_files");
  const stored = await storeComplianceFile(clean(filed.applicationId), clean(filed.title), combined.bytes, combined.mimeType);
  const pageCount = combined.mimeType === "application/pdf"
    ? (await PDFDocument.load(combined.bytes, { ignoreEncryption: true })).getPageCount()
    : 1;

  const by = `${sme.name} (WhatsApp)`;
  await documentRef.update({
    url: stored.url,
    fileName: stored.fileName,
    status: "pending",
    previousFileUrl: clean(currentData.url),
    aiVerificationNote: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusHistory: admin.firestore.FieldValue.arrayUnion({
      status: "pending", by, atISO: new Date().toISOString(), reason: "Page added by the SME on WhatsApp.",
    }),
  });
  await deleteStagedFiles(files);
  await bucket.file(filedPath).delete({ ignoreNotFound: true });
  await target.ref.update({ filedPath: stored.path });
  await upload.ref.update({
    status: "appended",
    appendedTo: target.id,
    attachedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batches.doc(sme.participantId).set({
    openUploadId: admin.firestore.FieldValue.delete(),
    openUntil: admin.firestore.FieldValue.delete(),
    lastFiled: { uploadId: target.id, at: admin.firestore.Timestamp.now() },
  }, { merge: true });
  return ok({
    applicationId: clean(filed.applicationId),
    documentId: clean(filed.documentId),
    title: clean(filed.title),
    pages: pageCount,
  });
}

/** Daily: delete the files of uploads nobody filed within a day, and mark them expired. */
export const whatsappUploadCleanup = scheduledJob("whatsappUploadCleanup",
  {
    region: "us-central1",
    schedule: "15 3 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const cutoff = Date.now() - STAGED_MS;
    // Only staged uploads (few: filing or this job moves them on), so this never needs a composite index.
    const stale = await uploads.where("status", "==", "staged").limit(500).get();
    let expired = 0;
    for (const doc of stale.docs) {
      if (millis(doc.data().createdAt) >= cutoff) continue;
      await deleteStagedFiles(filesOf(doc.data()));
      await doc.ref.update({ status: "expired", files: [], expiredAt: admin.firestore.FieldValue.serverTimestamp() });
      expired += 1;
    }
    logger.info("WhatsApp upload cleanup", { checked: stale.size, expired });
  });
