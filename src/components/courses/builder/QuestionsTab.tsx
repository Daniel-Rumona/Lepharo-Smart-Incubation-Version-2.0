import React, { useMemo, useState } from "react";
import { App, Button, Collapse, Empty, Input, InputNumber, Radio, Select, Tag, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  MinusOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import Materials from "../Materials";
import { type Item, type Question, type SavedCourse, isAssessment, orderedItems, showsFeedback } from "../courseStorage";
import { newQuestion, uid } from "./kinds";
import { AiMark } from "./parts";

export type GenerateOptions = { lessonIds: string[]; count: number; style: "scenario" | "recall" | "mixed" };

const letter = (n: number) => String.fromCharCode(65 + n);

export const questionProblems = (q: Question) => {
  const problems: string[] = [];
  if (!q.text.trim()) problems.push("Write the question");
  if (q.options.length < 2 || q.options.some((o) => !o.trim())) problems.push("Fill in every option");
  else if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length) problems.push("Options must be different");
  if (!(q.answer >= 0 && q.answer < q.options.length)) problems.push("Choose the correct answer");
  return problems;
};

/** Lessons worth writing questions from: same module first, otherwise every lesson with content. */
export function sourceLessons(course: SavedCourse, item: Item) {
  const lessons = orderedItems(course).filter((row) => row.kind === "lesson");
  const sameModule = lessons.filter((row) => row.moduleId === item.moduleId && row.content.trim());
  return { lessons, defaults: (sameModule.length ? sameModule : lessons.filter((row) => row.content.trim())).map((row) => row.id) };
}

