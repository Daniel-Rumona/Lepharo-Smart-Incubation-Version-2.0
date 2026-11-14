import React, { useEffect, useMemo, useState } from "react";
import { Col, Empty, Row, message, theme } from "antd";
import {
    AuditOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    FieldTimeOutlined,
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
import { packStage, safeToDate, type PackStage } from "@/routes/operations/movs/movData";
import { getCanonicalInterventionStatus } from "./interventionStatus";

type Props = {
    programId?: string;
    departmentId?: string;
    dateFrom?: Date;
    dateTo?: Date;
};

/** The stored MOV lifecycle (types/mov.ts). */
type MovStage = "draft" | "awaiting_smme" | "awaiting_hod" | "queried" | "rejected" | "approved";

const STAGES: MovStage[] = ["approved", "awaiting_hod", "awaiting_smme", "queried", "rejected", "draft"];

const STAGE_LABEL: Record<MovStage, string> = {
    draft: "Draft",
    awaiting_smme: "Awaiting SME",
    awaiting_hod: "Awaiting HOD",
    queried: "Queried",
    rejected: "Rejected",
    approved: "Approved",
};

const PACK_STAGE_LABEL: Record<PackStage, string> = {
    cc: "Awaiting CC",
    me: "Awaiting M&E",
    verified: "Verified",
};

type MovRow = {
    id: string;
    stage: MovStage;
    department: string;
    date: Date | null;
    daysToApprove: number | null;
    assignmentId: string;
};

const stageOf = (mov: any): MovStage => {
    if (mov?.approvedByHod === true) return "approved";
    const status = String(mov?.status || "").toLowerCase();
    return (STAGES as string[]).includes(status) ? (status as MovStage) : "draft";
};

const toRow = (id: string, mov: any): MovRow => {
    const stage = stageOf(mov);
    const smeConfirmed = safeToDate(mov.smmeSignedAt || mov.smmeAcceptedAt);
    const approvedAt = safeToDate(mov.hodApprovedAt);
    return {
        id,
        stage,
        department: mov.departmentName || mov.department || "Unassigned",
        date: safeToDate(mov.interventionDate || mov.periodEnd || mov.createdAt),
        daysToApprove:
            stage === "approved" && smeConfirmed && approvedAt
                ? Math.max(0, dayjs(approvedAt).diff(smeConfirmed, "day", true))
                : null,
        assignmentId: String(mov.assignedInterventionId || ""),
    };
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** MOV analytics for M&E: status, trend, departments and monthly packs. */
export default function MovsTab({ programId, departmentId, dateFrom, dateTo }: Props) {
    const { token } = theme.useToken();
    const { user } = useFullIdentity();

    const [loading, setLoading] = useState(true);
    const [movs, setMovs] = useState<MovRow[]>([]);
    const [packs, setPacks] = useState<any[]>([]);
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
                setMovs(visible(movSnap).map(m => toRow(m.id, m)));
                setPacks(filterMovRecords(packSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })), user?.email));
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
        const byStage = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<MovStage, number>;
        periodMovs.forEach(m => (byStage[m.stage] += 1));
        const times = periodMovs.map(m => m.daysToApprove).filter((d): d is number => d !== null);
        return {
            total: periodMovs.length,
            byStage,
            avgDaysToApprove: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
        };
    }, [periodMovs]);

    // Completed work with an approved MOV; the link can sit on either record.
    const coverage = useMemo(() => {
        const approved = movs.filter(m => m.stage === "approved");
        const byId = new Set(approved.map(m => m.id));
        const byAssignment = new Set(approved.map(m => m.assignmentId).filter(Boolean));
        const completed = completedAssignments.filter(a => inPeriod(a.date));
        const evidenced = completed.filter(a => byAssignment.has(a.id) || byId.has(a.movId)).length;
        return { completed: completed.length, evidenced };
    }, [movs, completedAssignments, dateFrom, dateTo]);

    const metrics: DashboardMetric[] = [
        { key: "total", title: "MOVs", value: counts.total, icon: <AuditOutlined />, tone: "info", important: true },
        {
            key: "approved",
            title: "Approved",
            value: `${pct(counts.byStage.approved, counts.total)}%`,
            subtitle: `${counts.byStage.approved} MOVs`,
            icon: <CheckCircleOutlined />,
            tone: "success",
            important: true,
        },
        {
            key: "waiting",
            title: "Waiting",
            value: counts.byStage.awaiting_smme + counts.byStage.awaiting_hod,
            icon: <ClockCircleOutlined />,
            tone: "warning",
        },
        {
            key: "pushedBack",
            title: "Queried / rejected",
            value: counts.byStage.queried + counts.byStage.rejected,
            icon: <ExclamationCircleOutlined />,
            tone: "danger",
        },
        {
            key: "speed",
            title: "Days to approve",
            value: counts.avgDaysToApprove === null ? "—" : counts.avgDaysToApprove.toFixed(1),
            icon: <FieldTimeOutlined />,
            tone: "neutral",
        },
        {
            key: "coverage",
            title: "Evidence coverage",
            value: coverage.completed ? `${pct(coverage.evidenced, coverage.completed)}%` : "—",
            subtitle: coverage.completed ? `${coverage.evidenced} of ${coverage.completed} completed` : undefined,
            icon: <SafetyCertificateOutlined />,
            tone: "accent",
            important: true,
        },
    ];

    // Fixed blues for the waiting stages: the theme's primary and info colours
    // follow the brand accent (red here), which read as "rejected".
    const stageColor: Record<MovStage, string> = {
        approved: token.colorSuccess,
        awaiting_hod: "#3b82f6",
        awaiting_smme: "#93c5fd",
        queried: token.colorWarning,
        rejected: token.colorError,
        draft: token.colorTextQuaternary,
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
                pie: { innerSize: "68%", borderWidth: 0, dataLabels: { enabled: false }, showInLegend: true },
            },
            series: [
                {
                    type: "pie",
                    name: "MOVs",
                    data: STAGES.filter(s => counts.byStage[s] > 0).map(s => ({
                        name: STAGE_LABEL[s],
                        y: counts.byStage[s],
                        color: stageColor[s],
                    })),
                },
            ],
        }),
        [counts, token]
    );

    // Generated vs approved per month of work.
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
            plotOptions: { column: { borderRadius: 3, borderWidth: 0 } },
            series: [
                {
                    type: "column",
                    name: "Generated",
                    color: "#93c5fd",
                    data: months.map(k => periodMovs.filter(m => inMonth(m, k)).length),
                },
                {
                    type: "spline",
                    name: "Approved",
                    color: token.colorSuccess,
                    data: months.map(k => periodMovs.filter(m => inMonth(m, k) && m.stage === "approved").length),
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
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, reversedStacks: false },
            tooltip: { shared: true },
            plotOptions: { series: { stacking: "normal", borderWidth: 0 } as any },
            series: STAGES.map(stage => ({
                type: "bar" as const,
                name: STAGE_LABEL[stage],
                color: stageColor[stage],
                data: departments.map(d => periodMovs.filter(m => m.department === d && m.stage === stage).length),
            })),
        };
    }, [periodMovs, token]);

    const periodPacks = useMemo(
        () =>
            packs.filter(p => {
                if (!dateFrom || !dateTo || !p.month) return true;
                const month = dayjs(p.month, "YYYY-MM");
                return !month.isBefore(dayjs(dateFrom), "month") && !month.isAfter(dayjs(dateTo), "month");
            }),
        [packs, dateFrom, dateTo]
    );

    const packOptions = useMemo<Highcharts.Options>(() => {
        const months = Array.from(new Set(periodPacks.map(p => String(p.month || "")).filter(Boolean))).sort();
        const colors: Record<PackStage, string> = { cc: "#3b82f6", me: token.colorWarning, verified: token.colorSuccess };
        return {
            chart: { type: "column", height: 300 },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: months.map(k => dayjs(`${k}-01`).format("MMM YY")) },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, reversedStacks: false },
            tooltip: { shared: true },
            plotOptions: { series: { stacking: "normal", borderWidth: 0 } as any },
            series: (["verified", "me", "cc"] as PackStage[]).map(stage => ({
                type: "column" as const,
                name: PACK_STAGE_LABEL[stage],
                color: colors[stage],
                data: months.map(k => periodPacks.filter(p => p.month === k && packStage(p) === stage).length),
            })),
        };
    }, [periodPacks, token]);

    if (!loading && !movs.length) {
        return (
            <MotionCard>
                <Empty description="No MOVs yet." />
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
                {loading ? <MotionCard loading skeletonRows={2} /> : <MetricsGrid metrics={metrics} />}
            </Col>
            <Col xs={24} lg={9}>
                {chart("Status", statusOptions, counts.total > 0)}
            </Col>
            <Col xs={24} lg={15}>
                {chart("Monthly trend", trendOptions, counts.total > 0)}
            </Col>
            <Col xs={24} lg={14}>
                {chart("By department", departmentOptions, counts.total > 0)}
            </Col>
            <Col xs={24} lg={10}>
                {chart("Monthly packs", packOptions, periodPacks.length > 0)}
            </Col>
        </Row>
    );
}
