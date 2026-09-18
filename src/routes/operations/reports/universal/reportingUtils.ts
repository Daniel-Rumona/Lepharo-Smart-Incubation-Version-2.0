import type { CSSProperties } from "react";
import type Highcharts from "highcharts";
import dayjs, { type Dayjs } from "dayjs";

import type { AssignedIntervention } from "./reportingTypes";

export const cardStyle: CSSProperties = {
    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
    transition: "all 0.3s ease",
    borderRadius: 8,
    border: "1px solid #d6e4ff",
    cursor: "pointer",
    padding: 16,
};

export const REPORT_COLORS = {
    overdue: "#dc2626",
    assigned: "#2563eb",
    pending: "#f59e0b",
    completed: "#16a34a",
};

export const METRIC_ICON_COLORS = {
    reach: { bg: "#eff6ff", color: "#60a5fa" },
    completion: { bg: "#ecfdf5", color: "#34d399" },
    turnaround: { bg: "#fff7ed", color: "#fb923c" },
    feedback: { bg: "#f5f3ff", color: "#a78bfa" },
    overdue: { bg: "#fef2f2", color: "#f87171" },
};

export const visibleDataLabels = (
    format?: string
): Highcharts.DataLabelsOptions => ({
    enabled: true,
    allowOverlap: true,
    crop: false,
    defer: false,
    overflow: "allow" as any,
    ...(format ? { format } : {}),
    style: {
        color: "#111827",
        textOutline: "none",
        fontWeight: "700",
        fontSize: "12px",
    },
});

export const withLabels = <T extends Highcharts.SeriesOptionsType>(
    series: T
): T =>
    ({
        ...series,
        dataLabels: visibleDataLabels(
            (series as any).type === "spline" &&
                (series as any).name === "Completion Rate"
                ? "{y}%"
                : undefined
        ),
    }) as T;

export const tsToDayjs = (
    timestamp?: AssignedIntervention["createdAt"] | null
): Dayjs | null => {
    if (!timestamp) return null;
    if ((timestamp as any)?.toDate) return dayjs((timestamp as any).toDate());
    return null;
};

export const inRangeInclusive = (
    date: Dayjs,
    start: Dayjs,
    end: Dayjs
) =>
    (date.isAfter(start, "day") || date.isSame(start, "day")) &&
    (date.isBefore(end, "day") || date.isSame(end, "day"));

export const completionDate = (row: AssignedIntervention) =>
    tsToDayjs(row.completedAt) || tsToDayjs(row.updatedAt);

export const createdDate = (row: AssignedIntervention) =>
    tsToDayjs(row.createdAt) ||
    tsToDayjs(row.completedAt) ||
    tsToDayjs(row.updatedAt);

export const isCompletedStatus = (row: AssignedIntervention) => {
    const statusCompleted =
        (row.assignmentStatus || "").toLowerCase() === "completed";
    const consultantCompleted =
        (row.assigneeCompletionStatus || "").toLowerCase() === "completed";
    const userConfirmed =
        (row.participantCompletionStatus || "").toLowerCase() === "confirmed";
    const progressDone = (row.computedProgress ?? row.progress ?? 0) >= 100;

    return (
        statusCompleted ||
        (consultantCompleted && userConfirmed) ||
        progressDone
    );
};

export const isReportCompleted = (row: AssignedIntervention) => {
    const statusCompleted =
        (row.status || "").toLowerCase() === "completed";
    const consultantCompleted =
        (row.assigneeCompletionStatus || "").toLowerCase() === "completed";
    const userConfirmed =
        (row.participantCompletionStatus || "").toLowerCase() === "confirmed";
    const progressDone = (row.computedProgress ?? row.progress ?? 0) >= 100;

    return (
        statusCompleted ||
        (consultantCompleted && userConfirmed) ||
        progressDone
    );
};

export const turnaroundDays = (row: AssignedIntervention) => {
    const start = createdDate(row);
    const end = completionDate(row);

    if (!start || !end || !isCompletedStatus(row)) return null;

    return Math.max(
        0,
        end.endOf("day").diff(start.startOf("day"), "day") + 1
    );
};

export const reportLifecycleStatus = (row: AssignedIntervention) => {
    if (isCompletedStatus(row)) return "completed" as const;

    const status = String(
        row.assignmentStatus || row.status || ""
    ).toLowerCase();

    if (
        ["completed", "complete", "done", "confirmed", "closed"].includes(
            status
        )
    ) {
        return "completed" as const;
    }

    if (
        ["declined", "rejected", "cancelled", "canceled"].includes(status)
    ) {
        return "declined" as const;
    }

    if (
        ["in-progress", "in_progress", "active", "ongoing", "accepted"].includes(
            status
        )
    ) {
        return "in-progress" as const;
    }

    return "assigned" as const;
};

export const isOverdueAt = (
    row: AssignedIntervention,
    end: Dayjs
) => {
    if (isCompletedStatus(row)) return false;

    const due = tsToDayjs(row.dueDate);

    return !!due && due.endOf("day").isBefore(end.endOf("day"));
};

export const normalizeText = (
    value?: unknown,
    fallback = "Unspecified"
) => {
    const text = String(value ?? "").trim();
    return text || fallback;
};

export const normalizeConsultantName = (value?: unknown) =>
    normalizeText(value, "Unassigned")
        .replace(/\s+/g, " ")
        .trim();

export const consultantGroupKey = (row: AssignedIntervention) => {
    const id = String(row.assigneeId || "").trim();

    if (id) return `id:${id}`;

    const name = normalizeConsultantName(
        row.assigneeName
    ).toLowerCase();

    const parts = name.split(" ").filter(Boolean);

    if (parts.length >= 2) {
        return `name:${parts[0]}:${parts[parts.length - 1][0]}`;
    }

    return `name:${name}`;
};

export const isPendingLike = (row: AssignedIntervention) => {
    const status = String(row.assignmentStatus || "").toLowerCase();

    return ["assigned", "in_progress", "pending", "accepted"].includes(
        status
    );
};

export const average = (values: number[]) => {
    const nums = values.filter(Number.isFinite);

    if (!nums.length) return 0;

    return (
        Math.round(
            (nums.reduce((sum, value) => sum + value, 0) / nums.length) *
                10
        ) / 10
    );
};
