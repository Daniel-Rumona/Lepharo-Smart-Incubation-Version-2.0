import React, { useEffect, useMemo, useState } from "react";
import {
    Row,
    Col,
    Button,
    Modal,
    Empty,
    Typography,
    Skeleton,
    message,
    Pagination,
    Tag,
    theme,
} from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import "highcharts/highcharts-more";
import "highcharts/modules/heatmap";
import { motion, useReducedMotion } from "framer-motion";
import dayjs from "dayjs";
import {
    collection,
    getDocs,
    query,
    where,
    DocumentData,
    documentId,
} from "firebase/firestore";
import { db } from "@/firebase";
import { getCanonicalInterventionStatus } from "./interventionStatus";
import { filterReportRecords, loadReportVisibilityContext } from "@/utils/reportVisibility";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { ExpandAltOutlined, LinkOutlined, ThunderboltOutlined, CheckCircleOutlined, SortAscendingOutlined, StarOutlined } from "@ant-design/icons";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { EntityAvatar, SortSelect, type SortOption } from "@/components/workspace";

const { Text } = Typography;

// Init Highcharts modules once


type FacilitatorRow = {
    id: string;
    name: string;
    departmentId?: string;
    departmentName?: string;
    programId?: string;
    programName?: string;
    branchName?: string;
    completedMonthly: number[]; // length 12
    assignedMonthly: number[];
    inProgressMonthly: number[];
    avgSatisfaction: number; // 1..5
    avgTurnaroundDays: number; // float
    pipeline: { assigned: number; in_progress: number; completed: number };
};

type Props = {
    programId?: string;
    departmentId?: string;
    dateFrom?: Date;
    dateTo?: Date;
};

type FacilitatorSort = "completed" | "rating" | "name";

const SORT_OPTIONS: SortOption<FacilitatorSort>[] = [
    { value: "completed", label: "Most completed", icon: <CheckCircleOutlined /> },
    { value: "rating", label: "Highest rating", icon: <StarOutlined /> },
    { value: "name", label: "Name A–Z", icon: <SortAscendingOutlined /> },
];

const PAGE_SIZE = 8;

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

const tsToDate = (v: any): Date | undefined =>
    v?.toDate?.() ??
    (v instanceof Date ? v : typeof v === "string" ? new Date(v) : undefined);