export default function QuestionsTab({
  course,
  item,
  update,
  generating,
  onGenerate,
  questionId,
  onQuestion,
  onExtract,
}: {
  course: SavedCourse;
  item: Item;
  update: (change: (item: Item) => Item) => void;
  generating: boolean;
  onGenerate: (options: GenerateOptions) => void;
  questionId?: string;
  onQuestion: (id?: string) => void;
  onExtract: () => void;
}) {
  const { modal } = App.useApp();
  const { lessons, defaults } = useMemo(() => sourceLessons(course, item), [course, item]);
  const [picked, setPicked] = useState<string[]>(defaults);
  const [count, setCount] = useState(5);
  const [style, setStyle] = useState<GenerateOptions["style"]>("scenario");
  const [openGenerator, setOpenGenerator] = useState(!item.questions.length);
  const unconfirmed = item.questions.filter((q) => q.aiSuggested).length;
  const broken = item.questions.filter((q) => questionProblems(q).length).length;
  const modules = course.modules || [];

  const setQuestion = (id: string, change: (q: Question) => Question) =>
    update((current) => ({ ...current, questions: current.questions.map((q) => (q.id === id ? change(q) : q)) }));
  const move = (id: string, direction: number) =>
    update((current) => {
      const rows = [...current.questions];
      const from = rows.findIndex((q) => q.id === id), to = from + direction;
      if (from < 0 || to < 0 || to >= rows.length) return current;
      [rows[from], rows[to]] = [rows[to], rows[from]];
      return { ...current, questions: rows };
    });

  const generator = (
    <div className="cb-generator">
      <div className="cb-label">
        <AiMark /> Generate questions from lessons
      </div>
      {lessons.length ? (
        <div className="cb-picks" role="group" aria-label="Lessons to use">
          {lessons.map((lesson) => {
            const on = picked.includes(lesson.id);
            const moduleIndex = modules.findIndex((m) => m.id === lesson.moduleId);
            return (
              <button
                key={lesson.id}
                type="button"
                className="cb-pick"
                aria-pressed={on}
                disabled={!lesson.content.trim()}
                title={!lesson.content.trim() ? "This lesson has no content yet" : undefined}
                onClick={() => setPicked(on ? picked.filter((id) => id !== lesson.id) : [...picked, lesson.id])}
              >
                {on && <CheckOutlined />}
                <span className="cb-muted">M{moduleIndex + 1}</span> {lesson.title || "Untitled lesson"}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="cb-muted cb-m0">Add a lesson with content first, or use a document.</p>
      )}
      <div className="cb-generator-row">
        <label className="cb-inline-label" htmlFor={`gen-count-${item.id}`}>Questions</label>
        <InputNumber id={`gen-count-${item.id}`} min={1} max={20} value={count} onChange={(value) => setCount(value || 5)} style={{ width: 72 }} />
        <label className="cb-inline-label" htmlFor={`gen-style-${item.id}`}>Style</label>
        <Select
          id={`gen-style-${item.id}`}
          value={style}
          onChange={setStyle}
          style={{ minWidth: 170 }}
          options={[
            { value: "scenario", label: "Apply to a scenario" },
            { value: "recall", label: "Recall facts" },
            { value: "mixed", label: "Mixed" },
          ]}
        />
        <span className="cb-grow" />
        <Button shape="round" variant="filled" color="default" icon={<FileTextOutlined />} onClick={onExtract}>
          From a document
        </Button>
        <Button
          shape="round"
          className="cb-btn-ai"
          icon={<AiMark />}
          loading={generating}
          disabled={!picked.length}
          onClick={() => onGenerate({ lessonIds: picked, count, style })}
        >
          {generating ? "Writing questions…" : item.questions.length ? "Generate more" : "Generate questions"}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {openGenerator || !item.questions.length ? (
        generator
      ) : (
        <div className="cb-generator-collapsed">
          <Button shape="round" className="cb-btn-ai" icon={<AiMark />} onClick={() => setOpenGenerator(true)}>
            Generate more from lessons
          </Button>
          <Button shape="round" variant="filled" color="default" icon={<FileTextOutlined />} onClick={onExtract}>
            From a document
          </Button>
        </div>
      )}

      {item.questions.length > 0 && (
        <div className="cb-q-summary">
          <Tag className="cb-tnum">{item.questions.length} questions</Tag>
          {unconfirmed ? (
            <Tag className="cb-tag-ai cb-tnum">{unconfirmed} AI answers to confirm</Tag>
          ) : (
            <Tag color="success">All answers confirmed</Tag>
          )}
          {broken > 0 && <Tag color="warning" className="cb-tnum">{broken} need attention</Tag>}
          {unconfirmed > 0 && (
            <span className="cb-muted">AI suggests each correct answer. Confirm it, or click the right option.</span>
          )}
        </div>
      )}

      <div className="cb-qlist">
        {item.questions.map((q, index) => {
          const open = questionId === q.id;
          const problems = questionProblems(q);
          return (
            <article key={q.id} className={`cb-q ${open ? "is-open" : ""} ${problems.length ? "has-problem" : ""}`} id={`question-${q.id}`}>
              <div className="cb-q-top">
                <Tag className="cb-tnum">{index + 1}</Tag>
                <strong className="cb-q-text">{q.text || <span className="cb-muted">Untitled question</span>}</strong>
                <Button size="small" shape="round" type={open ? "primary" : "default"} onClick={() => onQuestion(open ? undefined : q.id)}>
                  {open ? "Done" : "Edit"}
                </Button>
              </div>

              {open ? (
                <div className="cb-q-edit">
                  <Input.TextArea
                    id={`q-text-${q.id}`}
                    aria-label="Question text"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    value={q.text}
                    placeholder="Write the question"
                    onChange={(e) => setQuestion(q.id, (row) => ({ ...row, text: e.target.value }))}
                  />
                  <span className="cb-label">
                    Options <span className="cb-hint">Select the correct answer</span>
                  </span>
                  <Radio.Group
                    className="cb-q-options-edit"
                    value={q.answer}
                    onChange={(e) => setQuestion(q.id, (row) => ({ ...row, answer: e.target.value, aiSuggested: false }))}
                  >
                    {q.options.map((option, n) => (
                      <div key={n} className={`cb-opt-edit ${q.answer === n ? (q.aiSuggested ? "is-suggested" : "is-correct") : ""}`}>
                        <Radio value={n} aria-label={`Option ${letter(n)} is correct`}>
                          {letter(n)}
                        </Radio>
                        <Input
                          id={`q-opt-${q.id}-${n}`}
                          aria-label={`Option ${letter(n)}`}
                          value={option}
                          onChange={(e) =>
                            setQuestion(q.id, (row) => ({ ...row, options: row.options.map((o, i) => (i === n ? e.target.value : o)) }))
                          }
                        />
                        <Button
                          type="text"
                          size="small"
                          shape="round"
                          icon={<MinusOutlined />}
                          aria-label={`Remove option ${letter(n)}`}
                          disabled={q.options.length <= 2}
                          onClick={() =>
                            setQuestion(q.id, (row) => ({
                              ...row,
                              options: row.options.filter((_, i) => i !== n),
                              answer: row.answer === n ? -1 : row.answer > n ? row.answer - 1 : row.answer,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </Radio.Group>
                  {q.options.length < 6 && (
                    <Button size="small" type="dashed" shape="round" icon={<PlusOutlined />} className="cb-self-start" onClick={() => setQuestion(q.id, (row) => ({ ...row, options: [...row.options, ""] }))}>
                      Add option
                    </Button>
                  )}
                  {showsFeedback(item) && (
                    <div className="cb-field">
                      <label htmlFor={`q-feedback-${q.id}`}>
                        Answer explanation <span className="cb-hint">Shown after an attempt</span>
                      </label>
                      <Input.TextArea
                        id={`q-feedback-${q.id}`}
                        autoSize={{ minRows: 1, maxRows: 5 }}
                        value={q.feedback}
                        placeholder="Why the correct answer is correct"
                        onChange={(e) => setQuestion(q.id, (row) => ({ ...row, feedback: e.target.value }))}
                      />
                    </div>
                  )}
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: "reference",
                        label: `Attach a reference${q.materials?.length ? ` (${q.materials.length})` : " (optional)"} — for questions about a chart, photo or clip`,
                        children: (
                          <Materials
                            key={q.id}
                            materials={q.materials || []}
                            onAdd={(material) => setQuestion(q.id, (row) => ({ ...row, materials: [...(row.materials || []), material] }))}
                            onRemove={(id) => setQuestion(q.id, (row) => ({ ...row, materials: (row.materials || []).filter((m) => m.id !== id) }))}
                          />
                        ),
                      },
                    ]}
                  />
                  <div className="cb-q-actions">
                    <Tooltip title="Move up"><Button size="small" shape="round" icon={<ArrowUpOutlined />} aria-label="Move question up" disabled={index === 0} onClick={() => move(q.id, -1)} /></Tooltip>
                    <Tooltip title="Move down"><Button size="small" shape="round" icon={<ArrowDownOutlined />} aria-label="Move question down" disabled={index === item.questions.length - 1} onClick={() => move(q.id, 1)} /></Tooltip>
                    <Tooltip title="Duplicate">
                      <Button
                        size="small"
                        shape="round"
                        icon={<CopyOutlined />}
                        aria-label="Duplicate question"
                        onClick={() => {
                          const copy = { ...q, id: uid() };
                          update((current) => {
                            const rows = [...current.questions];
                            rows.splice(rows.findIndex((row) => row.id === q.id) + 1, 0, copy);
                            return { ...current, questions: rows };
                          });
                          onQuestion(copy.id);
                        }}
                      />
                    </Tooltip>
                    <Button
                      size="small"
                      shape="round"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        modal.confirm({
                          title: "Delete this question?",
                          okText: "Delete",
                          okButtonProps: { danger: true },
                          onOk: () => {
                            update((current) => ({ ...current, questions: current.questions.filter((row) => row.id !== q.id) }));
                            onQuestion(undefined);
                          },
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="cb-q-options">
                    {q.options.map((option, n) => (
                      <button
                        key={n}
                        type="button"
                        className={`cb-opt ${q.answer === n ? (q.aiSuggested ? "is-suggested" : "is-correct") : ""}`}
                        aria-pressed={q.answer === n}
                        title="Mark as the correct answer"
                        onClick={() => setQuestion(q.id, (row) => ({ ...row, answer: n, aiSuggested: false }))}
                      >
                        <b>{letter(n)}</b>
                        <span>{option || <span className="cb-muted">Empty option</span>}</span>
                      </button>
                    ))}
                  </div>
                  {q.aiSuggested && q.answer >= 0 ? (
                    <div className="cb-q-foot">
                      <Tag className="cb-tag-ai">
                        <AiMark /> AI-suggested answer: {letter(q.answer)}
                      </Tag>
                      <Button size="small" type="primary" shape="round" onClick={() => setQuestion(q.id, (row) => ({ ...row, aiSuggested: false }))}>
                        Confirm
                      </Button>
                      <span className="cb-muted">or click the right option</span>
                    </div>
                  ) : problems.length ? (
                    <div className="cb-q-foot">
                      <Tag color="warning">{problems.join(" · ")}</Tag>
                    </div>
                  ) : null}
                </>
              )}
            </article>
          );
        })}
      </div>

      {item.questions.length ? (
        <Button
          type="dashed"
          shape="round"
          icon={<PlusOutlined />}
          className="cb-self-start"
          onClick={() => {
            const next = newQuestion();
            update((current) => ({ ...current, questions: [...current.questions, next] }));
            onQuestion(next.id);
          }}
        >
          Write a question yourself
        </Button>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No questions yet. Generate a first set from the lessons above, or write one yourself."
        >
          <Button
            shape="round"
            icon={<PlusOutlined />}
            onClick={() => {
              const next = newQuestion();
              update((current) => ({ ...current, questions: [...current.questions, next] }));
              onQuestion(next.id);
            }}
          >
            Write a question
          </Button>
        </Empty>
      )}
    </>
  );
}
