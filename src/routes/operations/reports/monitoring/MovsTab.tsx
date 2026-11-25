import React, { useEffect, useMemo, useState } from "react";
import { Col, Empty, Row, Segmented, message, theme } from "antd";
import {
    AuditOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FieldTimeOutlined,
    InboxOutlined,
    SafetyCertificateOutlined,
} from "@ant-design/icons";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import dayjs from "dayjs";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { filterMovRecords, filterReportRecords, loadReportVisibilityContext } from "@/utils/reportVisibility";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { packItems, packStage, safeToDate, type PackStage } from "@/routes/operations/movs/movData";
import { getCanonicalInterventionStatus } from "./interventionStatus";

type Props = {
    programId?: string;
    departmentId?: string;
    dateFrom?: Date;
    dateTo?: Date;
};

/**
 * Where a submitted MOV sits with M&E. A MOV counts as submitted once the
 * Centre Coordinator confirms its monthly pack and passes it on to M&E.
 */
type MeStage = "me" | "verified";

const ME_STAGES: MeStage[] = ["verified", "me"];

const ME_STAGE_LABEL: Record<MeStage, string> = {
    me: "Awaiting M&E",
    verified: "Verified",
};

const PACK_STAGE_LABEL: Record<PackStage, string> = {
    cc: "Awaiting CC",
    me: "Awaiting M&E",
    verified: "Verified",
};

type MovRow = {
    id: string;
    stage: MeStage;
    department: string;
    date: Date | null;
    daysToVerify: number | null;
    assignmentId: string;
};

const approvalDate = (pack: any, step: string): Date | null =>
    safeToDate(((pack?.approvals || []) as any[]).find(a => a?.step === step)?.date);

const packMovIds = (pack: any): string[] =>
    Array.from(
        new Set(
            (Array.isArray(pack?.movIds) ? pack.movIds : packItems(pack).map((m: any) => m?.id))
                .filter(Boolean)
                .map(String)
        )
    );

/** One row per MOV in a pack the Centre Coordinator has passed to M&E. */
const submittedRows = (packs: any[], liveMovs: Map<string, any>): MovRow[] => {
    const rows = new Map<string, MovRow>();
    packs.forEach(pack => {
        const packStageNow = packStage(pack);
        if (packStageNow === "cc") return;
        const stage: MeStage = packStageNow;
        const submittedAt = approvalDate(pack, "final_confirmation");
        const verifiedAt = approvalDate(pack, "validation");
        const snapshots = new Map(packItems(pack).map((m: any) => [String(m?.id || ""), m]));
        packMovIds(pack).forEach(id => {
            // The live MOV first; the pack's snapshot if the live one is gone.
            // Both have already passed the viewer's report-visibility check.
            const mov = liveMovs.get(id) || snapshots.get(id);
            if (!mov) return;
            const existing = rows.get(id);
            if (existing?.stage === "verified") return;
            rows.set(id, {
                id,
                stage,
                department: mov.departmentName || mov.department || pack.department || "Unassigned",
                date: safeToDate(mov.interventionDate || mov.periodEnd || mov.createdAt),
                daysToVerify:
                    stage === "verified" && submittedAt && verifiedAt
                        ? Math.max(0, dayjs(verifiedAt).diff(submittedAt, "day", true))
                        : null,
                assignmentId: String(mov.assignedInterventionId || ""),
            });
        });
    });
    return Array.from(rows.values());
};

