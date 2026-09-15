import React from "react";
import { Button, Dropdown, Input, InputNumber, Segmented, Select, Switch, Tag, Tooltip } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import Materials from "../Materials";
import { type Item, type Material, type SavedCourse, isAssessment, showsFeedback } from "../courseStorage";
import { isExtractableKind } from "@/services/courseContentExtractionService";
import type { AssistAction } from "@/services/courseAiService";
import { KindIcon, STANDARD_INSTRUCTIONS, kindOf } from "./kinds";
import { AiMark, type Suggestion, SuggestionCard } from "./parts";
import type { ItemState } from "./readiness";
import QuestionsTab, { type GenerateOptions } from "./QuestionsTab";

export type EditorTab = "content" | "instructions" | "questions" | "settings";

export type EditorProps = {
  course: SavedCourse;
  item: Item;
  state: ItemState;
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  update: (change: (item: Item) => Item) => void;
  suggestion?: Suggestion;
  onAssist: (action: AssistAction) => void;
  onAcceptSuggestion: (text: string) => void;
  onDiscardSuggestion: () => void;
  drafting: boolean;
  onDraft: () => void;
  generating: boolean;
  onGenerate: (options: GenerateOptions) => void;
  questionId?: string;
  onQuestion: (id?: string) => void;
  onMarkReviewed: () => void;
  onExtract: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export default function ItemEditor(props: EditorProps) {
  const { item, state, tab, onTab, update } = props;
  const patch = (changes: Partial<Item>) => update((current) => ({ ...current, ...changes }));
  const assess = isAssessment(item);
  const tabs: [EditorTab, string, React.ReactNode][] = assess
    ? [
        ["questions", `Questions (${item.questions.length})`, <QuestionCircleOutlined />],
        ["instructions", "Instructions", <InfoCircleOutlined />],
        ["settings", "Settings", <SettingOutlined />],
      ]
    : [
        ["content", "Content", <EditOutlined />],
        ["settings", "Settings", <SettingOutlined />],
      ];
  const active = tabs.some(([key]) => key === tab) ? tab : tabs[0][0];

  return (
    <section className="cb-panel cb-editor" aria-label={`Edit ${item.title}`}>
      <div className="cb-editor-head">
        <KindIcon kind={item.kind} />
        <Input
          id={`item-title-${item.id}`}
          aria-label="Item title"
          variant="borderless"
          className="cb-editor-title"
          value={item.title}
          placeholder={`${kindOf(item.kind).label} title`}
          onChange={(e) => patch({ title: e.target.value })}
        />
        <span className="cb-editor-status">
          {state.status === "ready" ? (
            <Tag color="success">Ready</Tag>
          ) : state.status === "review" ? (
            <>
              <Tag className="cb-tag-ai">AI draft</Tag>
              <Button size="small" shape="round" onClick={props.onMarkReviewed}>
                Mark as reviewed
              </Button>
            </>
          ) : state.status === "drafting" ? (
            <Tag className="cb-tag-ai">AI is drafting…</Tag>
          ) : (
            <Tag color="warning">{state.note}</Tag>
          )}
        </span>
        <Button size="small" shape="round" icon={<EyeOutlined />} onClick={props.onPreview}>
          <span className="cb-hide-xs">Preview</span>
        </Button>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "duplicate", icon: <CopyOutlined />, label: "Duplicate" },
              { key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true },
            ],
            onClick: ({ key }) => (key === "duplicate" ? props.onDuplicate() : props.onDelete()),
          }}
        >
          <Button size="small" type="text" shape="round" icon={<MoreOutlined />} aria-label="More item actions" />
        </Dropdown>
      </div>
      <Segmented
        block
        className="cb-tabs"
        value={active}
        onChange={(value) => onTab(value as EditorTab)}
        options={tabs.map(([key, label, icon]) => ({ label, value: key, icon }))}
      />
      <div className="cb-editor-body">
        {active === "settings" ? (
          <SettingsTab {...props} patch={patch} />
        ) : active === "questions" ? (
          <QuestionsTab
            key={item.id}
            course={props.course}
            item={item}
            update={update}
            generating={props.generating}
            onGenerate={props.onGenerate}
            questionId={props.questionId}
            onQuestion={props.onQuestion}
            onExtract={props.onExtract}
          />
        ) : active === "instructions" ? (
          <InstructionsTab {...props} patch={patch} />
        ) : (
          <ContentTab {...props} patch={patch} />
        )}
      </div>
    </section>
  );
}

