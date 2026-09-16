export type Material = {
  id: string;
  kind: "document" | "image" | "video" | "audio";
  name: string;
  url: string;
};
export type Kind = "lesson" | "assignment" | "quiz" | "test" | "interactive";
export type Question = {
  id: string;
  text: string;
  options: string[];
  answer: number;
  feedback?: string;
  materials?: Material[];
  /** The correct answer was suggested by AI and the author has not confirmed it yet. */
  aiSuggested?: boolean;
};
export type Module = { id: string; title: string };
export type Item = {
  id: string;
  moduleId?: string;
  kind: Kind;
  title: string;
  objective?: string;
  content: string;
  minutes: number;
  required: boolean;
  passMark: number;
  questions: Question[];
  welcome: string;
  materials?: Material[];
  submissionType?: "text" | "file" | "either";
  rubric?: string;
  attempts?: number;
  scorePolicy?: "best" | "latest";
  /** Show question explanations after an attempt. Defaults on for quizzes, off for tests. */
  showFeedback?: boolean;
  timeLimit?: number;
  knowledge?: string;
  minTurns?: number;
  reflectionPrompt?: string;
  /** Written by AI and not yet reviewed by the author. Does not block publishing. */
  aiDraft?: boolean;
};
/** When learners can open the course at all, independent of the item-by-item sequential rule. */
export type AccessCondition = "always" | "afterIntervention" | "afterAppointment";
export type Course = {
  title: string;
  description: string;
  level: string;
  /** Who the course is for; gives AI drafting its context. */
  audience?: string;
  items: Item[];
  modules?: Module[];
  sequential?: boolean;
  accessCondition?: AccessCondition;
};
/** Who a published version is visible to. Set at publish time, enforced by the catalog listing. */
export type PublishAudience = { mode: "all" | "selected"; participantIds: string[] };
export type SavedCourse = Course & {
  deletedAt?: string | null;
  localRecovery?: boolean;
  id: string;
  owner: string;
  updatedAt: string;
  revision?: number;
  publishedRevision?: number;
  publishTo?: PublishAudience;
};
export type IssueCode =
  | "courseTitle"
  | "description"
  | "noItems"
  | "noRequired"
  | "moduleTitle"
  | "emptyModule"
  | "title"
  | "objective"
  | "content"
  | "module"
  | "minutes"
  | "timeLimit"
  | "turns"
  | "questions"
  | "passMark"
  | "attempts"
  | "questionText"
  | "options"
  | "distinct"
  | "answer"
  | "confirmAnswer"
  | "rubric"
  | "coach";
export type Issue = {
  itemId?: string;
  questionId?: string;
  moduleId?: string;
  code?: IssueCode;
  message: string;
};
export type ItemProgress = {
  status?: "started" | "submitted" | "completed" | "changes-requested";
  attempts?: number;
  score?: number;
  startedAt?: number;
  attemptId?: string;
  answers?: Record<string, number>;
  text?: string;
  files?: Material[];
  feedback?: string;
  messages?: { role: "user" | "model"; text: string }[];
  reflection?: string;
};
export type Enrollment = {
  id: string;
  courseId: string;
  revision: number;
  owner: string;
  learnerId: string;
  learnerName?: string;
  items: Record<string, ItemProgress>;
  updatedAt: string;
};
export const isAssessment = (item: Item) =>
  item.kind === "quiz" || item.kind === "test";
/** Tests keep explanations private unless the author opts in, so retries cannot reuse them. */
export const showsFeedback = (item: Item) =>
  item.showFeedback ?? item.kind === "quiz";
export function normalizeCourse<T extends Course>(course: T): T {
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
export function orderedItems(course: Course): Item[] {
  const normalized = normalizeCourse(course);
  return normalized.modules!.flatMap((module) =>
    normalized.items.filter((item) => item.moduleId === module.id)
  );
}
export function validateCourse(course: Course): Issue[] {
  const issues: Issue[] = [];
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
    const add = (code: IssueCode, message: string, questionId?: string) =>
      issues.push({
        itemId: item.id,
        questionId,
        code,
        message: `${item.title || "Untitled item"}: ${message}`,
      });
    if (!item.title.trim()) add("title", "Add a title.");
    // Assessments check the objectives of the lessons before them.
    if (!isAssessment(item) && !item.objective?.trim())
      add("objective", "Add a learning objective.");
    if (!item.content.trim()) add("content", "Add content or instructions.");
    if (!course.modules?.some((module) => module.id === item.moduleId))
      add("module", "Choose a module.");
    if (
      !Number.isFinite(item.minutes) ||
      item.minutes < 1 ||
      item.minutes > 600
    )
      add("minutes", "Set an estimated duration between 1 and 600 minutes.");
    if (
      item.timeLimit !== undefined &&
      (!Number.isInteger(item.timeLimit) ||
        item.timeLimit < 0 ||
        item.timeLimit > 240)
    )
      add("timeLimit", "Time limit must be between 0 and 240 minutes.");
    if (
      item.kind === "interactive" &&
      (!Number.isInteger(item.minTurns) ||
        item.minTurns! < 1 ||
        item.minTurns! > 20)
    )
      add("turns", "Require between 1 and 20 coaching exchanges.");
    if (isAssessment(item)) {
      if (!item.questions.length) add("questions", "Add at least one question.");
      if (!(item.passMark >= 1 && item.passMark <= 100))
        add("passMark", "Pass mark must be 1–100%.");
      if (
        !Number.isInteger(item.attempts) ||
        item.attempts! < 1 ||
        item.attempts! > 20
      )
        add("attempts", "Allow between 1 and 20 attempts.");
      for (const q of item.questions) {
        if (!q.text.trim()) add("questionText", "Write the question.", q.id);
        if (q.options.length < 2 || q.options.some((o) => !o.trim()))
          add("options", "Fill in every answer option.", q.id);
        if (
          new Set(q.options.map((o) => o.trim().toLowerCase())).size !==
          q.options.length
        )
          add("distinct", "Answer options must be distinct.", q.id);
        if (
          !Number.isInteger(q.answer) ||
          q.answer < 0 ||
          q.answer >= q.options.length
        )
          add("answer", "Choose a correct answer.", q.id);
        else if (q.aiSuggested)
          add("confirmAnswer", "Confirm the AI-suggested answer.", q.id);
      }
    }
    if (item.kind === "assignment" && !item.rubric?.trim())
      add("rubric", "Add marking criteria.");
    if (
      item.kind === "interactive" &&
      (!item.knowledge?.trim() || !item.reflectionPrompt?.trim())
    )
      add("coach", "Add approved reference content and a reflection prompt.");
  }
  return issues;
}
export function canOpenItem(
  course: Course,
  items: Enrollment["items"],
  id: string
) {
  const ordered = orderedItems(course);
  const index = ordered.findIndex((i) => i.id === id);
  return (
    index >= 0 &&
    (!course.sequential ||
      ordered
        .slice(0, index)
        .every((i) => !i.required || items[i.id]?.status === "completed"))
  );
}
export function grade(item: Item, answers: Record<string, number>) {
  return Math.round(
    (item.questions.filter((q) => answers[q.id] === q.answer).length /
      Math.max(1, item.questions.length)) *
      100
  );
}
export function publicCourse(course: Course): Course {
  return {
    ...course,
    items: course.items.map(({ aiDraft, ...item }) => ({
      ...item,
      knowledge: "",
      content:
        item.kind === "interactive" ? item.objective || "" : item.content,
      questions: item.questions.map(({ aiSuggested, ...q }) => ({
        ...q,
        answer: -1,
        feedback: "",
      })),
    })),
  };
}
