import React, { useEffect, useMemo, useState } from "react";
import {
    Card,
    Row,
    Col,
    Modal,
    Tooltip,
    Empty,
    message,
    Space,
    Segmented,
    DatePicker,
    Button,
    Select,
    Tag,
} from "antd";
import { ArrowsAltOutlined } from "@ant-design/icons";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import HCMore from "highcharts/highcharts-more";
import HCExporting from "highcharts/modules/exporting";
import HCDrilldown from "highcharts/modules/drilldown";
import HCFunnel from "highcharts/modules/funnel";
import dayjs, { Dayjs } from "dayjs";
import { Helmet } from "react-helmet";

// Firebase
import { db } from "@/firebase";
import {
    collection,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    where,
    limit,
    Unsubscribe,
    documentId,
} from "firebase/firestore";

// Project hooks/components
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { LoadingOverlay } from "@/components/shared/LoadingOverlay";
import { DashboardHeaderCard } from "@/components/dashboards/metrics/Header";
import {
    REPORT_CHART_COLORS,
    REPORT_CHART_PALETTE,
} from "@/components/reports/reportChartTheme";
import { buildReachMonthlyDrilldownOptions } from "@/components/reports/reachDrilldownOptions";
import { chunk } from "@/types/types";

if (typeof HCMore === "function") HCMore(Highcharts);
if (typeof HCExporting === "function") HCExporting(Highcharts);
if (typeof HCDrilldown === "function") HCDrilldown(Highcharts);
if (typeof HCFunnel === "function") HCFunnel(Highcharts);

type Application = {
    id: string;
    applicationStatus?: string;
    programId?: string | null;
    programName?: string | null;
    participantId?: string | null;
    email?: string | null;
    submittedAt?: any;
    gender?: string;
    profile?: any;
};

type AssignedIntervention = {
    id: string;
    participantId?: string;
    programId?: string;
    status?: string;
    assignmentStatus?: string;
    areaOfSupport?: string | null;
    interventionTitle?: string | null;
    createdAt?: any;
    updatedAt?: any;
    completedAt?: any;
    acceptedAt?: any;
};

type ParticipantDoc = {
    id: string;
    sector?: string;
    beeLevel?: string;
    youthOwnedPercent?: number;
    blackOwnedPercent?: number;
    femaleOwnedPercent?: number;
    gender?: string;
    idNumber?: string;
    ward?: string;
    hub?: string;
};

type RangeMode = "ytd" | "thisMonth" | "lastMonth" | "custom";
type ViewMode = "interventions" | "demographics" | "reach";

// helpers
const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

const normalizeBucketKey = (v: any, fallback = "Unknown") => {
    const s = (v ?? "").toString().trim();
    if (!s) return fallback;
    const low = s.toLowerCase();
    if (low === "undefined" || low === "null" || low === "nan") return fallback;
    return s;
};

const toDate = (v: any): Date | null =>
    v?.toDate?.() ??
    (typeof v === "number"
        ? new Date(v)
        : v instanceof Date
            ? v
            : typeof v === "string"
                ? new Date(v)
                : null);

const firstMapValue = (m: any) =>
    m && typeof m === "object" ? Object.values(m)[0] : m;