type TabProps = EditorProps & { patch: (changes: Partial<Item>) => void };

/** Shows the pending AI suggestion right by the field it's for, instead of a fixed spot that doesn't move with the tab. */
function FieldSuggestion(props: TabProps & { field: Suggestion["field"] }) {
  const { suggestion, field, item, onAcceptSuggestion, onDiscardSuggestion } = props;
  if (!suggestion || suggestion.itemId !== item.id || suggestion.field !== field) return null;
  return <SuggestionCard suggestion={suggestion} onAccept={onAcceptSuggestion} onDiscard={onDiscardSuggestion} />;
}

function WritingBar({ item, text, drafting, onDraft, onAssist, onExtract, suggestion }: TabProps & { text: string }) {
  const busy = drafting || !!suggestion?.loading;
  return (
    <div className="cb-ai-bar" role="toolbar" aria-label="AI writing tools">
      {!text.trim() ? (
        <Button size="small" shape="round" className="cb-btn-ai" icon={<AiMark />} loading={drafting} disabled={busy && !drafting} onClick={onDraft}>
          Draft with AI
        </Button>
      ) : (
        <>
          <Button size="small" shape="round" className="cb-btn-ai" icon={<AiMark />} disabled={busy} onClick={() => onAssist("simplify")}>
            Simplify
          </Button>
          <Button size="small" type="text" shape="round" disabled={busy} onClick={() => onAssist("shorten")}>
            Shorten
          </Button>
          <Button size="small" type="text" shape="round" disabled={busy} onClick={() => onAssist("example")}>
            Add a local example
          </Button>
        </>
      )}
      {isExtractableKind(item.kind) && (
        <>
          <span className="cb-ai-bar-sep" />
          <Button size="small" shape="round" variant="filled" color="default" icon={<FileTextOutlined />} disabled={busy} onClick={onExtract}>
            From a document
          </Button>
        </>
      )}
    </div>
  );
}

function ObjectiveField(props: TabProps) {
  const { item, patch, onAssist, suggestion } = props;
  const empty = !item.objective?.trim();
  return (
    <div className="cb-field">
      <label htmlFor={`objective-${item.id}`}>
        Learning objective <span className="cb-hint">What can the learner do afterwards?</span>
      </label>
      <div className="cb-inline">
        <Input.TextArea
          id={`objective-${item.id}`}
          status={empty ? "warning" : undefined}
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={item.objective}
          placeholder="Learners will be able to…"
          onChange={(e) => patch({ objective: e.target.value })}
        />
        {empty && item.content.trim() && (
          <Button shape="round" className="cb-btn-ai" icon={<AiMark />} disabled={!!suggestion?.loading} onClick={() => onAssist("objective")}>
            Suggest from content
          </Button>
        )}
      </div>
      <FieldSuggestion {...props} field="objective" />
    </div>
  );
}

