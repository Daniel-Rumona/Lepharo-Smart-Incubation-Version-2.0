import React, { useMemo } from "react";
import {
    Card,
    Col,
    Empty,
    Progress,
    Row,
    Space,
    Typography,
    theme,
} from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { motion } from "framer-motion";
import dayjs, { type Dayjs } from "dayjs";

import type { AssignedIntervention } from "../reportingTypes";
import {
    average,
    cardStyle,
    completionDate,
    createdDate,
    isReportCompleted,
    REPORT_COLORS,
    turnaroundDays,
    visibleDataLabels,
    withLabels,
} from "../reportingUtils";
import InterventionsCompletionCard from "./InterventionsCompletionCard";

const { Text, Title } = Typography;

interface OverviewReportViewProps {
    filteredRows: AssignedIntervention[];
    scopedRows: AssignedIntervention[];
    dateRange: [Dayjs, Dayjs];
    neededTotal: number;
    completedTotal: number;
    remainingTotal: number;
}

const OverviewReportView: React.FC<
    OverviewReportViewProps
> = ({
    filteredRows,
    scopedRows,
    dateRange,
    neededTotal,
    completedTotal,
    remainingTotal,
}) => {
        const { token } = theme.useToken();

        /**
         * Overall health is currently based on how much
         * of the total required intervention demand
         * has been completed.
         */
        const overallHealth = neededTotal
            ? Math.round(
                (completedTotal / neededTotal) * 100
            )
            : 0;

        const remainingRate = neededTotal
            ? Math.round(
                (remainingTotal / neededTotal) * 100
            )
            : 0;

        const healthMeta = useMemo(() => {
            if (overallHealth >= 75) {
                return {
                    title: "Healthy progress",
                    description:
                        "Most required interventions have been completed. Remaining work is relatively limited.",
                    color: token.colorSuccess,
                };
            }

            if (overallHealth >= 50) {
                return {
                    title: "Progressing well",
                    description:
                        "More than half of the required interventions have been completed, with some delivery still outstanding.",
                    color: token.colorPrimary,
                };
            }

            if (overallHealth >= 25) {
                return {
                    title: "Progress underway",
                    description:
                        "Delivery is active, but a significant portion of required interventions is still outstanding.",
                    color: token.colorWarning,
                };
            }

            return {
                title: "Needs attention",
                description:
                    "A large proportion of required interventions is still outstanding and may require closer follow-up.",
                color: token.colorError,
            };
        }, [
            overallHealth,
            token.colorError,
            token.colorPrimary,
            token.colorSuccess,
            token.colorWarning,
        ]);

        const gapRows = [
            {
                key: "needed",
                label: "Required",
                count: neededTotal,
                percent: neededTotal > 0 ? 100 : 0,
                color: REPORT_COLORS.assigned,
            },
            {
                key: "completed",
                label: "Completed",
                count: completedTotal,
                percent: overallHealth,
                color: REPORT_COLORS.completed,
            },
            {
                key: "remaining",
                label: "Remaining",
                count: remainingTotal,
                percent: remainingRate,
                color: REPORT_COLORS.pending,
            },
        ];

        const monthlyData = useMemo(() => {
            const map: Record<
                string,
                {
                    completed: number;
                    turnaround: number[];
                    feedback: number[];
                }
            > = {};

            scopedRows.forEach((row) => {
                const completed =
                    completionDate(row);

                const activityDate =
                    completed || createdDate(row);

                if (!activityDate) return;

                const key =
                    activityDate.format(
                        "YYYY-MM"
                    );

                if (!map[key]) {
                    map[key] = {
                        completed: 0,
                        turnaround: [],
                        feedback: [],
                    };
                }

                if (
                    isReportCompleted(row)
                ) {
                    map[key].completed += 1;

                    const days =
                        turnaroundDays(row);

                    if (days != null) {
                        map[
                            key
                        ].turnaround.push(
                            days
                        );
                    }
                }

                const rating = Number(
                    row.feedback?.rating
                );

                if (
                    Number.isFinite(rating)
                ) {
                    map[
                        key
                    ].feedback.push(
                        rating
                    );
                }
            });

            const keys =
                Object.keys(map).sort();

            return {
                categories: keys.map(
                    (key) =>
                        dayjs(
                            `${key}-01`
                        ).format(
                            "MMM YYYY"
                        )
                ),

                completed: keys.map(
                    (key) =>
                        map[key].completed
                ),

                avgTurnaround:
                    keys.map((key) =>
                        average(
                            map[key]
                                .turnaround
                        )
                    ),

                avgFeedback:
                    keys.map((key) =>
                        average(
                            map[key]
                                .feedback
                        )
                    ),
            };
        }, [scopedRows]);

        const monthlyOptions: Highcharts.Options =
        {
            chart: {
                backgroundColor:
                    "transparent",
            },

            title: {
                text: "Monthly Performance: Completion, Turnaround and Feedback",
            },

            credits: {
                enabled: false,
            },

            xAxis: {
                categories:
                    monthlyData.categories,
                crosshair: true,
            },

            yAxis: [
                {
                    min: 0,
                    title: {
                        text: "Completed interventions",
                    },
                    allowDecimals:
                        false,
                },
                {
                    min: 0,
                    title: {
                        text: "Days / Rating",
                    },
                    opposite: true,
                },
            ],

            tooltip: {
                shared: true,
            },

            plotOptions: {
                column: {
                    pointPadding: 0.1,
                    borderWidth: 0,
                    dataLabels:
                        visibleDataLabels(),
                },

                spline: {
                    marker: {
                        enabled: true,
                    },
                    dataLabels:
                        visibleDataLabels(),
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

        return (
            <>
                <Row
                    gutter={[16, 16]}
                    style={{
                        marginBottom: 16,
                    }}
                >
                    <InterventionsCompletionCard
                        filteredRows={
                            filteredRows
                        }
                        allRows={
                            scopedRows
                        }
                        dateRange={
                            dateRange
                        }
                    />

                    <Col
                        span={12}
                        style={{
                            marginBottom: 24,
                        }}
                    >
                        <motion.div
                            initial={{
                                opacity: 0,
                                y: 10,
                            }}
                            animate={{
                                opacity: 1,
                                y: 0,
                            }}
                            transition={{
                                duration: 0.4,
                            }}
                            style={{
                                height: "100%",
                            }}
                        >
                            <Card
                                title="Intervention Health"
                                style={{
                                    ...cardStyle,
                                    height: "100%",
                                    borderRadius: 16,
                                }}
                                styles={{
                                    body: {
                                        padding: 20,
                                    },
                                }}
                            >
                                {neededTotal >
                                    0 ? (
                                    <>
                                        {/* Overall health */}
                                        <Row
                                            gutter={[
                                                24,
                                                16,
                                            ]}
                                            align="middle"
                                        >
                                            <Col
                                                flex="0 0 auto"
                                                style={{
                                                    display:
                                                        "flex",
                                                    justifyContent:
                                                        "center",
                                                }}
                                            >
                                                <Progress
                                                    type="dashboard"
                                                    percent={
                                                        overallHealth
                                                    }
                                                    gapDegree={
                                                        180
                                                    }
                                                    gapPosition="bottom"
                                                    size={
                                                        150
                                                    }
                                                    strokeWidth={
                                                        10
                                                    }
                                                    strokeColor={
                                                        healthMeta.color
                                                    }
                                                    trailColor={
                                                        token.colorFillSecondary
                                                    }
                                                    format={(
                                                        percent
                                                    ) => (
                                                        <div
                                                            style={{
                                                                marginTop:
                                                                    -4,
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    fontSize:
                                                                        28,
                                                                    lineHeight:
                                                                        1,
                                                                    fontWeight:
                                                                        700,
                                                                }}
                                                            >
                                                                {
                                                                    percent
                                                                }
                                                                %
                                                            </div>

                                                            <Text
                                                                type="secondary"
                                                                style={{
                                                                    fontSize:
                                                                        11,
                                                                }}
                                                            >
                                                                completed
                                                            </Text>
                                                        </div>
                                                    )}
                                                />
                                            </Col>

                                            <Col
                                                flex="1 1 220px"
                                                style={{
                                                    minWidth: 0,
                                                }}
                                            >
                                                <Space
                                                    direction="vertical"
                                                    size={
                                                        4
                                                    }
                                                >
                                                    <Title
                                                        level={
                                                            5
                                                        }
                                                        style={{
                                                            margin: 0,
                                                        }}
                                                    >
                                                        {
                                                            healthMeta.title
                                                        }
                                                    </Title>

                                                    <Text
                                                        type="secondary"
                                                        style={{
                                                            fontSize:
                                                                13,
                                                            lineHeight:
                                                                1.5,
                                                        }}
                                                    >
                                                        {
                                                            healthMeta.description
                                                        }
                                                    </Text>
                                                </Space>

                                                <div
                                                    style={{
                                                        marginTop:
                                                            14,
                                                        padding:
                                                            "10px 12px",
                                                        borderRadius:
                                                            12,
                                                        background:
                                                            token.colorFillAlter,
                                                    }}
                                                >
                                                    <Text
                                                        strong
                                                        style={{
                                                            fontSize:
                                                                13,
                                                        }}
                                                    >
                                                        {
                                                            completedTotal
                                                        }{" "}
                                                        of{" "}
                                                        {
                                                            neededTotal
                                                        }{" "}
                                                        required
                                                        interventions
                                                        completed
                                                    </Text>
                                                </div>
                                            </Col>
                                        </Row>

                                        {/* Divider */}
                                        <div
                                            style={{
                                                height: 1,
                                                background:
                                                    token.colorBorderSecondary,
                                                margin:
                                                    "18px 0 16px",
                                            }}
                                        />

                                        {/* Breakdown bars */}
                                        <div
                                            style={{
                                                display:
                                                    "flex",
                                                flexDirection:
                                                    "column",
                                                gap: 14,
                                            }}
                                        >
                                            {gapRows.map(
                                                (
                                                    item
                                                ) => (
                                                    <div
                                                        key={
                                                            item.key
                                                        }
                                                    >
                                                        <div
                                                            style={{
                                                                display:
                                                                    "flex",
                                                                alignItems:
                                                                    "center",
                                                                gap: 12,
                                                            }}
                                                        >
                                                            <Text
                                                                style={{
                                                                    width: 82,
                                                                    flexShrink: 0,
                                                                    fontSize:
                                                                        13,
                                                                }}
                                                            >
                                                                {
                                                                    item.label
                                                                }
                                                            </Text>

                                                            <Progress
                                                                percent={
                                                                    item.percent
                                                                }
                                                                showInfo={
                                                                    false
                                                                }
                                                                strokeColor={
                                                                    item.color
                                                                }
                                                                trailColor={
                                                                    token.colorFillSecondary
                                                                }
                                                                size="small"
                                                                style={{
                                                                    flex: 1,
                                                                    margin: 0,
                                                                }}
                                                            />

                                                            <Text
                                                                strong
                                                                style={{
                                                                    width: 34,
                                                                    textAlign:
                                                                        "right",
                                                                    flexShrink: 0,
                                                                    fontSize:
                                                                        13,
                                                                }}
                                                            >
                                                                {
                                                                    item.count
                                                                }
                                                            </Text>
                                                        </div>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </>
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
                            initial={{
                                opacity: 0,
                                y: 10,
                            }}
                            animate={{
                                opacity: 1,
                                y: 0,
                            }}
                            transition={{
                                duration: 0.4,
                            }}
                        >
                            <Card
                                style={{
                                    ...cardStyle,
                                    borderRadius: 16,
                                }}
                                title="Monthly Performance"
                            >
                                {monthlyData
                                    .categories
                                    .length ? (
                                    <HighchartsReact
                                        highcharts={
                                            Highcharts
                                        }
                                        options={
                                            monthlyOptions
                                        }
                                    />
                                ) : (
                                    <Empty description="No monthly activity to show yet" />
                                )}
                            </Card>
                        </motion.div>
                    </Col>
                </Row>
            </>
        );
    };

export default OverviewReportView;
