import React, { useEffect, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { CheckOutlined } from "@ant-design/icons";

/** The AI mark used on every AI-powered control, so AI help is recognisable at a glance. */
export const AiMark = () => (
  <svg className="cb-ai-mark" viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M8 0l1.7 4.6L14.5 6 9.7 7.6 8 12.3 6.3 7.6 1.5 6l4.8-1.4zM13 10l.8 2.1 2.2.8-2.2.8L13 16l-.8-2.3-2.2-.8 2.2-.8z"
    />
  </svg>
);

/** Reveals `text` one character at a time, like it's being typed. Retypes whenever `text` changes. */
function useTypewriter(text: string, speed = 18) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    setLength(0);
    if (!text) return;
    const id = setInterval(() => {
      setLength((n) => {
        if (n + 1 >= text.length) clearInterval(id);
        return n + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return { shown: text.slice(0, length), done: length >= text.length };
}

/** A line of text that types itself out, with a blinking caret while it's mid-sentence. */
export function Typewriter({ text, speed, className }: { text: string; speed?: number; className?: string }) {
  const { shown, done } = useTypewriter(text, speed);
  return (
    <span className={className}>
      {shown}
      {!done && <span className="cb-caret" aria-hidden="true" />}
    </span>
  );
}

/** Sticky page header: where you are on the left, the page's main actions on the right. */
export function TopBar({ children }: { children: React.ReactNode }) {
  return (
    <header className="cb-topbar">
      <div className="cb-topbar-in">{children}</div>
    </header>
  );
}

export function Crumbs({ trail, current, meta }: { trail: React.ReactNode[]; current: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <nav className="cb-crumbs" aria-label="Breadcrumb">
      {trail.map((part, n) => (
        <React.Fragment key={n}>
          <span className={`cb-crumb ${n < trail.length - 1 ? "cb-hide-sm" : "cb-hide-xs"}`}>{part}</span>
          <span className={`cb-crumb-sep ${n < trail.length - 1 ? "cb-hide-sm" : "cb-hide-xs"}`}>/</span>
        </React.Fragment>
      ))}
      <strong className="cb-crumb-current">{current}</strong>
      {meta && <span className="cb-crumb-meta">{meta}</span>}
    </nav>
  );
}

export type Suggestion = {
  itemId: string;
  field: "content" | "objective" | "rubric";
  title: string;
  loading: boolean;
  text?: string;
  error?: string;
  retry: () => void;
};

/** A proposed AI change the author accepts or discards. Nothing changes until Accept. */
export function SuggestionCard({
  suggestion,
  onAccept,
  onDiscard,
}: {
  suggestion: Suggestion;
  onAccept: (text: string) => void;
  onDiscard: () => void;
}) {
  return (
    <section className="cb-suggest" aria-live="polite">
      <div className="cb-suggest-head">
        <AiMark />
        <span>{suggestion.title}</span>
        {!suggestion.loading && (
          <Button size="small" type="text" shape="round" onClick={suggestion.retry}>
            Try again
          </Button>
        )}
      </div>
      <div className="cb-suggest-body">
        {suggestion.loading ? (
          <div className="cb-suggest-loading">
            <Spin size="small" /> Writing a suggestion…
          </div>
        ) : suggestion.error ? (
          <Alert type="error" showIcon message={suggestion.error} />
        ) : (
          <div className="cb-suggest-text">{suggestion.text}</div>
        )}
      </div>
      <div className="cb-suggest-foot">
        <Button
          type="primary"
          size="small"
          shape="round"
          disabled={suggestion.loading || !!suggestion.error || !suggestion.text}
          onClick={() => suggestion.text && onAccept(suggestion.text)}
        >
          Accept
        </Button>
        <Button size="small" shape="round" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </section>
  );
}

/** A selectable card. `multiple` renders a checkbox mark, otherwise a radio mark. */
export function OptionCard({
  id,
  title,
  hint,
  icon,
  selected,
  multiple = false,
  ai = false,
  size = "slim",
  onSelect,
}: {
  id: string;
  title: string;
  hint: string;
  icon?: React.ReactNode;
  selected: boolean;
  multiple?: boolean;
  ai?: boolean;
  size?: "slim" | "large";
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`cb-choice cb-choice-${size} ${ai ? "is-ai" : ""}`}
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onSelect}
    >
      {icon && <span className="cb-choice-icon">{icon}</span>}
      <span className="cb-choice-text">
        <strong>{title}</strong>
        <span>{hint}</span>
      </span>
      {size === "slim" && (
        <span className={`cb-mark ${multiple ? "is-check" : "is-radio"}`} aria-hidden="true">
          {multiple && <CheckOutlined />}
        </span>
      )}
    </button>
  );
}
