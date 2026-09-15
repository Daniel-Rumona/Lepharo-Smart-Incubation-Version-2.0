import React, { useMemo, useState } from "react";
import { Alert, App, Button, Checkbox, Dropdown, Input, Tag, Upload } from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
  type CourseOutline,
  type OutlineItem,
  MAX_COURSE_FILE_BYTES,
  MAX_OUTLINE_DOCUMENTS,
  draftOutline,
} from "@/services/courseAiService";
import { type SavedCourse, saveCourse } from "../courseStorage";
import { KindIcon, kindOf, newItem, uid, useBuilderVars } from "./kinds";
import { AiMark, Crumbs, OptionCard, TopBar, Typewriter } from "./parts";
import type { DraftJob } from "./CourseBuilder";

type Mode = "describe" | "documents" | "blank";
type Length = "short" | "medium" | "long";

const COURSES = "/operations/training/courses";

const modes: Record<Mode, { title: string; hint: string; short: string; lead: string; icon: React.ReactNode; ai: boolean }> = {
  documents: {
    title: "Build from documents",
    hint: "Upload training manuals, slides or policies. AI turns them into modules, lessons and questions.",
    short: "Manuals, slides or policies",
    lead: "Upload what you already teach from.",
    icon: <FileTextOutlined />,
    ai: true,
  },
  describe: {
    title: "Describe the course",
    hint: "Say who it's for and what they should be able to do. AI proposes the outline.",
    short: "Topic, audience and goal",
    lead: "Say who it's for and what they should be able to do.",
    icon: <AiMark />,
    ai: true,
  },
  blank: {
    title: "Start blank",
    hint: "Build the outline yourself. AI help stays available inside every item.",
    short: "Build the outline yourself",
    lead: "Name it now; everything else can come later.",
    icon: <EditOutlined />,
    ai: false,
  },
};

const levels = [
  ["Beginner", "New to the topic"],
  ["Intermediate", "Knows the basics"],
  ["Advanced", "Applies it every day"],
] as const;
const lengths: [Length, string, string][] = [
  ["short", "Under 1 hour", "3–5 items"],
  ["medium", "About 2 hours", "8–10 items"],
  ["long", "Half a day", "12 or more items"],
];
const includes = [
  ["quiz", "Quiz per module", "Short practice check"],
  ["assignment", "Practical assignment", "Reviewed by a facilitator"],
  ["test", "Final test", "Pass mark and attempts"],
] as const;

const INTRO_TEXT = "Start from what you already have. AI drafts an outline for you to check — nothing is created until you confirm it.";

type ReviewItem = OutlineItem & { key: string; keep: boolean };
type ReviewModule = { key: string; title: string; items: ReviewItem[] };

const formatMinutes = (total: number) =>
  total >= 60 ? `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m` : `${total} min`;

