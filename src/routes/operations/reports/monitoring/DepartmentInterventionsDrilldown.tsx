import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import Drilldown from "highcharts/modules/drilldown";
import { Card, Col, Empty, Result, Button, Row, Segmented, Skeleton, Space, Statistic, Tag } from "antd";
import dayjs from "dayjs";
import {
    collection,
    getDocs,
    query,
    where,
    DocumentData,
} from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { LoadingOverlay } from "@/components/shared/LoadingOverlay";
import { getCanonicalInterventionStatus } from "./interventionStatus";
import { fetchInterventionsDepartments } from "@/utils/reportingDepartments";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { filterReportRecords, loadReportVisibilityContext } from "@/utils/reportVisibility";
import { rollupReportAssignments } from "@/utils/reportGroupAssignments";

if (typeof Drilldown === "function") Drilldown(Highcharts);

type Props = {
    programId?: string;
    departmentId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    monthIndex?: number;
    year?: number;
    title?: string;
};

type ReportView = "overview" | "timeSeries";

type DrillState =
    | { level: "top" }
    | { level: "department"; department: string }
    | { level: "status"; department: string; status: string }
    | {
        level: "intervention";
        department: string;
        status: string;
        intervention: string;
    };

type InterventionDefinition = {
    title: string;
    hasSubInterventions: boolean;
    subTitlesById: Record<string, string>;
};

const fadeSwitch = {
    initial: { opacity: 0, y: 10, scale: 0.985 },
    animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: 0.24, ease: "easeOut" },
    },
    exit: {
        opacity: 0,
        y: -8,
        scale: 0.985,
        transition: { duration: 0.18, ease: "easeIn" },
    },
};

const tsToDate = (v: any) =>
    v?.toDate?.() ?? (v instanceof Date ? v : undefined);

const inRange = (
    d: Date | undefined,
    p: { dateFrom?: Date; dateTo?: Date; monthIndex?: number; year?: number }
) => {
    if (!d) return false;
    const { dateFrom, dateTo, monthIndex, year } = p;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    if (typeof monthIndex === "number" && typeof year === "number") {
        const dj = dayjs(d);
        if (dj.month() !== monthIndex || dj.year() !== year) return false;
    }
    return true;
};

const normalizeStatus = (s?: string) => {
    const n = String(s || "")
        .toLowerCase()
        .trim()
        .replace(/_/g, "-");

    if (n === "in progress") return "in-progress";
    return n;
};

const niceStatus = (s?: string) => {
    const n = normalizeStatus(s);
    const map: Record<string, string> = {
        completed: "Completed",
        "in-progress": "In Progress",
        pending: "Pending",
        approved: "Approved",
        accepted: "Accepted",
        assigned: "Assigned",
        cancelled: "Cancelled",
        rejected: "Rejected",
        declined: "Declined",
    };
    return map[n] || (n ? n[0].toUpperCase() + n.slice(1) : "Unknown");
};

const STATUS_COLORS: Record<string, string> = {
    assigned: "#1677ff",
    "in-progress": "#faad14",
    completed: "#52c41a",
    declined: "#ff4d4f",
    rejected: "#ff4d4f",
    pending: "#8c8c8c",
    approved: "#13c2c2",
    accepted: "#2f54eb",
    cancelled: "#595959",
    unknown: "#bfbfbf",
};

const getStatusColor = (status?: string) =>
    STATUS_COLORS[normalizeStatus(status) || "unknown"] || STATUS_COLORS.unknown;

const TOP_BAR_COLOR = "#1677ff";

