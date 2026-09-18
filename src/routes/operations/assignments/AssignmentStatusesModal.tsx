import React, { useMemo, useState } from "react";
import {
    Modal,
    DatePicker,
    Row,
    Col,
    Card,
    Progress,
    Tag,
    Table,
    Typography,
    Empty,
    theme,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
    formatDisplayDate,
    getCompositeStatus,
    getBottleneck,
    isGroupedAssignmentRecord,
    Bottleneck,
} from "./index";

const { Text, Title } = Typography;

interface AssignmentStatusesModalProps {
    open: boolean;
    onClose: () => void;

    /** Already department/program-scoped assignments - the modal picks its own date window out of these. */
    assignments: any[];
}

interface StatusRow {
    status: string;
    color: string;
    count: number;
}

interface DrillDownRow {
    id: string;
    beneficiaryName: string;
    interventionTitle: string;
    facilitator: string;
    type: "Grouped" | "Single";
    progress: number;
    assignedDate: Date | null;
    deliveryDate: Date | null;
    completedDate: Date | null;
    dueDate: Date | null;
    pendingAction: string;
}

const assignmentDate = (a: any): Date | null =>
    a.createdAt?.toDate?.() ||
    a.assignedAt?.toDate?.() ||
    a.updatedAt?.toDate?.() ||
    a.dueDate?.toDate?.() ||
    null;

/**
 * Dynamic full-width status card layout.
 *
 * 1 status  -> [1]
 * 2 statuses -> [2]
 * 3 statuses -> [2, 1]
 * 4 statuses -> [4]
 * 5 statuses -> [4, 1]
 * 6 statuses -> [4, 2]
 * 7 statuses -> [4, 2, 1]
 * 8 statuses -> [4, 4]
 */
const buildCardRows = <T,>(items: T[]): T[][] => {
    if (!items.length) return [];

    const workingItems = [...items];
    const rows: T[][] = [];

    let finalOddItem: T | undefined;

    // Reserve the final item when the total is odd.
    if (workingItems.length % 2 !== 0) {
        finalOddItem = workingItems.pop();
    }

    // Maximum 4 cards per row.
    for (let index = 0; index < workingItems.length; index += 4) {
        rows.push(workingItems.slice(index, index + 4));
    }

    // Final odd item occupies a complete row.
    if (finalOddItem !== undefined) {
        rows.push([finalOddItem]);
    }

    return rows;
};

export const AssignmentStatusesModal: React.FC<
    AssignmentStatusesModalProps
