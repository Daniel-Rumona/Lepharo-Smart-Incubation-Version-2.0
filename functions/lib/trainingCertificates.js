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
exports.verifyCertificate = exports.certificatesToSign = exports.revokeTrainingCertificate = exports.signTrainingCertificates = exports.certificateTemplateAction = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const logger = __importStar(require("firebase-functions/logger"));
const crypto = __importStar(require("crypto"));
const firebase_1 = require("./firebase");
const departmentRoles_1 = require("./departmentRoles");
const certificatePdf_1 = require("./certificatePdf");
/*
 * Training Academy certificates (docs/training-academy-certification-and-employees-plan.md, section 5).
 *
 * Staff upload a fillable PDF whose form-field names are the placeholders,
 * prepare drafts for eligible people and send them for signature. The
 * signatory (by default the Academy head) signs here with their profile
 * signature; on the last signature the certificate is issued on the server:
 * numbered, filled, signed, flattened, hashed and given an HMAC verification
 * code that the public verify page checks. Clients never write signatures,
 * numbers, PDFs or codes (firestore.rules).
 */
const REGION = "us-central1";
const STAFF_ROLES = ["operations", "coordinator", "system_admin", "superadmin", "director", "projectadmin"];
const verifySecret = (0, params_1.defineSecret)("CERTIFICATE_VERIFY_SECRET");
const APP_URL = process.env.APP_BASE_URL || "https://lepharosmartinc.co.za";
const str = (v) => (typeof v === "string" ? v.trim() : "");
async function profileOf(uid) {
    return (await firebase_1.db.doc(`users/${uid}`).get()).data() || {};
}
async function requireStaff(uid) {
    const profile = await profileOf(uid);
    if (!STAFF_ROLES.includes(str(profile.role).toLowerCase())) {
        throw new https_1.HttpsError("permission-denied", "Only Training Academy staff can do this.");
    }
    return profile;
}
/** The Academy head: the head of the department assigned the "training" role (by role, never by name). */
async function academyHeadUid() {
    const { roles, departments } = await (0, departmentRoles_1.loadDepartmentRoles)();
    const academy = departments.find((d) => d.id === roles.training);
    return str(academy?.headUserId);
}
/** Which of a certificate's signatories this user signs as (and hasn't yet). */
async function signatoryKeysFor(uid, certificate) {
    const signed = certificate.signatures || {};
    const head = (certificate.signatories || []).some((s) => s.departmentRole === "training") ? await academyHeadUid() : "";
    return (certificate.signatories || [])
        .filter((s) => !signed[s.key] && (s.userId ? s.userId === uid : s.departmentRole === "training" && head === uid))
        .map((s) => s.key);
}
async function downloadTemplate(path) {
    const [bytes] = await firebase_1.admin.storage().bucket().file(path).download();
    return new Uint8Array(bytes);
}
async function fetchImage(url) {
    if (!url)
        return null;
    try {
        const response = await fetch(url);
        if (!response.ok)
            return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        // PNG signature 89 50 4E 47; anything else is tried as JPEG.
        return { bytes, kind: bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : "jpg" };
    }
    catch {
        return null;
    }
}
/** The values a template's fields are filled with. */
function fieldValues(certificate, signatoryNames) {
    const values = { ...(certificate.data || {}) };
    values.recipientName = str(certificate.recipientName);
    values.companyName = str(certificate.companyName);
    if (certificate.certificateNumber)
        values.certificateNumber = certificate.certificateNumber;
    if (certificate.verificationCode)
        values.verificationCode = certificate.verificationCode;
    signatoryNames.forEach((s, i) => {
        values[`signatory${i + 1}Name`] = s.name;
        values[`signatory${i + 1}Title`] = s.title;
    });
    return values;
}
/* ---------------------------- staff: templates ---------------------------- */
/**
 * inspect: the field names in an uploaded template, its signature fields, and
 * whether the required recipientName field is there.
 * preview: the template filled with sample values, watermarked, as base64.
 */
