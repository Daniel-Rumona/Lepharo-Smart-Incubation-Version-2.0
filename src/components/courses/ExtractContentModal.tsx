import React, { useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  theme,
} from "antd";
import { CheckCircleOutlined, InboxOutlined } from "@ant-design/icons";
import {
  COURSE_DOCUMENT_ACCEPT,
  MAX_COURSE_DOCUMENT_BYTES,
  extractCourseContent,
  isExtractableKind,
  type CourseExtractionResult,
} from "@/services/courseContentExtractionService";
import type { Item } from "./courseStorage";

const joinText = (current = "", next = "") =>
  [current.trim(), next.trim()].filter(Boolean).join("\n\n");

export default function ExtractContentModal({
  item,
  open,
  onClose,
  onApply,
}: {
  item?: Item;
  open: boolean;
  onClose: () => void;
  onApply: (changes: Partial<Item>) => void;
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [file, setFile] = useState<File>();
  const [analysing, setAnalysing] = useState(false);
  const [result, setResult] = useState<CourseExtractionResult>();
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [replace, setReplace] = useState(false);
  const [useTitle, setUseTitle] = useState(true);
  const kind = item?.kind || "lesson";
  const quiz = kind === "quiz" || kind === "test";
  const hasExisting = !!(
    item &&
    (item.content.trim() ||
      (!quiz && item.objective?.trim()) ||
      item.rubric?.trim() ||
      item.questions.length)
  );

  const reset = () => {
    setFile(undefined);
    setResult(undefined);
    setError("");
    setSkipped(new Set());
    setReplace(false);
    setUseTitle(true);
  };
  const close = () => {
    if (analysing) return;
    reset();
    onClose();
  };
  const analyse = async (target: File) => {
    if (!isExtractableKind(kind)) return;
    setAnalysing(true);
    setError("");
    setResult(undefined);
    setSkipped(new Set());
    try {
      setResult(await extractCourseContent(target, kind));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not extract content from this document."
      );
    } finally {
      setAnalysing(false);
    }
  };
  const questions = (result?.questions || []).filter((_, i) => !skipped.has(i));
  const apply = () => {
    if (!item || !result) return;
    const pick = (current = "", next = "") =>
      !next.trim() ? current : replace ? next : joinText(current, next);
    const changes: Partial<Item> = {
      content: pick(item.content, result.content),
    };
    if (!quiz && (replace || !item.objective?.trim()))
      changes.objective = result.objective || item.objective;
    if (useTitle && result.title) changes.title = result.title;
    if (kind === "lesson" && result.minutes && (replace || !hasExisting))
      changes.minutes = result.minutes;
    if (kind === "assignment") {
      changes.rubric = pick(item.rubric, result.rubric);
      if (result.submissionType && (replace || !hasExisting))
        changes.submissionType = result.submissionType;
    }
    if (quiz) {
      const added = questions.map((q) => ({
        id: crypto.randomUUID(),
        text: q.text,
        options: q.options,
        answer: q.answer,
        feedback: q.feedback,
        materials: [],
      }));
      changes.questions = replace ? added : [...item.questions, ...added];
    }
    onApply(changes);
    message.success(
      quiz
        ? `${questions.length} question${
            questions.length === 1 ? "" : "s"
          } added.`
        : "Content added from the document."
    );
    reset();
    onClose();
  };

  return (
    <Modal
      className="academy-modal"
      title="Extract content with AI"
      open={open}
      width={760}
      maskClosable={!analysing}
      destroyOnClose
      onCancel={close}
      footer={
        <div className="course-footer">
          <Button onClick={close} disabled={analysing}>
            Cancel
          </Button>
          <Button
            type="primary"
            disabled={!result || (quiz && !questions.length)}
            onClick={apply}
          >
            {quiz
              ? `Add ${questions.length} question${
                  questions.length === 1 ? "" : "s"
                }`
              : "Use this content"}
          </Button>
        </div>
      }
    >
      <Space
        direction="vertical"
        size={14}
        style={
          {
            width: "100%",
            "--course-border": token.colorBorder,
            "--course-selected": token.colorPrimaryBg,
            "--course-primary": token.colorPrimary,
          } as React.CSSProperties
        }
      >
        <Upload.Dragger
          accept={COURSE_DOCUMENT_ACCEPT}
          multiple={false}
          maxCount={1}
          disabled={analysing}
          showUploadList={false}
          beforeUpload={(selected) => {
            if (selected.size > MAX_COURSE_DOCUMENT_BYTES) {
              message.error(
                `Choose a file under ${
                  MAX_COURSE_DOCUMENT_BYTES / (1024 * 1024)
                } MB.`
              );
              return Upload.LIST_IGNORE;
            }
            setFile(selected);
            void analyse(selected);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {file
              ? file.name
              : `Drop a document to build this ${
                  kind === "test" ? "test" : kind
                }`}
          </p>
          <p className="ant-upload-hint">
            PDF, Word (.docx), PowerPoint (.pptx), image or text · up to{" "}
            {MAX_COURSE_DOCUMENT_BYTES / (1024 * 1024)} MB
          </p>
        </Upload.Dragger>
        {analysing && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <Spin />
            <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
              Reading the document…
            </Typography.Paragraph>
          </div>
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            message="Extraction failed"
            description={error}
            action={
              file && (
                <Button size="small" onClick={() => void analyse(file)}>
                  Retry
                </Button>
              )
            }
          />
        )}
        {result && (
          <>
            {result.warnings.map((warning) => (
              <Alert key={warning} type="warning" showIcon message={warning} />
            ))}
            <Space wrap size={[16, 8]}>
              {result.title && (
                <Checkbox
                  checked={useTitle}
                  onChange={(e) => setUseTitle(e.target.checked)}
                >
                  Use title “{result.title}”
                </Checkbox>
              )}
              {hasExisting && (
                <Radio.Group
                  value={replace ? "replace" : "append"}
                  onChange={(e) => setReplace(e.target.value === "replace")}
                >
                  <Radio value="append">Add to existing</Radio>
                  <Radio value="replace">Replace existing</Radio>
                </Radio.Group>
              )}
            </Space>
            {!quiz && result.objective && (
              <ExtractPreview label="Learning objective">
                {result.objective}
              </ExtractPreview>
            )}
            {result.content && (
              <ExtractPreview
                label={
                  kind === "lesson"
                    ? "Lesson content"
                    : kind === "assignment"
                    ? "Task brief"
                    : "Instructions"
                }
                extra={
                  result.minutes ? `≈ ${result.minutes} min read` : undefined
                }
              >
                {result.content}
              </ExtractPreview>
            )}
            {result.rubric && (
              <ExtractPreview label="Marking criteria">
                {result.rubric}
              </ExtractPreview>
            )}
            {quiz && (
              <div className="course-extract-questions">
                <Typography.Text strong>
                  Questions ({questions.length} of {result.questions.length}{" "}
                  selected)
                </Typography.Text>
                {result.questions.map((question, index) => (
                  <label key={index} className="course-extract-question">
                    <Checkbox
                      checked={!skipped.has(index)}
                      onChange={() =>
                        setSkipped((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                    />
                    <div>
                      <Typography.Text delete={skipped.has(index)}>
                        {index + 1}. {question.text}
                      </Typography.Text>
                      <div className="course-extract-options">
                        {question.options.map((option, n) => (
                          <Tag
                            key={n}
                            color={n === question.answer ? "green" : undefined}
                            icon={
                              n === question.answer ? (
                                <CheckCircleOutlined />
                              ) : undefined
                            }
                          >
                            {String.fromCharCode(65 + n)}. {option}
                          </Tag>
                        ))}
                        {question.answer < 0 && (
                          <Tag color="warning">No answer marked</Tag>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </Space>
    </Modal>
  );
}

function ExtractPreview({
  label,
  extra,
  children,
}: {
  label: string;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="course-extract-preview">
      <div className="course-extract-preview-head">
        <Typography.Text strong>{label}</Typography.Text>
        {extra && <Typography.Text type="secondary">{extra}</Typography.Text>}
      </div>
      <div className="course-extract-preview-body">{children}</div>
    </div>
  );
}
