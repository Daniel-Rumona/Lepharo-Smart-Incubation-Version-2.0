import React, { useEffect, useMemo, useState } from "react";
import {
    Card,
    Row,
    Col,
    DatePicker,
    Button,
    Space,
    Spin,
    Empty,
    Segmented,
    Select,
    message,
    Table,
    Tag,
} from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import HighchartsMore from "highcharts/highcharts-more";
import { motion } from "framer-motion";
import dayjs, { Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import {
    DownloadOutlined,
    RiseOutlined,
    TeamOutlined,
    FieldTimeOutlined,
    StarOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import {
    collection,
    getDocs,
    onSnapshot,
    query,
    where,
    Timestamp,
} from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
    DashboardHeaderCard,
    MotionCard,
} from "@/components/dashboards/metrics/Header";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { buildMonthlyReportWithCharts } from "@/utils/buildMonthlyReportWithCharts";
import { exportMonthlyDepartmentReportDocx } from "@/utils/monthlyReportDocx";
// import { AnalyticsAskFab } from "@/components/ai/AnalyticsAskFab";
import { ChartSpecRenderer } from "@/components/ai/ChartSpecRenderer";
import type { ChartSpec } from "@/services/aiAssistantService";
import { CloseOutlined } from "@ant-design/icons";
import ReachAnalytics from "@/components/reports/ReachAnalytics";
import { MilestoneJourneyButton } from "@/components/milestone-journey/MilestoneJourney";
import { filterReportRecords } from "@/utils/reportVisibility";
import { rollupReportAssignments } from "@/utils/reportGroupAssignments";

dayjs.extend(isoWeek);

if (typeof HighchartsMore === "function") HighchartsMore(Highcharts);

const { RangePicker } = DatePicker;
const cardStyle: React.CSSProperties = {
    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
    transition: "all 0.3s ease",
    borderRadius: 8,
    border: "1px solid #d6e4ff",
    cursor: "pointer",
    padding: 16,
};

// ---------- Types ----------
type Status = "Pending" | "Assigned" | "Completed" | "Overdue";

const REPORT_COLORS = {
    overdue: "#dc2626",
    assigned: "#2563eb",
    pending: "#f59e0b",
    completed: "#16a34a",
};

const METRIC_ICON_COLORS = {
    reach: { bg: "#eff6ff", color: "#60a5fa" },
    completion: { bg: "#ecfdf5", color: "#34d399" },
    turnaround: { bg: "#fff7ed", color: "#fb923c" },
    feedback: { bg: "#f5f3ff", color: "#a78bfa" },
    overdue: { bg: "#fef2f2", color: "#f87171" },
};

const visibleDataLabels = (format?: string): Highcharts.DataLabelsOptions => ({
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

const withLabels = <T extends Highcharts.SeriesOptionsType>(series: T): T =>
({
    ...series,
    dataLabels: visibleDataLabels(
        (series as any).type === "spline" &&
            (series as any).name === "Completion Rate"
            ? "{y}%"
            : undefined
    ),
} as T);

interface AssignedIntervention {
    id: string;
    areaOfSupport?: string;
    assigneeId?: string;
    assigneeName?: string;
    assigneeRole?: string;
    completedAt?: Timestamp;
    computedProgress?: number;
    assigneeCompletionStatus?: string;
    assigneeDecisionAt?: Timestamp;
    assigneeAcceptanceStatus?: string;
    createdAt?: Timestamp;
    departmentId?: string;
    dueDate?: Timestamp;
    feedback?: { rating?: number; comments?: string };
    frequency?: string;
    interventionId?: string;
    interventionTitle?: string;
    movDocumentId?: string;
    notes?: string;
    participantId?: string;
    programId?: string;
    progress?: number;
    smmeNo?: string | null;
    status?: string; // 'completed' etc
    target?: any;
    timeSpent?: number;
    tracking?: {
        milestonesDone?: any[];
        documentsUploaded?: any[];
        timeSpentHours?: number;
        sessionsLogged?: number;
    };
    type?: string;
    updatedAt?: Timestamp;
    participantCompletionStatus?: string; // 'confirmed' etc
    participantAcceptanceStatus?: string;
    assignmentStatus?: string;
    groupAssignmentId?: string;
    groupId?: string;
    groupKey?: string;
    reportGroupMembers?: AssignedIntervention[];
}

interface ParticipantProfile {
    id: string;
    name?: string;
    gender?: string;
    idNumber?: string;
    age?: number | string;
    dateOfBirth?: Timestamp | string;
    sector?: string;
    province?: string;
    ward?: string;
    blackOwnedPercent?: number;
    femaleOwnedPercent?: number;
    youthOwnedPercent?: number;
    programId?: string;
}

type DepartmentScopeOption = {
    id: string;
    name: string;
};

// ---------- Helpers ----------
const mapStatus = (raw?: string): Status => {
    const s = (raw || "").toLowerCase();
    if (s === "completed") return "Completed";
    if (s === "assigned" || s === "in_progress" || s === "accepted")
        return "Assigned";
    if (s === "overdue") return "Overdue";
    return "Pending";
};

const tsToDayjs = (t?: Timestamp | null): Dayjs | null => {
    if (!t) return null;
    if ((t as any)?.toDate) return dayjs((t as any).toDate());
    return null;
};

const inRangeInclusive = (d: Dayjs, start: Dayjs, end: Dayjs) => {
    return (
        (d.isAfter(start, "day") || d.isSame(start, "day")) &&
        (d.isBefore(end, "day") || d.isSame(end, "day"))
    );
};

const completionDate = (row: AssignedIntervention) =>
    tsToDayjs(row.completedAt) || tsToDayjs(row.updatedAt);

const createdDate = (row: AssignedIntervention) =>
    tsToDayjs(row.createdAt) ||
    tsToDayjs(row.completedAt) ||
    tsToDayjs(row.updatedAt);

const turnaroundDays = (row: AssignedIntervention) => {
    const start = createdDate(row);
    const end = completionDate(row);
    if (!start || !end || !isCompletedStatus(row)) return null;
    return Math.max(0, end.endOf("day").diff(start.startOf("day"), "day") + 1);
};

const isCompletedStatus = (row: AssignedIntervention) => {
    const statusCompleted =
        (row.assignmentStatus || "").toLowerCase() === "completed";
    const consultantCompleted =
        (row.assigneeCompletionStatus || "").toLowerCase() === "completed";
    const userConfirmed =
        (row.participantCompletionStatus || "").toLowerCase() === "confirmed";
    const progressDone = (row.computedProgress ?? row.progress ?? 0) >= 100;
    return (
        statusCompleted || (consultantCompleted && userConfirmed) || progressDone
    );
};

const reportLifecycleStatus = (row: AssignedIntervention) => {
    if (isCompletedStatus(row)) return "completed" as const;
    const status = String(row.assignmentStatus || row.status || "").toLowerCase();
    if (["completed", "complete", "done", "confirmed", "closed"].includes(status)) {
        return "completed" as const;
    }
    if (["declined", "rejected", "cancelled", "canceled"].includes(status)) {
        return "declined" as const;
    }
    if (["in-progress", "in_progress", "active", "ongoing", "accepted"].includes(status)) {
        return "in-progress" as const;
    }
    return "assigned" as const;
};

const isOverdueAt = (row: AssignedIntervention, end: Dayjs) => {
    if (isCompletedStatus(row)) return false;
    const due = tsToDayjs(row.dueDate);
    return !!due && due.endOf("day").isBefore(end.endOf("day"));
};

const normalizeText = (value?: unknown, fallback = "Unspecified") => {
    const text = String(value ?? "").trim();
    return text || fallback;
};

const normalizeConsultantName = (value?: unknown) =>
    normalizeText(value, "Unassigned").replace(/\s+/g, " ").trim();

const consultantGroupKey = (row: AssignedIntervention) => {
    const id = String(row.assigneeId || "").trim();
    if (id) return `id:${id}`;
    const name = normalizeConsultantName(row.assigneeName).toLowerCase();
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2)
        return `name:${parts[0]}:${parts[parts.length - 1][0]}`;
    return `name:${name}`;
};

const isPendingLike = (row: AssignedIntervention) => {
    const status = String(row.assignmentStatus || "").toLowerCase();
    return ["assigned", "in_progress", "pending", "accepted"].includes(status);
};

const average = (values: number[]) => {
    const nums = values.filter(Number.isFinite);
    if (!nums.length) return 0;
    return (
        Math.round(
            (nums.reduce((sum, value) => sum + value, 0) / nums.length) * 10
        ) / 10
    );
};

// ---------- Interventions Completion Card ----------
interface InterventionsCompletionCardProps {
    filteredRows: AssignedIntervention[];
    allRows: AssignedIntervention[];
    dateRange: [Dayjs, Dayjs];
}

const InterventionsCompletionCard: React.FC<
    InterventionsCompletionCardProps
> = ({ filteredRows, allRows, dateRange }) => {
    const buckets = useMemo(() => {
        const [start, end] = dateRange;
        const days = Math.max(
            1,
            end.startOf("day").diff(start.startOf("day"), "day") + 1
        );
        const output: { key: string; label: string; start: Dayjs; end: Dayjs }[] =
            [];

        if (days <= 10) {
            for (let i = 0; i < days; i += 1) {
                const day = start.add(i, "day");
                output.push({
                    key: day.format("YYYY-MM-DD"),
                    label: day.format("ddd DD"),
                    start: day.startOf("day"),
                    end: day.endOf("day"),
                });
            }
            return output;
        }

        if (days <= 70) {
            let cursor = start.startOf("isoWeek");
            while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
                const bucketStart = cursor.isBefore(start) ? start : cursor;
                const bucketEnd = cursor.endOf("isoWeek").isAfter(end)
                    ? end
                    : cursor.endOf("isoWeek");
                output.push({
                    key: bucketStart.format("YYYY-MM-DD"),
                    label: `${bucketStart.format("ddd DD")} - ${bucketEnd.format(
                        "ddd DD"
                    )}`,
                    start: bucketStart.startOf("day"),
                    end: bucketEnd.endOf("day"),
                });
                cursor = cursor.add(1, "week");
            }
            return output;
        }

        let cursor = start.startOf("month");
        while (cursor.isBefore(end) || cursor.isSame(end, "month")) {
            const bucketStart = cursor.isBefore(start) ? start : cursor;
            const bucketEnd = cursor.endOf("month").isAfter(end)
                ? end
                : cursor.endOf("month");
            output.push({
                key: bucketStart.format("YYYY-MM"),
                label: bucketStart.format("MMM YYYY"),
                start: bucketStart.startOf("day"),
                end: bucketEnd.endOf("day"),
            });
            cursor = cursor.add(1, "month");
        }
        return output;
    }, [dateRange]);

    const bucketCounts = useMemo(() => {
        return buckets.map((bucket) => {
            const counts = { completed: 0, pending: 0, assignments: 0, overdue: 0 };

            allRows.forEach((row) => {
                const created = createdDate(row);
                const completed = completionDate(row);
                if (created && created.isAfter(bucket.end, "day")) return;

                const activeInBucket =
                    !!created &&
                    (created.isBefore(bucket.end, "day") ||
                        created.isSame(bucket.end, "day")) &&
                    (!completed ||
                        completed.isAfter(bucket.start, "day") ||
                        completed.isSame(bucket.start, "day"));

                if (activeInBucket) counts.assignments += 1;
                if (isOverdueAt(row, bucket.end)) counts.overdue += 1;

                if (
                    !isCompletedStatus(row) &&
                    isPendingLike(row) &&
                    activeInBucket &&
                    !isOverdueAt(row, bucket.end)
                ) {
                    counts.pending += 1;
                }

                if (isCompletedStatus(row)) {
                    const completedAt = completionDate(row);
                    if (
                        completedAt &&
                        inRangeInclusive(completedAt, bucket.start, bucket.end)
                    )
                        counts.completed += 1;
                }
            });

            return counts;
        });
    }, [buckets, allRows]);

    const chartOptions: Highcharts.Options = {
        chart: { type: "spline", backgroundColor: "transparent", height: 390 },
        title: {
            text: `Interventions by Period (${dateRange[0].format(
                "ddd DD MMM"
            )} - ${dateRange[1].format("ddd DD MMM")})`,
        },
        credits: { enabled: false },
        xAxis: {
            categories: buckets.map((bucket) => bucket.label),
            labels: { rotation: buckets.length > 8 ? -35 : 0 },
        },
        yAxis: { min: 0, allowDecimals: false, title: { text: "Interventions" } },
        tooltip: { shared: true },
        legend: { align: "center", verticalAlign: "bottom" },
        plotOptions: {
            spline: {
                marker: { enabled: true, radius: 4 },
                dataLabels: visibleDataLabels(),
            },
        },
        series: [
            withLabels({
                type: "spline",
                name: "Overdue",
                data: bucketCounts.map((v) => v.overdue),
                color: REPORT_COLORS.overdue,
            }),
            withLabels({
                type: "spline",
                name: "Assignments",
                data: bucketCounts.map((v) => v.assignments),
                color: REPORT_COLORS.assigned,
            }),
            withLabels({
                type: "spline",
                name: "Pending",
                data: bucketCounts.map((v) => v.pending),
                color: REPORT_COLORS.pending,
            }),
            withLabels({
                type: "spline",
                name: "Completed",
                data: bucketCounts.map((v) => v.completed),
                color: REPORT_COLORS.completed,
            }),
        ],
    };

    return (
        <Col span={12} style={{ marginBottom: 24 }}>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Card style={cardStyle} title="Interventions by Period">
                    {filteredRows.length ? (
                        <HighchartsReact highcharts={Highcharts} options={chartOptions} />
                    ) : (
                        <Empty description="No interventions in this period" />
                    )}
                </Card>
            </motion.div>
        </Col>
    );
};

// ---------- Main Reporting Dashboard ----------
const ReportingDashboard: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity();
    const { activeProgramId, isAllPrograms } = useActiveProgramId();

    const [rows, setRows] = useState<AssignedIntervention[]>([]);
    const [participants, setParticipants] = useState<
        Record<string, ParticipantProfile>
    >({});
    const [loading, setLoading] = useState(true);

    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf("month"),
        dayjs().endOf("month"),
    ]);
    const [preset, setPreset] = useState<"Today" | "This Week" | "This Month">(
        "This Month"
    );
    const [view, setView] = useState<
        "Overview" | "Facilitators" | "Reach" | "Bottlenecks"
    >("Overview");
    const [exporting, setExporting] = useState(false);
    const [aiChart, setAiChart] = useState<ChartSpec | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [participantsLoading, setParticipantsLoading] = useState(true);
    const [childDepartments, setChildDepartments] = useState<
        DepartmentScopeOption[]
    >([]);
    const [departmentScope, setDepartmentScope] = useState<string>("all");

    useEffect(() => {
        let cancelled = false;

        const loadChildren = async () => {
            if (!user?.departmentId) {
                if (!cancelled) setChildDepartments([]);
                return;
            }

            try {
                const snap = await getDocs(
                    query(
                        collection(db, "departments")
                    )
                );
                if (cancelled) return;

                setChildDepartments(
                    snap.docs
                        .map((department) => ({
                            id: department.id,
                            name: String(
                                (department.data() as any).name ||
                                (department.data() as any).departmentName ||
                                (department.data() as any).title ||
                                department.id
                            ).trim(),
                            parentDepartmentId: String(
                                (department.data() as any).parentDepartmentId ||
                                (department.data() as any).parentDeptId ||
                                ""
                            ).trim(),
                        }))
                        .filter((department) => department.parentDepartmentId === user.departmentId)
                        .map(({ id, name }) => ({ id, name }))
                        .sort((a, b) => a.name.localeCompare(b.name))
                );
            } catch (error) {
                console.warn("[ReportingDashboard] failed to load child departments", error);
                if (!cancelled) setChildDepartments([]);
            }
        };

        void loadChildren();
        return () => {
            cancelled = true;
        };
    }, [user?.departmentId]);

    const accessibleDepartmentIds = useMemo(
        () => [
            ...(user?.departmentId ? [String(user.departmentId)] : []),
            ...childDepartments.map((department) => department.id),
        ],
        [childDepartments, user?.departmentId]
    );

    // Firestore query WITH program filter
    useEffect(() => {
        if (identityLoading) return;
        if (!user?.departmentId) {
            setLoading(false);
            return;
        }

        const departmentBatches: string[][] = [];
        for (let index = 0; index < accessibleDepartmentIds.length; index += 10) {
            departmentBatches.push(accessibleDepartmentIds.slice(index, index + 10));
        }
        if (!departmentBatches.length) {
            setRows([]);
            setLoading(false);
            return;
        }

        const rowsByBatch = new Map<number, AssignedIntervention[]>();
        const applyRows = () => {
            const list = filterReportRecords(
                Array.from(rowsByBatch.values()).flat(),
                user?.email
            ) as AssignedIntervention[];

            // Debug: if this prints a lot, your data is missing programId
            const missingProgramId = list.filter((x) => !x.programId).length;
            if (missingProgramId > 0) {
                console.warn(
                    `[ReportingDashboard] ${missingProgramId} docs missing programId. Those will NEVER match a program filter.`
                );
            }

            // sort newest first
            list.sort((a, b) => {
                const ta = tsToDayjs(a.completedAt || a.createdAt)?.valueOf() ?? 0;
                const tb = tsToDayjs(b.completedAt || b.createdAt)?.valueOf() ?? 0;
                return tb - ta;
            });

            setRows(list);
            setLoading(false);
        };

        const unsubs = departmentBatches.map((departmentIds, batchIndex) => {
            const constraints: any[] = [where("departmentId", "in", departmentIds)];
            if (activeProgramId) constraints.push(where("programId", "==", activeProgramId));

            return onSnapshot(
                query(collection(db, "assignedInterventions"), ...constraints),
                (snap) => {
                    rowsByBatch.set(
                        batchIndex,
                        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AssignedIntervention[]
                    );
                    applyRows();
                },
                (err) => {
                    console.error("[ReportingDashboard] error loading interventions", err);
                    setLoading(false);
                }
            );
        });

        return () => unsubs.forEach((unsub) => unsub());
    }, [accessibleDepartmentIds, activeProgramId, identityLoading, user?.departmentId, user?.email]);

    useEffect(() => {
        if (identityLoading) return;

        setParticipantsLoading(true);

        const qParticipants = query(collection(db, "participants"));

        const unsub = onSnapshot(
            qParticipants,
            (snap) => {
                const next: Record<string, ParticipantProfile> = {};

                snap.docs.forEach((docSnap) => {
                    const data = {
                        id: docSnap.id,
                        ...(docSnap.data() as any),
                    } as ParticipantProfile;

                    if (filterReportRecords([data], user?.email).length) next[docSnap.id] = data;
                });

                setParticipants(next);
                setParticipantsLoading(false);
            },
            (err) => {
                console.warn("[ReportingDashboard] error loading participants", err);
                setParticipantsLoading(false);
            }
        );

        return () => unsub();
    }, [identityLoading]);

    const handlePresetChange = (value: "Today" | "This Week" | "This Month") => {
        setPreset(value);
        const today = dayjs();
        if (value === "Today")
            setDateRange([today.startOf("day"), today.endOf("day")]);
        if (value === "This Week")
            setDateRange([today.startOf("isoWeek"), today.endOf("isoWeek")]);
        if (value === "This Month")
            setDateRange([today.startOf("month"), today.endOf("month")]);
    };

    const scopedRows = useMemo(() => {
        const departmentId =
            departmentScope === "my" ? user?.departmentId : departmentScope;
        const sourceRows = departmentScope === "all"
            ? rows
            : rows.filter((row) => String(row.departmentId || "") === String(departmentId || ""));

        return rollupReportAssignments(sourceRows, reportLifecycleStatus).map((rollup) => {
            const earliest = [...rollup.members]
                .sort((a, b) => (tsToDayjs(a.createdAt)?.valueOf() || 0) - (tsToDayjs(b.createdAt)?.valueOf() || 0))[0];
            const latestCompleted = [...rollup.members]
                .sort((a, b) => (tsToDayjs(b.completedAt || b.updatedAt)?.valueOf() || 0) - (tsToDayjs(a.completedAt || a.updatedAt)?.valueOf() || 0))[0];

            return {
                ...rollup.record,
                id: rollup.key,
                status: rollup.status,
                assignmentStatus: rollup.status,
                createdAt: earliest?.createdAt || rollup.record.createdAt,
                completedAt:
                    rollup.status === "completed"
                        ? latestCompleted?.completedAt || latestCompleted?.updatedAt || rollup.record.completedAt
                        : rollup.record.completedAt,
                reportGroupMembers: rollup.members,
            } as AssignedIntervention;
        });
    }, [departmentScope, rows, user?.departmentId]);

    const journeyDepartmentIds = useMemo(() => {
        if (departmentScope === "all") return accessibleDepartmentIds;
        return [
            String(departmentScope === "my" ? user?.departmentId || "" : departmentScope),
        ].filter(Boolean);
    }, [accessibleDepartmentIds, departmentScope, user?.departmentId]);

    const filteredRows = useMemo(() => {
        return scopedRows.filter((r) => {
            const groupMembers = r.reportGroupMembers || [r];
            return groupMembers.some((member) => {
                const dt = tsToDayjs(member.completedAt) || tsToDayjs(member.createdAt);
                return !!dt && inRangeInclusive(dt, dateRange[0], dateRange[1]);
            });
        });
    }, [scopedRows, dateRange]);

    // Completion logic used consistently
    const isCompletedRow = (r: AssignedIntervention) => {
        const statusCompleted = (r.status || "").toLowerCase() === "completed";
        const consultantCompleted =
            (r.assigneeCompletionStatus || "").toLowerCase() === "completed";
        const userConfirmed =
            (r.participantCompletionStatus || "").toLowerCase() === "confirmed";
        const progressDone = (r.computedProgress ?? r.progress ?? 0) >= 100;
        return (
            statusCompleted || (consultantCompleted && userConfirmed) || progressDone
        );
    };

    const neededTotal = scopedRows.length;
    const completedTotal = scopedRows.filter(isCompletedRow).length;
    const remainingTotal = Math.max(neededTotal - completedTotal, 0);
    const overdueTotal = scopedRows.filter((row) =>
        isOverdueAt(row, dateRange[1])
    ).length;
    const completedInRange = filteredRows.filter(isCompletedRow);
    const uniqueSmesHelped = new Set(
        filteredRows
            .map((row) => row.participantId || row.beneficiaryName)
            .filter(Boolean)
    ).size;
    const avgTurnaround = average(
        completedInRange.map((row) => turnaroundDays(row) ?? NaN)
    );
    const avgFeedback = average(
        filteredRows
            .map((row) => Number(row.feedback?.rating))
            .filter(Number.isFinite)
    );
    const completionRate = filteredRows.length
        ? Math.round((completedInRange.length / filteredRows.length) * 100)
        : 0;

    const consultantRows = useMemo(() => {
        const grouped: Record<
            string,
            {
                key: string;
                consultant: string;
                names: Record<string, number>;
                assigned: number;
                completed: number;
                pending: number;
                overdue: number;
                turnaround: number[];
                feedback: number[];
                smes: Set<string>;
            }
        > = {};

        filteredRows.forEach((row) => {
            const consultant = normalizeText(row.assigneeName, "Unassigned");
            const key = consultantGroupKey(row);
            if (!grouped[key]) {
                grouped[key] = {
                    key,
                    consultant,
                    names: {},
                    assigned: 0,
                    completed: 0,
                    pending: 0,
                    overdue: 0,
                    turnaround: [],
                    feedback: [],
                    smes: new Set(),
                };
            }

            const entry = grouped[key];
            entry.names[consultant] = (entry.names[consultant] || 0) + 1;
            entry.assigned += 1;
            if (isCompletedRow(row)) entry.completed += 1;
            else if (isPendingLike(row)) entry.pending += 1;
            if (isOverdueAt(row, dateRange[1])) entry.overdue += 1;
            const days = turnaroundDays(row);
            if (days != null) entry.turnaround.push(days);
            const rating = Number(row.feedback?.rating);
            if (Number.isFinite(rating)) entry.feedback.push(rating);
            const sme = row.participantId || row.beneficiaryName;
            if (sme) entry.smes.add(sme);
        });

        return Object.values(grouped)
            .map((item) => {
                const displayName =
                    Object.entries(item.names).sort((a, b) => b[1] - a[1])[0]?.[0] ||
                    item.consultant;
                return {
                    key: item.key,
                    consultant: displayName,
                    assigned: item.assigned,
                    completed: item.completed,
                    pending: item.pending,
                    overdue: item.overdue,
                    completionRate: item.assigned
                        ? Math.round((item.completed / item.assigned) * 100)
                        : 0,
                    avgTurnaround: average(item.turnaround),
                    avgFeedback: average(item.feedback),
                    smes: item.smes.size,
                };
            })
            .sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);
    }, [filteredRows, dateRange]);

    const consultantOptions: Highcharts.Options = {
        chart: { type: "column", backgroundColor: "transparent", height: 360 },
        title: { text: "Facilitator Performance" },
        credits: { enabled: false },
        xAxis: {
            categories: consultantRows.map((row) => row.consultant),
            labels: { rotation: consultantRows.length > 5 ? -25 : 0 },
        },
        yAxis: [
            { min: 0, allowDecimals: false, title: { text: "Interventions" } },
            { min: 0, title: { text: "Completion %" }, opposite: true, max: 100 },
        ],
        tooltip: { shared: true },
        plotOptions: {
            column: { dataLabels: visibleDataLabels() },
            spline: { dataLabels: visibleDataLabels("{y}%") },
        },
        series: [
            withLabels({
                type: "column",
                name: "Overdue",
                data: consultantRows.map((row) => row.overdue),
                color: REPORT_COLORS.overdue,
            }),
            withLabels({
                type: "column",
                name: "Pending",
                data: consultantRows.map((row) => row.pending),
                color: REPORT_COLORS.pending,
            }),
            withLabels({
                type: "column",
                name: "Completed",
                data: consultantRows.map((row) => row.completed),
                color: REPORT_COLORS.completed,
            }),
            withLabels({
                type: "spline",
                name: "Completion Rate",
                data: consultantRows.map((row) => row.completionRate),
                color: REPORT_COLORS.assigned,
                yAxis: 1,
            }),
        ],
    };

    const bottleneckRows = useMemo(() => {
        const grouped: Record<
            string,
            {
                intervention: string;
                overdue: number;
                pending: number;
                assigned: number;
                avgAge: number[];
            }
        > = {};
        filteredRows.forEach((row) => {
            const intervention = normalizeText(row.interventionTitle, "Untitled");
            if (!grouped[intervention])
                grouped[intervention] = {
                    intervention,
                    overdue: 0,
                    pending: 0,
                    assigned: 0,
                    avgAge: [],
                };
            const entry = grouped[intervention];
            if (isOverdueAt(row, dateRange[1])) entry.overdue += 1;
            if (!isCompletedRow(row)) entry.pending += 1;
            entry.assigned += 1;
            const created = createdDate(row);
            if (created && !isCompletedRow(row))
                entry.avgAge.push(Math.max(0, dateRange[1].diff(created, "day")));
        });
        return (
            Object.values(grouped)
                // Only interventions with actual open work belong in a bottleneck
                // view — an intervention type where every row is completed (0
                // overdue, 0 pending) was leaking through as a 0/0 entry.
                .filter((item) => item.overdue > 0 || item.pending > 0)
                .map((item) => ({
                    ...item,
                    key: item.intervention,
                    avgOpenDays: average(item.avgAge),
                }))
                .sort((a, b) => b.overdue - a.overdue || b.avgOpenDays - a.avgOpenDays)
        );
    }, [filteredRows, dateRange]);

    const bottleneckOptions: Highcharts.Options = {
        chart: { type: "bar", backgroundColor: "transparent", height: 360 },
        title: { text: "Bottlenecks by Intervention" },
        credits: { enabled: false },
        xAxis: { categories: bottleneckRows.map((row) => row.intervention) },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: "Open interventions" },
        },
        tooltip: { shared: true },
        plotOptions: {
            bar: {
                dataLabels: visibleDataLabels(),
            },
        },
        series: [
            withLabels({
                type: "bar",
                name: "Overdue",
                data: bottleneckRows.map((row) => row.overdue),
                color: REPORT_COLORS.overdue,
            }),
            withLabels({
                type: "bar",
                name: "Pending",
                data: bottleneckRows.map((row) => row.pending),
                color: REPORT_COLORS.pending,
            }),
        ],
    };

    const gapOptions: Highcharts.Options = {
        chart: { type: "column", backgroundColor: "transparent" },
        title: { text: "Interventions Gap (Department)" },
        credits: { enabled: false },
        legend: { enabled: false },

        xAxis: { categories: ["Needed", "Completed", "Remaining"] },

        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: "Number of Interventions" },
        },

        tooltip: { pointFormat: "<b>{point.y}</b>" },

        plotOptions: {
            series: {
                dataLabels: visibleDataLabels(),
            },
        },

        series: [
            {
                type: "column",
                name: "Interventions",
                data: [
                    { y: neededTotal, color: REPORT_COLORS.assigned },
                    { y: completedTotal, color: REPORT_COLORS.completed },
                    { y: remainingTotal, color: REPORT_COLORS.pending },
                ],
                colorByPoint: true,

                // ✅ force it at series-level too (beats global setOptions/themes)
                dataLabels: visibleDataLabels(),
            },
        ],
    };

    const monthlyData = useMemo(() => {
        const map: Record<
            string,
            { completed: number; turnaround: number[]; feedback: number[] }
        > = {};

        scopedRows.forEach((r) => {
            const completed = completionDate(r);
            const activityDate = completed || createdDate(r);
            if (!activityDate) return;
            const key = activityDate.format("YYYY-MM");
            if (!map[key]) map[key] = { completed: 0, turnaround: [], feedback: [] };
            if (isCompletedRow(r)) {
                map[key].completed += 1;
                const days = turnaroundDays(r);
                if (days != null) map[key].turnaround.push(days);
            }
            const rating = Number(r.feedback?.rating);
            if (Number.isFinite(rating)) map[key].feedback.push(rating);
        });

        const keys = Object.keys(map).sort();
        return {
            categories: keys.map((k) => dayjs(`${k}-01`).format("MMM YYYY")),
            completed: keys.map((k) => map[k].completed),
            avgTurnaround: keys.map((k) => average(map[k].turnaround)),
            avgFeedback: keys.map((k) => average(map[k].feedback)),
        };
    }, [scopedRows]);

    const monthlyOptions: Highcharts.Options = {
        chart: { backgroundColor: "transparent" },
        title: { text: "Monthly Performance: Completion, Turnaround and Feedback" },
        credits: { enabled: false },
        xAxis: { categories: monthlyData.categories, crosshair: true },
        yAxis: [
            {
                min: 0,
                title: { text: "Completed interventions" },
                allowDecimals: false,
            },
            { min: 0, title: { text: "Days / Rating" }, opposite: true },
        ],
        tooltip: { shared: true },
        plotOptions: {
            column: {
                pointPadding: 0.1,
                borderWidth: 0,
                dataLabels: visibleDataLabels(),
            },
            spline: {
                marker: { enabled: true },
                dataLabels: visibleDataLabels(),
            },
        },
        series: [
            withLabels({
                type: "column",
                name: "Completed",
                data: monthlyData.completed,
                color: REPORT_COLORS.completed,
            }),
            withLabels({
                type: "spline",
                name: "Avg Turnaround Days",
                data: monthlyData.avgTurnaround,
                color: REPORT_COLORS.assigned,
                yAxis: 1,
            }),
            withLabels({
                type: "spline",
                name: "Avg Feedback",
                data: monthlyData.avgFeedback,
                color: REPORT_COLORS.pending,
                yAxis: 1,
            }),
        ],
    };

    // Export monthly/quarterly report (1–3 full months)
    const handleExportMonthlyReport = async () => {
        try {
            if (!user?.departmentId) return message.error("Missing department.");
            if (!activeProgramId) return message.error("Missing active program.");

            const start = dateRange[0].startOf("day");
            const end = dateRange[1].endOf("day");

            // Must be full-month boundaries
            const isStartAtMonthBoundary = start.isSame(
                start.startOf("month"),
                "day"
            );
            const isEndAtMonthBoundary = end.isSame(end.endOf("month"), "day");

            // How many months are covered? (inclusive)
            const spanMonths =
                end.startOf("month").diff(start.startOf("month"), "month") + 1;

            const isValidSpan = spanMonths >= 1 && spanMonths <= 3;

            if (!isStartAtMonthBoundary || !isEndAtMonthBoundary || !isValidSpan) {
                message.warning(
                    "Select a FULL range of 1–3 months (month boundaries)."
                );
                return;
            }

            setExporting(true);

            const departmentName =
                (user as any)?.departmentName ||
                (user as any)?.areaOfSupport ||
                "Department";

            const reportData = await buildMonthlyReportWithCharts({
                programId: activeProgramId,
                departmentId: user.departmentId,
                departmentName,
                period: {
                    month: start.month() + 1,
                    year: start.year(),
                    spanMonths: spanMonths as 1 | 2 | 3,
                },
                scopeLabel: `Program: ${activeProgramId}`,
                meta: {
                    preparedBy: (user as any)?.name || (user as any)?.email || "—",
                },
            });

            const fileLabel =
                spanMonths === 1
                    ? start.format("MMMM-YYYY")
                    : `${start.format("MMM-YYYY")}_to_${end.format("MMM-YYYY")}`;

            await exportMonthlyDepartmentReportDocx(reportData, {
                filenameBase: `${departmentName}-${fileLabel}-${spanMonths === 3 ? "Quarterly" : "Monthly"
                    }-Report`,
            });

            message.success("Report exported.");
        } catch (err) {
            console.error(err);
            message.error("Failed to export report.");
        } finally {
            setExporting(false);
        }
    };

    if (identityLoading || loading) {
        return (
            <div
                style={{
                    padding: 24,
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Spin size="large" />
            </div>
        );
    }

    return (
        <div style={{ padding: 24, minHeight: "100vh" }}>
            <DashboardHeaderCard
                title={`Interventions Reporting`}
                subtitle={"Realtime view of assigned interventions for your department"}
                extraRight={
                    <Space style={{ float: "right" }}>
                        <MilestoneJourneyButton
                            scope="operations"
                            departmentId={journeyDepartmentIds[0]}
                            departmentIds={journeyDepartmentIds}
                            programId={isAllPrograms ? null : activeProgramId}
                        />
                        <RangePicker
                            value={dateRange}
                            onChange={(v) =>
                                v && setDateRange([v[0] as Dayjs, v[1] as Dayjs])
                            }
                            style={{ width: 280 }}
                        />

                        {childDepartments.length > 0 && (
                            <Select
                                value={departmentScope}
                                onChange={(value) => setDepartmentScope(String(value))}
                                style={{ width: 190 }}
                                options={[
                                    { label: "All", value: "all" },
                                    {
                                        label: String(user?.departmentName || "My Department"),
                                        value: "my",
                                    },
                                    ...childDepartments.map((department) => ({
                                        label: department.name,
                                        value: department.id,
                                    })),
                                ]}
                            />
                        )}

                        <Segmented
                            value={view}
                            onChange={(val) => setView(val as any)}
                            options={["Overview", "Facilitators", "Reach", "Bottlenecks"]}
                        />

                        {/* <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            loading={exporting}
                            onClick={handleExportMonthlyReport}
                        >
                            Export Report
                        </Button> */}
                    </Space>
                }
            />

            <Row
                gutter={[16, 16]}
                wrap
                style={{ marginBottom: 16, marginTop: 16, width: "100%" }}
            >
                {[
                    {
                        title: "SMEs Reached",
                        value: uniqueSmesHelped,
                        icon: (
                            <TeamOutlined style={{ color: METRIC_ICON_COLORS.reach.color }} />
                        ),
                        iconBg: METRIC_ICON_COLORS.reach.bg,
                    },
                    {
                        title: "Completion Rate",
                        value: `${completionRate}%`,
                        icon: (
                            <RiseOutlined
                                style={{ color: METRIC_ICON_COLORS.completion.color }}
                            />
                        ),
                        iconBg: METRIC_ICON_COLORS.completion.bg,
                    },
                    {
                        title: "Avg Turnaround",
                        value: avgTurnaround ? `${avgTurnaround} days` : "0 days",
                        icon: (
                            <FieldTimeOutlined
                                style={{ color: METRIC_ICON_COLORS.turnaround.color }}
                            />
                        ),
                        iconBg: METRIC_ICON_COLORS.turnaround.bg,
                    },
                    {
                        title: "Avg Feedback",
                        value: avgFeedback ? `${avgFeedback}/5` : "No ratings",
                        icon: (
                            <StarOutlined
                                style={{ color: METRIC_ICON_COLORS.feedback.color }}
                            />
                        ),
                        iconBg: METRIC_ICON_COLORS.feedback.bg,
                    },
                    {
                        title: "Overdue Carryover",
                        value: overdueTotal,
                        icon: (
                            <WarningOutlined
                                style={{ color: METRIC_ICON_COLORS.overdue.color }}
                            />
                        ),
                        iconBg: METRIC_ICON_COLORS.overdue.bg,
                    },
                ].map((metric) => (
                    <Col flex="1 1 210px" key={metric.title}>
                        <MotionCard.Metric
                            title={metric.title}
                            value={metric.value}
                            icon={metric.icon}
                            iconBg={metric.iconBg}
                        />
                    </Col>
                ))}
            </Row>

            {(aiChart || aiLoading) && (
                <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col xs={24}>
                        <Card
                            style={cardStyle}
                            title="Asked"
                            extra={
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<CloseOutlined />}
                                    onClick={() => setAiChart(null)}
                                    aria-label="Dismiss AI chart"
                                />
                            }
                        >
                            {aiLoading ? (
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        padding: 40,
                                    }}
                                >
                                    <Spin />
                                </div>
                            ) : (
                                aiChart && <ChartSpecRenderer chart={aiChart} height={340} />
                            )}
                        </Card>
                    </Col>
                </Row>
            )}

            {view === "Overview" && (
                <>
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                        <InterventionsCompletionCard
                            filteredRows={filteredRows}
                            allRows={scopedRows}
                            dateRange={dateRange}
                        />

                        <Col span={12} style={{ marginBottom: 24 }}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                            >
                                <Card style={cardStyle} title="Interventions Gap">
                                    {neededTotal > 0 ? (
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={gapOptions}
                                        />
                                    ) : (
                                        <Empty description="No interventions for this department yet" />
                                    )}
                                </Card>
                            </motion.div>
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col span={24}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                            >
                                <Card style={cardStyle} title="Monthly Performance">
                                    {monthlyData.categories.length ? (
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={monthlyOptions}
                                        />
                                    ) : (
                                        <Empty description="No monthly activity to show yet" />
                                    )}
                                </Card>
                            </motion.div>
                        </Col>
                    </Row>
                </>
            )}

            {view === "Facilitators" && (
                <Row gutter={[16, 16]}>
                    <Col xs={24} xl={14}>
                        <Card style={cardStyle} title="Facilitator Analytics">
                            {consultantRows.length ? (
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={consultantOptions}
                                />
                            ) : (
                                <Empty description="No facilitator activity in this period" />
                            )}
                        </Card>
                    </Col>
                    <Col xs={24} xl={10}>
                        <Card style={cardStyle} title="Facilitator Detail">
                            <Table
                                size="small"
                                pagination={{ pageSize: 6 }}
                                dataSource={consultantRows}
                                columns={[
                                    { title: "Facilitator", dataIndex: "consultant" },
                                    { title: "SMEs", dataIndex: "smes", align: "right" as const },
                                    {
                                        title: "Completed",
                                        dataIndex: "completed",
                                        align: "right" as const,
                                    },
                                    {
                                        title: "Overdue",
                                        dataIndex: "overdue",
                                        align: "right" as const,
                                        render: (value) => (
                                            <Tag color={value > 0 ? "red" : "green"}>{value}</Tag>
                                        ),
                                    },
                                    {
                                        title: "Turnaround",
                                        dataIndex: "avgTurnaround",
                                        render: (value) => `${value || 0}d`,
                                    },
                                    {
                                        title: "Rating",
                                        dataIndex: "avgFeedback",
                                        render: (value) => (value ? `${value}/5` : "—"),
                                    },
                                ]}
                            />
                        </Card>
                    </Col>
                </Row>
            )}

            {view === "Reach" && (
                <ReachAnalytics
                    rows={filteredRows}
                    participants={participants}
                    loading={loading || participantsLoading}
                    departmentId={user?.departmentId || ""}
                    isMain={childDepartments.length > 0}
                    departmentOptions={[
                        ...(user?.departmentId
                            ? [{
                                value: String(user.departmentId),
                                label: String(user.departmentName || "My Department"),
                            }]
                            : []),
                        ...childDepartments.map((department) => ({
                            value: department.id,
                            label: department.name,
                        })),
                    ]}
                />
            )}

            {view === "Bottlenecks" && (
                <Row gutter={[16, 16]}>
                    <Col xs={24} xl={14}>
                        <Card style={cardStyle} title="Bottleneck Analysis">
                            {bottleneckRows.length ? (
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={bottleneckOptions}
                                />
                            ) : (
                                <Empty description="No bottlenecks in this period" />
                            )}
                        </Card>
                    </Col>
                    <Col xs={24} xl={10}>
                        <Card style={cardStyle} title="Open Work by Intervention">
                            <Table
                                size="small"
                                pagination={{ pageSize: 6 }}
                                dataSource={bottleneckRows}
                                columns={[
                                    { title: "Intervention", dataIndex: "intervention" },
                                    {
                                        title: "Overdue",
                                        dataIndex: "overdue",
                                        align: "right" as const,
                                        render: (value) => (
                                            <Tag color={value > 0 ? "red" : "green"}>{value}</Tag>
                                        ),
                                    },
                                    {
                                        title: "Pending",
                                        dataIndex: "pending",
                                        align: "right" as const,
                                    },
                                    {
                                        title: "Avg Open",
                                        dataIndex: "avgOpenDays",
                                        render: (value) => `${value || 0}d`,
                                    },
                                ]}
                            />
                        </Card>
                    </Col>
                </Row>
            )}

            {/* <AnalyticsAskFab
                pageContext={{
                    view,
                    dateFrom: dateRange[0]?.format("YYYY-MM-DD"),
                    dateTo: dateRange[1]?.format("YYYY-MM-DD"),
                }}
                suggestions={[
                    "Chart completed interventions by department",
                    "Which interventions are overdue?",
                    "Show intervention status breakdown",
                ]}
                loading={aiLoading}
                onLoadingChange={setAiLoading}
                onChart={setAiChart}
                onMiss={() => { }}
            /> */}
        </div>
    );
};

export default ReportingDashboard;
