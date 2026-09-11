// SAProvincesDrillMap.tsx
import React, { useEffect, useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import HCMap from "highcharts/modules/map";
import HCDrilldown from "highcharts/modules/drilldown";
import {
    Button,
    Modal,
    Row,
    Col,
    Space,
    Card,
    Typography,
    Empty,
    Skeleton,
} from "antd";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    DocumentData,
    documentId,
} from "firebase/firestore";
import { db } from "@/firebase";
import { getCanonicalInterventionStatus } from "./interventionStatus";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { filterReportRecords } from "@/utils/reportVisibility";

if (typeof HCMap === "function") HCMap(Highcharts);
if (typeof HCDrilldown === "function") HCDrilldown(Highcharts);

Highcharts.setOptions({
    plotOptions: {
        series: { animation: { duration: 600 } },
    },
});

const { Text } = Typography;

const cardStyle: React.CSSProperties = {
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.12)",
    transition: "all 0.3s ease",
    borderRadius: 8,
    border: "1px solid #d6e4ff",
    padding: 16,
};

type Metric = "interventions" | "incubatees";
type ProvinceName = "Gauteng" | "North West" | "Free State";

type AssignedInterventionRow = {
    id: string;
    participantId?: string;
    branchId?: string;
    status?: string;
    interventionStatus?: string;
    assignmentStatus?: string;
    assigneeAcceptanceStatus?: string;
    participantAcceptanceStatus?: string;
    assigneeCompletionStatus?: string;
    participantCompletionStatus?: string;
    beneficiaryCompletionStatus?: string;
    completionStatus?: string;
    programId?: string;
    createdAt?: Date;
    completedAt?: Date;
    updatedAt?: Date;
};

type ApplicationRow = {
    id: string;
    participantId?: string;
    branchId?: string;
    applicationStatus?: string;
    programId?: string;
    createdAt?: Date;
    updatedAt?: Date;
};

type BranchInfo = {
    id: string;
    name: string;
    province: ProvinceName;
};

type BranchInterventionAgg = {
    completed: number[];
    inProgress: number[];
    assigned: number[];
};

type BranchApplicationAgg = {
    accepted: number[];
};

type Props = {
    provincesGeo?: any;
    municipalitiesGeo?: any;
    metric?: Metric;
    dateFrom: Date;
    dateTo: Date;
    programId?: string;
};

const PROV_ALLOWED: ProvinceName[] = ["Gauteng", "North West", "Free State"];

const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

// Same palette family as DepartmentInterventionsDrilldown
const STATUS_COLORS: Record<string, string> = {
    assigned: "#1677ff",
    "in-progress": "#faad14",
    completed: "#52c41a",
    declined: "#ff4d4f",
    rejected: "#ff4d4f",
    pending: "#8c8c8c",
    approved: "#13c2c2",
    accepted: "#2f54eb",
    cancelled: "#595959",
    unknown: "#bfbfbf",
};

