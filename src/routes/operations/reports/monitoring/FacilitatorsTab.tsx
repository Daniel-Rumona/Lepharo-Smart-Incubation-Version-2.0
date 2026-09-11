import React, { useEffect, useMemo, useState } from "react";
import {
    Row,
    Col,
    Card,
    Button,
    Modal,
    Empty,
    Typography,
    Skeleton,
    message,
    Pagination,
} from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import HighchartsMore from "highcharts/highcharts-more";
import HeatmapModule from "highcharts/modules/heatmap";
import { motion } from "framer-motion";
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
import { ExpandAltOutlined, LinkOutlined, ThunderboltOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";

const { Text } = Typography;

// Init Highcharts modules once
if (typeof HighchartsMore === "function") HighchartsMore(Highcharts);
if (typeof HeatmapModule === "function") HeatmapModule(Highcharts);


const cardStyle: React.CSSProperties = {
    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
    transition: "all 0.3s ease",
    borderRadius: 8,
    border: "1px solid #d6e4ff",
    padding: 16,
    background: "#fff",
};

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

    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<FacilitatorRow[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
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

    const filtered = rows;

    const selected = useMemo(
        () => filtered.find((f) => f.id === selectedId) || null,
        [filtered, selectedId]
    );
    const facilitatorPageRows = filtered.slice((facilitatorPage - 1) * 5, facilitatorPage * 5);
    const selectedStats = selected
        ? {
            assigned: selected.pipeline.assigned + selected.pipeline.in_progress + selected.pipeline.completed,
            active: selected.pipeline.assigned + selected.pipeline.in_progress,
            completed: selected.pipeline.completed,
        }
        : null;
    const facilitatorMetrics: DashboardMetric[] = selected ? [
        { key: "assigned", title: "Assigned", value: selectedStats?.assigned ?? 0, subtitle: `vs previous period ${facilitatorDeltas[selected.id]?.assigned >= 0 ? "+" : ""}${facilitatorDeltas[selected.id]?.assigned ?? 0}`, icon: <LinkOutlined />, iconBg: "rgba(22,119,255,.14)", important: true },
        { key: "active", title: "Active", value: selectedStats?.active ?? 0, subtitle: `vs previous period ${facilitatorDeltas[selected.id]?.active >= 0 ? "+" : ""}${facilitatorDeltas[selected.id]?.active ?? 0}`, icon: <ThunderboltOutlined />, iconBg: "rgba(250,173,20,.18)", important: true },
        { key: "completed", title: "Completed", value: selectedStats?.completed ?? 0, subtitle: `vs previous period ${facilitatorDeltas[selected.id]?.completed >= 0 ? "+" : ""}${facilitatorDeltas[selected.id]?.completed ?? 0}`, icon: <CheckCircleOutlined />, iconBg: "rgba(82,196,26,.16)", important: true },
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
            title: { text: `Monthly Activity — ${selected.name}` },
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
                        overflow: "none",
                        style: { textOutline: "none", fontWeight: "600" },
                    },
                },
                spline: {
                    marker: { enabled: true, radius: 3 },
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: "none",
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
            title: { text: `Quality vs Speed — ${selected.name}` },
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
                        <div
                            style={{
                                ...cardStyle,
                                overflow: "visible",
                            }}
                        >
                            <Text strong style={{ display: "block", marginBottom: 8 }}>
                                Facilitators ({filtered.length})
                            </Text>
                            {!filtered.length ? (
                                <Empty description="No consultants match the selected filters." />
                            ) : (
                                facilitatorPageRows.map((c) => {
                                    const total = c.completedMonthly.reduce((a, b) => a + b, 0);
                                    const isActive = c.id === selectedId;
                                    const deptLabel = c.departmentName || c.branchName || "—";
                                    const programLabel = c.programName || "—";

                                    return (
                                        <div
                                            key={c.id}
                                            onClick={() => setSelectedId(c.id)}
                                            onMouseEnter={() => setHoveredId(c.id)}
                                            onMouseLeave={() => setHoveredId(null)}
                                            style={{
                                                borderRadius: 8,
                                                padding: 10,
                                                marginBottom: 8,
                                                cursor: "pointer",
                                                border: isActive
                                                    ? "1px solid #2f54eb"
                                                    : "1px solid #f0f0f0",
                                                background: isActive ? "#f0f5ff" : hoveredId === c.id ? "#fafcff" : "#fff",
                                                boxShadow: isActive
                                                    ? "0 4px 12px rgba(47,84,235,.16)"
                                                    : hoveredId === c.id
                                                        ? "0 4px 12px rgba(15,23,42,.10)"
                                                        : "0 1px 3px rgba(15,23,42,.04)",
                                                transform: hoveredId === c.id ? "translateY(-1px)" : "translateY(0)",
                                                transition: "box-shadow .2s ease, transform .2s ease, background .2s ease",
                                            }}
                                        >
                                            <Text strong>{c.name}</Text>
                                            <div style={{ fontSize: 12, color: "#595959" }}>
                                                {deptLabel}
                                            </div>
                                            <div style={{ fontSize: 12, marginTop: 4 }}>
                                                Completed: <b>{total}</b> · Rating:{" "}
                                                <b>{c.avgSatisfaction.toFixed(1)}/5</b>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            {filtered.length > 5 && (
                                <div style={{ display: "flex", justifyContent: "center", width: "100%", overflow: "hidden", marginTop: 10 }}>
                                    <Pagination
                                        size="small"
                                        current={facilitatorPage}
                                        pageSize={5}
                                        total={filtered.length}
                                        hideOnSinglePage
                                        showSizeChanger={false}
                                        responsive
                                        showLessItems
                                        onChange={setFacilitatorPage}
                                    />
                                </div>
                            )}
                        </div>
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
                            <Col span={24} style={{ display: "none" }}>
                                <Card title={`Facilitator statistics · ${selected.name}`} style={cardStyle} bodyStyle={{ padding: 14 }}>
                                    <Row gutter={[12, 8]}>
                                        {([
                                            ["Assigned", selectedStats?.assigned, "#1677ff"],
                                            ["Active", selectedStats?.active, "#d48806"],
                                            ["Completed", selectedStats?.completed, "#389e0d"],
                                        ] as const).map(([label, value, color]) => (
                                            <Col xs={12} sm={6} key={label}>
                                                <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
                                                <div style={{ fontSize: 24, fontWeight: 700, color }}>{value ?? 0}</div>
                                            </Col>
                                        ))}
                                    </Row>
                                </Card>
                            </Col>

                            {/* Monthly activity */}
                            <Col xs={24} lg={12}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <div style={cardStyle}>
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                marginBottom: 8,
                                            }}
                                        >
                                            <Text strong>Monthly Activity</Text>
                                            <Button
                                                icon={<ExpandAltOutlined />}
                                                iconPosition="end"
                                                size="small"
                                                onClick={() => setShowMonthly(true)}
                                            >
                                                Expand
                                            </Button>
                                        </div>
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={monthlyOptions}
                                        />
                                    </div>
                                </motion.div>
                            </Col>

                            {/* Quality bubble */}
                            <Col xs={24} lg={12}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <div style={cardStyle}>
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                marginBottom: 8,
                                            }}
                                        >
                                            <Text strong>Quality vs Speed</Text>
                                            <Button
                                                icon={<ExpandAltOutlined />}
                                                iconPosition="end"
                                                size="small"
                                                onClick={() => setShowBubble(true)}
                                            >
                                                Expand
                                            </Button>
                                        </div>
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={bubbleOptions}
                                        />
                                        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 4, fontSize: 12, color: "#595959" }}>
                                            <span><span style={{ color: "#1677ff", fontSize: 16 }}>●</span> Current facilitator</span>
                                            <span><span style={{ color: "#16a34a", fontSize: 16 }}>●</span> Portfolio average</span>
                                        </div>
                                    </div>
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
