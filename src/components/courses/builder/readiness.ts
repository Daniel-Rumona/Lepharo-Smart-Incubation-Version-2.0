import {
  type Course,
  type Issue,
  type IssueCode,
  type Item,
  isAssessment,
  orderedItems,
  validateCourse,
} from "../courseStorage";

export type ItemStatus = "ready" | "review" | "todo" | "drafting";
export type ItemState = {
  status: ItemStatus;
  /** Short note for the outline row, e.g. "Needs marking criteria". */
  note: string;
  /** The issue the Next step bar should act on first. */
  primary?: Issue;
  issues: Issue[];
};

/** The order problems are worth fixing in: missing substance before details. */
const PRIORITY: IssueCode[] = [
  "title",
  "content",
  "objective",
  "questions",
  "rubric",
  "coach",
  "questionText",
  "options",
  "distinct",
  "answer",
  "confirmAnswer",
  "module",
  "minutes",
  "passMark",
  "attempts",
  "timeLimit",
  "turns",
];
const rank = (issue: Issue) => {
  const index = PRIORITY.indexOf(issue.code as IssueCode);
  return index < 0 ? PRIORITY.length : index;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function issueNote(item: Item, issue: Issue, issues: Issue[]): string {
  const count = (code: IssueCode) =>
    new Set(issues.filter((i) => i.code === code).map((i) => i.questionId)).size;
  switch (issue.code) {
    case "title":
      return "Needs a title";
    case "content":
      return item.kind === "lesson"
        ? "No content yet"
        : item.kind === "assignment"
        ? "No task brief yet"
        : item.kind === "interactive"
        ? "No coaching instructions yet"
        : "No instructions yet";
    case "objective":
      return "Needs a learning objective";
    case "questions":
      return "No questions yet";
    case "rubric":
      return "Needs marking criteria";
    case "coach":
      return "Needs reference content and a reflection prompt";
    case "confirmAnswer":
      return `${plural(count("confirmAnswer"), "AI answer")} to confirm`;
    case "questionText":
    case "options":
    case "distinct":
    case "answer": {
      const broken = new Set(
        issues
          .filter((i) => ["questionText", "options", "distinct", "answer"].includes(i.code || ""))
          .map((i) => i.questionId)
      ).size;
      return `${plural(broken, "question")} need${broken === 1 ? "s" : ""} attention`;
    }
    default:
      return "Check its settings";
  }
}

export function courseReadiness(course: Course, drafting: ReadonlySet<string>) {
  const issues = validateCourse(course);
  const states: Record<string, ItemState> = {};
  const items = orderedItems(course);
  for (const item of items) {
    const own = issues
      .filter((issue) => issue.itemId === item.id)
      .sort((a, b) => rank(a) - rank(b));
    const primary = own[0];
    states[item.id] = drafting.has(item.id)
      ? { status: "drafting", note: "AI is drafting…", issues: own }
      : primary
      ? { status: "todo", note: issueNote(item, primary, own), primary, issues: own }
      : item.aiDraft
      ? { status: "review", note: "AI draft · give it a read", issues: own }
      : { status: "ready", note: "", issues: own };
  }
  const courseIssues = issues.filter((issue) => !issue.itemId);
  const ready = items.filter((item) => states[item.id].status === "ready").length;
  const todo = items.filter((item) => states[item.id].status === "todo").length;
  return { issues, states, items, courseIssues, ready, todo };
}

export const isQuestionIssue = (issue?: Issue) =>
  !!issue?.questionId || issue?.code === "questions";

export const defaultTab = (item: Item, issue?: Issue) =>
  isAssessment(item)
    ? issue && ["content"].includes(issue.code || "")
      ? "instructions"
      : issue && ["passMark", "attempts", "timeLimit", "minutes", "module"].includes(issue.code || "")
      ? "settings"
      : "questions"
    : issue && ["minutes", "module", "turns"].includes(issue.code || "")
    ? "settings"
    : "content";
