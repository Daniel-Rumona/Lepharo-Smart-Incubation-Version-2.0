import React, { useMemo, useState } from "react";
import { Card, Col, Empty, Row, Select, Space, Tag } from "antd";
import dayjs from "dayjs";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { REPORT_CHART_COLORS, REPORT_CHART_PALETTE } from "./reportChartTheme";
import { buildReachMonthlyDrilldownOptions } from "./reachDrilldownOptions";

export type ReachIntervention = {
    participantId?: string | null;
    areaOfSupport?: string | null;
    interventionTitle?: string | null;
    createdAt?: unknown;
    updatedAt?: unknown;
    acceptedAt?: unknown;
    completedAt?: unknown;
};

export type ReachParticipant = {
    id?: string;
    gender?: string;
    idNumber?: string;
    sector?: string | string[];
    beeLevel?: string | number;
    bbeeeLevel?: string | number;
    youthOwnedPercent?: number;
    blackOwnedPercent?: number;
    femaleOwnedPercent?: number;
    ward?: string | string[];
    hub?: string | string[];
};

type Props = {
    interventions: ReachIntervention[];
    participants: Map<string, ReachParticipant>;
    emptyDescription?: string;
};

const label = (value: unknown, fallback = "Unknown") => {
    const text = Array.isArray(value) ? value[0] : value;
    return String(text ?? "").trim() || fallback;
};

const toDate = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
    if (typeof value?._seconds === "number")
        return new Date(value._seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getAge = (idNumber?: string): number | null => {
    const value = String(idNumber || "").trim();
    if (!/^\d{6}/.test(value)) return null;
    const yy = Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4)) - 1;
    const day = Number(value.slice(4, 6));
    const now = new Date();
    const year = yy <= now.getFullYear() % 100 ? 2000 + yy : 1900 + yy;
    const birthDate = new Date(year, month, day);
    if (Number.isNaN(birthDate.getTime())) return null;
    let age = now.getFullYear() - birthDate.getFullYear();
    const monthDelta = now.getMonth() - birthDate.getMonth();
    if (
        monthDelta < 0 ||
        (monthDelta === 0 && now.getDate() < birthDate.getDate())
    )
        age--;
    return age;
};

const AGE_BUCKETS = [
    { label: "15-24", min: 15, max: 24 },
    { label: "25-34", min: 25, max: 34 },
    { label: "35-44", min: 35, max: 44 },
    { label: "45-54", min: 45, max: 54 },
    { label: "55-64", min: 55, max: 64 },
    { label: "65+", min: 65, max: 200 },
];

const countBy = (
    values: ReachParticipant[],
    selector: (value: ReachParticipant) => string
) =>
    values.reduce<Record<string, number>>((counts, value) => {
        const key = selector(value);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});

const donutOptions = (
    counts: Record<string, number>,
    seriesName: string
): Highcharts.Options => ({
    chart: { type: "pie", height: 320 },
    title: { text: "" },
    credits: { enabled: false },
    tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
    plotOptions: {
        pie: {
            innerSize: "60%",
            showInLegend: true,
            dataLabels: { enabled: true, format: "{point.name}: {point.y}" },
        },
    },
    series: [
        {
            type: "pie",
            name: seriesName,
            data: Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([name, y], index) => ({
                    name,
                    y,
                    color: REPORT_CHART_PALETTE[index % REPORT_CHART_PALETTE.length],
                })),
        },
    ],
});

const Chart: React.FC<{
    title: React.ReactNode;
    options: Highcharts.Options;
    hasData: boolean;
    emptyDescription: string;
}> = ({ title, options, hasData, emptyDescription }) => (
    <Card
        title={title}
        style={{ borderRadius: 12, border: "1px solid #d6e4ff", height: "100%" }}
        bodyStyle={{ minHeight: 340 }}
    >
        {hasData ? (
            <HighchartsReact highcharts={Highcharts} options={options} />
        ) : (
            <Empty description={emptyDescription} style={{ marginTop: 90 }} />
        )}
    </Card>
);