const tsToDate = (v: any): Date | undefined => {
    if (!v) return undefined;
    if (v instanceof Date) return v;
    if (v?.toDate) return v.toDate();
    if (typeof v === "string" || typeof v === "number") {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
};

const sumArray = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

const normalizeProvince = (v?: string): ProvinceName | undefined => {
    const raw = String(v || "")
        .replace(/province/gi, "")
        .trim()
        .toLowerCase();

    if (raw === "gauteng") return "Gauteng";
    if (raw === "north west" || raw === "northwest") return "North West";
    if (raw === "free state" || raw === "freestate") return "Free State";
    return undefined;
};

const acceptedOnly = (status?: string) => {
    const s = (status || "").toLowerCase().trim();
    return s === "accepted";
};

const SAProvincesDrillMap: React.FC<Props> = ({
    provincesGeo,
    municipalitiesGeo,
    metric = "interventions",
    dateFrom,
    dateTo,
    programId,
}) => {
    const { user } = useFullIdentity() as any;

    const [provGeo, setProvGeo] = useState<any>(provincesGeo || null);
    const [muniGeo, setMuniGeo] = useState<any>(municipalitiesGeo || null);
    const [loading, setLoading] = useState(false);

    const [assignedRows, setAssignedRows] = useState<AssignedInterventionRow[]>(
        []
    );
    const [applicationRows, setApplicationRows] = useState<ApplicationRow[]>([]);

    const [branchInfoById, setBranchInfoById] = useState<
        Record<string, BranchInfo>
    >({});
    const [participantBranchById, setParticipantBranchById] = useState<
        Record<string, string>
    >({});
    const [allowedBranchIds, setAllowedBranchIds] = useState<string[]>([]);

    const [expanded, setExpanded] = useState(false);
    const [selectedProvince, setSelectedProvince] = useState<ProvinceName | null>(
        null
    );
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

    useEffect(() => {
        if (!provincesGeo) {
            fetch("/data/provinces.json")
                .then((r) => r.json())
                .then(setProvGeo)
                .catch(() => setProvGeo(null));
        }
    }, [provincesGeo]);

    useEffect(() => {
        if (!municipalitiesGeo) {
            fetch("/data/municipalities.json")
                .then((r) => r.json())
                .then(setMuniGeo)
                .catch(() => setMuniGeo(null));
        }
    }, [municipalitiesGeo]);

    useEffect(() => {
        if (!programId) return;
        let cancelled = false;

        const run = async () => {
            setLoading(true);
            try {
                let branchIds: string[] = [];
                if (programId) {
                    // Specific programme: keep its configured branch scope.
                    const programSnap = await getDoc(doc(db, "programs", programId));
                    if (!programSnap.exists()) {
                        if (!cancelled) {
                            setAssignedRows([]);
                            setApplicationRows([]);
                            setBranchInfoById({});
                            setParticipantBranchById({});
                            setAllowedBranchIds([]);
                        }
                        return;
                    }

                    const programData = programSnap.data() as DocumentData;
                    const primaryBranchId = String(programData?.assignedBranch?.id || "").trim();
                    const supportedBranchIds = Array.isArray(programData?.supportedBranchIds)
                        ? programData.supportedBranchIds
                            .map((x: any) => String(x).trim())
                            .filter(Boolean)
                        : [];
                    branchIds = programData?.isMultiBranch
                        ? Array.from(new Set(supportedBranchIds))
                        : primaryBranchId
                            ? [primaryBranchId]
                            : [];
                } else {
                    // All Programs: every branch belonging to this company is in scope.
                    const branchSnap = await getDocs(
                        query(
                            collection(db, "branches")
                        )
                    );
                    branchIds = branchSnap.docs.map((branch) => branch.id);
                }

                const nextAllowedBranchIds = branchIds.filter(Boolean);

                // 2. Branch docs
                const nextBranchInfoById: Record<string, BranchInfo> = {};

                if (nextAllowedBranchIds.length) {
                    const chunkSize = 10;
                    for (let i = 0; i < nextAllowedBranchIds.length; i += chunkSize) {
                        const chunk = nextAllowedBranchIds.slice(i, i + chunkSize);

                        const brSnap = await getDocs(
                            query(
                                collection(db, "branches"),
                                where(documentId(), "in", chunk)
                            )
                        );

                        brSnap.docs.forEach((d) => {
                            const x = d.data() as DocumentData;
                            const province = normalizeProvince(
                                x.province || x.location || x.region || x.provincename || x.area
                            );

                            if (!province) return;

                            nextBranchInfoById[d.id] = {
                                id: d.id,
                                name: String(x.name || x.branchName || "Unknown Branch"),
                                province,
                            };
                        });
                    }
                }

                // 3. Accepted applications only
                const appConstraints = [where("applicationStatus", "==", "accepted")];
                if (programId) appConstraints.unshift(where("programId", "==", programId));
                const appSnap = await getDocs(
                    query(collection(db, "applications"), ...appConstraints)
                );

                const appRows: ApplicationRow[] = filterReportRecords(appSnap.docs.map(d => ({ id: d.id, ...(d.data() as DocumentData) })), user?.email)
                    .map((d) => {
                        const x = d as DocumentData;
                        return {
                            id: d.id,
                            participantId:
                                x.participantId ||
                                x.participantID ||
                                x.participant ||
                                x.incubateeId ||
                                undefined,
                            branchId:
                                x.branchId || x.assignedBranchId || x.branch?.id || undefined,
                            applicationStatus: x.applicationStatus || x.status,
                            programId: x.programId,
                            createdAt: tsToDate(x.createdAt || x.submittedAt || x.date),
                            updatedAt: tsToDate(x.updatedAt || x.lastUpdated),
                        };
                    })
                    .filter(
                        (row) => !!row.branchId && !!nextBranchInfoById[row.branchId!]
                    );

                const nextParticipantBranchById: Record<string, string> = {};
                appRows.forEach((row) => {
                    if (row.participantId && row.branchId) {
                        nextParticipantBranchById[row.participantId] = row.branchId;
                    }
                });

                // 4. Assigned interventions
                const aiDocs = new Map<string, DocumentData>();
                if (programId) {
                    const aiSnap = await getDocs(
                        query(
                            collection(db, "assignedInterventions"),
                            where("programId", "==", programId)
                        )
                    );
                    aiSnap.docs.forEach((assignment) => aiDocs.set(assignment.id, assignment.data()));
                } else {
                    const participantIds = Array.from(
                        new Set(appRows.map((row) => row.participantId).filter(Boolean) as string[])
                    );
                    for (let index = 0; index < participantIds.length; index += 10) {
                        const ids = participantIds.slice(index, index + 10);
                        const aiSnap = await getDocs(
                            query(
                                collection(db, "assignedInterventions"),
                                where("participantId", "in", ids)
                            )
                        );
                        aiSnap.docs.forEach((assignment) => aiDocs.set(assignment.id, assignment.data()));
                    }
                }

                const aiRows: AssignedInterventionRow[] = filterReportRecords(
                    Array.from(aiDocs.entries()).map(([id, data]) => ({ id, ...data })),
                    user?.email
                )
                    .map((d) => {
                        const x = d as DocumentData;
                        const directBranchId =
                            x.branchId || x.assignedBranchId || x.branch?.id || undefined;
                        const participantId =
                            x.participantId ||
                            x.participantID ||
                            x.participant ||
                            x.incubateeId ||
                            undefined;

                        const resolvedBranchId =
                            directBranchId ||
                            (participantId
                                ? nextParticipantBranchById[participantId]
                                : undefined);

                        return {
                            id: d.id,
                            participantId,
                            branchId: resolvedBranchId,
                            assignmentStatus: x.assignmentStatus,
                            status: x.status,
                            interventionStatus: x.interventionStatus,
                            assigneeAcceptanceStatus: x.assigneeAcceptanceStatus,
                            participantAcceptanceStatus: x.participantAcceptanceStatus,
                            assigneeCompletionStatus: x.assigneeCompletionStatus,
                            participantCompletionStatus: x.participantCompletionStatus,
                            beneficiaryCompletionStatus: x.beneficiaryCompletionStatus,
                            completionStatus: x.completionStatus,
                            programId: x.programId,
                            createdAt: tsToDate(x.createdAt || x.assignedAt || x.date),
                            completedAt: tsToDate(x.completedAt),
                            updatedAt: tsToDate(
                                x.updatedAt || x.completedAt || x.lastUpdated
                            ),
                        };
                    })
                    .filter(
                        (row) => !!row.branchId && !!nextBranchInfoById[row.branchId!]
                    );

                if (cancelled) return;

                setAllowedBranchIds(nextAllowedBranchIds);
                setBranchInfoById(nextBranchInfoById);
                setParticipantBranchById(nextParticipantBranchById);
                setApplicationRows(appRows);
                setAssignedRows(aiRows);
            } catch (err) {
                console.error("[SAProvincesDrillMap] load error:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [programId, user?.email]);

    const inRange = (d?: Date) => {
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
    };

    const provinceShapes = useMemo(() => {
        if (!provGeo) return [];
        const shapes = (Highcharts as any).geojson(provGeo);
        return shapes
            .map((s: any) => {
                const n = (s?.properties?.ADM1_EN || s?.name || "")
                    .replace(/Province/i, "")
                    .trim();
                s.name = n;
                return s;
            })
            .filter((s: any) => PROV_ALLOWED.includes(s.name));
    }, [provGeo]);

    // Use municipalities geo only as province drill surface, branch labels now come from branch docs
    const provinceBranchFeatures = useMemo(() => {
        const out: Record<ProvinceName, any[]> = {
            Gauteng: [],
            "North West": [],
            "Free State": [],
        };

        const branchEntries = Object.values(branchInfoById);

        branchEntries.forEach((branch) => {
            out[branch.province].push({
                name: branch.name,
                __branchId__: branch.id,
                value: 0,
            });
        });

        return out;
    }, [branchInfoById]);

    const interventionsByBranch = useMemo(() => {
        const out: Record<string, BranchInterventionAgg> = {};

        assignedRows.forEach((row) => {
            const branchId =
                row.branchId ||
                (row.participantId
                    ? participantBranchById[row.participantId]
                    : undefined);

            if (!branchId || !branchInfoById[branchId]) return;

            const cls = getCanonicalInterventionStatus(row);
            if (cls === "unknown") return;

            const date =
                cls === "completed"
                    ? row.completedAt || row.updatedAt || row.createdAt
                    : row.createdAt || row.updatedAt;

            if (!date || !inRange(date)) return;
            const m = date.getMonth();

            if (!out[branchId]) {
                out[branchId] = {
                    completed: Array(12).fill(0),
                    inProgress: Array(12).fill(0),
                    assigned: Array(12).fill(0),
                };
            }

            if (cls === "completed") out[branchId].completed[m]++;
            else if (cls === "in-progress") out[branchId].inProgress[m]++;
            else if (cls === "assigned") out[branchId].assigned[m]++;
        });

        return out;
    }, [assignedRows, participantBranchById, branchInfoById, dateFrom, dateTo]);

    const applicationsByBranch = useMemo(() => {
        const out: Record<string, BranchApplicationAgg> = {};

        applicationRows.forEach((row) => {
            if (!acceptedOnly(row.applicationStatus)) return;

            const branchId = row.branchId;
            if (!branchId || !branchInfoById[branchId]) return;

            const date = row.createdAt || row.updatedAt;
            if (!date || !inRange(date)) return;
            const m = date.getMonth();

            if (!out[branchId]) {
                out[branchId] = {
                    accepted: Array(12).fill(0),
                };
            }

            out[branchId].accepted[m]++;
        });

        return out;
    }, [applicationRows, branchInfoById, dateFrom, dateTo]);

    const provinceTotals = useMemo(() => {
        const base: Record<ProvinceName, number> = {
            Gauteng: 0,
            "North West": 0,
            "Free State": 0,
        };

        if (metric === "interventions") {
            Object.entries(interventionsByBranch).forEach(([branchId, agg]) => {
                const branch = branchInfoById[branchId];
                if (!branch) return;

                const total =
                    sumArray(agg.completed) +
                    sumArray(agg.inProgress) +
                    sumArray(agg.assigned);

                base[branch.province] += total;
            });
        } else {
            Object.entries(applicationsByBranch).forEach(([branchId, agg]) => {
                const branch = branchInfoById[branchId];
                if (!branch) return;

                const total = sumArray(agg.accepted);
                base[branch.province] += total;
            });
        }

        return base;
    }, [metric, interventionsByBranch, applicationsByBranch, branchInfoById]);

    const branchTotalsForProvince = (prov: ProvinceName) => {
        const out: Array<{ branchId: string; branchName: string; value: number }> =
            [];

        Object.values(branchInfoById)
            .filter((branch) => branch.province === prov)
            .forEach((branch) => {
                let value = 0;

                if (metric === "interventions") {
                    const agg = interventionsByBranch[branch.id];
                    value = agg
                        ? sumArray(agg.completed) +
                        sumArray(agg.inProgress) +
                        sumArray(agg.assigned)
                        : 0;
                } else {
                    const agg = applicationsByBranch[branch.id];
                    value = agg ? sumArray(agg.accepted) : 0;
                }

                out.push({
                    branchId: branch.id,
                    branchName: branch.name,
                    value,
                });
            });

        return out;
    };

    const makeMapOptions = (): Highcharts.Options => {
        const topLevelData = provinceShapes.map((shape: any) => ({
            ...shape,
            value: provinceTotals[shape.name as ProvinceName] || 0,
            drilldown: shape.name,
        }));

        const subtitleMetric =
            metric === "interventions" ? "Interventions" : "Accepted Incubatees";

        return {
            chart: {
                animation: { duration: 500 },
                events: {
                    drilldown: function (e: any) {
                        const prov = e.point?.name as ProvinceName;
                        setSelectedProvince(prov);
                        setSelectedBranchId(null);

                        const branchScores = branchTotalsForProvince(prov);

                        (this as any).addSeriesAsDrilldown(e.point, {
                            type: "column",
                            name: prov,
                            data: branchScores.map((item) => ({
                                name: item.branchName,
                                y: item.value,
                                __branchId__: item.branchId,
                                color: STATUS_COLORS.assigned,
                            })),
                            dataLabels: { enabled: true, format: "{point.y}" },
                            tooltip: {
                                pointFormat: "<b>{point.name}</b><br/>Value: {point.y}",
                            },
                            point: {
                                events: {
                                    click: function () {
                                        const branchId = (this as any).__branchId__ as string;
                                        setSelectedBranchId((prev) =>
                                            prev === branchId ? null : branchId
                                        );
                                    },
                                },
                            },
                        });
                    },
                    afterDrillUp: function () {
                        setSelectedProvince(null);
                        setSelectedBranchId(null);
                    },
                },
            },
            title: { text: "" },
            subtitle: {
                text: `${subtitleMetric} (${dateFrom.toLocaleDateString()} → ${dateTo.toLocaleDateString()})`,
            },
            mapNavigation: {
                enabled: false,
                enableButtons: false,
                enableMouseWheelZoom: false,
                enableDoubleClickZoom: false,
                enableTouchZoom: false,
            } as any,
            navigation: { buttonOptions: { enabled: false } } as any,
            colorAxis: {
                min: 0,
                stops: [
                    [0, "#E6F7FF"],
                    [0.5, "#91D5FF"],
                    [1, "#0050B3"],
                ],
            },
            legend: { enabled: true },
            credits: { enabled: false },
            drilldown: {
                breadcrumbs: { floating: true },
                drillUpButton: { relativeTo: "spacingBox", position: { x: 0, y: 50 } },
            },
            series: [
                {
                    type: "map",
                    name: "Provinces",
                    data: topLevelData,
                    dataLabels: { enabled: true, format: "{point.name}" },
                    tooltip: {
                        pointFormat: "<b>{point.name}</b><br/>Value: {point.value}",
                    },
                } as any,
            ],
        };
    };

    const [mapOptions, setMapOptions] =
        useState<Highcharts.Options>(makeMapOptions);

    useEffect(() => {
        if (!provGeo || !provinceShapes.length) return;
        setMapOptions(makeMapOptions());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        provGeo,
        muniGeo,
        provinceShapes.length,
        JSON.stringify(provinceTotals),
        metric,
        dateFrom.getTime(),
        dateTo.getTime(),
        JSON.stringify(Object.keys(branchInfoById)),
    ]);

    const sideChartOptions: Highcharts.Options = useMemo(() => {
        const selectedBranch = selectedBranchId
            ? branchInfoById[selectedBranchId]
            : undefined;

        const scopeTitle = selectedBranch
            ? selectedBranch.name
            : selectedProvince
                ? selectedProvince
                : "South Africa";

        if (metric === "interventions") {
            const combined: BranchInterventionAgg = {
                completed: Array(12).fill(0),
                inProgress: Array(12).fill(0),
                assigned: Array(12).fill(0),
            };

            Object.entries(interventionsByBranch).forEach(([branchId, agg]) => {
                const branch = branchInfoById[branchId];
                if (!branch) return;

                const inScope = selectedBranchId
                    ? branchId === selectedBranchId
                    : selectedProvince
                        ? branch.province === selectedProvince
                        : true;

                if (!inScope) return;

                combined.completed = combined.completed.map(
                    (v, i) => v + (agg.completed[i] || 0)
                );
                combined.inProgress = combined.inProgress.map(
                    (v, i) => v + (agg.inProgress[i] || 0)
                );
                combined.assigned = combined.assigned.map(
                    (v, i) => v + (agg.assigned[i] || 0)
                );
            });

            return {
                chart: { type: "column", animation: { duration: 500 } },
                title: { text: `Monthly Intervention Status — ${scopeTitle}` },
                xAxis: { categories: months },
                yAxis: {
                    title: { text: "Interventions" },
                    allowDecimals: false,
                    min: 0,
                    stackLabels: { enabled: true },
                },
                legend: { enabled: true },
                tooltip: { shared: true },
                plotOptions: { column: { stacking: "normal" } },
                series: [
                    {
                        type: "column",
                        name: "Completed",
                        data: combined.completed,
                        color: STATUS_COLORS.completed,
                    },
                    {
                        type: "column",
                        name: "In Progress",
                        data: combined.inProgress,
                        color: STATUS_COLORS["in-progress"],
                    },
                    {
                        type: "column",
                        name: "Assigned",
                        data: combined.assigned,
                        color: STATUS_COLORS.assigned,
                    },
                ],
                credits: { enabled: false },
            };
        }

        const combined: BranchApplicationAgg = {
            accepted: Array(12).fill(0),
        };

        Object.entries(applicationsByBranch).forEach(([branchId, agg]) => {
            const branch = branchInfoById[branchId];
            if (!branch) return;

            const inScope = selectedBranchId
                ? branchId === selectedBranchId
                : selectedProvince
                    ? branch.province === selectedProvince
                    : true;

            if (!inScope) return;

            combined.accepted = combined.accepted.map(
                (v, i) => v + (agg.accepted[i] || 0)
            );
        });

        return {
            chart: { type: "column", animation: { duration: 500 } },
            title: { text: `Monthly Accepted Incubatees — ${scopeTitle}` },
            xAxis: { categories: months },
            yAxis: {
                title: { text: "Accepted Incubatees" },
                allowDecimals: false,
                min: 0,
                stackLabels: { enabled: true },
            },
            legend: { enabled: true },
            tooltip: { shared: true },
            plotOptions: { column: { stacking: "normal" } },
            series: [
                {
                    type: "column",
                    name: "Accepted",
                    data: combined.accepted,
                    color: STATUS_COLORS.accepted,
                },
            ],
            credits: { enabled: false },
        };
    }, [
        metric,
        selectedProvince,
        selectedBranchId,
        interventionsByBranch,
        applicationsByBranch,
        branchInfoById,
    ]);

    const hasAnyTopData = useMemo(() => {
        return Object.values(provinceTotals).some((v) => v > 0);
    }, [provinceTotals]);

    const currentScopeLabel = useMemo(() => {
        if (selectedBranchId && branchInfoById[selectedBranchId]) {
            return `Branch • ${branchInfoById[selectedBranchId].name}`;
        }
        if (selectedProvince) return `Province • ${selectedProvince}`;
        return "National • South Africa";
    }, [selectedBranchId, selectedProvince, branchInfoById]);

    return (
        <div>
            {loading ? (
                <Card style={{ ...cardStyle, marginTop: 12 }}>
                    <Skeleton
                        active
                        title={{ width: 260 }}
                        paragraph={false}
                        style={{ marginBottom: 16 }}
                    />
                    <Row gutter={16}>
                        <Col xs={24} lg={12}>
                            <Skeleton.Node active style={{ width: "100%", height: 360 }} />
                        </Col>
                        <Col xs={24} lg={12}>
                            <Skeleton
                                active
                                title={{ width: 160 }}
                                paragraph={false}
                                style={{ marginBottom: 12 }}
                            />
                            <Skeleton.Node active style={{ width: "100%", height: 320 }} />
                        </Col>
                    </Row>
                </Card>
            ) : (
                <>
                    <Card
                        style={{ ...cardStyle, marginTop: 12 }}
                        title={
                            metric === "interventions"
                                ? "Interventions — Geographic Distribution"
                                : "Accepted Incubatees — Geographic Distribution"
                        }
                        extra={
                            <Space size="middle" wrap>
                                <Button onClick={() => setExpanded(true)}>Expand</Button>
                            </Space>
                        }
                    >
                        {!hasAnyTopData ? (
                            <Empty description="No geographic data available for the selected filters." />
                        ) : (
                            <Row gutter={16}>
                                <Col xs={24} lg={12}>
                                    {provGeo ? (
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            constructorType="mapChart"
                                            options={mapOptions}
                                            immutable
                                        />
                                    ) : (
                                        <div>Loading map…</div>
                                    )}
                                </Col>

                                <Col xs={24} lg={12}>
                                    <Card variant="borderless">
                                        <Space wrap style={{ marginBottom: 8 }}>
                                            <Text strong>Scope:</Text>
                                            <Text>{currentScopeLabel}</Text>
                                            {(selectedProvince || selectedBranchId) && (
                                                <Button
                                                    size="small"
                                                    onClick={() => {
                                                        setSelectedBranchId(null);
                                                        setSelectedProvince(null);
                                                    }}
                                                >
                                                    Clear selection
                                                </Button>
                                            )}
                                        </Space>

                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={sideChartOptions}
                                        />
                                    </Card>
                                </Col>
                            </Row>
                        )}
                    </Card>

                    <Modal
                        open={expanded}
                        onCancel={() => setExpanded(false)}
                        footer={null}
                        width={1100}
                        title="Province → Branch drill-down"
                    >
                        {!hasAnyTopData ? (
                            <Empty description="No geographic data available for the selected filters." />
                        ) : (
                            <Row gutter={16}>
                                <Col span={12}>
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        constructorType="mapChart"
                                        options={mapOptions}
                                        immutable
                                    />
                                </Col>
                                <Col span={12}>
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={sideChartOptions}
                                    />
                                </Col>
                            </Row>
                        )}
                    </Modal>
                </>
            )}
        </div>
    );
};

export default SAProvincesDrillMap;
