// SAProvincesDrillMap.tsx
// Geographic distribution card: provinces shaded by the chosen measure, with a
// click zooming into the province and showing its centres as pins at their
// attendance-centre coordinates. Centres without captured coordinates still
// count in every total; they are only left off the map and listed in the footer.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import "highcharts/highcharts-more";
import "highcharts/modules/map";
import {
    Breadcrumb,
    Button,
    Modal,
    Row,
    Col,
    Space,
    Typography,
    Skeleton,
    Segmented,
    Progress,
    theme,
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
import { fetchCenterLocation, isCenterConfigured } from "@/services/attendanceCenters";
import { findSaTown, SaTown } from "./saTowns";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricTile, MetricTone } from "@/components/dashboards/metrics/MetricTile";
import {
    CheckCircleOutlined,
    SolutionOutlined,
    TeamOutlined,
    UserAddOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

type Metric = "interventions" | "incubatees" | "completion";
type ProvinceName =
    | "Gauteng"
    | "North West"
    | "Free State"
    | "Limpopo"
    | "Mpumalanga"
    | "KwaZulu-Natal"
    | "Eastern Cape"
    | "Western Cape"
    | "Northern Cape";
type InterventionClass = "completed" | "in-progress" | "assigned";

type AssignedInterventionRow = {
    id: string;
    participantId?: string;
    branchId?: string;
    title?: string;
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
    town?: SaTown;
};

type CentrePin = {
    branchId: string;
    lat: number;
    lon: number;
    // Placed at the branch's town because no exact centre location is captured.
    approximateTown?: string;
};

type ScopedIntervention = {
    branchId: string;
    participantId?: string;
    title: string;
    cls: InterventionClass;
    month: number;
};

type ScopedAcceptance = {
    branchId: string;
    month: number;
};

type ScopeStats = {
    interventions: number;
    completed: number;
    incubatees: number;
    activeSmes: number;
};

type Props = {
    provincesGeo?: any;
    metric?: Metric;
    dateFrom: Date;
    dateTo: Date;
    programId?: string;
};

const PROV_ALLOWED: ProvinceName[] = [
    "Gauteng",
    "North West",
    "Free State",
    "Limpopo",
    "Mpumalanga",
    "KwaZulu-Natal",
    "Eastern Cape",
    "Western Cape",
    "Northern Cape",
];

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
    accepted: "#2f54eb",
};

const METRIC_OPTIONS = [
    { label: "Interventions", value: "interventions" },
    { label: "Incubatees", value: "incubatees" },
    { label: "Completion rate", value: "completion" },
];

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

const normalizeProvince = (v?: string): ProvinceName | undefined => {
    // Compare without spaces, dashes or the word "province", so "KwaZulu Natal",
    // "kwazulu-natal" and "North-West Province" all match.
    const raw = String(v || "")
        .replace(/province/gi, "")
        .replace(/^orange /i, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");

    if (raw === "kzn") return "KwaZulu-Natal";
    if (raw === "nw") return "North West";
    return PROV_ALLOWED.find(
        (prov) => prov.toLowerCase().replace(/[^a-z]/g, "") === raw
    );
};

const acceptedOnly = (status?: string) => {
    const s = (status || "").toLowerCase().trim();
    return s === "accepted";
};

const inRing = (lon: number, lat: number, ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
};

const featureContains = (feature: any, lon: number, lat: number) => {
    const geometry = feature?.geometry;
    const polygons: number[][][][] =
        geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.coordinates || [];
    return polygons.some(
        (polygon) =>
            inRing(lon, lat, polygon[0]) &&
            !polygon.slice(1).some((hole) => inRing(lon, lat, hole))
    );
};

// The feature with the closest boundary vertex to the point.
const nearestFeature = (features: any[], lon: number, lat: number) => {
    let best: any = null;
    let bestDistance = Infinity;
    features.forEach((feature) => {
        const geometry = feature?.geometry;
        const polygons: number[][][][] =
            geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.coordinates || [];
        polygons.forEach((polygon) =>
            polygon[0].forEach(([x, y]) => {
                const distance = (x - lon) ** 2 + (y - lat) ** 2;
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = feature;
                }
            })
        );
    });
    return best;
};

const emptyStats = (): ScopeStats => ({
    interventions: 0,
    completed: 0,
    incubatees: 0,
    activeSmes: 0,
});

const completionRate = (s: ScopeStats) =>
    s.interventions ? Math.round((s.completed / s.interventions) * 100) : 0;

const measureOf = (s: ScopeStats, metric: Metric) =>
    metric === "interventions"
        ? s.interventions
        : metric === "incubatees"
            ? s.incubatees
            : completionRate(s);

const formatMeasure = (value: number, metric: Metric) =>
    metric === "completion" ? `${value}%` : String(value);

// Pins are coloured by completion rate whatever the measure.
const rateColor = (s: ScopeStats) => {
    if (!s.interventions) return "#8c8c8c";
    const rate = completionRate(s);
    if (rate >= 70) return STATUS_COLORS.completed;
    if (rate >= 40) return STATUS_COLORS["in-progress"];
    return "#ff4d4f";
};