export const ReachReportsPanel: React.FC<Props> = ({
    interventions,
    participants,
    emptyDescription = "No reach data in selected range",
}) => {
    const [department, setDepartment] = useState("all");
    const [intervention, setIntervention] = useState("all");

    const departments = useMemo(
        () =>
            Array.from(
                new Set(interventions.map((row) => label(row.areaOfSupport, "Other")))
            ).sort(),
        [interventions]
    );
    const departmentRows = useMemo(
        () =>
            department === "all"
                ? interventions
                : interventions.filter(
                    (row) => label(row.areaOfSupport, "Other") === department
                ),
        [department, interventions]
    );
    const interventionTitles = useMemo(
        () =>
            Array.from(
                new Set(
                    departmentRows.map((row) => label(row.interventionTitle, "Untitled"))
                )
            ).sort(),
        [departmentRows]
    );
    const rows = useMemo(
        () =>
            intervention === "all"
                ? departmentRows
                : departmentRows.filter(
                    (row) => label(row.interventionTitle, "Untitled") === intervention
                ),
        [departmentRows, intervention]
    );
    const reachedParticipants = useMemo(() => {
        const map = new Map<string, ReachParticipant>();
        rows.forEach((row) => {
            if (!row.participantId || map.has(row.participantId)) return;
            const participant = participants.get(row.participantId);
            map.set(row.participantId, participant || { id: row.participantId });
        });
        return map;
    }, [participants, rows]);
    const people = Array.from(reachedParticipants.values());

    const monthly = useMemo(() => {
        const touches: Record<string, number> = {};
        const smes: Record<string, Set<string>> = {};
        rows.forEach((row) => {
            const date =
                toDate(row.completedAt) ||
                toDate(row.acceptedAt) ||
                toDate(row.updatedAt) ||
                toDate(row.createdAt);
            if (!date) return;
            const key = dayjs(date).format("YYYY-MM");
            touches[key] = (touches[key] || 0) + 1;
            if (row.participantId) {
                if (!smes[key]) smes[key] = new Set();
                smes[key].add(row.participantId);
            }
        });
        const keys = Array.from(
            new Set([...Object.keys(touches), ...Object.keys(smes)])
        ).sort();
        return {
            keys,
            categories: keys.map((key) => dayjs(`${key}-01`).format("MMM YYYY")),
            touches: keys.map((key) => touches[key] || 0),
            smes: keys.map((key) => smes[key]?.size || 0),
        };
    }, [rows]);

    const genderCounts = useMemo(
        () => countBy(people, (person) => label(person.gender)),
        [people]
    );
    const sectorCounts = useMemo(
        () => countBy(people, (person) => label(person.sector)),
        [people]
    );
    const beeCounts = useMemo(
        () =>
            countBy(people, (person) => label(person.beeLevel || person.bbeeeLevel)),
        [people]
    );
    const localityCounts = useMemo(
        () => countBy(people, (person) => label(person.ward || person.hub)),
        [people]
    );
    const age = useMemo(() => {
        const male = AGE_BUCKETS.map(
            (bucket) =>
                people.filter((person) => {
                    const value = getAge(person.idNumber);
                    return (
                        value != null &&
                        value >= bucket.min &&
                        value <= bucket.max &&
                        label(person.gender).toLowerCase() === "male"
                    );
                }).length
        );
        const female = AGE_BUCKETS.map(
            (bucket) =>
                people.filter((person) => {
                    const value = getAge(person.idNumber);
                    return (
                        value != null &&
                        value >= bucket.min &&
                        value <= bucket.max &&
                        label(person.gender).toLowerCase() === "female"
                    );
                }).length
        );
        return { male, female };
    }, [people]);
    const ownership = useMemo(() => {
        const divisor = Math.max(people.length, 1);
        return [
            +(
                people.reduce(
                    (sum, item) => sum + Number(item.youthOwnedPercent || 0),
                    0
                ) / divisor
            ).toFixed(1),
            +(
                people.reduce(
                    (sum, item) => sum + Number(item.blackOwnedPercent || 0),
                    0
                ) / divisor
            ).toFixed(1),
            +(
                people.reduce(
                    (sum, item) => sum + Number(item.femaleOwnedPercent || 0),
                    0
                ) / divisor
            ).toFixed(1),
        ];
    }, [people]);

    const monthlyOptions = buildReachMonthlyDrilldownOptions(
        rows.flatMap((row) => {
            const date =
                toDate(row.completedAt) ||
                toDate(row.acceptedAt) ||
                toDate(row.updatedAt) ||
                toDate(row.createdAt);
            return date
                ? [
                    {
                        date,
                        interventionTitle: label(row.interventionTitle, "Untitled"),
                        participantId: row.participantId,
                    },
                ]
                : [];
        }),
        { monthKeys: monthly.keys, height: 320 }
    );
    const ageOptions: Highcharts.Options = {
        chart: { type: "bar", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: [
            {
                categories: AGE_BUCKETS.map((bucket) => bucket.label),
                reversed: false,
            },
            {
                categories: AGE_BUCKETS.map((bucket) => bucket.label),
                reversed: false,
                opposite: true,
                linkedTo: 0,
            },
        ],
        yAxis: {
            title: { text: null },
            labels: {
                formatter: function () {
                    return Math.abs(Number(this.value)).toString();
                },
            },
        },
        plotOptions: { series: { stacking: "normal" } },
        series: [
            {
                type: "bar",
                name: "Male",
                color: REPORT_CHART_COLORS.primary,
                data: age.male.map((value) => -value),
            },
            {
                type: "bar",
                name: "Female",
                color: REPORT_CHART_COLORS.success,
                data: age.female,
            },
        ],
    };
    const ownershipOptions: Highcharts.Options = {
        chart: { type: "column", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: { categories: ["Youth", "Black", "Female"] },
        yAxis: { min: 0, max: 100, title: { text: "Percent" } },
        plotOptions: {
            column: { dataLabels: { enabled: true, format: "{point.y}%" } },
        },
        series: [
            {
                type: "column",
                name: "Average %",
                color: REPORT_CHART_COLORS.primary,
                data: ownership,
            },
        ],
    };

    const female3040 = people.filter((person) => {
        const value = getAge(person.idNumber);
        return (
            label(person.gender).toLowerCase().startsWith("female") &&
            value != null &&
            value >= 30 &&
            value <= 40
        );
    }).length;
    const scope =
        intervention !== "all"
            ? intervention
            : department !== "all"
                ? department
                : "All interventions";

    return (
        <>
            <Card style={{ marginBottom: 16, borderRadius: 12 }}>
                <Space wrap>
                    <Select
                        value={department}
                        style={{ minWidth: 220 }}
                        onChange={(value) => {
                            setDepartment(value);
                            setIntervention("all");
                        }}
                        options={[
                            { label: "All departments", value: "all" },
                            ...departments.map((value) => ({ label: value, value })),
                        ]}
                    />
                    <Select
                        value={intervention}
                        style={{ minWidth: 240 }}
                        onChange={(value) => {
                            setIntervention(value);
                        }}
                        options={[
                            { label: "All interventions", value: "all" },
                            ...interventionTitles.map((value) => ({ label: value, value })),
                        ]}
                    />
                    <Tag color="blue">SMEs reached: {reachedParticipants.size}</Tag>
                    <Tag color="green">Female 30-40: {female3040}</Tag>
                    <Tag color="orange">Interventions delivered: {rows.length}</Tag>
                </Space>
            </Card>

            <Row gutter={[16, 16]}>
                <Col xs={24}>
                    <Chart
                        title="SMEs Reached vs Interventions Delivered — click a month to drill down"
                        options={monthlyOptions}
                        hasData={
                            monthly.smes.some(Boolean) || monthly.touches.some(Boolean)
                        }
                        emptyDescription={emptyDescription}
                    />
                </Col>
                <Col xs={24} lg={12}>
                    <Chart
                        title={`SMEs Reached by Gender — ${scope}`}
                        options={donutOptions(genderCounts, "SMEs")}
                        hasData={Object.values(genderCounts).some(Boolean)}
                        emptyDescription={emptyDescription}
                    />
                </Col>
                <Col xs={24} lg={12}>
                    <Chart
                        title={`SMEs Reached by Age — ${scope}`}
                        options={ageOptions}
                        hasData={age.male.some(Boolean) || age.female.some(Boolean)}
                        emptyDescription={emptyDescription}
                    />
                </Col>
                <Col xs={24} lg={12}>
                    <Chart
                        title={`SMEs Reached by Sector — ${scope}`}
                        options={donutOptions(sectorCounts, "SMEs")}
                        hasData={Object.values(sectorCounts).some(Boolean)}
                        emptyDescription={emptyDescription}
                    />
                </Col>
                <Col xs={24} lg={12}>
                    <Chart
                        title="Ownership Breakdown (Average %)"
                        options={ownershipOptions}
                        hasData={ownership.some(Boolean)}
                        emptyDescription={emptyDescription}
                    />
                </Col>
                <Col xs={24} lg={12}>
                    <Chart
                        title="B-BBEE / Education Breakdown"
                        options={donutOptions(beeCounts, "SMEs")}
                        hasData={Object.values(beeCounts).some(Boolean)}
                        emptyDescription={emptyDescription}
                    />
                </Col>
                <Col xs={24}>
                    <Chart
                        title="Ward / Locality Distribution"
                        options={donutOptions(localityCounts, "SMEs")}
                        hasData={Object.values(localityCounts).some(Boolean)}
                        emptyDescription={emptyDescription}
                    />
                </Col>
            </Row>
        </>
    );
};

export default ReachReportsPanel;
