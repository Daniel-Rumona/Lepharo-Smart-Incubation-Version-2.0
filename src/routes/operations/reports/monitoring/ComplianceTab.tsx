import React, { useEffect, useMemo, useState } from "react";
import { Typography, message } from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import dayjs from "dayjs";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { filterReportRecords, loadReportVisibilityContext } from "@/utils/reportVisibility";
import ComplianceSnapshot from "@/routes/projectadmin/reports/ComplianceSnapshot";
import { buildComplianceModel } from "@/routes/projectadmin/reports/complianceModel";
import { loadComplianceSource, type ComplianceSource } from "@/routes/projectadmin/reports/complianceData";

const { Text } = Typography;

type Props = {
    programId?: string;
    dateFrom?: Date;
    dateTo?: Date;
};

const toDate = (value: any): Date | null => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const chunk = <T,>(items: T[], size = 10) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/**
 * Programme-wide compliance in figures, the same snapshot (and the same
 * numbers) as the project admin reports: onboarding agreements, and each
 * programme's master document list. Per-SME follow-up lives on the Compliance page.
 */
export default function ComplianceTab({ programId, dateFrom, dateTo }: Props) {
    const { user } = useFullIdentity();
    const [loading, setLoading] = useState(true);
    const [apps, setApps] = useState<any[]>([]);
    const [source, setSource] = useState<ComplianceSource | null>(null);
    const [romConfirmed, setRomConfirmed] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [visibility, appSnap, participantSnap] = await Promise.all([
                    loadReportVisibilityContext(user?.email),
                    getDocs(
                        programId
                            ? query(collection(db, "applications"), where("programId", "==", programId))
                            : collection(db, "applications")
                    ),
                    getDocs(collection(db, "participants")),
                ]);
                const accepted = filterReportRecords(
                    appSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
                    user?.email,
                    visibility
                ).filter(a => String(a.applicationStatus || "").trim().toLowerCase() === "accepted");
                const participantById = new Map(participantSnap.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }]));

                // GAP Analyses the ROM has confirmed, as the project admin report reads them.
                const participantIds = Array.from(new Set(accepted.map(a => String(a.participantId || "")).filter(Boolean)));
                const confirmed = new Set<string>();
                const [loaded] = await Promise.all([
                    loadComplianceSource(accepted, participantById),
                    ...chunk(participantIds).map(async ids => {
                        const snap = await getDocs(query(collection(db, "gapAnalysis"), where("participantId", "in", ids)));
                        snap.forEach(s => {
                            const g: any = s.data();
                            const status = String(g?.romReview?.status || g?.confirmationStatus || "").toLowerCase().trim();
                            if (status === "confirmed" && g?.participantId) confirmed.add(String(g.participantId));
                        });
                    }),
                ]);
                if (cancelled) return;
                setApps(accepted);
                setSource(loaded as ComplianceSource);
                setRomConfirmed(confirmed);
            } catch (error) {
                console.error("[ComplianceTab] load failed", error);
                message.error("Couldn't load compliance");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [programId, user?.email]);

    // SMEs onboarded in the period (by application date), as on the project admin report.
    const inPeriod = useMemo(
        () =>
            apps.filter(a => {
                const submitted = toDate(a.submittedAt);
                return !dateFrom || !dateTo || (!!submitted && submitted >= dateFrom && submitted <= dateTo);
            }),
        [apps, dateFrom, dateTo]
    );

    // Months for the trend, from the first onboarding in the period (so "All time" isn't decades wide).
    const months = useMemo(() => {
        const dates = inPeriod.map(a => toDate(a.submittedAt)).filter((d): d is Date => !!d);
        if (!dates.length) return [] as string[];
        const first = dayjs(Math.min(...dates.map(d => d.getTime())));
        const start = dateFrom && dayjs(dateFrom).isAfter(first) ? dayjs(dateFrom) : first;
        const end = dayjs(dateTo || new Date());
        const keys: string[] = [];
        for (let cur = start.startOf("month"); !cur.isAfter(end, "month"); cur = cur.add(1, "month")) {
            keys.push(cur.format("YYYY-MM"));
        }
        return keys;
    }, [inPeriod, dateFrom, dateTo]);

    const model = useMemo(() => {
        if (!source) return null;
        const ids = new Set(inPeriod.map(a => a.id));
        return buildComplianceModel({
            records: source.records.filter(r => ids.has(r.appId)),
            requirementsByProgram: source.requirementsByProgram,
            templates: source.templates,
            romConfirmed,
            monthKeys: months,
            monthKeyOf: record => {
                const d = toDate(record.application?.submittedAt);
                return d ? dayjs(d).format("YYYY-MM") : null;
            },
            monthLabel: key => dayjs(`${key}-01`).format("MMM YYYY"),
        });
    }, [source, inPeriod, romConfirmed, months]);

    const trendOptions: Highcharts.Options | null = model
        ? {
            // No fixed height: the chart fills its card beside Onboarding compliance.
            chart: { type: "column" },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: model.trend.categories },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
            tooltip: { shared: true },
            plotOptions: {
                column: {
                    borderRadius: 3,
                    dataLabels: { enabled: true, filter: { property: "y", operator: ">", value: 0 } },
                },
            },
            series: [
                { type: "column", name: "Onboarded", data: model.trend.onboarded },
                { type: "column", name: "GAP Analysis signed", data: model.trend.gap },
                { type: "column", name: "Pre-incubation signed", data: model.trend.pre },
                { type: "column", name: "MOA signed", data: model.trend.moa },
            ],
        }
        : null;

    return (
        <>
            <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 12 }}>
                Measured against each programme's full document list, for SMEs onboarded in the period. Follow up
                individual SMEs on the Compliance page, which shows your department's own documents.
            </Text>
            <ComplianceSnapshot
                model={model}
                loading={loading}
                trend={
                    trendOptions && model?.trend.onboarded.some(v => v > 0) ? (
                        <HighchartsReact highcharts={Highcharts} options={trendOptions} />
                    ) : null
                }
            />
        </>
    );
}
