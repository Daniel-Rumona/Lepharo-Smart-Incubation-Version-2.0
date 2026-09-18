import React, { useMemo } from "react";
import { Card, Col, Empty, Row, Table, Tag } from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import type { Dayjs } from "dayjs";

import type {
    AssignedIntervention,
    BottleneckRow,
} from "../reportingTypes";
import {
    average,
    cardStyle,
    createdDate,
    isOverdueAt,
    isReportCompleted,
    normalizeText,
    REPORT_COLORS,
    visibleDataLabels,
    withLabels,
} from "../reportingUtils";

interface BottlenecksReportViewProps {
    filteredRows: AssignedIntervention[];
    dateRange: [Dayjs, Dayjs];
}

const BottlenecksReportView: React.FC<
    BottlenecksReportViewProps
> = ({ filteredRows, dateRange }) => {
    const bottleneckRows =
        useMemo<BottleneckRow[]>(() => {
            const grouped: Record<
                string,
                {
                    intervention: string;
                    overdue: number;
                    pending: number;
                    assigned: number;
                    avgAge: number[];
                }
            > = {};

            filteredRows.forEach((row) => {
                const intervention =
                    normalizeText(
                        row.interventionTitle,
                        "Untitled"
                    );

                if (!grouped[intervention]) {
                    grouped[intervention] = {
                        intervention,
                        overdue: 0,
                        pending: 0,
                        assigned: 0,
                        avgAge: [],
                    };
                }

                const entry =
                    grouped[intervention];

                if (
                    isOverdueAt(
                        row,
                        dateRange[1]
                    )
                ) {
                    entry.overdue += 1;
                }

                if (
                    !isReportCompleted(row)
                ) {
                    entry.pending += 1;
                }

                entry.assigned += 1;

                const created =
                    createdDate(row);

                if (
                    created &&
                    !isReportCompleted(row)
                ) {
                    entry.avgAge.push(
                        Math.max(
                            0,
                            dateRange[1].diff(
                                created,
                                "day"
                            )
                        )
                    );
                }
            });

            return Object.values(grouped)
                .filter(
                    (item) =>
                        item.overdue > 0 ||
                        item.pending > 0
                )
                .map((item) => ({
                    ...item,
                    key: item.intervention,
                    avgOpenDays: average(
                        item.avgAge
                    ),
                }))
                .sort(
                    (a, b) =>
                        b.overdue -
                            a.overdue ||
                        b.avgOpenDays -
                            a.avgOpenDays
                );
        }, [filteredRows, dateRange]);

    const bottleneckOptions: Highcharts.Options =
        {
            chart: {
                type: "bar",
                backgroundColor:
                    "transparent",
                height: 360,
            },
            title: {
                text: "Bottlenecks by Intervention",
            },
            credits: {
                enabled: false,
            },
            xAxis: {
                categories:
                    bottleneckRows.map(
                        (row) =>
                            row.intervention
                    ),
            },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: {
                    text: "Open interventions",
                },
            },
            tooltip: {
                shared: true,
            },
            plotOptions: {
                bar: {
                    dataLabels:
                        visibleDataLabels(),
                },
            },
            series: [
                withLabels({
                    type: "bar",
                    name: "Overdue",
                    data: bottleneckRows.map(
                        (row) =>
                            row.overdue
                    ),
                    color: REPORT_COLORS.overdue,
                }),
                withLabels({
                    type: "bar",
                    name: "Pending",
                    data: bottleneckRows.map(
                        (row) =>
                            row.pending
                    ),
                    color: REPORT_COLORS.pending,
                }),
            ],
        };

    return (
        <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
                <Card
                    style={cardStyle}
                    title="Bottleneck Analysis"
                >
                    {bottleneckRows.length ? (
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={
                                bottleneckOptions
                            }
                        />
                    ) : (
                        <Empty description="No bottlenecks in this period" />
                    )}
                </Card>
            </Col>

            <Col xs={24} xl={10}>
                <Card
                    style={cardStyle}
                    title="Open Work by Intervention"
                >
                    <Table
                        rowKey="key"
                        size="small"
                        pagination={{
                            pageSize: 6,
                        }}
                        dataSource={
                            bottleneckRows
                        }
                        columns={[
                            {
                                title: "Intervention",
                                dataIndex:
                                    "intervention",
                            },
                            {
                                title: "Overdue",
                                dataIndex:
                                    "overdue",
                                align: "right",
                                render: (
                                    value: number
                                ) => (
                                    <Tag
                                        color={
                                            value >
                                            0
                                                ? "red"
                                                : "green"
                                        }
                                    >
                                        {value}
                                    </Tag>
                                ),
                            },
                            {
                                title: "Pending",
                                dataIndex:
                                    "pending",
                                align: "right",
                            },
                            {
                                title: "Avg Open",
                                dataIndex:
                                    "avgOpenDays",
                                render: (
                                    value: number
                                ) =>
                                    `${
                                        value ||
                                        0
                                    }d`,
                            },
                        ]}
                    />
                </Card>
            </Col>
        </Row>
    );
};

export default BottlenecksReportView;
