import React, { useEffect, useMemo, useState } from "react";
import {
    Button,
    Card,
    Col,
    DatePicker,
    Row,
    Segmented,
    Select,
    Space,
    Spin,
    message,
} from "antd";
import Highcharts from "highcharts";
import HighchartsMore from "highcharts/highcharts-more";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import {
    AppstoreOutlined,
    CloseOutlined,
    FieldTimeOutlined,
    RadarChartOutlined,
    RiseOutlined,
    StarOutlined,
    TeamOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import {
    collection,
    getDocs,
    onSnapshot,
    query,
    where,
} from "firebase/firestore";

import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
    DashboardFilterBar,
    MotionCard,
} from "@/components/dashboards/metrics/Header";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { buildMonthlyReportWithCharts } from "@/utils/buildMonthlyReportWithCharts";
import { exportMonthlyDepartmentReportDocx } from "@/utils/monthlyReportDocx";
import { ChartSpecRenderer } from "@/components/ai/ChartSpecRenderer";
import type { ChartSpec } from "@/services/aiAssistantService";
import ReachAnalytics from "@/components/reports/ReachAnalytics";
import { MilestoneJourneyButton } from "@/components/milestone-journey/MilestoneJourney";
import { filterReportRecords } from "@/utils/reportVisibility";
import { rollupReportAssignments } from "@/utils/reportGroupAssignments";

import BottlenecksReportView from "./components/BottlenecksReportView";
import FacilitatorsReportView from "./components/FacilitatorsReportView";
import OverviewReportView from "./components/OverviewReportView";
import type {
    AssignedIntervention,
    DepartmentScopeOption,
    ParticipantProfile,
    ReportingView,
} from "./reportingTypes";
import {
    average,
    cardStyle,
    inRangeInclusive,
    isOverdueAt,
    isReportCompleted,
    METRIC_ICON_COLORS,
    reportLifecycleStatus,
    tsToDayjs,
    turnaroundDays,
} from "./reportingUtils";

dayjs.extend(isoWeek);

if (typeof HighchartsMore === "function") {
    HighchartsMore(Highcharts);
}

const { RangePicker } = DatePicker;

