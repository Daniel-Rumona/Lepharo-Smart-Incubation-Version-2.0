import React, { useEffect, useState } from "react";
import { Empty, Skeleton, Space, Tag, Tooltip, Typography, theme } from "antd";
import dayjs from "dayjs";
import { type RosterEntry, loadSessionRoster } from "./trainingPlan";

const RSVP: Record<string, { color: string; label: string }> = {
  pending: { color: "default", label: "No reply" },
  confirmed: { color: "blue", label: "Confirmed" },
  declined: { color: "red", label: "Declined" },
};

const ATTENDANCE: Record<string, { color: string; label: string }> = {
  expected: { color: "default", label: "Expected" },
  attended: { color: "green", label: "Attended" },
  absent: { color: "orange", label: "Absent" },
  declined: { color: "red", label: "Declined" },
};

const checkedIn = (entry: RosterEntry) => {
  const at = entry.attendance?.checkedInAt as { toDate?: () => Date } | null | undefined;
  return at?.toDate ? dayjs(at.toDate()).format("HH:mm") : null;
};

/**
 * Who from each SME was invited to one booked session and who attended:
 * grouped by company, one line per person. SMEs invited as a single record
 * (before their people were set up) show as one line.
 */
export function TrainingSessionRoster({ appointmentSessionId }: { appointmentSessionId: string }) {
  const { token } = theme.useToken();
  const [entries, setEntries] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadSessionRoster(appointmentSessionId)
      .then((list) => !cancelled && setEntries(list))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load who was invited."));
    return () => {
      cancelled = true;
    };
  }, [appointmentSessionId]);

  if (error) return <Typography.Text type="danger">{error}</Typography.Text>;
  if (!entries) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  if (!entries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No one is invited." />;

  const companies = new Map<string, RosterEntry[]>();
  entries.forEach((e) => companies.set(e.smeId, [...(companies.get(e.smeId) || []), e]));
  const attended = entries.filter((e) => e.attendance?.status === "attended").length;

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {attended} of {entries.length} {entries.length === 1 ? "person" : "people"} attended, from {companies.size} SME{companies.size === 1 ? "" : "s"}
      </Typography.Text>
      {[...companies.values()]
        .sort((a, b) => a[0].smeName.localeCompare(b[0].smeName))
        .map((people) => (
          <div key={people[0].smeId} style={{ padding: "8px 10px", borderRadius: token.borderRadius, background: token.colorFillAlter }}>
            <Typography.Text strong>{people[0].smeName}</Typography.Text>
            <Space direction="vertical" size={4} style={{ width: "100%", marginTop: 4 }}>
              {people
                .sort((a, b) => (a.attendeeName || "").localeCompare(b.attendeeName || ""))
                .map((p) => {
                  const rsvp = RSVP[p.smeConfirmation] || RSVP.pending;
                  const attendance = ATTENDANCE[p.attendance?.status || "expected"] || ATTENDANCE.expected;
                  const time = checkedIn(p);
                  return (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <Space size={6}>
                        <Typography.Text>{p.attendeeName || "Whole SME"}</Typography.Text>
                        {p.attendeeKind === "director" && <Tag color="gold">Director</Tag>}
                      </Space>
                      <Space size={4}>
                        <Tooltip title={p.smeConfirmation === "declined" ? p.smeDeclineReason || undefined : undefined}>
                          <Tag color={rsvp.color}>{rsvp.label}</Tag>
                        </Tooltip>
                        <Tag color={attendance.color}>
                          {attendance.label}
                          {time ? ` ${time}` : ""}
                        </Tag>
                      </Space>
                    </div>
                  );
                })}
            </Space>
          </div>
        ))}
    </Space>
  );
}
