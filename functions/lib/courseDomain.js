"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicCourse = exports.grade = exports.canOpenItem = exports.validateCourse = exports.orderedItems = exports.normalizeCourse = exports.showsFeedback = exports.isAssessment = void 0;
const isAssessment = (item) => item.kind === "quiz" || item.kind === "test";
exports.isAssessment = isAssessment;
/** Tests keep explanations private unless the author opts in, so retries cannot reuse them. */
const showsFeedback = (item) => item.showFeedback ?? item.kind === "quiz";
exports.showsFeedback = showsFeedback;
function normalizeCourse(course) {
    const modules = course.modules?.length
        ? course.modules
        : [{ id: "module-1", title: "Module 1" }];
    return {
        ...course,
        modules,
        sequential: course.sequential ?? true,
        accessCondition: course.accessCondition ?? "always",
        items: course.items.map((item) => ({
            ...item,
            moduleId: modules.some((m) => m.id === item.moduleId)
                ? item.moduleId
                : modules[0].id,
            questions: item.questions || [],
            attempts: item.attempts ?? (item.kind === "quiz" ? 3 : 1),
            scorePolicy: item.scorePolicy ?? "best",
            submissionType: item.submissionType ?? "either",
        })),
    };
}
exports.normalizeCourse = normalizeCourse;
function orderedItems(course) {
    const normalized = normalizeCourse(course);
    return normalized.modules.flatMap((module) => normalized.items.filter((item) => item.moduleId === module.id));
}
exports.orderedItems = orderedItems;
function validateCourse(course) {
    const issues = [];
    if (!course.title.trim() || course.title === "Untitled course")
        issues.push({
            code: "courseTitle",
            message: "Give the course a descriptive title.",
        });
    if (!course.description.trim())
        issues.push({ code: "description", message: "Add a course description." });
    if (!course.items.length)
        issues.push({ code: "noItems", message: "Add at least one learning item." });
    if (course.items.length && !course.items.some((i) => i.required))
        issues.push({
            code: "noRequired",
            message: "Require at least one learning item.",
        });
    for (const module of course.modules || []) {
        if (!module.title.trim())
            issues.push({
                code: "moduleTitle",
                moduleId: module.id,
                message: "Name every module.",
            });
        if (!course.items.some((i) => i.moduleId === module.id))
            issues.push({
                code: "emptyModule",
                moduleId: module.id,
                message: `Add an item to ${module.title}.`,
            });
    }
    for (const item of course.items) {
        const add = (code, message, questionId) => issues.push({
            itemId: item.id,
            questionId,
            code,
            message: `${item.title || "Untitled item"}: ${message}`,
        });
        if (!item.title.trim())
            add("title", "Add a title.");
        // Assessments check the objectives of the lessons before them.
        if (!(0, exports.isAssessment)(item) && !item.objective?.trim())
            add("objective", "Add a learning objective.");
        if (!item.content.trim())
            add("content", "Add content or instructions.");
        if (!course.modules?.some((module) => module.id === item.moduleId))
            add("module", "Choose a module.");
        if (!Number.isFinite(item.minutes) ||
            item.minutes < 1 ||
            item.minutes > 600)
            add("minutes", "Set an estimated duration between 1 and 600 minutes.");
        if (item.timeLimit !== undefined &&
            (!Number.isInteger(item.timeLimit) ||
                item.timeLimit < 0 ||
                item.timeLimit > 240))
            add("timeLimit", "Time limit must be between 0 and 240 minutes.");
        if (item.kind === "interactive" &&
            (!Number.isInteger(item.minTurns) ||
                item.minTurns < 1 ||
                item.minTurns > 20))
            add("turns", "Require between 1 and 20 coaching exchanges.");
        if ((0, exports.isAssessment)(item)) {
            if (!item.questions.length)
                add("questions", "Add at least one question.");
            if (!(item.passMark >= 1 && item.passMark <= 100))
                add("passMark", "Pass mark must be 1–100%.");
            if (!Number.isInteger(item.attempts) ||
                item.attempts < 1 ||
                item.attempts > 20)
                add("attempts", "Allow between 1 and 20 attempts.");
            for (const q of item.questions) {
                if (!q.text.trim())
                    add("questionText", "Write the question.", q.id);
                if (q.options.length < 2 || q.options.some((o) => !o.trim()))
                    add("options", "Fill in every answer option.", q.id);
                if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !==
                    q.options.length)
                    add("distinct", "Answer options must be distinct.", q.id);
                if (!Number.isInteger(q.answer) ||
                    q.answer < 0 ||
                    q.answer >= q.options.length)
                    add("answer", "Choose a correct answer.", q.id);
                else if (q.aiSuggested)
                    add("confirmAnswer", "Confirm the AI-suggested answer.", q.id);
            }
        }
        if (item.kind === "assignment" && !item.rubric?.trim())
            add("rubric", "Add marking criteria.");
        if (item.kind === "interactive" &&
            (!item.knowledge?.trim() || !item.reflectionPrompt?.trim()))
            add("coach", "Add approved reference content and a reflection prompt.");
    }
    return issues;
}
exports.validateCourse = validateCourse;
function canOpenItem(course, items, id) {
    const ordered = orderedItems(course);
    const index = ordered.findIndex((i) => i.id === id);
    return (index >= 0 &&
        (!course.sequential ||
            ordered
                .slice(0, index)
                .every((i) => !i.required || items[i.id]?.status === "completed")));
}
exports.canOpenItem = canOpenItem;
function grade(item, answers) {
    return Math.round((item.questions.filter((q) => answers[q.id] === q.answer).length /
        Math.max(1, item.questions.length)) *
        100);
}
exports.grade = grade;
function publicCourse(course) {
    return {
        ...course,
        items: course.items.map(({ aiDraft, ...item }) => ({
            ...item,
            knowledge: "",
            content: item.kind === "interactive" ? item.objective || "" : item.content,
            questions: item.questions.map(({ aiSuggested, ...q }) => ({
                ...q,
                answer: -1,
                feedback: "",
            })),
        })),
    };
}
exports.publicCourse = publicCourse;
//# sourceMappingURL=courseDomain.js.map