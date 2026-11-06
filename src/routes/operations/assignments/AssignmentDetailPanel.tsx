import type { ReactNode } from "react";
import { Button, Progress, Tag, Typography } from "antd";
import {
    ArrowLeftOutlined,
    CheckCircleFilled,
    ClockCircleFilled,
    EnvironmentOutlined,
    ExclamationCircleFilled,
    MinusCircleFilled,
    PhoneOutlined,
    RightOutlined,
    SyncOutlined,
    VideoCameraOutlined,
} from "@ant-design/icons";
import { motion, useReducedMotion } from "framer-motion";

const { Text, Title } = Typography;
const SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;
const BORDER = "1px solid rgba(128,128,128,0.28)";
const pill = { borderRadius: 999, marginInlineEnd: 0 } as const;

export type DetailHistoryRow = {
    key: string;
    statusLabel: string;
    statusColor: string;
    cycle: string;
    grouped: boolean;
    assignee: string;
    subIntervention: string;
    assignedDate: string;
    dueDate: string;
    completedDate: string;
    progress: number;
    hasRejection: boolean;
    onViewReason?: () => void;
    /** The raw assignment record, used for the cycle timeline and details. */
    raw: any;
};

export type DetailCount = { key: string; label: string; value: number; color: string };

export type AssignmentDetailProps = {
    title: string;
    deliverable?: string;
    isUnassigned: boolean;
    unassignedReason?: string;
    statusLabel: string;
    statusColor: string;
    actionRequired?: string;
    progress: number;
    counts: DetailCount[];
    history: DetailHistoryRow[];
    actions?: ReactNode;
    onBack: () => void;
    onSelectCycle: (key: string) => void;
};

/* ------------------------------------------------------------------ helpers */

const toDate = (value: any): Date | null => {
    if (!value) return null;
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};
const formatDate = (date?: Date | null) =>
    date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatTime = (date?: Date | null) =>
    date ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
const text = (value: any) => String(value ?? "").trim();
const norm = (value: any) => text(value).toLowerCase();

const toneOf = (row: DetailHistoryRow) =>
    row.statusLabel === "Completed"
        ? "#52c41a"
        : row.statusLabel === "Needs Reassignment" || row.hasRejection
            ? "#ff4d4f"
            : row.progress > 0
                ? "#1677ff"
                : "#faad14";

const BackButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <Button shape="round" icon={<ArrowLeftOutlined />} onClick={onClick}>
        {label}
    </Button>
);