export default function CourseStart() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { user } = useFullIdentity();
  const vars = useBuilderVars();

  const [mode, setMode] = useState<Mode>("describe");
  const [step, setStep] = useState<"choose" | "brief">("choose");
  const [phase, setPhase] = useState<"brief" | "review">("brief");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [blankTitle, setBlankTitle] = useState("");
  const [level, setLevel] = useState("Beginner");
  const [length, setLength] = useState<Length>("medium");
  const [include, setInclude] = useState<Set<string>>(new Set(["quiz", "assignment", "test"]));
  const [documents, setDocuments] = useState<File[]>([]);
  const [busy, setBusy] = useState<"" | "outline" | "create">("");
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<{ title: string; description: string; warnings: string[]; modules: ReviewModule[] }>();

  const kept = useMemo(() => outline?.modules.flatMap((m) => m.items.filter((i) => i.keep)) || [], [outline]);

  const toReview = (data: CourseOutline) =>
    setOutline({
      title: data.title,
      description: data.description,
      warnings: data.warnings,
      modules: data.modules.map((m) => ({
        key: uid(),
        title: m.title,
        items: m.items.map((i) => ({ ...i, key: uid(), keep: true })),
      })),
    });

  async function requestOutline() {
    setError("");
    if (mode === "describe" && !topic.trim()) return setError("Say what the course is about.");
    if (mode === "documents" && !documents.length) return setError("Add at least one document.");
    setBusy("outline");
    try {
      toReview(
        await draftOutline({
          mode: mode === "documents" ? "documents" : "describe",
          topic,
          audience,
          goal,
          level,
          length,
          include: [...include],
          documents: mode === "documents" ? documents : [],
        })
      );
      setPhase("review");
      window.scrollTo({ top: 0 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The outline could not be drafted.");
    } finally {
      setBusy("");
    }
  }

  async function createCourse(withContent: boolean) {
    if (!user?.uid) return;
    setBusy("create");
    setError("");
    const modules: SavedCourse["modules"] = [];
    const items: SavedCourse["items"] = [];
    const jobs: DraftJob[] = [];
    if (mode === "blank" || !outline) {
      modules.push({ id: uid(), title: "Module 1" });
    } else {
      for (const module of outline.modules) {
        const rows = module.items.filter((i) => i.keep);
        if (!rows.length) continue;
        const moduleId = uid();
        modules.push({ id: moduleId, title: module.title.trim() || "Untitled module" });
        for (const row of rows) {
          const item = { ...newItem(row.kind, moduleId, row.title.trim() || undefined), minutes: row.minutes };
          items.push(item);
          jobs.push({ itemId: item.id, summary: row.summary, notes: row.notes });
        }
      }
    }
    const isAssess = (id: string) => ["quiz", "test"].includes(items.find((i) => i.id === id)?.kind || "");
    const course: SavedCourse = {
      id: uid(),
      owner: user.uid,
      title: (mode === "blank" ? blankTitle : outline?.title)?.trim() || "Untitled course",
      description: mode === "blank" ? "" : outline?.description || "",
      level,
      audience: mode === "blank" ? "" : audience.trim(),
      modules,
      items,
      sequential: true,
      updatedAt: new Date().toISOString(),
      revision: 0,
      publishedRevision: 0,
    };
    try {
      await saveCourse(course);
      navigate(`${COURSES}/builder/${course.id}`, {
        state: withContent
          ? {
              // Lessons first, so quizzes and tests are written from finished lessons.
              draftQueue: [...jobs.filter((j) => !isAssess(j.itemId)), ...jobs.filter((j) => isAssess(j.itemId))],
              goal,
            }
          : { goal },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The course could not be created.");
      setBusy("");
    }
  }

  const modeMenu = (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectable: true,
        selectedKeys: [mode],
        items: (Object.keys(modes) as Mode[]).map((key) => ({
          key,
          icon: <span className="cb-menu-icon">{modes[key].icon}</span>,
          label: (
            <span className="cb-menu-label">
              <strong>{modes[key].title}</strong>
              <small>{modes[key].short}</small>
            </span>
          ),
        })),
        onClick: ({ key }) => setMode(key as Mode),
      }}
    >
      <Button shape="round" className="cb-mode-trigger">
        <span className="cb-menu-icon">{modes[mode].icon}</span>
        <span className="cb-ellipsis">{modes[mode].title}</span>
        <DownOutlined />
      </Button>
    </Dropdown>
  );

  if (phase === "review" && outline) {
    const minutes = kept.reduce((sum, item) => sum + item.minutes, 0);
    const updateModule = (key: string, change: (m: ReviewModule) => ReviewModule) =>
      setOutline({ ...outline, modules: outline.modules.map((m) => (m.key === key ? change(m) : m)) });
    return (
      <div className="cb-page" style={vars}>
        <div className="cb-review">
          <aside className="cb-panel cb-review-aside">
            <Button type="text" size="small" shape="round" icon={<ArrowLeftOutlined />} className="cb-back-link" onClick={() => setPhase("brief")}>
              Change the brief
            </Button>
            <div className="cb-field">
              <span className="cb-eyebrow">Proposed outline</span>
              <Input
                id="outline-title"
                aria-label="Course title"
                variant="borderless"
                className="cb-review-title"
                value={outline.title}
                onChange={(e) => setOutline({ ...outline, title: e.target.value })}
              />
              <Input.TextArea
                id="outline-description"
                aria-label="Course description"
                variant="borderless"
                autoSize={{ minRows: 1, maxRows: 5 }}
                className="cb-review-description"
                value={outline.description}
                onChange={(e) => setOutline({ ...outline, description: e.target.value })}
              />
            </div>
            <div className="cb-facts">
              <div><b className="cb-tnum">{outline.modules.filter((m) => m.items.some((i) => i.keep)).length}</b><span>modules</span></div>
              <div><b className="cb-tnum">{kept.length}</b><span>items</span></div>
              <div><b className="cb-tnum">{formatMinutes(minutes)}</b><span>learning time</span></div>
              <div><b>{level}</b><span>level</span></div>
            </div>
            <div className="cb-ai-note">
              <AiMark />
              <span>
                Drafted from your {mode === "documents" ? "documents" : "description"}. Untick anything you don't want and rename freely.
                Nothing is created until you confirm.
              </span>
            </div>
            {outline.warnings.map((warning) => (
              <Alert key={warning} type="warning" showIcon message={warning} />
            ))}
            <Button shape="round" icon={<AiMark />} loading={busy === "outline"} onClick={() => void requestOutline()}>
              Draft again
            </Button>
          </aside>
          <div className="cb-review-main">
            {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}
            {outline.modules.map((module, index) => (
              <section key={module.key} className="cb-panel cb-omodule">
                <div className="cb-omodule-head">
                  <Tag className="cb-tnum">Module {index + 1}</Tag>
                  <Input
                    id={`outline-module-${index}`}
                    aria-label={`Module ${index + 1} title`}
                    variant="borderless"
                    className="cb-omodule-title"
                    value={module.title}
                    onChange={(e) => updateModule(module.key, (m) => ({ ...m, title: e.target.value }))}
                  />
                </div>
                {module.items.map((row, n) => (
                  <div key={row.key} className={`cb-orow ${row.keep ? "" : "is-off"}`}>
                    <Checkbox
                      id={`outline-keep-${row.key}`}
                      aria-label={`Keep ${row.title}`}
                      checked={row.keep}
                      onChange={(e) =>
                        updateModule(module.key, (m) => ({
                          ...m,
                          items: m.items.map((i) => (i.key === row.key ? { ...i, keep: e.target.checked } : i)),
                        }))
                      }
                    />
                    <KindIcon kind={row.kind} />
                    <span className="cb-orow-text">
                      <Input
                        id={`outline-item-${row.key}`}
                        aria-label={`Item ${n + 1} title`}
                        variant="borderless"
                        className="cb-orow-title"
                        value={row.title}
                        onChange={(e) =>
                          updateModule(module.key, (m) => ({
                            ...m,
                            items: m.items.map((i) => (i.key === row.key ? { ...i, title: e.target.value } : i)),
                          }))
                        }
                      />
                      <small>
                        {kindOf(row.kind).label}
                        {row.summary ? ` · ${row.summary}` : ""}
                      </small>
                    </span>
                    <span className="cb-muted cb-tnum cb-nowrap">{row.minutes} min</span>
                    {row.suggested ? (
                      <Tag className="cb-tag-ai cb-hide-xs">AI idea</Tag>
                    ) : (
                      <span className="cb-hide-xs" />
                    )}
                  </div>
                ))}
              </section>
            ))}
            <div className="cb-panel cb-review-foot">
              <span className="cb-muted">AI writes first drafts, and every item is marked for you to review.</span>
              <Button shape="round" disabled={!kept.length || !!busy} loading={busy === "create"} onClick={() => void createCourse(false)}>
                Create outline only
              </Button>
              <Button type="primary" shape="round" icon={<AiMark />} disabled={!kept.length || !!busy} loading={busy === "create"} onClick={() => void createCourse(true)}>
                Create course and draft content
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-page" style={vars}>
      <TopBar>
        {step === "brief" ? (
          <>
            <Button type="text" shape="round" icon={<ArrowLeftOutlined />} aria-label="Back to start options" onClick={() => setStep("choose")} />
            <div className="cb-crumbs">{modeMenu}</div>
          </>
        ) : (
          <>
            <Crumbs trail={["Training Academy", "Courses"]} current="New course" />
            <Button type="text" shape="round" onClick={() => navigate(COURSES)}>
              Cancel
            </Button>
          </>
        )}
      </TopBar>

      <div className="cb-start">
        {step === "choose" && (
          <div className="cb-choose-stage">
            <div className="cb-start-head">
              <h1>Create a course</h1>
              <p>
                <Typewriter text={INTRO_TEXT} />
              </p>
            </div>
            <div className="cb-paths" role="radiogroup" aria-label="How to start">
              {(Object.keys(modes) as Mode[]).map((key) => (
                <OptionCard
                  key={key}
                  id={`start-mode-${key}`}
                  size="large"
                  ai={modes[key].ai}
                  icon={modes[key].icon}
                  title={modes[key].title}
                  hint={modes[key].hint}
                  selected={mode === key}
                  onSelect={() => setMode(key)}
                />
              ))}
            </div>
            <div className="cb-choose-continue">
              <Button type="primary" block size="large" shape="round" onClick={() => setStep("brief")}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === "brief" && (
          <section className="cb-panel cb-brief">
            <div className="cb-brief-title">
              <h1>{modes[mode].title}</h1>
              <p>
                <Typewriter key={mode} text={modes[mode].lead} />
              </p>
            </div>
            {mode === "describe" && (
              <>
                <div className="cb-field">
                  <label htmlFor="brief-topic">What is the course about?</label>
                  <Input id="brief-topic" value={topic} placeholder="e.g. Cash flow management for small businesses" onChange={(e) => setTopic(e.target.value)} />
                </div>
                <div className="cb-brief-row">
                  <div className="cb-field">
                    <label htmlFor="brief-audience">Who is it for?</label>
                    <Input id="brief-audience" value={audience} placeholder="e.g. Early-stage SME owners" onChange={(e) => setAudience(e.target.value)} />
                  </div>
                  <div className="cb-field">
                    <label htmlFor="brief-goal">By the end, learners can…</label>
                    <Input id="brief-goal" value={goal} placeholder="e.g. Forecast 13 weeks of cash" onChange={(e) => setGoal(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            {mode === "documents" && (
              <>
                <div className="cb-field">
                  <span className="cb-label">
                    Documents <span className="cb-hint">PDF, Word, PowerPoint or text · up to {MAX_OUTLINE_DOCUMENTS} files, {MAX_COURSE_FILE_BYTES / (1024 * 1024)} MB each</span>
                  </span>
                  <Upload.Dragger
                    multiple
                    showUploadList={false}
                    accept=".pdf,.docx,.pptx,.txt,.md"
                    disabled={documents.length >= MAX_OUTLINE_DOCUMENTS}
                    beforeUpload={(file) => {
                      if (file.size > MAX_COURSE_FILE_BYTES) {
                        message.error(`"${file.name}" is larger than ${MAX_COURSE_FILE_BYTES / (1024 * 1024)} MB.`);
                        return Upload.LIST_IGNORE;
                      }
                      setDocuments((current) =>
                        current.length >= MAX_OUTLINE_DOCUMENTS || current.some((f) => f.name === file.name) ? current : [...current, file]
                      );
                      return false;
                    }}
                  >
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">Drop documents here or click to choose</p>
                  </Upload.Dragger>
                  {documents.map((file) => (
                    <div key={file.name} className="cb-file">
                      <FileTextOutlined />
                      <span className="cb-ellipsis">{file.name}</span>
                      <small>{(file.size / (1024 * 1024)).toFixed(1)} MB</small>
                      <Button type="text" size="small" shape="round" danger icon={<DeleteOutlined />} aria-label={`Remove ${file.name}`} onClick={() => setDocuments(documents.filter((f) => f !== file))} />
                    </div>
                  ))}
                </div>
                <div className="cb-field">
                  <label htmlFor="brief-doc-audience">
                    Who is it for? <span className="cb-hint">Optional — helps AI pitch the language</span>
                  </label>
                  <Input id="brief-doc-audience" value={audience} placeholder="e.g. Early-stage SME owners" onChange={(e) => setAudience(e.target.value)} />
                </div>
              </>
            )}
            {mode === "blank" && (
              <div className="cb-field">
                <label htmlFor="brief-title">Course title</label>
                <Input id="brief-title" value={blankTitle} placeholder="e.g. Cash flow for small businesses" onChange={(e) => setBlankTitle(e.target.value)} />
              </div>
            )}

            <div className="cb-field">
              <span className="cb-label">Level</span>
              <div className="cb-opt-grid" role="radiogroup" aria-label="Level">
                {levels.map(([value, hint]) => (
                  <OptionCard key={value} id={`brief-level-${value}`} title={value} hint={hint} selected={level === value} onSelect={() => setLevel(value)} />
                ))}
              </div>
            </div>
            {mode !== "blank" && (
              <>
                <div className="cb-field">
                  <span className="cb-label">About how long?</span>
                  <div className="cb-opt-grid" role="radiogroup" aria-label="Length">
                    {lengths.map(([value, title, hint]) => (
                      <OptionCard key={value} id={`brief-length-${value}`} title={title} hint={hint} selected={length === value} onSelect={() => setLength(value)} />
                    ))}
                  </div>
                </div>
                <div className="cb-field">
                  <span className="cb-label">
                    Include <span className="cb-hint">AI adds these where they fit</span>
                  </span>
                  <div className="cb-opt-grid" role="group" aria-label="Include">
                    {includes.map(([value, title, hint]) => (
                      <OptionCard
                        key={value}
                        id={`brief-include-${value}`}
                        multiple
                        title={title}
                        hint={hint}
                        selected={include.has(value)}
                        onSelect={() => {
                          const next = new Set(include);
                          if (next.has(value)) next.delete(value);
                          else next.add(value);
                          setInclude(next);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
            {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}
            <div className="cb-brief-foot">
              <span className="cb-muted">
                {mode === "blank"
                  ? "You can use AI inside any item later."
                  : mode === "documents"
                  ? "Takes about a minute for 60 pages. You review everything before it's created."
                  : "Takes about 20 seconds. You review everything before it's created."}
              </span>
              {mode === "blank" ? (
                <Button type="primary" shape="round" loading={busy === "create"} onClick={() => void createCourse(false)}>
                  Create empty course
                </Button>
              ) : (
                <Button type="primary" shape="round" icon={<AiMark />} loading={busy === "outline"} onClick={() => void requestOutline()}>
                  {busy === "outline" ? (mode === "documents" ? "Reading documents…" : "Drafting outline…") : mode === "documents" ? "Read documents and draft outline" : "Draft outline with AI"}
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
