import React, { useMemo, useState } from "react";
import {
    Modal,
    Input,
    Segmented,
    Row,
    Col,
    Card,
    Progress,
    Typography,
    Empty,
    theme,
} from "antd";
import { getCompositeStatus } from "./index";

const { Text } = Typography;

type CoverageFilter = "all" | "needs-allocation" | "open" | "completed";

interface InterventionDemandModalProps {
    open: boolean;
    onClose: () => void;

    /** Participants already scoped to the current department/program. */
    baseParticipants: any[];

    /** Shared audit lookup from the parent - one participant/intervention pair's assignment history. */
    getAssignmentAudit: (
        participantId: string,
        interventionId: string
    ) => {
        totalAssignments: number;
        currentStatus: {
            label: string;
            color?: string;
        };
    };
}

interface DemandRow {
    interventionId: string;
    interventionTitle: string;
    needed: number;
    assigned: number;
    completed: number;
    unassigned: number;
    completionRate: number;
    openStatusSummary: {
        status: string;
        count: number;
    }[];
}

const norm = (value: any) =>
    String(value || "")
        .trim()
        .toLowerCase();

/**
 * Controls how the intervention CARDS are arranged.
 *
 * 1  => [1]
 * 2  => [2]
 * 3  => [2, 1]
 * 4  => [4]
 * 5  => [4, 1]
 * 6  => [4, 2]
 * 7  => [4, 2, 1]
 * 8  => [4, 4]
 * 9  => [4, 4, 1]
 */
const buildCardRows = <T,>(items: T[]): T[][] => {
    if (!items.length) return [];

    const workingItems = [...items];
    const cardRows: T[][] = [];

    let finalOddCard: T | undefined;

    /**
     * When the total is odd, reserve the final card.
     * Everything before it will therefore form even rows.
     */
    if (workingItems.length % 2 !== 0) {
        finalOddCard = workingItems.pop();
    }

    /**
     * Maximum of 4 cards in a row.
     */
    for (let index = 0; index < workingItems.length; index += 4) {
        cardRows.push(workingItems.slice(index, index + 4));
    }

    /**
     * Final odd card occupies the entire row.
     */
    if (finalOddCard !== undefined) {
        cardRows.push([finalOddCard]);
    }

    return cardRows;
};

export const InterventionDemandModal: React.FC<
    InterventionDemandModalProps