const m = (d: Date) => d.getMonth();
const MONTHS_SHORT = [
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
const fmtMonth = (d: Date) => dayjs(d).format("YYYY-MM");
const monthLabel = (ym: string) => dayjs(`${ym}-01`).format("MMM YYYY");

// ---- derive age from SA ID number (participants) ----
const getAgeFromID = (id?: string): number | null => {
    const s = (id || "").trim();
    if (!/^\d{6}/.test(s)) return null;
    const yy = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2, 4), 10) - 1;
    const dd = parseInt(s.slice(4, 6), 10);
    const currentYear = new Date().getFullYear();
    const century = yy <= currentYear % 100 ? 2000 : 1900;
    const birthDate = new Date(century + yy, mm, dd);
    if (isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const mo = today.getMonth() - birthDate.getMonth();
    if (mo < 0 || (mo === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
};

const AGE_BUCKETS = [
    { label: "15–24", min: 15, max: 24 },
    { label: "25–34", min: 25, max: 34 },
    { label: "35–44", min: 35, max: 44 },
    { label: "45–54", min: 45, max: 54 },
    { label: "55–64", min: 55, max: 64 },
    { label: "65+", min: 65, max: 200 },
] as const;

// bands used by the Reach segment (matches the operations universal report)
const getReachAgeBand = (age: number | null) => {
    if (age == null) return "Unspecified";
    if (age < 30) return "Under 30";
    if (age <= 40) return "30-40";
    if (age <= 50) return "41-50";
    return "51+";
};

// uniform, relatable status color code used across every chart on this page
const STATUS_COLORS = {
    completed: REPORT_CHART_COLORS.success,
    inProgress: REPORT_CHART_COLORS.primary,
    pending: REPORT_CHART_COLORS.warning,
    overdue: REPORT_CHART_COLORS.danger,
};

const ChartCard: React.FC<{
    options: Highcharts.Options;
    height?: number;
    title?: string;
    onExpand: () => void;
    empty?: boolean;
}> = ({ options, title, height = 340, onExpand, empty }) => (
    <Card
        title={title}
        extra={
            <Tooltip title="Expand">
                <ArrowsAltOutlined onClick={onExpand} style={{ cursor: "pointer" }} />
            </Tooltip>
        }
        style={{
            boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
            borderRadius: 12,
            border: "1px solid #d6e4ff",
        }}
        bodyStyle={{ padding: 12, minHeight: height }}
    >
        {empty ? (
            <div
                style={{
                    height: height - 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Empty description="No data available" />
            </div>
        ) : (
            <HighchartsReact
                highcharts={Highcharts}
                options={{ ...options, chart: { ...(options.chart || {}), height } }}
            />
        )}
    </Card>
);

const { RangePicker } = DatePicker;

const FunderAnalytics: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity();
    const { activeProgramId } = useActiveProgramId();

    const [loading, setLoading] = useState(true);
    const [appsUnsub, setAppsUnsub] = useState<Unsubscribe | null>(null);

    const [apps, setApps] = useState<Application[]>([]);
    const [assigned, setAssigned] = useState<AssignedIntervention[]>([]);
    const [participantById, setParticipantById] = useState<
        Map<string, ParticipantDoc>
    >(() => new Map());

    // all applications regardless of status — powers the "Applicants" demographics mode
    const [allApps, setAllApps] = useState<Application[]>([]);
    const [allAppsParticipantById, setAllAppsParticipantById] = useState<
        Map<string, ParticipantDoc>
    >(() => new Map());
    const [allAppsLoading, setAllAppsLoading] = useState(false);

    // filters
    const [rangeMode, setRangeMode] = useState<RangeMode>("ytd");
    const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [deptFilter, setDeptFilter] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<ViewMode>("interventions");
    const [reachDepartment, setReachDepartment] = useState<string>("all");
    const [reachIntervention, setReachIntervention] = useState<string>("all");
    const [demographicsMode, setDemographicsMode] = useState<
        "onboarded" | "applicants"
    >("onboarded");

    const effectiveRange = useMemo(() => {
        if (rangeMode === "thisMonth") {
            return [dayjs().startOf("month"), dayjs().endOf("month")] as [
                Dayjs,
                Dayjs
            ];
        }
        if (rangeMode === "lastMonth") {
            return [
                dayjs().subtract(1, "month").startOf("month"),
                dayjs().subtract(1, "month").endOf("month"),
            ] as [Dayjs, Dayjs];
        }
        if (rangeMode === "custom" && customRange) return customRange;
        return [dayjs().startOf("year"), dayjs().endOf("year")] as [Dayjs, Dayjs];
    }, [rangeMode, customRange]);

    const handleResetFilters = () => {
        setRangeMode("ytd");
        setCustomRange(null);
        setStatusFilter([]);
        setDeptFilter([]);
        setReachDepartment("all");
        setReachIntervention("all");
        setDemographicsMode("onboarded");
    };

    // months list for demographics
    const months = useMemo(() => {
        const [start, end] = effectiveRange;
        const s = start.startOf("month");
        const e = end.endOf("month");
        const out: string[] = [];
        let cur = s.clone();
        while (cur.isBefore(e) || cur.isSame(e, "month")) {
            out.push(cur.format("YYYY-MM"));
            cur = cur.add(1, "month");
        }
        return out;
    }, [effectiveRange]);

    // Resolve participantId (by email, when missing) + fetch participant docs for a raw application list.
    // Shared by the "Onboarded" (accepted-only) and "Applicants" (all statuses) fetches below.
    const resolveApplicantParticipants = async (listRaw: Application[]) => {
        const pidSet = new Set<string>();
        const emailToPid = new Map<string, string>();

        for (const a of listRaw) {
            if (a.participantId) pidSet.add(a.participantId);
            if (a.email) emailToPid.set(a.email.toLowerCase(), "");
        }

        const emailsNeedingLookup = listRaw
            .filter((a) => !a.participantId && a.email)
            .map((a) => a.email!.toLowerCase());

        if (emailsNeedingLookup.length) {
            const unique = Array.from(new Set(emailsNeedingLookup));
            for (const batch of chunk(unique, 10)) {
                const qs = await getDocs(
                    query(
                        collection(db, "participants"),
                        where("email", "in", batch),
                        limit(10)
                    )
                );
                qs.forEach((d) => {
                    const pdata = d.data() as any;
                    const em = (pdata.email || "").toLowerCase();
                    if (em) emailToPid.set(em, d.id);
                    pidSet.add(d.id);
                });
            }
        }

        const list: Application[] = listRaw.map((a) => {
            if (!a.participantId && a.email) {
                const pid = emailToPid.get(a.email.toLowerCase());
                if (pid) return { ...a, participantId: pid };
            }
            return a;
        });

        const pids = Array.from(pidSet);

        const partMap = new Map<string, ParticipantDoc>();
        if (pids.length) {
            for (const ids of chunk(pids, 10)) {
                if (!ids.length) continue;
                const ps = await getDocs(
                    query(collection(db, "participants"), where(documentId(), "in", ids))
                );
                ps.docs.forEach((d) => {
                    partMap.set(d.id, { id: d.id, ...(d.data() as any) });
                });
            }
        }

        return { list, pids, partMap };
    };

    // fetch pipeline (Onboarded = accepted applications, drives Interventions & Reach too)
    useEffect(() => {
        if (identityLoading) return;

        setApps([]);
        setAssigned([]);
        setParticipantById(new Map());
        setLoading(true);

        if (!activeProgramId) {
            console.warn("[FunderAnalytics] Missing activeProgramId", {
                activeProgramId,
            });
            setLoading(false);
            return;
        }

        const qApps = query(
            collection(db, "applications"),
            where("programId", "==", activeProgramId),
            where("applicationStatus", "in", ["accepted", "Accepted"]),
            orderBy("submittedAt", "desc")
        );

        const unsub = onSnapshot(
            qApps,
            async (snap) => {
                try {
                    const listRaw: Application[] = snap.docs.map((d) => ({
                        id: d.id,
                        ...(d.data() as any),
                    }));

                    const { list, pids, partMap } = await resolveApplicantParticipants(
                        listRaw
                    );

                    setApps(list);
                    setParticipantById(partMap);

                    // fetch assignedInterventions for pids & program
                    if (!pids.length) {
                        setAssigned([]);
                        setLoading(false);
                        return;
                    }

                    const all: AssignedIntervention[] = [];
                    for (const ids of chunk(pids, 10)) {
                        if (!ids.length) continue;
                        const qAI = query(
                            collection(db, "assignedInterventions"),
                            where("participantId", "in", ids),
                            where("programId", "==", activeProgramId),
                            orderBy("createdAt", "desc")
                        );
                        const res = await getDocs(qAI);
                        res.forEach((d) => all.push({ id: d.id, ...(d.data() as any) }));
                    }

                    setAssigned(all);
                    setLoading(false);
                } catch (e) {
                    console.error(e);
                    message.error("Failed to load analytics.");
                    setApps([]);
                    setAssigned([]);
                    setParticipantById(new Map());
                    setLoading(false);
                }
            },
            (err) => {
                console.error(err);
                message.error("Failed to subscribe to applications.");
                setLoading(false);
            }
        );

        setAppsUnsub(() => unsub);
        return () => {
            if (appsUnsub) appsUnsub();
            unsub();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identityLoading, activeProgramId]);

    // fetch pipeline (Applicants = every application regardless of status) — feeds the
    // Demographics "Applicants" mode only, fetched once per program (not realtime).
    useEffect(() => {
        if (identityLoading) return;

        setAllApps([]);
        setAllAppsParticipantById(new Map());

        if (!activeProgramId) return;

        let cancelled = false;
        setAllAppsLoading(true);
        (async () => {
            try {
                const qAllApps = query(
                    collection(db, "applications"),
                    where("programId", "==", activeProgramId),
                );
                const snap = await getDocs(qAllApps);
                const listRaw: Application[] = snap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as any),
                }));
                const { list, partMap } = await resolveApplicantParticipants(listRaw);

                if (cancelled) return;
                setAllApps(list);
                setAllAppsParticipantById(partMap);
            } catch (e) {
                console.error(e);
                if (!cancelled) message.error("Failed to load applicant demographics.");
            } finally {
                if (!cancelled) setAllAppsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identityLoading, activeProgramId]);

    // assigned filters
    const assignedFiltered = useMemo(() => {
        const [start, end] = effectiveRange;
        const startD = start.startOf("day").toDate();
        const endD = end.endOf("day").toDate();

        return assigned.filter((ai) => {
            const d =
                toDate(ai.completedAt) ||
                toDate(ai.acceptedAt) ||
                toDate(ai.updatedAt) ||
                toDate(ai.createdAt);

            if (!d || d < startD || d > endD) return false;

            if (statusFilter.length) {
                const st = norm(ai.assignmentStatus) || "unknown";
                if (!statusFilter.includes(st)) return false;
            }
            if (deptFilter.length) {
                const dept = normalizeBucketKey(ai.areaOfSupport, "Other");
                if (!deptFilter.includes(dept)) return false;
            }
            return true;
        });
    }, [assigned, effectiveRange, statusFilter, deptFilter]);

    // ───── Reach derivations (project-scoped, then narrowed by Department → Intervention) ─────
    const reachDepartmentOptions = useMemo(() => {
        const depts = Array.from(
            new Set(
                assignedFiltered.map((ai) =>
                    normalizeBucketKey(ai.areaOfSupport, "Other")
                )
            )
        ).sort();
        return [
            { label: "All departments", value: "all" },
            ...depts.map((dept) => ({ label: dept, value: dept })),
        ];
    }, [assignedFiltered]);

    const reachDepartmentFiltered = useMemo(() => {
        if (reachDepartment === "all") return assignedFiltered;
        return assignedFiltered.filter(
            (ai) => normalizeBucketKey(ai.areaOfSupport, "Other") === reachDepartment
        );
    }, [assignedFiltered, reachDepartment]);

    const reachInterventionOptions = useMemo(() => {
        const titles = Array.from(
            new Set(
                reachDepartmentFiltered.map((ai) =>
                    normalizeBucketKey(ai.interventionTitle, "Untitled")
                )
            )
        ).sort();
        return [
            { label: "All interventions", value: "all" },
            ...titles.map((title) => ({ label: title, value: title })),
        ];
    }, [reachDepartmentFiltered]);

    const handleReachDepartmentChange = (value: string) => {
        setReachDepartment(value);
        setReachIntervention("all");
    };

    const reachRows = useMemo(() => {
        return reachDepartmentFiltered
            .filter(
                (ai) =>
                    reachIntervention === "all" ||
                    normalizeBucketKey(ai.interventionTitle, "Untitled") ===
                    reachIntervention
            )
            .map((ai) => {
                const participant = ai.participantId
                    ? participantById.get(ai.participantId)
                    : undefined;
                const age = getAgeFromID(participant?.idNumber);
                return {
                    row: ai,
                    participant,
                    gender: normalizeBucketKey(participant?.gender, "Unspecified"),
                    ageBand: getReachAgeBand(age),
                    sector: normalizeBucketKey(participant?.sector, "Unspecified"),
                    intervention: normalizeBucketKey(ai.interventionTitle, "Untitled"),
                };
            });
    }, [reachDepartmentFiltered, participantById, reachIntervention]);

    // one entry per unique SME touched by the current Department/Intervention selection —
    // the same "count each SME once" basis the Demographics charts use for applicants
    const reachParticipants = useMemo(() => {
        const map = new Map<string, ParticipantDoc | undefined>();
        reachRows.forEach((item) => {
            const pid = item.row.participantId;
            if (!pid || map.has(pid)) return;
            map.set(pid, item.participant);
        });
        return map;
    }, [reachRows]);

    const reachSummary = useMemo(() => {
        const female3040 = Array.from(reachParticipants.values()).filter((p) => {
            const gender = normalizeBucketKey(p?.gender, "Unspecified").toLowerCase();
            return (
                gender.startsWith("female") &&
                getReachAgeBand(getAgeFromID(p?.idNumber)) === "30-40"
            );
        }).length;
        return {
            totalTouches: reachRows.length,
            uniqueSmes: reachParticipants.size,
            female3040,
        };
    }, [reachRows, reachParticipants]);

    // ───── Reach charts — same chart set/types as Demographics, scoped to the reach filters ─────
    const reachMonthly = useMemo(() => {
        const touchesMap: Record<string, number> = {};
        const smesMap: Record<string, Set<string>> = {};

        reachRows.forEach((item) => {
            const d =
                toDate(item.row.completedAt) ||
                toDate(item.row.acceptedAt) ||
                toDate(item.row.updatedAt) ||
                toDate(item.row.createdAt);
            if (!d) return;
            const k = fmtMonth(d);
            touchesMap[k] = (touchesMap[k] || 0) + 1;
            if (item.row.participantId) {
                if (!smesMap[k]) smesMap[k] = new Set();
                smesMap[k].add(item.row.participantId);
            }
        });

        const cats = months.length
            ? months
            : Array.from(new Set(Object.keys(touchesMap))).sort();

        return {
            keys: cats,
            categories: cats.map(monthLabel),
            touches: cats.map((k) => touchesMap[k] || 0),
            smes: cats.map((k) => smesMap[k]?.size || 0),
        };
    }, [reachRows, months]);

    const reachMonthlyHasData =
        reachMonthly.touches.some((v) => v > 0) ||
        reachMonthly.smes.some((v) => v > 0);

    const reachMonthlyOptions = buildReachMonthlyDrilldownOptions(
        reachRows.flatMap((item) => {
            const date =
                toDate(item.row.completedAt) ||
                toDate(item.row.acceptedAt) ||
                toDate(item.row.updatedAt) ||
                toDate(item.row.createdAt);
            return date
                ? [
                    {
                        date,
                        interventionTitle: normalizeBucketKey(
                            item.row.interventionTitle,
                            "Untitled"
                        ),
                        participantId: item.row.participantId,
                    },
                ]
                : [];
        }),
        { monthKeys: reachMonthly.keys, height: 320 }
    );

    const reachGenderCounts = useMemo(() => {
        const map: Record<string, number> = {};
        reachParticipants.forEach((p) => {
            const key = normalizeBucketKey(p?.gender, "Unknown");
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }, [reachParticipants]);

    const reachGenderHasData = Object.values(reachGenderCounts).some(
        (v) => v > 0
    );

    const reachGenderOptions: Highcharts.Options = {
        chart: { type: "pie", height: 300 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
        plotOptions: {
            pie: {
                innerSize: "60%",
                allowPointSelect: true,
                cursor: "pointer",
                slicedOffset: 14,
                animation: { duration: 650 },
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
                point: {
                    events: {
                        click: function () {
                            // @ts-ignore
                            this.slice();
                        },
                    },
                },
            },
        },
        series: [
            {
                type: "pie",
                name: "SMEs",
                data: Object.entries(reachGenderCounts)
                    .map(([name, y]) => ({ name, y }))
                    .sort((a, b) => (b.y as number) - (a.y as number)),
            },
        ],
    };

    const reachSectorCounts = useMemo(() => {
        const map: Record<string, number> = {};
        reachParticipants.forEach((p) => {
            const key = normalizeBucketKey(p?.sector, "Unknown");
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }, [reachParticipants]);

    const reachSectorHasData = Object.values(reachSectorCounts).some(
        (v) => v > 0
    );

    const reachSectorOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
        plotOptions: {
            pie: {
                innerSize: "60%",
                allowPointSelect: true,
                cursor: "pointer",
                slicedOffset: 14,
                animation: { duration: 650 },
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
                point: {
                    events: {
                        click: function () {
                            // @ts-ignore
                            this.slice();
                        },
                    },
                },
            },
        },
        series: [
            {
                type: "pie",
                name: "SMEs",
                data: Object.entries(reachSectorCounts)
                    .map(([name, y]) => ({ name, y }))
                    .sort((a, b) => (b.y as number) - (a.y as number)),
            },
        ],
    };

    const reachAgePyramid = useMemo(() => {
        const categories = AGE_BUCKETS.map((b) => b.label);
        const participants = Array.from(reachParticipants.values());

        const male = AGE_BUCKETS.map(
            (b) =>
                participants.filter((p) => {
                    const age = getAgeFromID(p?.idNumber);
                    if (age == null || age < b.min || age > b.max) return false;
                    return (
                        String(p?.gender || "")
                            .toLowerCase()
                            .trim() === "male"
                    );
                }).length
        );

        const female = AGE_BUCKETS.map(
            (b) =>
                participants.filter((p) => {
                    const age = getAgeFromID(p?.idNumber);
                    if (age == null || age < b.min || age > b.max) return false;
                    return (
                        String(p?.gender || "")
                            .toLowerCase()
                            .trim() === "female"
                    );
                }).length
        );

        const has = male.some((v) => v > 0) || female.some((v) => v > 0);
        return { categories, male, female, has };
    }, [reachParticipants]);

    const reachAgePyramidOptions: Highcharts.Options = {
        chart: { type: "bar", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: [
            {
                categories: reachAgePyramid.categories,
                reversed: false,
                labels: { step: 1 },
            },
            {
                categories: reachAgePyramid.categories,
                reversed: false,
                opposite: true,
                linkedTo: 0,
                labels: { step: 1 },
            },
        ],
        yAxis: {
            title: { text: null },
            labels: {
                formatter: function () {
                    // @ts-ignore
                    return Math.abs(Number(this.value)).toString();
                },
            },
        },
        tooltip: {
            // @ts-ignore
            formatter: function () {
                const point: any = this;
                return `<b>${point.series.name}</b><br/>${point.point.category
                    }: <b>${Math.abs(Number(point.point.y))}</b>`;
            },
        },
        plotOptions: {
            series: {
                stacking: "normal",
                animation: { duration: 650 },
            },
        },
        series: [
            {
                type: "bar",
                name: "Male",
                color: STATUS_COLORS.inProgress,
                data: reachAgePyramid.male.map((v) => -v),
            },
            {
                type: "bar",
                name: "Female",
                color: STATUS_COLORS.completed,
                data: reachAgePyramid.female,
            },
        ],
    };

    const reachOwnershipAverages = useMemo(() => {
        let yv = 0,
            b = 0,
            f = 0,
            n = 0;
        reachParticipants.forEach((p) => {
            yv += Number(p?.youthOwnedPercent) || 0;
            b += Number(p?.blackOwnedPercent) || 0;
            f += Number(p?.femaleOwnedPercent) || 0;
            n++;
        });
        return n
            ? {
                youth: +(yv / n).toFixed(1),
                black: +(b / n).toFixed(1),
                female: +(f / n).toFixed(1),
            }
            : { youth: 0, black: 0, female: 0 };
    }, [reachParticipants]);

    const reachOwnershipHasData =
        reachOwnershipAverages.youth +
        reachOwnershipAverages.black +
        reachOwnershipAverages.female >
        0;

    const reachOwnershipOptions: Highcharts.Options = {
        chart: { type: "column", height: 300 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: { categories: ["Youth", "Black", "Female"] },
        yAxis: { min: 0, max: 100, title: { text: "Percent" } },
        plotOptions: {
            column: { dataLabels: { enabled: true, format: "{point.y}%" } },
        },
        series: [
            {
                type: "column",
                name: "Average %",
                color: STATUS_COLORS.inProgress,
                data: [
                    reachOwnershipAverages.youth,
                    reachOwnershipAverages.black,
                    reachOwnershipAverages.female,
                ],
            },
        ],
    };

    const reachBeeCounts = useMemo(() => {
        const map: Record<string, number> = {};
        reachParticipants.forEach((p) => {
            const v = normalizeBucketKey(p?.beeLevel, "Unknown");
            map[v] = (map[v] || 0) + 1;
        });
        return map;
    }, [reachParticipants]);

    const reachBeeHasData = Object.values(reachBeeCounts).some((v) => v > 0);

    const reachBeeOptions: Highcharts.Options = {
        chart: { type: "pie", height: 300 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: "55%",
                dataLabels: { enabled: true, format: "{point.name}: {point.y}" },
            },
        },
        series: [
            {
                type: "pie",
                name: "SMEs",
                data: Object.entries(reachBeeCounts).map(([k, v]) => ({
                    name: k,
                    y: v,
                })),
            },
        ],
    };

    const reachLocalityCounts = useMemo(() => {
        const map: Record<string, number> = {};
        reachParticipants.forEach((p) => {
            const key = normalizeBucketKey(p?.ward || p?.hub, "Unknown");
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }, [reachParticipants]);

    const reachLocalityHasData = Object.values(reachLocalityCounts).some(
        (v) => v > 0
    );

    const reachLocalityOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
        plotOptions: {
            pie: {
                innerSize: "55%",
                showInLegend: true,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
            },
        },
        series: [
            {
                type: "pie",
                name: "SMEs",
                data: Object.entries(reachLocalityCounts)
                    .map(([name, y]) => ({ name, y }))
                    .sort((a, b) => (b.y as number) - (a.y as number)),
            },
        ],
    };

    // demographics: which application pool feeds the Demographics segment
    // 'onboarded' = accepted only (same data as Interventions/Reach), 'applicants' = everyone who applied
    const demoApps = demographicsMode === "applicants" ? allApps : apps;
    const demoParticipantById =
        demographicsMode === "applicants"
            ? allAppsParticipantById
            : participantById;

    // demographics: applications in range
    const appsInRange = useMemo(() => {
        const [start, end] = effectiveRange;
        const s = start.startOf("day").toDate();
        const e = end.endOf("day").toDate();
        return demoApps.filter((a) => {
            const d = toDate(a.submittedAt);
            return d && d >= s && d <= e;
        });
    }, [demoApps, effectiveRange]);

    // ───── Interventions chart derivations ─────
    const {
        monthlyCompleted,
        statusDonut,
        deptCategories,
        deptSeries,
        deptDrilldownMap,
        funnelData,
    } = useMemo(() => {
        const normalizeInterventionStatus = (value?: string | null) => {
            const st = norm(value);

            if (["completed", "done", "complete"].includes(st)) {
                return "completed";
            }

            if (["in-progress", "in_progress", "accepted"].includes(st)) {
                return "in_progress";
            }

            if (["assigned", "pending"].includes(st)) {
                return "pending";
            }

            return null;
        };

        const prettyMainStatus = (st: "pending" | "in_progress" | "completed") =>
            st === "completed"
                ? "Completed"
                : st === "in_progress"
                    ? "In Progress"
                    : "Pending";

        const statusColor = (st: "pending" | "in_progress" | "completed") =>
            st === "completed"
                ? STATUS_COLORS.completed
                : st === "in_progress"
                    ? STATUS_COLORS.inProgress
                    : STATUS_COLORS.pending;

        const isCompleted = (x: AssignedIntervention) =>
            normalizeInterventionStatus(x.assignmentStatus) === "completed";

        const monthly = Array(12).fill(0) as number[];
        const completed = assignedFiltered.filter((ai) => isCompleted(ai));
        completed.forEach((ai) => {
            const d =
                toDate(ai.completedAt) || toDate(ai.updatedAt) || toDate(ai.createdAt);
            if (d) monthly[m(d)] += 1;
        });

        const statusCount = new Map<string, number>();
        assignedFiltered.forEach((ai) => {
            const st = normalizeInterventionStatus(ai.assignmentStatus);
            if (!st) return;
            statusCount.set(st, (statusCount.get(st) || 0) + 1);
        });

        const statusDonut = Array.from(statusCount.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, y]) => ({
                name: prettyMainStatus(name as "pending" | "in_progress" | "completed"),
                y,
                color: statusColor(name as "pending" | "in_progress" | "completed"),
            }));

        const perDept: Record<
            string,
            {
                pending: number;
                in_progress: number;
                completed: number;
                interventions: Record<
                    string,
                    { pending: number; in_progress: number; completed: number }
                >;
            }
        > = {};

        assignedFiltered.forEach((ai) => {
            const normalizedStatus = normalizeInterventionStatus(ai.assignmentStatus);
            if (!normalizedStatus) return;

            const dept = normalizeBucketKey(ai.areaOfSupport, "Other");
            const interventionTitle = normalizeBucketKey(
                ai.interventionTitle,
                "Untitled Intervention"
            );

            if (!perDept[dept]) {
                perDept[dept] = {
                    pending: 0,
                    in_progress: 0,
                    completed: 0,
                    interventions: {},
                };
            }

            perDept[dept][normalizedStatus] += 1;

            if (!perDept[dept].interventions[interventionTitle]) {
                perDept[dept].interventions[interventionTitle] = {
                    pending: 0,
                    in_progress: 0,
                    completed: 0,
                };
            }

            perDept[dept].interventions[interventionTitle][normalizedStatus] += 1;
        });

        const deptCategories = Object.keys(perDept).sort();

        const deptSeries = [
            {
                type: "column" as const,
                name: "Pending",
                color: STATUS_COLORS.pending,
                data: deptCategories.map((dept) => ({
                    name: dept,
                    y: perDept[dept].pending,
                    drilldown: dept,
                    custom: { dept },
                })),
            },
            {
                type: "column" as const,
                name: "In Progress",
                color: STATUS_COLORS.inProgress,
                data: deptCategories.map((dept) => ({
                    name: dept,
                    y: perDept[dept].in_progress,
                    drilldown: dept,
                    custom: { dept },
                })),
            },
            {
                type: "column" as const,
                name: "Completed",
                color: STATUS_COLORS.completed,
                data: deptCategories.map((dept) => ({
                    name: dept,
                    y: perDept[dept].completed,
                    drilldown: dept,
                    custom: { dept },
                })),
            },
        ];

        const deptDrilldownMap = deptCategories.reduce((acc, dept) => {
            const interventions = perDept[dept].interventions;

            const titles = Object.keys(interventions).sort((a, b) => {
                const totalA =
                    interventions[a].pending +
                    interventions[a].in_progress +
                    interventions[a].completed;
                const totalB =
                    interventions[b].pending +
                    interventions[b].in_progress +
                    interventions[b].completed;
                return totalB - totalA;
            });

            acc[dept] = {
                categories: titles,
                pending: titles.map((title) => interventions[title].pending || 0),
                inProgress: titles.map(
                    (title) => interventions[title].in_progress || 0
                ),
                completed: titles.map((title) => interventions[title].completed || 0),
            };

            return acc;
        }, {} as Record<string, { categories: string[]; pending: number[]; inProgress: number[]; completed: number[] }>);

        const [start, end] = effectiveRange;
        const startD = start.startOf("day").toDate();
        const endD = end.endOf("day").toDate();
        const inRange = (dt: Date | null) => !!dt && dt >= startD && dt <= endD;

        const acceptedCnt = assignedFiltered.filter((ai) => {
            const st = normalizeInterventionStatus(ai.assignmentStatus);
            if (st !== "in_progress") return false;
            const d =
                toDate(ai.acceptedAt) || toDate(ai.updatedAt) || toDate(ai.createdAt);
            return inRange(d);
        }).length;

        const completedCnt = assignedFiltered.filter((ai) => {
            const st = normalizeInterventionStatus(ai.assignmentStatus);
            return (
                st === "completed" &&
                inRange(
                    toDate(ai.completedAt) || toDate(ai.updatedAt) || toDate(ai.createdAt)
                )
            );
        }).length;

        const funnelRaw: Array<[string, number]> = [
            ["In Progress", acceptedCnt],
            ["Completed", completedCnt],
        ];
        const funnelData = funnelRaw.filter(([, y]) => y > 0);

        return {
            monthlyCompleted: monthly,
            statusDonut,
            deptCategories,
            deptSeries,
            deptDrilldownMap,
            funnelData,
        };
    }, [assignedFiltered, effectiveRange]);

    // ───── Demographics derivations ─────
    const appsSubmittedVsAccepted = useMemo(() => {
        const subMap: Record<string, number> = {};
        const accMap: Record<string, number> = {};

        appsInRange.forEach((a) => {
            const d = toDate(a.submittedAt);
            if (!d) return;
            const k = fmtMonth(d);
            subMap[k] = (subMap[k] || 0) + 1;
            if (norm(a.applicationStatus) === "accepted") {
                accMap[k] = (accMap[k] || 0) + 1;
            }
        });

        const cats = months.length
            ? months
            : Array.from(
                new Set([...Object.keys(subMap), ...Object.keys(accMap)])
            ).sort();

        return {
            categories: cats.map(monthLabel),
            submitted: cats.map((k) => subMap[k] || 0),
            accepted: cats.map((k) => accMap[k] || 0),
        };
    }, [appsInRange, months]);

    const appsSubmittedVsAcceptedHasData =
        appsSubmittedVsAccepted.submitted.some((v) => v > 0) ||
        appsSubmittedVsAccepted.accepted.some((v) => v > 0);

    const appGenderCounts = useMemo(() => {
        const map: Record<string, number> = {};
        appsInRange.forEach((a) => {
            const p = a.participantId
                ? demoParticipantById.get(a.participantId)
                : undefined;
            const raw = p?.gender || a.gender;
            const key = normalizeBucketKey(raw, "Unknown");
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }, [appsInRange, demoParticipantById]);

    const appGenderHasData = Object.values(appGenderCounts).some((v) => v > 0);

    // Sector (clean keys, never undefined)
    const appSectorCounts = useMemo(() => {
        const map: Record<string, number> = {};
        appsInRange.forEach((a) => {
            const p = a.participantId
                ? demoParticipantById.get(a.participantId)
                : undefined;
            const key = normalizeBucketKey(p?.sector, "Unknown");
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }, [appsInRange, demoParticipantById]);

    const appSectorHasData = Object.values(appSectorCounts).some((v) => v > 0);

    // Age pyramid (Male left, Female right)
    const getGender = (a: Application, p?: ParticipantDoc) => {
        const g = String(p?.gender || a.gender || "")
            .toLowerCase()
            .trim();
        if (g === "male") return "male";
        if (g === "female") return "female";
        return "unknown";
    };

    const agePyramid = useMemo(() => {
        const categories = AGE_BUCKETS.map((b) => b.label);

        const male = AGE_BUCKETS.map(
            (b) =>
                appsInRange.filter((a) => {
                    const p = a.participantId
                        ? demoParticipantById.get(a.participantId)
                        : undefined;
                    const age = getAgeFromID(p?.idNumber);
                    if (age == null) return false;
                    if (age < b.min || age > b.max) return false;
                    return getGender(a, p) === "male";
                }).length
        );

        const female = AGE_BUCKETS.map(
            (b) =>
                appsInRange.filter((a) => {
                    const p = a.participantId
                        ? demoParticipantById.get(a.participantId)
                        : undefined;
                    const age = getAgeFromID(p?.idNumber);
                    if (age == null) return false;
                    if (age < b.min || age > b.max) return false;
                    return getGender(a, p) === "female";
                }).length
        );

        const has = male.some((v) => v > 0) || female.some((v) => v > 0);
        return { categories, male, female, has };
    }, [appsInRange, demoParticipantById]);

    const ownershipAverages = useMemo(() => {
        let yv = 0,
            b = 0,
            f = 0,
            n = 0;
        appsInRange.forEach((a) => {
            const p = a.participantId
                ? demoParticipantById.get(a.participantId)
                : undefined;
            yv += Number(p?.youthOwnedPercent) || 0;
            b += Number(p?.blackOwnedPercent) || 0;
            f += Number(p?.femaleOwnedPercent) || 0;
            n++;
        });
        return n
            ? {
                youth: +(yv / n).toFixed(1),
                black: +(b / n).toFixed(1),
                female: +(f / n).toFixed(1),
            }
            : { youth: 0, black: 0, female: 0 };
    }, [appsInRange, demoParticipantById]);

    const ownershipHasData =
        ownershipAverages.youth +
        ownershipAverages.black +
        ownershipAverages.female >
        0;

    const beeCounts = useMemo(() => {
        const map: Record<string, number> = {};
        appsInRange.forEach((a) => {
            const p = a.participantId
                ? demoParticipantById.get(a.participantId)
                : undefined;
            const v = normalizeBucketKey(p?.beeLevel, "Unknown");
            map[v] = (map[v] || 0) + 1;
        });
        return map;
    }, [appsInRange, demoParticipantById]);

    const beeHasData = Object.values(beeCounts).some((v) => v > 0);

    // Locality (pie)
    const localityCounts = useMemo(() => {
        const map: Record<string, number> = {};
        appsInRange.forEach((a) => {
            let loc: any = undefined;
            const prof = (a as any).profile;
            if (prof && typeof prof === "object") loc = firstMapValue(prof);

            if (!loc && a.participantId) {
                const p = demoParticipantById.get(a.participantId);
                loc = p?.ward || p?.hub;
            }

            const key = normalizeBucketKey(loc, "Unknown");
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }, [appsInRange, demoParticipantById]);

    const localityHasData = Object.values(localityCounts).some((v) => v > 0);

    // ───── Chart options ─────
    const rangeLabel = useMemo(() => {
        const [s, e] = effectiveRange;
        return `${s.format("YYYY-MM-DD")} → ${e.format("YYYY-MM-DD")}`;
    }, [effectiveRange]);

    const demoLabel =
        demographicsMode === "applicants" ? "Applicants" : "Onboarded SMEs";

    const reachScopeLabel = useMemo(() => {
        const parts: string[] = [];
        if (reachDepartment !== "all") parts.push(reachDepartment);
        if (reachIntervention !== "all") parts.push(reachIntervention);
        return parts.length ? parts.join(" — ") : "Program-wide";
    }, [reachDepartment, reachIntervention]);

    const trendOptions: Highcharts.Options = {
        credits: { enabled: false },
        exporting: { enabled: false },
        title: { text: undefined },
        xAxis: { categories: MONTHS_SHORT },
        yAxis: { min: 0, title: { text: undefined } },
        tooltip: { shared: true },
        plotOptions: {
            series: { dataLabels: { enabled: true, format: "{point.y}" } },
        },
        series: [
            {
                name: `Interventions Completed (${rangeLabel})`,
                type: "line",
                color: STATUS_COLORS.completed,
                data: monthlyCompleted,
            },
        ],
    };

    const prettyStatus = (s?: string) => {
        const nrm = (s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
        const map: Record<string, string> = {
            "in progress": "In Progress",
            completed: "Completed",
            accepted: "Accepted",
            pending: "Pending",
            rejected: "Rejected",
            declined: "Declined",
            scheduled: "Scheduled",
            unknown: "Unknown",
        };
        return (
            map[nrm] ?? (nrm.replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown")
        );
    };

    const statusDonutOptions: Highcharts.Options = {
        chart: { type: "pie" },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: "60%",
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
                showInLegend: true,
            },
        },
        tooltip: { pointFormat: "<b>{point.y}</b>" },
        series: [
            {
                type: "pie",
                name: "Count",
                data: statusDonut as any,
            },
        ],
    };

    const deptStackOptions: Highcharts.Options = {
        chart: {
            type: "column",
            events: {
                drilldown: function (e: any) {
                    const chart = this as Highcharts.Chart;
                    const dept = e.point?.custom?.dept || e.point?.name;
                    const detail = deptDrilldownMap[dept];

                    if (!detail) return;

                    e.preventDefault();

                    chart.xAxis[0].setCategories(detail.categories, false);

                    chart.addSingleSeriesAsDrilldown(e.point, {
                        type: "column",
                        id: `${dept}__pending`,
                        name: "Pending",
                        color: STATUS_COLORS.pending,
                        data: detail.pending,
                    } as Highcharts.SeriesOptionsType);

                    chart.addSingleSeriesAsDrilldown(e.point, {
                        type: "column",
                        id: `${dept}__inprogress`,
                        name: "In Progress",
                        color: STATUS_COLORS.inProgress,
                        data: detail.inProgress,
                    } as Highcharts.SeriesOptionsType);

                    chart.addSingleSeriesAsDrilldown(e.point, {
                        type: "column",
                        id: `${dept}__completed`,
                        name: "Completed",
                        color: STATUS_COLORS.completed,
                        data: detail.completed,
                    } as Highcharts.SeriesOptionsType);

                    chart.applyDrilldown();
                },
                drillup: function () {
                    const chart = this as Highcharts.Chart;
                    chart.xAxis[0].setCategories(deptCategories, false);
                    chart.redraw();
                },
            },
        },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: {
            categories: deptCategories,
            title: { text: undefined },
        },
        yAxis: {
            min: 0,
            title: { text: "Interventions" },
            stackLabels: {
                enabled: true,
            },
        },
        legend: { enabled: true },
        tooltip: { shared: true },
        plotOptions: {
            column: {
                stacking: "normal",
                borderRadius: 3,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.y > 0 ? this.y : null;
                    },
                },
            },
            series: {
                cursor: "pointer",
            },
        },
        drilldown: {
            allowPointDrilldown: true,
            breadcrumbs: {
                position: { align: "right" },
            },
        },
        series: deptSeries as any,
    };

    const emptyTrend = monthlyCompleted.every((v) => !v);
    const emptyStatus = !statusDonut.length;
    const emptyDept =
        !deptCategories.length ||
        (deptSeries as any[]).every((s) => s.data?.every((n: number) => n === 0));
    const emptyFunnel = !funnelData.length;

    // demographics options
    const appsSubmittedVsAcceptedOptions: Highcharts.Options = {
        chart: { type: "column", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: { categories: appsSubmittedVsAccepted.categories },
        yAxis: { min: 0, title: { text: "Applications" } },
        plotOptions: { column: { borderRadius: 4, dataLabels: { enabled: true } } },
        series: [
            {
                type: "column",
                name: "Submitted",
                color: STATUS_COLORS.inProgress,
                data: appsSubmittedVsAccepted.submitted,
            },
            {
                type: "column",
                name: "Accepted",
                color: STATUS_COLORS.completed,
                data: appsSubmittedVsAccepted.accepted,
            },
        ],
    };

    const appGenderOptions: Highcharts.Options = {
        chart: { type: "pie", height: 300 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
        plotOptions: {
            pie: {
                innerSize: "60%",
                allowPointSelect: true,
                cursor: "pointer",
                slicedOffset: 14,
                animation: { duration: 650 },
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
                point: {
                    events: {
                        click: function () {
                            // @ts-ignore
                            this.slice();
                        },
                    },
                },
            },
        },
        series: [
            {
                type: "pie",
                name: "Applicants",
                data: Object.entries(appGenderCounts)
                    .map(([name, y]) => ({ name, y }))
                    .sort((a, b) => (b.y as number) - (a.y as number)),
            },
        ],
    };

    // ✅ Sector DONUT with slice animation + click-to-slice
    const appSectorDonutOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
        plotOptions: {
            pie: {
                innerSize: "60%",
                allowPointSelect: true,
                cursor: "pointer",
                slicedOffset: 14,
                animation: { duration: 650 },
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
                point: {
                    events: {
                        click: function () {
                            // @ts-ignore
                            this.slice();
                        },
                    },
                },
            },
        },
        series: [
            {
                type: "pie",
                name: "Applicants",
                data: Object.entries(appSectorCounts)
                    .map(([name, y]) => ({ name, y }))
                    .sort((a, b) => (b.y as number) - (a.y as number)),
            },
        ],
    };

    // ✅ Age pyramid (male left, female right)
    const agePyramidOptions: Highcharts.Options = {
        chart: { type: "bar", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: [
            {
                categories: agePyramid.categories,
                reversed: false,
                labels: { step: 1 },
            },
            {
                categories: agePyramid.categories,
                reversed: false,
                opposite: true,
                linkedTo: 0,
                labels: { step: 1 },
            },
        ],
        yAxis: {
            title: { text: null },
            labels: {
                formatter: function () {
                    // @ts-ignore
                    return Math.abs(Number(this.value)).toString();
                },
            },
        },
        tooltip: {
            // @ts-ignore
            formatter: function () {
                const point: any = this;
                return `<b>${point.series.name}</b><br/>${point.point.category
                    }: <b>${Math.abs(Number(point.point.y))}</b>`;
            },
        },
        plotOptions: {
            series: {
                stacking: "normal",
                animation: { duration: 650 },
            },
        },
        series: [
            { type: "bar", name: "Male", data: agePyramid.male.map((v) => -v) },
            { type: "bar", name: "Female", data: agePyramid.female },
        ],
    };

    const ownershipOptions: Highcharts.Options = {
        chart: { type: "column", height: 300 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: { categories: ["Youth", "Black", "Female"] },
        yAxis: { min: 0, max: 100, title: { text: "Percent" } },
        plotOptions: {
            column: { dataLabels: { enabled: true, format: "{point.y}%" } },
        },
        series: [
            {
                type: "column",
                name: "Average %",
                data: [
                    ownershipAverages.youth,
                    ownershipAverages.black,
                    ownershipAverages.female,
                ],
            },
        ],
    };

    const beeOptions: Highcharts.Options = {
        chart: { type: "pie", height: 300 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: "55%",
                dataLabels: { enabled: true, format: "{point.name}: {point.y}" },
            },
        },
        series: [
            {
                type: "pie",
                name: "Applications",
                data: Object.entries(beeCounts).map(([k, v]) => ({ name: k, y: v })),
            },
        ],
    };

    const localityOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        colors: REPORT_CHART_PALETTE,
        title: { text: "" },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
        plotOptions: {
            pie: {
                innerSize: "55%",
                showInLegend: true,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.point?.y ? `${this.point.name}: ${this.point.y}` : null;
                    },
                },
            },
        },
        series: [
            {
                type: "pie",
                name: "Applications",
                data: Object.entries(localityCounts)
                    .map(([name, y]) => ({ name, y }))
                    .sort((a, b) => (b.y as number) - (a.y as number)),
            },
        ],
    };

    // modal
    const [modalOpen, setModalOpen] = useState(false);
    const [modalTitle, setModalTitle] = useState<string>("");
    const [modalOptions, setModalOptions] = useState<Highcharts.Options>({});
    const openExpand = (title: string, options: Highcharts.Options) => {
        setModalTitle(title);
        setModalOptions(options);
        setModalOpen(true);
    };

    return (
        <div style={{ minHeight: "100vh", padding: 24 }}>
            <Helmet>
                <title>Funder Analytics</title>
            </Helmet>

            <DashboardHeaderCard
                title="Funder Analytics"
                extraRight={
                    <Space wrap size="middle" style={{ marginTop: 12, width: "100%" }}>
                        <Segmented<ViewMode>
                            value={viewMode}
                            onChange={(val) => setViewMode(val as ViewMode)}
                            options={[
                                { label: "Interventions", value: "interventions" },
                                { label: "Demographics", value: "demographics" },
                                { label: "Reach", value: "reach" },
                            ]}
                        />
                        <Segmented<RangeMode>
                            value={rangeMode}
                            onChange={(val) => setRangeMode(val as RangeMode)}
                            options={[
                                { label: "YTD", value: "ytd" },
                                { label: "This Month", value: "thisMonth" },
                                { label: "Last Month", value: "lastMonth" },
                                { label: "Custom", value: "custom" },
                            ]}
                        />
                        <RangePicker
                            disabled={rangeMode !== "custom"}
                            value={rangeMode === "custom" ? (customRange as any) : undefined}
                            onChange={(vals) => setCustomRange(vals as [Dayjs, Dayjs] | null)}
                            allowClear
                        />
                        <Button onClick={handleResetFilters}>Reset</Button>
                    </Space>
                }
            />

            {loading ? (
                <LoadingOverlay tip={"Loading Analytics..."} />
            ) : viewMode === "interventions" ? (
                <>
                    <Row gutter={[24, 24]} style={{ marginBottom: 16 }}>
                        <Col xs={24} lg={12}>
                            <ChartCard
                                title={`Monthly Interventions Completed (${rangeLabel})`}
                                options={trendOptions}
                                onExpand={() =>
                                    openExpand(
                                        `Monthly Interventions Completed (${rangeLabel})`,
                                        trendOptions
                                    )
                                }
                                empty={emptyTrend}
                            />
                        </Col>
                        <Col xs={24} lg={12}>
                            <ChartCard
                                title={`Status Distribution (${rangeLabel})`}
                                options={statusDonutOptions}
                                onExpand={() =>
                                    openExpand(
                                        `Status Distribution (${rangeLabel})`,
                                        statusDonutOptions
                                    )
                                }
                                empty={emptyStatus}
                            />
                        </Col>
                    </Row>

                    <Row gutter={[24, 24]}>
                        <Col xs={24}>
                            <ChartCard
                                title={`Interventions by Department — Pending vs In Progress vs Completed (${rangeLabel})`}
                                options={deptStackOptions}
                                onExpand={() =>
                                    openExpand(
                                        `Interventions by Department — Pending vs In Progress vs Completed (${rangeLabel})`,
                                        deptStackOptions
                                    )
                                }
                                empty={emptyDept}
                            />
                        </Col>
                    </Row>
                </>
            ) : viewMode === "demographics" ? (
                <>
                    <Row gutter={[24, 24]} style={{ marginBottom: 16 }}>
                        <Col xs={24}>
                            <Card
                                style={{
                                    boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                                    borderRadius: 12,
                                    border: "1px solid #d6e4ff",
                                }}
                            >
                                <Segmented
                                    block
                                    value={demographicsMode}
                                    onChange={(val) =>
                                        setDemographicsMode(val as "onboarded" | "applicants")
                                    }
                                    options={[
                                        {
                                            label: "Onboarded (Accepted into program)",
                                            value: "onboarded",
                                        },
                                        {
                                            label: "Applicants (Everyone who applied)",
                                            value: "applicants",
                                        },
                                    ]}
                                />
                            </Card>
                        </Col>
                    </Row>

                    {demographicsMode === "applicants" && allAppsLoading ? (
                        <LoadingOverlay tip="Loading applicant demographics..." />
                    ) : (
                        <>
                            <Row gutter={[24, 24]} style={{ marginBottom: 16 }}>
                                <Col xs={24} lg={12}>
                                    <ChartCard
                                        title="Applications — Submitted vs Accepted (Monthly)"
                                        options={appsSubmittedVsAcceptedOptions}
                                        onExpand={() =>
                                            openExpand(
                                                "Applications — Submitted vs Accepted (Monthly)",
                                                appsSubmittedVsAcceptedOptions
                                            )
                                        }
                                        empty={!appsSubmittedVsAcceptedHasData}
                                    />
                                </Col>
                                <Col xs={24} lg={12}>
                                    <ChartCard
                                        title={`${demoLabel} by Gender`}
                                        options={appGenderOptions}
                                        onExpand={() =>
                                            openExpand(`${demoLabel} by Gender`, appGenderOptions)
                                        }
                                        empty={!appGenderHasData}
                                    />
                                </Col>
                            </Row>

                            <Row gutter={[24, 24]}>
                                <Col xs={24} lg={12}>
                                    <ChartCard
                                        title={`${demoLabel} by Age (Pyramid)`}
                                        options={agePyramidOptions}
                                        onExpand={() =>
                                            openExpand(
                                                `${demoLabel} by Age (Pyramid)`,
                                                agePyramidOptions
                                            )
                                        }
                                        empty={!agePyramid.has}
                                    />
                                </Col>

                                <Col xs={24} lg={12}>
                                    <ChartCard
                                        title={`${demoLabel} by Sector`}
                                        options={appSectorDonutOptions}
                                        onExpand={() =>
                                            openExpand(
                                                `${demoLabel} by Sector`,
                                                appSectorDonutOptions
                                            )
                                        }
                                        empty={!appSectorHasData}
                                    />
                                </Col>

                                <Col xs={24} lg={12}>
                                    <ChartCard
                                        title="Ownership Breakdown (Average %)"
                                        options={ownershipOptions}
                                        onExpand={() =>
                                            openExpand(
                                                "Ownership Breakdown (Average %)",
                                                ownershipOptions
                                            )
                                        }
                                        empty={!ownershipHasData}
                                    />
                                </Col>

                                <Col xs={24} lg={12}>
                                    <ChartCard
                                        title="B-BBEE / Education Breakdown"
                                        options={beeOptions}
                                        onExpand={() =>
                                            openExpand("B-BBEE / Education Breakdown", beeOptions)
                                        }
                                        empty={!beeHasData}
                                    />
                                </Col>

                                <Col xs={24}>
                                    <ChartCard
                                        title="Locality Distribution"
                                        options={localityOptions}
                                        onExpand={() =>
                                            openExpand("Locality Distribution", localityOptions)
                                        }
                                        empty={!localityHasData}
                                    />
                                </Col>
                            </Row>
                        </>
                    )}
                </>
            ) : (
                <>
                    <Row gutter={[24, 24]} style={{ marginBottom: 16 }}>
                        <Col xs={24}>
                            <Card
                                style={{
                                    boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                                    borderRadius: 12,
                                    border: "1px solid #d6e4ff",
                                }}
                            >
                                <Space wrap size="middle">
                                    <Select
                                        value={reachDepartment}
                                        onChange={handleReachDepartmentChange}
                                        options={reachDepartmentOptions}
                                        style={{ minWidth: 220 }}
                                        showSearch
                                        optionFilterProp="label"
                                    />
                                    <Select
                                        value={reachIntervention}
                                        onChange={setReachIntervention}
                                        options={reachInterventionOptions}
                                        style={{ minWidth: 280 }}
                                        showSearch
                                        optionFilterProp="label"
                                    />
                                    <Tag color="blue">
                                        SMEs reached: {reachSummary.uniqueSmes}
                                    </Tag>
                                    <Tag color="green">
                                        Female 30-40: {reachSummary.female3040}
                                    </Tag>
                                    <Tag color="orange">
                                        Total intervention delivered: {reachSummary.totalTouches}
                                    </Tag>
                                </Space>
                            </Card>
                        </Col>
                    </Row>

                    <Row gutter={[24, 24]} style={{ marginBottom: 16 }}>
                        <Col xs={24}>
                            <ChartCard
                                title={`SMEs Reached vs Interventions Delivered (${rangeLabel}) — click a month to drill down`}
                                options={reachMonthlyOptions}
                                onExpand={() =>
                                    openExpand(
                                        `SMEs Reached vs Interventions Delivered (${rangeLabel})`,
                                        reachMonthlyOptions
                                    )
                                }
                                empty={!reachMonthlyHasData}
                            />
                        </Col>
                    </Row>

                    <Row gutter={[24, 24]}>
                        <Col xs={24} lg={12}>
                            <ChartCard
                                title={`SMEs Reached by Gender (${reachScopeLabel})`}
                                options={reachGenderOptions}
                                onExpand={() =>
                                    openExpand(
                                        `SMEs Reached by Gender (${reachScopeLabel})`,
                                        reachGenderOptions
                                    )
                                }
                                empty={!reachGenderHasData}
                            />
                        </Col>
                        <Col xs={24} lg={12}>
                            <ChartCard
                                title={`SMEs Reached by Age (Pyramid) (${reachScopeLabel})`}
                                options={reachAgePyramidOptions}
                                onExpand={() =>
                                    openExpand(
                                        `SMEs Reached by Age (Pyramid) (${reachScopeLabel})`,
                                        reachAgePyramidOptions
                                    )
                                }
                                empty={!reachAgePyramid.has}
                            />
                        </Col>

                        <Col xs={24} lg={12}>
                            <ChartCard
                                title={`SMEs Reached by Sector (${reachScopeLabel})`}
                                options={reachSectorOptions}
                                onExpand={() =>
                                    openExpand(
                                        `SMEs Reached by Sector (${reachScopeLabel})`,
                                        reachSectorOptions
                                    )
                                }
                                empty={!reachSectorHasData}
                            />
                        </Col>

                        <Col xs={24} lg={12}>
                            <ChartCard
                                title="Ownership Breakdown (Average %)"
                                options={reachOwnershipOptions}
                                onExpand={() =>
                                    openExpand(
                                        "Ownership Breakdown (Average %)",
                                        reachOwnershipOptions
                                    )
                                }
                                empty={!reachOwnershipHasData}
                            />
                        </Col>

                        <Col xs={24} lg={12}>
                            <ChartCard
                                title="B-BBEE / Education Breakdown"
                                options={reachBeeOptions}
                                onExpand={() =>
                                    openExpand("B-BBEE / Education Breakdown", reachBeeOptions)
                                }
                                empty={!reachBeeHasData}
                            />
                        </Col>

                        <Col xs={24}>
                            <ChartCard
                                title="Locality Distribution"
                                options={reachLocalityOptions}
                                onExpand={() =>
                                    openExpand("Locality Distribution", reachLocalityOptions)
                                }
                                empty={!reachLocalityHasData}
                            />
                        </Col>
                    </Row>
                </>
            )}

            <Modal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={null}
                width={980}
                title={modalTitle}
                destroyOnClose
            >
                <HighchartsReact
                    highcharts={Highcharts}
                    options={{
                        ...modalOptions,
                        chart: { ...(modalOptions.chart || {}), height: 520 },
                    }}
                />
            </Modal>
        </div>
    );
};

export default FunderAnalytics;
