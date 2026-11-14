import React, { useMemo, useState } from "react";
import { Avatar, Col, Empty, Row, Segmented, Skeleton, Tooltip, Typography, theme } from "antd";
import {
    DollarOutlined,
    FileTextOutlined,
    RightOutlined,
    RiseOutlined,
    CalendarOutlined,
} from "@ant-design/icons";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricTile } from "@/components/dashboards/metrics/MetricTile";
import "./finance.css";
import type { DashboardDateRange } from "@/lib/useDashboardDateRange";
import { useDataColor } from "@/lib/chartColors";
import {
    aggregateMonths,
    compactMoney,
    inPeriod,
    latestIndex,
    monthName,
    monthStart,
    seriesPeriodStats,
    type FinanceClientLike,
} from "./financeMonths";

const { Text } = Typography;

const money = (value: number) =>
    `R ${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

/** The most urgent SMEs shown in Needs attention; the card does not scroll. */
const MAX_ATTENTION_ROWS = 5;

const MOMENTUM_LABELS = { growing: "Growing", flat: "Flat", declining: "Declining" } as const;

/** A fall of this much on the month before puts an SME on the attention list. */
const DECLINE_ALERT_PERCENT = -20;

type AttentionItem<T> = {
    client: T;
    reason: string;
    tone: "error" | "warning" | "default";
    rank: number;
};

type Props<T extends FinanceClientLike> = {
    /** Supported SMEs in the current scope. */
    clients: T[];
    /** True once every SME's figures have loaded. */
    ready: boolean;
    dateRange: DashboardDateRange;
    /** e.g. "This month", from the topbar filter. */
    periodLabel: string;
    onOpenClient: (client: T) => void;
};

function FinanceOverview<T extends FinanceClientLike>({
    clients,
    ready,
    dateRange,
    periodLabel,
    onOpenClient,
}: Props<T>) {
    const { token } = theme.useToken();
    // Neutral data colour: the accent unless it would read as a judgement (crimson).
    const dataColour = useDataColor();
    const [trendView, setTrendView] = useState<"revenue" | "profit">("revenue");

    const perClient = useMemo(
        () =>
            clients.map((client) => ({
                client,
                stats: seriesPeriodStats(client.monthlyFinance || [], dateRange, client.revenue),
            })),
        [clients, dateRange],
    );

    const programmeMonths = useMemo(
        () => aggregateMonths(clients.map((client) => client.monthlyFinance || [])),
        [clients],
    );
    const periodMonths = useMemo(
        () => programmeMonths.filter((row) => inPeriod(row, dateRange)),
        [programmeMonths, dateRange],
    );

    const periodRevenue = perClient.reduce((sum, { stats }) => sum + Number(stats.periodRevenue || 0), 0);

    const latest = useMemo(() => {
        const i = latestIndex(programmeMonths, dateRange);
        if (i < 0) return null;
        const current = Number(programmeMonths[i].revenue || 0);
        const previous = i > 0 ? Number(programmeMonths[i - 1].revenue || 0) : null;
        const change = previous && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
        return { label: monthName(programmeMonths[i]), revenue: current, change };
    }, [programmeMonths, dateRange]);

    const momentum = useMemo(() => {
        const counts = { growing: 0, flat: 0, declining: 0 };
        perClient.forEach(({ stats }) => {
            if (stats.momentum) counts[stats.momentum]++;
        });
        return counts;
    }, [perClient]);

    const documentCount = clients.reduce((sum, client) => sum + (client.documents?.length || 0), 0);
    const withoutDocuments = clients.filter((client) => !client.loadingStats && !client.documents?.length).length;

    const attention = useMemo(() => {
        const items: AttentionItem<T>[] = [];
        perClient.forEach(({ client, stats }) => {
            if (client.loadingStats) return;
            if (client.statsError) {
                items.push({ client, reason: "Finance data failed to load", tone: "error", rank: 0 });
                return;
            }
            const change = stats.latest?.change;
            if (change !== null && change !== undefined && change <= DECLINE_ALERT_PERCENT) {
                items.push({
                    client,
                    reason: `Revenue down ${Math.abs(change)}% in ${stats.latest?.label}`,
                    tone: "error",
                    // Bigger falls first.
                    rank: 1 + (100 + change) / 1000,
                });
                return;
            }
            if (dateRange && client.monthlyFinance?.length && !stats.periodRevenue) {
                items.push({ client, reason: "No revenue recorded in this period", tone: "warning", rank: 2 });
                return;
            }
            if (!client.documents?.length) {
                items.push({ client, reason: "No financial documents", tone: "default", rank: 3 });
            }
        });
        return items.sort((a, b) => a.rank - b.rank);
    }, [perClient, dateRange]);

    const chartOptions = useMemo<Highcharts.Options>(() => {
        const isRevenue = trendView === "revenue";
        const starts = periodMonths.map(monthStart);
        const spansYears = new Set(starts.filter(Boolean).map((s) => s!.year())).size > 1;
        const values = periodMonths.map((row) => Number((isRevenue ? row.revenue : row.profit) || 0));

        return {
            chart: {
                type: isRevenue ? "areaspline" : "column",
                height: 260,
                backgroundColor: "transparent",
                spacing: [8, 4, 4, 4],
            },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            legend: { enabled: false },
            xAxis: {
                categories: periodMonths.map((row, i) =>
                    starts[i] ? starts[i]!.format(spansYears ? "MMM 'YY" : "MMM") : row.monthLabel || row.month,
                ),
                tickLength: 0,
                labels: { style: { fontSize: "11px" } },
            },
            yAxis: {
                title: { text: undefined },
                tickAmount: 5,
                plotLines: isRevenue ? [] : [{ value: 0, width: 1, color: token.colorTextQuaternary, zIndex: 3 }],
                labels: {
                    style: { fontSize: "11px" },
                    formatter: function () {
                        return compactMoney(Number(this.value || 0));
                    },
                },
            },
            tooltip: {
                formatter: function () {
                    // Highcharts 12 binds `this` to the point; older versions to a context with `.point`.
                    const ctx = this as any;
                    const row = periodMonths[Number(ctx.point?.index ?? ctx.index)];
                    return `<b>${row ? monthName(row) : ""}</b><br/>${isRevenue ? "Revenue" : "Profit / loss"}: <b>${money(
                        Number(ctx.y || 0),
                    )}</b>`;
                },
            },
            plotOptions: {
                areaspline: {
                    marker: { radius: 3, symbol: "circle" },
                    lineWidth: 2,
                    fillColor: {
                        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                        stops: [
                            [0, Highcharts.color(dataColour).setOpacity(0.28).get("rgba") as string],
                            [1, Highcharts.color(dataColour).setOpacity(0).get("rgba") as string],
                        ],
                    },
                },
                column: { borderRadius: 3, borderWidth: 0, maxPointWidth: 36 },
            },
            series: [
                isRevenue
                    ? { type: "areaspline", name: "Revenue", color: dataColour, data: values }
                    : {
                        type: "column",
                        name: "Profit / loss",
                        data: values.map((y) => ({
                            y,
                            color: y > 0 ? token.colorSuccess : y < 0 ? token.colorError : token.colorTextQuaternary,
                        })),
                    },
            ],
        };
    }, [periodMonths, trendView, token, dataColour]);

    const momentumColors = {
        growing: token.colorSuccess,
        flat: token.colorTextQuaternary,
        declining: token.colorError,
    };

    return (
        <>
            <Row data-guide="finance-metrics" gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
                <Col xs={24} sm={12} xl={6}>
                    <MetricTile
                        icon={<DollarOutlined />}
                        tone="success"
                        title={dateRange ? "Revenue in period" : "Total revenue"}
                        value={<Tooltip title={money(periodRevenue)}>{compactMoney(periodRevenue)}</Tooltip>}
                        subtitle={`${periodLabel} · ${clients.length} supported SME${clients.length === 1 ? "" : "s"}`}
                        loading={!ready}
                        wrapperStyle={{ height: "100%" }}
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MetricTile
                        icon={<CalendarOutlined />}
                        tone="info"
                        title={latest ? `${latest.label} revenue` : "Latest month"}
                        value={
                            latest ? (
                                <Tooltip title={money(latest.revenue)}>{compactMoney(latest.revenue)}</Tooltip>
                            ) : (
                                "—"
                            )
                        }
                        trend={
                            latest?.change !== null && latest?.change !== undefined
                                ? {
                                    value: `${Math.abs(latest.change)}%`,
                                    direction: latest.change > 0 ? "up" : latest.change < 0 ? "down" : "flat",
                                }
                                : undefined
                        }
                        subtitle="Against the month before"
                        loading={!ready}
                        wrapperStyle={{ height: "100%" }}
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MetricTile
                        icon={<RiseOutlined />}
                        tone="info"
                        title="SME momentum"
                        value={`${momentum.growing} growing`}
                        subtitle={`${momentum.flat} flat · ${momentum.declining} declining`}
                        loading={!ready}
                        wrapperStyle={{ height: "100%" }}
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MetricTile
                        icon={<FileTextOutlined />}
                        tone="info"
                        title="Financial documents"
                        value={documentCount.toLocaleString()}
                        subtitle={withoutDocuments ? `${withoutDocuments} SME${withoutDocuments === 1 ? "" : "s"} with none` : "Every SME has documents"}
                        loading={!ready}
                        wrapperStyle={{ height: "100%" }}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
                <Col xs={24} lg={16}>
                    <MotionCard style={{ height: "100%" }} styles={{ body: { padding: 20 } }}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 12,
                                flexWrap: "wrap",
                                marginBottom: 8,
                            }}
                        >
                            <div>
                                <Text strong style={{ fontSize: 15 }}>Programme {trendView === "revenue" ? "revenue" : "profit / loss"}</Text>
                                <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                                    All supported SMEs, by month · {periodLabel}
                                </Text>
                            </div>
                            <Segmented
                                size="small"
                                value={trendView}
                                onChange={(value) => setTrendView(value as "revenue" | "profit")}
                                options={[
                                    { label: "Revenue", value: "revenue" },
                                    { label: "Profit / loss", value: "profit" },
                                ]}
                            />
                        </div>
                        {!ready ? (
                            <Skeleton active paragraph={{ rows: 6 }} />
                        ) : periodMonths.length ? (
                            <HighchartsReact highcharts={Highcharts} options={chartOptions} />
                        ) : (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    programmeMonths.length
                                        ? "No finance data in this period."
                                        : "No monthly finance data yet."
                                }
                                style={{ padding: "48px 0" }}
                            />
                        )}
                    </MotionCard>
                </Col>

                <Col xs={24} lg={8}>
                    <MotionCard style={{ height: "100%" }} styles={{ body: { padding: 20 } }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                            <Text strong style={{ fontSize: 15 }}>Needs attention</Text>
                            {ready && attention.length ? <Text type="secondary" style={{ fontSize: 12 }}>{attention.length} SMEs</Text> : null}
                        </div>

                        {/* Momentum split */}
                        {ready && clients.length ? (
                            <div style={{ marginBottom: 14 }}>
                                <div
                                    role="img"
                                    aria-label={`Growing ${momentum.growing}, flat ${momentum.flat}, declining ${momentum.declining}`}
                                    style={{
                                        display: "flex",
                                        gap: 2,
                                        height: 6,
                                        borderRadius: 999,
                                        overflow: "hidden",
                                        background: token.colorFillSecondary,
                                    }}
                                >
                                    {(Object.keys(momentum) as Array<keyof typeof momentum>)
                                        .filter((key) => momentum[key] > 0)
                                        .map((key) => (
                                            <div key={key} style={{ flex: momentum[key], background: momentumColors[key] }} />
                                        ))}
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: "4px 14px",
                                        marginTop: 8,
                                        fontSize: 12,
                                    }}
                                >
                                    {(Object.keys(momentum) as Array<keyof typeof momentum>).map((key) => (
                                        <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                            <span
                                                aria-hidden="true"
                                                style={{ width: 8, height: 8, borderRadius: 999, background: momentumColors[key] }}
                                            />
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {MOMENTUM_LABELS[key]}
                                            </Text>
                                            <Text strong style={{ fontSize: 12 }}>{momentum[key]}</Text>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {!ready ? (
                            <Skeleton active avatar paragraph={{ rows: 4 }} />
                        ) : attention.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing needs attention." style={{ padding: "32px 0" }} />
                        ) : (
                            <>
                                {/* Only the most urgent fit here; the card never scrolls. */}
                                <div style={{ display: "grid", gap: 2, marginInline: -8 }}>
                                    {attention.slice(0, MAX_ATTENTION_ROWS).map(({ client, reason, tone }) => (
                                        <button
                                            key={client.id}
                                            type="button"
                                            className="finance-attention-row"
                                            onClick={() => onOpenClient(client)}
                                        >
                                            <Avatar size={28} style={{ flex: "0 0 auto" }}>
                                                {client.name.charAt(0).toUpperCase()}
                                            </Avatar>
                                            <span style={{ minWidth: 0, flex: 1, textAlign: "left", lineHeight: 1.3 }}>
                                                <Text strong ellipsis style={{ display: "block", fontSize: 13 }}>
                                                    {client.name}
                                                </Text>
                                                <Text
                                                    ellipsis
                                                    style={{
                                                        display: "block",
                                                        fontSize: 12,
                                                        color:
                                                            tone === "error"
                                                                ? token.colorError
                                                                : tone === "warning"
                                                                    ? token.colorWarning
                                                                    : token.colorTextSecondary,
                                                    }}
                                                >
                                                    {reason}
                                                </Text>
                                            </span>
                                            <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
                                        </button>
                                    ))}
                                </div>
                                {attention.length > MAX_ATTENTION_ROWS ? (
                                    <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 8 }}>
                                        +{attention.length - MAX_ATTENTION_ROWS} more. Sort the table by Change to see them.
                                    </Text>
                                ) : null}
                            </>
                        )}
                    </MotionCard>
                </Col>
            </Row>
        </>
    );
}

export default FinanceOverview;
