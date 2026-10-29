import { collection, doc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import dayjs from "dayjs";
import { db, functions, storage } from "@/firebase";
import { functionsBaseUrl } from "@/firebaseConfig";
import type { Training, TrainingAttendee, TrainingEnrollment } from "./trainingStorage";
import type { CertificateTemplate, CertificationSettings, TrainingCertificate } from "./certification";

/*
 * Certificate templates and certificates on the client. Staff upload
 * templates and prepare drafts; everything after that (signatures, number,
 * PDF, verification code, revoking) is done by the functions in
 * functions/src/trainingCertificates.ts, because clients may not write it.
 */

const templatesRef = collection(db, "certificateTemplates");
const certificatesRef = collection(db, "trainingCertificates");

export async function listCertificateTemplates(): Promise<CertificateTemplate[]> {
  return (await getDocs(templatesRef)).docs.map((d) => ({ ...(d.data() as Omit<CertificateTemplate, "id">), id: d.id }));
}

type TemplateInfo = { fields: string[]; signatureFields: string[]; hasRecipientName: boolean; hasQr: boolean };

const templateAction = async (action: "inspect" | "preview", path: string) =>
  (await httpsCallable(functions, "certificateTemplateAction")({ action, path })).data;

/**
 * Uploads a fillable PDF and records it. Re-uploading for an existing template
 * makes a new version (issued certificates keep the version they used). The
 * server reads the field names; a template without recipientName is refused.
 */
export async function saveCertificateTemplate(input: { id?: string; name: string; file?: File; trainingIds?: string[]; active: boolean; previous?: CertificateTemplate }, uid: string) {
  const id = input.id || doc(templatesRef).id;
  const now = new Date().toISOString();
  let file = input.previous?.file;
  let info: TemplateInfo | null = null;
  if (input.file) {
    const path = `certificate_templates/${id}/v${(input.previous?.version || 0) + 1}_${Date.now()}.pdf`;
    await uploadBytes(ref(storage, path), input.file, { contentType: "application/pdf" });
    info = (await templateAction("inspect", path)) as TemplateInfo;
    if (!info.hasRecipientName) throw new Error('This PDF has no "recipientName" field. Add a form field with that exact name where the name should go.');
    if (!info.signatureFields.length) throw new Error('This PDF has no "signature_1" field for the signature.');
    file = { path, url: "", kind: "pdf" };
  }
  if (!file) throw new Error("Choose the certificate PDF.");
  const record: Omit<CertificateTemplate, "id"> = {
    name: input.name.trim(),
    active: input.active,
    version: info ? (input.previous?.version || 0) + 1 : input.previous?.version || 1,
    file,
    fields: info ? info.fields : input.previous?.fields || [],
    signatureFields: info ? info.signatureFields : input.previous?.signatureFields || [],
    trainingIds: input.trainingIds || [],
    createdBy: input.previous?.createdBy || uid,
    createdAt: input.previous?.createdAt || now,
    updatedAt: now,
  };
  await setDoc(doc(templatesRef, id), record);
  return { id, warnings: info && !info.hasQr ? ['No "verificationQr" field: the QR code is left off (the printed code still verifies).'] : [] };
}

/** The template filled with sample values, watermarked PREVIEW, opened in a new tab. */
export async function previewCertificateTemplate(template: CertificateTemplate) {
  const { pdfBase64 } = (await templateAction("preview", template.file.path)) as { pdfBase64: string };
  const blob = new Blob([Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
  window.open(URL.createObjectURL(blob), "_blank", "noopener");
}

export async function listCertificates(): Promise<TrainingCertificate[]> {
  return (await getDocs(certificatesRef)).docs.map((d) => ({ ...(d.data() as Omit<TrainingCertificate, "id">), id: d.id }));
}

/** Someone (or a company) awaiting a certificate: what staff prepare from. */
export type CertificateCandidate = { training: Training; enrollment: TrainingEnrollment; attendee: TrainingAttendee | null };

const formatDate = (iso: string) => (iso ? dayjs(iso).format("D MMMM YYYY") : "");

/**
 * Creates a draft per candidate with the values it will be filled with, then
 * sends it to the signatory. A candidate who already has a certificate that
 * isn't revoked is skipped.
 */
export async function prepareCertificates(
  candidates: CertificateCandidate[],
  settingsFor: (training: Training) => CertificationSettings,
  existing: TrainingCertificate[],
  uid: string
): Promise<{ prepared: number; skipped: string[] }> {
  const skipped: string[] = [];
  let prepared = 0;
  for (const { training, enrollment, attendee } of candidates) {
    const name = attendee ? attendee.name : enrollment.companyName || enrollment.name;
    const settings = settingsFor(training);
    if (!settings.templateId) {
      skipped.push(`${name}: choose a certificate template in ${training.name}'s certification settings`);
      continue;
    }
    const taken = existing.some(
      (c) => c.status !== "revoked" && c.enrollmentId === enrollment.id && (c.attendeeId || null) === (attendee?.id || null)
    );
    if (taken) {
      skipped.push(`${name}: already has a certificate`);
      continue;
    }
    const now = new Date().toISOString();
    const ref = doc(certificatesRef);
    const draft: Omit<TrainingCertificate, "id"> = {
      trainingId: training.id,
      enrollmentId: enrollment.id,
      attendeeId: attendee?.id || null,
      recipientName: name,
      companyName: enrollment.companyName || "",
      templateId: settings.templateId,
      templateVersion: 0,
      data: {
        trainingName: training.name,
        categories: (attendee ? attendee.categories : enrollment.categories || []).join(", "),
        completionDate: formatDate(now),
        startDate: formatDate(training.durationStart),
        endDate: formatDate(training.durationEnd),
        centreName: (training.centers || []).map((c) => c.name).join(", "),
      },
      status: "draft",
      signatories: settings.signatories,
      signatures: {},
      ...(enrollment.dataOrigin === "synthetic" || attendee?.dataOrigin === "synthetic" ? { dataOrigin: "synthetic" as const, suppressNotifications: true } : {}),
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(ref, draft);
    // The rules only allow drafts to be created; sending for signature is the next step.
    await updateDoc(ref, { status: "pending_signature", updatedAt: new Date().toISOString() });
    prepared += 1;
  }
  return { prepared, skipped };
}

/** Staff correct a name before it is signed (e.g. the spelling on their ID). */
export async function renameCertificate(id: string, recipientName: string) {
  await updateDoc(doc(certificatesRef, id), { recipientName: recipientName.trim(), updatedAt: new Date().toISOString() });
}

export async function certificatesToSign(): Promise<string[]> {
  return ((await httpsCallable(functions, "certificatesToSign")({})).data as { ids: string[] }).ids;
}

export type SignResult = { id: string; status: "issued" | "signed" | "skipped"; reason?: string };

export async function signCertificates(ids: string[]): Promise<SignResult[]> {
  return ((await httpsCallable(functions, "signTrainingCertificates")({ ids })).data as { results: SignResult[] }).results;
}

export async function revokeCertificate(id: string, reason: string) {
  await httpsCallable(functions, "revokeTrainingCertificate")({ id, reason });
}

/**
 * The issued certificates a training SME login may see: the director all of
 * the company's, an employee their own and the company's (company mode).
 * The queries match firestore.rules so they are allowed.
 */
export async function myIssuedCertificates(enrollmentId: string, attendeeId: string | null, isDirector: boolean): Promise<TrainingCertificate[]> {
  const base = [where("enrollmentId", "==", enrollmentId), where("status", "==", "issued")];
  const snaps = isDirector
    ? [await getDocs(query(certificatesRef, ...base))]
    : await Promise.all([
        ...(attendeeId ? [getDocs(query(certificatesRef, ...base, where("attendeeId", "==", attendeeId)))] : []),
        getDocs(query(certificatesRef, ...base, where("attendeeId", "==", null))),
      ]);
  return snaps.flatMap((s) => s.docs.map((d) => ({ ...(d.data() as Omit<TrainingCertificate, "id">), id: d.id })));
}

export type VerifyResult =
  | { ok: true; status: "valid" | "revoked"; recipientName: string; companyName: string; trainingName: string; certificateNumber: string; issuedAt: string; sha256: string; revokedAt?: string }
  | { ok: false; error: string };

/** Public: checks a code against the issuing records (no sign-in). */
export async function verifyCertificateCode(code: string): Promise<VerifyResult> {
  const response = await fetch(`${functionsBaseUrl}/verifyCertificate?c=${encodeURIComponent(code)}`);
  return (await response.json().catch(() => ({ ok: false, error: "unreachable" }))) as VerifyResult;
}