> = ({
    open,
    onClose,
    assignments,
}) => {
        const { token } = theme.useToken();

        const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
            dayjs().startOf("month"),
            dayjs().endOf("month"),
        ]);

        const [selectedStatus, setSelectedStatus] =
            useState<string | null>(null);

        const rangeAssignments = useMemo(() => {
            const [start, end] = dateRange;

            return (assignments || []).filter((a: any) => {
                const d = assignmentDate(a);

                if (!d) return false;

                return (
                    dayjs(d).isAfter(
                        start
                            .startOf("day")
                            .subtract(1, "millisecond")
                    ) &&
                    dayjs(d).isBefore(
                        end
                            .endOf("day")
                            .add(1, "millisecond")
                    )
                );
            });
        }, [assignments, dateRange]);

        const statusRows = useMemo<StatusRow[]>(() => {
            const map = new Map<string, StatusRow>();

            rangeAssignments.forEach((a: any) => {
                const status = getCompositeStatus(a);

                const existing =
                    map.get(status.label) || {
                        status: status.label,
                        color: status.color,
                        count: 0,
                    };

                existing.count += 1;

                map.set(status.label, existing);
            });

            return Array.from(map.values()).sort(
                (a, b) => b.count - a.count
            );
        }, [rangeAssignments]);

        const total = rangeAssignments.length;

        /**
         * Split status cards into dynamic full-width rows.
         */
        const statusCardRows = useMemo(
            () => buildCardRows(statusRows),
            [statusRows]
        );

        /**
         * Reset drill-down when the selected status disappears.
         */
        React.useEffect(() => {
            if (
                selectedStatus &&
                !statusRows.some(
                    (row) => row.status === selectedStatus
                )
            ) {
                setSelectedStatus(null);
            }
        }, [statusRows, selectedStatus]);

        const drillDownRows = useMemo<DrillDownRow[]>(() => {
            if (!selectedStatus) return [];

            return rangeAssignments
                .filter(
                    (a: any) =>
                        getCompositeStatus(a).label ===
                        selectedStatus
                )
                .map((a: any) => ({
                    id: a.id,

                    beneficiaryName:
                        a.beneficiaryName ||
                        a.participantName ||
                        a.smeName ||
                        "—",

                    interventionTitle:
                        a.interventionTitle || "Untitled",

                    facilitator:
                        a.assigneeName || "—",

                    type: isGroupedAssignmentRecord(a)
                        ? "Grouped"
                        : "Single",

                    progress:
                        Number(
                            a.groupDelivery?.progress || 0
                        ) ||
                            typeof a.computedProgress === "number"
                            ? Math.round(
                                Number(
                                    a.groupDelivery
                                        ?.progress || 0
                                ) ||
                                a.computedProgress ||
                                0
                            )
                            : getCompositeStatus(a).label ===
                                "Completed"
                                ? 100
                                : 0,

                    assignedDate:
                        a.createdAt?.toDate?.() ||
                        a.assignedAt?.toDate?.() ||
                        null,

                    deliveryDate:
                        a.groupDelivery?.completedAt?.toDate?.() ||
                        a.completedAt?.toDate?.() ||
                        null,

                    completedDate:
                        a.completionConfirmedAt?.toDate?.() ||
                        (getCompositeStatus(a).label ===
                            "Completed"
                            ? a.completedAt?.toDate?.() ||
                            a.updatedAt?.toDate?.()
                            : null),

                    dueDate:
                        a.dueDate?.toDate?.() || null,

                    pendingAction: (
                        getBottleneck(a) as Bottleneck
                    ).label,
                }));
        }, [rangeAssignments, selectedStatus]);

        const isCompletedStatus =
            selectedStatus === "Completed";

        const isMovStatus = [
            "Awaiting MOV Confirmation",
            "Completion Rejected",
        ].includes(selectedStatus || "");

        const showProgress = ![
            "Ready to Schedule",
            "Awaiting Appointment Response",
            "Appointment Declined",
            "Cancelled",
            "Completed",
            "Awaiting MOV Confirmation",
        ].includes(selectedStatus || "");

        const showNextStep =
            !isCompletedStatus &&
            selectedStatus !== "Cancelled";

        const getProgressColor = (color?: string) => {
            const value = String(color || "").toLowerCase();

            if (
                value === "green" ||
                value === "success"
            ) {
                return token.colorSuccess;
            }

            if (
                value === "red" ||
                value === "error" ||
                value === "volcano"
            ) {
                return token.colorError;
            }

            if (
                value === "orange" ||
                value === "gold" ||
                value === "warning"
            ) {
                return token.colorWarning;
            }

            if (
                value === "blue" ||
                value === "cyan" ||
                value === "geekblue" ||
                value === "processing"
            ) {
                return token.colorInfo;
            }

            if (
                value === "purple" ||
                value === "magenta"
            ) {
                return value;
            }

            if (
                value.startsWith("#") ||
                value.startsWith("rgb") ||
                value.startsWith("hsl")
            ) {
                return color;
            }

            return token.colorPrimary;
        };

        return (
            <Modal
                title="Assignment Statuses"
                open={open}
                onCancel={onClose}
                footer={null}
                width={1180}
                destroyOnClose
            >
                {/* Header / Date range */}
                <Row
                    justify="space-between"
                    align="middle"
                    style={{
                        marginBottom: 16,
                        gap: 12,
                    }}
                    wrap
                >
                    <Col>
                        <Text type="secondary">
                            {total} assignment
                            {total === 1 ? "" : "s"} in the
                            selected range
                        </Text>
                    </Col>

                    <Col>
                        <DatePicker.RangePicker
                            value={dateRange}
                            allowClear={false}
                            onChange={(value) => {
                                if (
                                    !value?.[0] ||
                                    !value?.[1]
                                ) {
                                    return;
                                }

                                setDateRange([
                                    value[0],
                                    value[1],
                                ]);
                            }}
                        />
                    </Col>
                </Row>

                {/* Status cards */}
                {statusRows.length === 0 ? (
                    <Empty description="No assignments in this range" />
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            width: "100%",
                        }}
                    >
                        {statusCardRows.map(
                            (cardRow, rowIndex) => (
                                <Row
                                    key={rowIndex}
                                    gutter={[12, 12]}
                                    style={{
                                        width: "100%",
                                    }}
                                >
                                    {cardRow.map((row) => {
                                        const percent = total
                                            ? Math.round(
                                                (row.count /
                                                    total) *
                                                100
                                            )
                                            : 0;

                                        const selected =
                                            selectedStatus ===
                                            row.status;

                                        /**
                                         * 1 card  = 100%
                                         * 2 cards = 50%
                                         * 3 cards = 33.33%
                                         * 4 cards = 25%
                                         */
                                        const desktopSpan =
                                            24 /
                                            cardRow.length;

                                        return (
                                            <Col
                                                key={
                                                    row.status
                                                }
                                                xs={24}
                                                sm={
                                                    cardRow.length ===
                                                        1
                                                        ? 24
                                                        : 12
                                                }
                                                lg={
                                                    desktopSpan
                                                }
                                                style={{
                                                    display:
                                                        "flex",
                                                }}
                                            >
                                                <Card
                                                    hoverable
                                                    size="small"
                                                    onClick={() =>
                                                        setSelectedStatus(
                                                            selected
                                                                ? null
                                                                : row.status
                                                        )
                                                    }
                                                    style={{
                                                        width: "100%",
                                                        height: "100%",
                                                        cursor: "pointer",
                                                        borderRadius: 16,
                                                        overflow:
                                                            "hidden",
                                                        border: `1px solid ${selected
                                                                ? token.colorPrimary
                                                                : token.colorBorderSecondary
                                                            }`,
                                                        boxShadow:
                                                            selected
                                                                ? `0 0 0 1px ${token.colorPrimary}`
                                                                : undefined,
                                                    }}
                                                    styles={{
                                                        body: {
                                                            padding: 14,
                                                        },
                                                    }}
                                                >
                                                    {/* Header */}
                                                    <div
                                                        style={{
                                                            display:
                                                                "flex",
                                                            justifyContent:
                                                                "space-between",
                                                            alignItems:
                                                                "flex-start",
                                                            gap: 12,
                                                            marginBottom: 12,
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                minWidth: 0,
                                                                flex: 1,
                                                            }}
                                                        >
                                                            <Text
                                                                strong
                                                                ellipsis={{
                                                                    tooltip:
                                                                        row.status,
                                                                }}
                                                                style={{
                                                                    display:
                                                                        "block",
                                                                    fontSize: 14,
                                                                }}
                                                            >
                                                                {
                                                                    row.status
                                                                }
                                                            </Text>

                                                            <Text
                                                                type="secondary"
                                                                style={{
                                                                    fontSize: 12,
                                                                }}
                                                            >
                                                                {
                                                                    percent
                                                                }
                                                                % of
                                                                assignments
                                                            </Text>
                                                        </div>

                                                        <Tag
                                                            color={
                                                                row.color
                                                            }
                                                            style={{
                                                                marginInlineEnd: 0,
                                                                flexShrink: 0,
                                                                borderRadius: 999,
                                                            }}
                                                        >
                                                            {
                                                                row.count
                                                            }
                                                        </Tag>
                                                    </div>

                                                    {/* Status progress */}
                                                    <div
                                                        style={{
                                                            display:
                                                                "flex",
                                                            alignItems:
                                                                "center",
                                                            gap: 10,
                                                            width: "100%",
                                                        }}
                                                    >
                                                        <Progress
                                                            percent={
                                                                percent
                                                            }
                                                            showInfo={
                                                                false
                                                            }
                                                            size="small"
                                                            strokeColor={getProgressColor(
                                                                row.color
                                                            )}
                                                            trailColor={
                                                                token.colorFillSecondary
                                                            }
                                                            style={{
                                                                flex: 1,
                                                                margin: 0,
                                                            }}
                                                        />

                                                        <Text
                                                            strong
                                                            style={{
                                                                minWidth: 28,
                                                                textAlign:
                                                                    "right",
                                                                fontSize: 13,
                                                            }}
                                                        >
                                                            {
                                                                row.count
                                                            }
                                                        </Text>
                                                    </div>
                                                </Card>
                                            </Col>
                                        );
                                    })}
                                </Row>
                            )
                        )}
                    </div>
                )}

                {/* Drill-down */}
                {selectedStatus && (
                    <div style={{ marginTop: 20 }}>
                        <Title
                            level={5}
                            style={{
                                marginBottom: 8,
                            }}
                        >
                            {selectedStatus} (
                            {drillDownRows.length})
                        </Title>

                        <Table
                            rowKey="id"
                            size="small"
                            pagination={{
                                pageSize: 5,
                                showSizeChanger: false,
                                position: ["bottomCenter"],
                            }}
                            dataSource={drillDownRows}
                            columns={[
                                {
                                    title: "SME",
                                    dataIndex:
                                        "beneficiaryName",
                                },
                                {
                                    title: "Intervention",
                                    dataIndex:
                                        "interventionTitle",
                                },
                                {
                                    title: "Facilitator",
                                    dataIndex: "facilitator",
                                },
                                {
                                    title: "Type",
                                    dataIndex: "type",
                                    render: (
                                        value: string
                                    ) => (
                                        <Tag
                                            color={
                                                value ===
                                                    "Grouped"
                                                    ? "purple"
                                                    : "geekblue"
                                            }
                                        >
                                            {value}
                                        </Tag>
                                    ),
                                },
                                {
                                    title: "Progress",
                                    dataIndex: "progress",
                                    hidden: !showProgress,
                                    render: (
                                        value: number
                                    ) => (
                                        <Progress
                                            percent={value}
                                            size="small"
                                        />
                                    ),
                                },
                                {
                                    title: "Assigned",
                                    dataIndex:
                                        "assignedDate",
                                    render: (
                                        value: Date | null
                                    ) =>
                                        formatDisplayDate(
                                            value
                                        ),
                                },
                                {
                                    title: isMovStatus
                                        ? "Delivery completed"
                                        : isCompletedStatus
                                            ? "MOV confirmed"
                                            : "Completed",
                                    dataIndex:
                                        "completedDate",
                                    hidden:
                                        !isMovStatus &&
                                        !isCompletedStatus,
                                    render: (
                                        value:
                                            | Date
                                            | null,
                                        record: DrillDownRow
                                    ) =>
                                        formatDisplayDate(
                                            isMovStatus
                                                ? record.deliveryDate
                                                : value
                                        ),
                                },
                                {
                                    title: "Due",
                                    dataIndex: "dueDate",
                                    hidden:
                                        isCompletedStatus ||
                                        isMovStatus,
                                    render: (
                                        value: Date | null
                                    ) =>
                                        formatDisplayDate(
                                            value
                                        ),
                                },
                                {
                                    title: "Next step",
                                    dataIndex:
                                        "pendingAction",
                                    hidden: !showNextStep,
                                    render: (
                                        value: string
                                    ) =>
                                        value &&
                                            value !== "—" ? (
                                            <Tag color="red">
                                                {value}
                                            </Tag>
                                        ) : (
                                            "—"
                                        ),
                                },
                            ]}
                        />
                    </div>
                )}
            </Modal>
        );
    };

export default AssignmentStatusesModal;