> = ({
    open,
    onClose,
    baseParticipants,
    getAssignmentAudit,
}) => {
        const { token } = theme.useToken();

        const [searchText, setSearchText] = useState("");
        const [coverageFilter, setCoverageFilter] =
            useState<CoverageFilter>("all");

        const rows = useMemo<DemandRow[]>(() => {
            const map = new Map<
                string,
                DemandRow & {
                    openStatuses: Record<string, number>;
                }
            >();

            (baseParticipants || []).forEach((participant: any) => {
                (participant.requiredInterventions || []).forEach(
                    (intervention: any) => {
                        const interventionId = String(intervention.id);

                        const audit = getAssignmentAudit(
                            String(participant.id),
                            interventionId
                        );

                        const row =
                            map.get(interventionId) ||
                            ({
                                interventionId,
                                interventionTitle:
                                    intervention.interventionTitle ||
                                    intervention.title ||
                                    "Untitled",
                                needed: 0,
                                assigned: 0,
                                completed: 0,
                                unassigned: 0,
                                completionRate: 0,
                                openStatusSummary: [],
                                openStatuses: {},
                            } as DemandRow & {
                                openStatuses: Record<string, number>;
                            });

                        row.needed += 1;

                        if (audit.totalAssignments > 0) {
                            row.assigned += 1;
                        }

                        if (audit.totalAssignments === 0) {
                            row.unassigned += 1;
                        } else if (
                            audit.currentStatus.label === "Completed"
                        ) {
                            row.completed += 1;
                        } else {
                            const status =
                                audit.currentStatus.label || "Open";

                            row.openStatuses[status] =
                                (row.openStatuses[status] || 0) + 1;
                        }

                        map.set(interventionId, row);
                    }
                );
            });

            return Array.from(map.values()).map((row) => ({
                ...row,

                completionRate: row.needed
                    ? Math.round(
                        (row.completed / row.needed) * 100
                    )
                    : 0,

                openStatusSummary: Object.entries(
                    row.openStatuses
                ).map(([status, count]) => ({
                    status,
                    count,
                })),
            }));
        }, [baseParticipants, getAssignmentAudit]);

        const filteredRows = useMemo(() => {
            const term = norm(searchText);

            return rows.filter((row) => {
                const matchesSearch =
                    !term ||
                    norm(row.interventionTitle).includes(term);

                const matchesCoverage =
                    coverageFilter === "all"
                        ? true
                        : coverageFilter === "needs-allocation"
                            ? row.unassigned > 0
                            : coverageFilter === "open"
                                ? row.assigned > row.completed
                                : row.completionRate >= 100;

                return matchesSearch && matchesCoverage;
            });
        }, [rows, searchText, coverageFilter]);

        /**
         * Split the CARDS into dynamic rows.
         */
        const cardRows = useMemo(
            () => buildCardRows(filteredRows),
            [filteredRows]
        );

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
                value.startsWith("#") ||
                value.startsWith("rgb") ||
                value.startsWith("hsl")
            ) {
                return color;
            }

            return token.colorPrimary;
        };

        const getPercentage = (
            count: number,
            total: number
        ) => {
            if (!total) return 0;

            return Math.min(
                100,
                Math.round((count / total) * 100)
            );
        };

        return (
            <Modal
                title="Intervention Demand"
                open={open}
                onCancel={onClose}
                footer={null}
                width={1180}
                destroyOnClose
            >
                {/* Filters */}
                <Row
                    gutter={[12, 12]}
                    align="middle"
                    style={{
                        marginBottom: 16,
                    }}
                >
                    <Col flex="1 1 280px">
                        <Input.Search
                            placeholder="Search intervention..."
                            allowClear
                            value={searchText}
                            onChange={(event) =>
                                setSearchText(event.target.value)
                            }
                        />
                    </Col>

                    <Col flex="0 1 auto">
                        <Segmented
                            value={coverageFilter}
                            onChange={(value) =>
                                setCoverageFilter(
                                    value as CoverageFilter
                                )
                            }
                            options={[
                                {
                                    label: "All",
                                    value: "all",
                                },
                                {
                                    label: "Needs Allocation",
                                    value: "needs-allocation",
                                },
                                {
                                    label: "Open Work",
                                    value: "open",
                                },
                                {
                                    label: "Completed",
                                    value: "completed",
                                },
                            ]}
                        />
                    </Col>
                </Row>

                {filteredRows.length === 0 ? (
                    <Empty description="No interventions match the current filters" />
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            width: "100%",
                        }}
                    >
                        {cardRows.map((cardRow, rowIndex) => (
                            <Row
                                key={rowIndex}
                                gutter={[12, 12]}
                                style={{
                                    width: "100%",
                                }}
                            >
                                {cardRow.map((row) => {
                                    /**
                                     * This makes every card consume an equal
                                     * share of the COMPLETE row.
                                     *
                                     * 1 card  = 24
                                     * 2 cards = 12 each
                                     * 3 cards = 8 each
                                     * 4 cards = 6 each
                                     */
                                    const desktopSpan =
                                        24 / cardRow.length;

                                    return (
                                        <Col
                                            key={row.interventionId}
                                            xs={24}
                                            sm={
                                                cardRow.length === 1
                                                    ? 24
                                                    : 12
                                            }
                                            lg={desktopSpan}
                                            style={{
                                                display: "flex",
                                            }}
                                        >
                                            <Card
                                                size="small"
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    borderRadius: 16,
                                                    overflow: "hidden",
                                                    border: `1px solid ${token.colorBorderSecondary}`,
                                                }}
                                                styles={{
                                                    body: {
                                                        padding: 14,
                                                        height: "100%",
                                                    },
                                                }}
                                            >
                                                {/* Card heading */}
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        justifyContent:
                                                            "space-between",
                                                        alignItems:
                                                            "flex-start",
                                                        gap: 10,
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
                                                                    row.interventionTitle,
                                                            }}
                                                            style={{
                                                                display:
                                                                    "block",
                                                                fontSize: 14,
                                                            }}
                                                        >
                                                            {
                                                                row.interventionTitle
                                                            }
                                                        </Text>

                                                        <Text
                                                            type="secondary"
                                                            style={{
                                                                fontSize: 12,
                                                            }}
                                                        >
                                                            {
                                                                row.needed
                                                            }{" "}
                                                            SME
                                                            {row.needed ===
                                                                1
                                                                ? ""
                                                                : "s"}{" "}
                                                            require
                                                            this
                                                            intervention
                                                        </Text>
                                                    </div>

                                                    <Progress
                                                        type="circle"
                                                        size={48}
                                                        percent={
                                                            row.completionRate
                                                        }
                                                        strokeWidth={9}
                                                        strokeColor={
                                                            token.colorSuccess
                                                        }
                                                        format={(
                                                            percent
                                                        ) => (
                                                            <Text
                                                                strong
                                                                style={{
                                                                    fontSize: 11,
                                                                }}
                                                            >
                                                                {
                                                                    percent
                                                                }
                                                                %
                                                            </Text>
                                                        )}
                                                    />
                                                </div>

                                                {/* Assignment summary */}
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        justifyContent:
                                                            "space-between",
                                                        alignItems:
                                                            "center",
                                                        padding:
                                                            "7px 10px",
                                                        marginBottom: 10,
                                                        borderRadius: 10,
                                                        background:
                                                            token.colorFillAlter,
                                                    }}
                                                >
                                                    <Text
                                                        type="secondary"
                                                        style={{
                                                            fontSize: 12,
                                                        }}
                                                    >
                                                        Assigned
                                                    </Text>

                                                    <Text
                                                        strong
                                                        style={{
                                                            fontSize: 12,
                                                        }}
                                                    >
                                                        {
                                                            row.assigned
                                                        }
                                                        /
                                                        {
                                                            row.needed
                                                        }
                                                    </Text>
                                                </div>

                                                {/* Status progress bars */}
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        flexDirection:
                                                            "column",
                                                        gap: 9,
                                                    }}
                                                >
                                                    {/* Completed */}
                                                    <div>
                                                        <div
                                                            style={{
                                                                display:
                                                                    "flex",
                                                                alignItems:
                                                                    "center",
                                                                gap: 8,
                                                            }}
                                                        >
                                                            <Text
                                                                style={{
                                                                    width: 90,
                                                                    flexShrink: 0,
                                                                    fontSize: 12,
                                                                }}
                                                                ellipsis={{
                                                                    tooltip:
                                                                        "Completed",
                                                                }}
                                                            >
                                                                Completed
                                                            </Text>

                                                            <Progress
                                                                percent={getPercentage(
                                                                    row.completed,
                                                                    row.needed
                                                                )}
                                                                showInfo={
                                                                    false
                                                                }
                                                                size="small"
                                                                strokeColor={
                                                                    token.colorSuccess
                                                                }
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
                                                                    width: 24,
                                                                    flexShrink: 0,
                                                                    textAlign:
                                                                        "right",
                                                                    fontSize: 12,
                                                                }}
                                                            >
                                                                {
                                                                    row.completed
                                                                }
                                                            </Text>
                                                        </div>
                                                    </div>

                                                    {/* Not allocated */}
                                                    {row.unassigned >
                                                        0 && (
                                                            <div>
                                                                <div
                                                                    style={{
                                                                        display:
                                                                            "flex",
                                                                        alignItems:
                                                                            "center",
                                                                        gap: 8,
                                                                    }}
                                                                >
                                                                    <Text
                                                                        style={{
                                                                            width: 90,
                                                                            flexShrink: 0,
                                                                            fontSize: 12,
                                                                        }}
                                                                        ellipsis={{
                                                                            tooltip:
                                                                                "Not allocated",
                                                                        }}
                                                                    >
                                                                        Not
                                                                        allocated
                                                                    </Text>

                                                                    <Progress
                                                                        percent={getPercentage(
                                                                            row.unassigned,
                                                                            row.needed
                                                                        )}
                                                                        showInfo={
                                                                            false
                                                                        }
                                                                        size="small"
                                                                        strokeColor={
                                                                            token.colorWarning
                                                                        }
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
                                                                            width: 24,
                                                                            flexShrink: 0,
                                                                            textAlign:
                                                                                "right",
                                                                            fontSize: 12,
                                                                        }}
                                                                    >
                                                                        {
                                                                            row.unassigned
                                                                        }
                                                                    </Text>
                                                                </div>
                                                            </div>
                                                        )}

                                                    {/* Open statuses */}
                                                    {row.openStatusSummary.map(
                                                        ({
                                                            status,
                                                            count,
                                                        }) => {
                                                            const meta =
                                                                getCompositeStatus(
                                                                    {
                                                                        assignmentStatus:
                                                                            status,
                                                                    }
                                                                );

                                                            return (
                                                                <div
                                                                    key={
                                                                        status
                                                                    }
                                                                >
                                                                    <div
                                                                        style={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            gap: 8,
                                                                        }}
                                                                    >
                                                                        <Text
                                                                            style={{
                                                                                width: 90,
                                                                                flexShrink: 0,
                                                                                fontSize: 12,
                                                                            }}
                                                                            ellipsis={{
                                                                                tooltip:
                                                                                    status,
                                                                            }}
                                                                        >
                                                                            {
                                                                                status
                                                                            }
                                                                        </Text>

                                                                        <Progress
                                                                            percent={getPercentage(
                                                                                count,
                                                                                row.needed
                                                                            )}
                                                                            showInfo={
                                                                                false
                                                                            }
                                                                            size="small"
                                                                            strokeColor={getProgressColor(
                                                                                meta.color
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
                                                                                width: 24,
                                                                                flexShrink: 0,
                                                                                textAlign:
                                                                                    "right",
                                                                                fontSize: 12,
                                                                            }}
                                                                        >
                                                                            {
                                                                                count
                                                                            }
                                                                        </Text>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                    )}
                                                </div>
                                            </Card>
                                        </Col>
                                    );
                                })}
                            </Row>
                        ))}
                    </div>
                )}
            </Modal>
        );
    };

export default InterventionDemandModal;