const FacilitatorsTab: React.FC<Props> = ({
    programId,
    departmentId,
    dateFrom,
    dateTo,
}) => {
    const { user } = useFullIdentity() as any;
    const { token } = theme.useToken();

    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<FacilitatorRow[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sort, setSort] = useState<FacilitatorSort>("completed");
    const reduceMotion = useReducedMotion();
    const [facilitatorDeltas, setFacilitatorDeltas] = useState<Record<string, { assigned: number; active: number; completed: number }>>({});

    const [showMonthly, setShowMonthly] = useState(false);
    const [showBubble, setShowBubble] = useState(false);
    const [facilitatorPage, setFacilitatorPage] = useState(1);

    // --- Fetch & aggregate from assignedInterventions ---
    useEffect(() => {
        const inRange = (d?: Date) => {
            if (!d) return false;
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            return true;
        };

        const run = async () => {
            setLoading(true);
            try {
                const visibilityContext = await loadReportVisibilityContext(user?.email);
                const currentStart = dateFrom ? dayjs(dateFrom).startOf("day") : null;
                const currentEnd = dateTo ? dayjs(dateTo).endOf("day") : null;
                const previousStart = currentStart && currentEnd
                    ? currentStart.subtract(currentEnd.diff(currentStart, "day") + 1, "day")
                    : null;
                const previousEnd = currentStart ? currentStart.subtract(1, "millisecond") : null;
                const previous = new Map<string, { assigned: number; active: number; completed: number }>();
                const base = collection(db, "assignedInterventions");
                const filters: any[] = [];
                if (programId) filters.push(where("programId", "==", programId));
                if (departmentId && departmentId !== "all") {
                    filters.push(where("departmentId", "==", departmentId));
                }

                const snap = await getDocs(query(base, ...filters));

                type Agg = {
                    id: string;
                    name: string;
                    departmentId?: string;
                    departmentName?: string;
                    programId?: string;
                    programName?: string;
                    branchName?: string;
                    completedMonthly: number[];
                    assignedMonthly: number[];
                    inProgressMonthly: number[];
                    pipeline: {
                        assigned: number;
                        in_progress: number;
                        completed: number;
                    };
                    totalSat: number;
                    satCount: number;
                    totalTurn: number;
                    turnCount: number;
                };

                const map = new Map<string, Agg>();

                filterReportRecords(snap.docs.map(docu => ({ id: docu.id, ...docu.data() })), user?.email, visibilityContext).forEach((record) => {
                    const raw = record as DocumentData;

                    const consultantId = raw.assigneeId ?? "unknown";
                    const consultantName = raw.assigneeName ?? "Unassigned";

                    if (!consultantId) return;

                    const status = getCanonicalInterventionStatus(raw);

                    const createdAt = tsToDate(raw.createdAt);
                    const updatedAt = tsToDate(raw.updatedAt);
                    const completedAt = tsToDate(raw.completedAt);
                    const assignedAt = tsToDate(raw.assignedAt ?? raw.assignmentDate ?? raw.assignedDate);
                    const assignmentDate = assignedAt || createdAt || updatedAt;

                    // Date logic:
                    // - Completed → use updatedAt (completion date) if available, else createdAt
                    // - Assigned / In progress → use createdAt
                    let activityDate: Date | undefined;
                    if (status === "completed") {
                        activityDate = completedAt || updatedAt || createdAt;
                    } else if (status === "assigned" || status === "in-progress") {
                        activityDate = assignedAt || createdAt || updatedAt;
                    } else {
                        activityDate = createdAt || updatedAt;
                    }

                    if (previousStart && previousEnd && activityDate && dayjs(activityDate).isAfter(previousStart.subtract(1, "millisecond")) && dayjs(activityDate).isBefore(previousEnd.add(1, "millisecond"))) {
                        const prior = previous.get(consultantId) || { assigned: 0, active: 0, completed: 0 };
                        prior.assigned += 1;
                        if (status === "completed") prior.completed += 1;
                        if (status === "assigned" || status === "in-progress") prior.active += 1;
                        previous.set(consultantId, prior);
                    }

                    if (dateFrom || dateTo) {
                        if (!inRange(activityDate)) return;
                    }

                    let agg = map.get(consultantId);
                    if (!agg) {
                        agg = {
                            id: consultantId,
                            name: consultantName,
                            departmentId: raw.departmentId ?? undefined,
                            departmentName: undefined, // will be resolved from departments collection
                            programId: raw.programId ?? undefined,
                            programName: undefined, // will be resolved from programs collection
                            branchName: raw.branchName ?? raw.branch ?? undefined,
                            completedMonthly: Array(12).fill(0),
                            assignedMonthly: Array(12).fill(0),
                            inProgressMonthly: Array(12).fill(0),
                            pipeline: { assigned: 0, in_progress: 0, completed: 0 },
                            totalSat: 0,
                            satCount: 0,
                            totalTurn: 0,
                            turnCount: 0,
                        };
                        map.set(consultantId, agg);
                    }

                    // Completed per month (based on activityDate)
                    if (status === "completed" && activityDate) {
                        const monthIdx = dayjs(activityDate).month();
                        if (monthIdx >= 0 && monthIdx < 12) {
                            agg.completedMonthly[monthIdx] += 1;
                        }
                    }

                    if (assignmentDate) {
                        const monthIdx = dayjs(assignmentDate).month();
                        // Assigned is assignment activity, not the current lifecycle status:
                        // completed and in-progress records were assigned earlier too.
                        agg.assignedMonthly[monthIdx] += 1;
                        if (status === "in-progress") agg.inProgressMonthly[monthIdx] += 1;
                    }

                    // Pipeline counts
                    if (status === "assigned") {
                        agg.pipeline.assigned += 1;
                    } else if (status === "in-progress") {
                        agg.pipeline.in_progress += 1;
                    } else if (status === "completed") {
                        agg.pipeline.completed += 1;
                    }

                    // Satisfaction score: prefer feedback.rating on assignedInterventions
                    const feedback = raw.feedback as any;
                    let sat: number | undefined;

                    if (feedback && typeof feedback.rating === "number") {
                        sat = feedback.rating;
                    } else if (typeof raw.satisfactionScore === "number") {
                        sat = raw.satisfactionScore;
                    } else if (typeof raw.feedbackRating === "number") {
                        sat = raw.feedbackRating;
                    }

                    if (typeof sat === "number" && !Number.isNaN(sat)) {
                        agg.totalSat += sat;
                        agg.satCount += 1;
                    }

                    // Turnaround days from createdAt vs updatedAt for completed interventions
                    let turn: number | undefined;
                    if (status === "completed" && createdAt && updatedAt) {
                        const msPerDay = 1000 * 60 * 60 * 24;
                        const diff = (updatedAt.getTime() - createdAt.getTime()) / msPerDay;
                        if (diff >= 0 && Number.isFinite(diff)) {
                            turn = diff;
                        }
                    }

                    if (typeof turn === "number") {
                        agg.totalTurn += turn;
                        agg.turnCount += 1;
                    }
                });

                // --- Resolve department & program names from separate collections ---
                const aggs = Array.from(map.values());

                const deptIds = Array.from(
                    new Set(
                        aggs
                            .map((a) => a.departmentId)
                            .filter((v): v is string => typeof v === "string")
                    )
                );
                const progIds = Array.from(
                    new Set(
                        aggs
                            .map((a) => a.programId)
                            .filter((v): v is string => typeof v === "string")
                    )
                );

                const deptNameById = new Map<string, string>();
                const progNameById = new Map<string, string>();

                // Firestore `in` query limit = 10
                const chunk = <T,>(arr: T[], size: number): T[][] => {
                    const res: T[][] = [];
                    for (let i = 0; i < arr.length; i += size) {
                        res.push(arr.slice(i, i + size));
                    }
                    return res;
                };

                // Fetch department names
                for (const batch of chunk(deptIds, 10)) {
                    const qDept = query(
                        collection(db, "departments"),
                        where(documentId(), "in", batch)
                    );
                    const deptSnap = await getDocs(qDept);
                    deptSnap.forEach((d) => {
                        const data = d.data() as any;
                        const name =
                            data.name ||
                            data.departmentName ||
                            data.title ||
                            data.label ||
                            "";
                        deptNameById.set(d.id, name || d.id);
                    });
                }

                // Fetch program names
                for (const batch of chunk(progIds, 10)) {
                    const qProg = query(
                        collection(db, "programs"),
                        where(documentId(), "in", batch)
                    );
                    const progSnap = await getDocs(qProg);
                    progSnap.forEach((d) => {
                        const data = d.data() as any;
                        const name =
                            data.name || data.programName || data.title || data.label || "";
                        progNameById.set(d.id, name || d.id);
                    });
                }

                const out: FacilitatorRow[] = [];
                map.forEach((agg) => {
                    out.push({
                        id: agg.id,
                        name: agg.name,
                        departmentId: agg.departmentId,
                        departmentName: agg.departmentId
                            ? deptNameById.get(agg.departmentId) ?? agg.departmentName
                            : agg.departmentName,
                        programId: agg.programId,
                        programName: agg.programId
                            ? progNameById.get(agg.programId) ?? agg.programName
                            : agg.programName,
                        branchName: agg.branchName,
                        completedMonthly: agg.completedMonthly,
                        assignedMonthly: agg.assignedMonthly,
                        inProgressMonthly: agg.inProgressMonthly,
                        avgSatisfaction: agg.satCount > 0 ? agg.totalSat / agg.satCount : 0,
                        avgTurnaroundDays:
                            agg.turnCount > 0 ? agg.totalTurn / agg.turnCount : 0,
                        pipeline: agg.pipeline,
                    });
                });

                setRows(out);
                const currentById = new Map(out.map((row) => [row.id, {
                    assigned: row.pipeline.assigned + row.pipeline.in_progress + row.pipeline.completed,
                    active: row.pipeline.assigned + row.pipeline.in_progress,
                    completed: row.pipeline.completed,
                }]));
                const deltaRecord: Record<string, { assigned: number; active: number; completed: number }> = {};
                currentById.forEach((current, id) => {
                    const prior = previous.get(id) || { assigned: 0, active: 0, completed: 0 };
                    deltaRecord[id] = {
                        assigned: current.assigned - prior.assigned,
                        active: current.active - prior.active,
                        completed: current.completed - prior.completed,
                    };
                });
                setFacilitatorDeltas(deltaRecord);
                setFacilitatorPage(1);

                if (out.length) {
                    setSelectedId((prev) =>
                        prev && out.some((r) => r.id === prev) ? prev : out[0].id
                    );
                } else {
                    setSelectedId(null);
                }
            } catch (err: any) {
                console.error("[FacilitatorsTab] fetch error", err);
                message.error("Failed to load data");
                setRows([]);
                setSelectedId(null);
            } finally {
                setLoading(false);
            }
        };

        run();
    }, [programId, departmentId, dateFrom, dateTo]);

    const filtered = useMemo(() => {
        const completed = (r: FacilitatorRow) => r.completedMonthly.reduce((a, b) => a + b, 0);
        return [...rows].sort((a, b) => {
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "rating") return b.avgSatisfaction - a.avgSatisfaction || a.name.localeCompare(b.name);
            return completed(b) - completed(a) || a.name.localeCompare(b.name);
        });
    }, [rows, sort]);

    useEffect(() => setFacilitatorPage(1), [sort]);

    const selected = useMemo(
        () => filtered.find((f) => f.id === selectedId) || null,
        [filtered, selectedId]
    );
    const facilitatorPageRows = filtered.slice((facilitatorPage - 1) * PAGE_SIZE, facilitatorPage * PAGE_SIZE);
    const selectedStats = selected
        ? {
            assigned: selected.pipeline.assigned + selected.pipeline.in_progress + selected.pipeline.completed,
            active: selected.pipeline.assigned + selected.pipeline.in_progress,
            completed: selected.pipeline.completed,
        }
        : null;
    const facilitatorMetrics: DashboardMetric[] = selected ? [
        { key: "assigned", title: "Assigned", value: selectedStats?.assigned ?? 0, subtitle: `vs previous period ${facilitatorDeltas[selected.id]?.assigned >= 0 ? "+" : ""}${facilitatorDeltas[selected.id]?.assigned ?? 0}`, icon: <LinkOutlined />, tone: 'info' as const, important: true },
        { key: "active", title: "Active", value: selectedStats?.active ?? 0, subtitle: `vs previous period ${facilitatorDeltas[selected.id]?.active >= 0 ? "+" : ""}${facilitatorDeltas[selected.id]?.active ?? 0}`, icon: <ThunderboltOutlined />, tone: 'warning' as const, important: true },
        { key: "completed", title: "Completed", value: selectedStats?.completed ?? 0, subtitle: `vs previous period ${facilitatorDeltas[selected.id]?.completed >= 0 ? "+" : ""}${facilitatorDeltas[selected.id]?.completed ?? 0}`, icon: <CheckCircleOutlined />, tone: 'success' as const, important: true },
    ] : [];

    // Portfolio averages (for bubble chart)
    const portfolioStats = useMemo(() => {
        if (!filtered.length) return null;
        const total = filtered.length;
        const sumTurn = filtered.reduce((acc, r) => acc + r.avgTurnaroundDays, 0);
        const sumSat = filtered.reduce((acc, r) => acc + r.avgSatisfaction, 0);
        const sumVol = filtered.reduce(
            (acc, r) => acc + r.completedMonthly.reduce((a, b) => a + b, 0),
            0
        );
        return {
            avgTurnaround: total ? sumTurn / total : 0,
            avgSatisfaction: total ? sumSat / total : 0,
            avgVolume: total ? sumVol / total : 0,
        };
    }, [filtered]);

    // 1) Monthly activity – column chart for selected consultant
    const monthlyOptions: Highcharts.Options = useMemo(() => {
        if (!selected) return { title: { text: "No consultant selected" } };

        const today = dayjs();
        const visibleMonthCount = dateTo && dayjs(dateTo).isBefore(today, "month")
            ? dayjs(dateTo).month() + 1
            : dateFrom && dayjs(dateFrom).year() === today.year()
                ? today.month() + 1
                : 12;
        const categories = MONTHS.slice(0, visibleMonthCount);

        return {
            chart: { type: "column" },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: {
                categories,
                crosshair: true,
            },
            yAxis: {
                min: 0,
                title: { text: "Interventions" },
                allowDecimals: false,
            },
            tooltip: {
                shared: true,
                formatter: function () {
                    const points = this.points || [];
                    return `<b>${this.x}</b><br/>${points.map((point: any) => `<span style="color:${point.color}">●</span> ${point.series.name}: <b>${point.y}</b>`).join("<br/>")}`;
                },
            },
            plotOptions: {
                column: {
                    borderWidth: 0,
                    pointPadding: 0.1,
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: "allow",
                        style: { textOutline: "none", fontWeight: "600" },
                    },
                },
                spline: {
                    marker: { enabled: true, radius: 3 },
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: "allow",
                        style: { textOutline: "none", fontWeight: "600" },
                    },
                },
            },
            series: [
                {
                    type: "spline",
                    name: "Assigned",
                    data: selected.assignedMonthly.slice(0, visibleMonthCount),
                    color: "#1677ff",
                } as any,
                {
                    type: "column",
                    name: "Completed",
                    data: selected.completedMonthly.slice(0, visibleMonthCount),
                    color: "#52c41a",
                } as any,
                {
                    type: "column",
                    name: "In Progress",
                    data: selected.inProgressMonthly.slice(0, visibleMonthCount),
                    color: "#faad14",
                } as any,
            ],
        };
    }, [selected, dateFrom, dateTo]);

    // 2) Quality bubble – selected vs portfolio average
    const bubbleOptions: Highcharts.Options = useMemo(() => {
        if (!selected || !portfolioStats) {
            return { title: { text: "No consultant selected" } };
        }

        const selectedVolume = selected.completedMonthly.reduce((a, b) => a + b, 0);

        const points = [
            {
                name: selected.name,
                x: selected.avgTurnaroundDays,
                y: selected.avgSatisfaction,
                z: 1,
                volume: selectedVolume,
                role: "Selected",
                color: "#1677ff",
            },
            {
                name: "Portfolio Average",
                x: portfolioStats.avgTurnaround,
                y: portfolioStats.avgSatisfaction,
                z: 1,
                volume: portfolioStats.avgVolume,
                role: "Average",
                color: "#16a34a",
            },
        ];

        return {
            chart: { type: "bubble", plotBorderWidth: 1 },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: {
                title: { text: "Avg Turnaround (days, lower is better)" },
            },
            yAxis: {
                title: { text: "Avg Satisfaction (1–5, higher is better)" },
                max: 5,
                min: 0,
            },
            legend: { enabled: false },
            tooltip: {
                pointFormat: `
          <b>{point.name}</b> ({point.role})<br/>
          Turnaround: {point.x:.1f} days<br/>
          Satisfaction: {point.y:.1f}/5<br/>
          Completed: {point.volume:.0f}
        `,
            },
            series: [
                {
                    type: "bubble",
                    data: points,
                    minSize: 10,
                    maxSize: 30,
                } as any,
            ],
        };
    }, [selected, portfolioStats]);

    if (loading && !rows.length) {
        return (
            <div style={{ marginTop: 10 }} aria-busy="true" aria-label="Loading consultant reports">
                <Row gutter={[16, 16]}>
                    <Col xs={24} md={7} lg={6}>
                        <Skeleton active title={{ width: 140 }} paragraph={{ rows: 8 }} />
                    </Col>
                    <Col xs={24} md={17} lg={18}>
                        <Skeleton active title={{ width: 220 }} paragraph={{ rows: 10 }} />
                    </Col>
                </Row>
            </div>
        );
    }

    return (
        <div style={{ marginTop: 10 }}>
            <Row gutter={[16, 16]}>
                {/* LEFT: Consultant list */}
                <Col xs={24} md={7} lg={6}>
                    <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Same list as the Applications page: sort on top, avatar rows, pagination. */}
                        <MotionCard>
                            <SortSelect value={sort} options={SORT_OPTIONS} onChange={setSort} label="Sort facilitators" />

                            {!filtered.length ? (
                                <Empty className="ws-list-empty" description="No facilitators match the selected filters." />
                            ) : (
                                <>
                                    <div
                                        key={`${facilitatorPage}|${sort}`}
                                        className="ws-rows"
                                        role="listbox"
                                        aria-label="Facilitators"
                                    >
                                        {facilitatorPageRows.map((c, index) => {
                                            const total = c.completedMonthly.reduce((a, b) => a + b, 0);
                                            const isActive = c.id === selectedId;
                                            return (
                                                <motion.button
                                                    key={c.id}
                                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.24, ease: "easeOut", delay: Math.min(index * 0.035, 0.3) }}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={isActive}
                                                    className={`ws-row${isActive ? " is-selected" : ""}`}
                                                    onClick={() => setSelectedId(c.id)}
                                                >
                                                    <EntityAvatar name={c.name} size={36} />
                                                    <div className="ws-row-main">
                                                        <div className="ws-row-name">{c.name}</div>
                                                        <div className="ws-row-meta">
                                                            {c.departmentName || c.branchName || "—"}
                                                        </div>
                                                    </div>
                                                    <div className="ws-row-side">
                                                        <Tag color="success" bordered={false} title="Completed interventions">
                                                            {total} done
                                                        </Tag>
                                                        <Text type="secondary" style={{ fontSize: 12 }} title="Average rating">
                                                            {c.avgSatisfaction.toFixed(1)}/5
                                                        </Text>
                                                    </div>
                                                </motion.button>
                                            );
                                        })}
                                    </div>

                                    {filtered.length > PAGE_SIZE && (
                                        <div className="ws-pagination">
                                            <Pagination
                                                size="small"
                                                current={facilitatorPage}
                                                pageSize={PAGE_SIZE}
                                                total={filtered.length}
                                                onChange={setFacilitatorPage}
                                                showSizeChanger={false}
                                                showLessItems
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </MotionCard>
                    </motion.div>
                </Col>

                {/* RIGHT: Charts for selected consultant */}
                <Col xs={24} md={17} lg={18}>
                    {!selected ? (
                        <Empty description="Select a consultant to view details." />
                    ) : (
                        <Row gutter={[16, 16]}>
                            <Col span={24}>
                                <MetricsGrid metrics={facilitatorMetrics} />
                            </Col>
                            {/* Monthly activity */}
                            <Col xs={24} lg={12}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <MotionCard
                                        title="Monthly Activity"
                                        extra={
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={<ExpandAltOutlined />}
                                                onClick={() => setShowMonthly(true)}
                                            >
                                                Expand
                                            </Button>
                                        }
                                    >
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={monthlyOptions}
                                        />
                                    </MotionCard>
                                </motion.div>
                            </Col>

                            {/* Quality bubble */}
                            <Col xs={24} lg={12}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <MotionCard
                                        title="Quality vs Speed"
                                        extra={
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={<ExpandAltOutlined />}
                                                onClick={() => setShowBubble(true)}
                                            >
                                                Expand
                                            </Button>
                                        }
                                    >
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={bubbleOptions}
                                        />
                                        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 4, fontSize: 12, color: token.colorTextSecondary }}>
                                            <span><span style={{ color: "#1677ff", fontSize: 16 }}>●</span> Current facilitator</span>
                                            <span><span style={{ color: "#16a34a", fontSize: 16 }}>●</span> Portfolio average</span>
                                        </div>
                                    </MotionCard>
                                </motion.div>
                            </Col>
                        </Row>
                    )}
                </Col>
            </Row>

            <Modal
                open={showMonthly}
                footer={null}
                width={980}
                onCancel={() => setShowMonthly(false)}
                title={
                    selected ? `Monthly Activity — ${selected.name}` : "Monthly Activity"
                }
            >
                <HighchartsReact highcharts={Highcharts} options={monthlyOptions} />
            </Modal>

            <Modal
                open={showBubble}
                footer={null}
                width={980}
                onCancel={() => setShowBubble(false)}
                title={
                    selected ? `Quality vs Speed — ${selected.name}` : "Quality vs Speed"
                }
            >
                <HighchartsReact highcharts={Highcharts} options={bubbleOptions} />
            </Modal>
        </div>
    );
};

export default FacilitatorsTab;
