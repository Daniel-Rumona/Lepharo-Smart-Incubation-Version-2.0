import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Badge, Button, Empty, Grid, Input, Modal, Radio, Result, Segmented, Select, Spin, Switch, Tag } from "antd";
import { ArrowLeftOutlined, EyeOutlined, FileTextOutlined, PlusOutlined, RightOutlined, SettingOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
  type AssistAction,
  type CourseAiContext,
  type DraftedItem,
  type SuggestedItem,
  assistWriting,
  draftItem,
  suggestMissingItems,
} from "@/services/courseAiService";
import { isExtractableKind } from "@/services/courseContentExtractionService";
import ExtractContentModal from "../ExtractContentModal";
import {
  type Issue,
  type Item,
  type Kind,
  type PublishAudience,
  type SavedCourse,
  courseAction,
  isAssessment,
} from "../courseStorage";
import ItemEditor, { type EditorTab } from "./ItemEditor";
import NextStepBar, { type NextStep } from "./NextStepBar";
import OutlinePanel from "./OutlinePanel";
import PreviewOverlay from "./PreviewOverlay";
import { type GenerateOptions, sourceLessons } from "./QuestionsTab";
import { KindIcon, STANDARD_INSTRUCTIONS, kindOf, kinds, newItem, uid } from "./kinds";
import { AiMark, Crumbs, type Suggestion, TopBar } from "./parts";
import { courseReadiness, defaultTab, issueNote } from "./readiness";
import { saveLabel, isSaveConflict, useCourseDraft } from "./useCourseDraft";
import { ChoiceCards } from "@/components/queries/ChoiceCards";

/** One item the start flow asked AI to draft, with the outline's context for it. */
export type DraftJob = { itemId: string; summary?: string; notes?: string };

const COURSES = "/operations/training/courses";
const draftable = (kind: Kind) => kind !== "interactive";

const assistTitles: Record<AssistAction, string> = {
  simplify: "Simpler version",
  shorten: "Shorter version",
  example: "Version with a local example",
  objective: "Suggested learning objective",
  rubric: "Suggested marking criteria",
  instructions: "Suggested instructions",
  description: "Suggested course description",
};

function applyDraft(row: Item, result: DraftedItem): Item {
  if (isAssessment(row))
    return {
      ...row,
      content: row.content.trim() ? row.content : result.content || STANDARD_INSTRUCTIONS,
      questions: [
        ...row.questions,
        ...result.questions.map((q) => ({
          id: uid(),
          text: q.text,
          options: q.options,
          answer: q.answer,
          feedback: q.feedback,
          materials: [],
          aiSuggested: q.answer >= 0,
        })),
      ],
      aiDraft: true,
    };
  const hadContent = !!row.content.trim();
  return {
    ...row,
    objective: row.objective?.trim() ? row.objective : result.objective,
    content: hadContent ? row.content : result.content,
    minutes: !hadContent && row.kind === "lesson" && result.minutes ? result.minutes : row.minutes,
    rubric: row.rubric?.trim() ? row.rubric : result.rubric || row.rubric,
    submissionType: !hadContent && result.submissionType ? result.submissionType : row.submissionType,
    aiDraft: true,
  };
}