export default function InterventionsDeptDrilldownChart({
    programId,
    departmentId,
    dateFrom,
    dateTo,
    monthIndex,
    year,
    title = "",
}: Props) {
    const { user } = useFullIdentity();
    const chartRef = useRef<HighchartsReact.RefObject>(null);

    const [loading, setLoading] = useState(true);
    const [drillState, setDrillState] = useState<DrillState>({ level: "top" });
    const [drillHistory, setDrillHistory] = useState<DrillState[]>([]);
    const [reportView, setReportView] = useState<ReportView>("overview");

    const [departments, setDepartments] = useState<
        Array<{ id: string; name: string }>
    >([]);
    const [applications, setApplications] = useState<
        Array<{
            id: string;
            participantId?: string;
            interventions?: { required?: Array<{ area?: string }> };
        }>
    >([]);
    const [assigned, setAssigned] = useState<
        Array<{
            id: string;
            participantId?: string;
            status?: string;
            interventionStatus?: string;
            assignmentStatus?: string;
            assigneeAcceptanceStatus?: string;
            participantAcceptanceStatus?: string;
            assigneeCompletionStatus?: string;
            participantCompletionStatus?: string;
            beneficiaryCompletionStatus?: string;
            completionStatus?: string;
            areaOfSupport?: string;
            departmentId?: string;
            departmentName?: string;
            department?: string;
            departmentTitle?: string;
            interventionTitle?: string;
            subInterventionId?: string;
            subInterventionTitle?: string;
            subInterventionName?: string;
            subIntervention?: string;
            snapshot?: any;
            createdAt?: any;
            completedAt?: any;
            updatedAt?: any;
            interventionId?: string;
            programId?: string;
            cycleKey?: string;
            groupAssignmentId?: string;
            groupId?: string;
            groupKey?: string;
        }>
    >([]);
    const [interventions, setInterventions] = useState<
        Record<string, InterventionDefinition>
    >({});

    useEffect(() => {
        const run = async () => {
            setLoading(true);
            try {
                const visibilityContext = await loadReportVisibilityContext(user?.email);
                const scopedProgramId =
                    programId && programId !== "all" ? programId : undefined;

                const deps = await fetchInterventionsDepartments();

                const appFilters: any[] = [];
                if (scopedProgramId)
                    appFilters.push(where("programId", "==", scopedProgramId));

                const appSnap = await getDocs(
                    query(collection(db, "applications"), ...appFilters)
                );

                const apps = filterReportRecords(appSnap.docs.map((d) => {
                    const x = d.data() as DocumentData;
                    return {
                        id: d.id,
                        interventions: {
                            required: Array.isArray(x?.interventions?.required)
                                ? x.interventions.required
                                : [],
                        },
                    };
                }), user?.email, visibilityContext);

                // Assigned-intervention scoped by the programme when available and resolve department
                // ownership through the canonical department fields below.
                const aiFilters: any[] = [];
                if (scopedProgramId)
                    aiFilters.push(where("programId", "==", scopedProgramId));

                const aiSnap = await getDocs(
                    query(collection(db, "assignedInterventions"), ...aiFilters)
                );

                const ai = filterReportRecords(aiSnap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as DocumentData),
                })), user?.email, visibilityContext);

                const intSnap = await getDocs(
                    query(
                        collection(db, "interventions")
                    )
                );

                const intMap: Record<string, InterventionDefinition> = {};
                intSnap.forEach((docu) => {
                    const x = docu.data() as DocumentData;
                    const intTitle = String(
                        x.interventionTitle || x.title || x.name || docu.id
                    );
                    const activeSubs = (Array.isArray(x.subInterventions)
                        ? x.subInterventions
                        : []
                    ).filter((sub: any) => sub?.active !== false && !sub?.archivedAt);
                    const subTitlesById = activeSubs.reduce(
                        (map: Record<string, string>, sub: any) => {
                            const subId = String(sub?.subId || sub?.id || "").trim();
                            const subTitle = String(
                                sub?.title || sub?.name || subId || "Sub-intervention"
                            ).trim();
                            if (subId) map[subId] = subTitle;
                            return map;
                        },
                        {}
                    );
                    const definition: InterventionDefinition = {
                        title: intTitle,
                        hasSubInterventions: activeSubs.length > 0,
                        subTitlesById,
                    };

                    intMap[docu.id] = definition;
                    if (x.interventionId) {
                        intMap[String(x.interventionId)] = definition;
                    }
                });

                setDepartments(deps);
                setApplications(apps);
                setAssigned(ai);
                setInterventions(intMap);
                setDrillState({ level: "top" });
            } finally {
                setLoading(false);
            }
        };

        run();
    }, [programId]);

    const depNameByLower = useMemo(() => {
        const m = new Map<string, string>();
        for (const d of departments) {
            const n = (d.name || "").trim();
            if (n) {
                m.set(n.toLowerCase(), n);
                m.set(d.id.toLowerCase(), n);
            }
        }
        return m;
    }, [departments]);

    const depKeyFromArea = (area?: string) => {
        const k = (area || "").trim().toLowerCase();
        return depNameByLower.get(k);
    };

    const depKeyFromAssigned = (record: {
        areaOfSupport?: string;
        departmentId?: string;
        departmentName?: string;
        department?: string;
        departmentTitle?: string;
    }) =>
        depKeyFromArea(record.departmentId) ||
        depKeyFromArea(record.departmentName) ||
        depKeyFromArea(record.department) ||
        depKeyFromArea(record.departmentTitle) ||
        depKeyFromArea(record.areaOfSupport);

    const filterDeptCanonical = useMemo(() => {
        if (!departmentId) return undefined;
        const rec = departments.find((d) => d.id === departmentId);
        const n = rec?.name?.trim();
        return n || undefined;
    }, [departmentId, departments]);

    const requiredByDept = useMemo(() => {
        const m = new Map<string, number>();
        for (const app of applications) {
            const list = app.interventions?.required ?? [];
            for (const r of list) {
                const key = depKeyFromArea(r.area);
                if (!key) continue;
                if (filterDeptCanonical && key !== filterDeptCanonical) continue;
                m.set(key, (m.get(key) || 0) + 1);
            }
        }
        return m;
    }, [applications, filterDeptCanonical]);

    const statusCountsByDept = useMemo(() => {
        const byDept = new Map<string, Map<string, number>>();
        const byDeptStatusIntervention = new Map<
            string,
            Map<string, Map<string, number>>
        >();
        const byDeptStatusInterventionSub = new Map<
            string,
            Map<string, Map<string, Map<string, number>>>
        >();
        const range = { dateFrom, dateTo, monthIndex, year };

        for (const rollup of rollupReportAssignments(assigned, getCanonicalInterventionStatus)) {
            const ai = rollup.record;
            const canonicalStatus = rollup.status;
            const dates = rollup.members
                .map((member) => tsToDate(
                    canonicalStatus === "completed"
                        ? member.completedAt || member.updatedAt || member.createdAt
                        : member.updatedAt || member.createdAt
                ))
                .filter((date): date is Date => !!date)
                .sort((a, b) => b.getTime() - a.getTime());
            const d = dates[0];

            if (
                (dateFrom ||
                    dateTo ||
                    (typeof monthIndex === "number" && typeof year === "number")) &&
                !inRange(d, range)
            ) {
                continue;
            }

            const dept = depKeyFromAssigned(ai);
            if (!dept) continue;
            if (filterDeptCanonical && dept !== filterDeptCanonical) continue;

            const status = niceStatus(canonicalStatus);
            const definition = interventions[ai.interventionId || ""];
            const intTitle =
                definition?.title || ai.interventionTitle || "Unknown Intervention";

            if (!byDept.has(dept)) byDept.set(dept, new Map());
            const sMap = byDept.get(dept)!;
            sMap.set(status, (sMap.get(status) || 0) + 1);

            if (!byDeptStatusIntervention.has(dept)) {
                byDeptStatusIntervention.set(dept, new Map());
            }
            const dsMap = byDeptStatusIntervention.get(dept)!;
            if (!dsMap.has(status)) dsMap.set(status, new Map());
            const tMap = dsMap.get(status)!;
            tMap.set(intTitle, (tMap.get(intTitle) || 0) + 1);

            const subId = String(ai.subInterventionId || "").trim();
            const subTitle = String(
                ai.subInterventionTitle ||
                ai.subInterventionName ||
                ai.subIntervention ||
                ai.snapshot?.selectedSubIntervention?.title ||
                definition?.subTitlesById[subId] ||
                ""
            ).trim();

            if (definition?.hasSubInterventions && subTitle) {
                if (!byDeptStatusInterventionSub.has(dept)) {
                    byDeptStatusInterventionSub.set(dept, new Map());
                }
                const subStatusMap = byDeptStatusInterventionSub.get(dept)!;
                if (!subStatusMap.has(status)) subStatusMap.set(status, new Map());
                const subInterventionMap = subStatusMap.get(status)!;
                if (!subInterventionMap.has(intTitle)) {
                    subInterventionMap.set(intTitle, new Map());
                }
                const subCounts = subInterventionMap.get(intTitle)!;
                subCounts.set(subTitle, (subCounts.get(subTitle) || 0) + 1);
            }
        }

        return {
            byDept,
            byDeptStatusIntervention,
            byDeptStatusInterventionSub,
        };
    }, [
        assigned,
        interventions,
        dateFrom,
        dateTo,
        monthIndex,
        year,
        filterDeptCanonical,
    ]);

    const computed = useMemo(() => {
        const categories = Array.from(requiredByDept.keys()).sort(
            (a, b) => (requiredByDept.get(b) || 0) - (requiredByDept.get(a) || 0)
        );

        const topPoints = categories.map((dept) => ({
            name: dept,
            y: requiredByDept.get(dept) || 0,
            drilldown: `dept::${dept}`,
            color: TOP_BAR_COLOR,
            custom: { level: "department", department: dept },
        }));

        const dd: Highcharts.SeriesOptionsType[] = [];

        for (const dept of categories) {
            const statusMap = statusCountsByDept.byDept.get(dept) || new Map();

            const statusPoints = Array.from(statusMap.entries())
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => ({
                    name: status,
                    y: count,
                    drilldown: `dept::${dept}::status::${status}`,
                    color: getStatusColor(status),
                    custom: { level: "status", department: dept, status },
                }));

            dd.push({
                type: "bar",
                id: `dept::${dept}`,
                name: `${dept} — Status`,
                data: statusPoints as any[],
            });

            const titlesMap: Map<string, Map<string, number>> =
                statusCountsByDept.byDeptStatusIntervention.get(dept) ??
                new Map<string, Map<string, number>>();

            for (const [status, tMap] of titlesMap.entries()) {
                const tPoints = Array.from(tMap.entries())
                    .filter(([, count]) => count > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([intTitle, count]) => {
                        const subCounts = statusCountsByDept.byDeptStatusInterventionSub
                            .get(dept)
                            ?.get(status)
                            ?.get(intTitle);
                        const hasSubData =
                            !!subCounts &&
                            Array.from(subCounts.values()).some((subCount) => subCount > 0);
                        const subSeriesId = `sub::${encodeURIComponent(
                            dept
                        )}::${encodeURIComponent(status)}::${encodeURIComponent(intTitle)}`;

                        return {
                            name: intTitle,
                            y: count,
                            color: getStatusColor(status),
                            drilldown: hasSubData ? subSeriesId : undefined,
                            custom: hasSubData
                                ? {
                                    level: "intervention",
                                    department: dept,
                                    status,
                                    intervention: intTitle,
                                }
                                : undefined,
                        };
                    });

                dd.push({
                    type: "bar",
                    id: `dept::${dept}::status::${status}`,
                    name: `${dept} — ${status}`,
                    data: tPoints as any[],
                });

                for (const intTitle of tMap.keys()) {
                    const subCounts = statusCountsByDept.byDeptStatusInterventionSub
                        .get(dept)
                        ?.get(status)
                        ?.get(intTitle);
                    if (!subCounts) continue;

                    const subPoints = Array.from(subCounts.entries())
                        .filter(([, count]) => count > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([subTitle, count]) => ({
                            name: subTitle,
                            y: count,
                            color: getStatusColor(status),
                        }));
                    if (!subPoints.length) continue;

                    dd.push({
                        type: "bar",
                        id: `sub::${encodeURIComponent(dept)}::${encodeURIComponent(
                            status
                        )}::${encodeURIComponent(intTitle)}`,
                        name: `${intTitle} - Sub-interventions`,
                        data: subPoints as any[],
                    });
                }
            }
        }

        const anyTop = topPoints.some((p) => (p.y || 0) > 0);

        const subtitle =
            dateFrom || dateTo
                ? `${dateFrom ? dayjs(dateFrom).format("DD MMM YYYY") : "…"} → ${dateTo ? dayjs(dateTo).format("DD MMM YYYY") : "…"
                }`
                : typeof monthIndex === "number" && typeof year === "number"
                    ? dayjs(`${year}-${String(monthIndex + 1).padStart(2, "0")}-01`).format(
                        "MMMM YYYY"
                    )
                    : "All Time";

        return {
            topSeries: [
                {
                    type: "bar" as const,
                    name: "Required interventions",
                    data: topPoints as any[],
                },
            ],
            drilldownSeries: dd,
            hasTopData: anyTop,
            subtitle,
            categories,
            statusCountsByDept,
        };
    }, [requiredByDept, statusCountsByDept, dateFrom, dateTo, monthIndex, year]);

    const departmentSummaries = useMemo(() => {
        return computed.categories.map((department) => {
            const statusMap = computed.statusCountsByDept.byDept.get(department) || new Map<string, number>();
            const total = Array.from(statusMap.values()).reduce((sum, value) => sum + value, 0);
            const completed = statusMap.get("Completed") || 0;
            const active = total - completed;
            return {
                department,
                required: requiredByDept.get(department) || 0,
                assigned: total,
                completed,
                active,
                statusMap,
            };
        });
    }, [computed, requiredByDept]);

    const departmentDeltas = useMemo(() => {
        const result = new Map<string, number>();
        let currentStart: Date | undefined;
        let currentEnd: Date | undefined;
        if (dateFrom && dateTo) {
            currentStart = dateFrom;
            currentEnd = dateTo;
        } else if (typeof monthIndex === "number" && typeof year === "number") {
            currentStart = dayjs(`${year}-${String(monthIndex + 1).padStart(2, "0")}-01`).startOf("month").toDate();
            currentEnd = dayjs(currentStart).endOf("month").toDate();
        }
        if (!currentStart || !currentEnd) return result;
        let previousStart: Date;
        let previousEnd: Date;
        const currentDay = dayjs(currentStart);
        const endDay = dayjs(currentEnd);
        if (currentDay.isSame(currentDay.startOf("year"), "day") && currentEnd.getFullYear() === currentStart.getFullYear()) {
            previousStart = currentDay.subtract(1, "year").startOf("year").toDate();
            previousEnd = endDay.subtract(1, "year").toDate();
        } else if (currentDay.isSame(currentDay.startOf("month"), "day") && endDay.isSame(endDay.endOf("month"), "day")) {
            previousStart = currentDay.subtract(1, "month").startOf("month").toDate();
            previousEnd = currentDay.subtract(1, "month").endOf("month").toDate();
        } else if (currentDay.isSame(currentDay.startOf("week"), "day") && endDay.isSame(endDay.endOf("week"), "day")) {
            previousStart = currentDay.subtract(1, "week").startOf("week").toDate();
            previousEnd = currentDay.subtract(1, "week").endOf("week").toDate();
        } else {
            const duration = currentEnd.getTime() - currentStart.getTime() + 1;
            previousStart = new Date(currentStart.getTime() - duration);
            previousEnd = new Date(currentStart.getTime() - 1);
        }
        const current = new Map<string, number>();
        const previous = new Map<string, number>();
        rollupReportAssignments(assigned, getCanonicalInterventionStatus).forEach((rollup) => {
            if (rollup.status !== "completed") return;
            const date = rollup.members
                .map((member) => tsToDate(member.completedAt || member.updatedAt || member.createdAt))
                .filter((value): value is Date => !!value)
                .sort((a, b) => b.getTime() - a.getTime())[0];
            const department = depKeyFromAssigned(rollup.record);
            if (!date || !department) return;
            if (date >= currentStart! && date <= currentEnd!) current.set(department, (current.get(department) || 0) + 1);
            if (date >= previousStart && date <= previousEnd) previous.set(department, (previous.get(department) || 0) + 1);
        });
        departments.forEach((department) => {
            result.set(department.name, (current.get(department.name) || 0) - (previous.get(department.name) || 0));
        });
        return result;
    }, [assigned, dateFrom, dateTo, monthIndex, year, departments]);

    const priorPeriodLabel = useMemo(() => {
        if (dateFrom && dateTo) {
            if (dayjs(dateFrom).isSame(dayjs(dateFrom).startOf("year"), "day") && dateTo.getFullYear() === dateFrom.getFullYear()) {
                return `same period last year (${dayjs(dateFrom).subtract(1, "year").format("DD MMM YYYY")} – ${dayjs(dateTo).subtract(1, "year").format("DD MMM YYYY")})`;
            }
            const duration = dateTo.getTime() - dateFrom.getTime() + 1;
            return `previous ${Math.round(duration / 86400000)} days (${dayjs(new Date(dateFrom.getTime() - duration)).format("DD MMM YYYY")} – ${dayjs(new Date(dateFrom.getTime() - 1)).format("DD MMM YYYY")})`;
        }
        if (typeof monthIndex === "number" && typeof year === "number") {
            return `previous month (${dayjs(`${year}-${String(monthIndex + 1).padStart(2, "0")}-01`).subtract(1, "month").format("MMMM YYYY")})`;
        }
        return undefined;
    }, [dateFrom, dateTo, monthIndex, year]);

    const compactPriorPeriodLabel = useMemo(() => {
        if (dateFrom && dateTo) {
            if (dayjs(dateFrom).isSame(dayjs(dateFrom).startOf("year"), "day") && dateTo.getFullYear() === dateFrom.getFullYear()) return "same period last year";
            if (dayjs(dateFrom).isSame(dayjs(dateFrom).startOf("month"), "day") && dayjs(dateTo).isSame(dayjs(dateTo).endOf("month"), "day")) return "last month";
            if (dayjs(dateFrom).isSame(dayjs(dateFrom).startOf("week"), "day") && dayjs(dateTo).isSame(dayjs(dateTo).endOf("week"), "day")) return "last week";
            const selectedDays = dayjs(dateTo).startOf("day").diff(dayjs(dateFrom).startOf("day"), "day") + 1;
            return `last ${selectedDays} days`;
        }
        if (typeof monthIndex === "number" && typeof year === "number") return "last month";
        return undefined;
    }, [dateFrom, dateTo, monthIndex, year]);

    const openDepartment = (department: string) => {
        setDrillHistory([{ level: "top" }]);
        setDrillState({ level: "department", department });
    };

    const returnToCards = () => {
        setDrillHistory([]);
        setDrillState({ level: "top" });
        setReportView("overview");
    };

    const activeDrillSeries = useMemo(() => {
        if (drillState.level === "top") return computed.topSeries;
        const id =
            drillState.level === "department"
                ? `dept::${drillState.department}`
                : drillState.level === "status"
                    ? `dept::${drillState.department}::status::${drillState.status}`
                    : `sub::${encodeURIComponent(drillState.department)}::${encodeURIComponent(drillState.status)}::${encodeURIComponent(drillState.intervention)}`;
        const series = computed.drilldownSeries.find((item: any) => item.id === id);
        return series ? [series] : computed.topSeries;
    }, [computed, drillState]);

    const timeSeriesOptions = useMemo<Highcharts.Options>(() => {
        const selectedDepartment = drillState.level === "top" ? filterDeptCanonical : drillState.department;
        const buckets = new Map<string, { date: Date; assigned: Set<string>; completed: Set<string>; inProgress: Set<string> }>();
        rollupReportAssignments(assigned, getCanonicalInterventionStatus).forEach((rollup) => {
            const record = rollup.record;
            const date = rollup.members
                .map((member) => tsToDate(member.completedAt || member.updatedAt || member.createdAt))
                .filter((value): value is Date => !!value)
                .sort((a, b) => b.getTime() - a.getTime())[0];
            const department = depKeyFromAssigned(record);
            if (!date || !department) return;
            if (selectedDepartment && department !== selectedDepartment) return;
            if ((dateFrom || dateTo || typeof monthIndex === "number") && !inRange(date, { dateFrom, dateTo, monthIndex, year })) return;
            const key = dayjs(date).startOf("month").format("YYYY-MM");
            if (!buckets.has(key)) buckets.set(key, { date: dayjs(date).startOf("month").toDate(), assigned: new Set(), completed: new Set(), inProgress: new Set() });
            const bucket = buckets.get(key)!;
            const assignmentKey = rollup.key;
            bucket.assigned.add(assignmentKey);
            if (rollup.status === "completed") bucket.completed.add(assignmentKey);
            else bucket.inProgress.add(assignmentKey);
        });
        const ordered = Array.from(buckets.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
        return {
            chart: { type: "column", height: 430 },
            title: { text: selectedDepartment ? `${selectedDepartment} intervention activity over time` : "Intervention activity over time" },
            subtitle: { text: computed.subtitle },
            credits: { enabled: false },
            xAxis: { categories: ordered.map((item) => dayjs(item.date).format("MMM YYYY")) },
            yAxis: { min: 0, allowDecimals: false, title: { text: "Unique assigned interventions" } },
            tooltip: { shared: true },
            plotOptions: {
                column: { borderRadius: 4, dataLabels: { enabled: true } },
                spline: { marker: { enabled: true, radius: 3 }, dataLabels: { enabled: true } },
            },
            series: [
                { type: "spline", name: "Assigned", data: ordered.map((item) => item.assigned.size), color: "#1677ff", zIndex: 3 },
                { type: "column", name: "Completed", data: ordered.map((item) => item.completed.size), color: "#52c41a" },
                { type: "column", name: "In Progress", data: ordered.map((item) => item.inProgress.size), color: "#faad14" },
            ],
        };
    }, [assigned, computed.subtitle, dateFrom, dateTo, monthIndex, year, departments, drillState, filterDeptCanonical]);

    const noDataMessage = useMemo(() => {
        if (drillState.level === "top") {
            return {
                title: "No data for this selection",
                subTitle:
                    "There are no department intervention records for the current filters.",
            };
        }

        if (drillState.level === "department") {
            return {
                title: `No status data for ${drillState.department}`,
                subTitle:
                    "This department has no assigned intervention activity for the selected filters.",
            };
        }

        if (drillState.level === "status") {
            return {
                title: `No interventions for ${drillState.status}`,
                subTitle: `There are no intervention titles under ${drillState.department} → ${drillState.status} for the selected filters.`,
            };
        }

        return {
            title: `No sub-interventions for ${drillState.intervention}`,
            subTitle: `There is no sub-intervention activity under ${drillState.department} → ${drillState.status} → ${drillState.intervention}.`,
        };
    }, [drillState]);

    const options: Highcharts.Options = useMemo(
        () => ({
            chart: {
                type: "bar",
                height: 540,
                spacingRight: 40,
                events: {
                    drilldown(e) {
                        const custom = (e.point as any)?.options?.custom as
                            | Exclude<DrillState, { level: "top" }>
                            | undefined;

                        if (!custom) return;

                        setDrillHistory((prev) => [...prev, drillState]);
                        setDrillState(custom);
                    },
                    drillup() {
                        setDrillHistory((prev) => {
                            if (!prev.length) {
                                setDrillState({ level: "top" });
                                return prev;
                            }

                            const next = [...prev];
                            const previousState = next.pop() || { level: "top" as const };
                            setDrillState(previousState);
                            return next;
                        });
                    },
                },
            },
            credits: { enabled: false },
            title: { text: title },
            subtitle: { text: `` },
            xAxis: {
                type: "category",
                title: {
                    text:
                        drillState.level === "top"
                            ? "Department"
                            : drillState.level === "department"
                                ? "Status"
                                : drillState.level === "status"
                                    ? "Intervention"
                                    : "Sub-intervention",
                },
            },
            yAxis: {
                min: 0,
                title: { text: "Count" },
                allowDecimals: false,
                gridLineDashStyle: "Dash",
            },
            legend: {
                enabled: false,
            },
            tooltip: {
                pointFormat: "<b>{point.y}</b>",
            },
            plotOptions: {
                series: {
                    dataLabels: { enabled: true },
                    animation: false,
                    borderRadius: 6,
                    pointPadding: 0.08,
                    groupPadding: 0.12,
                } as any,
            },
            series: activeDrillSeries,
            drilldown: {
                allowPointDrilldown: true,
                breadcrumbs: {
                    position: { align: "right" },
                },
                series: computed.drilldownSeries,
            },
        }),
        [title, computed, drillState, activeDrillSeries]
    );

    const currentViewHasData = useMemo(() => {
        if (drillState.level === "top") {
            return computed.hasTopData;
        }

        if (drillState.level === "department") {
            const statusMap = computed.statusCountsByDept.byDept.get(
                drillState.department
            );
            if (!statusMap) return false;
            return Array.from(statusMap.values()).some((count) => count > 0);
        }

        if (drillState.level === "status") {
            const titlesMap = computed.statusCountsByDept.byDeptStatusIntervention
                .get(drillState.department)
                ?.get(drillState.status);

            if (!titlesMap) return false;
            return Array.from(titlesMap.values()).some((count) => count > 0);
        }

        const subMap = computed.statusCountsByDept.byDeptStatusInterventionSub
            .get(drillState.department)
            ?.get(drillState.status)
            ?.get(drillState.intervention);

        if (!subMap) return false;
        return Array.from(subMap.values()).some((count) => count > 0);
    }, [drillState, computed]);

    const handleEmptyStateBack = () => {
        setDrillHistory((prev) => {
            if (!prev.length) {
                setDrillState({ level: "top" });
                return prev;
            }

            const next = [...prev];
            const previousState = next.pop() || { level: "top" as const };
            setDrillState(previousState);
            return next;
        });
    };

    const canGoBack = drillState.level !== "top";

    return (
        <div>
            {loading ? (
                <div style={{ padding: "8px 4px" }}>
                    <Skeleton active title={{ width: 220 }} paragraph={false} />
                    <Skeleton.Node
                        active
                        style={{ width: "100%", height: 300, marginTop: 16 }}
                    >
                        {null}
                    </Skeleton.Node>
                </div>
            ) : !computed.hasTopData ? (
                <Empty description="No data available for the selected filters." />
            ) : (
                <div>
                    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                        <Col>
                            <Space size={8}>
                                {drillState.level !== "top" && (
                                    <Button
                                        size="small"
                                        shape='round'
                                        icon={<ArrowLeftOutlined />}
                                        iconPosition="start"
                                        onClick={returnToCards}>Back to departments</Button>
                                )}
                                {(drillState.level !== "top" || filterDeptCanonical) && (
                                    <Tag color="purple">
                                        Department: {drillState.level !== "top" ? drillState.department : filterDeptCanonical}
                                    </Tag>
                                )}
                                <Tag color="blue">{computed.categories.length} intervention departments</Tag>
                                <Tag color="green">{departmentSummaries.reduce((sum, item) => sum + item.required, 0)} required</Tag>
                            </Space>
                        </Col>
                        <Col>
                            <Segmented
                                value={reportView}
                                onChange={(value) => {
                                    setReportView(value as ReportView);
                                }}
                                options={[{ label: "Overview", value: "overview" }, { label: "Time Series", value: "timeSeries" }]}
                            />
                        </Col>
                    </Row>

                    {reportView === "timeSeries" ? (
                        <Card>
                            <HighchartsReact highcharts={Highcharts} options={timeSeriesOptions} />
                        </Card>
                    ) : (
                        <>
                            {drillState.level === "top" && (
                                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                    {departmentSummaries.map((item) => (
                                        <Col xs={24} sm={12} lg={8} xl={6} key={item.department}>
                                            <Card
                                                size="small"
                                                title={item.department}
                                                hoverable
                                                onClick={() => openDepartment(item.department)}
                                                headStyle={{ padding: "0 10px", minHeight: 32, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                                bodyStyle={{ padding: "8px 10px" }}
                                                style={{ height: "100%", border: "1px solid #dbe4f0", borderRadius: 10, boxShadow: "0 4px 14px rgba(15, 23, 42, 0.10)", overflow: "hidden" }}
                                            >
                                                <Row gutter={4}>
                                                    {[["Required", item.required, "#1f2937"], ["Assigned", item.assigned, "#1677ff"], ["Active", item.active, "#d48806"], ["Completed", item.completed, "#389e0d"]].map(([label, value, color]) => (
                                                        <Col span={6} key={label as string}>
                                                            <div style={{ fontSize: 10, color: "#8c8c8c", lineHeight: 1.1 }}>{label}</div>
                                                            <div style={{ fontSize: 17, fontWeight: 700, color: color as string, lineHeight: 1.2 }}>{value as number}</div>
                                                        </Col>
                                                    ))}
                                                </Row>
                                                <Space wrap size={[3, 3]} style={{ marginTop: 3 }}>
                                                    {departmentDeltas.has(item.department) && (
                                                        <Tag title={compactPriorPeriodLabel ? `Completed interventions compared with ${compactPriorPeriodLabel}` : undefined} color={(departmentDeltas.get(item.department) || 0) > 0 ? "blue" : (departmentDeltas.get(item.department) || 0) < 0 ? "red" : "default"}>
                                                            Δ {(departmentDeltas.get(item.department) || 0) > 0 ? "+" : ""}{departmentDeltas.get(item.department) || 0} completed{compactPriorPeriodLabel ? ` vs ${compactPriorPeriodLabel}` : ""}
                                                        </Tag>
                                                    )}
                                                </Space>
                                            </Card>
                                        </Col>
                                    ))}
                                </Row>
                            )}
                            <AnimatePresence mode="wait" initial={false}>
                                {drillState.level === "top" ? null : !currentViewHasData ? (
                                    <motion.div
                                        key="empty-state"
                                        variants={fadeSwitch}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                    >
                                        <Result
                                            status="info"
                                            title={noDataMessage.title}
                                            subTitle={noDataMessage.subTitle}
                                            extra={
                                                canGoBack ? (
                                                    <Button onClick={handleEmptyStateBack}>Go Back</Button>
                                                ) : undefined
                                            }
                                        />
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="chart-state"
                                        variants={fadeSwitch}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                    >
                                        <HighchartsReact
                                            ref={chartRef as any}
                                            highcharts={Highcharts}
                                            options={options}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
