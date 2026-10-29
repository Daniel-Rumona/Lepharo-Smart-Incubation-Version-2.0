"use strict";
/*
 * Training Academy certification: pure rules, no Firestore. trainingProgress.ts
 * gathers the facts for one SME and calls these; trainingProgressDomain.test.cjs
 * tests them directly. The client mirrors the types in
 * src/components/trainings/certification.ts (keep both in step).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressChanged = exports.missingCompanyDocuments = exports.DEFAULT_REQUIRED_DOCUMENTS = exports.evaluate = exports.effectiveCertification = exports.DEFAULT_CERTIFICATION = void 0;
exports.DEFAULT_CERTIFICATION = {
    enabled: false,
    awardTo: "attendee",
    templateId: null,
    rules: { minAttendancePercent: 80, requiredDocuments: true },
    signatories: [{ key: "academy_head", title: "Head of Training Academy", departmentRole: "training" }],
};
/** A training's own values over the global defaults, rule by rule. */
function effectiveCertification(defaults, training) {
    const base = {
        ...exports.DEFAULT_CERTIFICATION,
        ...(defaults || {}),
        rules: { ...exports.DEFAULT_CERTIFICATION.rules, ...(defaults?.rules || {}) },
    };
    const own = training || {};
    const pick = (key) => own[key] !== undefined ? own[key] : base[key];
    return {
        enabled: pick("enabled"),
        awardTo: pick("awardTo"),
        templateId: pick("templateId"),
        signatories: own.signatories?.length ? own.signatories : base.signatories,
        rules: { ...base.rules, ...(own.rules || {}) },
    };
}
exports.effectiveCertification = effectiveCertification;
const GENERAL = "General";
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
/** Attendance figures, each enabled rule as met or missing, and the resulting status. */
function evaluate(input) {
    const { rules, invitations } = input;
    const held = invitations.filter((i) => i.held);
    const attended = held.filter((i) => i.attended);
    const byCategory = {};
    held.forEach((i) => {
        const key = i.category || GENERAL;
        byCategory[key] = byCategory[key] || { held: 0, attended: 0 };
        byCategory[key].held += 1;
        if (i.attended)
            byCategory[key].attended += 1;
    });
    const percent = pct(attended.length, held.length);
    const met = [];
    const missing = [];
    const check = (ok, label) => (ok ? met : missing).push(label);
    if (typeof rules.minAttendancePercent === "number" && rules.minAttendancePercent > 0) {
        check(held.length > 0 && percent >= rules.minAttendancePercent, `Attend at least ${rules.minAttendancePercent}% of sessions (${held.length ? `${percent}% so far` : "none held yet"})`);
    }
    // A required session only applies to someone invited to it (e.g. not another category's session).
    (rules.requiredPlanSessionIds || []).forEach((group) => {
        const theirs = invitations.filter((i) => i.planGroup === group);
        if (!theirs.length)
            return;
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
    const courses = {};
    if (input.courses) {
        const required = new Set(rules.requiredCourseIds || []);
        input.courses.forEach((c) => {
            const score = c.scores.length ? Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length) : undefined;
            courses[c.courseId] = { required: c.required, completed: c.completed, ...(score === undefined ? {} : { score }) };
            if (required.has(c.courseId))
                check(c.required > 0 && c.completed >= c.required, `Complete the course ${c.title}`);
        });
        if (typeof rules.minAverageScore === "number" && rules.minAverageScore > 0) {
            const scores = input.courses.filter((c) => required.size === 0 || required.has(c.courseId)).flatMap((c) => c.scores);
            const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
            check(average !== null && average >= rules.minAverageScore, `Average assessment score of at least ${rules.minAverageScore}% (${average === null ? "no scores yet" : `${average}% so far`})`);
        }
    }
    if (rules.requiredDocuments) {
        check(input.documentsOk, input.documentsOk ? "Documents on file" : `Documents on file (missing: ${input.documentsMissing.join(", ") || "some"})`);
    }
    const started = attended.length > 0 || Object.values(courses).some((c) => c.completed > 0);
    const status = input.certificateId
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
exports.evaluate = evaluate;
/** Documents a training asks for when it lists none of its own (src/components/trainings/trainingStorage.ts). */
exports.DEFAULT_REQUIRED_DOCUMENTS = ["ID Copy", "Report / Qualification", "CV", "Registration Form"];
/** The company documents the training asks for that the enrollment doesn't have. */
function missingCompanyDocuments(enrollment, requiredDocuments) {
    const required = requiredDocuments?.length ? requiredDocuments : exports.DEFAULT_REQUIRED_DOCUMENTS;
    const have = new Set((enrollment.documents || []).map((d) => String(d?.label || "").toLowerCase()));
    // Older records kept fixed slots instead of a labelled list.
    const legacy = {
        "id copy": enrollment.idDocument,
        "report / qualification": enrollment.qualificationDocument,
        cv: enrollment.cvDocument,
        "registration form": enrollment.registrationFormDocument,
    };
    return required.filter((label) => !have.has(label.toLowerCase()) && !legacy[label.toLowerCase()]);
}
exports.missingCompanyDocuments = missingCompanyDocuments;
/** Whether a progress write would change anything (ignores when it was evaluated). */
function progressChanged(before, after) {
    if (!before)
        return true;
    const strip = (p) => JSON.stringify({ ...p, eligibility: { ...p.eligibility, evaluatedAt: "" } });
    return strip(before) !== strip(after);
}
exports.progressChanged = progressChanged;
//# sourceMappingURL=trainingProgressDomain.js.map