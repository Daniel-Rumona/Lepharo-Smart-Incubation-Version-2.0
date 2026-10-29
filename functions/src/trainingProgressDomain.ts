/*
 * Training Academy certification: pure rules, no Firestore. trainingProgress.ts
 * gathers the facts for one SME and calls these; trainingProgressDomain.test.cjs
 * tests them directly. The client mirrors the types in
 * src/components/trainings/certification.ts (keep both in step).
 */

export type CertificationRules = {
  minAttendancePercent?: number | null;
  requiredPlanSessionIds?: string[];
  perCategoryMinSessions?: number | null;
  requiredCourseIds?: string[];
  minAverageScore?: number | null;
  requiredDocuments?: boolean;
};

export type CertificateSignatory = { key: string; title: string; userId?: string; departmentRole?: "training" };

export type CertificationSettings = {
  enabled: boolean;
  awardTo: "attendee" | "company";
  templateId: string | null;
  rules: CertificationRules;
  signatories: CertificateSignatory[];
};

export type CertificationOverride = Partial<Omit<CertificationSettings, "rules">> & { rules?: CertificationRules };

export const DEFAULT_CERTIFICATION: CertificationSettings = {
  enabled: false,
  awardTo: "attendee",
  templateId: null,
  rules: { minAttendancePercent: 80, requiredDocuments: true },
  signatories: [{ key: "academy_head", title: "Head of Training Academy", departmentRole: "training" }],
};

/** A training's own values over the global defaults, rule by rule. */
export function effectiveCertification(
  defaults: Partial<CertificationSettings> | null | undefined,
  training: CertificationOverride | null | undefined
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

/** One invitation of the person (or, for the company, of anyone from it). */
export type InvitationFact = {
  /** Plan session (or, for a repeating one, its series): attending any occurrence attends it. */
  planGroup: string | null;
  category: string | null;
  held: boolean;
  attended: boolean;
};

export type CourseFact = { courseId: string; title: string; required: number; completed: number; scores: number[] };

export type EligibilityStatus = "not_started" | "in_progress" | "eligible" | "certified" | "revoked";

export type Eligibility = {
  status: EligibilityStatus;
  met: string[];
  missing: string[];
  overridden: boolean;
  evaluatedAt: string;
};

export type Progress = {
  sessionsInvited: number;
  sessionsHeld: number;
  sessionsAttended: number;
  attendancePercent: number;
  byCategory: Record<string, { held: number; attended: number }>;
  courses: Record<string, { required: number; completed: number; score?: number }>;
  eligibility: Eligibility;
  certificateId?: string | null;
};

export type EvaluationInput = {
  rules: CertificationRules;
  invitations: InvitationFact[];
  /** The categories the person (or company) attends; empty means none were chosen. */
  categories: string[];
  /** Courses count only for someone who takes them (the director, for now); null skips course rules. */
  courses: CourseFact[] | null;
  /** Plan groups' titles, for readable rule results. */
  planTitles: Record<string, string>;
  documentsOk: boolean;
  documentsMissing: string[];
  overridden: boolean;
  certificateId: string | null;
  now: string;
};

const GENERAL = "General";
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Attendance figures, each enabled rule as met or missing, and the resulting status. */
export function evaluate(input: EvaluationInput): Progress {
  const { rules, invitations } = input;
  const held = invitations.filter((i) => i.held);
  const attended = held.filter((i) => i.attended);
  const byCategory: Progress["byCategory"] = {};
  held.forEach((i) => {
    const key = i.category || GENERAL;
    byCategory[key] = byCategory[key] || { held: 0, attended: 0 };
    byCategory[key].held += 1;
    if (i.attended) byCategory[key].attended += 1;
  });
  const percent = pct(attended.length, held.length);
  const met: string[] = [];
  const missing: string[] = [];
  const check = (ok: boolean, label: string) => (ok ? met : missing).push(label);

  if (typeof rules.minAttendancePercent === "number" && rules.minAttendancePercent > 0) {
    check(
      held.length > 0 && percent >= rules.minAttendancePercent,
      `Attend at least ${rules.minAttendancePercent}% of sessions (${held.length ? `${percent}% so far` : "none held yet"})`
    );
  }

  // A required session only applies to someone invited to it (e.g. not another category's session).
  (rules.requiredPlanSessionIds || []).forEach((group) => {
    const theirs = invitations.filter((i) => i.planGroup === group);
    if (!theirs.length) return;
    check(theirs.some((i) => i.attended), `Attend ${input.planTitles[group] || "a required session"}`);
  });

  if (typeof rules.perCategoryMinSessions === "number" && rules.perCategoryMinSessions > 0) {
    const n = rules.perCategoryMinSessions;
    const categories = input.categories.length ? input.categories : Object.keys(byCategory).filter((c) => c !== GENERAL);
    categories.forEach((c) => {
      const got = byCategory[c]?.attended || 0;
      check(got >= n, `Attend ${n} ${c} session${n === 1 ? "" : "s"} (${got} so far)`);
    });
  }

  const courses: Progress["courses"] = {};
  if (input.courses) {
    const required = new Set(rules.requiredCourseIds || []);
    input.courses.forEach((c) => {
      const score = c.scores.length ? Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length) : undefined;
      courses[c.courseId] = { required: c.required, completed: c.completed, ...(score === undefined ? {} : { score }) };
      if (required.has(c.courseId)) check(c.required > 0 && c.completed >= c.required, `Complete the course ${c.title}`);
    });
    if (typeof rules.minAverageScore === "number" && rules.minAverageScore > 0) {
      const scores = input.courses.filter((c) => required.size === 0 || required.has(c.courseId)).flatMap((c) => c.scores);
      const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      check(
        average !== null && average >= rules.minAverageScore,
        `Average assessment score of at least ${rules.minAverageScore}% (${average === null ? "no scores yet" : `${average}% so far`})`
      );
    }
  }

  if (rules.requiredDocuments) {
    check(
      input.documentsOk,
      input.documentsOk ? "Documents on file" : `Documents on file (missing: ${input.documentsMissing.join(", ") || "some"})`
    );
  }

  const started = attended.length > 0 || Object.values(courses).some((c) => c.completed > 0);
  const status: EligibilityStatus = input.certificateId
    ? "certified"
    : input.overridden || (missing.length === 0 && met.length > 0)
      ? "eligible"
      : started
        ? "in_progress"
        : "not_started";

  return {
    sessionsInvited: invitations.length,
    sessionsHeld: held.length,
    sessionsAttended: attended.length,
    attendancePercent: percent,
    byCategory,
    courses,
    eligibility: { status, met, missing, overridden: input.overridden, evaluatedAt: input.now },
    certificateId: input.certificateId,
  };
}