function ContentTab(props: TabProps) {
  const { item, patch, update, onAssist, suggestion } = props;
  const materials = (
    <div className="cb-field">
      <Materials
        key={item.id}
        materials={item.materials || []}
        onAdd={(material: Material) => update((current) => ({ ...current, materials: [...(current.materials || []), material] }))}
        onRemove={(id) => update((current) => ({ ...current, materials: (current.materials || []).filter((m) => m.id !== id) }))}
      />
    </div>
  );

  if (item.kind === "interactive")
    return (
      <>
        <ObjectiveField {...props} />
        <div className="cb-field">
          <label htmlFor={`coach-${item.id}`}>
            Coaching instructions <span className="cb-hint">How the AI coach should guide the learner</span>
          </label>
          <Input.TextArea id={`coach-${item.id}`} autoSize={{ minRows: 3, maxRows: 12 }} value={item.content} onChange={(e) => patch({ content: e.target.value })} />
        </div>
        <div className="cb-field">
          <label htmlFor={`knowledge-${item.id}`}>
            Approved reference content <span className="cb-hint">The coach only uses facts from here</span>
          </label>
          <Input.TextArea id={`knowledge-${item.id}`} autoSize={{ minRows: 5, maxRows: 18 }} maxLength={20000} showCount value={item.knowledge} onChange={(e) => patch({ knowledge: e.target.value })} />
        </div>
        <div className="cb-two">
          <div className="cb-field">
            <label htmlFor={`welcome-${item.id}`}>Opening message</label>
            <Input.TextArea id={`welcome-${item.id}`} autoSize={{ minRows: 2, maxRows: 5 }} value={item.welcome} onChange={(e) => patch({ welcome: e.target.value })} />
          </div>
          <div className="cb-field">
            <label htmlFor={`reflection-${item.id}`}>Reflection prompt</label>
            <Input.TextArea id={`reflection-${item.id}`} autoSize={{ minRows: 2, maxRows: 5 }} value={item.reflectionPrompt} onChange={(e) => patch({ reflectionPrompt: e.target.value })} />
          </div>
        </div>
        {materials}
      </>
    );

  const assignment = item.kind === "assignment";
  return (
    <>
      <ObjectiveField {...props} />
      <div className="cb-field">
        <label htmlFor={`content-${item.id}`}>{assignment ? "Task brief" : "Lesson content"}</label>
        <WritingBar {...props} text={item.content} />
        <Input.TextArea
          id={`content-${item.id}`}
          className="cb-content-input"
          autoSize={{ minRows: assignment ? 5 : 10, maxRows: 30 }}
          value={item.content}
          placeholder={
            assignment
              ? "What should the learner do, and what exactly do they hand in?"
              : "Write the lesson, or use Draft with AI. Put headings on their own line and start list items with “- ”."
          }
          onChange={(e) => patch({ content: e.target.value })}
        />
        <FieldSuggestion {...props} field="content" />
      </div>
      {assignment && (
        <>
          <div className="cb-field">
            <label htmlFor={`rubric-${item.id}`}>
              Marking criteria <span className="cb-hint">What the facilitator checks before approving</span>
            </label>
            {!item.rubric?.trim() && item.content.trim() && (
              <Button shape="round" className="cb-btn-ai cb-self-start" icon={<AiMark />} disabled={!!suggestion?.loading} onClick={() => onAssist("rubric")}>
                Suggest from the brief
              </Button>
            )}
            <Input.TextArea
              id={`rubric-${item.id}`}
              status={!item.rubric?.trim() ? "warning" : undefined}
              autoSize={{ minRows: 3, maxRows: 12 }}
              value={item.rubric}
              placeholder="- One criterion per line"
              onChange={(e) => patch({ rubric: e.target.value })}
            />
            <FieldSuggestion {...props} field="rubric" />
          </div>
          <div className="cb-field cb-narrow-field">
            <label htmlFor={`submission-${item.id}`}>Learner submits</label>
            <Select
              id={`submission-${item.id}`}
              value={item.submissionType || "either"}
              onChange={(submissionType) => patch({ submissionType })}
              options={[
                { value: "file", label: "A file" },
                { value: "text", label: "A written answer" },
                { value: "either", label: "Either" },
              ]}
            />
          </div>
        </>
      )}
      {materials}
    </>
  );
}

function InstructionsTab(props: TabProps) {
  const { item, patch, onAssist, suggestion } = props;
  return (
    <div className="cb-field">
      <label htmlFor={`instructions-${item.id}`}>
        Instructions for learners <span className="cb-hint">Shown before they start</span>
      </label>
      {!item.content.trim() && (
        <div className="cb-inline-actions">
          <Button shape="round" onClick={() => patch({ content: STANDARD_INSTRUCTIONS })}>Use standard instructions</Button>
          <Button shape="round" className="cb-btn-ai" icon={<AiMark />} disabled={!!suggestion?.loading} onClick={() => onAssist("instructions")}>
            Write with AI
          </Button>
        </div>
      )}
      <Input.TextArea
        id={`instructions-${item.id}`}
        status={!item.content.trim() ? "warning" : undefined}
        autoSize={{ minRows: 2, maxRows: 8 }}
        value={item.content}
        placeholder={STANDARD_INSTRUCTIONS}
        onChange={(e) => patch({ content: e.target.value })}
      />
      <FieldSuggestion {...props} field="content" />
    </div>
  );
}