const Enter = ({ children, reduced }: { children: ReactNode; reduced: boolean | null }) => (
    <motion.div
        initial={reduced ? false : { opacity: 0, x: 32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? undefined : { opacity: 0, x: 32 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
    >
        {children}
    </motion.div>
);

/* ------------------------------------------------- level 1: cycle cards */

export default function AssignmentDetailPanel(props: AssignmentDetailProps) {
    const reduced = useReducedMotion();
    // Newest cycle first.
    const cards = [...props.history].reverse();
    const waiting = /await|pending/i;
    // The status tag already says it; only add the action tag when it adds something.
    const showAction = !!props.actionRequired && !(waiting.test(props.statusLabel) && waiting.test(props.actionRequired));
    const total = props.counts.find((count) => count.key === "total")?.value || 0;
    // With a single cycle the counts only repeat the status.
    const showCounts = total > 1;

    return (
        <Enter reduced={reduced}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <BackButton label="All interventions" onClick={props.onBack} />
                <Title level={5} style={{ margin: 0 }}>Assignment history</Title>
                {props.actions ? <div style={{ marginLeft: "auto" }}>{props.actions}</div> : null}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                    <Title level={4} style={{ margin: "0 6px 0 0", minWidth: 0 }}>{props.title}</Title>
                    <Tag bordered color={props.statusColor} style={pill}>{props.statusLabel}</Tag>
                    {showAction ? <Tag bordered color="red" style={pill}>{props.actionRequired}</Tag> : null}
                    {props.deliverable ? <Tag bordered color="blue" style={pill}>{props.deliverable}</Tag> : null}
                    {showCounts
                        ? props.counts.map((count) => (
                            <Tag key={count.key} bordered color={count.color} style={pill}>
                                {count.label}: {count.value}
                            </Tag>
                        ))
                        : null}
                </div>
                <Text type="secondary">Progress {props.progress}%</Text>
            </div>
            <Progress
                percent={props.progress}
                status={props.statusLabel === "Completed" ? "success" : "active"}
                showInfo={false}
            />

            {props.isUnassigned ? (
                <Text type="secondary">{props.unassignedReason || "Not assigned."}</Text>
            ) : null}

            {cards.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
                    {cards.map((row, index) => (
                        <motion.button
                            key={row.key}
                            type="button"
                            onClick={() => props.onSelectCycle(row.key)}
                            initial={reduced ? false : { opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            whileHover={reduced ? undefined : { y: -1 }}
                            transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 8) * 0.04 }}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                cursor: "pointer",
                                background: "transparent",
                                color: "inherit",
                                font: "inherit",
                                border: `1px solid ${toneOf(row)}`,
                                borderRadius: 10,
                                padding: "8px 12px",
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                flexWrap: "wrap",
                            }}
                        >
                            <Text strong ellipsis style={{ minWidth: 0, maxWidth: 200 }}>{row.assignee}</Text>
                            {cards.length > 1 ? <Tag bordered color={row.statusColor} style={pill}>{row.statusLabel}</Tag> : null}
                            <Tag bordered style={pill}>Cycle: {row.cycle}</Tag>
                            <Tag bordered color={row.grouped ? "purple" : "geekblue"} style={pill}>{row.grouped ? "Grouped" : "Single"}</Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>Assigned {row.assignedDate}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>Due {row.dueDate}</Text>
                            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                                <Progress percent={row.progress} size="small" style={{ margin: 0, width: 110 }} />
                                <RightOutlined style={{ opacity: 0.45, fontSize: 12 }} />
                            </span>
                        </motion.button>
                    ))}
                </div>
            ) : (
                <div style={{ marginTop: 16 }}><Text type="secondary">No assignment history.</Text></div>
            )}
        </Enter>
    );
}

/* ----------------------------------------------- level 2: one cycle */

type EntryState = "done" | "active" | "upcoming" | "late";
type TimelineEntry = { key: string; title: string; subtitle?: string; date?: Date | null; state: EntryState };

const ICON: Record<EntryState, ReactNode> = {
    done: <CheckCircleFilled />,
    active: <SyncOutlined />,
    upcoming: <ClockCircleFilled />,
    late: <ExclamationCircleFilled />,
};
const TONE: Record<EntryState, string> = { done: "#52c41a", active: "#1677ff", upcoming: "#8c8c8c", late: "#ff4d4f" };

const APPOINTMENT_STATUS: Record<string, { label: string; color: string }> = {
    pending: { label: "Awaiting SME", color: "gold" },
    accepted: { label: "Accepted", color: "blue" },
    completed: { label: "Completed", color: "green" },
    cancelled: { label: "Cancelled", color: "red" },
};
const MEETING_ICON: Record<string, ReactNode> = {
    telephonic: <PhoneOutlined />,
    online: <VideoCameraOutlined />,
    in_person: <EnvironmentOutlined />,
};
const MEETING_LABEL: Record<string, string> = { telephonic: "Phone call", online: "Online meeting", in_person: "In person" };

export type CycleDetailProps = {
    title: string;
    row: DetailHistoryRow;
    appointments: any[];
    onBack: () => void;
};