exports.certificateTemplateAction = (0, https_1.onCall)({ region: REGION, timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    await requireStaff(request.auth.uid);
    const path = str(request.data?.path);
    if (!/^certificate_templates\/[A-Za-z0-9_-]+\/[^/]+$/.test(path))
        throw new https_1.HttpsError("invalid-argument", "Unknown template file.");
    try {
        const bytes = await downloadTemplate(path);
        if (request.data?.action === "preview") {
            return { pdfBase64: Buffer.from(await (0, certificatePdf_1.renderCertificate)(bytes, certificatePdf_1.SAMPLE_VALUES, [], null)).toString("base64") };
        }
        return await (0, certificatePdf_1.templateFields)(bytes);
    }
    catch (error) {
        logger.warn("certificateTemplateAction.unreadable", { path, err: String(error) });
        throw new https_1.HttpsError("failed-precondition", "That file couldn't be read as a fillable PDF.");
    }
});
/* ------------------------------ signing/issue ----------------------------- */
async function issue(certificateId, secret) {
    const ref = firebase_1.db.doc(`trainingCertificates/${certificateId}`);
    const certificate = (await ref.get()).data();
    const template = (await firebase_1.db.doc(`certificateTemplates/${certificate.templateId}`).get()).data();
    if (!template?.file?.path)
        throw new https_1.HttpsError("failed-precondition", "The certificate template is missing.");
    // Numbers are handed out only at issue, so drafts never use one up.
    const now = new Date();
    const year = String(now.getFullYear());
    const next = await firebase_1.db.runTransaction(async (tx) => {
        const counterRef = firebase_1.db.doc(`certificateCounters/${year}`);
        const n = Number((await tx.get(counterRef)).data()?.next || 1);
        tx.set(counterRef, { next: n + 1 }, { merge: true });
        return n;
    });
    const certificateNumber = `LPH-TA-${year}-${String(next).padStart(6, "0")}`;
    const issuedAt = now.toISOString();
    const verificationCode = (0, certificatePdf_1.verificationCodeFor)(secret, {
        id: certificateId,
        certificateNumber,
        recipientName: str(certificate.recipientName),
        trainingId: str(certificate.trainingId),
        issuedAt,
    });
    const issued = { ...certificate, certificateNumber, verificationCode };
    const signatories = certificate.signatories || [];
    const names = signatories.map((s) => ({ name: str(certificate.signatures?.[s.key]?.name), title: str(certificate.signatures?.[s.key]?.title) || str(s.title) }));
    const verifyUrl = `${APP_URL}/verify-certificate?c=${encodeURIComponent(verificationCode)}`;
    const signatureImages = await Promise.all(signatories.map(async (s, i) => ({ field: `signature_${i + 1}`, image: await fetchImage(str(certificate.signatures?.[s.key]?.signatureURL)) })));
    if (signatureImages.some((s) => !s.image))
        throw new https_1.HttpsError("failed-precondition", "A signature image couldn't be loaded.");
    const bytes = await (0, certificatePdf_1.renderCertificate)(await downloadTemplate(template.file.path), fieldValues(issued, names), signatureImages, verifyUrl);
    const path = `certificates/${certificate.trainingId}/${certificateId}.pdf`;
    const token = crypto.randomUUID();
    const bucket = firebase_1.admin.storage().bucket();
    await bucket.file(path).save(Buffer.from(bytes), {
        contentType: "application/pdf",
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    await ref.update({
        status: "issued",
        templateVersion: Number(template.version || 1),
        certificateNumber,
        verificationCode,
        issuedAt,
        pdfPath: path,
        pdfUrl,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        data: { ...(certificate.data || {}), certificateNumber, verificationCode },
        updatedAt: issuedAt,
    });
}
/** The signatory signs one or more certificates; each is issued once its last signature lands. */
exports.signTrainingCertificates = (0, https_1.onCall)({ region: REGION, secrets: [verifySecret], timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    const uid = request.auth.uid;
    const profile = await profileOf(uid);
    const signatureURL = str(profile.signatureURL);
    if (!signatureURL)
        throw new https_1.HttpsError("failed-precondition", "Add your signature in Account settings first.");
    const ids = Array.isArray(request.data?.ids) ? request.data.ids.map(str).filter(Boolean).slice(0, 100) : [];
    if (!ids.length)
        throw new https_1.HttpsError("invalid-argument", "Choose the certificates to sign.");
    const results = [];
    for (const id of ids) {
        try {
            const ref = firebase_1.db.doc(`trainingCertificates/${id}`);
            const signedNow = await firebase_1.db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const certificate = snap.data();
                if (!certificate || certificate.status !== "pending_signature")
                    return { skip: "Not waiting for a signature." };
                const keys = await signatoryKeysFor(uid, certificate);
                const allSigned = (certificate.signatories || []).every((s) => certificate.signatures?.[s.key]);
                // Fully signed but not issued (issuing failed): a signatory retries the issue.
                if (!keys.length && allSigned && Object.values(certificate.signatures || {}).some((s) => s?.uid === uid)) {
                    return { complete: true };
                }
                if (!keys.length)
                    return { skip: "You aren't a signatory of this certificate, or have already signed it." };
                const signedAt = new Date().toISOString();
                const signatures = { ...(certificate.signatures || {}) };
                keys.forEach((key) => {
                    const title = str((certificate.signatories || []).find((s) => s.key === key)?.title);
                    signatures[key] = {
                        uid,
                        name: str(profile.name) || str(profile.email),
                        title: str(profile.jobTitle) || str(profile.position) || title,
                        signatureURL,
                        signedAt,
                        userAgent: str(request.rawRequest?.headers?.["user-agent"]),
                    };
                });
                tx.update(ref, { signatures, updatedAt: signedAt });
                const complete = (certificate.signatories || []).every((s) => signatures[s.key]);
                return { complete };
            });
            if ("skip" in signedNow) {
                results.push({ id, status: "skipped", reason: signedNow.skip });
                continue;
            }
            if (signedNow.complete) {
                await issue(id, verifySecret.value());
                results.push({ id, status: "issued" });
            }
            else
                results.push({ id, status: "signed" });
        }
        catch (error) {
            logger.error("signTrainingCertificates.failed", { id, err: String(error) });
            results.push({ id, status: "skipped", reason: error instanceof https_1.HttpsError ? error.message : "Could not be issued; try again." });
        }
    }
    return { results };
});
/** Staff withdraw an issued certificate; the verify page then shows it as revoked. */
exports.revokeTrainingCertificate = (0, https_1.onCall)({ region: REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    await requireStaff(request.auth.uid);
    const id = str(request.data?.id);
    const reason = str(request.data?.reason);
    if (!id || !reason)
        throw new https_1.HttpsError("invalid-argument", "Say why the certificate is being revoked.");
    const ref = firebase_1.db.doc(`trainingCertificates/${id}`);
    const certificate = (await ref.get()).data();
    if (certificate?.status !== "issued")
        throw new https_1.HttpsError("failed-precondition", "Only an issued certificate can be revoked.");
    const now = new Date().toISOString();
    await ref.update({ status: "revoked", revokedAt: now, revokedBy: request.auth.uid, revokedReason: reason, updatedAt: now });
    return { id };
});
/** Which of the pending certificates the caller can sign (the signing page's list). */
exports.certificatesToSign = (0, https_1.onCall)({ region: REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to continue.");
    await requireStaff(request.auth.uid);
    const snap = await firebase_1.db.collection("trainingCertificates").where("status", "==", "pending_signature").get();
    const mine = [];
    for (const d of snap.docs)
        if ((await signatoryKeysFor(request.auth.uid, d.data())).length)
            mine.push(d.id);
    return { ids: mine };
});
/* --------------------------- public verification -------------------------- */
// Per-instance throttle: enough to stop casual guessing (codes are 32^16 anyway).
const hits = new Map();
const throttled = (ip) => {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.until < now) {
        hits.set(ip, { count: 1, until: now + 60000 });
        return false;
    }
    entry.count += 1;
    return entry.count > 30;
};
/** GET ?c=CODE: whether the certificate is genuine, with only what a verifier needs to see. */
exports.verifyCertificate = (0, https_1.onRequest)({ region: REGION, secrets: [verifySecret], invoker: "public", maxInstances: 3 }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "method_not_allowed" });
        return;
    }
    if (throttled(String(req.ip || "unknown"))) {
        res.status(429).json({ ok: false, error: "too_many_requests" });
        return;
    }
    const code = (0, certificatePdf_1.normalizeCode)(req.query.c);
    if (!code) {
        res.status(400).json({ ok: false, error: "invalid_code" });
        return;
    }
    const snap = await firebase_1.db.collection("trainingCertificates").where("verificationCode", "==", code).limit(1).get();
    const doc = snap.docs[0];
    const c = doc?.data();
    // The stored code must also be the one this certificate's own details produce.
    const genuine = !!c &&
        ["issued", "revoked"].includes(c.status) &&
        (0, certificatePdf_1.verificationCodeFor)(verifySecret.value(), {
            id: doc.id,
            certificateNumber: str(c.certificateNumber),
            recipientName: str(c.recipientName),
            trainingId: str(c.trainingId),
            issuedAt: str(c.issuedAt),
        }) === code;
    if (!genuine) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
    }
    const training = (await firebase_1.db.doc(`trainings/${c.trainingId}`).get()).data();
    res.status(200).json({
        ok: true,
        status: c.status === "revoked" ? "revoked" : "valid",
        recipientName: c.recipientName,
        companyName: c.companyName,
        trainingName: str(training?.name) || str(c.data?.trainingName),
        certificateNumber: c.certificateNumber,
        issuedAt: c.issuedAt,
        sha256: c.sha256,
        ...(c.status === "revoked" ? { revokedAt: c.revokedAt } : {}),
    });
});
//# sourceMappingURL=trainingCertificates.js.map