/** Documents a training asks for when it lists none of its own (src/components/trainings/trainingStorage.ts). */
export const DEFAULT_REQUIRED_DOCUMENTS = ["ID Copy", "Report / Qualification", "CV", "Registration Form"];

/** The company documents the training asks for that the enrollment doesn't have. */
export function missingCompanyDocuments(
  enrollment: { documents?: { label?: string }[]; idDocument?: unknown; qualificationDocument?: unknown; cvDocument?: unknown; registrationFormDocument?: unknown },
  requiredDocuments: string[] | undefined
): string[] {
  const required = requiredDocuments?.length ? requiredDocuments : DEFAULT_REQUIRED_DOCUMENTS;
  const have = new Set((enrollment.documents || []).map((d) => String(d?.label || "").toLowerCase()));
  // Older records kept fixed slots instead of a labelled list.
  const legacy: Record<string, unknown> = {
    "id copy": enrollment.idDocument,
    "report / qualification": enrollment.qualificationDocument,
    cv: enrollment.cvDocument,
    "registration form": enrollment.registrationFormDocument,
  };
  return required.filter((label) => !have.has(label.toLowerCase()) && !legacy[label.toLowerCase()]);
}

/** Whether a progress write would change anything (ignores when it was evaluated). */
export function progressChanged(before: Progress | undefined | null, after: Progress): boolean {
  if (!before) return true;
  const strip = (p: Progress) => JSON.stringify({ ...p, eligibility: { ...p.eligibility, evaluatedAt: "" } });
  return strip(before) !== strip(after);
}
