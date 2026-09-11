import React, {
    useEffect,
    useMemo,
    useState,
    useCallback,
    useRef,
} from "react";
import {
    Row,
    Col,
    Button,
    Modal,
    Empty,
    Segmented,
    DatePicker,
    Alert,
    Select,
    Space,
    Typography,
} from "antd";
import {
    BarChartOutlined,
    ExpandOutlined,
    FileProtectOutlined,
    GlobalOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import DrilldownModule from "highcharts/modules/drilldown";
import { Helmet } from "react-helmet";
import {
    collection,
    documentId,
    getDocs,
    query,
    where,
} from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { LoadingOverlay } from "@/components/shared/LoadingOverlay";
import ReachAnalytics from "@/components/reports/ReachAnalytics";
import DeferredLegacyReportPanels from "./DeferredLegacyReportPanels";
import { getCanonicalInterventionStatus } from "@/routes/operations/reports/monitoring/interventionStatus";
import { rollupReportAssignments } from "@/utils/reportGroupAssignments";
import {
    filterReportRecords,
    loadReportVisibilityContext,
} from "@/utils/reportVisibility";
import {
    REPORT_CHART_COLORS,
    REPORT_CHART_PALETTE,
} from "@/components/reports/reportChartTheme";
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration,
} from "@/components/guide-me";
import isBetween from "dayjs/plugin/isBetween";

dayjs.extend(isBetween);

// --- default range
const DEFAULT_RANGE: [Dayjs, Dayjs] = [
    dayjs().startOf("year"),
    dayjs().endOf("year"),
];

if (typeof DrilldownModule === "function") DrilldownModule(Highcharts);

const { RangePicker } = DatePicker;
const { Text } = Typography;

const fiscalQuarterRange = (base = dayjs()): [Dayjs, Dayjs] => {
    const fiscalMonth = (base.month() - 3 + 12) % 12;
    const quarterStartMonth = 3 + Math.floor(fiscalMonth / 3) * 3;
    const start = base.startOf("year").month(quarterStartMonth === 12 ? 0 : quarterStartMonth);
    return [start.startOf("month"), start.add(2, "month").endOf("month")];
};

const fiscalYtdRange = (base = dayjs()): [Dayjs, Dayjs] => {
    const start = base.month() >= 3
        ? base.startOf("year").month(3).startOf("month")
        : base.subtract(1, "year").startOf("year").month(3).startOf("month");
    return [start, base.endOf("day")];
};

// ---------------- utils ----------------
const normalize = (s?: string) => (s || "").toString().trim().toLowerCase();

const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();

    if (typeof v.seconds === "number") {
        const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
        return new Date(ms);
    }
    if (typeof v._seconds === "number") {
        const ms = v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6);
        return new Date(ms);
    }

    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    if (v instanceof Date) return v;

    return null;
};

const fmtMonth = (d: Date) => dayjs(d).format("YYYY-MM");

export function chunk<T>(arr: readonly T[], size = 10): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size) as T[]);
    return out;
}

const firstMapValue = (m: any) =>
    m && typeof m === "object" ? Object.values(m)[0] : m;

const monthLabel = (ym: string) => dayjs(`${ym}-01`).format("MMM YYYY");

const getAgeFromID = (id?: string): number | null => {
    const value = String(id || "").trim();
    if (!/^\d{6}/.test(value)) return null;
    const yy = Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4)) - 1;
    const day = Number(value.slice(4, 6));
    const today = new Date();
    const year = yy <= today.getFullYear() % 100 ? 2000 + yy : 1900 + yy;
    const birthDate = new Date(year, month, day);
    if (Number.isNaN(birthDate.getTime())) return null;
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDelta = today.getMonth() - birthDate.getMonth();
    if (
        monthDelta < 0 ||
        (monthDelta === 0 && today.getDate() < birthDate.getDate())
    )
        age--;
    return age;
};

const AGE_BUCKETS = [
    { label: "15-24", min: 15, max: 24 },
    { label: "25-34", min: 25, max: 34 },
    { label: "35-44", min: 35, max: 44 },
    { label: "45-54", min: 45, max: 54 },
    { label: "55-64", min: 55, max: 64 },
    { label: "65+", min: 65, max: 200 },
];

// ---------------- types ----------------
type AppDoc = {
    id: string;
    participantId?: string;
    branchId?: string;
    programId?: string;
    programName?: string;
    submittedAt?: any;
    applicationStatus?: string;
    gender?: string;
    ageGroup?: string;
    profile?: any;
    departmentId?: string;
    departmentName?: string;
    interventions?: { required?: Array<{ area?: string; departmentId?: string; departmentName?: string }> };
};

