import React, { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Drawer, Input, Progress, Radio, Result, Typography, Upload } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  LockOutlined,
  MenuOutlined,
  SendOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";
import SurveyQuestionFrame from "@/components/surveys/shared/SurveyQuestionFrame";
import { MaterialPreview } from "./Materials";
import RichText from "./RichText";
import { kindOf, useBuilderVars } from "./builder/kinds";
import {
  type Course,
  type Enrollment,
  type Item,
  type ItemProgress,
  type Material,
  orderedItems,
  canOpenItem,
  isAssessment,
  showsFeedback,
  grade,
  courseAction,
  coachMessage,
  uploadSubmission,
  learnerCourse,
  watchEnrollment,
} from "./courseStorage";
import "./styles.css";
import "./builder/builder.css";

const statusLabel: Record<NonNullable<ItemProgress["status"]>, string> = {
  started: "In progress",
  submitted: "Submitted for review",
  completed: "Completed",
  "changes-requested": "Changes requested",
};

const formatMinutes = (total: number) =>
  total >= 60 ? `about ${Math.round((total / 60) * 2) / 2} hours` : `${total} minutes`;

export function CoursePlayer({
  course,
  initialEnrollment,
  preview = false,
  onExit,
  unlockAll = false,
  initialItemId,
  onItemChange,
}: {
  course: Course;
  initialEnrollment?: Enrollment;
  preview?: boolean;
  onExit?: () => void;
  /** Preview only: open any item regardless of sequential rules. */
  unlockAll?: boolean;
  initialItemId?: string;
  onItemChange?: (itemId: string) => void;
}) {
  const { message } = App.useApp();
  const vars = useBuilderVars();
  const root = useRef<HTMLDivElement>(null);
  const [enrollment, setEnrollment] = useState<Enrollment>(
    initialEnrollment || {
      id: "preview",
      courseId: "preview",
      revision: 0,
      owner: "preview",
      learnerId: "preview",
      items: {},
      updatedAt: "",
    }
  );
  const items = orderedItems(course),
    [index, setIndex] = useState(() => {
      const ordered = orderedItems(course);
      const requested = initialItemId ? ordered.findIndex((i) => i.id === initialItemId) : -1;
      if (requested >= 0) return requested;
      return Math.max(0, ordered.findIndex((i) => initialEnrollment?.items[i.id]?.status !== "completed"));
    }),
    item = items[index];
  const [questionIndex, setQuestionIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [text, setText] = useState(""),
    [files, setFiles] = useState<Material[]>([]),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [chat, setChat] = useState(""),
    [contentsOpen, setContentsOpen] = useState(false),
    [now, setNow] = useState(Date.now());
  const progress = enrollment.items[item?.id] || {},
    question = item?.questions[questionIndex];
  const canOpen = (id?: string) => !!id && (unlockAll || canOpenItem(course, enrollment.items, id));

  useEffect(() => {
    if (preview || !initialEnrollment) return;
    return watchEnrollment(
      initialEnrollment.id,
      (next) => setEnrollment((current) => (next.updatedAt >= current.updatedAt ? next : current)),
      () => message.warning("Live progress updates are unavailable. Reload to check review results.")
    );
  }, [preview, initialEnrollment?.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const p = enrollment.items[item?.id] || {};
    setAnswers(p.answers || {});
    setText(p.text || p.reflection || "");
    setFiles(p.files || []);
    setQuestionIndex(Math.max(0, (item?.questions || []).findIndex((q) => p.answers?.[q.id] === undefined)));
    setAck(false);
    if (item) onItemChange?.(item.id);
    root.current?.querySelector(".cp-body")?.scrollTo({ top: 0 });
  }, [item?.id]);

  const required = items.filter((i) => i.required),
    completed = required.filter((i) => enrollment.items[i.id]?.status === "completed").length,
    percent = required.length ? Math.round((completed / required.length) * 100) : 0;
  const seconds =
    item?.timeLimit && progress.startedAt
      ? Math.max(0, Math.ceil((progress.startedAt + item.timeLimit * 60000 - now) / 1000))
      : undefined;
  const attemptActive = !!progress.attemptId;

  async function chooseAnswer(questionId: string, value: number) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    if (preview) {
      setEnrollment({ ...enrollment, items: { ...enrollment.items, [item.id]: { ...progress, answers: next } } });
      return;
    }
    setBusy(true);
    try {
      setEnrollment(
        await courseAction("draft", { enrollmentId: enrollment.id, itemId: item.id, attemptId: progress.attemptId, answers: next })
      );
    } catch {
      message.error("Answer not saved. Use Save progress to retry before the deadline.");
    } finally {
      setBusy(false);
    }
  }

  async function action(name: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (!item) return false;
    setBusy(true);
    try {
      if (preview) {
        let p: ItemProgress = { ...progress };
        if (name === "start")
          p = { ...p, status: "started", attempts: (p.attempts || 0) + 1, attemptId: crypto.randomUUID(), startedAt: Date.now(), answers: {} };
        if (name === "draft") p = { ...p, answers, text, files };
        if (name === "submit") {
          if (isAssessment(item)) {
            const score = grade(item, answers);
            p = {
              ...p,
              score: item.scorePolicy === "latest" ? score : Math.max(score, p.score || 0),
              answers,
              attemptId: undefined,
              startedAt: undefined,
              feedback: `Attempt score: ${score}%. ${
                showsFeedback(item) ? item.questions.map((q) => q.feedback || "").filter(Boolean).join(" ") : ""
              }`,
            };
            p.status = (p.score || 0) >= item.passMark ? "completed" : "started";
          } else p = { ...p, text, files, status: item.kind === "assignment" ? "submitted" : "completed" };
        }
        if (name === "approve-preview") p = { ...p, status: "completed", feedback: "Simulated facilitator approval." };
        setEnrollment({ ...enrollment, items: { ...enrollment.items, [item.id]: p } });
      } else
        setEnrollment(
          await courseAction(name, {
            enrollmentId: enrollment.id,
            itemId: item.id,
            answers,
            text,
            files,
            attemptId: progress.attemptId,
            acknowledged: ack,
            ...extra,
          })
        );
      if (name === "start") {
        setAnswers({});
        setQuestionIndex(0);
      }
      if (name !== "submit" || item.kind !== "lesson")
        message.success(name === "draft" ? "Progress saved." : name === "start" ? "Attempt started." : "Progress updated.");
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Unable to save progress.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function go(next: number) {
    if (next < 0 || next >= items.length) return;
    if (!canOpen(items[next].id)) {
      message.info("Complete the required items before this one first.");
      return;
    }
    if (attemptActive || text || files.length) {
      setBusy(true);
      try {
        if (!preview)
          setEnrollment(
            await courseAction("draft", { enrollmentId: enrollment.id, itemId: item.id, attemptId: progress.attemptId, answers, text, files })
          );
        else setEnrollment({ ...enrollment, items: { ...enrollment.items, [item.id]: { ...progress, answers, text, files } } });
      } catch {
        message.error("Save your progress before leaving this item.");
        return;
      } finally {
        setBusy(false);
      }
    }
    setContentsOpen(false);
    setIndex(next);
  }

  if (!item) return <Result title="Add learning items to preview the course" />;
  const locked = busy || progress.status === "submitted" || (progress.status === "completed" && !attemptActive);
  const moduleOf = (row: Item) => course.modules?.find((m) => m.id === row.moduleId);
  const moduleTitle = moduleOf(item)?.title;
  const totalMinutes = items.reduce((sum, row) => sum + (row.minutes || 0), 0);
  const nextItem = items[index + 1];

  const outline = (
    <div className="cp-outline">
      {(course.modules || []).map((module) => {
        const rows = items.filter((row) => row.moduleId === module.id);
        if (!rows.length) return null;
        return (
          <div key={module.id} className="cp-mod">
            <span className="cp-mod-title">{module.title}</span>
            {rows.map((row) => {
              const n = items.indexOf(row);
              const status = enrollment.items[row.id]?.status;
              const open = canOpen(row.id);
              const state = n === index ? "now" : status === "completed" ? "done" : !open ? "locked" : status ? "started" : "open";
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`cp-item is-${state}`}
                  aria-current={n === index ? "step" : undefined}
                  disabled={!open || busy}
                  onClick={() => void go(n)}
                >
                  <span className="cp-state" aria-hidden="true">
                    {state === "done" ? <CheckOutlined /> : state === "locked" ? <LockOutlined /> : null}
                  </span>
                  <span className="cp-item-title">{row.title}</span>
                  <small className="cb-tnum">{row.minutes}m</small>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="cp-shell" style={vars} ref={root}>
    <div className="cp">
      <aside className="cp-side">
        <div className="cp-course">
          <strong>{course.title}</strong>
          <small>
            {course.level} · {formatMinutes(totalMinutes)}
          </small>
        </div>
        <div className="cp-progress">
          <Progress percent={percent} showInfo={false} size="small" />
          <small className="cb-tnum">
            {completed} of {required.length} required complete
          </small>
        </div>
        {outline}
      </aside>

      <div className="cp-main">
        <div className="cp-top">
          {onExit && (
            <Button
              size="small"
              icon={<ArrowLeftOutlined />}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if ((attemptActive || text || files.length) && seconds !== 0)
                    await courseAction("draft", { enrollmentId: enrollment.id, itemId: item.id, attemptId: progress.attemptId, answers, text, files });
                  onExit();
                } catch {
                  message.error("Your progress could not be saved. Retry before leaving.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save & exit
            </Button>
          )}
          <span className="cp-top-module cb-ellipsis">{moduleTitle}</span>
          <Button size="small" className="cp-contents-btn" icon={<MenuOutlined />} onClick={() => setContentsOpen(true)}>
            Contents
          </Button>
        </div>
        <div className="cp-thin-progress" aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </div>

        <div className="cp-body">
          <article className="cp-article">
            {required.length > 0 && completed === required.length && (
              <Alert type="success" showIcon message="Course complete" description="You have completed every required learning item." className="cp-block" />
            )}
            <div className="cp-meta">
              <span>{kindOf(item.kind).label}</span>
              <span>{item.minutes} min</span>
              <span>{item.required ? "Required" : "Optional"}</span>
              {progress.status && <span className={`cp-status is-${progress.status}`}>{statusLabel[progress.status]}</span>}
            </div>
            <h1>{item.title}</h1>
            {!isAssessment(item) && item.objective && (
              <div className="cp-goal">
                <b>By the end of this {item.kind === "assignment" ? "assignment" : "lesson"}</b>
                {item.objective}
              </div>
            )}
            {item.kind !== "interactive" && (
              <div className="cp-prose">
                <RichText text={item.content} />
              </div>
            )}
            {!isAssessment(item) && (item.materials || []).length > 0 && <MaterialPreview materials={item.materials || []} />}

            {isAssessment(item) ? (
              <div className="cp-block">
                <div className="cp-facts">
                  <span>
                    Pass mark <b>{item.passMark}%</b>
                  </span>
                  <span>
                    Attempts <b className="cb-tnum">{progress.attempts || 0} of {item.attempts || 1}</b>
                  </span>
                  <span>{item.scorePolicy === "latest" ? "Latest" : "Best"} score counts</span>
                  {!!item.timeLimit && <span>{item.timeLimit} minute limit</span>}
                </div>
                {typeof progress.score === "number" && (
                  <Alert
                    type={progress.score >= item.passMark ? "success" : "warning"}
                    showIcon
                    message={`Recorded score: ${progress.score}%`}
                    description={progress.feedback ? <span className="cp-pre">{progress.feedback}</span> : undefined}
                  />
                )}
                {!attemptActive ? (
                  <Button
                    type="primary"
                    size="large"
                    loading={busy}
                    disabled={(progress.attempts || 0) >= (item.attempts || 1)}
                    onClick={() => void action("start")}
                  >
                    {progress.attempts ? "Try again" : `Start ${item.kind}`}
                  </Button>
                ) : (
                  <>
                    {seconds !== undefined && (
                      <Alert
                        type={seconds === 0 ? "warning" : "info"}
                        message={
                          seconds === 0
                            ? "Time is up. Submit your current answers."
                            : `Time remaining: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                        }
                      />
                    )}
                    {question && (
                      <SurveyQuestionFrame
                        index={questionIndex}
                        total={item.questions.length}
                        field={{ id: question.id, type: "radio", label: question.text, required: true }}
                        sectionLabel={item.title}
                        answeredCount={item.questions.filter((q) => answers[q.id] !== undefined).length}
                        footer={
                          <div className="course-footer">
                            <Button disabled={questionIndex === 0} onClick={() => setQuestionIndex(questionIndex - 1)}>
                              Previous
                            </Button>
                            <Button disabled={questionIndex === item.questions.length - 1} onClick={() => setQuestionIndex(questionIndex + 1)}>
                              Next
                            </Button>
                          </div>
                        }
                      >
                        <MaterialPreview materials={question.materials || []} />
                        <Radio.Group
                          className="cp-options"
                          value={answers[question.id]}
                          disabled={busy || seconds === 0}
                          onChange={(e) => void chooseAnswer(question.id, e.target.value)}
                        >
                          {question.options.map((option, n) => (
                            <Radio key={n} value={n} className="cp-option">
                              {option}
                            </Radio>
                          ))}
                        </Radio.Group>
                      </SurveyQuestionFrame>
                    )}
                    <div className="course-footer">
                      <Button loading={busy} onClick={() => void action("draft")}>
                        Save progress
                      </Button>
                      <Button
                        type="primary"
                        loading={busy}
                        disabled={seconds !== 0 && item.questions.some((q) => answers[q.id] === undefined)}
                        onClick={() => void action("submit")}
                      >
                        Submit answers
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : item.kind === "assignment" ? (
              <div className="cp-block">
                {item.rubric && (
                  <div className="cp-card">
                    <h2>How it will be marked</h2>
                    <div className="cp-prose">
                      <RichText text={item.rubric} />
                    </div>
                  </div>
                )}
                {progress.feedback && (
                  <Alert
                    type={progress.status === "changes-requested" ? "warning" : "info"}
                    showIcon
                    message={progress.status === "changes-requested" ? "Your facilitator asked for changes" : "Facilitator feedback"}
                    description={progress.feedback}
                  />
                )}
                <h2 className="cp-h2">Your submission</h2>
                {item.submissionType !== "file" && (
                  <Input.TextArea
                    id={`submission-${item.id}`}
                    aria-label="Written submission"
                    autoSize={{ minRows: 5, maxRows: 16 }}
                    value={text}
                    disabled={locked}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Write your submission"
                  />
                )}
                {item.submissionType !== "text" && (
                  <Upload
                    showUploadList={false}
                    disabled={locked}
                    beforeUpload={async (file) => {
                      setBusy(true);
                      try {
                        if (preview) {
                          const url = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result));
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                          });
                          setFiles([...files, { id: crypto.randomUUID(), kind: "document", name: file.name, url }]);
                        } else setFiles([...files, await uploadSubmission(file, enrollment.id)]);
                      } catch (error) {
                        message.error(error instanceof Error ? error.message : "The file could not be attached.");
                      } finally {
                        setBusy(false);
                      }
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />} disabled={locked}>
                      Attach a file
                    </Button>
                  </Upload>
                )}
                {files.map((file) => (
                  <div key={file.id} className="cp-file">
                    <a href={file.url} download={file.name}>
                      {file.name}
                    </a>
                    {!locked && (
                      <Button type="link" danger onClick={() => setFiles(files.filter((f) => f.id !== file.id))}>
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
                <div className="course-footer">
                  <Button disabled={locked} onClick={() => void action("draft")}>
                    Save progress
                  </Button>
                  <Button
                    type="primary"
                    disabled={
                      locked ||
                      (item.submissionType === "file"
                        ? !files.length
                        : item.submissionType === "text"
                        ? !text.trim()
                        : !text.trim() && !files.length)
                    }
                    onClick={() => void action("submit")}
                  >
                    Submit for review
                  </Button>
                </div>
                {preview && progress.status === "submitted" && (
                  <Button onClick={() => void action("approve-preview")}>Simulate facilitator approval</Button>
                )}
              </div>
            ) : item.kind === "interactive" ? (
              <div className="cp-block">
                {item.objective && <p className="cp-lead">{item.objective}</p>}
                <div className="cp-chat">
                  <div className="cp-bubble is-model">{item.welcome}</div>
                  {(progress.messages || []).map((m, n) => (
                    <div key={n} className={`cp-bubble is-${m.role}`}>
                      {m.text}
                    </div>
                  ))}
                </div>
                <div className="cp-chat-input">
                  <Input
                    id={`coach-message-${item.id}`}
                    aria-label="Message to your coach"
                    value={chat}
                    disabled={locked}
                    maxLength={3000}
                    onChange={(e) => setChat(e.target.value)}
                    placeholder="Ask or practise with your coach"
                  />
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    disabled={!chat.trim() || locked}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (preview)
                          setEnrollment({
                            ...enrollment,
                            items: {
                              ...enrollment.items,
                              [item.id]: {
                                ...progress,
                                messages: [
                                  ...(progress.messages || []),
                                  { role: "user", text: chat },
                                  { role: "model", text: "Preview response: explain your reasoning and connect it to the learning objective." },
                                ],
                              },
                            },
                          });
                        else setEnrollment(await coachMessage(enrollment.id, item.id, chat));
                        setChat("");
                      } catch (error) {
                        message.error(error instanceof Error ? error.message : "The coach could not reply.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                <Typography.Text type="secondary" className="cb-tnum">
                  {(progress.messages || []).filter((m) => m.role === "user").length} of {item.minTurns || 3} coaching exchanges
                </Typography.Text>
                <h2 className="cp-h2">Reflection</h2>
                <p className="cp-lead">{item.reflectionPrompt}</p>
                <Input.TextArea
                  id={`reflection-${item.id}`}
                  aria-label="Your reflection"
                  autoSize={{ minRows: 3, maxRows: 10 }}
                  value={text}
                  disabled={locked}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Your reflection"
                />
                <Button
                  type="primary"
                  className="cb-self-start"
                  disabled={locked || !text.trim() || (progress.messages || []).filter((m) => m.role === "user").length < (item.minTurns || 3)}
                  onClick={() => void action("submit")}
                >
                  Complete practice
                </Button>
              </div>
            ) : null}
          </article>
        </div>

        <div className="cp-foot">
          {item.kind === "lesson" && progress.status !== "completed" ? (
            <label className="cp-ack" htmlFor={`ack-${item.id}`}>
              <Checkbox id={`ack-${item.id}`} checked={ack} disabled={locked} onChange={(e) => setAck(e.target.checked)} />
              I have studied this lesson
            </label>
          ) : (
            <span className="cb-grow" />
          )}
          <Button disabled={index === 0 || busy} icon={<ArrowLeftOutlined />} onClick={() => void go(index - 1)}>
            <span className="cp-hide-narrow">Previous</span>
          </Button>
          {item.kind === "lesson" && progress.status !== "completed" ? (
            <Button
              type="primary"
              disabled={!ack || locked}
              onClick={async () => {
                const done = await action("submit");
                if (done && nextItem) setIndex(index + 1);
              }}
            >
              {nextItem ? "Complete and continue" : "Complete lesson"}
            </Button>
          ) : (
            <Button type="primary" disabled={!nextItem || busy || !canOpen(nextItem?.id)} onClick={() => void go(index + 1)}>
              <span className="cb-ellipsis cp-next-label">{nextItem ? `Next: ${nextItem.title}` : "End of course"}</span>
              {nextItem && <ArrowRightOutlined />}
            </Button>
          )}
        </div>
      </div>
    </div>

      <Drawer
        title={course.title}
        placement="left"
        width={300}
        open={contentsOpen}
        onClose={() => setContentsOpen(false)}
        getContainer={() => root.current || document.body}
        rootStyle={{ position: "absolute" }}
      >
        <div className="cp-progress cp-drawer-progress">
          <Progress percent={percent} showInfo={false} size="small" />
          <small className="cb-tnum">
            {completed} of {required.length} required complete
          </small>
        </div>
        {outline}
      </Drawer>
    </div>
  );
}

export default function LearnerCoursePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [data, setData] = useState<{ course: Course; enrollment: Enrollment }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (id)
      learnerCourse(id)
        .then((value) => {
          if (!cancelled) setData(value);
        })
        .catch((reason) => {
          if (!cancelled) setError(reason.message);
        });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return (
    <div className="cp-page">
      {error ? (
        <Alert type="error" message={error} />
      ) : data ? (
        <CoursePlayer key={data.enrollment.id} course={data.course} initialEnrollment={data.enrollment} onExit={() => navigate("/academy")} />
      ) : (
        <Typography.Paragraph>Loading course…</Typography.Paragraph>
      )}
    </div>
  );
}
