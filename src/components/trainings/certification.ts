/*
 * Training Academy certification: the rules a person (or, in company mode, the
 * SME) must meet, the progress the Cloud Function keeps against them, and the
 * certificates that are prepared, signed and issued. Rules have global defaults
 * (trainingSettings/certification) that a training overrides field by field.
 * The progress Cloud Function evaluates them (functions/src/trainingProgressDomain.ts
 * mirrors these types; keep both in step).
 * See docs/training-academy-certification-and-employees-plan.md.
 */

/** Per-person certificates, or one certificate to the company saying it completed the training. */
export type CertificateAwardTo = "attendee" | "company";

export type CertificationRules = {
  /** Attended at least this % of the held sessions the person was invited to. */
  minAttendancePercent?: number | null;
  /** Plan sessions that must each be attended: a TrainingPlanSession id, or a series id (any one occurrence). */
  requiredPlanSessionIds?: string[];
  /** Attended at least this many held sessions in each of the person's categories. */
  perCategoryMinSessions?: number | null;
  /** Academy courses that must be completed. Courses are director-only for now. */
  requiredCourseIds?: string[];
  /** Minimum average assessment score (%) across the required courses. */
  minAverageScore?: number | null;
  /** Company documents on the enrollment, and the person's ID number and ID copy, are on file. */
  requiredDocuments?: boolean;
};

/** Who signs. departmentRole "training" resolves at signing time to the Academy head (that department's headUserId). */
export type CertificateSignatory = {
  key: string;
  title: string;
  userId?: string;
  departmentRole?: "training";
};

export type CertificationSettings = {
  enabled: boolean;
  awardTo: CertificateAwardTo;
  templateId: string | null;
  rules: CertificationRules;
  signatories: CertificateSignatory[];
};

/** What a training stores: any field it leaves out comes from the global defaults. */
export type TrainingCertificationOverride = Partial<Omit<CertificationSettings, "rules">> & {
  rules?: CertificationRules;
};

export const CERTIFICATION_SETTINGS_DOC = { collection: "trainingSettings", id: "certification" } as const;

/** Used when trainingSettings/certification has not been saved yet. */
export const DEFAULT_CERTIFICATION: CertificationSettings = {
  enabled: false,
  awardTo: "attendee",
  templateId: null,
  rules: { minAttendancePercent: 80, requiredDocuments: true },
  signatories: [{ key: "academy_head", title: "Head of Training Academy", departmentRole: "training" }],
};

/** The settings that apply to one training: its own values over the global defaults, rule by rule. */
export function effectiveCertification(
  defaults: Partial<CertificationSettings> | null | undefined,
  training: TrainingCertificationOverride | null | undefined
): CertificationSettings {
  const base: CertificationSettings = {
    ...DEFAULT_CERTIFICATION,
    ...(defaults || {}),
    rules: { ...DEFAULT_CERTIFICATION.rules, ...(defaults?.rules || {}) },
  };
  const own = training || {};
  const pick = <K extends keyof CertificationSettings>(key: K): CertificationSettings[K] =>
    own[key] !== undefined ? (own[key] as CertificationSettings[K]) : base[key];
  return {
    enabled: pick("enabled"),
    awardTo: pick("awardTo"),
    templateId: pick("templateId"),
    signatories: own.signatories?.length ? own.signatories : base.signatories,
    rules: { ...base.rules, ...(own.rules || {}) },
  };
}

export type EligibilityOverride = { by: string; byName: string; reason: string; at: string };

export type EligibilityStatus = "not_started" | "in_progress" | "eligible" | "certified" | "revoked";

/** Kept on trainingAttendees/{id}.progress by the progress function; clients never write it. */
export type AttendeeProgress = {
  sessionsInvited: number;
  sessionsHeld: number;
  sessionsAttended: number;
  attendancePercent: number;
  byCategory: Record<string, { held: number; attended: number }>;
  courses: Record<string, { required: number; completed: number; score?: number }>;
  eligibility: {
    status: EligibilityStatus;
    met: string[];
    missing: string[];
    overridden: boolean;
    evaluatedAt: string;
  };
  certificateId?: string | null;
};

/**
 * trainingCompanyProgress/{enrollmentId}: totals only, readable by everyone in
 * the company. It holds no names or per-person rows, because employees may see
 * only company totals and their own progress.
 */
export type TrainingCompanyProgress = {
  enrollmentId: string;
  trainingId: string;
  people: number;
  attendingPeople: number;
  sessionsHeld: number;
  /** Person-sessions: one per attended invitation. */
  attendances: number;
  invitations: number;
  attendancePercent: number;
  eligiblePeople: number;
  certifiedPeople: number;
  certificationEnabled: boolean;
  awardTo: CertificateAwardTo;
  /** Company mode only. */
  companyEligibility?: AttendeeProgress["eligibility"];
  companyCertificateId?: string | null;
  updatedAt: string;
};

/** certificateTemplates/{id}: a fillable PDF whose form-field names are the placeholders. */
export type CertificateTemplate = {
  id: string;
  name: string;
  active: boolean;
  version: number;
  file: { path: string; url: string; kind: "pdf" };
  /** Form-field names found in the PDF on upload. */
  fields: string[];
  /** Fields whose rectangle a signature image is drawn into, e.g. signature_1. */
  signatureFields: string[];
  trainingIds?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Field names a template may use; recipientName is required. */
export const CERTIFICATE_FIELDS = [
  "recipientName",
  "companyName",
  "trainingName",
  "categories",
  "completionDate",
  "startDate",
  "endDate",
  "certificateNumber",
  "verificationCode",
  "centreName",
  "signatory1Name",
  "signatory1Title",
  "signatory2Name",
  "signatory2Title",
] as const;

export type CertificateStatus = "draft" | "pending_signature" | "issued" | "revoked";

export type CertificateSignature = {
  uid: string;
  name: string;
  title: string;
  signatureURL: string;
  signedAt: string;
  userAgent: string;
};

/** trainingCertificates/{id}: one per awarded person, or one per company in company mode (attendeeId null). */
export type TrainingCertificate = {
  id: string;
  trainingId: string;
  enrollmentId: string;
  attendeeId: string | null;
  recipientName: string;
  companyName: string;
  /** Assigned by the issuing function from certificateCounters, so drafts never use up a number. */
  certificateNumber?: string;
  templateId: string;
  templateVersion: number;
  /** The exact values filled into the template. */
  data: Record<string, string>;
  status: CertificateStatus;
  signatories: CertificateSignatory[];
  /** Keyed by signatory key; written only by the signing function. */
  signatures: Record<string, CertificateSignature>;
  pdfPath?: string;
  pdfUrl?: string;
  sha256?: string;
  verificationCode?: string;
  issuedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  dataOrigin?: "synthetic" | "real";
  suppressNotifications?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
