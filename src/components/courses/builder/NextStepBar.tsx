import React from "react";
import { Button, Progress } from "antd";
import { AiMark } from "./parts";

export type NextStep = {
  title: string;
  label?: string;
  ai?: boolean;
  busy?: boolean;
  run?: () => void;
  secondary?: { label: string; run: () => void };
};

/** One clear thing to do next, plus how close the course is to ready. */
export default function NextStepBar({ step, ready, total }: { step: NextStep; ready: number; total: number }) {
  const percent = total ? Math.round((ready / total) * 100) : 0;
  return (
    <div className="cb-panel cb-nextstep" aria-live="polite">
      <AiMark />
      <div className="cb-nextstep-text">
        <small>Next step</small>
        <strong>{step.title}</strong>
      </div>
      <div className="cb-nextstep-actions">
        {step.secondary && (
          <Button size="small" type="text" shape="round" onClick={step.secondary.run}>
            {step.secondary.label}
          </Button>
        )}
        {step.run && step.label && (
          <Button
            size="small"
            shape="round"
            type={step.ai ? "default" : "primary"}
            className={step.ai ? "cb-btn-ai" : undefined}
            icon={step.ai ? <AiMark /> : undefined}
            loading={step.busy}
            onClick={step.run}
          >
            {step.label}
          </Button>
        )}
      </div>
      <div className="cb-meter">
        <small className="cb-tnum">
          {ready} of {total} items ready
        </small>
        <Progress percent={percent} showInfo={false} size="small" strokeColor="var(--cb-ok)" />
      </div>
    </div>
  );
}