const SAProvincesDrillMap: React.FC<Props> = ({
    provincesGeo,
    metric: initialMetric = "interventions",
    dateFrom,
    dateTo,
    programId,
}) => {
    const { user } = useFullIdentity() as any;
    const { token } = theme.useToken();

    const [provGeo, setProvGeo] = useState<any>(provincesGeo || null);
    const [loading, setLoading] = useState(false);
    const [metric, setMetric] = useState<Metric>(initialMetric);

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
    const [centreByBranchId, setCentreByBranchId] = useState<
        Record<string, CentrePin>
    >({});
    // Branches whose record names no recognisable province; they can't be
    // counted anywhere on the map, so the footer names them.
    const [unplacedBranchNames, setUnplacedBranchNames] = useState<string[]>([]);

    const [expanded, setExpanded] = useState(false);
    const [selectedProvince, setSelectedProvince] = useState<ProvinceName | null>(
        null
    );
    const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
    const [districtGeo, setDistrictGeo] = useState<any>(null);

    useEffect(() => {
        if (!provincesGeo) {
            fetch("/data/provinces.json")
                .then((r) => r.json())
                .then(setProvGeo)
                .catch(() => setProvGeo(null));
        }
    }, [provincesGeo]);

    // District shapes are only needed once someone drills into a province.
    useEffect(() => {
        if (!selectedProvince || districtGeo) return;
        fetch("/data/districts.json")
            .then((r) => r.json())
            .then(setDistrictGeo)
            .catch((err) => console.warn("[SAProvincesDrillMap] districts failed to load:", err));
    }, [selectedProvince, districtGeo]);

    useEffect(() => {
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
                            setCentreByBranchId({});
                            setUnplacedBranchNames([]);
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
                const nextUnplacedBranchNames: string[] = [];

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
                            // Some branches keep the province inside a location
                            // object, sometimes with only the city or address filled.
                            const location = x.location;
                            const name = String(x.name || x.branchName || "Unknown Branch");
                            const recordedProvince = [
                                x.province,
                                typeof location === "string" ? location : location?.province,
                                location?.city,
                                location?.address,
                                x.region,
                                x.provincename,
                                x.area,
                            ]
                                .map((value) => normalizeProvince(value))
                                .find(Boolean);

                            // The branch's town (from its name, city or address) gives
                            // a fallback pin, and the province when none is recorded.
                            const foundTown = findSaTown(
                                name,
                                location?.city,
                                location?.address,
                                typeof location === "string" ? location : undefined
                            );
                            // A town in another province is a different place with the
                            // same name (there are two Middelburgs), so it's ignored.
                            const town =
                                foundTown &&
                                (!recordedProvince ||
                                    normalizeProvince(foundTown.province) === recordedProvince)
                                    ? foundTown
                                    : undefined;
                            const province =
                                recordedProvince || normalizeProvince(town?.province);

                            if (!province) {
                                nextUnplacedBranchNames.push(name);
                                return;
                            }

                            nextBranchInfoById[d.id] = {
                                id: d.id,
                                name,
                                province,
                                town,
                            };
                        });
                    }
                }

                // Exact centre coordinates come from the attendance centre set up
                // for clock-in. Without them the pin goes at the branch's town and
                // is marked approximate; with neither, the branch has no pin.
                const nextCentreByBranchId: Record<string, CentrePin> = {};
                await Promise.all(
                    Object.values(nextBranchInfoById).map(async ({ id: branchId, town }) => {
                        try {
                            const centre = await fetchCenterLocation(db, { branchId });
                            if (centre && isCenterConfigured(centre)) {
                                nextCentreByBranchId[branchId] = {
                                    branchId,
                                    lat: centre.latitude,
                                    lon: centre.longitude,
                                };
                                return;
                            }
                        } catch (err) {
                            console.warn("[SAProvincesDrillMap] centre lookup failed:", branchId, err);
                        }
                        if (town) {
                            nextCentreByBranchId[branchId] = {
                                branchId,
                                lat: town.lat,
                                lon: town.lon,
                                approximateTown: town.name,
                            };
                        }
                    })
                );

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
                            title: x.interventionTitle || x.title || undefined,
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

                setBranchInfoById(nextBranchInfoById);
                setUnplacedBranchNames(nextUnplacedBranchNames.sort((a, b) => a.localeCompare(b)));
                setCentreByBranchId(nextCentreByBranchId);
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

    // A selection that no longer exists after a reload falls back to the country.
    useEffect(() => {
        if (selectedBranchId && !branchInfoById[selectedBranchId]) {
            setSelectedBranchId(null);
        }
    }, [branchInfoById, selectedBranchId]);

    const fromTime = dateFrom.getTime();
    const toTime = dateTo.getTime();

    const interventionsInRange = useMemo(() => {
        const out: ScopedIntervention[] = [];

        assignedRows.forEach((row) => {
            const branchId =
                row.branchId ||
                (row.participantId
                    ? participantBranchById[row.participantId]
                    : undefined);

            if (!branchId || !branchInfoById[branchId]) return;

            const cls = getCanonicalInterventionStatus(row);
            if (cls !== "completed" && cls !== "in-progress" && cls !== "assigned") return;

            const date =
                cls === "completed"
                    ? row.completedAt || row.updatedAt || row.createdAt
                    : row.createdAt || row.updatedAt;

            if (!date || date.getTime() < fromTime || date.getTime() > toTime) return;

            out.push({
                branchId,
                participantId: row.participantId,
                title: row.title || "Untitled intervention",
                cls,
                month: date.getMonth(),
            });
        });

        return out;
    }, [assignedRows, participantBranchById, branchInfoById, fromTime, toTime]);

    const acceptancesInRange = useMemo(() => {
        const out: ScopedAcceptance[] = [];

        applicationRows.forEach((row) => {
            if (!acceptedOnly(row.applicationStatus)) return;
            if (!row.branchId || !branchInfoById[row.branchId]) return;

            const date = row.createdAt || row.updatedAt;
            if (!date || date.getTime() < fromTime || date.getTime() > toTime) return;

            out.push({ branchId: row.branchId, month: date.getMonth() });
        });

        return out;
    }, [applicationRows, branchInfoById, fromTime, toTime]);

    // Stats for any set of branches, so provinces, pins and the panel all add up
    // from the same rows.
    const statsFor = useCallback(
        (inScope: (branchId: string) => boolean): ScopeStats => {
            const stats = emptyStats();
            const participants = new Set<string>();

            interventionsInRange.forEach((row) => {
                if (!inScope(row.branchId)) return;
                stats.interventions++;
                if (row.cls === "completed") stats.completed++;
                if (row.participantId) participants.add(row.participantId);
            });
            acceptancesInRange.forEach((row) => {
                if (inScope(row.branchId)) stats.incubatees++;
            });

            stats.activeSmes = participants.size;
            return stats;
        },
        [interventionsInRange, acceptancesInRange]
    );

    const statsByBranch = useMemo(() => {
        const out: Record<string, ScopeStats> = {};
        Object.keys(branchInfoById).forEach((branchId) => {
            out[branchId] = statsFor((id) => id === branchId);
        });
        return out;
    }, [branchInfoById, statsFor]);

    const statsByProvince = useMemo(() => {
        const out = {} as Record<ProvinceName, ScopeStats>;
        PROV_ALLOWED.forEach((prov) => {
            out[prov] = statsFor((id) => branchInfoById[id]?.province === prov);
        });
        return out;
    }, [branchInfoById, statsFor]);

    // Each pinned centre's district, from its exact or town location. A centre
    // without any location has no district and only counts at province level.
    const districtByBranchId = useMemo(() => {
        const out: Record<string, string> = {};
        if (!districtGeo?.features) return out;
        Object.values(centreByBranchId).forEach((pin) => {
            const branch = branchInfoById[pin.branchId];
            if (!branch) return;
            const candidates = districtGeo.features.filter(
                (feature: any) => feature.properties.province === branch.province
            );
            // Town points near a border can fall just outside the simplified
            // outline; the province's nearest district is then the best guess.
            const district =
                candidates.find((feature: any) => featureContains(feature, pin.lon, pin.lat)) ||
                nearestFeature(candidates, pin.lon, pin.lat);
            if (district) out[pin.branchId] = district.properties.name;
        });
        return out;
    }, [districtGeo, centreByBranchId, branchInfoById]);

    const provinceDistricts = useMemo(
        () =>
            selectedProvince && districtGeo?.features
                ? districtGeo.features.filter(
                    (feature: any) => feature.properties.province === selectedProvince
                )
                : [],
        [districtGeo, selectedProvince]
    );

    const statsByDistrict = useMemo(() => {
        const out: Record<string, { stats: ScopeStats; centres: string[] }> = {};
        provinceDistricts.forEach((feature: any) => {
            const name = feature.properties.name as string;
            out[name] = {
                stats: statsFor((id) => districtByBranchId[id] === name),
                centres: Object.keys(districtByBranchId).filter(
                    (id) => districtByBranchId[id] === name
                ),
            };
        });
        return out;
    }, [provinceDistricts, districtByBranchId, statsFor]);

    // The district shown in the trail: the chosen one, or the selected centre's.
    const activeDistrict =
        selectedDistrict || (selectedBranchId ? districtByBranchId[selectedBranchId] : null) || null;

    const inCurrentScope = useCallback(
        (branchId: string) =>
            selectedBranchId
                ? branchId === selectedBranchId
                : selectedDistrict
                    ? districtByBranchId[branchId] === selectedDistrict
                    : selectedProvince
                        ? branchInfoById[branchId]?.province === selectedProvince
                        : true,
        [selectedBranchId, selectedDistrict, selectedProvince, branchInfoById, districtByBranchId]
    );

    const scopeStats = useMemo(() => statsFor(inCurrentScope), [statsFor, inCurrentScope]);

    // Branches listed in the panel and checked for coordinates: the selected
    // district's or province's, or every branch at national level.
    const branchesInView = useMemo(
        () =>
            Object.values(branchInfoById).filter(
                (branch) =>
                    (!selectedProvince || branch.province === selectedProvince) &&
                    (!selectedDistrict || districtByBranchId[branch.id] === selectedDistrict)
            ),
        [branchInfoById, selectedProvince, selectedDistrict, districtByBranchId]
    );

    const unmappedBranches = useMemo(
        () =>
            branchesInView
                .filter((branch) => !centreByBranchId[branch.id])
                .sort((a, b) => a.name.localeCompare(b.name)),
        [branchesInView, centreByBranchId]
    );


    const provinceMapData = useMemo(() => {
        if (!provGeo?.features) return null;
        return {
            ...provGeo,
            features: provGeo.features
                .map((feature: any) => {
                    const name = normalizeProvince(
                        feature?.properties?.ADM1_EN || feature?.properties?.name
                    );
                    return name
                        ? { ...feature, properties: { ...feature.properties, name } }
                        : null;
                })
                .filter(Boolean),
        };
    }, [provGeo]);

    const selectProvince = (prov: ProvinceName | null) => {
        setSelectedProvince(prov);
        setSelectedDistrict(null);
        setSelectedBranchId(null);
    };

    const selectDistrict = (district: string | null) => {
        setSelectedDistrict(district);
        setSelectedBranchId(null);
    };

    // Clicking the selected centre again steps back up to its district.
    const selectBranch = (branchId: string) => {
        const branch = branchInfoById[branchId];
        if (!branch) return;
        const district = districtByBranchId[branchId] || null;
        setSelectedProvince(branch.province);
        setSelectedDistrict(district);
        setSelectedBranchId((prev) => (prev === branchId ? null : branchId));
    };

    const showDistricts = provinceDistricts.length > 0;

    const mapOptions = useMemo((): Highcharts.Options => {
        // Once a province is drilled into, only that province is drawn (the
        // provinces series stops drawing unlisted areas), and its districts
        // carry the shading: the province goes transparent underneath them
        // without a value, so the colour scale fits the districts.
        const provinceData = PROV_ALLOWED.filter(
            (prov) => !selectedProvince || prov === selectedProvince
        ).map((prov) =>
            selectedProvince && showDistricts
                ? { id: `province-${prov}`, name: prov, color: "rgba(0,0,0,0)" }
                : {
                    id: `province-${prov}`,
                    name: prov,
                    value: measureOf(statsByProvince[prov], metric),
                }
        );

        const districtData = provinceDistricts.map((feature: any) => {
            const name = feature.properties.name as string;
            const entry = statsByDistrict[name];
            const hasCentres = !!entry?.centres.length;
            const isSelected = name === activeDistrict;
            return {
                id: `district-${name}`,
                name,
                __centres__: entry?.centres.length || 0,
                ...(hasCentres
                    ? { value: measureOf(entry.stats, metric) }
                    : { color: token.colorFillSecondary }),
                ...(isSelected ? { borderColor: token.colorText, borderWidth: 2 } : {}),
            };
        });

        const pinStats = Object.values(centreByBranchId)
            .map((pin) => ({ pin, branch: branchInfoById[pin.branchId] }))
            // Drilled into a province: only its own centres are pinned.
            .filter(
                ({ branch }) =>
                    !!branch && (!selectedProvince || branch.province === selectedProvince)
            )
            .map(({ pin, branch }) => {
                const stats = statsByBranch[pin.branchId] || emptyStats();
                const value = measureOf(stats, metric);
                const isSelected = pin.branchId === selectedBranchId;
                const pinColor = rateColor(stats);
                // Town-level pins are hollow: a faint fill with a coloured ring.
                const approximate = !!pin.approximateTown;
                return {
                    name: branch.name,
                    lat: pin.lat,
                    lon: pin.lon,
                    // Bubbles need a size even at zero, so z never drops below 1.
                    z: Math.max(value, 1),
                    __branchId__: pin.branchId,
                    __label__: formatMeasure(value, metric),
                    __rate__: stats.interventions ? `${completionRate(stats)}%` : "no interventions",
                    __where__: approximate
                        ? `Approximate: placed at ${pin.approximateTown} (no exact location captured)`
                        : "Exact centre location",
                    color: approximate
                        ? (Highcharts.color(pinColor).setOpacity(0.2).get() as string)
                        : pinColor,
                    marker: {
                        lineColor: isSelected
                            ? token.colorText
                            : approximate
                                ? pinColor
                                : token.colorBgContainer,
                        lineWidth: isSelected ? 3 : approximate ? 2 : 1,
                    },
                };
            });

        const labelStyle = {
            color: token.colorText,
            textOutline: "none",
            fontWeight: "600",
        };

        return {
            chart: {
                map: provinceMapData as any,
                height: 420,
                backgroundColor: "transparent",
                animation: { duration: 300 },
            },
            title: { text: undefined },
            mapNavigation: { enabled: false },
            navigation: { buttonOptions: { enabled: false } } as any,
            colorAxis: {
                min: 0,
                ...(metric === "completion" ? { max: 100 } : {}),
                minColor: token.colorPrimaryBg,
                maxColor: token.colorPrimary,
                labels: { style: { color: token.colorTextSecondary } },
            },
            legend: {
                enabled: true,
                itemStyle: { color: token.colorTextSecondary },
            },
            tooltip: {
                backgroundColor: token.colorBgElevated,
                style: { color: token.colorText },
            },
            credits: {
                enabled: true,
                text: "Districts: geoBoundaries (CC BY 3.0 IGO) · Towns: © OpenStreetMap contributors",
                href: "https://www.geoboundaries.org",
                style: { color: token.colorTextQuaternary, fontSize: "9px" },
            },
            series: [
                {
                    id: "provinces",
                    type: "map",
                    name: "Provinces",
                    joinBy: ["name", "name"],
                    data: provinceData,
                    allAreas: !selectedProvince,
                    cursor: "pointer",
                    borderColor: token.colorBgContainer,
                    showInLegend: false,
                    dataLabels: {
                        enabled: true,
                        style: labelStyle,
                        formatter: function () {
                            const p = this as any;
                            // Drilled in: the districts carry the labels.
                            if (selectedProvince) return null;
                            return `${p.point.name}<br/>${formatMeasure(p.point.value ?? 0, metric)}`;
                        },
                    },
                    tooltip: {
                        pointFormatter: function () {
                            const p = this as any;
                            return p.value == null
                                ? `<b>${p.name}</b><br/>Click to open`
                                : `<b>${p.name}</b><br/>${formatMeasure(p.value, metric)}`;
                        },
                    },
                    point: {
                        events: {
                            click: function () {
                                const prov = (this as any).name as ProvinceName;
                                selectProvince(prov === selectedProvince ? null : prov);
                            },
                        },
                    },
                } as any,
                {
                    id: "districts",
                    type: "map",
                    name: "Districts",
                    mapData: {
                        type: "FeatureCollection",
                        features: provinceDistricts,
                    },
                    joinBy: ["name", "name"],
                    data: districtData,
                    visible: showDistricts,
                    cursor: "pointer",
                    borderColor: token.colorBgContainer,
                    borderWidth: 1,
                    showInLegend: false,
                    dataLabels: {
                        enabled: true,
                        style: { ...labelStyle, fontWeight: "normal", fontSize: "10px" },
                        formatter: function () {
                            const p = (this as any).point;
                            // Districts without centres get a dimmer label.
                            return p.__centres__
                                ? p.name
                                : `<span style="color:${token.colorTextTertiary};font-weight:normal">${p.name}</span>`;
                        },
                    },
                    tooltip: {
                        pointFormatter: function () {
                            const p = this as any;
                            if (!p.__centres__) return `<b>${p.name}</b><br/>No centres`;
                            return `<b>${p.name}</b><br/>${formatMeasure(p.value ?? 0, metric)}<br/>${p.__centres__} ${p.__centres__ === 1 ? "centre" : "centres"}`;
                        },
                    },
                    point: {
                        events: {
                            click: function () {
                                const name = (this as any).name as string;
                                const centres = statsByDistrict[name]?.centres || [];
                                if (!centres.length) return;
                                // One centre: go straight to it.
                                if (centres.length === 1) {
                                    selectBranch(centres[0]);
                                    return;
                                }
                                selectDistrict(name === selectedDistrict ? null : name);
                            },
                        },
                    },
                } as any,
                {
                    id: "centres",
                    type: "mapbubble",
                    name: "Centres (colour = completion rate, hollow = town-level location)",
                    colorAxis: false,
                    data: pinStats,
                    minSize: 10,
                    maxSize: 34,
                    zMin: 0,
                    cursor: "pointer",
                    dataLabels: {
                        enabled: !!selectedProvince,
                        format: "{point.name} · {point.__label__}",
                        style: { ...labelStyle, fontSize: "11px" },
                        y: -16,
                    },
                    tooltip: {
                        pointFormat:
                            "<b>{point.name}</b><br/>Value: {point.__label__}<br/>Completion: {point.__rate__}<br/><i>{point.__where__}</i>",
                    },
                    point: {
                        events: {
                            click: function () {
                                selectBranch((this as any).__branchId__ as string);
                            },
                        },
                    },
                } as any,
            ],
        };
        // The select* helpers only call state setters with branchInfoById and
        // districtByBranchId, which are already dependencies.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        provinceMapData,
        statsByProvince,
        statsByBranch,
        centreByBranchId,
        branchInfoById,
        districtByBranchId,
        provinceDistricts,
        statsByDistrict,
        showDistricts,
        activeDistrict,
        selectedProvince,
        selectedDistrict,
        selectedBranchId,
        metric,
        token,
    ]);

    // Zoom every mounted map (card and expanded modal) to the selection. The
    // chart is updated in place rather than replaced, so the zoom survives
    // option changes.
    const charts = useRef(new Set<Highcharts.Chart>());

    const selectedPin = selectedBranchId ? centreByBranchId[selectedBranchId] : undefined;

    const zoomToSelection = useCallback(
        (chart: Highcharts.Chart) => {
            const mapView = (chart as any).mapView;
            if (!mapView) return;
            if (!selectedProvince) {
                mapView.zoomBy();
                return;
            }
            const area =
                (activeDistrict && (chart.get(`district-${activeDistrict}`) as any)) ||
                (chart.get(`province-${selectedProvince}`) as any);
            if (!area?.bounds) return;
            // Zoom through the map view, not point.zoomTo(): zoomTo only redraws
            // the clicked point's own series, leaving districts and pins behind
            // at the old zoom.
            if (selectedPin) {
                // A centre: fit its district, then close in on its town.
                mapView.fitToBounds(area.bounds, undefined, false);
                mapView.setView([selectedPin.lon, selectedPin.lat], mapView.zoom + 1, true, true);
            } else {
                mapView.fitToBounds(area.bounds, undefined, true, true);
            }
        },
        // showDistricts: district points only exist once their shapes load.
        [selectedProvince, activeDistrict, selectedPin, showDistricts]
    );

    useEffect(() => {
        charts.current.forEach((chart) => {
            if ((chart as any).renderer) zoomToSelection(chart);
            else charts.current.delete(chart);
        });
    }, [zoomToSelection]);

    const registerChart = useCallback(
        (chart: Highcharts.Chart) => {
            charts.current.add(chart);
            zoomToSelection(chart);
        },
        [zoomToSelection]
    );

    const monthlyChartOptions: Highcharts.Options = useMemo(() => {
        const axisStyle = { color: token.colorTextSecondary };
        const base: Highcharts.Options = {
            chart: { type: "column", height: 260, backgroundColor: "transparent" },
            title: { text: undefined },
            xAxis: { categories: months, labels: { style: axisStyle } },
            legend: { enabled: true, itemStyle: { color: token.colorTextSecondary } },
            tooltip: { shared: true },
            plotOptions: {
                column: {
                    stacking: "normal",
                    dataLabels: {
                        enabled: true,
                        filter: { property: "y", operator: ">", value: 0 },
                        style: { textOutline: "none", fontWeight: "600", fontSize: "10px" },
                    },
                },
            },
            credits: { enabled: false },
        };

        if (metric === "incubatees") {
            const accepted = Array(12).fill(0);
            acceptancesInRange.forEach((row) => {
                if (inCurrentScope(row.branchId)) accepted[row.month]++;
            });

            return {
                ...base,
                yAxis: {
                    title: { text: undefined },
                    allowDecimals: false,
                    min: 0,
                    labels: { style: axisStyle },
                },
                series: [
                    {
                        type: "column",
                        name: "Accepted",
                        data: accepted,
                        color: STATUS_COLORS.accepted,
                    },
                ],
            };
        }

        const byClass: Record<InterventionClass, number[]> = {
            completed: Array(12).fill(0),
            "in-progress": Array(12).fill(0),
            assigned: Array(12).fill(0),
        };
        interventionsInRange.forEach((row) => {
            if (inCurrentScope(row.branchId)) byClass[row.cls][row.month]++;
        });

        return {
            ...base,
            yAxis: {
                title: { text: undefined },
                allowDecimals: false,
                min: 0,
                labels: { style: axisStyle },
                stackLabels: { enabled: true, style: { textOutline: "none", fontWeight: "700" } },
            },
            series: [
                {
                    type: "column",
                    name: "Completed",
                    data: byClass.completed,
                    color: STATUS_COLORS.completed,
                },
                {
                    type: "column",
                    name: "In Progress",
                    data: byClass["in-progress"],
                    color: STATUS_COLORS["in-progress"],
                },
                {
                    type: "column",
                    name: "Assigned",
                    data: byClass.assigned,
                    color: STATUS_COLORS.assigned,
                },
            ],
        };
    }, [metric, interventionsInRange, acceptancesInRange, inCurrentScope, token]);

    const metricLabel =
        metric === "interventions"
            ? "Interventions"
            : metric === "incubatees"
                ? "Accepted incubatees"
                : "Completion rate";

    type RankedItem = {
        key: string;
        label: string;
        value: number;
        display: string;
        onClick?: () => void;
    };

    // Ranked lists for the current level: districts and centres in a province,
    // centres in a district or the country, or a centre's top intervention types.
    const rankedSections = useMemo((): Array<{ title: string; items: RankedItem[] }> => {
        if (selectedBranchId) {
            const counts = new Map<string, number>();
            interventionsInRange.forEach((row) => {
                if (row.branchId !== selectedBranchId) return;
                counts.set(row.title, (counts.get(row.title) || 0) + 1);
            });
            return [
                {
                    title: "Top intervention types",
                    items: Array.from(counts.entries())
                        .map(([title, count]) => ({
                            key: title,
                            label: title,
                            value: count,
                            display: String(count),
                        }))
                        .sort((a, b) => b.value - a.value)
                        .slice(0, 5),
                },
            ];
        }

        const centreItems = branchesInView
            .map((branch) => {
                const value = measureOf(statsByBranch[branch.id] || emptyStats(), metric);
                return {
                    key: branch.id,
                    label: branch.name,
                    value,
                    display: formatMeasure(value, metric),
                    onClick: () => selectBranch(branch.id),
                };
            })
            .sort((a, b) => b.value - a.value);

        const sections: Array<{ title: string; items: RankedItem[] }> = [];
        if (selectedProvince && !selectedDistrict && showDistricts) {
            sections.push({
                title: `Districts by ${metricLabel.toLowerCase()}`,
                items: Object.entries(statsByDistrict)
                    .filter(([, entry]) => entry.centres.length > 0)
                    .map(([name, entry]) => {
                        const value = measureOf(entry.stats, metric);
                        return {
                            key: `district-${name}`,
                            label: `${name} (${entry.centres.length} ${entry.centres.length === 1 ? "centre" : "centres"})`,
                            value,
                            display: formatMeasure(value, metric),
                            onClick: () =>
                                entry.centres.length === 1
                                    ? selectBranch(entry.centres[0])
                                    : selectDistrict(name),
                        };
                    })
                    .sort((a, b) => b.value - a.value),
            });
        }
        sections.push({
            title: selectedDistrict
                ? `Centres in ${selectedDistrict}`
                : `Centres by ${metricLabel.toLowerCase()}`,
            items: centreItems,
        });
        return sections;
        // The select* helpers only call state setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        selectedBranchId,
        selectedProvince,
        selectedDistrict,
        showDistricts,
        interventionsInRange,
        branchesInView,
        statsByBranch,
        statsByDistrict,
        districtByBranchId,
        metric,
        metricLabel,
    ]);

    const breadcrumbItems = [
        {
            title: selectedProvince ? (
                <a onClick={() => selectProvince(null)}>South Africa</a>
            ) : (
                "South Africa"
            ),
        },
        ...(selectedProvince
            ? [
                {
                    title:
                        activeDistrict || selectedBranchId ? (
                            <a onClick={() => selectProvince(selectedProvince)}>{selectedProvince}</a>
                        ) : (
                            selectedProvince
                        ),
                },
            ]
            : []),
        ...(activeDistrict
            ? [
                {
                    title: selectedBranchId ? (
                        <a onClick={() => selectDistrict(activeDistrict)}>{activeDistrict}</a>
                    ) : (
                        activeDistrict
                    ),
                },
            ]
            : []),
        ...(selectedBranchId && branchInfoById[selectedBranchId]
            ? [{ title: branchInfoById[selectedBranchId].name }]
            : []),
    ];

    const hasAnyData = interventionsInRange.length > 0 || acceptancesInRange.length > 0;

    // Where the figures apply, under the first tile.
    const scopeLabel =
        selectedBranchId && branchInfoById[selectedBranchId]
            ? `At ${branchInfoById[selectedBranchId].name}`
            : activeDistrict
                ? `In ${activeDistrict}`
                : selectedProvince
                    ? `In ${selectedProvince}`
                    : "Nationally";

    // Same thresholds as the pin colours.
    const completionTone: MetricTone = !scopeStats.interventions
        ? "neutral"
        : completionRate(scopeStats) >= 70
            ? "success"
            : completionRate(scopeStats) >= 40
                ? "warning"
                : "danger";

    const renderBody = (fullWidth: boolean) => (
        <>
            <Space
                wrap
                style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}
            >
                <Breadcrumb items={breadcrumbItems} />
                <Text type="secondary">
                    {dateFrom.toLocaleDateString()} → {dateTo.toLocaleDateString()}
                </Text>
            </Space>

            <Row gutter={[16, 16]}>
                <Col xs={24} lg={fullWidth ? 15 : 14}>
                    {!hasAnyData && (
                        <Text type="secondary">
                            No geographic data for the selected filters.
                        </Text>
                    )}
                    {provinceMapData ? (
                        <HighchartsReact
                            highcharts={Highcharts}
                            constructorType="mapChart"
                            options={mapOptions}
                            updateArgs={[true, true, true]}
                            callback={registerChart}
                        />
                    ) : (
                        <div>Loading map…</div>
                    )}
                </Col>

                <Col xs={24} lg={fullWidth ? 9 : 10}>
                    {/* Wraps on the panel's own width, not the screen's: the
                        panel is narrow beside the map, and compact tiles clip
                        their text below about 135px. */}
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
                            gap: 8,
                            marginBottom: 16,
                        }}
                    >
                        <div>
                            {metric === "incubatees" ? (
                                <MetricTile
                                    compact
                                    icon={<UserAddOutlined />}
                                    tone="accent"
                                    title="Accepted"
                                    value={scopeStats.incubatees}
                                    subtitle={scopeLabel}
                                    wrapperStyle={{ height: "100%" }}
                                />
                            ) : (
                                <MetricTile
                                    compact
                                    icon={<SolutionOutlined />}
                                    tone="accent"
                                    title="Interventions"
                                    value={scopeStats.interventions}
                                    subtitle={scopeLabel}
                                    wrapperStyle={{ height: "100%" }}
                                />
                            )}
                        </div>
                        <div>
                            <MetricTile
                                compact
                                icon={<CheckCircleOutlined />}
                                tone={completionTone}
                                title="Completed"
                                value={`${completionRate(scopeStats)}%`}
                                subtitle={`${scopeStats.completed} of ${scopeStats.interventions} done`}
                                wrapperStyle={{ height: "100%" }}
                            />
                        </div>
                        <div>
                            <MetricTile
                                compact
                                icon={<TeamOutlined />}
                                tone="info"
                                title="Active SMEs"
                                value={scopeStats.activeSmes}
                                subtitle="With interventions"
                                wrapperStyle={{ height: "100%" }}
                            />
                        </div>
                    </div>

                    <HighchartsReact highcharts={Highcharts} options={monthlyChartOptions} />

                    {rankedSections.map((section) => {
                        const max = Math.max(1, ...section.items.map((item) => item.value));
                        return (
                            <div key={section.title} style={{ marginBottom: 12 }}>
                                <Text strong>{section.title}</Text>
                                <div style={{ marginTop: 8 }}>
                                    {section.items.length === 0 ? (
                                        <Text type="secondary">Nothing in this scope yet.</Text>
                                    ) : (
                                        section.items.map((item) => (
                                            <div
                                                key={item.key}
                                                onClick={item.onClick}
                                                style={{
                                                    cursor: item.onClick ? "pointer" : "default",
                                                    padding: "4px 0",
                                                }}
                                            >
                                                <Space
                                                    style={{ width: "100%", justifyContent: "space-between" }}
                                                >
                                                    <Text ellipsis style={{ maxWidth: 240 }}>
                                                        {item.label}
                                                    </Text>
                                                    <Text strong>{item.display}</Text>
                                                </Space>
                                                <Progress
                                                    percent={Math.round((item.value / max) * 100)}
                                                    showInfo={false}
                                                    size="small"
                                                />
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </Col>
            </Row>

            {unmappedBranches.length > 0 && (
                <div
                    style={{
                        marginTop: 12,
                        paddingTop: 8,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                    }}
                >
                    <Text type="secondary">
                        {unmappedBranches.length}{" "}
                        {unmappedBranches.length === 1 ? "centre" : "centres"} not shown on
                        the map (no location or recognisable town):{" "}
                    </Text>
                    {unmappedBranches.map((branch, index) => (
                        <React.Fragment key={branch.id}>
                            <a onClick={() => selectBranch(branch.id)}>{branch.name}</a>
                            {index < unmappedBranches.length - 1 ? ", " : ""}
                        </React.Fragment>
                    ))}
                    <Text type="secondary">. Their numbers still count in every total.</Text>
                </div>
            )}

            {!selectedProvince && unplacedBranchNames.length > 0 && (
                <div style={{ marginTop: 8 }}>
                    <Text type="secondary">
                        {unplacedBranchNames.length}{" "}
                        {unplacedBranchNames.length === 1 ? "branch is" : "branches are"} not
                        counted because their record has no recognisable province:{" "}
                        {unplacedBranchNames.join(", ")}. Set the province on the branch to
                        include {unplacedBranchNames.length === 1 ? "it" : "them"}.
                    </Text>
                </div>
            )}
        </>
    );

    const showSkeleton = loading && !Object.keys(branchInfoById).length;

    return (
        <div>
            {showSkeleton ? (
                <MotionCard>
                    <Skeleton
                        active
                        title={{ width: 260 }}
                        paragraph={false}
                        style={{ marginBottom: 16 }}
                    />
                    <Row gutter={16}>
                        <Col xs={24} lg={14}>
                            <Skeleton.Node active style={{ width: "100%", height: 420 }} />
                        </Col>
                        <Col xs={24} lg={10}>
                            <Skeleton active paragraph={{ rows: 8 }} />
                        </Col>
                    </Row>
                </MotionCard>
            ) : (
                <>
                    <MotionCard
                        title="Geographic Distribution"
                        extra={
                            <Space size="middle" wrap>
                                <Segmented
                                    options={METRIC_OPTIONS}
                                    value={metric}
                                    onChange={(value) => setMetric(value as Metric)}
                                />
                                <Button onClick={() => setExpanded(true)}>Expand</Button>
                            </Space>
                        }
                    >
                        {renderBody(false)}
                    </MotionCard>

                    <Modal
                        open={expanded}
                        onCancel={() => setExpanded(false)}
                        footer={null}
                        width={1280}
                        title={
                            <Space wrap>
                                <span>Geographic Distribution</span>
                                <Segmented
                                    options={METRIC_OPTIONS}
                                    value={metric}
                                    onChange={(value) => setMetric(value as Metric)}
                                />
                            </Space>
                        }
                        destroyOnClose
                    >
                        {renderBody(true)}
                    </Modal>
                </>
            )}
        </div>
    );
};

export default SAProvincesDrillMap;