const buildTimeline = (row: DetailHistoryRow, workStart: Date | null): TimelineEntry[] => {
    const raw = row.raw || {};
    const now = new Date();
    const entries: TimelineEntry[] = [
        {
            key: "assigned",
            title: "Assigned",
            subtitle: `To ${row.assignee} (${norm(raw.deliveryActorType) === "agent" ? "agent" : "facilitator"})`,
            date: toDate(raw.assignedAt) || toDate(raw.createdAt),
            state: "done",
        },
    ];
    const status = row.statusLabel;
    if (workStart) {
        entries.push({ key: "start", title: "Work started", date: workStart, state: workStart.getTime() <= now.getTime() ? "done" : "upcoming" });
    }
    if (row.hasRejection) {
        entries.push({ key: "rejected", title: "Declined by the SME", date: toDate(raw.updatedAt), state: "late" });
        return entries;
    }
    if (status === "Needs Reassignment") {
        entries.push({ key: "reassign", title: "Needs reassignment", date: toDate(raw.updatedAt), state: "late" });
        return entries;
    }
    const completedAt = toDate(raw.completedAt) || toDate(raw.completionConfirmedAt);
    if (status === "Completed") {
        entries.push({ key: "delivered", title: "Delivered", date: completedAt || toDate(raw.updatedAt), state: "done" });
        entries.push({ key: "confirmed", title: "Confirmed by the SME", date: completedAt || toDate(raw.updatedAt), state: "done" });
        return entries;
    }
    if (row.progress > 0) {
        entries.push({ key: "progress", title: "In progress", subtitle: `${row.progress}% complete`, date: toDate(raw.updatedAt), state: "active" });
    }
    const due = toDate(raw.dueDate);
    if (due) {
        const late = due.getTime() < now.getTime();
        entries.push({ key: "due", title: late ? "Overdue" : "Due", date: due, state: late ? "late" : "upcoming" });
    }
    return entries;
};

