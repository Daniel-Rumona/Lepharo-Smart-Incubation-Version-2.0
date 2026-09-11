// InterventionsByDepartmentChart.tsx
import React, { useEffect, useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { Card, Empty, Skeleton } from "antd";
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
import { getCanonicalInterventionStatus } from "./interventionStatus";

type Props = {
    programId?: string;
    /** Filter completed by updatedAt: either date range OR month/year */
    dateFrom?: Date;
    dateTo?: Date;
    monthIndex?: number; // 0..11
    year?: number;
    title?: string;
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

const asDate = (v: any): Date | undefined =>
    v?.toDate?.() ??
    (v instanceof Date ? v : typeof v === "string" ? new Date(v) : undefined);

export default function InterventionsByDepartmentChart({
    programId,
    monthIndex,
    year,
    dateFrom,
    dateTo,
    title = "Required vs Completed by Department",
}: Props) {
    const { user } = useFullIdentity();
    const [loading, setLoading] = useState(true);

    const [departments, setDepartments] = useState<
        Array<{ id: string; name: string }>
    >([]);
    const [applications, setApplications] = useState<
        Array<{
            id: string;
            interventions?: { required?: Array<{ area?: string }> };
        }>
    >([]);
    const [assigned, setAssigned] = useState<
        Array<{
            id: string;
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
            createdAt?: any;
            completedAt?: any;
            updatedAt?: any;
            programId?: string;
        }>
    >([]);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                // Departments
                const depSnap = await getDocs(
                    query(
                        collection(db, "departments"),
                    )
                );
                const deps = depSnap.docs.map((d) => {
                    const x = d.data() as DocumentData;
                    return { id: d.id, name: String(x.name ?? "") };
                });

                // Applications (required[])
                const appFilters: any[] = [];
                if (programId) appFilters.push(where("programId", "==", programId));
                const appSnap = await getDocs(
                    query(collection(db, "applications"))
                );
                const apps = appSnap.docs.map((d) => {
                    const x = d.data() as DocumentData;
                    return {
                        id: d.id,
                        interventions: {
                            required: Array.isArray(x?.interventions?.required)
                                ? x.interventions.required
                                : [],
                        },
                    };
                });

                // AssignedInterventions (completed via updatedAt)
                const asnFilters: any[] = [];
                if (programId) asnFilters.push(where("programId", "==", programId));
                const asnSnap = await getDocs(
                    query(collection(db, "assignedInterventions"), ...asnFilters)
                );
                const a = asnSnap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as DocumentData),
                }));

                setDepartments(deps);
                setApplications(apps);
                setAssigned(a);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [programId]);

    const { categories, series, subtitle, hasData } = useMemo(() => {
        const depNames = departments.map((d) => d.name).filter(Boolean);
        const depNameByKey = new Map<string, string>(); // lower → original
        for (const n of depNames) depNameByKey.set(n.trim().toLowerCase(), n);

        const keyFromArea = (area?: string) => {
            const k = (area || "").trim().toLowerCase();
            return depNameByKey.get(k) || "Unmapped";
        };

        const required = new Map<string, number>();
        const completed = new Map<string, number>();

        // Required: applications.interventions.required[].area → departments.name
        for (const app of applications) {
            const list = app.interventions?.required ?? [];
            for (const r of list) {
                const key = keyFromArea(r.area);
                required.set(key, (required.get(key) || 0) + 1);
            }
        }

        // Completed: assignedInterventions where status===completed; date filter on updatedAt
        const filterByMonth =
            typeof monthIndex === "number" && typeof year === "number";
        for (const ai of assigned) {
            if (getCanonicalInterventionStatus(ai) !== "completed") continue;
            const d = tsToDate(ai.completedAt || ai.updatedAt || ai.createdAt);
            if (!inRange(d, { dateFrom, dateTo, monthIndex, year })) continue;
            const key = keyFromArea(ai.areaOfSupport);
            completed.set(key, (completed.get(key) || 0) + 1);
        }

        const cats = Array.from(
            new Set([...required.keys(), ...completed.keys()])
        ).sort(
            (a, b) =>
                (required.get(b) || 0) - (required.get(a) || 0) ||
                (completed.get(b) || 0) - (completed.get(a) || 0)
        );

        const series = [
            {
                type: "bar" as const,
                name: "Required",
                data: cats.map((c) => required.get(c) || 0),
            },
            {
                type: "bar" as const,
                name: "Completed",
                data: cats.map((c) => completed.get(c) || 0),
            },
        ];

        const subtitle = filterByMonth
            ? dayjs(
                `${year}-${String((monthIndex ?? 0) + 1).padStart(2, "0")}-01`
            ).format("MMMM YYYY")
            : "All Time";

        const hasData =
            cats.length > 0 &&
            (series[0].data.some((v) => v > 0) || series[1].data.some((v) => v > 0));
        return { categories: cats, series, subtitle, hasData };
    }, [departments, applications, assigned, monthIndex, year, dateFrom, dateTo]);

    const options: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "bar", height: 480, spacingRight: 40 },
            credits: { enabled: false },
            title: { text: title },
            subtitle: { text: `By Department — ${subtitle}` },
            xAxis: { type: "category", categories },
            yAxis: { min: 0, title: { text: "Count" }, allowDecimals: false },
            legend: { enabled: true },
            tooltip: { shared: true },
            plotOptions: {
                series: { animation: false, dataLabels: { enabled: true } } as any,
            },
            series,
        }),
        [categories, series, subtitle, title]
    );

    return (
        <div>
            {loading ? (
                <div style={{ minHeight: 360 }} aria-busy="true" aria-label="Loading intervention chart">
                    <Skeleton active title={{ width: 180 }} paragraph={false} />
                    <Skeleton.Node active style={{ width: "100%", height: 300, marginTop: 16 }} />
                </div>
            ) : !hasData ? (
                <Empty description="No data available for the selected filters." />
            ) : (
                <HighchartsReact highcharts={Highcharts} options={options} />
            )}
        </div>
    );
}