// Stacked bars show each segment's count (empty segments stay blank).
const STACKED_WITH_FIGURES = {
    stacking: "normal",
    borderWidth: 0,
    dataLabels: {
        enabled: true,
        filter: { property: "y", operator: ">", value: 0 },
        style: { textOutline: "none", fontWeight: "600" },
    },
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** MOV analytics for M&E: only MOVs submitted to M&E in a confirmed monthly pack. */
export default function MovsTab({ programId, departmentId, dateFrom, dateTo }: Props) {
    const { token } = theme.useToken();
    const { user } = useFullIdentity();

    const [loading, setLoading] = useState(true);
    const [movs, setMovs] = useState<MovRow[]>([]);
    const [packs, setPacks] = useState<any[]>([]);
    const [packUnit, setPackUnit] = useState<"packs" | "movs">("packs");
    const [completedAssignments, setCompletedAssignments] = useState<{ id: string; movId: string; date: Date | null }[]>([]);

    useEffect(() => {
        let cancelled = false;
        const scoped = (name: string) => {
            const parts: any[] = [];
            if (programId) parts.push(where("programId", "==", programId));
            if (departmentId) parts.push(where("departmentId", "==", departmentId));
            return parts.length ? query(collection(db, name), ...parts) : collection(db, name);
        };
        (async () => {
            setLoading(true);
            try {
                const [visibility, movSnap, packSnap, assignmentSnap] = await Promise.all([
                    loadReportVisibilityContext(user?.email),
                    getDocs(scoped("movDocuments")),
                    getDocs(scoped("consolidatedMOVs")),
                    getDocs(scoped("assignedInterventions")),
                ]);
                if (cancelled) return;
                const visible = (snap: typeof movSnap) =>
                    filterReportRecords(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })), user?.email, visibility);
                const visiblePacks = filterMovRecords(packSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })), user?.email);
                const liveMovs = new Map(visible(movSnap).map(m => [m.id, m]));
                setMovs(submittedRows(visiblePacks, liveMovs));
                // Each pack's MOV count, limited to MOVs this viewer may see.
                setPacks(
                    visiblePacks.map(pack => {
                        const snapshotIds = new Set(packItems(pack).map((m: any) => String(m?.id || "")));
                        const movCount = packMovIds(pack).filter(id => liveMovs.has(id) || snapshotIds.has(id)).length;
                        return { ...pack, __movCount: movCount };
                    })
                );
                setCompletedAssignments(
                    visible(assignmentSnap)
                        .filter(a => getCanonicalInterventionStatus(a) === "completed")
                        .map(a => ({
                            id: a.id,
                            movId: String(a.movDocumentId || ""),
                            date: safeToDate(a.completedAt || a.participantConfirmedAt || a.updatedAt),
                        }))
                );
            } catch (error) {
                console.error("[MovsTab] load failed", error);
                message.error("Couldn't load MOVs");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [programId, departmentId, user?.email]);

    const inPeriod = (date: Date | null) => !dateFrom || !dateTo || (!!date && date >= dateFrom && date <= dateTo);

    const periodMovs = useMemo(() => movs.filter(m => inPeriod(m.date)), [movs, dateFrom, dateTo]);

    const counts = useMemo(() => {
        const byStage = Object.fromEntries(ME_STAGES.map(s => [s, 0])) as Record<MeStage, number>;
        periodMovs.forEach(m => (byStage[m.stage] += 1));
        const times = periodMovs.map(m => m.daysToVerify).filter((d): d is number => d !== null);
        return {
            total: periodMovs.length,
            byStage,
            avgDaysToVerify: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
        };
    }, [periodMovs]);

    // Completed work whose MOV has reached M&E; the link can sit on either record.
    const coverage = useMemo(() => {
        const byId = new Set(movs.map(m => m.id));
        const byAssignment = new Set(movs.map(m => m.assignmentId).filter(Boolean));
        const completed = completedAssignments.filter(a => inPeriod(a.date));
        const evidenced = completed.filter(a => byAssignment.has(a.id) || byId.has(a.movId)).length;
        return { completed: completed.length, evidenced };
    }, [movs, completedAssignments, dateFrom, dateTo]);

    const periodPacks = useMemo(
        () =>
            packs.filter(p => {
                if (!dateFrom || !dateTo || !p.month) return true;
                const month = dayjs(p.month, "YYYY-MM");
                return !month.isBefore(dayjs(dateFrom), "month") && !month.isAfter(dayjs(dateTo), "month");
            }),
        [packs, dateFrom, dateTo]
    );

    const packTotals = useMemo(
        () => ({ atCc: periodPacks.filter(p => packStage(p) === "cc").length }),
        [periodPacks]
    );

    const metrics: DashboardMetric[] = [
        { key: "total", title: "Submitted", value: counts.total, icon: <AuditOutlined />, tone: "info", important: true },
        {
            key: "verified",
            title: "Verified",
            value: `${pct(counts.byStage.verified, counts.total)}%`,
            icon: <CheckCircleOutlined />,
            tone: "success",
            important: true,
        },
        { key: "waiting", title: "Awaiting M&E", value: counts.byStage.me, icon: <ClockCircleOutlined />, tone: "warning" },
        { key: "atCc", title: "Packs at CC", value: packTotals.atCc, icon: <InboxOutlined />, tone: "neutral" },
        {
            key: "speed",
            title: "Days to verify",
            value: counts.avgDaysToVerify === null ? "—" : counts.avgDaysToVerify.toFixed(1),
            icon: <FieldTimeOutlined />,
            tone: "neutral",
        },
        {
            key: "coverage",
            title: "Evidence coverage",
            value: coverage.completed ? `${pct(coverage.evidenced, coverage.completed)}%` : "—",
            icon: <SafetyCertificateOutlined />,
            tone: "accent",
            important: true,
        },
    ];

    const stageColor: Record<MeStage, string> = {
        verified: token.colorSuccess,
        me: token.colorWarning,
    };

    const statusOptions = useMemo<Highcharts.Options>(
        () => ({
            chart: { type: "pie", height: 300 },
            title: {
                text: `${counts.total}`,
                verticalAlign: "middle",
                y: 8,
                style: { fontSize: "26px", fontWeight: "700" },
            },
            credits: { enabled: false },
            tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.0f}%)" },
            plotOptions: {
                pie: {
                    innerSize: "68%",
                    borderWidth: 0,
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        distance: 12,
                        format: "{point.y} ({point.percentage:.0f}%)",
                        style: { fontWeight: "600", textOutline: "none" },
                    },
                },
            },
            series: [
                {
                    type: "pie",
                    name: "MOVs",
                    data: ME_STAGES.filter(s => counts.byStage[s] > 0).map(s => ({
                        name: ME_STAGE_LABEL[s],
                        y: counts.byStage[s],
                        color: stageColor[s],
                    })),
                },
            ],
        }),
        [counts, token]
    );

    // Submitted vs verified per month of work.
    const trendOptions = useMemo<Highcharts.Options>(() => {
        const months = Array.from(
            new Set(periodMovs.map(m => (m.date ? dayjs(m.date).format("YYYY-MM") : "")).filter(Boolean))
        ).sort();
        const inMonth = (m: MovRow, key: string) => !!m.date && dayjs(m.date).format("YYYY-MM") === key;
        return {
            chart: { height: 300 },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: months.map(k => dayjs(`${k}-01`).format("MMM YY")) },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
            tooltip: { shared: true },
            plotOptions: {
                column: { borderRadius: 3, borderWidth: 0, dataLabels: { enabled: true } },
                spline: { dataLabels: { enabled: true } },
            },
            series: [
                {
                    type: "column",
                    name: "Submitted",
                    color: "#93c5fd",
                    data: months.map(k => periodMovs.filter(m => inMonth(m, k)).length),
                },
                {
                    type: "spline",
                    name: "Verified",
                    color: token.colorSuccess,
                    data: months.map(k => periodMovs.filter(m => inMonth(m, k) && m.stage === "verified").length),
                },
            ],
        };
    }, [periodMovs, token]);

    const departmentOptions = useMemo<Highcharts.Options>(() => {
        const total = (d: string) => periodMovs.filter(m => m.department === d).length;
        const departments = Array.from(new Set(periodMovs.map(m => m.department))).sort((a, b) => total(b) - total(a));
        return {
            chart: { type: "bar", height: Math.max(260, departments.length * 44 + 90) },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: departments, title: { text: undefined } },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, reversedStacks: false, stackLabels: { enabled: true } },
            tooltip: { shared: true },
            plotOptions: { series: STACKED_WITH_FIGURES as any },
            series: ME_STAGES.map(stage => ({
                type: "bar" as const,
                name: ME_STAGE_LABEL[stage],
                color: stageColor[stage],
                data: departments.map(d => periodMovs.filter(m => m.department === d && m.stage === stage).length),
            })),
        };
    }, [periodMovs, token]);

    // Packs, or the MOVs inside them, per month and stage. Each point carries
    // both figures so the tooltip can show the other one.
    const packOptions = useMemo<Highcharts.Options>(() => {
        const months = Array.from(new Set(periodPacks.map(p => String(p.month || "")).filter(Boolean))).sort();
        const colors: Record<PackStage, string> = { cc: "#3b82f6", me: token.colorWarning, verified: token.colorSuccess };
        const showMovs = packUnit === "movs";
        return {
            chart: { type: "column", height: 300 },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: months.map(k => dayjs(`${k}-01`).format("MMM YY")) },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, reversedStacks: false, stackLabels: { enabled: true } },
            tooltip: {
                shared: true,
                formatter: function () {
                    const points = ((this as any).points || []).filter((p: any) => p.y > 0);
                    const lines = points.map((p: any) => {
                        const { packs: n, movs: m } = p.point.options.custom || {};
                        return `<span style="color:${p.color}">●</span> ${p.series.name}: <b>${n}</b> ${n === 1 ? "pack" : "packs"} · <b>${m}</b> MOVs`;
                    });
                    return `<b>${(this as any).x}</b><br/>${lines.join("<br/>") || "Nothing this month"}`;
                },
            },
            plotOptions: { series: STACKED_WITH_FIGURES as any },
            series: (["verified", "me", "cc"] as PackStage[]).map(stage => ({
                type: "column" as const,
                name: PACK_STAGE_LABEL[stage],
                color: colors[stage],
                data: months.map(k => {
                    const inCell = periodPacks.filter(p => p.month === k && packStage(p) === stage);
                    const movTotal = inCell.reduce((sum, p) => sum + (p.__movCount || 0), 0);
                    return { y: showMovs ? movTotal : inCell.length, custom: { packs: inCell.length, movs: movTotal } };
                }),
            })),
        };
    }, [periodPacks, packUnit, token]);

    if (!loading && !movs.length && !packs.length) {
        return (
            <MotionCard>
                <Empty description="No MOVs have been submitted to M&E yet." />
            </MotionCard>
        );
    }

    const chart = (title: string, options: Highcharts.Options, hasData: boolean) => (
        <MotionCard title={title} loading={loading} skeletonRows={6}>
            {hasData ? <HighchartsReact highcharts={Highcharts} options={options} /> : <Empty description="No data for this period" />}
        </MotionCard>
    );

    return (
        <Row gutter={[16, 16]}>
            <Col span={24}>
                {loading ? <MotionCard loading skeletonRows={2} /> : <MetricsGrid metrics={metrics} compact />}
            </Col>
            <Col xs={24} lg={9}>
                {chart("Status with M&E", statusOptions, counts.total > 0)}
            </Col>
            <Col xs={24} lg={15}>
                {chart("Monthly trend", trendOptions, counts.total > 0)}
            </Col>
            <Col xs={24} lg={14}>
                {chart("Submitted by department", departmentOptions, counts.total > 0)}
            </Col>
            <Col xs={24} lg={10}>
                <MotionCard
                    title="Monthly packs"
                    loading={loading}
                    skeletonRows={6}
                    extra={
                        <Segmented
                            size="small"
                            value={packUnit}
                            onChange={value => setPackUnit(value as "packs" | "movs")}
                            options={[
                                { label: "Packs", value: "packs" },
                                { label: "MOVs", value: "movs" },
                            ]}
                        />
                    }
                >
                    {periodPacks.length > 0 ? (
                        <HighchartsReact highcharts={Highcharts} options={packOptions} />
                    ) : (
                        <Empty description="No data for this period" />
                    )}
                </MotionCard>
            </Col>
        </Row>
    );
}
