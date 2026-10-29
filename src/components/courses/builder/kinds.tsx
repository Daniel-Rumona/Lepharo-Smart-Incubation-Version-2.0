import React from "react";
import {
  FormOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
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
    // Quizzes and tests start with the standard instructions; authors change them if they need to.
    content: kind === "quiz" || kind === "test" ? STANDARD_INSTRUCTIONS : "",
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

