import React, { useEffect, useMemo, useState } from "react";
import {
    Button,
    Card,
    Col,
    DatePicker,
    Drawer,
    Empty,
    InputNumber,
    Modal,
    Progress,
    Row,
    Segmented,
    Select,
    Space,
    Statistic,
    Typography,
} from "antd";
import {
    ApartmentOutlined,
    AuditOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileDoneOutlined,
    FilterOutlined,
    FullscreenOutlined,
    FundProjectionScreenOutlined,
    PieChartOutlined,
    TeamOutlined,
    UserAddOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import quarterOfYear from "dayjs/plugin/quarterOfYear";
import isBetween from "dayjs/plugin/isBetween";
import { Helmet } from "react-helmet";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import HighchartsMore from "highcharts/highcharts-more";
import HighchartsFunnel from "highcharts/modules/funnel";
import {
    collection,
    getDocs,
    onSnapshot,
    query,
    Timestamp,
    where,
} from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import {
    DashboardFilterBar,
    MotionCard,
} from "@/components/dashboards/metrics/Header";
import ReachReportsPanel from "@/components/reports/ReachReportsPanel";
import {
    REPORT_CHART_COLORS,
    REPORT_CHART_PALETTE,
} from "@/components/reports/reportChartTheme";
import InterventionsDeptDrilldownChart from "../monitoring/DepartmentInterventionsDrilldown";
import { filterReportRecords } from "@/utils/reportVisibility";
import { useColorMode } from "@/contexts/ThemeContext";
dayjs.extend(isoWeek);
dayjs.extend(quarterOfYear);
dayjs.extend(isBetween);

if (typeof HighchartsMore === "function") HighchartsMore(Highcharts);
if (typeof HighchartsFunnel === "function") HighchartsFunnel(Highcharts);

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

type PageSegment = "recruitment" | "onboarding" | "maintenance" | "reach";
type TimePeriod = "week" | "month" | "quarter";
type DateRange = [Dayjs, Dayjs];
type StatusKey =
    | "submitted"
    | "accepted"
    | "rejected"
    | "withdrawn"
    | "pending"
    | string;

type ApplicationIntervention = {
    id?: string;
    title?: string;
    area?: string;
    areaOfSupport?: string;
    status?: "required" | "assigned" | "in_progress" | "completed" | string;
};

type BucketItem = {
    id?: string;
    title?: string;
    area?: string;
    areaOfSupport?: string;
};

type InterventionsBuckets = {
    required?: BucketItem[] | Record<string, BucketItem>;
    assigned?: BucketItem[] | Record<string, BucketItem>;
    completed?: BucketItem[] | Record<string, BucketItem>;
    participationRate?: number;
};

type Application = {
    id: string;
    programId?: string;
    programName?: string;
    applicationStatus?: StatusKey;
    status?: StatusKey;
    participantId?: string | null;
    email?: string;
    createdAt?: Timestamp | Date | string | number | null;
    submittedAt?: Timestamp | Date | string | number | null;
    acceptedAt?: Timestamp | Date | string | number | null;
    updatedAt?: Timestamp | Date | string | number | null;
    gapGroup?: "A" | "B" | "C" | string;
    gender?: string;
    ward?: string | string[];
    hub?: string | string[];
    profile?: Record<string, unknown>;
    signedAgreements?: Record<string, unknown>;
    complianceDocuments?: unknown;
    manuallyCreated?: boolean;
    interventions?:
    | ApplicationIntervention[]
    | Record<string, ApplicationIntervention>
    | InterventionsBuckets
    | null;
};

type Participant = {
    id: string;
    email?: string;
    name?: string;
    companyName?: string;
    businessName?: string;
    createdAt?: Timestamp | Date | string | number | null;
    beeLevel?: number | string;
    bbeeeLevel?: number | string;
    beeStatus?: string;
    blackOwnedPercent?: number;
    femaleOwnedPercent?: number;
    youthOwnedPercent?: number;
    gender?: string;
    idNumber?: string;
    sector?: string | string[];
    ward?: string | string[];
    hub?: string | string[];
};

type ManualComplianceFlags = Record<
    string,
    {
        gapSigned: boolean;
        preSigned: boolean;
        moaSigned: boolean;
        uploadedDocs: number;
        verifiedDocs: number;
        queriedDocs: number;
        missingDocs: number;
    }
>;

const requiredDocumentSlugs = [
    { slug: "gap-analysis", label: "GAP Analysis" },
    { slug: "pre-incubation-contract", label: "Pre-Incubation Contract" },
    { slug: "moa", label: "MOA" },
];

const statusLabels: Record<string, string> = {
    submitted: "Submitted",
    accepted: "Accepted",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    pending: "Pending",
};

const normalize = (value?: unknown) =>
    String(value ?? "")
        .trim()
        .toLowerCase();

const labelize = (value?: unknown) => {
    const raw = String(value ?? "Unspecified").trim();
    if (!raw) return "Unspecified";
    return raw
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const toArray = <T,>(
    value: T[] | Record<string, T> | undefined | null
): T[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "object") return Object.values(value).filter(Boolean);
    return [];
};

const toDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof (value as any)?.toDate === "function")
        return (value as any).toDate();
    if (typeof (value as any)?.seconds === "number") {
        return new Date(
            (value as any).seconds * 1000 +
            Math.floor(((value as any).nanoseconds || 0) / 1e6)
        );
    }
    if (typeof (value as any)?._seconds === "number") {
        return new Date(
            (value as any)._seconds * 1000 +
            Math.floor(((value as any)._nanoseconds || 0) / 1e6)
        );
    }
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const getApplicationStatus = (app: Application) =>
    normalize(app.applicationStatus || app.status || "pending");

const getApplicationDate = (app: Application) =>
    toDate(app.createdAt) ||
    toDate(app.submittedAt) ||
    toDate(app.updatedAt) ||
    toDate(app.acceptedAt);

const getAcceptedDate = (app: Application) =>
    toDate(app.acceptedAt) ||
    toDate(app.updatedAt) ||
    toDate(app.createdAt) ||
    toDate(app.submittedAt);

const getRange = (period: TimePeriod): DateRange => {
    const now = dayjs();
    if (period === "week") return [now.startOf("isoWeek"), now.endOf("isoWeek")];
    if (period === "quarter")
        return [now.startOf("quarter"), now.endOf("quarter")];
    return [now.startOf("month"), now.endOf("month")];
};

/**
 * Quick ranges shown inside the RangePicker dropdown.
 *
 * These replace what used to be a separate "Period" Segmented sitting next to
 * the picker. Two controls for one value meant the Segmented had to carry a
 * "Custom" option purely to unlock the picker, and picking a preset then
 * disabled the very control it was setting.
 *
 * Recomputed per call rather than memoised, so a tab left open overnight does
 * not keep resolving "This Week" against the day it was mounted.
 */