function SettingsTab({ course, item, patch }: TabProps) {
  const assess = isAssessment(item);
  return (
    <>
      <div className="cb-settings-grid">
        <div className="cb-field">
          <label htmlFor={`module-${item.id}`}>Module</label>
          <Select
            id={`module-${item.id}`}
            value={item.moduleId}
            onChange={(moduleId) => patch({ moduleId })}
            options={(course.modules || []).map((m) => ({ value: m.id, label: m.title || "Untitled module" }))}
          />
        </div>
        <div className="cb-field">
          <label htmlFor={`minutes-${item.id}`}>Estimated minutes</label>
          <InputNumber id={`minutes-${item.id}`} min={1} max={600} value={item.minutes} style={{ width: "100%" }} onChange={(minutes) => patch({ minutes: minutes || 1 })} />
        </div>
        {assess && (
          <div className="cb-field">
            <label htmlFor={`pass-${item.id}`}>Pass mark (%)</label>
            <InputNumber id={`pass-${item.id}`} min={1} max={100} value={item.passMark} style={{ width: "100%" }} onChange={(passMark) => patch({ passMark: passMark || 70 })} />
          </div>
        )}
        {item.kind === "interactive" && (
          <div className="cb-field">
            <label htmlFor={`turns-${item.id}`}>Required coaching exchanges</label>
            <InputNumber id={`turns-${item.id}`} min={1} max={20} value={item.minTurns || 3} style={{ width: "100%" }} onChange={(minTurns) => patch({ minTurns: minTurns || 3 })} />
          </div>
        )}
      </div>
      <div className="cb-switches">
        <div className="cb-switch-row">
          <div>
            <strong>Required to finish the course</strong>
            <small>{item.kind === "lesson" ? "Learners confirm they have studied it." : "Optional items don't block progress."}</small>
          </div>
          <Switch aria-label="Required to finish the course" checked={item.required} onChange={(required) => patch({ required })} />
        </div>
        {assess && (
          <div className="cb-switch-row">
            <div>
              <strong>Show answer explanations</strong>
              <small>{item.kind === "test" ? "Off by default for tests so retries can't reuse them." : "Learners see why after each attempt."}</small>
            </div>
            <Switch aria-label="Show answer explanations" checked={showsFeedback(item)} onChange={(showFeedback) => patch({ showFeedback })} />
          </div>
        )}
      </div>
      {assess && (
        <details className="cb-more">
          <summary>More options</summary>
          <div className="cb-switches">
            <div className="cb-switch-row">
              <div>
                <strong>Attempts allowed</strong>
                <small>Default for {item.kind === "test" ? "tests: 1" : "quizzes: 3"}</small>
              </div>
              <InputNumber aria-label="Attempts allowed" min={1} max={20} value={item.attempts || 1} onChange={(attempts) => patch({ attempts: attempts || 1 })} />
            </div>
            <div className="cb-switch-row">
              <div>
                <strong>Score that counts</strong>
                <small>When more than one attempt is allowed</small>
              </div>
              <Select
                aria-label="Score that counts"
                value={item.scorePolicy || "best"}
                style={{ minWidth: 140 }}
                onChange={(scorePolicy) => patch({ scorePolicy })}
                options={[
                  { value: "best", label: "Best attempt" },
                  { value: "latest", label: "Latest attempt" },
                ]}
              />
            </div>
            <div className="cb-switch-row">
              <div>
                <strong>Time limit</strong>
                <small>Minutes per attempt. 0 means untimed.</small>
              </div>
              <Tooltip title="Enforced by the server">
                <InputNumber aria-label="Time limit in minutes" min={0} max={240} value={item.timeLimit || 0} onChange={(timeLimit) => patch({ timeLimit: timeLimit || 0 })} />
              </Tooltip>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