export default function CourseBuilder({ id }: { id: string }) {
  const { message, modal } = App.useApp();
  const { user } = useFullIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const draft = useCourseDraft(user?.uid || "", id);
  const { course, mutate } = draft;

  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<EditorTab>("content");
  const [questionId, setQuestionId] = useState<string>();
  const [drafting, setDrafting] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<{ done: number; total: number }>();
  const [suggestion, setSuggestion] = useState<Suggestion>();
  const [generating, setGenerating] = useState<string>();
  const [addTo, setAddTo] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addKind, setAddKind] = useState<Kind>("lesson");
  const [addHow, setAddHow] = useState<"blank" | "ai" | "doc">("blank");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [descriptionBusy, setDescriptionBusy] = useState(false);
  const [extractFor, setExtractFor] = useState<string>();
  const [preview, setPreview] = useState<{ itemId?: string }>();
  const [review, setReview] = useState<Issue[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [missing, setMissing] = useState<SuggestedItem[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [participants, setParticipants] = useState<{ id: string; name: string; email?: string }[]>([]);
  const [participantsError, setParticipantsError] = useState(false);
  /** An item created just to fill from a document: removed again if that's cancelled before anything is added. */
  const [extractNew, setExtractNew] = useState<string>();
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const participantsLoaded = useRef(false);
  const jobs = useRef(new Map<string, DraftJob>());
  const goal = useRef<string>((location.state as { goal?: string } | null)?.goal || "");
  const queueStarted = useRef(false);
  const stopQueue = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const readiness = course ? courseReadiness(course, drafting) : undefined;
  const item = course?.items.find((row) => row.id === selected);
  const modules = course?.modules || [];

  // The publish checklist: one row per item (or course part), not one per problem.
  const reviewGroups: { key: string; title: string; notes: string[]; first: Issue; item?: Item }[] = [];
  for (const issue of review || []) {
    const key = issue.itemId || (issue.code === "emptyModule" ? `module:${issue.moduleId}` : "course");
    let group = reviewGroups.find((g) => g.key === key);
    if (!group) {
      const row = issue.itemId ? course?.items.find((i) => i.id === issue.itemId) : undefined;
      const module = issue.moduleId ? modules.find((m) => m.id === issue.moduleId) : undefined;
      group = {
        key,
        item: row,
        first: (issue.itemId && readiness?.states[issue.itemId]?.primary) || issue,
        notes: [],
        title: row ? row.title || `Untitled ${kindOf(row.kind).label.toLowerCase()}` : module ? module.title : "Course details",
      };
      if (key === "course") reviewGroups.unshift(group);
      else reviewGroups.push(group);
    }
    const own = issue.itemId ? (review || []).filter((i) => i.itemId === issue.itemId) : [issue];
    const note = group.item ? issueNote(group.item, issue, own) : issue.message.replace(/\.$/, "");
    if (!group.notes.includes(note)) group.notes.push(note);
  }

  useEffect(() => {
    if (course && (!selected || !course.items.some((row) => row.id === selected)) && course.items.length) {
      const first = readiness!.items.find((row) => readiness!.states[row.id].status === "todo") || readiness!.items[0];
      setSelected(first.id);
      setTab(defaultTab(first, readiness!.states[first.id].primary));
    }
  }, [course?.items.length, selected]);

  useEffect(() => {
    if (review === null || participantsLoaded.current) return;
    participantsLoaded.current = true;
    setParticipantsLoading(true);
    getDocs(collection(db, "participants"))
      .then((snap) =>
        setParticipants(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return { id: d.id, name: String(data.beneficiaryName || data.name || d.id), email: data.email as string | undefined };
          })
        )
      )
      .catch(() => {
        participantsLoaded.current = false;
        setParticipantsError(true);
      })
      .finally(() => setParticipantsLoading(false));
  }, [review]);

  const context = (current: SavedCourse): CourseAiContext => ({
    title: current.title,
    description: current.description,
    audience: current.audience,
    level: current.level,
    goal: goal.current,
  });

  const updateItem = useCallback(
    (itemId: string, change: (row: Item) => Item) =>
      mutate((current) => ({ ...current, items: current.items.map((row) => (row.id === itemId ? change(row) : row)) })),
    [mutate]
  );

  const select = (itemId: string, nextTab?: EditorTab, nextQuestion?: string) => {
    const row = draft.latest.current?.items.find((i) => i.id === itemId);
    setSelected(itemId);
    setTab(nextTab || (row ? defaultTab(row, readiness?.states[itemId]?.primary) : "content"));
    setQuestionId(nextQuestion);
    if (!screens.lg) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    if (nextQuestion) setTimeout(() => document.getElementById(`question-${nextQuestion}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  };

  const lessonsFor = (current: SavedCourse, row: Item, lessonIds?: string[]) => {
    const ids = lessonIds || sourceLessons(current, row).defaults;
    return current.items
      .filter((lesson) => ids.includes(lesson.id) && lesson.content.trim())
      .map((lesson) => ({ title: lesson.title, content: lesson.content }));
  };

  async function runDraft(itemId: string, fallback?: Item): Promise<boolean> {
    const current = draft.latest.current;
    const row = current?.items.find((i) => i.id === itemId) || fallback;
    if (!current || !row || !draftable(row.kind)) return false;
    if (!row.title.trim() || /^New (lesson|assignment|quiz|test)$/i.test(row.title)) {
      message.info("Give the item a descriptive title first so AI knows what to write.");
      select(itemId, isAssessment(row) ? "questions" : "content");
      document.getElementById(`item-title-${itemId}`)?.focus();
      return false;
    }
    const lessons = isAssessment(row) ? lessonsFor(current, row) : undefined;
    if (isAssessment(row) && !lessons?.length) {
      message.info(`Add content to a lesson first — “${row.title}” is written from your lessons.`);
      return false;
    }
    setDrafting((set) => new Set(set).add(itemId));
    try {
      const job = jobs.current.get(itemId);
      const result = await draftItem({
        kind: row.kind as "lesson" | "assignment" | "quiz" | "test",
        title: row.title,
        summary: job?.summary,
        notes: job?.notes,
        moduleTitle: current.modules?.find((m) => m.id === row.moduleId)?.title,
        minutes: row.minutes,
        course: context(current),
        lessons,
        questionCount: row.kind === "test" ? 10 : 5,
        style: "scenario",
      });
      updateItem(itemId, (latest) => applyDraft(latest, result));
      result.warnings.forEach((warning) => message.warning(warning));
      return true;
    } catch (reason) {
      message.error(`“${row.title}”: ${reason instanceof Error ? reason.message : "could not be drafted."}`);
      return false;
    } finally {
      setDrafting((set) => {
        const next = new Set(set);
        next.delete(itemId);
        return next;
      });
    }
  }

  // Draft the content the start flow asked for, lessons before assessments, two at a time.
  useEffect(() => {
    const state = location.state as { draftQueue?: DraftJob[]; goal?: string } | null;
    if (!course || queueStarted.current || !state?.draftQueue?.length) return;
    queueStarted.current = true;
    const list = state.draftQueue.filter((job) => course.items.some((row) => row.id === job.itemId));
    list.forEach((job) => jobs.current.set(job.itemId, job));
    navigate(location.pathname, { replace: true, state: { goal: state.goal } });
    const kindOfJob = (job: DraftJob) => course.items.find((row) => row.id === job.itemId)!.kind;
    const phases = [
      list.filter((job) => !isAssessment({ kind: kindOfJob(job) } as Item)),
      list.filter((job) => isAssessment({ kind: kindOfJob(job) } as Item)),
    ];
    let done = 0;
    setQueue({ done, total: list.length });
    void (async () => {
      for (const phase of phases) {
        const pending = [...phase];
        const worker = async () => {
          while (pending.length && !stopQueue.current) {
            const job = pending.shift()!;
            await runDraft(job.itemId);
            setQueue({ done: ++done, total: list.length });
          }
        };
        await Promise.all([worker(), worker()]);
        // Let the drafted lessons land in state before quizzes read them.
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      setQueue(undefined);
      if (!stopQueue.current) message.success("First drafts are ready. Follow Next step to review them.");
    })();
  }, [course]);

  function assist(itemId: string, action: AssistAction) {
    const current = draft.latest.current;
    const row = current?.items.find((i) => i.id === itemId);
    if (!current || !row) return;
    const field: Suggestion["field"] = action === "objective" ? "objective" : action === "rubric" ? "rubric" : "content";
    const title = assistTitles[action];
    const request = async () => {
      setSuggestion({ itemId, field, title, loading: true, retry: request, base: String((row as any)[field] || "") });
      try {
        const text = await assistWriting({ action, text: row.content, title: row.title, kind: row.kind, course: context(current) });
        setSuggestion((s) => (s && s.itemId === itemId && s.title === title ? { ...s, loading: false, text } : s));
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : "No suggestion could be written.";
        setSuggestion((s) => (s && s.itemId === itemId && s.title === title ? { ...s, loading: false, error } : s));
      }
    };
    void request();
  }

  async function generate(itemId: string, options: GenerateOptions) {
    const current = draft.latest.current;
    const row = current?.items.find((i) => i.id === itemId);
    if (!current || !row) return;
    const lessons = lessonsFor(current, row, options.lessonIds);
    if (!lessons.length) {
      message.info("Choose at least one lesson that has content.");
      return;
    }
    setGenerating(itemId);
    try {
      const result = await draftItem({
        kind: row.kind as "quiz" | "test",
        title: row.title,
        moduleTitle: current.modules?.find((m) => m.id === row.moduleId)?.title,
        course: context(current),
        lessons,
        questionCount: options.count,
        style: options.style,
      });
      updateItem(itemId, (latest) => ({
        ...applyDraft(latest, result),
        aiDraft: latest.aiDraft,
      }));
      setTab("questions");
      setQuestionId(undefined);
      message.success(`${result.questions.length} questions added. Confirm each suggested answer.`);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "Questions could not be written.");
    } finally {
      setGenerating(undefined);
    }
  }

  function addItem(kind: Kind, mode: "blank" | "ai" | "doc") {
    const current = draft.latest.current;
    if (!current) return;
    const moduleId = addTo || item?.moduleId || current.modules?.[0]?.id || "module-1";
    const row = newItem(kind, moduleId, addTitle.trim() || undefined);
    mutate((c) => ({ ...c, items: [...c.items, row] }));
    setAddTo(null);
    setAddTitle("");
    setSelected(row.id);
    setTab(isAssessment(row) ? "questions" : "content");
    setQuestionId(undefined);
    if (mode === "doc") {
      setExtractFor(row.id);
      setExtractNew(row.id);
    }
    if (mode === "ai") {
      if (isAssessment(row)) {
        const { defaults } = sourceLessons({ ...current, items: [...current.items, row] }, row);
        setTimeout(() => void generate(row.id, { lessonIds: defaults, count: kind === "test" ? 10 : 5, style: "scenario" }), 0);
      } else setTimeout(() => void runDraft(row.id, row), 0);
    }
  }

  async function findMissing() {
    const current = draft.latest.current;
    if (!current) return;
    setSuggesting(true);
    try {
      const list = await suggestMissingItems({
        course: context(current),
        modules: (current.modules || []).map((m) => ({
          title: m.title,
          items: current.items.filter((row) => row.moduleId === m.id).map((row) => ({ kind: row.kind, title: row.title })),
        })),
      });
      setMissing(list);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "The outline could not be reviewed.");
    } finally {
      setSuggesting(false);
    }
  }

  /** Blocks publishing that the issue list doesn't cover: unread AI drafts, and an empty chosen audience. */
  const publishBlockers = (current: typeof course) => {
    if (!current || !readiness) return [] as string[];
    const unread = readiness.items.filter((row) => readiness.states[row.id].status === "review");
    return [
      unread.length ? `${unread.length} AI draft${unread.length === 1 ? "" : "s"} still to read and mark as reviewed` : null,
      current.publishTo?.mode === "selected" && !(current.publishTo.participantIds || []).length ? "Choose at least one participant, or publish to all incubatees" : null,
    ].filter(Boolean) as string[];
  };

  async function publish() {
    const blockers = publishBlockers(course);
    if (blockers.length) {
      message.warning(`${blockers[0]}.`);
      return;
    }
    setPublishing(true);
    try {
      const saved = await draft.save();
      if (!saved) {
        message.error("Save the course before publishing.");
        return;
      }
      const result = await courseAction("publish", { courseId: saved.id, updatedAt: saved.updatedAt });
      draft.adopt((current) => ({ ...current, publishedRevision: result.revision }));
      setReview(null);
      message.success(`Published version ${result.revision}. New learners get this version.`);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "The course could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  const leave = () =>
    drafting.size
      ? modal.confirm({
          title: "AI is still drafting",
          content: `${drafting.size} item${drafting.size === 1 ? " is" : "s are"} still being drafted. Leaving stops that; what's finished is kept.`,
          okText: "Leave",
          cancelText: "Stay",
          onOk: async () => {
            await draft.save();
            navigate(COURSES);
          },
        })
      : draft.dirty
      ? modal.confirm({
          title: "Leave before your changes sync?",
          content: "They'll be kept on this device as a recovery copy.",
          okText: "Leave",
          cancelText: "Stay",
          onOk: async () => {
            await draft.keepLocalCopy();
            navigate(COURSES);
          },
        })
      : navigate(COURSES);

  if (draft.loading || !course)
    return (
      <div className="cb-page cb-center">
        {draft.loadError ? (
          <Result status="warning" title="This course can't be opened" subTitle={draft.loadError} extra={<Button shape="round" onClick={() => navigate(COURSES)}>Back to courses</Button>} />
        ) : (
          <Spin tip="Loading course…">
            <div style={{ width: 200, height: 80 }} />
          </Spin>
        )}
      </div>
    );

  if (course.deletedAt)
    return (
      <div className="cb-page cb-center">
        <Result
          status="info"
          title="This course is in the deleted list"
          subTitle="Restore it from the course repository to keep editing."
          extra={<Button type="primary" shape="round" onClick={() => navigate(COURSES)}>Back to courses</Button>}
        />
      </div>
    );

  const { items, states, issues } = readiness!;
  const q = (row: Item) => `“${row.title || "Untitled item"}”`;

  const nextStep = ((): NextStep => {
    if (queue)
      return {
        title: `AI is drafting your course — ${queue.done} of ${queue.total} items done. You can keep working meanwhile.`,
        secondary: { label: "Stop drafting", run: () => (stopQueue.current = true) },
      };
    const todo = items.find((row) => states[row.id].status === "todo");
    if (todo) {
      const issue = states[todo.id].primary!;
      const open = (nextTab?: EditorTab, nextQuestion?: string) => select(todo.id, nextTab, nextQuestion);
      const draftStep = (title: string): NextStep => ({
        title,
        label: "Draft with AI",
        ai: true,
        busy: drafting.has(todo.id),
        run: () => {
          open(isAssessment(todo) ? "questions" : "content");
          void runDraft(todo.id);
        },
        secondary: { label: "Write it myself", run: () => open("content") },
      });
      switch (issue.code) {
        case "content":
          if (isAssessment(todo))
            return {
              title: `${q(todo)} has no instructions for learners`,
              label: "Use standard instructions",
              run: () => updateItem(todo.id, (row) => ({ ...row, content: STANDARD_INSTRUCTIONS })),
              secondary: { label: "Write my own", run: () => open("settings") },
            };
          if (todo.kind === "interactive")
            return { title: `${q(todo)} has no coaching instructions yet`, label: "Open it", run: () => open("content") };
          return draftStep(`${q(todo)} ${todo.kind === "assignment" ? "has no task brief yet" : "has no content yet"}`);
        case "objective":
          return todo.content.trim()
            ? {
                title: `${q(todo)} needs a learning objective`,
                label: "Suggest one",
                ai: true,
                busy: suggestion?.itemId === todo.id && suggestion.loading,
                run: () => {
                  open("content");
                  assist(todo.id, "objective");
                },
              }
            : draftStep(`${q(todo)} has no content yet`);
        case "questions":
          return {
            title: `${q(todo)} has no questions yet`,
            label: "Generate from lessons",
            ai: true,
            busy: generating === todo.id,
            run: () => {
              open("questions");
              const { defaults } = sourceLessons(course, todo);
              if (!defaults.length) message.info("Add content to a lesson first, or use a document.");
              else void generate(todo.id, { lessonIds: defaults, count: todo.kind === "test" ? 10 : 5, style: "scenario" });
            },
            secondary: { label: "Open it", run: () => open("questions") },
          };
        case "rubric":
          return todo.content.trim()
            ? {
                title: `${q(todo)} has no marking criteria`,
                label: "Suggest from the brief",
                ai: true,
                busy: suggestion?.itemId === todo.id && suggestion.loading,
                run: () => {
                  open("content");
                  assist(todo.id, "rubric");
                },
              }
            : draftStep(`${q(todo)} has no task brief yet`);
        case "confirmAnswer":
          return {
            title: `${q(todo)} has ${states[todo.id].note}`,
            label: "Review answers",
            run: () => open("questions"),
          };
        case "questionText":
        case "options":
        case "distinct":
        case "answer":
          return { title: `A question in ${q(todo)} needs attention`, label: "Go to question", run: () => open("questions", issue.questionId) };
        case "coach":
          return { title: `${q(todo)} needs reference content and a reflection prompt`, label: "Open it", run: () => open("content") };
        case "title":
          return {
            title: "An item needs a title",
            label: "Open it",
            run: () => {
              open();
              setTimeout(() => document.getElementById(`item-title-${todo.id}`)?.focus(), 60);
            },
          };
        default:
          return { title: `Check the settings of ${q(todo)}`, label: "Open settings", run: () => open("settings") };
      }
    }
    const courseIssue = readiness!.courseIssues[0];
    if (courseIssue) {
      if (courseIssue.code === "noItems") return { title: "Add the first learning item", label: "Add item", run: () => setAddTo("") };
      if (courseIssue.code === "emptyModule") {
        const module = modules.find((m) => m.id === courseIssue.moduleId);
        return { title: `“${module?.title || "A module"}” has no items yet`, label: "Add item", run: () => setAddTo(courseIssue.moduleId || "") };
      }
      if (courseIssue.code === "moduleTitle")
        return { title: "A module needs a name", label: "Name it", run: () => document.getElementById(`module-title-${courseIssue.moduleId}`)?.focus() };
      if (courseIssue.code === "noRequired")
        return { title: "Mark at least one item as required", label: "Open settings", run: () => items[0] && select(items[0].id, "settings") };
      return {
        title: courseIssue.code === "description" ? "Add a short course description for learners" : "Give the course a descriptive title",
        label: "Open course settings",
        run: () => setSettingsOpen(true),
      };
    }
    const toReview = items.find((row) => states[row.id].status === "review");
    if (toReview)
      return {
        title: `${q(toReview)} is an AI draft — give it a read, then mark it as reviewed`,
        label: "Read it",
        run: () => select(toReview.id),
      };
    return {
      title: "Everything is ready. Preview it as a learner if you like, then publish.",
      label: `Publish version ${(course.publishedRevision || 0) + 1}`,
      run: () => setReview([]),
    };
  })();

  const extractItem = course.items.find((row) => row.id === extractFor);

  return (
    <div className="cb-page">
      <TopBar>
        <Button type="text" shape="round" icon={<ArrowLeftOutlined />} aria-label="Back to courses" onClick={leave} />
        <Crumbs
          trail={["Courses"]}
          current={
            <button type="button" className="cb-title-button" onClick={() => setSettingsOpen(true)} title="Course settings">
              {course.title}
            </button>
          }
          meta={
            <>
              {draft.saveState === "failed" && isSaveConflict(draft.error) ? (
                <button type="button" className="cb-link-button is-error" onClick={() => void draft.reloadSaved()}>
                  Changed elsewhere — load it
                </button>
              ) : draft.saveState === "failed" ? (
                <button type="button" className="cb-link-button is-error" onClick={() => void draft.save()}>
                  Not synced — retry
                </button>
              ) : (
                <span className="cb-hide-sm">{saveLabel[draft.saveState]}</span>
              )}
              {!!course.publishedRevision && <Tag className="cb-hide-sm">v{course.publishedRevision} live</Tag>}
            </>
          }
        />
        <Button shape="round" icon={<EyeOutlined />} onClick={() => setPreview({ itemId: selected })}>
          <span className="cb-hide-xs">Preview</span>
        </Button>
        <Badge count={issues.length} size="small" offset={[-4, 2]}>
          <Button type="primary" shape="round" onClick={() => setReview(issues)}>
            Publish
          </Button>
        </Badge>
      </TopBar>

      <div className="cb-builder-wrap">
        {draft.error && (
          <Alert
            type="error"
            showIcon
            closable
            className="cb-mb"
            message={isSaveConflict(draft.error) ? "This course was changed in another tab or on another device." : draft.error}
            description={isSaveConflict(draft.error) ? "Load the saved version to carry on. What you had here is kept as a recovery copy on this device." : undefined}
            action={isSaveConflict(draft.error) ? (
              <Button size="small" type="primary" shape="round" onClick={() => void draft.reloadSaved()}>
                Load the saved version
              </Button>
            ) : undefined}
            onClose={() => draft.setError("")}
          />
        )}
        {draft.recovery && (
          <Alert
            type="warning"
            showIcon
            className="cb-mb"
            message="This device has a newer unsynced copy of this course."
            action={
              <span className="cb-inline-actions">
                <Button size="small" shape="round" onClick={draft.restoreRecovery}>
                  Use that copy
                </Button>
                <Button size="small" type="text" shape="round" onClick={draft.dismissRecovery}>
                  Keep this one
                </Button>
              </span>
            }
          />
        )}

        <NextStepBar step={nextStep} ready={readiness!.ready} total={items.length} />

        <div className="cb-builder">
          <OutlinePanel
            course={course}
            states={states}
            selected={selected}
            suggesting={suggesting}
            onSelect={(itemId) => select(itemId)}
            onRenameModule={(moduleId, title) => mutate((c) => ({ ...c, modules: (c.modules || []).map((m) => (m.id === moduleId ? { ...m, title } : m)) }))}
            onMoveModule={(index, direction) =>
              mutate((c) => {
                const rows = [...(c.modules || [])];
                if (!rows[index + direction]) return c;
                [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]];
                return { ...c, modules: rows };
              })
            }
            onRemoveModule={(moduleId) =>
              modal.confirm({
                title: "Remove this module?",
                content: "Its items move to the first remaining module.",
                okText: "Remove",
                okButtonProps: { danger: true },
                onOk: () =>
                  mutate((c) => {
                    const rest = (c.modules || []).filter((m) => m.id !== moduleId);
                    return { ...c, modules: rest, items: c.items.map((row) => (row.moduleId === moduleId ? { ...row, moduleId: rest[0].id } : row)) };
                  }),
              })
            }
            onMoveItem={(row, direction) =>
              mutate((c) => {
                const siblings = c.items.filter((i) => i.moduleId === row.moduleId);
                const target = siblings[siblings.findIndex((i) => i.id === row.id) + direction];
                if (!target) return c;
                const next = [...c.items];
                const a = next.findIndex((i) => i.id === row.id), b = next.findIndex((i) => i.id === target.id);
                [next[a], next[b]] = [next[b], next[a]];
                return { ...c, items: next };
              })
            }
            onAddItem={(moduleId) => setAddTo(moduleId || "")}
            onAddModule={() => mutate((c) => ({ ...c, modules: [...(c.modules || []), { id: uid(), title: `Module ${(c.modules || []).length + 1}` }] }))}
            onSuggest={() => void findMissing()}
          />
          <div ref={editorRef} className="cb-editor-col">
            {item ? (
              <ItemEditor
                course={course}
                item={item}
                state={states[item.id]}
                tab={tab}
                onTab={setTab}
                update={(change) => updateItem(item.id, change)}
                suggestion={suggestion}
                onAssist={(action) => assist(item.id, action)}
                onAcceptSuggestion={(text) => {
                  if (!suggestion) return;
                  const now = String((draft.latest.current?.items.find((i) => i.id === suggestion.itemId) as any)?.[suggestion.field] || "");
                  // The text changed while the suggestion was being written: ask before replacing it.
                  if (suggestion.base !== undefined && now !== suggestion.base) {
                    modal.confirm({
                      centered: true,
                      title: "Replace your newer edits?",
                      content: "You changed this text while the suggestion was being written. Accepting replaces those changes.",
                      okText: "Replace them",
                      cancelText: "Keep my edits",
                      onOk: () => updateItem(suggestion.itemId, (row) => ({ ...row, [suggestion.field]: text })),
                    });
                    return;
                  }
                  updateItem(suggestion.itemId, (row) => ({ ...row, [suggestion.field]: text }));
                  setSuggestion(undefined);
                  message.success("Suggestion applied.");
                }}
                onDiscardSuggestion={() => setSuggestion(undefined)}
                drafting={drafting.has(item.id)}
                onDraft={() => void runDraft(item.id)}
                generating={generating === item.id}
                onGenerate={(options) => void generate(item.id, options)}
                questionId={questionId}
                onQuestion={setQuestionId}
                onMarkReviewed={() => updateItem(item.id, (row) => ({ ...row, aiDraft: false }))}
                onExtract={() => setExtractFor(item.id)}
                onDuplicate={() => {
                  const copy = { ...item, id: uid(), title: `${item.title} (copy)`, questions: item.questions.map((row) => ({ ...row, id: uid() })) };
                  mutate((c) => {
                    const next = [...c.items];
                    next.splice(next.findIndex((row) => row.id === item.id) + 1, 0, copy);
                    return { ...c, items: next };
                  });
                  setSelected(copy.id);
                }}
                onDelete={() =>
                  modal.confirm({
                    title: `Delete “${item.title || "this item"}”?`,
                    okText: "Delete",
                    okButtonProps: { danger: true },
                    onOk: () => {
                      mutate((c) => ({ ...c, items: c.items.filter((row) => row.id !== item.id) }));
                      setSelected(undefined);
                    },
                  })
                }
              />
            ) : (
              <div className="cb-panel cb-editor-empty">
                <Empty description="Add your first learning item with Add item in the outline." />
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        className="academy-modal"
        title="Add a learning item"
        open={addTo !== null}
        onCancel={() => setAddTo(null)}
        footer={null}
        destroyOnClose
      >
        <div className="cb-add">
          {addTo && <span className="cb-muted">Adding to {modules.find((m) => m.id === addTo)?.title}</span>}
          <div className="cb-field">
            <span className="cb-label">What kind of item?</span>
            <ChoiceCards
              compact
              columns={2}
              label="What kind of item?"
              value={addKind}
              onChange={(next: string) => {
                setAddKind(next as Kind);
                if (!draftable(next as Kind) || (addHow === "doc" && !isExtractableKind(next as Kind))) setAddHow("blank");
              }}
              options={kinds.map((kind) => ({ value: kind.kind, label: kind.label, detail: kind.description, icon: <KindIcon kind={kind.kind} /> }))}
            />
          </div>
          <div className="cb-field">
            <label htmlFor="add-item-title">
              Title <span className="cb-hint">{addHow === "ai" && !isAssessment({ kind: addKind } as Item) ? "AI writes from it" : "Optional — you can rename it later"}</span>
            </label>
            <Input id="add-item-title" value={addTitle} placeholder="e.g. Getting paid on time" onChange={(e) => setAddTitle(e.target.value)} />
          </div>
          {draftable(addKind) && (
            <div className="cb-field">
              <span className="cb-label">How do you want to start it?</span>
              <ChoiceCards
                compact
                columns={isExtractableKind(addKind) ? 3 : 2}
                label="How do you want to start it?"
                value={addHow}
                onChange={(next: string) => setAddHow(next as "blank" | "ai" | "doc")}
                options={[
                  { value: "blank", label: "Blank", detail: "Write it yourself", icon: <PlusOutlined /> },
                  { value: "ai", label: isAssessment({ kind: addKind } as Item) ? "From lessons" : "Draft with AI", detail: isAssessment({ kind: addKind } as Item) ? "Questions from this module's lessons" : "AI writes a first draft", icon: <AiMark /> },
                  ...(isExtractableKind(addKind) ? [{ value: "doc", label: "From a document", detail: "Upload a file to use", icon: <FileTextOutlined /> }] : []),
                ]}
              />
            </div>
          )}
          <Button
            block
            type="primary"
            shape="round"
            disabled={addHow === "ai" && !isAssessment({ kind: addKind } as Item) && !addTitle.trim()}
            title={addHow === "ai" && !isAssessment({ kind: addKind } as Item) && !addTitle.trim() ? "Add a title first" : undefined}
            onClick={() => addItem(addKind, draftable(addKind) ? addHow : "blank")}
          >
            Add {kindOf(addKind).label.toLowerCase()}
          </Button>
        </div>
      </Modal>

      <Modal
        className="academy-modal"
        title="Course settings"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={
          <Button block type="primary" shape="round" onClick={() => setSettingsOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="cb-settings-modal">
          <div className="cb-field">
            <label htmlFor="course-title">Course title</label>
            <Input id="course-title" value={course.title} onChange={(e) => mutate((c) => ({ ...c, title: e.target.value }))} />
          </div>
          <div className="cb-field">
            <label htmlFor="course-description">
              Description <span className="cb-hint">Shown to learners in the catalogue</span>
            </label>
            <Input.TextArea
              id="course-description"
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={course.description}
              onChange={(e) => mutate((c) => ({ ...c, description: e.target.value }))}
            />
            <Button
              size="small"
              shape="round"
              className="cb-btn-ai cb-self-start"
              icon={<AiMark />}
              loading={descriptionBusy}
              disabled={!course.items.length}
              onClick={async () => {
                setDescriptionBusy(true);
                try {
                  const outline = (course.modules || [])
                    .map((m) => `${m.title}: ${course.items.filter((row) => row.moduleId === m.id).map((row) => row.title).join("; ")}`)
                    .join("\n");
                  const text = await assistWriting({ action: "description", text: outline, title: course.title, kind: "course", course: context(course) });
                  mutate((c) => ({ ...c, description: text }));
                } catch (reason) {
                  message.error(reason instanceof Error ? reason.message : "No description could be written.");
                } finally {
                  setDescriptionBusy(false);
                }
              }}
            >
              {course.description.trim() ? "Rewrite with AI" : "Suggest from the outline"}
            </Button>
          </div>
          <div className="cb-two">
            <div className="cb-field">
              <label htmlFor="course-audience">Who is it for?</label>
              <Input id="course-audience" value={course.audience} placeholder="e.g. Early-stage SME owners" onChange={(e) => mutate((c) => ({ ...c, audience: e.target.value }))} />
            </div>
            <div className="cb-field">
              <span className="cb-label">Level</span>
              <Segmented
                block
                aria-label="Level"
                value={course.level}
                onChange={(level: string | number) => mutate((c) => ({ ...c, level: String(level) }))}
                options={["Beginner", "Intermediate", "Advanced"]}
              />
            </div>
          </div>
          <div className="cb-switch-row">
            <div>
              <strong>Learners follow the order</strong>
              <small>Required items must be completed before the next one opens.</small>
            </div>
            <Switch aria-label="Learners follow the order" checked={course.sequential} onChange={(sequential) => mutate((c) => ({ ...c, sequential }))} />
          </div>
        </div>
      </Modal>

      <Modal
        className="academy-modal"
        title={
          reviewGroups.length
            ? `${reviewGroups.length} ${reviewGroups.length === 1 ? "part needs" : "parts need"} attention before publishing`
            : "Ready to publish"
        }
        open={review !== null}
        onCancel={() => setReview(null)}
        footer={
          <div className="course-footer">
            <Button block type="primary" shape="round" loading={publishing} disabled={!!review?.length || publishBlockers(course).length > 0 || draft.saveState === "saving"} onClick={() => void publish()}>
              Publish version {(course.publishedRevision || 0) + 1}
            </Button>
          </div>
        }
      >
        {review?.length ? (
          <div className="cb-issues">
            <span className="cb-muted">Open each one to fix it. Publishing unlocks when the list is empty.</span>
            {reviewGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                className="cb-issue"
                onClick={() => {
                  const issue = group.first;
                  setReview(null);
                  if (group.item) select(group.item.id, issue.questionId ? "questions" : defaultTab(group.item, issue), issue.questionId);
                  else if (issue.code === "emptyModule") setAddTo(issue.moduleId || "");
                  else setSettingsOpen(true);
                }}
              >
                {group.item ? (
                  <KindIcon kind={group.item.kind} />
                ) : (
                  <span className="cb-kind cb-kind-course" aria-hidden="true">
                    <SettingOutlined />
                  </span>
                )}
                <span className="cb-issue-body">
                  <strong>{group.title}</strong>
                  <small>{group.notes.join(" · ")}</small>
                </span>
                <span className="cb-issue-go">
                  Fix <RightOutlined />
                </span>
              </button>
            ))}
          </div>
        ) : publishBlockers(course).length ? (
          <Alert type="warning" showIcon message="Almost ready" description={publishBlockers(course).map((b) => <div key={b}>{b}.</div>)} />
        ) : (
          <Alert
            type="success"
            showIcon
            message="The course is ready."
            description="Publishing creates a fixed version for new learners. You can keep editing the draft afterwards."
          />
        )}
        <div className="cb-field cb-publish-audience">
          <span className="cb-label">Publish to</span>
          <Radio.Group
            className="cb-radio-stack"
            value={course.publishTo?.mode || "all"}
            onChange={(e) =>
              mutate((c) => ({
                ...c,
                publishTo: { mode: e.target.value as PublishAudience["mode"], participantIds: c.publishTo?.participantIds || [] },
              }))
            }
          >
            <Radio value="all">All incubatees</Radio>
            <Radio value="selected">Select participants</Radio>
          </Radio.Group>
          {course.publishTo?.mode === "selected" && (
            <Select
              mode="multiple"
              allowClear
              showSearch
              loading={participantsLoading}
              placeholder="Choose who this version is for"
              optionFilterProp="label"
              value={course.publishTo?.participantIds || []}
              onChange={(participantIds) => mutate((c) => ({ ...c, publishTo: { mode: "selected", participantIds } }))}
              options={participants.map((p) => ({ value: p.id, label: p.email ? `${p.name} (${p.email})` : p.name }))}
              status={participantsError ? "error" : undefined}
            />
          )}
          {course.publishTo?.mode === "selected" && participantsError && (
            <small className="cb-error-text">The participant list couldn't be loaded. Close and reopen this to try again.</small>
          )}
          <small className="cb-muted">Training SMEs get this course when it is linked to their training under Training → Trainings.</small>
        </div>
      </Modal>

      <Modal
        className="academy-modal"
        title={
          <span className="cb-label">
            <AiMark /> Suggested additions
          </span>
        }
        open={missing !== null}
        onCancel={() => setMissing(null)}
        footer={null}
      >
        {missing?.length ? (
          <div className="cb-add">
            {missing.map((s, n) => (
              <div key={n} className="cb-add-row">
                <div className="cb-add-main is-static">
                  <KindIcon kind={s.kind} />
                  <span className="cb-choice-text">
                    <strong>{s.title}</strong>
                    <span>
                      {modules[s.moduleIndex]?.title} · {s.minutes} min{s.reason ? ` · ${s.reason}` : ""}
                    </span>
                  </span>
                </div>
                <div className="cb-add-ai">
                  <Button
                    size="small"
                    shape="round"
                    onClick={() => {
                      const moduleId = modules[s.moduleIndex]?.id || modules[0].id;
                      const row = { ...newItem(s.kind, moduleId, s.title), minutes: s.minutes };
                      mutate((c) => ({ ...c, items: [...c.items, row] }));
                      jobs.current.set(row.id, { itemId: row.id, summary: s.reason });
                      setMissing(missing.filter((_, i) => i !== n));
                      message.success(`Added “${s.title}”.`);
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="Nothing obvious is missing from this outline." />
        )}
      </Modal>

      <ExtractContentModal
        item={extractItem}
        open={!!extractItem}
        onClose={() => {
          const created = extractNew && extractNew === extractFor ? draft.latest.current?.items.find((i) => i.id === extractNew) : undefined;
          if (created && !String(created.content || "").trim() && !created.questions.length) {
            mutate((c) => ({ ...c, items: c.items.filter((i) => i.id !== created.id) }));
            setSelected(undefined);
          }
          setExtractNew(undefined);
          setExtractFor(undefined);
        }}
        onApply={(changes) => {
          setExtractNew(undefined);
          if (extractItem) updateItem(extractItem.id, (row) => ({ ...row, ...changes }));
          setQuestionId(undefined);
        }}
      />

      {preview && (
        <PreviewOverlay
          course={course}
          itemId={preview.itemId}
          onClose={() => setPreview(undefined)}
          onEdit={(itemId) => {
            setPreview(undefined);
            select(itemId);
          }}
        />
      )}
    </div>
  );
}