const buildRangePresets = (): { label: string; value: DateRange }[] => {
    const now = dayjs();
    const lastMonth = now.subtract(1, "month");
    const lastQuarter = now.subtract(1, "quarter");

    return [
        { label: "This Week", value: getRange("week") },
        { label: "This Month", value: getRange("month") },
        { label: "This Quarter", value: getRange("quarter") },
        {
            label: "Last Month",
            value: [lastMonth.startOf("month"), lastMonth.endOf("month")],
        },
        {
            label: "Last Quarter",
            value: [lastQuarter.startOf("quarter"), lastQuarter.endOf("quarter")],
        },
        { label: "Year to Date", value: [now.startOf("year"), now.endOf("day")] },
    ];
};

const getAgeFromID = (idNumber?: string): number | null => {
    const value = String(idNumber || "").trim();
    if (!/^\d{6}/.test(value)) return null;

    const yy = Number(value.slice(0, 2));
    const mm = Number(value.slice(2, 4)) - 1;
    const dd = Number(value.slice(4, 6));
    const currentYear = new Date().getFullYear();
    const century = yy <= currentYear % 100 ? 2000 : 1900;
    const birthDate = new Date(century + yy, mm, dd);

    if (Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
    )
        age -= 1;
    return age;
};

const coerceBeeLevel = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const matched = value.match(/\d+/);
        return matched ? Number(matched[0]) : null;
    }
    return null;
};

const countBy = <T,>(rows: T[], getter: (row: T) => unknown) => {
    const counts: Record<string, number> = {};
    rows.forEach((row) => {
        const key = labelize(getter(row));
        counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([name, y]) => ({ name, y }));
};

const hasSeriesData = (
    ...series: Array<
        number[] | [string, number][] | { y?: number }[] | undefined | null
    >
) => {
    return series.some((item) => {
        if (!item?.length) return false;
        return (item as any[]).some((value) => {
            if (Array.isArray(value)) return Number(value[1]) > 0;
            if (typeof value === "object" && value) return Number(value.y || 0) > 0;
            return Number(value) > 0;
        });
    });
};

const flattenInterventions = (source: Application["interventions"]) => {
    const bucket = source as InterventionsBuckets | null | undefined;
    const required = toArray<BucketItem>(bucket?.required).map((item) => ({
        ...item,
        status: "required",
    }));
    const assigned = toArray<BucketItem>(bucket?.assigned).map((item) => ({
        ...item,
        status: "assigned",
    }));
    const completed = toArray<BucketItem>(bucket?.completed).map((item) => ({
        ...item,
        status: "completed",
    }));

    if (required.length || assigned.length || completed.length)
        return [...required, ...assigned, ...completed];

    return toArray<ApplicationIntervention>(source as any).map((item) => ({
        ...item,
        status: item.status || "required",
    }));
};

const getParticipantWard = (app: Application, participant?: Participant) => {
    const profileValues =
        app.profile && typeof app.profile === "object"
            ? Object.values(app.profile)
            : [];
    const profileWard = profileValues.find(Boolean);
    const appWard = Array.isArray(app.ward) ? app.ward[0] : app.ward;
    const appHub = Array.isArray(app.hub) ? app.hub[0] : app.hub;
    const participantWard = Array.isArray(participant?.ward)
        ? participant?.ward[0]
        : participant?.ward;
    const participantHub = Array.isArray(participant?.hub)
        ? participant?.hub[0]
        : participant?.hub;

    return (
        profileWard ||
        appWard ||
        appHub ||
        participantWard ||
        participantHub ||
        "Unspecified"
    );
};

const getParticipantSector = (participant?: Participant) => {
    const sector = Array.isArray(participant?.sector)
        ? participant?.sector[0]
        : participant?.sector;
    return sector || "Unspecified";
};

const getSignedAgreement = (
    app: Application,
    slug: string,
    manualComplianceMap: ManualComplianceFlags
) => {
    const isManual = app.manuallyCreated;

    if (isManual) {
        const flags = manualComplianceMap[app.id];
        if (slug === "gap-analysis") return !!flags?.gapSigned;
        if (slug === "pre-incubation-contract") return !!flags?.preSigned;
        if (slug === "moa") return !!flags?.moaSigned;
        return false;
    }

    const agreements = app.signedAgreements || {};
    const keys = Object.keys(agreements).map((key) => key.toLowerCase());

    if (slug === "moa")
        return keys.some((key) => key === "moa" || key.includes("memorandum"));
    return keys.some((key) => key === slug || key.includes(slug));
};

const MetricCard: React.FC<{
    title: string;
    value: React.ReactNode;
    subtitle?: React.ReactNode;
    icon: React.ReactNode;
    iconBg?: string;
}> = ({ title, value, subtitle, icon, iconBg }) => (
    <MotionCard.Metric
        title={title}
        value={value}
        subtitle={subtitle}
        icon={icon}
        iconBg={iconBg || "rgba(22,119,255,.12)"}
    />
);

const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({
    title,
    children,
}) => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Card
                title={title}
                extra={
                    <Button
                        type="link"
                        icon={<FullscreenOutlined />}
                        onClick={() => setOpen(true)}
                    >
                        Expand
                    </Button>
                }
                style={{
                    borderRadius: 14,
                    border: "1px solid #dbeafe",
                    boxShadow: "0 12px 32px rgba(15,23,42,0.08)",
                    height: "100%",
                }}
                bodyStyle={{ minHeight: 340 }}
            >
                {children}
            </Card>
            <Modal
                open={open}
                onCancel={() => setOpen(false)}
                footer={null}
                width="86%"
                style={{ top: 32 }}
            >
                <Title level={4}>{title}</Title>
                {children}
            </Modal>
        </>
    );
};

const DataOrEmpty: React.FC<{
    hasData: boolean;
    children: React.ReactNode;
}> = ({ hasData, children }) => {
    if (!hasData) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    return <>{children}</>;
};