export function CycleDetailPanel({ title, row, appointments, onBack }: CycleDetailProps) {
    const reduced = useReducedMotion();
    const raw = row.raw || {};
    const sorted = [...appointments].sort((a, b) => (toDate(a.startTime)?.getTime() || 0) - (toDate(b.startTime)?.getTime() || 0));
    const firstHeld = sorted.find((a) => norm(a.status) === "completed");
    const workStart =
        toDate(raw.implementationDate) ||
        toDate(raw.startedAt) ||
        toDate(raw.workStartedAt) ||
        (firstHeld ? toDate(firstHeld.startTime) : null);
    const timeline = buildTimeline(row, workStart);
    const held = sorted.filter((a) => norm(a.status) === "completed").length;
    const hours = Number(raw.timeSpent) || 0;

    const allDetails: Array<[string, string]> = [
        ["Assignee", row.assignee],
        ["Cycle", row.cycle],
        ["Assigned", row.assignedDate],
        ["Work started", formatDate(workStart)],
        ["Due date", row.dueDate],
        ["Completed", row.completedDate],
        ["Sub-intervention", row.subIntervention],
        ["Target", raw.targetMetric ? `${Number(raw.targetActual) || 0} / ${Number(raw.targetValue) || 0} ${text(raw.targetMetric)}` : "—"],
        ["Time spent", hours ? `${hours} h` : "—"],
        ["Sessions held", String(held)],
        ["Notes", text(raw.notes) || "—"],
    ];

    // Only show rows that have a value.
    const isEmpty = (value: string) => !value || value === "—" || value === "0" || value === "No sub-intervention";
    const details = allDetails.filter(([label, value]) => label === "Assignee" || !isEmpty(value));

    return (
        <Enter reduced={reduced}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <BackButton label="Assignment history" onClick={onBack} />
                <Title level={5} style={{ margin: 0 }}>{title}</Title>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                    <Title level={4} style={{ margin: "0 6px 0 0" }}>{row.assignee}</Title>
                    <Tag bordered color={row.statusColor} style={pill}>{row.statusLabel}</Tag>
                    <Tag bordered style={pill}>Cycle: {row.cycle}</Tag>
                    <Tag bordered color={row.grouped ? "purple" : "geekblue"} style={pill}>{row.grouped ? "Grouped" : "Single"}</Tag>
                    {row.hasRejection && row.onViewReason ? (
                        <Button size="small" shape="round" onClick={row.onViewReason}>View reason</Button>
                    ) : null}
                </div>
                <Text type="secondary">Progress {row.progress}%</Text>
            </div>
            <Progress percent={row.progress} status={row.statusLabel === "Completed" ? "success" : "active"} showInfo={false} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, alignItems: "start", marginTop: 12 }}>
                <section>
                    <Title level={5}>Timeline</Title>
                    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {timeline.map((entry, index) => (
                            <motion.li
                                key={entry.key}
                                initial={reduced ? false : { opacity: 0, x: -12 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 10) * 0.05 }}
                                style={{ display: "flex", gap: 12, position: "relative", paddingBottom: 16 }}
                            >
                                {index < timeline.length - 1 ? (
                                    <span style={{ position: "absolute", left: 9, top: 22, bottom: 0, width: 2, background: "rgba(128,128,128,0.25)" }} />
                                ) : null}
                                <span style={{ color: TONE[entry.state], fontSize: 20, lineHeight: 1, marginTop: 2, flexShrink: 0 }}>
                                    {entry.state === "upcoming" ? <MinusCircleFilled /> : ICON[entry.state]}
                                </span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                                        <Text strong>{entry.title}</Text>
                                        {entry.date ? <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(entry.date)}</Text> : null}
                                    </div>
                                    {entry.subtitle ? <Text type="secondary" style={{ fontSize: 12 }}>{entry.subtitle}</Text> : null}
                                </div>
                            </motion.li>
                        ))}
                    </ol>
                </section>

                <section>
                    <Title level={5}>Details</Title>
                    <dl style={{ margin: 0, display: "grid", gap: 10 }}>
                        {details.map(([label, value]) => (
                            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(128,128,128,0.18)", paddingBottom: 8 }}>
                                <dt style={{ color: "rgba(128,128,128,0.95)" }}>{label}</dt>
                                <dd style={{ margin: 0, textAlign: "right", fontWeight: 500 }}>{value || "—"}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            </div>

            <section style={{ marginTop: 8 }}>
                <Title level={5}>Appointments <Tag bordered style={pill}>{sorted.length}</Tag></Title>
                {sorted.length ? (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                        {sorted.map((appointment, index) => {
                            const start = toDate(appointment.startTime);
                            const end = toDate(appointment.endTime);
                            const status = APPOINTMENT_STATUS[norm(appointment.status)] || { label: text(appointment.status) || "Unknown", color: "default" };
                            const kind = norm(appointment.meetingType);
                            const where = kind === "online" ? text(appointment.meetingLink) : kind === "in_person" ? text(appointment.location) : "";
                            const summary = text(appointment.discussionSummary);
                            return (
                                <motion.li
                                    key={text(appointment.id) || index}
                                    initial={reduced ? false : { opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 8) * 0.04 }}
                                    style={{ display: "flex", gap: 12, border: BORDER, borderRadius: 10, padding: "10px 14px" }}
                                >
                                    <span style={{ fontSize: 18, opacity: 0.7, marginTop: 2 }}>{MEETING_ICON[kind] || <ClockCircleFilled />}</span>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            <Text strong>
                                                {formatDate(start)}
                                                {start ? ` · ${formatTime(start)}${end ? `–${formatTime(end)}` : ""}` : ""}
                                            </Text>
                                            <Tag bordered color={status.color} style={pill}>{status.label}</Tag>
                                        </div>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {[MEETING_LABEL[kind] || "Meeting", where].filter(Boolean).join(" · ")}
                                        </Text>
                                        {summary ? <div><Text style={{ fontSize: 13 }}>{summary}</Text></div> : null}
                                    </div>
                                </motion.li>
                            );
                        })}
                    </ul>
                ) : (
                    <Text type="secondary">No appointments booked for this cycle.</Text>
                )}
            </section>
        </Enter>
    );
}
