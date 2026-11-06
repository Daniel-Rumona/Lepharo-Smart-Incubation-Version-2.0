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
    Empty,
    Segmented,
    Alert,
    Badge,
    Dropdown,
    Popover,
    Space,
    Typography,
    Select,
} from "antd";
import {
    BarChartOutlined,
    CalendarOutlined,
    CloseOutlined,
    FilterOutlined,
    TableOutlined,
    FileProtectOutlined,
    GlobalOutlined,
    LineChartOutlined,
    PlayCircleOutlined,
    DownOutlined,
    FilePptOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import "highcharts/modules/drilldown";
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
import { useDepartmentRoles, type DepartmentRoleKey } from "@/services/departmentRoles";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { useDashboardDateRange } from "@/lib/useDashboardDateRange";
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import CentreReportModal from "@/routes/projectadmin/facilities/CentreReportModal";
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import ReachAnalytics, { type ReachControls } from "@/components/reports/ReachAnalytics";
import ProjectAdminPerformance from "@/components/dashboards/projectadmin/ProjectAdminPerformance";
import ProjectAdminReportPlayer from "@/components/reports/ProjectAdminReportPlayer";
import { useColorMode } from "@/contexts/ThemeContext";
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
import { FilterPanel } from "@/components/workspace";
import ChartDetailsModal from "./ChartDetailsModal";
import DepartmentSnapshot from "./DepartmentSnapshot";
import "./projectReports.css";
import ComplianceSnapshot from "./ComplianceSnapshot";
import { buildComplianceModel } from "./complianceModel";
import { loadComplianceSource, type ComplianceSource } from "./complianceData";
import EngagementSnapshot from "./EngagementSnapshot";
import { buildEngagementModel } from "./engagementModel";

dayjs.extend(isBetween);

const { Text } = Typography;

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

/** Age from the ID number, else the date of birth, else a stored age. */
const participantAge = (person: { idNumber?: string; dateOfBirth?: any; age?: number | string }): number | null => {
    const fromId = getAgeFromID(person.idNumber);
    if (fromId != null) return fromId;
    const dob = toDate(person.dateOfBirth);
    if (dob) return dayjs().diff(dob, "year");
    const stored = Number(person.age);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
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
    beneficiaryName?: string;
    submittedAt?: any;
    applicationStatus?: string;
    gender?: string;
    ageGroup?: string;
    profile?: any;
    departmentId?: string;
    departmentName?: string;
    interventions?: { required?: Array<{ departmentId?: string }> };
};

type InterventionDefinition = {
    title?: string;
    hasSubInterventions?: boolean;
    subTitlesById: Record<string, string>;
};

type ParticipantDoc = {
    id: string;
    beneficiaryName?: string;
    dateOfBirth?: any;
    age?: number | string;
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

type ViewMode = "interventions" | "applications" | "compliance" | "engagement" | "reach" | "performance";

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
    const { isDark } = useColorMode();
    const [playerOpen, setPlayerOpen] = useState(false);
    const [executiveReportOpen, setExecutiveReportOpen] = useState(false);

    const [loading, setLoading] = useState(false);
    const [expandedChart, setExpandedChart] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("interventions");
    const [drilledDepartmentName, setDrilledDepartmentName] = useState<string | null>(null);
    const drilledDepartmentRef = useRef<string | null>(null);
    // The period comes from the topbar, shared with the dashboard. "All time" (null)
    // runs from the earliest application to today.
    const { range: sharedRange, label: periodLabel } = useDashboardDateRange();
    // Reach's Department / Intervention / charts pickers, shown behind Filters.
    const [reachControls, setReachControls] = useState<ReachControls | null>(null);
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


    const { departments, roleOf } = useDepartmentRoles();

    // Participants whose GAP Analysis ROM has confirmed (Compliance tab).
    const [romConfirmed, setRomConfirmed] = useState<Set<string>>(
        () => new Set()
    );

    // Departments left out of the department reports, with their sub-departments.
    const reportDepartments = useMemo(() => {
        const excluded: DepartmentRoleKey[] = ["inhouseFinance", "monitoring", "stakeholder", "hr", "rom"];
        return departments
            .map((department) => ({
                value: department.id,
                label: String(department.name || department.id).trim(),
                interventionsDepartment: department.interventionsDepartment === true,
                role: roleOf(department.id),
            }))
            .filter((option) => option.label && !(option.role && excluded.includes(option.role)))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [departments, roleOf]);
    const reachDepartmentOptions = useMemo(
        () => reportDepartments.map(({ label, value }) => ({ label, value })),
        [reportDepartments]
    );
    const interventionDepartmentOptions = useMemo(
        () =>
            reportDepartments
                .filter((option) => option.interventionsDepartment)
                .map(({ label, value }) => ({ label, value })),
        [reportDepartments]
    );
    const departmentLabelOf = useCallback(
        (departmentId?: string) =>
            reachDepartmentOptions.find((option) => option.value === String(departmentId || ""))?.label || "Other",
        [reachDepartmentOptions]
    );

    const dateRange = useMemo<[Dayjs, Dayjs]>(() => {
        if (sharedRange) return sharedRange;
        const earliest = apps.reduce<Date | null>((min, app) => {
            const d = toDate(app.submittedAt);
            return d && (!min || d < min) ? d : min;
        }, null);
        return [dayjs(earliest || undefined).startOf("month"), dayjs().endOf("day")];
    }, [sharedRange, apps]);

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
                                    return [id, title] as [string, string];
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

    // -------- applications, participants, assignedInterventions, agreements ----------
    useEffect(() => {
        if (!assignedBranch) return;
        setTopError(null);

        let cancelled = false;
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

    // -------- GAP Analyses confirmed by ROM ----------
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const pids = Array.from(
                new Set(
                    apps
                        .filter((a) => normalize(a.applicationStatus) === "accepted")
                        .map((a) => a.participantId)
                        .filter(Boolean)
                        .map(String)
                )
            );
            const romConf = new Set<string>();
            for (const ids of chunk(pids, 10)) {
                const gs = await getDocs(
                    query(collection(db, "gapAnalysis"), where("participantId", "in", ids))
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
            if (!cancelled) setRomConfirmed(romConf);
        })().catch((error) => console.error("GAP confirmations could not be loaded.", error));

        return () => {
            cancelled = true;
        };
    }, [apps]);

    // -------- scoped subsets ----------
    const matchesDepartment = useCallback(
        (record: { departmentId?: string }) =>
            selectedDepartment === "all" || String(record.departmentId || "") === selectedDepartment,
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

    // Reach filters by department itself, so it gets the period's rows unfiltered.
    const assignedInPeriod = useMemo(
        () => assigned.filter((r) => inRange(r.createdAt) || inRange(r.completedAt)),
        [assigned, inRange]
    );

    const assignedInRange = useMemo(
        () => assignedInPeriod.filter((r) => matchesDepartment(r)),
        [assignedInPeriod, matchesDepartment]
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
        const departmentLabel = (record: { departmentId?: string }) => departmentLabelOf(record.departmentId);
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
        const isInterventionDepartment = (record: { departmentId?: string }) =>
            interventionDepartmentOptions.some(
                (department) => department.value === String(record.departmentId || "")
            );

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
                    if (!matchesDepartment(item)) return;
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
        departmentLabelOf,
        reportAssignmentRollups,
    ]);

    // Compliance documents are only read when the Compliance tab is opened.
    const [complianceSource, setComplianceSource] = useState<ComplianceSource | null>(null);
    const [complianceLoading, setComplianceLoading] = useState(false);
    const acceptedApps = useMemo(
        () => apps.filter((a) => normalize(a.applicationStatus) === "accepted"),
        [apps]
    );
    const complianceLoadedFor = useRef<unknown>(null);
    useEffect(() => {
        if (viewMode !== "compliance" || loading) return;
        if (complianceLoadedFor.current === acceptedApps) return;
        complianceLoadedFor.current = acceptedApps;
        let cancelled = false;
        setComplianceLoading(true);
        loadComplianceSource(acceptedApps, participantById)
            .then((source) => {
                if (!cancelled) setComplianceSource(source);
            })
            .catch((error) => {
                console.error("Compliance documents could not be loaded.", error);
                complianceLoadedFor.current = null;
                if (!cancelled) setComplianceSource({ records: [], requirementsByProgram: {}, templates: [] });
            })
            .finally(() => {
                if (!cancelled) setComplianceLoading(false);
            });
        return () => {
            cancelled = true;
            // Unmounted or the data changed mid-load: allow the next run to load again.
            if (complianceLoadedFor.current === acceptedApps) complianceLoadedFor.current = null;
        };
    }, [viewMode, loading, acceptedApps, participantById]);

    const complianceModel = useMemo(() => {
        if (!complianceSource) return null;
        const inRangeIds = new Set(onboardedAppsInRange.map((a) => a.id));
        return buildComplianceModel({
            records: complianceSource.records.filter((r) => inRangeIds.has(r.appId)),
            requirementsByProgram: complianceSource.requirementsByProgram,
            templates: complianceSource.templates,
            romConfirmed,
            monthKeys: months,
            monthKeyOf: (record) => {
                const d = toDate(record.application?.submittedAt);
                return d ? fmtMonth(d) : null;
            },
            monthLabel,
        });
    }, [complianceSource, onboardedAppsInRange, romConfirmed, months]);

    const complianceTrendOptions: Highcharts.Options | null = complianceModel
        ? {
            chart: { type: "column", height: 240 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: { categories: complianceModel.trend.categories },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
            tooltip: { shared: true },
            plotOptions: { column: { borderRadius: 3, dataLabels: { enabled: true } } },
            series: [
                { type: "column", name: "Onboarded", data: complianceModel.trend.onboarded },
                { type: "column", name: "GAP Analysis signed", data: complianceModel.trend.gap },
                { type: "column", name: "Pre-incubation signed", data: complianceModel.trend.pre },
                { type: "column", name: "MOA signed", data: complianceModel.trend.moa },
            ],
        }
        : null;

    // Appointment sessions and walk-ins are only read when the Engagement tab is opened.
    // Scoped like the Play report: sessions by programme, walk-ins by branch and programme.
    const [engagementSource, setEngagementSource] = useState<{ sessions: any[]; inquiries: any[] } | null>(null);
    const [engagementLoading, setEngagementLoading] = useState(false);
    const engagementLoadedFor = useRef<string | null>(null);
    useEffect(() => {
        if (viewMode !== "engagement" || !assignedBranch) return;
        const key = `${assignedBranch}|${activeProgramId || ""}`;
        if (engagementLoadedFor.current === key) return;
        engagementLoadedFor.current = key;
        let cancelled = false;
        setEngagementLoading(true);
        Promise.all([
            getDocs(
                activeProgramId
                    ? query(collection(db, "appointmentSessions"), where("programId", "==", activeProgramId))
                    : collection(db, "appointmentSessions")
            )
                .then((snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
                .catch((error) => {
                    console.error("Appointment sessions could not be loaded.", error);
                    return [] as any[];
                }),
            getDocs(query(collection(db, "inquiries"), where("branchId", "==", assignedBranch)))
                .then((snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
                .catch((error) => {
                    console.error("Walk-ins could not be loaded.", error);
                    return [] as any[];
                }),
        ])
            .then(([sessions, inquiries]) => {
                if (!cancelled) setEngagementSource({ sessions, inquiries });
            })
            .finally(() => {
                if (!cancelled) setEngagementLoading(false);
            });
        return () => {
            cancelled = true;
            if (engagementLoadedFor.current === key) engagementLoadedFor.current = null;
        };
    }, [viewMode, assignedBranch, activeProgramId]);

    const engagementModel = useMemo(() => {
        if (!engagementSource) return null;
        const labelOf = (id: string) =>
            reachDepartmentOptions.find((option) => option.value === id)?.label ||
            "Other department";
        return buildEngagementModel({
            sessions: engagementSource.sessions,
            inquiries: engagementSource.inquiries,
            inRange,
            programId: activeProgramId,
            departmentLabel: labelOf,
            matchesDepartment: (id) => selectedDepartment === "all" || id === selectedDepartment,
            monthKeys: months,
            monthKeyOf: fmtMonth,
            monthLabel,
        });
    }, [engagementSource, inRange, activeProgramId, reachDepartmentOptions, selectedDepartment, months]);

    const engagementTrendOptions: Highcharts.Options | null = engagementModel
        ? {
            chart: { type: "column", height: 240 },
            title: { text: "" },
            credits: { enabled: false },
            xAxis: { categories: engagementModel.trend.categories },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
            tooltip: { shared: true },
            plotOptions: { column: { borderRadius: 3, dataLabels: { enabled: true } } },
            series: [
                { type: "column", name: "Sessions held", data: engagementModel.trend.held },
                { type: "column", name: "Walk-ins", data: engagementModel.trend.walkIns },
            ],
        }
        : null;

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
                const dept = departmentLabelOf(r.departmentId);
                if (!perDept[dept]) perDept[dept] = [];
                perDept[dept].push(rollup);
            });

        const topData: Highcharts.PointOptionsObject[] = [];
        const drillSeries: Highcharts.SeriesOptionsType[] = [];

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
    }, [departmentLabelOf, inRange, interventionsById, matchesDepartment, reportAssignmentRollups]);

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
            // The snapshot panel names the department above the chart.
            title: { text: undefined },
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
                (department) => department.value === String(record.departmentId || "")
            );
            if (!isInterventionDepartment) return false;
            if (!drilledDepartmentName) return true;
            return departmentLabelOf(record.departmentId) === drilledDepartmentName && members.length > 0;
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
        departmentLabelOf,
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
                const age = participantAge(person);
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
            title: { text: '' },
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
            // The SME's own ward/hub first; older applications keep it in profile.
            const p = a.participantId ? participantById.get(a.participantId) : undefined;
            const fromProfile = firstMapValue(a.profile);
            const w = (p?.ward || p?.hub || (typeof fromProfile === "string" ? fromProfile : "") || "Unknown") as string;
            const label = (w || "Unknown").toString();
            m[label] = (m[label] || 0) + 1;
        });
        return m;
    }, [applicantsInRange, participantById]);

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
                                    "The period is set with the calendar button in the top bar and is shared with your dashboard. Filters holds the rest for the open tab: Department for Interventions and Engagement, and Applicants (All or Accepted only) for Applicants. On Reach, Filters holds Department, Intervention and the demographic charts to show.",
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
                                    "Choose Applicants, then open Filters to switch between all applicants and accepted applicants only. Applicant charts intentionally ignore Department so they show the full programme population.",
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
                                    "Choose Compliance to see onboarding documents (GAP Analysis, pre-incubation contract and MOA) and each programme's required documents by status, for SMEs onboarded in the selected period.",
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

    // Filters that apply to the open tab; the period lives in the topbar. Reach
    // supplies its own pickers (Department, Intervention, charts to show).
    const departmentFilter = ["interventions", "engagement"].includes(viewMode);
    const activeFilterCount =
        (departmentFilter && selectedDepartment !== "all" ? 1 : 0) +
        (viewMode === "applications" && applicantScope !== "all" ? 1 : 0) +
        (viewMode === "reach" ? reachControls?.activeCount || 0 : 0);
    // One line beside the period saying what the open tab is filtered by.
    const filterSummary: Array<{ label: string; value: string; onClear?: () => void }> =
        viewMode === "reach"
            ? reachControls?.summary || []
            : departmentFilter
                ? [{
                    label: "Department",
                    value: selectedDepartment === "all" ? "All" : departmentLabelOf(selectedDepartment),
                    onClear: selectedDepartment === "all" ? undefined : () => setSelectedDepartment("all"),
                }]
                : viewMode === "applications"
                    ? [{
                        label: "Applicants",
                        value: applicantScope === "all" ? "All" : "Accepted only",
                        onClear: applicantScope === "all" ? undefined : () => setApplicantScope("all"),
                    }]
                    : [];

    // Charts with a Details view: the chart large, its figures and a CSV download.
    const detailCharts: Record<string, { title: string; options: Highcharts.Options; hasData: boolean }> = {
        interventionTimeSeries: {
            title: "Intervention activity over time",
            options: interventionTimeSeriesOptions,
            hasData: interventionTimeSeriesHasData,
        },
        appsSubmittedVsAccepted: {
            title:
                applicantScope === "incubatees"
                    ? "Incubatees (Accepted) — Monthly"
                    : "Applicants — Submitted vs Accepted (Monthly)",
            options: appsSubmittedVsAcceptedOptions,
            hasData: appsSubmittedVsAcceptedHasData,
        },
        appGender: { title: "Applicants by Gender", options: appGenderOptions, hasData: appGenderHasData },
        appAge: { title: "Applicants by Age Group", options: appAgeOptions, hasData: appAgeHasData },
        appSector: { title: "Applicants by Sector", options: appSectorOptions, hasData: appSectorHasData },
        ownership: { title: "Ownership Breakdown (Average %)", options: ownershipOptions, hasData: ownershipHasData },
        bee: { title: "B-BBEE / Education Breakdown", options: beeOptions, hasData: beeHasData },
        ward: { title: "Ward / Locality Distribution", options: wardOptions, hasData: wardHasData },
    };
    const openDetail = expandedChart ? detailCharts[expandedChart] : undefined;

    const filterPanel = viewMode === "reach" ? (
        reachControls?.panel ?? null
    ) : departmentFilter ? (
        <FilterPanel canReset={selectedDepartment !== "all"} onReset={() => setSelectedDepartment("all")}>
            {reachDepartmentOptions.length > 0 && (
                <div>
                    <label className="ws-filter-label" id="pr-department-label" htmlFor="pr-department">
                        Department
                    </label>
                    <Select
                        id="pr-department"
                        style={{ width: "100%" }}
                        value={selectedDepartment}
                        onChange={setSelectedDepartment}
                        options={[{ value: "all", label: "All departments" }, ...reachDepartmentOptions]}
                        showSearch
                        optionFilterProp="label"
                    />
                </div>
            )}
        </FilterPanel>
    ) : viewMode === "applications" ? (
        <FilterPanel canReset={applicantScope !== "all"} onReset={() => setApplicantScope("all")}>
            <div>
                <label className="ws-filter-label" id="pr-audience-label">
                    Applicants
                </label>
                <Segmented
                    block
                    aria-labelledby="pr-audience-label"
                    value={applicantScope}
                    onChange={(v) => setApplicantScope(v as "all" | "incubatees")}
                    options={[
                        { value: "all", label: "All" },
                        { value: "incubatees", label: "Accepted only" },
                    ]}
                />
            </div>
        </FilterPanel>
    ) : null;

    return (
        <div style={{ padding: 24, minHeight: "100vh" }}>
            <Helmet>
                <title>Project Reports & Analytics</title>
            </Helmet>

            <DashboardFilterBar>
                <div className="pr-bar" data-guide="project-report-filters">
                    <Segmented<ViewMode>
                        data-guide="project-report-segments"
                        className="pr-tabs"
                        value={viewMode}
                        onChange={(v) => setViewMode(v as ViewMode)}
                        options={[
                            // The SME's journey: intake, onboarding, support, contact, who it reached, results.
                            { label: "Applicants", value: "applications", icon: <TeamOutlined /> },
                            { label: "Compliance", value: "compliance", icon: <FileProtectOutlined /> },
                            { label: "Interventions", value: "interventions", icon: <BarChartOutlined /> },
                            { label: "Engagement", value: "engagement", icon: <CalendarOutlined /> },
                            { label: "Reach", value: "reach", icon: <GlobalOutlined /> },
                            { label: "Performance", value: "performance", icon: <LineChartOutlined /> },
                        ]}
                    />
                    <div className="pr-scope" aria-label="Showing">
                        <span className="pr-scope-item" title="Change the period from the calendar button in the top bar">
                            <span className="pr-scope-label">Period:</span> {periodLabel}
                        </span>
                        {filterSummary.map((item) => (
                            <span key={item.label} className={`pr-scope-item${item.onClear ? " is-active" : ""}`}>
                                <span className="pr-scope-label">{item.label}:</span> {item.value}
                                {item.onClear ? (
                                    <button
                                        type="button"
                                        className="pr-scope-clear"
                                        aria-label={`Clear ${item.label.toLowerCase()} filter`}
                                        onClick={item.onClear}
                                    >
                                        <CloseOutlined />
                                    </button>
                                ) : null}
                            </span>
                        ))}
                    </div>
                    {filterPanel ? (
                        <Popover content={filterPanel} trigger="click" placement="bottomRight" title="Filters">
                            <Badge count={activeFilterCount} size="small" offset={[-6, 4]}>
                                <Button size="large" icon={<FilterOutlined />}>
                                    Filters
                                </Button>
                            </Badge>
                        </Popover>
                    ) : null}
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: [
                                { key: "play", icon: <PlayCircleOutlined />, label: "Play" },
                                { key: "executive", icon: <FilePptOutlined />, label: "Executive report" },
                            ],
                            onClick: ({ key }) => (key === "play" ? setPlayerOpen(true) : setExecutiveReportOpen(true)),
                        }}
                    >
                        <Button size="large" shape="round" type="primary">
                            Report <DownOutlined />
                        </Button>
                    </Dropdown>
                    <CentreReportModal open={executiveReportOpen} onClose={() => setExecutiveReportOpen(false)} />
                </div>
            </DashboardFilterBar>

            <ProjectAdminReportPlayer
                dark={isDark}
                open={playerOpen}
                onClose={() => setPlayerOpen(false)}
                programId={activeProgramId}
                branchId={assignedBranch}
                range={dateRange}
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

            {viewMode === "performance" ? (
                <ProjectAdminPerformance programId={activeProgramId} dateRange={dateRange} />
            ) : loading ? (
                <PageSkeleton variant='analytics' />
            ) : viewMode === "interventions" ? (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} data-guide="project-report-intervention-snapshot">
                            <MotionCard
                                title="Department intervention snapshot"
                            >
                                <DepartmentSnapshot
                                    items={snapshotHasData ? departmentSnapshots : []}
                                    selected={drilledDepartmentName}
                                    onSelect={(department) => {
                                        drilledDepartmentRef.current = department;
                                        setDrilledDepartmentName(department);
                                    }}
                                    detail={
                                        <ChartOrEmpty
                                            hasData={!!selectedDepartmentBreakdownOptions}
                                            options={selectedDepartmentBreakdownOptions || breakdownOptions}
                                        />
                                    }
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} data-guide="project-report-intervention-activity">
                            <MotionCard
                                title="Intervention activity over time"
                                extra={
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("interventionTimeSeries")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("appsSubmittedVsAccepted")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("appGender")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("appAge")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("appSector")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("ownership")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("bee")}
                                        >
                                            Details
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
                                        type="text"
                                        icon={<TableOutlined />}
                                        onClick={() => setExpandedChart("ward")}
                                        >
                                            Details
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
                    <ComplianceSnapshot
                        model={complianceModel}
                        loading={complianceLoading && !complianceModel}
                        trend={
                            complianceTrendOptions ? (
                                <ChartOrEmpty
                                    hasData={complianceModel!.trend.onboarded.some((v) => v > 0)}
                                    options={complianceTrendOptions}
                                />
                            ) : null
                        }
                    />
                </div>
            ) : viewMode === "engagement" ? (
                <div data-guide="project-report-engagement-content">
                    <EngagementSnapshot
                        model={engagementModel}
                        loading={engagementLoading && !engagementModel}
                        trend={
                            engagementTrendOptions ? (
                                <ChartOrEmpty
                                    hasData={engagementModel!.trend.held.some((v) => v > 0) || engagementModel!.trend.walkIns.some((v) => v > 0)}
                                    options={engagementTrendOptions}
                                />
                            ) : null
                        }
                    />
                </div>
            ) : (
                <ReachAnalytics
                    rows={assignedInPeriod}
                    participants={reachParticipants}
                    loading={loading}
                    isMain
                    departmentId=""
                    departmentOptions={reachDepartmentOptions}
                    onControls={setReachControls}
                />
            )}

            <ChartDetailsModal
                open={!!openDetail}
                title={openDetail?.title || ""}
                context={[`Period: ${periodLabel}`, ...filterSummary.map((item) => `${item.label}: ${item.value}`)].join(" · ")}
                options={openDetail?.options}
                hasData={openDetail?.hasData}
                onClose={() => setExpandedChart(null)}
            />
        </div>
    );
};

export default ProjectAdminReports;