const ROMSegmentedReportsPage: React.FC = () => {
    const { user } = useFullIdentity();
    const { activeProgramId, isAllPrograms } = useActiveProgramId();

    const { isDark } = useColorMode();

    const [segment, setSegment] = useState<PageSegment>("recruitment");
    /**
     * The single source of truth for the reporting window. Presets in the
     * RangePicker dropdown write here just like a hand-picked range does, so
     * there is no longer a separate period mode to keep in sync.
     */
    const [dateRange, setDateRange] = useState<DateRange>(() =>
        getRange("month")
    );
    const [advancedOpen, setAdvancedOpen] = useState(false);

    const [advancedBeeLevels, setAdvancedBeeLevels] = useState<number[]>([]);
    const [blackOwnedRange, setBlackOwnedRange] = useState<
        [number | undefined, number | undefined]
    >([undefined, undefined]);
    const [femaleOwnedRange, setFemaleOwnedRange] = useState<
        [number | undefined, number | undefined]
    >([undefined, undefined]);
    const [youthOwnedRange, setYouthOwnedRange] = useState<
        [number | undefined, number | undefined]
    >([undefined, undefined]);

    const [applications, setApplications] = useState<Application[]>([]);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [manualComplianceMap, setManualComplianceMap] =
        useState<ManualComplianceFlags>({});

    const [dateFrom, dateTo] = dateRange;
    const rangeValue = dateRange;

    useEffect(() => {
        const constraints = [];
        if (!isAllPrograms && activeProgramId)
            constraints.push(where("programId", "==", activeProgramId));

        const appsQuery = query(collection(db, "applications"), ...constraints);
        const unsubscribe = onSnapshot(appsQuery, (snapshot) => {
            setApplications(
                filterReportRecords(snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...(docSnap.data() as any),
                })), user?.email)
            );
        });

        return () => unsubscribe();
    }, [activeProgramId, isAllPrograms]);

    const timeFilteredApplications = useMemo(() => {
        return applications.filter((app) => {
            const createdDate = getApplicationDate(app);
            if (!createdDate) return true;
            return dayjs(createdDate).isBetween(dateFrom, dateTo, "day", "[]");
        });
    }, [applications, dateFrom, dateTo]);

    const acceptedApplications = useMemo(
        () =>
            timeFilteredApplications.filter(
                (app) => getApplicationStatus(app) === "accepted"
            ),
        [timeFilteredApplications]
    );

    useEffect(() => {
        const emails = Array.from(
            new Set(
                timeFilteredApplications
                    .map((app) => normalize(app.email))
                    .filter(Boolean)
            )
        );

        if (!emails.length) {
            setParticipants([]);
            return;
        }

        const batches: string[][] = [];
        for (let i = 0; i < emails.length; i += 10)
            batches.push(emails.slice(i, i + 10));

        const participantMap = new Map<string, Participant>();
        const unsubs = batches.map((batch) => {
            const participantsQuery = query(
                collection(db, "participants"),
                where("email", "in", batch)
            );
            return onSnapshot(participantsQuery, (snapshot) => {
                snapshot.docs.forEach((docSnap) => {
                    const data = docSnap.data() as any;
                    const email = normalize(data.email);
                    if (email && filterReportRecords([{ id: docSnap.id, ...data }], user?.email).length) participantMap.set(email, { id: docSnap.id, ...data });
                });
                setParticipants(Array.from(participantMap.values()));
            });
        });

        return () => unsubs.forEach((unsub) => unsub());
    }, [timeFilteredApplications, user?.email]);

    const participantByEmail = useMemo(() => {
        const map = new Map<string, Participant>();
        participants.forEach((participant) => {
            const email = normalize(participant.email);
            if (email) map.set(email, participant);
        });
        return map;
    }, [participants]);

    const participantById = useMemo(() => {
        const map = new Map<string, Participant>();
        participants.forEach((participant) => map.set(participant.id, participant));
        return map;
    }, [participants]);

    useEffect(() => {
        let cancelled = false;

        const manualAccepted = acceptedApplications.filter(
            (app) => app.manuallyCreated
        );
        if (!manualAccepted.length) {
            setManualComplianceMap({});
            return;
        }

        const loadManualCompliance = async () => {
            const result: ManualComplianceFlags = {};

            for (const app of manualAccepted) {
                try {
                    const snapshot = await getDocs(
                        collection(db, "applications", app.id, "complianceDocuments")
                    );
                    let gapSigned = false;
                    let preSigned = false;
                    let moaSigned = false;
                    let uploadedDocs = 0;
                    let verifiedDocs = 0;
                    let queriedDocs = 0;

                    snapshot.forEach((docSnap) => {
                        const data = docSnap.data() as any;
                        uploadedDocs += 1;

                        const slug = normalize(
                            data.slug || data.docType || data.type || data.title || docSnap.id
                        );
                        const status = normalize(
                            data.status || data.verificationStatus || data.reviewStatus
                        );

                        if (
                            ["valid", "approved", "verified", "active", "signed"].includes(
                                status
                            )
                        )
                            verifiedDocs += 1;
                        if (["queried", "query", "rejected"].includes(status))
                            queriedDocs += 1;

                        const acceptedStatus =
                            !status ||
                            [
                                "valid",
                                "approved",
                                "verified",
                                "active",
                                "pending",
                                "signed",
                            ].includes(status);
                        if (!acceptedStatus) return;

                        if (slug.includes("gap") && slug.includes("analysis"))
                            gapSigned = true;
                        if (slug.includes("pre") && slug.includes("incubation"))
                            preSigned = true;
                        if (slug === "moa" || slug.includes("memorandum")) moaSigned = true;
                    });

                    result[app.id] = {
                        gapSigned,
                        preSigned,
                        moaSigned,
                        uploadedDocs,
                        verifiedDocs,
                        queriedDocs,
                        missingDocs: requiredDocumentSlugs.filter((doc) => {
                            if (doc.slug === "gap-analysis") return !gapSigned;
                            if (doc.slug === "pre-incubation-contract") return !preSigned;
                            if (doc.slug === "moa") return !moaSigned;
                            return false;
                        }).length,
                    };
                } catch (error) {
                    console.error(
                        "Failed to load manual compliance documents",
                        app.id,
                        error
                    );
                }
            }

            if (!cancelled) setManualComplianceMap(result);
        };

        loadManualCompliance();

        return () => {
            cancelled = true;
        };
    }, [acceptedApplications]);

    const participantsForAcceptedApps = useMemo(() => {
        const rows: Participant[] = [];
        acceptedApplications.forEach((app) => {
            const participant =
                (app.participantId
                    ? participantById.get(app.participantId)
                    : undefined) || participantByEmail.get(normalize(app.email));
            if (participant) rows.push(participant);
        });
        return rows;
    }, [acceptedApplications, participantByEmail, participantById]);

    const advancedFiltersActive = useMemo(() => {
        const [blackMin, blackMax] = blackOwnedRange;
        const [femaleMin, femaleMax] = femaleOwnedRange;
        const [youthMin, youthMax] = youthOwnedRange;

        return (
            advancedBeeLevels.length > 0 ||
            blackMin != null ||
            blackMax != null ||
            femaleMin != null ||
            femaleMax != null ||
            youthMin != null ||
            youthMax != null
        );
    }, [advancedBeeLevels, blackOwnedRange, femaleOwnedRange, youthOwnedRange]);

    const acceptedApplicationsFiltered = useMemo(() => {
        if (!advancedFiltersActive) return acceptedApplications;

        const inRange = (value: unknown, min?: number, max?: number) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return false;
            if (typeof min === "number" && parsed < min) return false;
            if (typeof max === "number" && parsed > max) return false;
            return true;
        };

        return acceptedApplications.filter((app) => {
            const participant =
                (app.participantId
                    ? participantById.get(app.participantId)
                    : undefined) || participantByEmail.get(normalize(app.email));

            if (!participant) return false;

            const beeLevel = coerceBeeLevel(
                participant.beeLevel || participant.bbeeeLevel
            );
            if (
                advancedBeeLevels.length &&
                (beeLevel == null || !advancedBeeLevels.includes(beeLevel))
            )
                return false;
            if (
                (blackOwnedRange[0] != null || blackOwnedRange[1] != null) &&
                !inRange(
                    participant.blackOwnedPercent,
                    blackOwnedRange[0],
                    blackOwnedRange[1]
                )
            )
                return false;
            if (
                (femaleOwnedRange[0] != null || femaleOwnedRange[1] != null) &&
                !inRange(
                    participant.femaleOwnedPercent,
                    femaleOwnedRange[0],
                    femaleOwnedRange[1]
                )
            )
                return false;
            if (
                (youthOwnedRange[0] != null || youthOwnedRange[1] != null) &&
                !inRange(
                    participant.youthOwnedPercent,
                    youthOwnedRange[0],
                    youthOwnedRange[1]
                )
            )
                return false;

            return true;
        });
    }, [
        acceptedApplications,
        advancedFiltersActive,
        advancedBeeLevels,
        blackOwnedRange,
        femaleOwnedRange,
        youthOwnedRange,
        participantByEmail,
        participantById,
    ]);

    const acceptedParticipantsFiltered = useMemo(() => {
        const rows: Participant[] = [];
        acceptedApplicationsFiltered.forEach((app) => {
            const participant =
                (app.participantId
                    ? participantById.get(app.participantId)
                    : undefined) || participantByEmail.get(normalize(app.email));
            if (participant) rows.push(participant);
        });
        return rows;
    }, [acceptedApplicationsFiltered, participantByEmail, participantById]);

    const monthlyApplicationSeries = useMemo(() => {
        const monthKeys: string[] = [];
        let cursor = dateFrom.startOf("month");
        const last = dateTo.endOf("month");

        while (cursor.isBefore(last) || cursor.isSame(last, "month")) {
            monthKeys.push(cursor.format("YYYY-MM"));
            cursor = cursor.add(1, "month");
        }

        const counts: Record<string, number> = {};
        timeFilteredApplications.forEach((app) => {
            const date = getApplicationDate(app);
            if (!date) return;
            const key = dayjs(date).format("YYYY-MM");
            counts[key] = (counts[key] || 0) + 1;
        });

        return {
            categories: monthKeys.map((key) => dayjs(`${key}-01`).format("MMM YYYY")),
            data: monthKeys.map((key) => counts[key] || 0),
        };
    }, [dateFrom, dateTo, timeFilteredApplications]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        timeFilteredApplications.forEach((app) => {
            const status = getApplicationStatus(app);
            counts[statusLabels[status] || labelize(status)] =
                (counts[statusLabels[status] || labelize(status)] || 0) + 1;
        });
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }, [timeFilteredApplications]);

    const recruitmentParticipants = useMemo(() => {
        return timeFilteredApplications
            .map(
                (app) =>
                    (app.participantId
                        ? participantById.get(app.participantId)
                        : undefined) || participantByEmail.get(normalize(app.email))
            )
            .filter(Boolean) as Participant[];
    }, [timeFilteredApplications, participantByEmail, participantById]);

    const genderCounts = useMemo(
        () =>
            countBy(
                recruitmentParticipants,
                (participant) => participant.gender || "Unspecified"
            ),
        [recruitmentParticipants]
    );

    const beeCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        recruitmentParticipants.forEach((participant) => {
            const level = coerceBeeLevel(
                participant.beeLevel || participant.bbeeeLevel
            );
            const key = level
                ? `Level ${level}`
                : labelize(participant.beeStatus || "Unspecified");
            counts[key] = (counts[key] || 0) + 1;
        });
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }, [recruitmentParticipants]);

    const wardCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        timeFilteredApplications.forEach((app) => {
            const participant =
                (app.participantId
                    ? participantById.get(app.participantId)
                    : undefined) || participantByEmail.get(normalize(app.email));
            const key = labelize(getParticipantWard(app, participant));
            counts[key] = (counts[key] || 0) + 1;
        });
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }, [timeFilteredApplications, participantByEmail, participantById]);

    const sectorCounts = useMemo(
        () =>
            countBy(recruitmentParticipants, (participant) =>
                getParticipantSector(participant)
            ),
        [recruitmentParticipants]
    );

    const ageBuckets = [
        { label: "15-24", min: 15, max: 24 },
        { label: "25-34", min: 25, max: 34 },
        { label: "35-44", min: 35, max: 44 },
        { label: "45-54", min: 45, max: 54 },
        { label: "55-64", min: 55, max: 64 },
        { label: "65+", min: 65, max: 200 },
    ];

    const ageDistribution = useMemo(() => {
        const count = (gender: string, bucket: (typeof ageBuckets)[number]) =>
            recruitmentParticipants.filter((participant) => {
                const age = getAgeFromID(participant.idNumber);
                return (
                    age != null &&
                    age >= bucket.min &&
                    age <= bucket.max &&
                    normalize(participant.gender) === gender
                );
            }).length;
        return {
            male: ageBuckets.map((bucket) => count("male", bucket)),
            female: ageBuckets.map((bucket) => count("female", bucket)),
        };
    }, [recruitmentParticipants]);

    const documentStats = useMemo(() => {
        const rows = requiredDocumentSlugs.map((doc) => {
            const signed = acceptedApplicationsFiltered.filter((app) =>
                getSignedAgreement(app, doc.slug, manualComplianceMap)
            ).length;
            const missing = Math.max(0, acceptedApplicationsFiltered.length - signed);
            return { ...doc, signed, missing };
        });

        const totalRequired =
            acceptedApplicationsFiltered.length * requiredDocumentSlugs.length;
        const totalSigned = rows.reduce((sum, row) => sum + row.signed, 0);
        const totalMissing = rows.reduce((sum, row) => sum + row.missing, 0);
        const completionRate = totalRequired
            ? Math.round((totalSigned / totalRequired) * 1000) / 10
            : 0;

        return { rows, totalRequired, totalSigned, totalMissing, completionRate };
    }, [acceptedApplicationsFiltered, manualComplianceMap]);

    const complianceGroupCounts = useMemo(() => {
        const counts: Record<string, number> = {
            "Group A": 0,
            "Group B": 0,
            "Group C": 0,
            Unspecified: 0,
        };
        acceptedApplicationsFiltered.forEach((app) => {
            const group = normalize(app.gapGroup).toUpperCase();
            if (group === "A") counts["Group A"] += 1;
            else if (group === "B") counts["Group B"] += 1;
            else if (group === "C") counts["Group C"] += 1;
            else counts.Unspecified += 1;
        });
        return Object.entries(counts)
            .map(([name, y]) => ({ name, y }))
            .filter((item) => item.y > 0);
    }, [acceptedApplicationsFiltered]);

    const onboardingByMonth = useMemo(() => {
        const monthKeys: string[] = [];
        let cursor = dateFrom.startOf("month");
        const last = dateTo.endOf("month");

        while (cursor.isBefore(last) || cursor.isSame(last, "month")) {
            monthKeys.push(cursor.format("YYYY-MM"));
            cursor = cursor.add(1, "month");
        }

        const onboarded: Record<string, number> = {};
        const signed: Record<string, number> = {};
        const missing: Record<string, number> = {};

        acceptedApplicationsFiltered.forEach((app) => {
            const date = getAcceptedDate(app);
            if (!date) return;
            const key = dayjs(date).format("YYYY-MM");
            onboarded[key] = (onboarded[key] || 0) + 1;

            const appSigned = requiredDocumentSlugs.filter((doc) =>
                getSignedAgreement(app, doc.slug, manualComplianceMap)
            ).length;
            signed[key] = (signed[key] || 0) + appSigned;
            missing[key] =
                (missing[key] || 0) +
                Math.max(0, requiredDocumentSlugs.length - appSigned);
        });

        return {
            categories: monthKeys.map((key) => dayjs(`${key}-01`).format("MMM YYYY")),
            onboarded: monthKeys.map((key) => onboarded[key] || 0),
            signed: monthKeys.map((key) => signed[key] || 0),
            missing: monthKeys.map((key) => missing[key] || 0),
        };
    }, [acceptedApplicationsFiltered, dateFrom, dateTo, manualComplianceMap]);

    const gapAnalysis = useMemo(() => {
        const byArea: Record<
            string,
            { required: number; assigned: number; completed: number }
        > = {};

        acceptedApplicationsFiltered.forEach((app) => {
            flattenInterventions(app.interventions).forEach((item) => {
                const area = labelize(item.area || item.areaOfSupport || "Unspecified");
                if (!byArea[area])
                    byArea[area] = { required: 0, assigned: 0, completed: 0 };

                const status = normalize(item.status);
                if (status === "completed") byArea[area].completed += 1;
                else if (
                    status === "assigned" ||
                    status === "in_progress" ||
                    status === "in-progress"
                )
                    byArea[area].assigned += 1;
                else byArea[area].required += 1;
            });
        });

        const areas = Object.keys(byArea).filter((area) => {
            const row = byArea[area];
            return row.required > 0 || row.assigned > 0 || row.completed > 0;
        });

        return {
            areas,
            required: areas.map((area) => byArea[area].required),
            assigned: areas.map((area) => byArea[area].assigned),
            completed: areas.map((area) => byArea[area].completed),
        };
    }, [acceptedApplicationsFiltered]);

    const funnelSeries = useMemo(() => {
        const submitted = timeFilteredApplications.length;
        const accepted = acceptedApplicationsFiltered.length;
        let assigned = 0;
        let completed = 0;

        acceptedApplicationsFiltered.forEach((app) => {
            flattenInterventions(app.interventions).forEach((item) => {
                const status = normalize(item.status);
                if (status === "completed") completed += 1;
                if (
                    status === "assigned" ||
                    status === "in_progress" ||
                    status === "in-progress" ||
                    status === "completed"
                )
                    assigned += 1;
            });
        });

        return [
            ["Applications", submitted],
            ["Accepted", accepted],
            ["Interventions Assigned", assigned],
            ["Interventions Completed", completed],
        ].filter(([, value]) => Number(value) > 0) as [string, number][];
    }, [acceptedApplicationsFiltered, timeFilteredApplications]);

    const reachInterventions = useMemo(
        () =>
            acceptedApplicationsFiltered.flatMap((app) =>
                flattenInterventions(app.interventions).map((item) => ({
                    participantId: app.participantId,
                    areaOfSupport: item.areaOfSupport || item.area,
                    interventionTitle: item.title,
                    createdAt: app.createdAt,
                    updatedAt: app.updatedAt,
                    acceptedAt: app.acceptedAt,
                }))
            ),
        [acceptedApplicationsFiltered]
    );

    const getApplicationStatusColor = (name: string) => {
        const key = name.toLowerCase();

        if (key.includes("accepted")) return "#16a34a";
        if (key.includes("rejected") || key.includes("declined")) return "#dc2626";
        if (key.includes("pending") || key.includes("submitted")) return "#f59e0b";
        if (key.includes("withdrawn")) return "#64748b";

        return undefined;
    };

    const applicationStatusOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "pie", height: 320 },
            title: { text: "" },
            credits: { enabled: false },
            tooltip: {
                pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)",
            },
            plotOptions: {
                pie: {
                    innerSize: "55%",
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        format: "{point.name}: {point.y}",
                    },
                },
            },
            series: [
                {
                    type: "pie",
                    name: "Applications",
                    data: statusCounts.map((item) => ({
                        ...item,
                        color: getApplicationStatusColor(item.name),
                    })),
                },
            ],
        }),
        [statusCounts]
    );

    const monthlyApplicationsOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "column", height: 320 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: {
                categories: monthlyApplicationSeries.categories,
            },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: { text: "Applicants" },
            },
            tooltip: {
                shared: true,
                valueSuffix: " applicants",
            },
            plotOptions: {
                column: { borderRadius: 4, dataLabels: { enabled: true } },
            },
            series: [
                {
                    type: "column",
                    name: "Applicants",
                    color: REPORT_CHART_COLORS.primary,
                    data: monthlyApplicationSeries.data,
                },
            ],
        }),
        [monthlyApplicationSeries]
    );

    const simplePieOptions = (
        data: { name: string; y: number }[],
        label: string
    ): Highcharts.Options => ({
        chart: { type: "pie", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        tooltip: {
            pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)",
        },
        plotOptions: {
            pie: {
                innerSize: "60%",
                showInLegend: true,
                colorByPoint: true,
                dataLabels: {
                    enabled: true,
                    format: "{point.name}: {point.y}",
                },
            },
        },
        series: [
            {
                type: "pie",
                name: label,
                data: data.map((item, index) => ({
                    ...item,
                    color: REPORT_CHART_PALETTE[index % REPORT_CHART_PALETTE.length],
                })),
            },
        ],
    });

    const ageOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "bar", height: 320 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: [
                {
                    categories: ageBuckets.map((bucket) => bucket.label),
                    reversed: false,
                },
                {
                    categories: ageBuckets.map((bucket) => bucket.label),
                    reversed: false,
                    opposite: true,
                    linkedTo: 0,
                },
            ],
            yAxis: {
                title: { text: null },
                labels: {
                    formatter: function () {
                        return Math.abs(Number(this.value)).toString();
                    },
                },
            },
            plotOptions: { series: { stacking: "normal" } },
            series: [
                {
                    type: "bar",
                    name: "Male",
                    color: REPORT_CHART_COLORS.primary,
                    data: ageDistribution.male.map((value) => -value),
                },
                {
                    type: "bar",
                    name: "Female",
                    color: REPORT_CHART_COLORS.success,
                    data: ageDistribution.female,
                },
            ],
        }),
        [ageDistribution]
    );

    const documentCompletionOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "column", height: 320 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: { categories: documentStats.rows.map((row) => row.label) },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: { text: "Accepted applicants" },
            },
            tooltip: { shared: true },
            plotOptions: {
                column: { borderRadius: 5, dataLabels: { enabled: true } },
            },
            series: [
                {
                    type: "column",
                    name: "Signed",
                    data: documentStats.rows.map((row) => row.signed),
                },
                {
                    type: "column",
                    name: "Missing",
                    data: documentStats.rows.map((row) => row.missing),
                },
            ],
        }),
        [documentStats]
    );

    const onboardingTrendOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "column", height: 320 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: { categories: onboardingByMonth.categories },
            yAxis: { min: 0, allowDecimals: false, title: { text: "Count" } },
            tooltip: { shared: true },
            plotOptions: {
                column: { borderRadius: 5, dataLabels: { enabled: true } },
            },
            series: [
                {
                    type: "column",
                    name: "Accepted / Onboarded",
                    data: onboardingByMonth.onboarded,
                },
                {
                    type: "column",
                    name: "Documents Signed",
                    data: onboardingByMonth.signed,
                },
                {
                    type: "column",
                    name: "Documents Missing",
                    data: onboardingByMonth.missing,
                },
            ],
        }),
        [onboardingByMonth]
    );

    const complianceOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "pie", height: 320 },
            title: { text: "" },
            credits: { enabled: false },
            tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
            plotOptions: {
                pie: {
                    innerSize: "55%",
                    showInLegend: true,
                    dataLabels: { enabled: true, format: "{point.name}: {point.y}" },
                },
            },
            series: [
                {
                    type: "pie",
                    name: "Accepted applicants",
                    data: complianceGroupCounts,
                },
            ],
        }),
        [complianceGroupCounts]
    );

    const gapOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "column", height: 340 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: { categories: gapAnalysis.areas, title: { text: "Department" } },
            yAxis: { min: 0, allowDecimals: false, title: { text: "Interventions" } },
            tooltip: { shared: true },
            plotOptions: {
                column: { borderRadius: 5, dataLabels: { enabled: true } },
            },
            series: [
                { type: "column", name: "Required / Gap", data: gapAnalysis.required },
                {
                    type: "column",
                    name: "Assigned / In Progress",
                    data: gapAnalysis.assigned,
                },
                { type: "column", name: "Completed", data: gapAnalysis.completed },
            ],
        }),
        [gapAnalysis]
    );

    const pipelineColors = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed"];

    const funnelOptions: Highcharts.Options = useMemo(() => {
        const categories = funnelSeries.map(([name]) => name);
        const values = funnelSeries.map(([, value]) => Number(value));

        return {
            chart: {
                type: "column",
                height: 360,
                spacingTop: 20,
            },
            title: { text: "" },
            credits: { enabled: false },
            legend: { enabled: false },
            xAxis: {
                categories,
                lineColor: "#e5e7eb",
                tickColor: "#e5e7eb",
                labels: {
                    style: {
                        fontSize: "12px",
                        fontWeight: "600",
                    },
                },
            },
            yAxis: {
                min: 0,
                allowDecimals: false,
                title: { text: "Count" },
                gridLineColor: "#eef2f7",
            },
            tooltip: {
                useHTML: true,
                formatter: function () {
                    const pointIndex = this.point.index;
                    const current = values[pointIndex];
                    const previous = pointIndex > 0 ? values[pointIndex - 1] : null;
                    const rate =
                        previous && previous > 0
                            ? Math.round((current / previous) * 1000) / 10
                            : null;

                    return `
                    <b>${this.key}</b><br/>
                    Count: <b>${current}</b>
                    ${rate !== null
                            ? `<br/>Conversion from previous: <b>${rate}%</b>`
                            : ""
                        }
                `;
                },
            },
            plotOptions: {
                column: {
                    borderRadius: 8,
                    pointPadding: 0.12,
                    groupPadding: 0.08,
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: "allow",
                        format: "{y}",
                        style: {
                            fontWeight: "700",
                            textOutline: "none",
                        },
                    },
                },
                series: {
                    animation: true,
                },
            },
            series: [
                {
                    type: "column",
                    name: "Pipeline",
                    data: funnelSeries.map(([name, value], index) => ({
                        name,
                        y: Number(value),
                        color: pipelineColors[index % pipelineColors.length],
                    })),
                },
            ],
            annotations: [
                {
                    draggable: "",
                    labels: categories.slice(0, -1).map((_, index) => {
                        const from = values[index];
                        const to = values[index + 1];
                        const conversion =
                            from > 0 ? Math.round((to / from) * 1000) / 10 : 0;

                        return {
                            point: {
                                x: index + 0.5,
                                y: Math.max(from, to),
                                xAxis: 0,
                                yAxis: 0,
                            },
                            text: `→ ${conversion}%`,
                            backgroundColor: "rgba(255,255,255,0.92)",
                            borderColor: "#cbd5e1",
                            borderRadius: 10,
                            padding: 6,
                            style: {
                                fontSize: "12px",
                                fontWeight: "700",
                                color: "#334155",
                            },
                        };
                    }),
                } as any,
            ],
        };
    }, [funnelSeries]);

    const filterBar = (
        <div className="rom-filterbar">
            <div className="rom-filterbar-main">
                <div className="rom-filter-control rom-filter-control-wide">
                    <Text type="secondary">Report Area</Text>
                    <Segmented
                        block
                        value={segment}
                        onChange={(value) => setSegment(value as PageSegment)}
                        options={[
                            {
                                label: "Recruitment",
                                value: "recruitment",
                                icon: <UserAddOutlined />,
                            },
                            {
                                label: "Onboarding",
                                value: "onboarding",
                                icon: <FileDoneOutlined />,
                            },
                            {
                                label: "Maintenance",
                                value: "maintenance",
                                icon: <FundProjectionScreenOutlined />,
                            },
                            { label: "Reach", value: "reach", icon: <TeamOutlined /> },
                        ]}
                    />
                </div>

                <div className="rom-filter-control rom-filter-date">
                    <Text type="secondary">Date Range</Text>
                    <RangePicker
                        value={rangeValue}
                        allowClear={false}
                        presets={buildRangePresets()}
                        format="DD MMM YYYY"
                        onChange={(value) => {
                            if (!value?.[0] || !value?.[1]) return;
                            setDateRange([value[0], value[1]]);
                        }}
                        style={{ width: "100%" }}
                    />
                </div>

                <div className="rom-filter-actions">
                    <Button
                        icon={<FilterOutlined />}
                        onClick={() => setAdvancedOpen(true)}
                    >
                        Advanced Filters
                    </Button>
                </div>
            </div>

            <style>{`
                .rom-filterbar { width: 100%; }
                /* Wrap rather than nowrap. With nowrap and non-shrinkable
                   children, the Report Area segmented (four labelled options
                   with icons) plus the date range plus the actions button
                   overflowed the card at any width below roughly 1500px, and
                   the tail of the row was simply clipped off. */
                .rom-filterbar-main {
                    display: flex;
                    align-items: flex-end;
                    gap: 12px;
                    width: 100%;
                    flex-wrap: wrap;
                }
                .rom-filter-control {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    /* min-width:0 lets a flex item shrink below its content
                       width; without it the segmented sets an unbreakable
                       floor and forces the overflow back. */
                    min-width: 0;
                }
                .rom-filter-control-wide { flex: 1 1 auto; }
                /* Last resort: if the viewport is narrower than the segmented
                   itself, it scrolls inside its own box instead of widening
                   the row. */
                .rom-filter-control-wide .ant-segmented {
                    max-width: 100%;
                    overflow-x: auto;
                }
                .rom-filter-date {
                    flex: 1 1 300px;
                    min-width: 260px;
                }
                .rom-filter-actions {
                    display: flex;
                    justify-content: flex-end;
                    align-items: flex-end;
                    margin-left: auto;
                    white-space: nowrap;
                }
                @media (max-width: 1200px) {
                    .rom-filterbar-main { flex-wrap: wrap; }
                    .rom-filter-control,
                    .rom-filter-date,
                    .rom-filter-actions {
                        flex: 1 1 calc(50% - 12px);
                        min-width: 260px;
                    }
                    .rom-filter-actions { justify-content: flex-start; margin-left: 0; }
                }
                @media (max-width: 576px) {
                    .rom-filterbar-main {
                        flex-direction: column;
                        align-items: stretch;
                    }
                    .rom-filter-control,
                    .rom-filter-date,
                    .rom-filter-actions {
                        width: 100%;
                        min-width: 0;
                        flex: none;
                    }
                    .rom-filter-actions .ant-btn,
                    .rom-filter-control .ant-segmented {
                        width: 100%;
                    }
                    .rom-filter-control .ant-segmented-group {
                        width: 100%;
                    }
                    .rom-filter-control .ant-segmented-item {
                        flex: 1;
                    }
                }
            `}</style>
        </div>
    );

    const renderRecruitment = () => (
        <>
            <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Applicants"
                        value={timeFilteredApplications.length}
                        subtitle={`${dateFrom.format("DD MMM")} - ${dateTo.format(
                            "DD MMM YYYY"
                        )}`}
                        icon={<UserAddOutlined />}
                        iconBg="rgba(22,119,255,.12)"
                    />
                </Col>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Accepted"
                        value={acceptedApplications.length}
                        subtitle={`${timeFilteredApplications.length
                            ? Math.round(
                                (acceptedApplications.length /
                                    timeFilteredApplications.length) *
                                1000
                            ) / 10
                            : 0
                            }% conversion`}
                        icon={<CheckCircleOutlined />}
                        iconBg="rgba(34,197,94,.14)"
                    />
                </Col>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Pending Review"
                        value={
                            timeFilteredApplications.filter((app) =>
                                ["pending", "submitted"].includes(getApplicationStatus(app))
                            ).length
                        }
                        subtitle="Submitted or pending applications"
                        icon={<ClockCircleOutlined />}
                        iconBg="rgba(245,158,11,.15)"
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <ChartCard title="Applicants by Month">
                        <DataOrEmpty hasData={hasSeriesData(monthlyApplicationSeries.data)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={monthlyApplicationsOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} lg={12}>
                    <ChartCard title="Application Status Distribution">
                        <DataOrEmpty hasData={hasSeriesData(statusCounts)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={applicationStatusOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} md={12} xl={8}>
                    <ChartCard title="Gender Distribution">
                        <DataOrEmpty hasData={hasSeriesData(genderCounts)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={simplePieOptions(genderCounts, "Applicants")}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} md={12} xl={8}>
                    <ChartCard title="Age Distribution">
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                ageDistribution.male,
                                ageDistribution.female
                            )}
                        >
                            <HighchartsReact highcharts={Highcharts} options={ageOptions} />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} md={12} xl={8}>
                    <ChartCard title="B-BBEE Level Distribution">
                        <DataOrEmpty hasData={hasSeriesData(beeCounts)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={simplePieOptions(beeCounts, "Applicants")}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} md={12}>
                    <ChartCard title="Ward Distribution">
                        <DataOrEmpty hasData={hasSeriesData(wardCounts)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={simplePieOptions(wardCounts, "Applicants")}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} md={12}>
                    <ChartCard title="Sector Distribution">
                        <DataOrEmpty hasData={hasSeriesData(sectorCounts)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={simplePieOptions(sectorCounts, "Applicants")}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>
        </>
    );

    const renderOnboarding = () => (
        <>
            <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Accepted Applicants"
                        value={acceptedApplicationsFiltered.length}
                        subtitle="Onboarding cohort in selected window"
                        icon={<TeamOutlined />}
                        iconBg="rgba(22,119,255,.12)"
                    />
                </Col>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Documents Signed"
                        value={documentStats.totalSigned}
                        subtitle={`${documentStats.completionRate}% document completion`}
                        icon={<FileDoneOutlined />}
                        iconBg="rgba(34,197,94,.14)"
                    />
                </Col>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Documents Missing"
                        value={documentStats.totalMissing}
                        subtitle="GAP, pre-incubation and MOA checks"
                        icon={<WarningOutlined />}
                        iconBg="rgba(239,68,68,.12)"
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <ChartCard title="Onboarding Trend">
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                onboardingByMonth.onboarded,
                                onboardingByMonth.signed,
                                onboardingByMonth.missing
                            )}
                        >
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={onboardingTrendOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} lg={12}>
                    <ChartCard title="Signed vs Missing Documents">
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                documentStats.rows.map((row) => row.signed),
                                documentStats.rows.map((row) => row.missing)
                            )}
                        >
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={documentCompletionOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <ChartCard title="Compliance Group Distribution">
                        <DataOrEmpty hasData={hasSeriesData(complianceGroupCounts)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={complianceOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} lg={12}>
                    <ChartCard title="Accepted SME Ownership Profile">
                        <DataOrEmpty hasData={acceptedParticipantsFiltered.length > 0}>
                            <Space
                                direction="vertical"
                                size={22}
                                style={{ width: "100%", padding: "12px 4px" }}
                            >
                                {[
                                    {
                                        label: "Black Owned Average",
                                        value:
                                            Math.round(
                                                (acceptedParticipantsFiltered.reduce(
                                                    (sum, item) =>
                                                        sum + Number(item.blackOwnedPercent || 0),
                                                    0
                                                ) /
                                                    Math.max(acceptedParticipantsFiltered.length, 1)) *
                                                10
                                            ) / 10,
                                        strokeColor: "#2563eb",
                                    },
                                    {
                                        label: "Female Owned Average",
                                        value:
                                            Math.round(
                                                (acceptedParticipantsFiltered.reduce(
                                                    (sum, item) =>
                                                        sum + Number(item.femaleOwnedPercent || 0),
                                                    0
                                                ) /
                                                    Math.max(acceptedParticipantsFiltered.length, 1)) *
                                                10
                                            ) / 10,
                                        strokeColor: "#db2777",
                                    },
                                    {
                                        label: "Youth Owned Average",
                                        value:
                                            Math.round(
                                                (acceptedParticipantsFiltered.reduce(
                                                    (sum, item) =>
                                                        sum + Number(item.youthOwnedPercent || 0),
                                                    0
                                                ) /
                                                    Math.max(acceptedParticipantsFiltered.length, 1)) *
                                                10
                                            ) / 10,
                                        strokeColor: "#16a34a",
                                    },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        style={{
                                            width: "100%",
                                            padding: 14,
                                            borderRadius: 14,
                                            border: "1px solid #e5e7eb",
                                            background: "linear-gradient(180deg,#ffffff,#f8fafc)",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: 12,
                                                marginBottom: 8,
                                            }}
                                        >
                                            <Text strong>{item.label}</Text>
                                            <Text strong style={{ fontSize: 18 }}>
                                                {item.value}%
                                            </Text>
                                        </div>

                                        <Progress
                                            percent={item.value}
                                            strokeColor={item.strokeColor}
                                            trailColor="#e5e7eb"
                                            showInfo={false}
                                        />
                                    </div>
                                ))}
                            </Space>
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>
        </>
    );

    const renderMaintenance = () => (
        <>
            <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Required / Gap Items"
                        value={gapAnalysis.required.reduce((sum, value) => sum + value, 0)}
                        subtitle="Still needing assignment"
                        icon={<AuditOutlined />}
                        iconBg="rgba(245,158,11,.15)"
                    />
                </Col>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Assigned / In Progress"
                        value={gapAnalysis.assigned.reduce((sum, value) => sum + value, 0)}
                        subtitle="Active maintenance work"
                        icon={<ApartmentOutlined />}
                        iconBg="rgba(22,119,255,.12)"
                    />
                </Col>
                <Col xs={24} md={8}>
                    <MetricCard
                        title="Completed"
                        value={gapAnalysis.completed.reduce((sum, value) => sum + value, 0)}
                        subtitle="Completed intervention items"
                        icon={<CheckCircleOutlined />}
                        iconBg="rgba(34,197,94,.14)"
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={14}>
                    <ChartCard title="Interventions Gap by Department ">
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                gapAnalysis.required,
                                gapAnalysis.assigned,
                                gapAnalysis.completed
                            )}
                        >
                            <HighchartsReact highcharts={Highcharts} options={gapOptions} />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} lg={10}>
                    <ChartCard title="Recruitment to Delivery Pipeline">
                        <DataOrEmpty hasData={hasSeriesData(funnelSeries)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={funnelOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24}>
                    <Card
                        title={
                            <Space>
                                <PieChartOutlined />
                                <span>Department Intervention Drilldown</span>
                            </Space>
                        }
                        style={{
                            borderRadius: 14,
                            border: "1px solid #dbeafe",
                            boxShadow: "0 12px 32px rgba(15,23,42,0.08)",
                        }}
                    >
                        <InterventionsDeptDrilldownChart
                            programId={activeProgramId}
                            departmentId={undefined}
                            dateFrom={dateFrom.toDate()}
                            dateTo={dateTo.toDate()}
                        />
                    </Card>
                </Col>
            </Row>
        </>
    );

    return (
        <div style={{ padding: 20, minHeight: "100vh" }}>
            <Helmet>
                <title>ROM Reports</title>
            </Helmet>

            <DashboardFilterBar
                marginBottom={16}
                padding={14}
                background={isDark
                    ? "linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))"
                    : "linear-gradient(180deg,#ffffff,#f7faff)"}
                borderColor={isDark ? "rgba(74,155,255,0.22)" : "#dbeafe"}
                borderRadius={14}
                boxShadow={isDark
                    ? "inset 0 1px 0 rgba(255,255,255,0.05)"
                    : "inset 0 1px 2px rgba(15,23,42,0.04)"}
            >
                {filterBar}
            </DashboardFilterBar>

            {segment === "recruitment" && renderRecruitment()}
            {segment === "onboarding" && renderOnboarding()}
            {segment === "maintenance" && renderMaintenance()}
            {segment === "reach" && (
                <ReachReportsPanel
                    interventions={reachInterventions}
                    participants={participantById}
                />
            )}

            <Drawer
                title="Advanced Filters"
                placement="right"
                width={420}
                open={advancedOpen}
                onClose={() => setAdvancedOpen(false)}
            >
                <Space direction="vertical" size="large" style={{ width: "100%" }}>
                    <div>
                        <Text strong>B-BBEE Level</Text>
                        <Select
                            mode="multiple"
                            allowClear
                            value={advancedBeeLevels}
                            onChange={setAdvancedBeeLevels}
                            style={{ width: "100%", marginTop: 8 }}
                            options={[1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({
                                value: level,
                                label: `Level ${level}`,
                            }))}
                            placeholder="Filter accepted SMEs by B-BBEE level"
                        />
                    </div>

                    <div>
                        <Text strong>Black Owned %</Text>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <InputNumber
                                min={0}
                                max={100}
                                value={blackOwnedRange[0]}
                                placeholder="Min"
                                style={{ width: "50%" }}
                                onChange={(value) =>
                                    setBlackOwnedRange([value ?? undefined, blackOwnedRange[1]])
                                }
                            />
                            <InputNumber
                                min={0}
                                max={100}
                                value={blackOwnedRange[1]}
                                placeholder="Max"
                                style={{ width: "50%" }}
                                onChange={(value) =>
                                    setBlackOwnedRange([blackOwnedRange[0], value ?? undefined])
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <Text strong>Female Owned %</Text>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <InputNumber
                                min={0}
                                max={100}
                                value={femaleOwnedRange[0]}
                                placeholder="Min"
                                style={{ width: "50%" }}
                                onChange={(value) =>
                                    setFemaleOwnedRange([value ?? undefined, femaleOwnedRange[1]])
                                }
                            />
                            <InputNumber
                                min={0}
                                max={100}
                                value={femaleOwnedRange[1]}
                                placeholder="Max"
                                style={{ width: "50%" }}
                                onChange={(value) =>
                                    setFemaleOwnedRange([femaleOwnedRange[0], value ?? undefined])
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <Text strong>Youth Owned %</Text>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <InputNumber
                                min={0}
                                max={100}
                                value={youthOwnedRange[0]}
                                placeholder="Min"
                                style={{ width: "50%" }}
                                onChange={(value) =>
                                    setYouthOwnedRange([value ?? undefined, youthOwnedRange[1]])
                                }
                            />
                            <InputNumber
                                min={0}
                                max={100}
                                value={youthOwnedRange[1]}
                                placeholder="Max"
                                style={{ width: "50%" }}
                                onChange={(value) =>
                                    setYouthOwnedRange([youthOwnedRange[0], value ?? undefined])
                                }
                            />
                        </div>
                    </div>

                    <Space>
                        <Button
                            onClick={() => {
                                setAdvancedBeeLevels([]);
                                setBlackOwnedRange([undefined, undefined]);
                                setFemaleOwnedRange([undefined, undefined]);
                                setYouthOwnedRange([undefined, undefined]);
                            }}
                        >
                            Reset
                        </Button>
                        <Button type="primary" onClick={() => setAdvancedOpen(false)}>
                            Apply
                        </Button>
                    </Space>
                </Space>
            </Drawer>
        </div>
    );
};

export default ROMSegmentedReportsPage;