type InterventionDefinition = {
    title?: string;
    hasSubInterventions?: boolean;
    subTitlesById: Record<string, string>;
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

type AssignedIntervention = {
    id: string;
    participantId: string;
    createdAt?: any;
    updatedAt?: any;
    acceptedAt?: any;
    completedAt?: any;
    areaOfSupport?: string;
    interventionTitle?: string;
    interventionId?: string;
    subInterventionId?: string;
    subInterventionTitle?: string;
    subInterventionName?: string;
    subIntervention?: string;
    snapshot?: any;
    groupAssignmentId?: string;
    groupId?: string;
    groupKey?: string;
    assignmentStatus?: string;
    status?: string;
    interventionStatus?: string;
    assigneeAcceptanceStatus?: string;
    participantAcceptanceStatus?: string;
    assigneeCompletionStatus?: string;
    participantCompletionStatus?: string;
    beneficiaryCompletionStatus?: string;
    completionStatus?: string;
    departmentId?: string;
    departmentName?: string;
};

type ViewMode = "interventions" | "applications" | "compliance" | "reach";

const INTERVENTION_STATUS_META = {
    assigned: { label: "Assigned", color: REPORT_CHART_COLORS.primary },
    "in-progress": { label: "In Progress", color: "#faad14" },
    completed: { label: "Completed", color: REPORT_CHART_COLORS.success },
    declined: { label: "Declined", color: "#ff4d4f" },
    unknown: { label: "Unknown", color: "#8c8c8c" },
} as const;

// ---------------- component ----------------
const ProjectAdminReports: React.FC = () => {
    const { user } = useFullIdentity();
    const { activeProgramId } = useActiveProgramId();

    const [loading, setLoading] = useState(false);
    const [expandedChart, setExpandedChart] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("interventions");
    const [drilledDepartmentName, setDrilledDepartmentName] = useState<string | null>(null);
    const drilledDepartmentRef = useRef<string | null>(null);
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE);
    const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
    const [applicantScope, setApplicantScope] = useState<"all" | "incubatees">("all");

    // data
    const [apps, setApps] = useState<AppDoc[]>([]);
    const [participantById, setParticipantById] = useState<
        Map<string, ParticipantDoc>
    >(() => new Map());
    const [assigned, setAssigned] = useState<AssignedIntervention[]>([]);
    const [interventionsById, setInterventionsById] = useState<
        Record<string, InterventionDefinition>
    >({});
    const [branchMap, setBranchMap] = useState<Record<string, string>>({});
    const [topError, setTopError] = useState<string | null>(null);

    const assignedBranch = user?.assignedBranch;


    const [deptNames, setDeptNames] = useState<string[]>([]);
    const [reachDepartmentOptions, setReachDepartmentOptions] = useState<
        Array<{ label: string; value: string }>
    >([]);
    const [interventionDepartmentOptions, setInterventionDepartmentOptions] = useState<
        Array<{ label: string; value: string }>
    >([]);

    // 🔁 move from refs → state so component re-renders when data arrives
    const [latestPlanByPid, setLatestPlanByPid] = useState<Map<string, any>>(
        () => new Map()
    );
    const [romConfirmed, setRomConfirmed] = useState<Set<string>>(
        () => new Set()
    );

    // debug flags for logging
    const gapDebugLoggedRef = useRef(false);
    const dpDebugLoggedRef = useRef(false);

    const [gapByApp, setGapByApp] = useState<Record<string, boolean>>({});
    const [preByApp, setPreByApp] = useState<Record<string, boolean>>({});

    // Exclude these departments in DPs
    const EXCLUDED_SUBSTR = ["ihf", "m&e", "stakeholder", "hrm", "rom"];
    const isExcludedDept = (name?: string) =>
        !!name && EXCLUDED_SUBSTR.some((s) => name.toLowerCase().includes(s));

    const hasAgreement = (app: any, slug: string) => {
        const m = app?.signedAgreements || {};
        return Object.keys(m).some((k) => k.toLowerCase() === slug);
    };

    // helpers
    const inRange = useCallback(
        (d?: any) => {
            const dt = toDate(d);
            if (!dt) return false;
            return dayjs(dt).isBetween(dateRange[0], dateRange[1], "day", "[]");
        },
        [dateRange]
    );

    const months = useMemo(() => {
        if (!dateRange || !dateRange[0] || !dateRange[1]) return [];
        const start = dateRange[0].startOf("month");
        const end = dateRange[1].endOf("month");
        const arr: string[] = [];
        let cur = start.clone();
        while (cur.isBefore(end) || cur.isSame(end, "month")) {
            arr.push(cur.format("YYYY-MM"));
            cur = cur.add(1, "month");
        }
        return arr;
    }, [dateRange]);

    useEffect(() => {
        drilledDepartmentRef.current = null;
        setDrilledDepartmentName(null);
    }, [dateRange, selectedDepartment]);

    // -------- branch names (branchMap) ----------
    useEffect(() => {
        (async () => {
            try {
                const snap = await getDocs(
                    query(
                        collection(db, "branches")
                    )
                );
                const map: Record<string, string> = {};
                snap.docs.forEach((d) => {
                    const data = d.data() as any;
                    map[d.id] = (data.name || data.branchName || d.id) as string;
                });
                setBranchMap(map);
            } catch (e) {
                console.error("[Reports] failed to load branches", e);
            }
        })();
    }, []);

    // Intervention definitions supply the canonical title and sub-intervention
    // labels for older assignment records that only store IDs.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const snap = await getDocs(
                    query(collection(db, "interventions"))
                );
                if (cancelled) return;

                const byId: Record<string, InterventionDefinition> = {};
                snap.docs.forEach((doc) => {
                    const data = doc.data() as any;
                    const subInterventions = (Array.isArray(data.subInterventions)
                        ? data.subInterventions
                        : []).filter((item: any) => item?.active !== false && !item?.archivedAt);
                    const definition = {
                        title: data.interventionTitle || data.title || data.name || doc.id,
                        hasSubInterventions: subInterventions.length > 0,
                        subTitlesById: Object.fromEntries(
                            subInterventions
                                .map((item: any) => {
                                    const id = String(item.subId || item.id || "").trim();
                                    const title = String(item.title || item.name || id).trim();
                                    return [id, title];
                                })
                                .filter(([id]) => !!id)
                        ),
                    };
                    byId[doc.id] = definition;
                    if (data.interventionId) byId[String(data.interventionId)] = definition;
                });
                setInterventionsById(byId);
            } catch (error) {
                console.error("[Reports] failed to load intervention definitions", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // -------- departments (once per company) ----------
    useEffect(() => {
        (async () => {
            try {
                const qs = await getDocs(
                    query(
                        collection(db, "departments"),
                    )
                );
                const options = qs.docs
                    .map((d) => ({
                        value: d.id,
                        label: String((d.data() as any).name || (d.data() as any).departmentName || d.id).trim(),
                        interventionsDepartment: (d.data() as any).interventionsDepartment === true,
                    }))
                    .filter((option) => option.label && !isExcludedDept(option.label));
                setDeptNames(options.map((option) => option.label));
                setReachDepartmentOptions(options.map(({ label, value }) => ({ label, value })));
                setInterventionDepartmentOptions(
                    options
                        .filter((option) => option.interventionsDepartment)
                        .map(({ label, value }) => ({ label, value }))
                );
            } catch (e) {
                console.error("[Reports] failed to load departments", e);
            }
        })();
    }, []);

    // -------- applications, participants, assignedInterventions, agreements ----------
    useEffect(() => {
        if (!assignedBranch) return;
        setTopError(null);

        let cancelled = false;
        gapDebugLoggedRef.current = false;
        dpDebugLoggedRef.current = false;
        (async () => {
            try {
                setLoading(true);

                const appsQ = activeProgramId
                    ? query(
                        collection(db, "applications"),
                        where("branchId", "==", assignedBranch),
                        where("programId", "==", activeProgramId)
                    )
                    : query(
                        collection(db, "applications"),
                        where("branchId", "==", assignedBranch)
                    );

                const appsSnap = await getDocs(appsQ);
                if (cancelled) return;

                const visibility = await loadReportVisibilityContext(user?.email);
                if (cancelled) return;
                const _apps = filterReportRecords(
                    appsSnap.docs.map((d) => ({
                        id: d.id,
                        ...(d.data() as any),
                    })) as AppDoc[],
                    user?.email,
                    visibility
                );
                setApps(_apps);

                const pids = Array.from(
                    new Set(_apps.map((a) => a.participantId).filter(Boolean) as string[])
                );

                const partMap = new Map<string, ParticipantDoc>();
                for (const ids of chunk(pids, 10)) {
                    if (!ids.length) continue;
                    const snap = await getDocs(
                        query(
                            collection(db, "participants"),
                            where(documentId(), "in", ids)
                        )
                    );
                    if (cancelled) return;
                    snap.docs.forEach((d) =>
                        partMap.set(d.id, { id: d.id, ...(d.data() as any) })
                    );
                }
                setParticipantById(partMap);

                const assignedRows: AssignedIntervention[] = [];
                for (const ids of chunk(pids, 10)) {
                    if (!ids.length) continue;
                    const snap = await getDocs(
                        query(
                            collection(db, "assignedInterventions"),
                            where("participantId", "in", ids)
                        )
                    );
                    if (cancelled) return;
                    assignedRows.push(
                        ...snap.docs.map((d) => ({
                            id: d.id,
                            ...(d.data() as Omit<AssignedIntervention, "id">),
                        }))
                    );
                }
                setAssigned(
                    filterReportRecords(assignedRows, user?.email, visibility) as AssignedIntervention[]
                );

                const onboarded = _apps.filter(
                    (a) => normalize(a.applicationStatus) === "accepted"
                );
                const gapByAppObj: Record<string, boolean> = {};
                const preByAppObj: Record<string, boolean> = {};
                for (const a of onboarded) {
                    gapByAppObj[a.id] = hasAgreement(a, "gap-analysis");
                    preByAppObj[a.id] = hasAgreement(a, "pre-incubation-contract");
                }
                setGapByApp(gapByAppObj);
                setPreByApp(preByAppObj);
            } catch (e) {
                console.error(e);
                if (!cancelled) setTopError("Failed to load analytics data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [assignedBranch, activeProgramId, user?.email]);

    // -------- GAP + Diagnostic Plans (ROM + manual) ----------
    useEffect(() => {
        let cancelled = false;
        gapDebugLoggedRef.current = false;
        dpDebugLoggedRef.current = false;
        (async () => {
            const acceptedApps = apps.filter(
                (a) => normalize(a.applicationStatus) === "accepted"
            );

            const pids = Array.from(
                new Set(
                    acceptedApps
                        .map((a) => a.participantId)
                        .filter(Boolean)
                        .map(String)
                )
            );

            console.log("[DP DEBUG] total apps:", apps.length);
            console.log(
                "[DP DEBUG] acceptedApps:",
                acceptedApps.map((a) => ({
                    id: a.id,
                    participantId: a.participantId,
                    manuallyCreated: (a as any).manuallyCreated,
                    submittedAt: a.submittedAt,
                }))
            );
            console.log("[DP DEBUG] accepted participantIds:", pids);

            if (!pids.length) {
                console.log("[DP DEBUG] no accepted participantIds found");
                if (!cancelled) {
                    setLatestPlanByPid(new Map());
                    setRomConfirmed(new Set());
                }
                return;
            }

            const manualPids = new Set<string>();
            acceptedApps.forEach((a) => {
                const isManual =
                    (a as any).manuallyCreated === true


                if (isManual && a.participantId) {
                    manualPids.add(String(a.participantId));
                }
            });

            console.log(
                "[DP DEBUG] manualPids from acceptedApps:",
                Array.from(manualPids)
            );

            const romConf = new Set<string>();
            for (const ids of chunk(pids, 10)) {
                if (!ids.length) continue;
                const gs = await getDocs(
                    query(
                        collection(db, "gapAnalysis"),
                        where("participantId", "in", ids)
                    )
                );
                if (cancelled) return;
                gs.forEach((s) => {
                    const g: any = s.data();
                    const st = String(g?.romReview?.status || g?.confirmationStatus || "")
                        .toLowerCase()
                        .trim();
                    if (st === "confirmed" && g?.participantId) {
                        romConf.add(String(g.participantId));
                    }
                });
            }

            console.log(
                "[DP DEBUG] romConfirmed participants from gapAnalysis:",
                Array.from(romConf)
            );

            const planPids = Array.from(
                new Set<string>([...Array.from(romConf), ...Array.from(manualPids)])
            );

            console.log(
                "[DP DEBUG] planPids for diagnosticPlans (ROM + manual):",
                planPids
            );

            if (!planPids.length) {
                console.log("[DP DEBUG] no planPids; clearing latestPlanByPid");
                if (!cancelled) {
                    setLatestPlanByPid(new Map());
                    setRomConfirmed(romConf);
                }
                return;
            }

            const latest = new Map<string, any>();
            const toMillisInner = (v: any) =>
                v?.toMillis?.() ??
                (v?._seconds
                    ? v._seconds * 1000
                    : v instanceof Date
                        ? v.getTime()
                        : Number(v) || 0);

            for (const ids of chunk(planPids, 10)) {
                if (!ids.length) continue;
                const ds = await getDocs(
                    query(
                        collection(db, "diagnosticPlans"),
                        where("participantId", "in", ids)
                    )
                );
                if (cancelled) return;

                ds.forEach((s) => {
                    const d: any = s.data();
                    const pid = String(d?.participantId || "");
                    const prev = latest.get(pid);
                    if (
                        !prev ||
                        toMillisInner(d?.createdAt) > toMillisInner(prev?.createdAt)
                    ) {
                        latest.set(pid, d);
                    }
                });
            }

            console.log(
                "[DP DEBUG] latestPlanByPid size (diagnosticPlans loaded):",
                latest.size
            );

            if (!cancelled) {
                setLatestPlanByPid(latest);
                setRomConfirmed(romConf);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [apps]);

    // -------- scoped subsets ----------
    const matchesDepartment = useCallback(
        (record: { departmentId?: string; departmentName?: string; areaOfSupport?: string }) => {
            if (selectedDepartment === "all") return true;
            return normalize(record.departmentId) === normalize(selectedDepartment)
                || normalize(record.departmentName) === normalize(selectedDepartment)
                || normalize(record.areaOfSupport) === normalize(selectedDepartment);
        },
        [selectedDepartment]
    );

    const appsInRange = useMemo(
        () => apps.filter((a) => inRange(a.submittedAt) && matchesDepartment(a)),
        [apps, inRange, matchesDepartment]
    );

    // Applicant reporting deliberately has its own audience scope. It must not
    // inherit the intervention/compliance department filter.
    const applicantsInRange = useMemo(
        () =>
            apps
                .filter((app) => inRange(app.submittedAt))
                .filter(
                    (app) =>
                        applicantScope === "all" ||
                        normalize(app.applicationStatus) === "accepted"
                ),
        [applicantScope, apps, inRange]
    );

    const onboardedAppsInRange = useMemo(
        () =>
            appsInRange.filter((a) => normalize(a.applicationStatus) === "accepted"),
        [appsInRange]
    );

    const assignedInRange = useMemo(
        () =>
            assigned.filter((r) => (inRange(r.createdAt) || inRange(r.completedAt)) && matchesDepartment(r)),
        [assigned, inRange, matchesDepartment]
    );

    const reportAssignmentRollups = useMemo(
        () => rollupReportAssignments(assigned, getCanonicalInterventionStatus),
        [assigned]
    );

    const departmentSnapshots = useMemo(() => {
        const byDepartment = new Map<
            string,
            { department: string; required: number; assigned: number; active: number; completed: number }
        >();
        const departmentLabel = (record: {
            departmentId?: string;
            departmentName?: string;
            areaOfSupport?: string;
            area?: string;
        }) => {
            const id = String(record.departmentId || "");
            return (
                reachDepartmentOptions.find((option) => option.value === id)?.label ||
                record.departmentName ||
                record.areaOfSupport ||
                record.area ||
                "Other"
            );
        };
        const ensure = (department: string) => {
            if (!byDepartment.has(department)) {
                byDepartment.set(department, {
                    department,
                    required: 0,
                    assigned: 0,
                    active: 0,
                    completed: 0,
                });
            }
            return byDepartment.get(department)!;
        };
        const isInterventionDepartment = (record: {
            departmentId?: string;
            departmentName?: string;
            areaOfSupport?: string;
            area?: string;
        }) => {
            const id = normalize(record.departmentId);
            const name = normalize(
                record.departmentName || record.areaOfSupport || record.area
            );
            return interventionDepartmentOptions.some(
                (department) =>
                    normalize(department.value) === id || normalize(department.label) === name
            );
        };

        // Required interventions come from the accepted application plan. They are
        // intentionally not inferred from assignment rows, which can be incomplete.
        apps
            .filter(
                (app) => normalize(app.applicationStatus) === "accepted"
            )
            .forEach((app) => {
                const required = Array.isArray(app.interventions?.required)
                    ? app.interventions!.required!
                    : [];
                required.forEach((item) => {
                    if (!isInterventionDepartment(item)) return;
                    if (!matchesDepartment({
                        departmentId: item.departmentId,
                        departmentName: item.departmentName,
                        areaOfSupport: item.area,
                    })) return;
                    ensure(departmentLabel(item)).required += 1;
                });
            });

        reportAssignmentRollups
            .filter(
                ({ record, members }) =>
                    matchesDepartment(record) &&
                    members.some((member) => inRange(member.createdAt) || inRange(member.completedAt))
            )
            .forEach(({ record, status }) => {
                if (!isInterventionDepartment(record)) return;
                const snapshot = ensure(departmentLabel(record));
                snapshot.assigned += 1;
                if (status === "completed") snapshot.completed += 1;
                if (status === "in-progress") snapshot.active += 1;
            });

        return Array.from(byDepartment.values()).sort(
            (a, b) => b.required - a.required || b.assigned - a.assigned || a.department.localeCompare(b.department)
        );
    }, [
        apps,
        inRange,
        interventionDepartmentOptions,
        matchesDepartment,
        reachDepartmentOptions,
        reportAssignmentRollups,
    ]);

    // -------- participantsWithGap ----------
    const participantsWithGap = useMemo(() => {
        const set = new Set<string>();

        const manualPidsInRange = new Set<string>();

        onboardedAppsInRange.forEach((a) => {
            if (!a.participantId) return;
            const pid = String(a.participantId);

            const isManual =
                (a as any).manuallyCreated === true

            if (isManual) {
                manualPidsInRange.add(pid);
                set.add(pid);
                return;
            }

            if (romConfirmed.has(pid)) {
                set.add(pid);
            }
        });

        if (!gapDebugLoggedRef.current) {
            gapDebugLoggedRef.current = true;
            console.log("=== [DP DEBUG] participantsWithGap snapshot ===");
            console.log(
                "[DP DEBUG] onboardedAppsInRange (accepted in dateRange):",
                onboardedAppsInRange.map((a) => ({
                    id: a.id,
                    participantId: a.participantId,
                    manuallyCreated: (a as any).manuallyCreated,
                    submittedAt: a.submittedAt,
                }))
            );
            console.log(
                "[DP DEBUG] manualPidsInRange (manual + in dateRange):",
                Array.from(manualPidsInRange)
            );
            console.log(
                "[DP DEBUG] romConfirmed (from gapAnalysis, any date):",
                Array.from(romConfirmed)
            );
            console.log("[DP DEBUG] participantsWithGap final set:", Array.from(set));
            console.log(
                "[DP DEBUG] participantsWithGap size (totalNeeded basis):",
                set.size
            );
        }

        return set;
    }, [onboardedAppsInRange, romConfirmed]);

    // -------- DPs Needed vs Confirmed ----------
    const paDPModel = useMemo(() => {
        const latest = latestPlanByPid;

        const confirmedByDept = new Map<string, Set<string>>();

        const norm = (s: string) =>
            s
                .toLowerCase()
                .replace(/\(.*?\)|and|&/gi, "")
                .trim();

        latest.forEach((plan, pidRaw) => {
            const pid = String(pidRaw);

            if (!participantsWithGap.has(pid)) return;

            const conf = (plan?.confirmed || {}) as Record<string, boolean>;

            Object.entries(conf).forEach(([k, v]) => {
                if (!v) return;

                const nk = norm(k);

                const match = deptNames.find(
                    (d) =>
                        !isExcludedDept(d) && (norm(d).includes(nk) || nk.includes(norm(d)))
                );

                if (!match) return;

                const set = confirmedByDept.get(match) || new Set<string>();
                set.add(pid);
                confirmedByDept.set(match, set);
            });
        });

        const cats = deptNames
            .filter((d) => !isExcludedDept(d))
            .filter((d) => selectedDepartment === "all" || normalize(d) === normalize(selectedDepartment))
            .filter(Boolean)
            .sort();

        const totalNeeded = participantsWithGap.size;

        const needed: number[] = [];
        const confirmed: number[] = [];

        cats.forEach((dept) => {
            const confSet = confirmedByDept.get(dept) || new Set<string>();
            needed.push(totalNeeded);
            confirmed.push(confSet.size);
        });

        if (!dpDebugLoggedRef.current) {
            dpDebugLoggedRef.current = true;
            console.log("=== [DP DEBUG] paDPModel snapshot ===");
            console.log("[DP DEBUG] categories (departments):", cats);
            console.log(
                "[DP DEBUG] Needed per dept (should all equal participantsWithGap.size):",
                needed
            );
            console.log("[DP DEBUG] Confirmed per dept:", confirmed);
        }

        return { cats, needed, confirmed };
    }, [deptNames, participantsWithGap, latestPlanByPid, selectedDepartment]);

    const paDPHasData =
        paDPModel.cats.length &&
        (paDPModel.needed.some((v) => v > 0) ||
            paDPModel.confirmed.some((v) => v > 0));

    const paDPOptions: Highcharts.Options = {
        chart: { type: "bar", height: 380 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: { categories: paDPModel.cats },
        yAxis: { min: 0, allowDecimals: false, title: { text: "Participants" } },
        legend: { reversed: false },
        tooltip: { shared: true },
        plotOptions: { bar: { dataLabels: { enabled: true }, borderRadius: 4 } },
        series: [
            { type: "bar", name: "Confirmed", data: paDPModel.confirmed },
            { type: "bar", name: "Needed", data: paDPModel.needed },
        ],
    };

    // -------- Onboarded vs Signed docs ----------
    const onboardedVsSigned = useMemo(() => {
        const onboardedMap: Record<string, number> = {};
        const gapMap: Record<string, number> = {};
        const preMap: Record<string, number> = {};

        const monthsKeys = months.length
            ? months
            : Array.from(
                new Set(
                    onboardedAppsInRange
                        .map((a) => toDate(a.submittedAt))
                        .filter(Boolean)
                        .map((d) => fmtMonth(d as Date))
                )
            ).sort();

        onboardedAppsInRange.forEach((a) => {
            const d = toDate(a.submittedAt);
            if (!d) return;
            const k = fmtMonth(d);
            onboardedMap[k] = (onboardedMap[k] || 0) + 1;
            if (gapByApp[a.id]) gapMap[k] = (gapMap[k] || 0) + 1;
            if (preByApp[a.id]) preMap[k] = (preMap[k] || 0) + 1;
        });

        return {
            categories: monthsKeys.map(monthLabel),
            onboarded: monthsKeys.map((m) => onboardedMap[m] || 0),
            gapSigned: monthsKeys.map((m) => gapMap[m] || 0),
            preSigned: monthsKeys.map((m) => preMap[m] || 0),
        };
    }, [months, onboardedAppsInRange, gapByApp, preByApp]);

    const onboardedVsSignedHasData =
        onboardedVsSigned.onboarded.some((v) => v > 0) ||
        onboardedVsSigned.gapSigned.some((v) => v > 0) ||
        onboardedVsSigned.preSigned.some((v) => v > 0);

    const onboardedVsSignedOptions: Highcharts.Options = {
        chart: { type: "column", height: 340 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: { categories: onboardedVsSigned.categories },
        yAxis: { min: 0, allowDecimals: false, title: { text: "Count" } },
        plotOptions: { column: { borderRadius: 4, dataLabels: { enabled: true } } },
        series: [
            { type: "column", name: "Onboarded", data: onboardedVsSigned.onboarded },
            { type: "column", name: "GAP Signed", data: onboardedVsSigned.gapSigned },
            {
                type: "column",
                name: "Pre-Incubation Signed",
                data: onboardedVsSigned.preSigned,
            },
        ],
    };

    // -------- Outstanding Docs pie ----------
    const outstandingPieData = useMemo(() => {
        const onboardedTotal = onboardedAppsInRange.length;
        const gapSignedTotal = onboardedAppsInRange.reduce(
            (s, a) => s + (gapByApp[a.id] ? 1 : 0),
            0
        );
        const preSignedTotal = onboardedAppsInRange.reduce(
            (s, a) => s + (preByApp[a.id] ? 1 : 0),
            0
        );
        return [
            {
                name: "GAP Analysis Pending",
                y: Math.max(0, onboardedTotal - gapSignedTotal),
            },
            {
                name: "Pre-Incubation Pending",
                y: Math.max(0, onboardedTotal - preSignedTotal),
            },
        ];
    }, [onboardedAppsInRange, gapByApp, preByApp]);

    const outstandingPieHasData = outstandingPieData.some((p) => p.y > 0);

    const outstandingDocsPieOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: "55%",
                dataLabels: { enabled: true, format: "{point.name}: {point.y}" },
            },
        },
        series: [{ type: "pie", name: "Outstanding", data: outstandingPieData }],
    };

    // -------- Interventions Breakdown ----------
    const breakdown = useMemo(() => {
        const perDept: Record<string, typeof reportAssignmentRollups> = {};
        reportAssignmentRollups
            .filter(({ record, members }) =>
                matchesDepartment(record) &&
                members.some((member) => inRange(member.createdAt) || inRange(member.completedAt))
            )
            .forEach((rollup) => {
                const r = rollup.record;
                const dept = r.departmentName || r.areaOfSupport || "Other";
                if (!perDept[dept]) perDept[dept] = [];
                perDept[dept].push(rollup);
            });

        const topData: Highcharts.PointOptionsObject[] = [];
        const drillSeries: Highcharts.DrilldownSeriesOptions[] = [];

        Object.entries(perDept).forEach(([dept, rows]) => {
            const perStatus: Record<string, typeof reportAssignmentRollups> = {};
            rows.forEach((rollup) => {
                const st = rollup.status;
                if (!perStatus[st]) perStatus[st] = [];
                perStatus[st].push(rollup);
            });

            topData.push({
                name: dept,
                y: rows.length,
                drilldown: `dept:${dept}`,
                color: REPORT_CHART_COLORS.primary,
            });

            const statusPoints: Highcharts.PointOptionsObject[] = [];
            Object.entries(perStatus).forEach(([st, srows]) => {
                const id = `dept:${dept}::status:${st}`;
                const status = INTERVENTION_STATUS_META[
                    st as keyof typeof INTERVENTION_STATUS_META
                ];
                statusPoints.push({
                    name: status.label,
                    y: srows.length,
                    drilldown: id,
                    color: status.color,
                });

                const perTitle: Record<
                    string,
                    { count: number; subInterventions: Record<string, number> }
                > = {};
                srows.forEach((rollup) => {
                    const r = rollup.record;
                    const definition = interventionsById[r.interventionId || ""];
                    const t = definition?.title || r.interventionTitle || "Untitled";
                    if (!perTitle[t]) {
                        perTitle[t] = { count: 0, subInterventions: {} };
                    }
                    perTitle[t].count += 1;

                    const subTitle = String(
                        r.subInterventionTitle ||
                        r.subInterventionName ||
                        r.subIntervention ||
                        r.snapshot?.selectedSubIntervention?.title ||
                        definition?.subTitlesById[String(r.subInterventionId || "")] ||
                        ""
                    ).trim();
                    if (subTitle && (definition?.hasSubInterventions || !!r.subInterventionId)) {
                        perTitle[t].subInterventions[subTitle] =
                            (perTitle[t].subInterventions[subTitle] || 0) + 1;
                    }
                });

                const interventionPoints: Highcharts.PointOptionsObject[] = [];
                Object.entries(perTitle).forEach(([title, intervention]) => {
                    const subEntries = Object.entries(intervention.subInterventions);
                    const interventionDrilldownId =
                        subEntries.length > 0
                            ? `${id}::intervention:${encodeURIComponent(title)}`
                            : undefined;

                    interventionPoints.push({
                        name: title,
                        y: intervention.count,
                        drilldown: interventionDrilldownId,
                    });

                    if (interventionDrilldownId) {
                        drillSeries.push({
                            id: interventionDrilldownId,
                            name: `${title} • Sub-interventions`,
                            type: "column",
                            color: status.color,
                            data: subEntries.map(([subTitle, count]) => [subTitle, count]),
                        });
                    }
                });
                drillSeries.push({
                    id,
                    name: status.label,
                    type: "column",
                    color: status.color,
                    data: interventionPoints,
                });
            });

            drillSeries.push({
                id: `dept:${dept}`,
                name: `${dept} — by Status`,
                type: "column",
                data: statusPoints,
            });
        });

        return { topData, drillSeries };
    }, [inRange, interventionsById, matchesDepartment, reportAssignmentRollups]);

    const breakdownHasData = breakdown.topData.some((p) => (p as any).y > 0);
    const snapshotHasData = departmentSnapshots.some(
        (item) => item.required > 0 || item.assigned > 0
    );

    const breakdownOptions: Highcharts.Options = {
        chart: {
            type: "column",
            height: 360,
            events: {
                drilldown(event: any) {
                    const point = event.point as Highcharts.Point & { options?: { drilldown?: string; name?: string } };
                    const drilldownId = String(point.options?.drilldown || "");
                    if (drilldownId.startsWith("dept:") && !drilldownId.includes("::status:")) {
                        drilledDepartmentRef.current = String(point.name || point.options?.name || "");
                    }
                },
                drillupall() {
                    drilledDepartmentRef.current = null;
                },
            } as any,
        },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: { type: "category" },
        yAxis: { min: 0, title: { text: "Interventions" } },
        legend: { enabled: false },
        plotOptions: {
            series: {
                borderWidth: 0,
                dataLabels: { enabled: true, format: "{point.y}" },
            },
        },
        series: [
            {
                type: "column",
                name: "Department",
                color: REPORT_CHART_COLORS.primary,
                data: breakdown.topData,
            },
        ],
        drilldown: { series: breakdown.drillSeries },
    };

    const selectedDepartmentBreakdownOptions = useMemo<Highcharts.Options | null>(() => {
        if (!drilledDepartmentName) return null;
        const rootId = `dept:${drilledDepartmentName}`;
        const rootSeries = breakdown.drillSeries.find((series: any) => series.id === rootId);
        if (!rootSeries) return null;

        return {
            chart: {
                type: "column",
                height: 360,
                events: {
                    drillupall() {
                        drilledDepartmentRef.current = null;
                        setDrilledDepartmentName(null);
                    },
                } as any,
            },
            title: { text: `${drilledDepartmentName} intervention status` },
            credits: { enabled: false },
            xAxis: { type: "category" },
            yAxis: { min: 0, allowDecimals: false, title: { text: "Unique interventions" } },
            legend: { enabled: false },
            plotOptions: {
                series: {
                    borderWidth: 0,
                    dataLabels: { enabled: true, format: "{point.y}" },
                },
            },
            series: [rootSeries as Highcharts.SeriesOptionsType],
            drilldown: { series: breakdown.drillSeries as any },
        };
    }, [breakdown.drillSeries, drilledDepartmentName]);

    const interventionTimeSeries = useMemo(() => {
        const buckets = new Map(
            months.map((key) => [
                key,
                {
                    assigned: new Set<string>(),
                    completed: new Set<string>(),
                    inProgress: new Set<string>(),
                },
            ])
        );

        const addToBucket = (
            value: unknown,
            metric: "assigned" | "completed" | "inProgress",
            recordId: string
        ) => {
            const date = toDate(value);
            if (!date || !inRange(date)) return;
            const bucket = buckets.get(fmtMonth(date));
            if (bucket) bucket[metric].add(recordId);
        };

        reportAssignmentRollups.filter(({ record, members }) => {
            if (!matchesDepartment(record)) return false;
            const isInterventionDepartment = interventionDepartmentOptions.some(
                (department) =>
                    normalize(department.value) === normalize(record.departmentId) ||
                    normalize(department.label) ===
                    normalize(record.departmentName || record.areaOfSupport)
            );
            if (!isInterventionDepartment) return false;
            if (!drilledDepartmentName) return true;
            return normalize(record.departmentName || record.areaOfSupport) === normalize(drilledDepartmentName) && members.length > 0;
        }).forEach((rollup) => {
            const recordId = rollup.key;
            const status = rollup.status;
            const assignedDate = rollup.members
                .map((member) => toDate(member.createdAt || member.acceptedAt || member.updatedAt))
                .filter((date): date is Date => !!date)
                .sort((a, b) => a.getTime() - b.getTime())[0];
            const completedDate = rollup.members
                .map((member) => toDate(member.completedAt || member.updatedAt || member.createdAt))
                .filter((date): date is Date => !!date)
                .sort((a, b) => b.getTime() - a.getTime())[0];

            addToBucket(assignedDate, "assigned", recordId);
            if (status === "completed") {
                addToBucket(
                    completedDate || assignedDate,
                    "completed",
                    recordId
                );
            } else if (status === "in-progress") {
                addToBucket(assignedDate, "inProgress", recordId);
            }
        });

        const keys = months.length ? months : Array.from(buckets.keys()).sort();
        return {
            categories: keys.map(monthLabel),
            assigned: keys.map((key) => buckets.get(key)?.assigned.size || 0),
            completed: keys.map((key) => buckets.get(key)?.completed.size || 0),
            inProgress: keys.map((key) => buckets.get(key)?.inProgress.size || 0),
        };
    }, [
        drilledDepartmentName,
        inRange,
        interventionDepartmentOptions,
        matchesDepartment,
        months,
        reportAssignmentRollups,
    ]);

    const interventionTimeSeriesHasData =
        interventionTimeSeries.assigned.some((value) => value > 0) ||
        interventionTimeSeries.completed.some((value) => value > 0) ||
        interventionTimeSeries.inProgress.some((value) => value > 0);

    const interventionTimeSeriesOptions: Highcharts.Options = {
        chart: { type: "column", height: 360 },
        title: { text: "Intervention activity over time" },
        subtitle: {
            text:
                drilledDepartmentName ||
                (selectedDepartment === "all"
                    ? "All departments"
                    : reachDepartmentOptions.find((option) => option.value === selectedDepartment)
                        ?.label || "Selected department"),
        },
        credits: { enabled: false },
        xAxis: { categories: interventionTimeSeries.categories },
        yAxis: { min: 0, allowDecimals: false, title: { text: "Unique interventions" } },
        tooltip: { shared: true },
        plotOptions: {
            column: { borderRadius: 4, dataLabels: { enabled: true } },
            spline: { marker: { enabled: true, radius: 3 }, dataLabels: { enabled: true } },
        },
        series: [
            {
                type: "spline",
                name: "Assigned",
                data: interventionTimeSeries.assigned,
                color: INTERVENTION_STATUS_META.assigned.color,
                zIndex: 3,
            },
            {
                type: "column",
                name: "Completed",
                data: interventionTimeSeries.completed,
                color: INTERVENTION_STATUS_META.completed.color,
            },
            {
                type: "column",
                name: "In Progress",
                data: interventionTimeSeries.inProgress,
                color: INTERVENTION_STATUS_META["in-progress"].color,
            },
        ],
    };

    // -------- Applications segment ----------
    const appsSubmittedVsAccepted = useMemo(() => {
        const subMap: Record<string, number> = {};
        const accMap: Record<string, number> = {};

        applicantsInRange.forEach((a) => {
            const d = toDate(a.submittedAt);
            if (!d) return;
            const k = fmtMonth(d);
            subMap[k] = (subMap[k] || 0) + 1;
            if (normalize(a.applicationStatus) === "accepted")
                accMap[k] = (accMap[k] || 0) + 1;
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
    }, [applicantsInRange, months]);

    const appsSubmittedVsAcceptedHasData =
        appsSubmittedVsAccepted.submitted.some((v) => v > 0) ||
        appsSubmittedVsAccepted.accepted.some((v) => v > 0);

    const appsSubmittedVsAcceptedOptions: Highcharts.Options = {
        chart: { type: "column", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: { categories: appsSubmittedVsAccepted.categories },
        yAxis: { min: 0, title: { text: "Applications" } },
        plotOptions: { column: { borderRadius: 4, dataLabels: { enabled: true } } },
        series:
            applicantScope === "incubatees"
                ? [
                    {
                        type: "column",
                        name: "Incubatees (Accepted)",
                        color: REPORT_CHART_COLORS.success,
                        data: appsSubmittedVsAccepted.accepted,
                    },
                ]
                : [
                    {
                        type: "column",
                        name: "Submitted",
                        color: REPORT_CHART_COLORS.primary,
                        data: appsSubmittedVsAccepted.submitted,
                    },
                    {
                        type: "column",
                        name: "Accepted",
                        color: REPORT_CHART_COLORS.success,
                        data: appsSubmittedVsAccepted.accepted,
                    },
                ],
    };

    const appGenderCounts = useMemo(() => {
        const m: Record<string, number> = {};
        applicantsInRange.forEach((a) => {
            const g = a.gender || "Unknown";
            m[g] = (m[g] || 0) + 1;
        });
        return m;
    }, [applicantsInRange]);

    const appGenderHasData = Object.values(appGenderCounts).some((v) => v > 0);

    const appGenderOptions: Highcharts.Options = {
        chart: { type: "pie", height: 300 },
        title: { text: "" },
        credits: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: "60%",
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
                data: Object.entries(appGenderCounts).map(([name, y], index) => ({
                    name,
                    y,
                    color: REPORT_CHART_PALETTE[index % REPORT_CHART_PALETTE.length],
                })),
            },
        ],
    };

    const appAgePyramid = useMemo(() => {
        const people = applicantsInRange
            .map((app) =>
                app.participantId ? participantById.get(app.participantId) : undefined
            )
            .filter(Boolean) as ParticipantDoc[];
        const count = (gender: string, bucket: (typeof AGE_BUCKETS)[number]) =>
            people.filter((person) => {
                const age = getAgeFromID(person.idNumber);
                return (
                    age != null &&
                    age >= bucket.min &&
                    age <= bucket.max &&
                    normalize(person.gender) === gender
                );
            }).length;
        return {
            male: AGE_BUCKETS.map((bucket) => count("male", bucket)),
            female: AGE_BUCKETS.map((bucket) => count("female", bucket)),
        };
    }, [applicantsInRange, participantById]);

    const appAgeHasData =
        appAgePyramid.male.some((v) => v > 0) ||
        appAgePyramid.female.some((v) => v > 0);

    const appAgeOptions: Highcharts.Options = {
        chart: { type: "bar", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: [
            {
                categories: AGE_BUCKETS.map((bucket) => bucket.label),
                reversed: false,
            },
            {
                categories: AGE_BUCKETS.map((bucket) => bucket.label),
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
                data: appAgePyramid.male.map((value) => -value),
            },
            {
                type: "bar",
                name: "Female",
                color: REPORT_CHART_COLORS.success,
                data: appAgePyramid.female,
            },
        ],
    };

    const appSectorCounts = useMemo(() => {
        const m: Record<string, number> = {};
        applicantsInRange.forEach((a) => {
            const p = a.participantId
                ? participantById.get(a.participantId)
                : undefined;
            const s = (p?.sector || "Unknown") as string;
            m[s] = (m[s] || 0) + 1;
        });
        return m;
    }, [applicantsInRange, participantById]);

    const appSectorHasData = Object.values(appSectorCounts).some((v) => v > 0);

    const appSectorOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: "60%",
                showInLegend: true,
                dataLabels: { enabled: true, format: "{point.name}: {point.y}" },
            },
        },
        series: [
            {
                type: "pie",
                name: "Applications",
                data: Object.entries(appSectorCounts).map(([name, y], index) => ({
                    name,
                    y,
                    color: REPORT_CHART_PALETTE[index % REPORT_CHART_PALETTE.length],
                })),
            },
        ],
    };

    const ownershipAverages = useMemo(() => {
        let y = 0,
            b = 0,
            f = 0,
            n = 0;
        applicantsInRange.forEach((a) => {
            const p = a.participantId
                ? participantById.get(a.participantId)
                : undefined;
            y += Number(p?.youthOwnedPercent) || 0;
            b += Number(p?.blackOwnedPercent) || 0;
            f += Number(p?.femaleOwnedPercent) || 0;
            n++;
        });
        return n
            ? {
                youth: +(y / n).toFixed(1),
                black: +(b / n).toFixed(1),
                female: +(f / n).toFixed(1),
            }
            : { youth: 0, black: 0, female: 0 };
    }, [applicantsInRange, participantById]);

    const ownershipHasData =
        ownershipAverages.youth +
        ownershipAverages.black +
        ownershipAverages.female >
        0;

    const ownershipOptions: Highcharts.Options = {
        chart: { type: "column", height: 300 },
        title: { text: "" },
        credits: { enabled: false },
        xAxis: { categories: ["Youth", "Black", "Female"] },
        yAxis: { min: 0, max: 100, title: { text: "Percent" } },
        plotOptions: {
            column: { dataLabels: { enabled: true, format: "{point.y}%" } },
        },
        series: [
            {
                type: "column",
                name: "Average %",
                color: REPORT_CHART_COLORS.primary,
                data: [
                    ownershipAverages.youth,
                    ownershipAverages.black,
                    ownershipAverages.female,
                ],
            },
        ],
    };

    const beeCounts = useMemo(() => {
        const m: Record<string, number> = {};
        applicantsInRange.forEach((a) => {
            const p = a.participantId
                ? participantById.get(a.participantId)
                : undefined;
            const v = (p?.beeLevel || "Unknown") as string;
            m[v] = (m[v] || 0) + 1;
        });
        return m;
    }, [applicantsInRange, participantById]);

    const beeHasData = Object.values(beeCounts).some((v) => v > 0);

    const beeOptions: Highcharts.Options = {
        chart: { type: "pie", height: 300 },
        title: { text: "" },
        credits: { enabled: false },
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
                data: Object.entries(beeCounts).map(([k, v], index) => ({
                    name: k,
                    y: v,
                    color: REPORT_CHART_PALETTE[index % REPORT_CHART_PALETTE.length],
                })),
            },
        ],
    };

    const wardCounts = useMemo(() => {
        const m: Record<string, number> = {};
        applicantsInRange.forEach((a) => {
            const w = (firstMapValue(a.profile) || "Unknown") as string;
            const label = (w || "Unknown").toString();
            m[label] = (m[label] || 0) + 1;
        });
        return m;
    }, [applicantsInRange]);

    const wardHasData = Object.values(wardCounts).some((v) => v > 0);

    const wardOptions: Highcharts.Options = {
        chart: { type: "pie", height: 320 },
        title: { text: "" },
        credits: { enabled: false },
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
                name: "Applications",
                data: Object.entries(wardCounts).map(([name, y], index) => ({
                    name,
                    y,
                    color: REPORT_CHART_PALETTE[index % REPORT_CHART_PALETTE.length],
                })),
            },
        ],
    };

    const headerBranchName = assignedBranch
        ? branchMap[assignedBranch] || "Unknown Branch"
        : "Not Assigned";

    const reachParticipants = useMemo(
        () => Object.fromEntries(participantById.entries()),
        [participantById]
    );

    const ChartOrEmpty: React.FC<{
        hasData: boolean;
        options: Highcharts.Options;
    }> = ({ hasData, options }) =>
            hasData ? (
                <HighchartsReact highcharts={Highcharts} options={options} />
            ) : (
                <div
                    style={{
                        height: (options.chart as any)?.height || 300,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Empty description="No data in selected range" />
                </div>
            );

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: "project-admin-reports",
            pageTitle: "Project Admin Reports",
            guides: [
                {
                    id: "project-admin-reports-navigation",
                    title: "Using Project Reports",
                    description:
                        "Learn which filters apply to each report area and where to find delivery, applicant, compliance and reach reporting.",
                    kind: "page",
                    order: 1,
                    steps: [
                        {
                            element: guideTarget("project-report-filters"),
                            popover: {
                                title: "Report filters",
                                description:
                                    "The period always controls the report. Department applies to Interventions, Compliance and Reach. In Applicants, it becomes Audience: All Applicants includes every application; Incubatees includes accepted applicants only.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("project-report-segments"),
                            popover: {
                                title: "Report areas",
                                description:
                                    "Interventions tracks planned and delivered support. Applicants profiles applications and incubatees. Compliance covers Developmental Plans, GAP and onboarding documents. Reach analyses people reached by interventions.",
                                side: "bottom",
                                align: "end",
                            },
                        },
                    ],
                },
                {
                    id: "project-admin-intervention-delivery",
                    title: "Reading intervention delivery",
                    description:
                        "Understand the department cards, group-delivery counting, drilldowns and monthly activity chart.",
                    kind: "task",
                    order: 2,
                    steps: [
                        {
                            element: guideTarget("project-report-intervention-snapshot"),
                            popover: {
                                title: "Department snapshot",
                                description:
                                    "Only intervention departments appear here. Required is planned workload from accepted application plans. Assigned, Active and Completed are delivery measures for the selected period.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("project-report-intervention-snapshot"),
                            popover: {
                                title: "Open a department",
                                description:
                                    "Select a department card to drill from status to intervention and, where available, sub-intervention. A delivery to a group is counted once throughout this report, not once for every group member.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("project-report-intervention-activity"),
                            popover: {
                                title: "Activity over time",
                                description:
                                    "The blue Assigned spline shows unique intervention assignments by month. Completed and In Progress columns use group-level status. After you select a department card, this chart follows that department.",
                                side: "top",
                                align: "start",
                            },
                        },
                    ],
                },
                {
                    id: "project-admin-applicants-compliance",
                    title: "Applicants and compliance",
                    description:
                        "Understand the Applicant audience selector and the Compliance report's operational checks.",
                    kind: "process",
                    order: 3,
                    steps: [
                        {
                            element: guideTarget("project-report-segments"),
                            popover: {
                                title: "Applicant audience",
                                description:
                                    "Choose Applicants, then use Audience to switch between All Applicants and Incubatees (Accepted). Applicant charts intentionally ignore Department so they show the full programme population.",
                                side: "bottom",
                                align: "end",
                            },
                        },
                        {
                            element: guideTarget("project-report-compliance-content"),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: "Compliance checks",
                                description:
                                    "Choose Compliance to review Developmental Plans needed versus confirmed, GAP and onboarding-document progress, and outstanding documents. These charts retain the selected department and period.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                    ],
                },
            ],
        }),
        []
    );

    usePageGuides(guideRegistration);

    return (
        <div style={{ padding: 24, minHeight: "100vh" }}>
            <Helmet>
                <title>Project Reports & Analytics</title>
            </Helmet>

            <MotionCard
                data-guide="project-report-filters"
                filterBarProps={{
                    padding: 12,
                    marginBottom: 0,
                    background: "#f8fafc",
                    borderColor: "#e5edf8"
                }}
                filterBar={
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            width: "100%",
                            minWidth: 0,
                            overflowX: "auto",
                        }}
                    >
                        {viewMode === "applications" ? (
                            <div style={{ flex: "0.9 1 0", minWidth: 210 }}>
                                <Select
                                    size="small"
                                    value={applicantScope}
                                    onChange={setApplicantScope}
                                    style={{ width: "100%" }}
                                    options={[
                                        { value: "all", label: "All Applicants" },
                                        { value: "incubatees", label: "Incubatees (Accepted)" },
                                    ]}
                                />
                            </div>
                        ) : (
                            <div style={{ flex: "0.9 1 0", minWidth: 210 }}>
                                <Select
                                    size="small"
                                    value={selectedDepartment}
                                    onChange={setSelectedDepartment}
                                    style={{ width: "100%" }}
                                    options={[
                                        { value: "all", label: "All Departments" },
                                        ...deptNames.slice().sort().map((name) => ({ value: name, label: name }))
                                    ]}
                                />
                            </div>
                        )}
                        <div style={{ flex: "1.25 1 0", minWidth: 330 }}>
                            <RangePicker
                                size="small"
                                allowClear={false}
                                value={dateRange}
                                presets={[
                                    { label: "This Month", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
                                    { label: "This Quarter", value: fiscalQuarterRange() },
                                    { label: "YTD", value: fiscalYtdRange() }
                                ]}
                                style={{ width: "100%" }}
                                onChange={(vals) => {
                                    if (!vals || !vals[0] || !vals[1]) {
                                        setDateRange(DEFAULT_RANGE);
                                        return;
                                    }
                                    setDateRange([vals[0], vals[1]]);
                                }}
                            />
                        </div>
                        <div style={{ flex: "1.8 1 0", minWidth: 560 }}>
                            <Segmented<ViewMode>
                                data-guide="project-report-segments"
                                block
                                size="small"
                                value={viewMode}
                                onChange={(v) => setViewMode(v as ViewMode)}
                                options={[
                                    { label: "Interventions", value: "interventions", icon: <BarChartOutlined /> },
                                    { label: "Applicants", value: "applications", icon: <TeamOutlined /> },
                                    { label: "Compliance", value: "compliance", icon: <FileProtectOutlined /> },
                                    { label: "Reach", value: "reach", icon: <GlobalOutlined /> },
                                ]}
                            />
                        </div>
                    </div>
                }
                style={{ marginBottom: 12, padding: 0 }}
            />

            {topError && (
                <Alert
                    type="warning"
                    showIcon
                    message="Some data did not load cleanly"
                    description={topError}
                    style={{ marginBottom: 8 }}
                />
            )}

            {loading ? (
                <LoadingOverlay tip="Loading Analytics" />
            ) : viewMode === "interventions" ? (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} data-guide="project-report-intervention-snapshot">
                            <MotionCard
                                title="Department intervention snapshot"
                            >
                                {
                                    drilledDepartmentName ? (
                                        <>
                                            <div style={{ marginBottom: 12 }}>
                                                <Button
                                                    size="small"
                                                    onClick={() => {
                                                        drilledDepartmentRef.current = null;
                                                        setDrilledDepartmentName(null);
                                                    }}
                                                >
                                                    Back to department snapshot
                                                </Button>
                                                <Text type="secondary" style={{ marginLeft: 10 }}>
                                                    Department: {drilledDepartmentName}
                                                </Text>
                                            </div>
                                            <ChartOrEmpty
                                                hasData={!!selectedDepartmentBreakdownOptions}
                                                options={selectedDepartmentBreakdownOptions || breakdownOptions}
                                            />
                                        </>
                                    ) : snapshotHasData ? (
                                        <>
                                            <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                                                Required is the number of planned interventions. Select a department to view its unique assigned interventions by status.
                                            </Text>
                                            <Row gutter={[12, 12]}>
                                                {departmentSnapshots.map((item) => (
                                                    <Col xs={24} sm={12} lg={8} xl={6} key={item.department}>
                                                        <div
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={() => {
                                                                drilledDepartmentRef.current = item.department;
                                                                setDrilledDepartmentName(item.department);
                                                            }}
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter" || event.key === " ") {
                                                                    drilledDepartmentRef.current = item.department;
                                                                    setDrilledDepartmentName(item.department);
                                                                }
                                                            }}
                                                            style={{
                                                                height: "100%",
                                                                cursor: "pointer",
                                                                padding: "10px 12px",
                                                                border: "1px solid #dbe4f0",
                                                                borderRadius: 10,
                                                                boxShadow: "0 4px 14px rgba(15, 23, 42, 0.10)",
                                                                background: "#fff",
                                                            }}
                                                        >
                                                            <Text
                                                                strong
                                                                ellipsis={{ tooltip: item.department }}
                                                                style={{ display: "block", marginBottom: 8 }}
                                                            >
                                                                {item.department}
                                                            </Text>
                                                            <Row gutter={4}>
                                                                {[
                                                                    ["Required", item.required, "#1f2937"],
                                                                    ["Assigned", item.assigned, REPORT_CHART_COLORS.primary],
                                                                    ["Active", item.active, "#d48806"],
                                                                    ["Completed", item.completed, REPORT_CHART_COLORS.success],
                                                                ].map(([label, value, color]) => (
                                                                    <Col span={6} key={label as string}>
                                                                        <div style={{ fontSize: 10, color: "#8c8c8c", lineHeight: 1.1 }}>
                                                                            {label}
                                                                        </div>
                                                                        <div style={{ fontSize: 17, fontWeight: 700, color: color as string }}>
                                                                            {value as number}
                                                                        </div>
                                                                    </Col>
                                                                ))}
                                                            </Row>
                                                        </div>
                                                    </Col>
                                                ))}
                                            </Row>
                                        </>
                                    ) : (
                                        <Empty description="No required interventions or assignments for the selected filters." />
                                    )
                                }
                            </MotionCard>
                        </Col>
                        <Col xs={24} data-guide="project-report-intervention-activity">
                            <MotionCard
                                title="Intervention activity over time"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("interventionTimeSeries")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={interventionTimeSeriesHasData}
                                    options={interventionTimeSeriesOptions}
                                />
                            </MotionCard>
                        </Col>

                    </Row>
                </>
            ) : viewMode === "applications" ? (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                            <MotionCard
                                title={
                                    applicantScope === "incubatees"
                                        ? "Incubatees (Accepted) — Monthly"
                                        : "Applicants — Submitted vs Accepted (Monthly)"
                                }
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("appsSubmittedVsAccepted")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={appsSubmittedVsAcceptedHasData}
                                    options={appsSubmittedVsAcceptedOptions}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title="Applicants by Gender"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("appGender")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={appGenderHasData}
                                    options={appGenderOptions}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title="Applicants by Age Group"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("appAge")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty hasData={appAgeHasData} options={appAgeOptions} />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title="Applicants by Sector"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("appSector")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={appSectorHasData}
                                    options={appSectorOptions}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title="Ownership Breakdown (Average %)"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("ownership")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty
                                    hasData={ownershipHasData}
                                    options={ownershipOptions}
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={12}>
                            <MotionCard
                                title="B-BBEE / Education Breakdown"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("bee")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty hasData={beeHasData} options={beeOptions} />
                            </MotionCard>
                        </Col>

                        <Col xs={24}>
                            <MotionCard
                                title="Ward / Locality Distribution"
                                extra={
                                    <Button
                                        size="small"
                                        icon={<ExpandOutlined />}
                                        onClick={() => setExpandedChart("ward")}
                                    >
                                        Expand
                                    </Button>
                                }
                            >
                                <ChartOrEmpty hasData={wardHasData} options={wardOptions} />
                            </MotionCard>
                        </Col>
                    </Row>
                </>
            ) : viewMode === "compliance" ? (
                <div data-guide="project-report-compliance-content">
                    <DeferredLegacyReportPanels
                        panels={[
                            {
                                key: "dps",
                                title: "Developmental Plans — Needed vs Confirmed",
                                hasData: !!paDPHasData,
                                options: paDPOptions,
                            },
                            {
                                key: "onboardedVsSigned",
                                title: "GAP and onboarding documents — monthly progress",
                                hasData: onboardedVsSignedHasData,
                                options: onboardedVsSignedOptions,
                            },
                            {
                                key: "outstandingDocs",
                                title: "Outstanding documents",
                                hasData: outstandingPieHasData,
                                options: outstandingDocsPieOptions,
                            },
                        ]}
                        onExpand={(key) => setExpandedChart(key)}
                    />
                </div>
            ) : (
                <ReachAnalytics
                    rows={assignedInRange}
                    participants={reachParticipants}
                    loading={loading}
                    isMain
                    departmentId=""
                    departmentOptions={reachDepartmentOptions}
                />
            )}

            <Modal
                open={!!expandedChart}
                footer={null}
                onCancel={() => setExpandedChart(null)}
                width={1000}
                title={`Expanded View — ${expandedChart}`}
            >
                {expandedChart === "breakdown" && (
                    <ChartOrEmpty hasData={breakdownHasData} options={breakdownOptions} />
                )}
                {expandedChart === "interventionTimeSeries" && (
                    <ChartOrEmpty
                        hasData={interventionTimeSeriesHasData}
                        options={interventionTimeSeriesOptions}
                    />
                )}
                {expandedChart === "dps" && (
                    <ChartOrEmpty hasData={!!paDPHasData} options={paDPOptions} />
                )}
                {expandedChart === "onboardedVsSigned" && (
                    <ChartOrEmpty
                        hasData={onboardedVsSignedHasData}
                        options={onboardedVsSignedOptions}
                    />
                )}
                {expandedChart === "outstandingDocs" && (
                    <ChartOrEmpty
                        hasData={outstandingPieHasData}
                        options={outstandingDocsPieOptions}
                    />
                )}

                {expandedChart === "appsSubmittedVsAccepted" && (
                    <ChartOrEmpty
                        hasData={appsSubmittedVsAcceptedHasData}
                        options={appsSubmittedVsAcceptedOptions}
                    />
                )}
                {expandedChart === "appGender" && (
                    <ChartOrEmpty hasData={appGenderHasData} options={appGenderOptions} />
                )}
                {expandedChart === "appAge" && (
                    <ChartOrEmpty hasData={appAgeHasData} options={appAgeOptions} />
                )}
                {expandedChart === "appSector" && (
                    <ChartOrEmpty hasData={appSectorHasData} options={appSectorOptions} />
                )}
                {expandedChart === "ownership" && (
                    <ChartOrEmpty hasData={ownershipHasData} options={ownershipOptions} />
                )}
                {expandedChart === "bee" && (
                    <ChartOrEmpty hasData={beeHasData} options={beeOptions} />
                )}
                {expandedChart === "ward" && (
                    <ChartOrEmpty hasData={wardHasData} options={wardOptions} />
                )}
            </Modal>
        </div>
    );
};

export default ProjectAdminReports;
