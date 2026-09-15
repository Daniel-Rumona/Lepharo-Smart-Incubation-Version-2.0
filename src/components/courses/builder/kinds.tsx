import React from "react";
import { theme } from "antd";
import {
  FormOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useColorMode } from "@/contexts/ThemeContext";
import type { Item, Kind, Question } from "../courseStorage";

export const uid = () => crypto.randomUUID();

export const kinds: {
  kind: Kind;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    kind: "lesson",
    label: "Lesson",
    icon: <ReadOutlined />,
    description: "Teach a concept with content and supporting media.",
  },
  {
    kind: "assignment",
    label: "Assignment",
    icon: <FormOutlined />,
    description: "Set a task, submission requirements and marking criteria.",
  },
  {
    kind: "quiz",
    label: "Quiz",
    icon: <QuestionCircleOutlined />,
    description: "Multiple-choice practice with explanations.",
  },
  {
    kind: "test",
    label: "Test",
    icon: <SafetyCertificateOutlined />,
    description: "Assess knowledge with attempts, pass marks and a time limit.",
  },
  {
    kind: "interactive",
    label: "AI learning",
    icon: <RobotOutlined />,
    description: "Guided practice with an AI coach and a reflection.",
  },
];
export const kindOf = (kind: Kind) => kinds.find((k) => k.kind === kind)!;

export const KindIcon = ({ kind }: { kind: Kind }) => (
  <span className={`cb-kind cb-kind-${kind}`} aria-hidden="true">
    {kindOf(kind).icon}
  </span>
);

export const STANDARD_INSTRUCTIONS =
  "Answer every question. You can move back and forth before you submit.";

export function newItem(kind: Kind, moduleId: string, title?: string): Item {
  return {
    id: uid(),
    moduleId,
    kind,
    title: title || `New ${kindOf(kind).label.toLowerCase()}`,
    objective: "",
    content: "",
    minutes: kind === "assignment" ? 45 : kind === "test" ? 20 : 10,
    required: true,
    passMark: 70,
    questions: [],
    welcome: "Welcome! What would you like to practise?",
    materials: [],
    submissionType: "either",
    rubric: "",
    attempts: kind === "test" ? 1 : 3,
    scorePolicy: "best",
    timeLimit: 0,
    knowledge: "",
    minTurns: 3,
    reflectionPrompt: "",
  };
}

export const newQuestion = (): Question => ({
  id: uid(),
  text: "",
  options: ["", "", "", ""],
  answer: -1,
  feedback: "",
  materials: [],
});

/**
 * The builder's CSS reads these variables, so every colour comes from the
 * app's antd theme (src/config/antdTheme.ts) and follows light/dark mode.
 */
export function useBuilderVars(): React.CSSProperties {
  const { token } = theme.useToken();
  const { isDark } = useColorMode();
  const ai = isDark ? "#b37feb" : "#722ed1";
  return {
    "--cb-bg": token.colorBgLayout,
    "--cb-surface": token.colorBgContainer,
    "--cb-elevated": token.colorBgElevated,
    "--cb-line": token.colorBorderSecondary,
    "--cb-line-strong": token.colorBorder,
    "--cb-fill": token.colorFillTertiary,
    "--cb-ink": token.colorText,
    "--cb-ink-2": token.colorTextSecondary,
    "--cb-muted": token.colorTextTertiary,
    "--cb-primary": token.colorPrimary,
    "--cb-primary-soft": token.colorPrimaryBg,
    "--cb-primary-line": token.colorPrimaryBorder,
    "--cb-ok": token.colorSuccess,
    "--cb-ok-soft": token.colorSuccessBg,
    "--cb-warn": token.colorWarning,
    "--cb-warn-ink": isDark ? token.colorWarning : token.colorWarningText,
    "--cb-warn-soft": token.colorWarningBg,
    "--cb-error": token.colorError,
    "--cb-ai": ai,
    "--cb-ai-soft": `color-mix(in srgb, ${ai} ${isDark ? 16 : 8}%, ${token.colorBgContainer})`,
    "--cb-ai-line": `color-mix(in srgb, ${ai} ${isDark ? 40 : 35}%, ${token.colorBgContainer})`,
    "--cb-lesson": token.colorPrimary,
    "--cb-assignment": isDark ? "#ffa940" : "#fa8c16",
    "--cb-quiz": ai,
    "--cb-test": isDark ? "#ff7875" : "#f5222d",
    "--cb-interactive": isDark ? "#36cfc9" : "#13c2c2",
    "--cb-radius": `${token.borderRadius}px`,
    "--cb-radius-lg": `${token.borderRadiusLG}px`,
    "--cb-shadow": token.boxShadowTertiary,
  } as React.CSSProperties;
}
