import React from "react";
import { Space, Tag, Tooltip, Typography } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import type { AttendeeProgress, EligibilityStatus } from "./certification";

export const ELIGIBILITY_META: Record<EligibilityStatus, { color: string; label: string }> = {
  not_started: { color: "default", label: "Not started" },
  in_progress: { color: "processing", label: "In progress" },
  eligible: { color: "gold", label: "Eligible" },
  certified: { color: "green", label: "Certified" },
  revoked: { color: "red", label: "Revoked" },
};

/** Each rule as met or still missing. Colours are inherited so it reads in a tooltip and on a card. */
export function EligibilityChecklist({ eligibility }: { eligibility: AttendeeProgress["eligibility"] }) {
  return (
    <Space direction="vertical" size={2}>
      {eligibility.missing.map((m) => (
        <span key={m}>
          <CloseOutlined /> {m}
        </span>
      ))}
      {eligibility.met.map((m) => (
        <span key={m}>
          <CheckOutlined /> {m}
        </span>
      ))}
      {eligibility.overridden && <span>Marked eligible by Training Academy staff</span>}
    </Space>
  );
}

/** A person's (or company's) certification state, with the rules in a tooltip. */
export function EligibilityTag({ eligibility }: { eligibility?: AttendeeProgress["eligibility"] | null }) {
  if (!eligibility) return <Typography.Text type="secondary">Not evaluated yet</Typography.Text>;
  const meta = ELIGIBILITY_META[eligibility.status] || ELIGIBILITY_META.not_started;
  return (
    <Tooltip title={eligibility.met.length || eligibility.missing.length ? <EligibilityChecklist eligibility={eligibility} /> : "No rules are set"}>
      <Tag color={meta.color}>
        {meta.label}
        {eligibility.overridden && eligibility.status === "eligible" ? " (override)" : ""}
      </Tag>
    </Tooltip>
  );
}
