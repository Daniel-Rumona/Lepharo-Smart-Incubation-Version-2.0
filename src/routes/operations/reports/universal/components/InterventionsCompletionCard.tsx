import React, { useMemo } from "react";
import { Card, Col, Empty } from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { motion } from "framer-motion";
import type { Dayjs } from "dayjs";

import type { AssignedIntervention } from "../reportingTypes";
import {
    cardStyle,
    completionDate,
    createdDate,
    inRangeInclusive,
    isCompletedStatus,
    isOverdueAt,
    isPendingLike,
    REPORT_COLORS,
    visibleDataLabels,
    withLabels,
} from "../reportingUtils";

interface InterventionsCompletionCardProps {
    filteredRows: AssignedIntervention[];
    allRows: AssignedIntervention[];
    dateRange: [Dayjs, Dayjs];
}

const InterventionsCompletionCard: React.FC<
    InterventionsCompletionCardProps
> = ({ filteredRows, allRows, dateRange }) => {
    const buckets = useMemo(() => {
        const [start, end] = dateRange;

        const days = Math.max(
            1,
            end.startOf("day").diff(start.startOf("day"), "day") + 1
        );

        const output: {
            key: string;
            label: string;
            start: Dayjs;
            end: Dayjs;
        }[] = [];

        if (days <= 10) {
            for (let i = 0; i < days; i += 1) {
                const day = start.add(i, "day");

                output.push({
                    key: day.format("YYYY-MM-DD"),
                    label: day.format("ddd DD"),
                    start: day.startOf("day"),
                    end: day.endOf("day"),
                });
            }

            return output;
        }

        if (days <= 70) {
            let cursor = start.startOf("isoWeek");

            while (
                cursor.isBefore(end) ||
                cursor.isSame(end, "day")
            ) {
                const bucketStart = cursor.isBefore(start)
                    ? start
                    : cursor;

                const bucketEnd = cursor
                    .endOf("isoWeek")
                    .isAfter(end)
                    ? end
                    : cursor.endOf("isoWeek");

                output.push({
                    key: bucketStart.format("YYYY-MM-DD"),
                    label: `${bucketStart.format(
                        "ddd DD"
                    )} - ${bucketEnd.format("ddd DD")}`,
                    start: bucketStart.startOf("day"),
                    end: bucketEnd.endOf("day"),
                });

                cursor = cursor.add(1, "week");
            }

            return output;
        }

        let cursor = start.startOf("month");

        while (
            cursor.isBefore(end) ||
            cursor.isSame(end, "month")
        ) {
            const bucketStart = cursor.isBefore(start)
                ? start
                : cursor;

            const bucketEnd = cursor
                .endOf("month")
                .isAfter(end)
                ? end
                : cursor.endOf("month");

            output.push({
                key: bucketStart.format("YYYY-MM"),
                label: bucketStart.format("MMM YYYY"),
                start: bucketStart.startOf("day"),
                end: bucketEnd.endOf("day"),
            });

            cursor = cursor.add(1, "month");
        }

        return output;
    }, [dateRange]);

    const bucketCounts = useMemo(() => {
        return buckets.map((bucket) => {
            const counts = {
                completed: 0,
                pending: 0,
                assignments: 0,
                overdue: 0,
            };

            allRows.forEach((row) => {
                const created = createdDate(row);
                const completed = completionDate(row);

                if (
                    created &&
                    created.isAfter(bucket.end, "day")
                ) {
                    return;
                }

                const activeInBucket =
                    !!created &&
                    (created.isBefore(bucket.end, "day") ||
                        created.isSame(bucket.end, "day")) &&
                    (!completed ||
                        completed.isAfter(bucket.start, "day") ||
                        completed.isSame(bucket.start, "day"));

                if (activeInBucket) {
                    counts.assignments += 1;
                }

                if (isOverdueAt(row, bucket.end)) {
                    counts.overdue += 1;
                }

                if (
                    !isCompletedStatus(row) &&
                    isPendingLike(row) &&
                    activeInBucket &&
                    !isOverdueAt(row, bucket.end)
                ) {
                    counts.pending += 1;
                }

                if (isCompletedStatus(row)) {
                    const completedAt = completionDate(row);

                    if (
                        completedAt &&
                        inRangeInclusive(
                            completedAt,
                            bucket.start,
                            bucket.end
                        )
                    ) {
                        counts.completed += 1;
                    }
                }
            });

            return counts;
        });
    }, [buckets, allRows]);

    const chartOptions: Highcharts.Options = {
        chart: {
            type: "spline",
            backgroundColor: "transparent",
            height: 390,
        },
        title: {
            text: `Interventions by Period (${dateRange[0].format(
                "ddd DD MMM"
            )} - ${dateRange[1].format("ddd DD MMM")})`,
        },
        credits: { enabled: false },
        xAxis: {
            categories: buckets.map((bucket) => bucket.label),
            labels: {
                rotation: buckets.length > 8 ? -35 : 0,
            },
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: "Interventions" },
        },
        tooltip: { shared: true },
        legend: {
            align: "center",
            verticalAlign: "bottom",
        },
        plotOptions: {
            spline: {
                marker: {
                    enabled: true,
                    radius: 4,
                },
                dataLabels: visibleDataLabels(),
            },
        },
        series: [
            withLabels({
                type: "spline",
                name: "Overdue",
                data: bucketCounts.map((value) => value.overdue),
                color: REPORT_COLORS.overdue,
            }),
            withLabels({
                type: "spline",
                name: "Assignments",
                data: bucketCounts.map((value) => value.assignments),
                color: REPORT_COLORS.assigned,
            }),
            withLabels({
                type: "spline",
                name: "Pending",
                data: bucketCounts.map((value) => value.pending),
                color: REPORT_COLORS.pending,
            }),
            withLabels({
                type: "spline",
                name: "Completed",
                data: bucketCounts.map((value) => value.completed),
                color: REPORT_COLORS.completed,
            }),
        ],
    };

    return (
        <Col span={12} style={{ marginBottom: 24 }}>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Card
                    style={cardStyle}
                    title="Interventions by Period"
                >
                    {filteredRows.length ? (
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={chartOptions}
                        />
                    ) : (
                        <Empty description="No interventions in this period" />
                    )}
                </Card>
            </motion.div>
        </Col>
    );
};

export default InterventionsCompletionCard;