const ReportingDashboard: React.FC = () => {
    const {
        user,
        loading: identityLoading,
    } = useFullIdentity();

    const {
        activeProgramId,
        isAllPrograms,
    } = useActiveProgramId();

    const [rows, setRows] = useState<
        AssignedIntervention[]
    >([]);

    const [participants, setParticipants] =
        useState<
            Record<string, ParticipantProfile>
        >({});

    const [loading, setLoading] =
        useState(true);

    const [dateRange, setDateRange] =
        useState<[Dayjs, Dayjs]>([
            dayjs().startOf("month"),
            dayjs().endOf("month"),
        ]);

    const [view, setView] =
        useState<ReportingView>("Overview");

    const [exporting, setExporting] =
        useState(false);

    const [aiChart, setAiChart] =
        useState<ChartSpec | null>(null);

    const [aiLoading, setAiLoading] =
        useState(false);

    const [
        participantsLoading,
        setParticipantsLoading,
    ] = useState(true);

    const [
        childDepartments,
        setChildDepartments,
    ] = useState<DepartmentScopeOption[]>(
        []
    );

    const [
        departmentScope,
        setDepartmentScope,
    ] = useState<string>("all");

    useEffect(() => {
        let cancelled = false;

        const loadChildren = async () => {
            if (!user?.departmentId) {
                if (!cancelled) {
                    setChildDepartments([]);
                }

                return;
            }

            try {
                const snap =
                    await getDocs(
                        query(
                            collection(
                                db,
                                "departments"
                            )
                        )
                    );

                if (cancelled) return;

                setChildDepartments(
                    snap.docs
                        .map(
                            (
                                department
                            ) => ({
                                id: department.id,
                                name: String(
                                    (
                                        department.data() as any
                                    )
                                        .name ||
                                    (
                                        department.data() as any
                                    )
                                        .departmentName ||
                                    (
                                        department.data() as any
                                    ).title ||
                                    department.id
                                ).trim(),
                                parentDepartmentId:
                                    String(
                                        (
                                            department.data() as any
                                        )
                                            .parentDepartmentId ||
                                        (
                                            department.data() as any
                                        )
                                            .parentDeptId ||
                                        ""
                                    ).trim(),
                            })
                        )
                        .filter(
                            (
                                department
                            ) =>
                                department.parentDepartmentId ===
                                user.departmentId
                        )
                        .map(
                            ({
                                id,
                                name,
                            }) => ({
                                id,
                                name,
                            })
                        )
                        .sort((a, b) =>
                            a.name.localeCompare(
                                b.name
                            )
                        )
                );
            } catch (error) {
                console.warn(
                    "[ReportingDashboard] failed to load child departments",
                    error
                );

                if (!cancelled) {
                    setChildDepartments(
                        []
                    );
                }
            }
        };

        void loadChildren();

        return () => {
            cancelled = true;
        };
    }, [user?.departmentId]);

    const accessibleDepartmentIds =
        useMemo(
            () => [
                ...(user?.departmentId
                    ? [
                        String(
                            user.departmentId
                        ),
                    ]
                    : []),
                ...childDepartments.map(
                    (department) =>
                        department.id
                ),
            ],
            [
                childDepartments,
                user?.departmentId,
            ]
        );

    useEffect(() => {
        if (identityLoading) return;

        if (!user?.departmentId) {
            setLoading(false);
            return;
        }

        const departmentBatches:
            string[][] = [];

        for (
            let index = 0;
            index <
            accessibleDepartmentIds.length;
            index += 10
        ) {
            departmentBatches.push(
                accessibleDepartmentIds.slice(
                    index,
                    index + 10
                )
            );
        }

        if (!departmentBatches.length) {
            setRows([]);
            setLoading(false);
            return;
        }

        const rowsByBatch =
            new Map<
                number,
                AssignedIntervention[]
            >();

        const applyRows = () => {
            const list =
                filterReportRecords(
                    Array.from(
                        rowsByBatch.values()
                    ).flat(),
                    user?.email
                ) as AssignedIntervention[];

            const missingProgramId =
                list.filter(
                    (item) =>
                        !item.programId
                ).length;

            if (missingProgramId > 0) {
                console.warn(
                    `[ReportingDashboard] ${missingProgramId} docs missing programId. Those will NEVER match a program filter.`
                );
            }

            list.sort((a, b) => {
                const ta =
                    tsToDayjs(
                        a.completedAt ||
                        a.createdAt
                    )?.valueOf() ?? 0;

                const tb =
                    tsToDayjs(
                        b.completedAt ||
                        b.createdAt
                    )?.valueOf() ?? 0;

                return tb - ta;
            });

            setRows(list);
            setLoading(false);
        };

        const unsubs =
            departmentBatches.map(
                (
                    departmentIds,
                    batchIndex
                ) => {
                    const constraints: any[] =
                        [
                            where(
                                "departmentId",
                                "in",
                                departmentIds
                            ),
                        ];

                    if (
                        activeProgramId
                    ) {
                        constraints.push(
                            where(
                                "programId",
                                "==",
                                activeProgramId
                            )
                        );
                    }

                    return onSnapshot(
                        query(
                            collection(
                                db,
                                "assignedInterventions"
                            ),
                            ...constraints
                        ),
                        (snap) => {
                            rowsByBatch.set(
                                batchIndex,
                                snap.docs.map(
                                    (doc) => ({
                                        id: doc.id,
                                        ...(doc.data() as any),
                                    })
                                ) as AssignedIntervention[]
                            );

                            applyRows();
                        },
                        (error) => {
                            console.error(
                                "[ReportingDashboard] error loading interventions",
                                error
                            );

                            setLoading(
                                false
                            );
                        }
                    );
                }
            );

        return () =>
            unsubs.forEach((unsub) =>
                unsub()
            );
    }, [
        accessibleDepartmentIds,
        activeProgramId,
        identityLoading,
        user?.departmentId,
        user?.email,
    ]);

    useEffect(() => {
        if (identityLoading) return;

        setParticipantsLoading(true);

        const qParticipants =
            query(
                collection(
                    db,
                    "participants"
                )
            );

        const unsub =
            onSnapshot(
                qParticipants,
                (snap) => {
                    const next: Record<
                        string,
                        ParticipantProfile
                    > = {};

                    snap.docs.forEach(
                        (docSnap) => {
                            const data =
                                {
                                    id: docSnap.id,
                                    ...(docSnap.data() as any),
                                } as ParticipantProfile;

                            if (
                                filterReportRecords(
                                    [data],
                                    user?.email
                                ).length
                            ) {
                                next[
                                    docSnap.id
                                ] = data;
                            }
                        }
                    );

                    setParticipants(
                        next
                    );

                    setParticipantsLoading(
                        false
                    );
                },
                (error) => {
                    console.warn(
                        "[ReportingDashboard] error loading participants",
                        error
                    );

                    setParticipantsLoading(
                        false
                    );
                }
            );

        return () => unsub();
    }, [identityLoading, user?.email]);

    const scopedRows =
        useMemo(() => {
            const departmentId =
                departmentScope ===
                    "my"
                    ? user?.departmentId
                    : departmentScope;

            const sourceRows =
                departmentScope ===
                    "all"
                    ? rows
                    : rows.filter(
                        (row) =>
                            String(
                                row.departmentId ||
                                ""
                            ) ===
                            String(
                                departmentId ||
                                ""
                            )
                    );

            return rollupReportAssignments(
                sourceRows,
                reportLifecycleStatus
            ).map((rollup) => {
                const earliest = [
                    ...rollup.members,
                ].sort(
                    (a, b) =>
                        (tsToDayjs(
                            a.createdAt
                        )?.valueOf() ||
                            0) -
                        (tsToDayjs(
                            b.createdAt
                        )?.valueOf() ||
                            0)
                )[0];

                const latestCompleted =
                    [
                        ...rollup.members,
                    ].sort(
                        (a, b) =>
                            (tsToDayjs(
                                b.completedAt ||
                                b.updatedAt
                            )?.valueOf() ||
                                0) -
                            (tsToDayjs(
                                a.completedAt ||
                                a.updatedAt
                            )?.valueOf() ||
                                0)
                    )[0];

                return {
                    ...rollup.record,
                    id: rollup.key,
                    status:
                        rollup.status,
                    assignmentStatus:
                        rollup.status,
                    createdAt:
                        earliest?.createdAt ||
                        rollup.record
                            .createdAt,
                    completedAt:
                        rollup.status ===
                            "completed"
                            ? latestCompleted?.completedAt ||
                            latestCompleted?.updatedAt ||
                            rollup.record
                                .completedAt
                            : rollup.record
                                .completedAt,
                    reportGroupMembers:
                        rollup.members,
                } as AssignedIntervention;
            });
        }, [
            departmentScope,
            rows,
            user?.departmentId,
        ]);

    const journeyDepartmentIds =
        useMemo(() => {
            if (
                departmentScope ===
                "all"
            ) {
                return accessibleDepartmentIds;
            }

            return [
                String(
                    departmentScope ===
                        "my"
                        ? user?.departmentId ||
                        ""
                        : departmentScope
                ),
            ].filter(Boolean);
        }, [
            accessibleDepartmentIds,
            departmentScope,
            user?.departmentId,
        ]);

    const filteredRows =
        useMemo(() => {
            return scopedRows.filter(
                (row) => {
                    const groupMembers =
                        row.reportGroupMembers ||
                        [row];

                    return groupMembers.some(
                        (member) => {
                            const date =
                                tsToDayjs(
                                    member.completedAt
                                ) ||
                                tsToDayjs(
                                    member.createdAt
                                );

                            return (
                                !!date &&
                                inRangeInclusive(
                                    date,
                                    dateRange[0],
                                    dateRange[1]
                                )
                            );
                        }
                    );
                }
            );
        }, [scopedRows, dateRange]);

    const neededTotal =
        scopedRows.length;

    const completedTotal =
        scopedRows.filter(
            isReportCompleted
        ).length;

    const remainingTotal = Math.max(
        neededTotal - completedTotal,
        0
    );

    const overdueTotal =
        scopedRows.filter((row) =>
            isOverdueAt(
                row,
                dateRange[1]
            )
        ).length;

    const completedInRange =
        filteredRows.filter(
            isReportCompleted
        );

    const uniqueSmesHelped =
        new Set(
            filteredRows
                .map(
                    (row) =>
                        row.participantId ||
                        row.beneficiaryName
                )
                .filter(Boolean)
        ).size;

    const avgTurnaround = average(
        completedInRange.map(
            (row) =>
                turnaroundDays(row) ??
                NaN
        )
    );

    const avgFeedback = average(
        filteredRows
            .map((row) =>
                Number(
                    row.feedback?.rating
                )
            )
            .filter(Number.isFinite)
    );

    const completionRate =
        filteredRows.length
            ? Math.round(
                (completedInRange.length /
                    filteredRows.length) *
                100
            )
            : 0;

    const handleExportMonthlyReport =
        async () => {
            try {
                if (
                    !user?.departmentId
                ) {
                    return message.error(
                        "Missing department."
                    );
                }

                if (
                    !activeProgramId
                ) {
                    return message.error(
                        "Missing active program."
                    );
                }

                const start =
                    dateRange[0].startOf(
                        "day"
                    );

                const end =
                    dateRange[1].endOf(
                        "day"
                    );

                const isStartAtMonthBoundary =
                    start.isSame(
                        start.startOf(
                            "month"
                        ),
                        "day"
                    );

                const isEndAtMonthBoundary =
                    end.isSame(
                        end.endOf(
                            "month"
                        ),
                        "day"
                    );

                const spanMonths =
                    end
                        .startOf("month")
                        .diff(
                            start.startOf(
                                "month"
                            ),
                            "month"
                        ) + 1;

                const isValidSpan =
                    spanMonths >= 1 &&
                    spanMonths <= 3;

                if (
                    !isStartAtMonthBoundary ||
                    !isEndAtMonthBoundary ||
                    !isValidSpan
                ) {
                    message.warning(
                        "Select a FULL range of 1–3 months (month boundaries)."
                    );
                    return;
                }

                setExporting(true);

                const departmentName =
                    (user as any)
                        ?.departmentName ||
                    (user as any)
                        ?.areaOfSupport ||
                    "Department";

                const reportData =
                    await buildMonthlyReportWithCharts(
                        {
                            programId:
                                activeProgramId,
                            departmentId:
                                user.departmentId,
                            departmentName,
                            period: {
                                month:
                                    start.month() +
                                    1,
                                year: start.year(),
                                spanMonths:
                                    spanMonths as
                                    | 1
                                    | 2
                                    | 3,
                            },
                            scopeLabel: `Program: ${activeProgramId}`,
                            meta: {
                                preparedBy:
                                    (user as any)
                                        ?.name ||
                                    (user as any)
                                        ?.email ||
                                    "—",
                            },
                        }
                    );

                const fileLabel =
                    spanMonths === 1
                        ? start.format(
                            "MMMM-YYYY"
                        )
                        : `${start.format(
                            "MMM-YYYY"
                        )}_to_${end.format(
                            "MMM-YYYY"
                        )}`;

                await exportMonthlyDepartmentReportDocx(
                    reportData,
                    {
                        filenameBase: `${departmentName}-${fileLabel}-${spanMonths ===
                            3
                            ? "Quarterly"
                            : "Monthly"
                            }-Report`,
                    }
                );

                message.success(
                    "Report exported."
                );
            } catch (error) {
                console.error(error);
                message.error(
                    "Failed to export report."
                );
            } finally {
                setExporting(false);
            }
        };

    if (
        identityLoading ||
        loading
    ) {
        return (
            <div
                style={{
                    padding: 24,
                    minHeight: "100vh",
                    display: "flex",
                    alignItems:
                        "center",
                    justifyContent:
                        "center",
                }}
            >
                <Spin size="large" />
            </div>
        );
    }

    return (
        <div
            style={{
                padding: '10px 24px',
            }}
        >


            <Row
                gutter={[16, 16]}
                wrap
                style={{
                    marginBottom: 16,
                    marginTop: 16,
                    width: "100%",
                }}
            >
                {[
                    {
                        title: "SMEs Reached",
                        value:
                            uniqueSmesHelped,
                        icon: (
                            <TeamOutlined
                                style={{
                                    color: METRIC_ICON_COLORS
                                        .reach
                                        .color,
                                }}
                            />
                        ),
                        iconBg:
                            METRIC_ICON_COLORS
                                .reach.bg,
                    },
                    {
                        title:
                            "Completion Rate",
                        value: `${completionRate}%`,
                        icon: (
                            <RiseOutlined
                                style={{
                                    color: METRIC_ICON_COLORS
                                        .completion
                                        .color,
                                }}
                            />
                        ),
                        iconBg:
                            METRIC_ICON_COLORS
                                .completion
                                .bg,
                    },
                    {
                        title:
                            "Avg Turnaround",
                        value:
                            avgTurnaround
                                ? `${avgTurnaround} days`
                                : "0 days",
                        icon: (
                            <FieldTimeOutlined
                                style={{
                                    color: METRIC_ICON_COLORS
                                        .turnaround
                                        .color,
                                }}
                            />
                        ),
                        iconBg:
                            METRIC_ICON_COLORS
                                .turnaround
                                .bg,
                    },
                    {
                        title:
                            "Avg Feedback",
                        value:
                            avgFeedback
                                ? `${avgFeedback}/5`
                                : "No ratings",
                        icon: (
                            <StarOutlined
                                style={{
                                    color: METRIC_ICON_COLORS
                                        .feedback
                                        .color,
                                }}
                            />
                        ),
                        iconBg:
                            METRIC_ICON_COLORS
                                .feedback
                                .bg,
                    },
                    {
                        title:
                            "Overdue Carryover",
                        value:
                            overdueTotal,
                        icon: (
                            <WarningOutlined
                                style={{
                                    color: METRIC_ICON_COLORS
                                        .overdue
                                        .color,
                                }}
                            />
                        ),
                        iconBg:
                            METRIC_ICON_COLORS
                                .overdue.bg,
                    },
                ].map((metric) => (
                    <Col
                        flex="1 1 210px"
                        key={
                            metric.title
                        }
                    >
                        <MotionCard.Metric
                            title={
                                metric.title
                            }
                            value={
                                metric.value
                            }
                            icon={
                                metric.icon
                            }
                            iconBg={
                                metric.iconBg
                            }
                        />
                    </Col>
                ))}
            </Row>

            <DashboardFilterBar marginBottom={16}>
                <Row
                    gutter={[12, 12]}
                    align="middle"
                    wrap={false}
                    style={{
                        width: "100%",
                        margin: 0,
                    }}
                >
                    {/* Milestone Journey */}
                    <Col
                        flex="1 1 0"
                        style={{
                            minWidth: 0,
                        }}
                    >
                        <div
                            className="reporting-filter-control"
                            style={{
                                width: "100%",
                            }}
                        >
                            <MilestoneJourneyButton
                                scope="operations"
                                departmentId={journeyDepartmentIds[0]}
                                departmentIds={journeyDepartmentIds}
                                programId={
                                    isAllPrograms
                                        ? null
                                        : activeProgramId
                                }
                            />
                        </div>
                    </Col>

                    {/* Date Range */}
                    <Col
                        flex="1 1 0"
                        style={{
                            minWidth: 0,
                        }}
                    >
                        <RangePicker
                            value={dateRange}
                            onChange={(value) =>
                                value &&
                                setDateRange([
                                    value[0] as Dayjs,
                                    value[1] as Dayjs,
                                ])
                            }
                            style={{
                                width: "100%",
                            }}
                        />
                    </Col>

                    {/* Department */}
                    {childDepartments.length > 0 && (
                        <Col
                            flex="1 1 0"
                            style={{
                                minWidth: 0,
                            }}
                        >
                            <Select
                                value={departmentScope}
                                onChange={(value) =>
                                    setDepartmentScope(
                                        String(value)
                                    )
                                }
                                style={{
                                    width: "100%",
                                }}
                                options={[
                                    {
                                        label: "All",
                                        value: "all",
                                    },
                                    {
                                        label: String(
                                            user?.departmentName ||
                                            "My Department"
                                        ),
                                        value: "my",
                                    },
                                    ...childDepartments.map(
                                        (department) => ({
                                            label: department.name,
                                            value: department.id,
                                        })
                                    ),
                                ]}
                            />
                        </Col>
                    )}

                    {/* View */}
                    <Col
                        flex="1 1 0"
                        style={{
                            minWidth: 0,
                        }}
                    >
                        <Segmented
                            block
                            value={view}
                            onChange={(value) =>
                                setView(value as ReportingView)
                            }
                            options={[
                                {
                                    label: "Overview",
                                    value: "Overview",
                                    icon: <AppstoreOutlined />,
                                },
                                {
                                    label: "Facilitators",
                                    value: "Facilitators",
                                    icon: <TeamOutlined />,
                                },
                                {
                                    label: "Reach",
                                    value: "Reach",
                                    icon: <RadarChartOutlined />,
                                },
                                {
                                    label: "Bottlenecks",
                                    value: "Bottlenecks",
                                    icon: <WarningOutlined />,
                                },
                            ]}
                            style={{
                                width: "100%",
                            }}
                        />
                    </Col>
                </Row>
            </DashboardFilterBar>

            {(aiChart ||
                aiLoading) && (
                    <Row
                        gutter={16}
                        style={{
                            marginBottom: 16,
                        }}
                    >
                        <Col xs={24}>
                            <Card
                                style={
                                    cardStyle
                                }
                                title="Asked"
                                extra={
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={
                                            <CloseOutlined />
                                        }
                                        onClick={() =>
                                            setAiChart(
                                                null
                                            )
                                        }
                                        aria-label="Dismiss AI chart"
                                    />
                                }
                            >
                                {aiLoading ? (
                                    <div
                                        style={{
                                            display:
                                                "flex",
                                            justifyContent:
                                                "center",
                                            padding: 40,
                                        }}
                                    >
                                        <Spin />
                                    </div>
                                ) : (
                                    aiChart && (
                                        <ChartSpecRenderer
                                            chart={
                                                aiChart
                                            }
                                            height={
                                                340
                                            }
                                        />
                                    )
                                )}
                            </Card>
                        </Col>
                    </Row>
                )}

            {view ===
                "Overview" && (
                    <OverviewReportView
                        filteredRows={
                            filteredRows
                        }
                        scopedRows={
                            scopedRows
                        }
                        dateRange={
                            dateRange
                        }
                        neededTotal={
                            neededTotal
                        }
                        completedTotal={
                            completedTotal
                        }
                        remainingTotal={
                            remainingTotal
                        }
                    />
                )}

            {view ===
                "Facilitators" && (
                    <FacilitatorsReportView
                        filteredRows={
                            filteredRows
                        }
                        dateRange={
                            dateRange
                        }
                    />
                )}

            {view === "Reach" && (
                <ReachAnalytics
                    rows={
                        filteredRows
                    }
                    participants={
                        participants
                    }
                    loading={
                        loading ||
                        participantsLoading
                    }
                    departmentId={
                        user?.departmentId ||
                        ""
                    }
                    isMain={
                        childDepartments.length >
                        0
                    }
                    departmentOptions={[
                        ...(user?.departmentId
                            ? [
                                {
                                    value: String(
                                        user.departmentId
                                    ),
                                    label: String(
                                        user.departmentName ||
                                        "My Department"
                                    ),
                                },
                            ]
                            : []),
                        ...childDepartments.map(
                            (
                                department
                            ) => ({
                                value: department.id,
                                label: department.name,
                            })
                        ),
                    ]}
                />
            )}

            {view ===
                "Bottlenecks" && (
                    <BottlenecksReportView
                        filteredRows={
                            filteredRows
                        }
                        dateRange={
                            dateRange
                        }
                    />
                )}
        </div>
    );
};

export default ReportingDashboard;
