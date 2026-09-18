import React, { useMemo } from "react";
import { Card, Col, Empty, Row, Table, Tag } from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import type { Dayjs } from "dayjs";

import type {
    AssignedIntervention,
    ConsultantRow,
} from "../reportingTypes";
import {
    average,
    cardStyle,
    consultantGroupKey,
    isOverdueAt,
    isPendingLike,
    isReportCompleted,
    normalizeText,
    REPORT_COLORS,
    turnaroundDays,
    visibleDataLabels,
    withLabels,
} from "../reportingUtils";

interface FacilitatorsReportViewProps {
    filteredRows: AssignedIntervention[];
    dateRange: [Dayjs, Dayjs];
}

const FacilitatorsReportView: React.FC<
    FacilitatorsReportViewProps
> = ({ filteredRows, dateRange }) => {
    const consultantRows =
        useMemo<ConsultantRow[]>(() => {
            const grouped: Record<
                string,
                {
                    key: string;
                    consultant: string;
                    names: Record<string, number>;
                    assigned: number;
                    completed: number;
                    pending: number;
                    overdue: number;
                    turnaround: number[];
                    feedback: number[];
                    smes: Set<string>;
                }
            > = {};

            filteredRows.forEach((row) => {
                const consultant =
                    normalizeText(
                        row.assigneeName,
                        "Unassigned"
                    );

                const key =
                    consultantGroupKey(row);

                if (!grouped[key]) {
                    grouped[key] = {
                        key,
                        consultant,
                        names: {},
                        assigned: 0,
                        completed: 0,
                        pending: 0,
                        overdue: 0,
                        turnaround: [],
                        feedback: [],
                        smes: new Set(),
                    };
                }

                const entry = grouped[key];

                entry.names[consultant] =
                    (entry.names[consultant] ||
                        0) + 1;

                entry.assigned += 1;

                if (isReportCompleted(row)) {
                    entry.completed += 1;
                } else if (isPendingLike(row)) {
                    entry.pending += 1;
                }

                if (
                    isOverdueAt(
                        row,
                        dateRange[1]
                    )
                ) {
                    entry.overdue += 1;
                }

                const days =
                    turnaroundDays(row);

                if (days != null) {
                    entry.turnaround.push(days);
                }

                const rating = Number(
                    row.feedback?.rating
                );

                if (Number.isFinite(rating)) {
                    entry.feedback.push(rating);
                }

                const sme =
                    row.participantId ||
                    row.beneficiaryName;

                if (sme) {
                    entry.smes.add(sme);
                }
            });

            return Object.values(grouped)
                .map((item) => {
                    const displayName =
                        Object.entries(
                            item.names
                        ).sort(
                            (a, b) =>
                                b[1] - a[1]
                        )[0]?.[0] ||
                        item.consultant;

                    return {
                        key: item.key,
                        consultant:
                            displayName,
                        assigned:
                            item.assigned,
                        completed:
                            item.completed,
                        pending: item.pending,
                        overdue: item.overdue,
                        completionRate:
                            item.assigned
                                ? Math.round(
                                      (item.completed /
                                          item.assigned) *
                                          100
                                  )
                                : 0,
                        avgTurnaround:
                            average(
                                item.turnaround
                            ),
                        avgFeedback:
                            average(
                                item.feedback
                            ),
                        smes: item.smes.size,
                    };
                })
                .sort(
                    (a, b) =>
                        b.overdue -
                            a.overdue ||
                        b.assigned -
                            a.assigned
                );
        }, [filteredRows, dateRange]);

    const consultantOptions: Highcharts.Options =
        {
            chart: {
                type: "column",
                backgroundColor:
                    "transparent",
                height: 360,
            },
            title: {
                text: "Facilitator Performance",
            },
            credits: {
                enabled: false,
            },
            xAxis: {
                categories:
                    consultantRows.map(
                        (row) =>
                            row.consultant
                    ),
                labels: {
                    rotation:
                        consultantRows.length >
                        5
                            ? -25
                            : 0,
                },
            },
            yAxis: [
                {
                    min: 0,
                    allowDecimals: false,
                    title: {
                        text: "Interventions",
                    },
                },
                {
                    min: 0,
                    title: {
                        text: "Completion %",
                    },
                    opposite: true,
                    max: 100,
                },
            ],
            tooltip: {
                shared: true,
            },
            plotOptions: {
                column: {
                    dataLabels:
                        visibleDataLabels(),
                },
                spline: {
                    dataLabels:
                        visibleDataLabels(
                            "{y}%"
                        ),
                },
            },
            series: [
                withLabels({
                    type: "column",
                    name: "Overdue",
                    data: consultantRows.map(
                        (row) =>
                            row.overdue
                    ),
                    color: REPORT_COLORS.overdue,
                }),
                withLabels({
                    type: "column",
                    name: "Pending",
                    data: consultantRows.map(
                        (row) =>
                            row.pending
                    ),
                    color: REPORT_COLORS.pending,
                }),
                withLabels({
                    type: "column",
                    name: "Completed",
                    data: consultantRows.map(
                        (row) =>
                            row.completed
                    ),
                    color: REPORT_COLORS.completed,
                }),
                withLabels({
                    type: "spline",
                    name: "Completion Rate",
                    data: consultantRows.map(
                        (row) =>
                            row.completionRate
                    ),
                    color: REPORT_COLORS.assigned,
                    yAxis: 1,
                }),
            ],
        };

    return (
        <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
                <Card
                    style={cardStyle}
                    title="Facilitator Analytics"
                >
                    {consultantRows.length ? (
                        <HighchartsReact
                            highcharts={Highcharts}
                            options={
                                consultantOptions
                            }
                        />
                    ) : (
                        <Empty description="No facilitator activity in this period" />
                    )}
                </Card>
            </Col>

            <Col xs={24} xl={10}>
                <Card
                    style={cardStyle}
                    title="Facilitator Detail"
                >
                    <Table
                        rowKey="key"
                        size="small"
                        pagination={{
                            pageSize: 6,
                        }}
                        dataSource={
                            consultantRows
                        }
                        columns={[
                            {
                                title: "Facilitator",
                                dataIndex:
                                    "consultant",
                            },
                            {
                                title: "SMEs",
                                dataIndex: "smes",
                                align: "right",
                            },
                            {
                                title: "Completed",
                                dataIndex:
                                    "completed",
                                align: "right",
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
                                title: "Turnaround",
                                dataIndex:
                                    "avgTurnaround",
                                render: (
                                    value: number
                                ) =>
                                    `${
                                        value ||
                                        0
                                    }d`,
                            },
                            {
                                title: "Rating",
                                dataIndex:
                                    "avgFeedback",
                                render: (
                                    value: number
                                ) =>
                                    value
                                        ? `${value}/5`
                                        : "—",
                            },
                        ]}
                    />
                </Card>
            </Col>
        </Row>
    );
};

export default FacilitatorsReportView;
