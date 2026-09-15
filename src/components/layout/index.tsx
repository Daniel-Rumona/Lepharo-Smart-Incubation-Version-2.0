import React, { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import {
    Layout,
    Button,
    Modal,
    Pagination,
    Select,
    Tag,
    Tooltip,
    Badge,
    Dropdown,
    theme,
} from "antd";
import { useLogout } from "@refinedev/core";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import { db } from "@/firebase";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CurrentUser } from "@/components/layout/current-user";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DashboardFilterControl } from "@/components/layout/dashboard-filter";
import { useColorMode } from "@/contexts/ThemeContext";
import { useWindowSize } from "react-use";
import {
    HomeOutlined,
    MessageOutlined,
    LogoutOutlined,
    AuditOutlined,
    BankOutlined,
    BarChartOutlined,
    BarsOutlined,
    BlockOutlined,
    BoxPlotOutlined,
    BulbOutlined,
    CalendarOutlined,
    CheckSquareOutlined,
    ClockCircleOutlined,
    DatabaseOutlined,
    DollarOutlined,
    DotChartOutlined,
    DoubleRightOutlined,
    FieldTimeOutlined,
    FileDoneOutlined,
    FileProtectOutlined,
    FileSearchOutlined,
    FileTextOutlined,
    FormOutlined,
    FundProjectionScreenOutlined,
    GroupOutlined,
    HeatMapOutlined,
    LaptopOutlined,
    LineChartOutlined,
    LinkOutlined,
    MoneyCollectOutlined,
    PaperClipOutlined,
    PhoneOutlined,
    ProfileOutlined,
    ProjectOutlined,
    QuestionCircleOutlined,
    ReadOutlined,
    SendOutlined,
    TeamOutlined,
    UserOutlined,
    LockOutlined,
    OpenAIOutlined,
    AreaChartOutlined,
    ClusterOutlined,
    MailOutlined,
    ApartmentOutlined,
    DeploymentUnitOutlined,
    InboxOutlined,
    VideoCameraOutlined,
    FolderOpenOutlined,
    ScheduleOutlined,
    ShopOutlined,
    TrophyOutlined,
    WarningOutlined,
    ProductOutlined,
    BookOutlined,
    CloudDownloadOutlined,
    SafetyCertificateOutlined,
    AppstoreOutlined,
    DownOutlined,
    RightOutlined,
} from "@ant-design/icons";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { safeLocal } from "@/utils/safeStorage";
import { RouteFallback } from "@/components/layout/RouteFallback";
import { LoadingOverlay } from "../shared/LoadingOverlay";
import { endSession } from "@/utils/sessionTracking";
import {
    ViewAsBanner,
    ViewAsControls,
} from "@/components/view-as/ViewAsControls";
import { GuideLauncher } from "@/components/guide-me";
import { useChatSession } from "@/routes/chat/ChatSessionContext";
import "./layout.css";

const { Content } = Layout;

type UserRole =
    | "admin"
    | "system_admin"
    | "funder"
    | "incubatee"
    | "operations"
    | "coordinator"
    | "director"
    | "projectadmin"
    | "receptionist";

type ProgramDoc = {
    id: string;
    name?: string;
    title?: string;
    code?: string;
    status?: string;
    isActive?: boolean;
    assignedBranch?: { id: string; name?: string } | string;
    branchId?: string;
    normalizedAssignedBranchId?: string;
    participatingDepartmentIds?: string[];
};

type ActiveProgramId = string | "all";

type NavigationItem = {
    key: string;
    label: React.ReactNode;
    to?: string;
    icon?: React.ReactNode;
    children?: NavigationItem[];
};

type NavigationDestination = {
    key: string;
    label: string;
    route: string;
    icon?: React.ReactNode;
    parentKey?: string | null;
    parentLabel?: string | null;
    attentionCount: number;
};

const PRIMARY_NAV_KEYS: Partial<Record<UserRole, string[]>> = {
    system_admin: ["dashboard", "proposals", "console", "system"],
    admin: ["dashboard", "proposals", "console", "system"],
    projectadmin: ["dashboard", "sme-incubatees", "kpis-tracker", "interventions"],
    coordinator: ["dashboard", "allocated-active", "appointments", "coordinator-movs"],
    funder: ["dashboard", "incubatees", "analytics"],
    director: ["dashboard", "kpis-tracker", "quality-objectives", "reports"],
    incubatee: ["dashboard", "interventions-tracker", "appointments-tracker", "roadmap"],
    receptionist: ["dashboard", "inquiries", "follow-ups", "calendar"],
};

const OPERATIONS_PRIMARY_KEYS: Record<string, string[]> = {
    HRM: ["dashboard", "employees", "leave-requests", "reports"],
    "M&E": ["dashboard", "kpis-tracker", "monitoring-participants", "reports"],
    IHF: ["dashboard", "requested", "invoices", "reported"],
    "Stakeholder Engagement": ["dashboard", "engagement", "reports", "timesheet"],
    DEFAULT: ["dashboard", "assignments", "appointments", "reports"],
};

const NAV_DESCRIPTIONS: Record<string, string> = {
    dashboard: "See your priorities, progress, and the work that needs attention.",
    proposals: "Review and progress programme proposals through the approval pipeline.",
    calendar: "View appointments, programme events, and important notices.",
    documentation: "Find programme documents, templates, and shared records.",
    "sme-incubatees": "Open the incubatee directory and review participant information.",
    "interventions-tracker": "Track your assigned interventions and delivery progress.",
    "appointments-tracker": "Review your scheduled intervention appointments.",
    roadmap: "Follow your incubation journey, milestones, and next steps.",
    "allocated-active": "Continue the interventions currently assigned to you.",
    appointments: "Plan and manage intervention appointments.",
    "coordinator-movs": "Submit and review your supporting evidence.",
    interventions: "Verify submitted MOVs and follow up on outstanding evidence.",
    "inquiries-db": "Review incoming inquiries and coordinate the next response.",
    inquiries: "Review and manage incoming inquiries.",
    "follow-ups": "Continue inquiries that still need a response or action.",
    incubatees: "Review the incubatees supported by your programmes.",
    analytics: "Explore performance, delivery, and outcome insights.",
    reports: "Open reporting dashboards and programme insights.",
    "interventions-db": "Review intervention delivery across the organisation.",
    employees: "Manage employee records and workforce information.",
    "leave-requests": "Review employee leave requests and decisions.",
    requested: "Manage resource requests submitted to the department.",
    invoices: "Review and process departmental invoices.",
    reported: "See departmental delivery and financial insights.",
    engagement: "Manage stakeholder activities and engagement records.",
    timesheet: "Capture and review working time.",
    chat: "Ask the Data Assistant to help you find and understand information.",
    tutorials: "Watch practical guides that explain key platform workflows.",
    console: "Monitor system activity, usage, and operational health.",
    email: "Review platform email activity and communication delivery.",
    "feature-governance": "Control feature availability and rollout across user groups.",
    "data-export-settings": "Set which roles may export sensitive programme data.",
    system: "Configure programmes, branches, departments, and system reference data.",
    leave: "Submit leave requests and follow their approval status.",
    "sme-applications": "Review programme applications and move candidates through onboarding.",
    programs: "Create programmes and manage their delivery configuration.",
    "inquiries-followups": "Track inquiries that still require contact or a completed response.",
    "team-management": "Manage team membership, responsibilities, and access.",
    "department-workroom": "Coordinate departmental tasks, ownership, and progress.",
    "resources-db": "Browse available equipment, facilities, and programme resources.",
    "resources-req": "Review resource requests submitted by incubatees.",
    "resources-internal": "Request and coordinate resources needed by internal teams.",
    "resources-all": "Track resource allocations, recipients, and availability.",
    "success-challenges": "Capture achievements, challenges, and evidence from programme delivery.",
    diagnostic: "Assess business gaps and turn findings into a development plan.",
    gap: "Explore diagnostic gaps and the areas requiring targeted support.",
    plan: "Build and maintain the participant development action plan.",
    assignments: "Assign interventions to coordinators and monitor ownership.",
    finance: "Review financial records, compliance activity, and supporting documents.",
    schedule: "Coordinate appointments and programme calendar commitments.",
    compliance: "Monitor required documents, expiry dates, and compliance gaps.",
    risk: "Identify at-risk incubatees and record mitigation or follow-up actions.",
    jobs: "Track jobs created, retained, and reported by supported businesses.",
    "analytics-visualisations": "Explore visual trends across interventions and programme outcomes.",
    feedback: "Review incubatee feedback and identify service improvement themes.",
    "quality-objectives": "Set quality objectives and monitor progress against their measures.",
    "leave-calendar": "See approved leave across the team and identify coverage gaps.",
    linkages: "Record market opportunities, referrals, and linkage outcomes.",
    "surveys-portal": "Create, distribute, and review programme surveys and responses.",
    impact: "Analyse programme outcomes and the change achieved for participants.",
    verification: "Review previously processed invoices and their verification history.",
    "user-management": "Manage platform users, roles, and organisational access.",
    requests: "Review incoming operational requests and coordinate their resolution.",
    "hod-active": "Review active interventions assigned across the department.",
    movs: "Review submitted means of verification and approve supporting evidence.",
    "interventions-req": "Assess new intervention requests and route them for delivery.",
    "interventions-manager": "Configure intervention services, requirements, and delivery rules.",
    coordinators: "Review coordinators, workloads, assignments, and delivery progress.",
    "coordinators-db": "Manage coordinator profiles and departmental coverage.",
    personnel: "Review personnel responsible for programme monitoring and delivery.",
    users: "Manage user accounts and access for the selected operational area.",
    activity: "Review recent user and workflow activity across the programme.",
    "hr-leave": "Monitor employee leave requests from the personnel workspace.",
    participants: "Browse participant profiles and their programme relationships.",
    applications: "Review applicant details, status, and programme placement.",
    groups: "Create participant groups and manage their membership and delivery scope.",
    forms: "Manage survey forms used to collect programme information.",
    resources: "Manage available resources, requests, and allocations.",
    "collaborative-reports": "Prepare reports collaboratively with assigned contributors and reviewers.",
    "data-export": "Create permitted exports for analysis and external reporting.",
    "metrics-tracker": "Review the business metrics and outcomes recorded for your journey.",
    "inquiries-tracker": "Submit feedback or questions and follow the response.",
    "resources-tracker": "Request programme resources and track their allocation status.",
    library: "Browse learning material, templates, and shared programme resources.",
    "documents-hub": "Complete surveys and access engagement documents shared with you.",
    "compliance-tracker": "Upload required compliance documents and monitor what is outstanding.",
    contacts: "Maintain stakeholder contact details and communication information.",
    "op-library": "Access delivery documents, tutorials, stories, and SME resources.",
};

const navigationLabel = (item: Pick<NavigationItem, "key" | "label">) => {
    if (typeof item.label === "string") return item.label;
    return item.key
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
};

const PROGRAM_STORAGE_KEY = "activeProgramId";
const MORE_PAGE_SIZE = 6;

const MORE_SECTION_LABELS: Record<string, string> = {
    "More tools": "Tools",
    "Digital Library": "Library",
    "SMEs Overview": "SMEs",
    "Programs Onboarding": "Programs",
};

const DIRECT_DESTINATION_SECTIONS: Record<string, string> = {
    calendar: "Self Service",
    leave: "Self Service",
    "leave-requests": "Self Service",
    "leave-calendar": "Self Service",
    timesheet: "Self Service",
    documentation: "Library",
    tutorials: "Library",
    library: "Library",
    "success-challenges": "Library",
    analytics: "Analytics",
    reports: "Analytics",
    reported: "Analytics",
    "data-export": "Analytics",
    employees: "Personnel",
    "user-management": "Personnel",
    programs: "Programs",
    resources: "Resources",
};

const compactSectionLabel = (label: string) => MORE_SECTION_LABELS[label] || label;

export const CustomLayout: React.FC = () => {
    const { token } = theme.useToken();
    const { isDark } = useColorMode();
    /**
     * The page plane behind the content card. Light mode keeps the literal #fff
     * this has always used — Ant Design's colorBgLayout is #f5f5f5 there, which
     * would be a visible change.
     *
     * Dark mode deliberately uses the *layout* rung, not the container one. They
     * are two different shades on dark, and painting the shell with the container
     * colour is what made the header read as a second shade behind the topbar.
     */
    const pageBg = isDark ? token.colorBgLayout : "#fff";
    const { width } = useWindowSize();
    const isMobile = width < 768;
    const isCompactHeader = width < 1180;
    const { user } = useFullIdentity();
    const {
        unreadCount: assistantUnreadCount,
        isTyping: assistantWorking,
    } = useChatSession();
    const { mutate: logout } = useLogout();
    const navigate = useNavigate();

    const [role, setRole] = useState<UserRole | null>(null);
    const isIncubateeMobileHeader = isMobile && role === "incubatee";
    const [department, setDepartment] = useState<string | null>(null);
    // Raw departments/{id} FK on the user doc -- used to scope which programs an
    // "operations" user can see, distinct from `effectiveDepartment` below (a
    // display name, parent-resolved, used for menu-item access rules).
    const [departmentId, setDepartmentId] = useState<string | null>(null);

    // main branch CC flag
    const [isMainCenterCoordinator, setIsMainCenterCoordinator] = useState(false);

    // If user is locked to a program, store it here
    const [assignedProgramIds, setAssignedProgramIds] = useState<string[]>([]);
    const [assignedBranchId, setAssignedBranchId] = useState<string | null>(null);
    const isCenterScopedRole = role === "projectadmin" || role === "receptionist";
    const isRestrictedRole =
        role === "coordinator" ||
        role === "projectadmin" ||
        role === "receptionist" ||
        role === "funder" ||
        role === "incubatee";

    const [moreOpen, setMoreOpen] = useState(false);
    const [pendingSegment, setPendingSegment] = useState<string | null>(null);
    const [moreSection, setMoreSection] = useState<string | null>(null);
    const [morePage, setMorePage] = useState(1);

    const location = useLocation();

    // The assistant owns its own immersive mobile screen (back button +
    // docked composer, no shared nav chrome to clear) the same way the
    // course builder route already does — see the paddingBottom/bottom-nav
    // conditions below.
    const isImmersiveChatMobile = isMobile && location.pathname === "/chat";

    const [effectiveDepartment, setEffectiveDepartment] = useState<string | null>(
        null
    );

    // Programs + active selection
    const [programs, setPrograms] = useState<ProgramDoc[]>([]);
    const [loadingPrograms, setLoadingPrograms] = useState(false);
    const [programsLoaded, setProgramsLoaded] = useState(false);
    const [activeProgramId, setActiveProgramId] =
        useState<ActiveProgramId>("all");

    const SESSION_STORAGE_KEY = "activeSessionId";

    // Best-effort "what needs my attention" counts, badged onto the
    // MOVs / Assigned Interventions menu entries so users know what to
    // focus on right after logging in. Never blocks or errors the layout.
    const [menuFocusCounts, setMenuFocusCounts] = useState<
        Record<string, number>
    >({});

    const scopedProgramIds = useMemo(() => {
        if (!isCenterScopedRole) return assignedProgramIds;
        if (!assignedBranchId) return [];

        return programs
            .filter((program) => {
                const programBranchId =
                    program.normalizedAssignedBranchId ||
                    program.branchId ||
                    (typeof program.assignedBranch === "string"
                        ? program.assignedBranch
                        : program.assignedBranch?.id);

                return String(programBranchId || "") === assignedBranchId;
            })
            .map((program) => program.id);
    }, [assignedProgramIds, assignedBranchId, isCenterScopedRole, programs]);

    const hasAssignedList = isRestrictedRole && scopedProgramIds.length > 0;
    const hardLock = hasAssignedList && scopedProgramIds.length === 1;
    const softLock = hasAssignedList && scopedProgramIds.length > 1;
    const canUseAllProgramsScope = role === "operations";

    // Programs now optionally declare which departments participate in them
    // (Coverage step, src/routes/programs). An operations user should only see
    // programs their own department is part of -- programs that haven't set
    // this up yet (no list, or an empty one) stay visible to everyone, so this
    // never hides pre-existing programs.
    const departmentScopedProgramIds = useMemo(() => {
        if (role !== "operations" || !departmentId) return null;
        return programs
            .filter((program) => {
                const ids = program.participatingDepartmentIds;
                if (!Array.isArray(ids) || ids.length === 0) return true;
                return ids.includes(departmentId);
            })
            .map((program) => program.id);
    }, [programs, role, departmentId]);
    const shouldLabelAllProgramsAsOperations =
        role === "operations" && !!effectiveDepartment?.startsWith("M&E");
    const allProgramsLabel = shouldLabelAllProgramsAsOperations
        ? "Operations"
        : "All Programs";

    const getActiveSessionId = async (): Promise<string | null> => {
        // 1) Prefer local stored session id (fast + accurate)
        const stored = safeLocal.get(SESSION_STORAGE_KEY) as string | undefined;
        if (stored) return stored;

        // 2) Fallback: query latest active session (endedAt == null)
        const uid = user?.id ? String(user.id) : null;
        if (!uid) return null;

        const snap = await getDocs(
            query(
                collection(db, "userSessions"),
                where("uid", "==", uid),
                where("endedAt", "==", null),
                orderBy("startedAt", "desc"),
                limit(1)
            )
        );

        const d = snap.docs[0];
        return d ? d.id : null;
    };

    const handleLogout = async () => {
        // close the CURRENT tab session (sessionStorage) if any
        await endSession("logout").catch(() => { });
        logout();
    };

    // Programs the user can see/pick from
    const visiblePrograms = useMemo(() => {
        const activePrograms = programs.filter((p) => p.isActive !== false);
        if (hardLock || softLock) {
            return activePrograms.filter((p) => scopedProgramIds.includes(p.id));
        }
        // 🔒 Restricted role with NO assigned programs → they should not see all programs
        if (isRestrictedRole && !hasAssignedList) {
            return [];
        }
        if (departmentScopedProgramIds) {
            return activePrograms.filter((p) =>
                departmentScopedProgramIds.includes(p.id)
            );
        }
        return activePrograms;
    }, [
        programs,
        scopedProgramIds,
        hardLock,
        softLock,
        isRestrictedRole,
        hasAssignedList,
        departmentScopedProgramIds,
    ]);

    const firstVisibleProgramId = useMemo(() => {
        return visiblePrograms.length > 0 ? visiblePrograms[0].id : null;
    }, [visiblePrograms]);

    // after programs state
    const programById = useMemo(() => {
        const m = new Map<string, ProgramDoc>();
        programs.forEach((p) => m.set(p.id, p));
        return m;
    }, [programs]);

    // ─────────────────────────────────────────────────────
    // 1) Load user role/department/assignedProgramId once
    // ─────────────────────────────────────────────────────
    useEffect(() => {
        const ensureLockedProgramLoaded = async () => {
            if (!hardLock) return;
            const only = scopedProgramIds[0];
            if (!only || programById.has(only)) return;

            const snap = await getDoc(doc(db, "programs", only));
            if (snap.exists() && (snap.data() as any).isActive !== false) {
                setPrograms((prev) => {
                    const exists = prev.some((p) => p.id === snap.id);
                    if (exists) return prev;
                    return [...prev, { id: snap.id, ...(snap.data() as any) }];
                });
            }
        };
        ensureLockedProgramLoaded();
    }, [hardLock, scopedProgramIds, programById]);

    useEffect(() => {
        const run = async () => {
            if (!user?.id) return;
            const snap = await getDoc(doc(db, "users", String(user.id)));
            if (!snap.exists()) return;
            const data = snap.data() as any;

            const cleanRole = data.role?.toLowerCase()?.replace(/\s+/g, "") as
                | UserRole
                | undefined;

            setRole(cleanRole || null);
            const rawAssignedBranch = data.assignedBranch ?? data.branchId;
            const resolvedAssignedBranchId =
                typeof rawAssignedBranch === "string" ||
                    typeof rawAssignedBranch === "number"
                    ? String(rawAssignedBranch)
                    : rawAssignedBranch && typeof rawAssignedBranch === "object"
                        ? String(rawAssignedBranch.id ?? "")
                        : "";
            setAssignedBranchId(resolvedAssignedBranchId || null);
            const deptName = (data.departmentName || null) as string | null;
            setDepartment(deptName);

            // Resolve department hierarchy so subdepartments inherit parent menu rules
            const deptId = (data.departmentId || null) as string | null; // preferred
            setDepartmentId(deptId);
            let resolvedEffective = deptName;

            try {
                // If we have departmentId, use it to check parentDepartmentId
                if (deptId) {
                    const deptSnap = await getDoc(doc(db, "departments", deptId));
                    if (deptSnap.exists()) {
                        const deptData = deptSnap.data() as any;
                        const parentId = deptData.parentDepartmentId || null;

                        // If I'm a subdepartment, inherit parent department NAME for menus
                        if (parentId) {
                            const parentSnap = await getDoc(
                                doc(db, "departments", String(parentId))
                            );
                            if (parentSnap.exists()) {
                                resolvedEffective =
                                    (parentSnap.data() as any)?.name ||
                                    (parentSnap.data() as any)?.departmentName ||
                                    resolvedEffective;
                            }
                        } else {
                            // I'm a parent dept, use my own canonical name if it exists
                            resolvedEffective =
                                deptData?.name || deptData?.departmentName || resolvedEffective;
                        }
                    }
                } else if (deptName) {
                    // Fallback: resolve by departmentName -> fetch dept doc -> check parent
                    const qDept = query(
                        collection(db, "departments"),
                        where("name", "==", deptName),
                        limit(1)
                    );
                    const snap = await getDocs(qDept);
                    const d = snap.docs[0];
                    if (d) {
                        const deptData = d.data() as any;
                        const parentId = deptData.parentDepartmentId || null;

                        if (parentId) {
                            const parentSnap = await getDoc(
                                doc(db, "departments", String(parentId))
                            );
                            if (parentSnap.exists()) {
                                resolvedEffective =
                                    (parentSnap.data() as any)?.name || resolvedEffective;
                            }
                        } else {
                            resolvedEffective = deptData?.name || resolvedEffective;
                        }
                    }
                }
            } catch (e) {
                console.warn(
                    "Failed to resolve effective department for menu rules",
                    e
                );
            }

            setEffectiveDepartment(resolvedEffective || null);

            // ── MAIN CC DETECTION ───────────────────────────
            let mainCC = false;

            if (cleanRole === "projectadmin") {
                // assignedBranch can be string or { id: ... }
                const rawBranch = data.assignedBranch;
                const branchId =
                    typeof rawBranch === "string"
                        ? rawBranch
                        : rawBranch && typeof rawBranch === "object"
                            ? String(rawBranch.id ?? "")
                            : "";

                if (branchId) {
                    try {
                        const branchSnap = await getDoc(doc(db, "branches", branchId));
                        if (branchSnap.exists()) {
                            const b = branchSnap.data() as any;
                            const isMainFlag =
                                b.isMain === true ||
                                b.is_main === true ||
                                b.isPrimary === true ||
                                b.primary === true;
                            if (isMainFlag) mainCC = true;
                        }
                    } catch (err) {
                        console.warn("Failed to resolve branch for mainCC check", err);
                    }
                }
            }

            setIsMainCenterCoordinator(mainCC);
            // ────────────────────────────────────────────────

            // robust normalization for string | {id} | number
            const toId = (v: any) => {
                if (!v) return null;
                if (typeof v === "string") return v;
                if (typeof v === "number") return String(v);
                if (typeof v === "object" && v.id) return String(v.id);
                return null;
            };

            const norm = (v: any) =>
                String(v ?? "")
                    .toLowerCase()
                    .trim();

            async function getAcceptedIncubateeProgramId(
                email?: string
            ): Promise<string | null> {
                if (!email) return null;

                const snap = await getDocs(
                    query(collection(db, "applications"), where("email", "==", email))
                );

                const accepted = snap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) }))
                    .find((a) => norm(a.applicationStatus) === "accepted");

                const pid = accepted?.programId;
                return pid ? String(pid) : null;
            }

            // --- DEFAULT ASSIGNMENTS (staff roles) ---
            let arr: string[] = Array.isArray(data.assignedPrograms)
                ? (data.assignedPrograms.map(toId).filter(Boolean) as string[])
                : data.assignedProgramId
                    ? ([toId(data.assignedProgramId)].filter(Boolean) as string[])
                    : [];

            // --- INCUBATEE LOCK (accepted application → programId) ---
            if (cleanRole === "incubatee") {
                try {
                    const email = String(user?.email || data.email || "").trim();
                    const lockedPid = await getAcceptedIncubateeProgramId(email);
                    arr = lockedPid ? [lockedPid] : [];
                } catch (e) {
                    console.warn("Failed to resolve incubatee accepted program lock", e);
                    arr = [];
                }
            }

            setAssignedProgramIds(arr);
        };

        run();
    }, [user?.id, user?.email]);

    // ─────────────────────────────────────────────────────
    // 2) Load programs
    // ─────────────────────────────────────────────────────
    useEffect(() => {
        const fetchPrograms = async () => {
            setLoadingPrograms(true);
            try {
                const q = query(
                    collection(db, "programs"),
                );
                const snap = await getDocs(q);
                const rows = snap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) }))
                    .filter((program) => program.isActive !== false);
                rows.sort((a, b) =>
                    (a.name || a.title || "").localeCompare(b.name || b.title || "")
                );
                setPrograms(rows);
            } catch (e) {
                console.error("Failed to fetch programs", e);
                setPrograms([]);
            } finally {
                setLoadingPrograms(false);
                setProgramsLoaded(true);
            }
        };

        fetchPrograms();
    }, []);

    useEffect(() => {
        const syncAvailability = async (event: Event) => {
            const { programId, isActive } = (event as CustomEvent).detail || {};
            if (!programId) return;
            if (!isActive) {
                setPrograms((current) =>
                    current.filter((program) => program.id !== programId)
                );
                return;
            }
            const snapshot = await getDoc(doc(db, "programs", programId));
            if (!snapshot.exists() || (snapshot.data() as any).isActive === false)
                return;
            setPrograms((current) =>
                current.some((program) => program.id === programId)
                    ? current
                    : [...current, { id: snapshot.id, ...(snapshot.data() as any) }]
            );
        };
        window.addEventListener("program-availability-changed", syncAvailability);
        return () =>
            window.removeEventListener(
                "program-availability-changed",
                syncAvailability
            );
    }, []);

    // 3) Decide activeProgramId (fixed precedence + no loop)
    useEffect(() => {
        if (!programsLoaded) return;

        const existsIn = (id?: string, list: ProgramDoc[] = programs) =>
            !!id && list.some((p) => p.id === id);

        const stored = safeLocal.get(PROGRAM_STORAGE_KEY) as string | undefined;

        let next: ActiveProgramId = "all";

        if (hardLock) {
            if (!visiblePrograms.length) {
                return;
            }
            const only = scopedProgramIds[0];
            next = existsIn(only, visiblePrograms) ? only! : "all";
        } else if (softLock) {
            if (existsIn(stored, visiblePrograms)) next = stored!;
            else if (firstVisibleProgramId) next = firstVisibleProgramId;
            else next = "all";
        } else if (isRestrictedRole && !hasAssignedList) {
            next = "all";
        } else if (canUseAllProgramsScope) {
            if (stored === "all") next = "all";
            else if (existsIn(stored, visiblePrograms)) next = stored!;
            else if (firstVisibleProgramId) next = firstVisibleProgramId;
            else next = "all";
        } else {
            if (existsIn(stored, visiblePrograms)) next = stored!;
            else if (firstVisibleProgramId) next = firstVisibleProgramId;
            else next = "all";
        }

        setActiveProgramId((prev) => (prev === next ? prev : next));
    }, [
        programsLoaded,
        programs,
        visiblePrograms,
        firstVisibleProgramId,
        hardLock,
        softLock,
        scopedProgramIds,
        isRestrictedRole,
        hasAssignedList,
        canUseAllProgramsScope,
    ]);

    // ─────────────────────────────────────────────────────
    // 4) Persist + broadcast only on real change (no flicker)
    // ─────────────────────────────────────────────────────
    const lastBroadcastRef = useRef<ActiveProgramId | undefined>(undefined);

    useEffect(() => {
        if (!programsLoaded) return;
        if (activeProgramId === lastBroadcastRef.current) return;

        lastBroadcastRef.current = activeProgramId;

        const normalizedActiveProgramId: ActiveProgramId =
            activeProgramId === "all" && !canUseAllProgramsScope
                ? "all"
                : activeProgramId;

        if (normalizedActiveProgramId === "all") {
            safeLocal.set(PROGRAM_STORAGE_KEY, "all");
        } else {
            safeLocal.set(PROGRAM_STORAGE_KEY, normalizedActiveProgramId);
        }

        if (typeof window !== "undefined") {
            (window as any).__ACTIVE_PROGRAM_ID__ = normalizedActiveProgramId;

            const program =
                normalizedActiveProgramId === "all"
                    ? undefined
                    : visiblePrograms.find((p) => p.id === normalizedActiveProgramId);

            window.dispatchEvent(
                new CustomEvent("program-filter-changed", {
                    detail: {
                        programId: normalizedActiveProgramId,
                        program,
                    },
                })
            );
        }
    }, [
        activeProgramId,
        programsLoaded,
        visiblePrograms,
        canUseAllProgramsScope,
    ]);

    useEffect(() => {
        if (!programsLoaded || !hardLock) return;

        const only = scopedProgramIds[0];
        if (
            only &&
            programs.some((p) => p.id === only) &&
            activeProgramId !== only
        ) {
            setActiveProgramId(only);
        }
    }, [programsLoaded, hardLock, activeProgramId, scopedProgramIds, programs]);

    const resolveProgramLabel = (id?: string) => {
        if (!id || id === "all")
            return canUseAllProgramsScope ? allProgramsLabel : "";
        const p = programById.get(id);
        return p?.name || p?.title || p?.code || "";
    };

    // Canonical role navigation. The top destinations and More launcher are
    // both derived from this tree after department access has been applied.
    const allMenus: Record<string, NavigationItem[]> = {
        system_admin: [
            {
                key: "dashboard",
                to: "/admin",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
            },
            {
                key: "tutorials",
                to: "/tutorials",
                label: "Tutorials",
                icon: <VideoCameraOutlined />,
            },
            {
                key: "timesheet",
                to: "/timesheet",
                label: "Timesheet",
                icon: <ClockCircleOutlined />,
            },
            {
                key: "console",
                to: "/admin/console",
                label: "Console",
                icon: <BarChartOutlined />,
            },
            {
                key: "email",
                to: "/admin/email",
                label: "Emails",
                icon: <MailOutlined />,
            },
            {
                key: "feature-governance",
                to: "/admin/features",
                label: "Feature Governance",
                icon: <ProductOutlined />,
            },
            {
                key: "data-export-settings",
                to: "/admin/data-export-settings",
                label: "Export Permissions",
                icon: <SafetyCertificateOutlined />,
            },
            {
                key: "system",
                to: "/system",
                label: "System Setup",
                icon: <BankOutlined />,
            },
        ],

        admin: [
            {
                key: "dashboard",
                to: "/admin",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
            },
            {
                key: "tutorials",
                to: "/tutorials",
                label: "Tutorials",
                icon: <VideoCameraOutlined />,
            },
            {
                key: "timesheet",
                to: "/timesheet",
                label: "Timesheet",
                icon: <ClockCircleOutlined />,
            },
            {
                key: "console",
                to: "/admin/console",
                label: "Console",
                icon: <BarChartOutlined />,
            },
            {
                key: "email",
                to: "/admin/email",
                label: "Emails",
                icon: <MailOutlined />,
            },
            {
                key: "feature-governance",
                to: "/admin/features",
                label: "Feature Governance",
                icon: <ProductOutlined />,
            },
            {
                key: "data-export-settings",
                to: "/admin/data-export-settings",
                label: "Export Permissions",
                icon: <SafetyCertificateOutlined />,
            },
            {
                key: "system",
                to: "/system",
                label: "System Setup",
                icon: <BankOutlined />,
            },
        ],

        projectadmin: [
            {
                key: "dashboard",
                to: "/projectadmin",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
            },
            {
                key: "self-service",
                label: "Self Service",
                icon: <UserOutlined />,
                children: [
                    {
                        key: "timesheet",
                        to: "/timesheet",
                        label: "Timesheet",
                        icon: <ClockCircleOutlined />,
                    },
                    {
                        key: "leave",
                        to: "/leave",
                        label: "Leave",
                        icon: <CalendarOutlined />,
                    },
                ],
            },
            {
                key: "calendar",
                to: "/calendar",
                label: "Calendar & Notices",
                icon: <CalendarOutlined />,
            },
            {
                key: "documentation",
                to: "/operations/documentation",
                label: "Documents Hub",
                icon: <FileSearchOutlined />,
            },
            {
                key: "smes",
                label: "SMEs Overview",
                icon: <ClusterOutlined />,
                children: [
                    {
                        key: "sme-applications",
                        to: "/applications",
                        label: "Applications",
                        icon: <FormOutlined />,
                    },
                    {
                        key: "sme-incubatees",
                        to: "/participants",
                        label: "Incubatees",
                        icon: <AreaChartOutlined />,
                    },
                ],
            },
            {
                key: "programs",
                label: "Programs",
                icon: <LaptopOutlined />,
                to: "/programs",
            },
            {
                key: "kpis",
                label: "KPIs",
                icon: <LineChartOutlined />,
                children: [
                    {
                        key: "kpis-register",
                        label: "KPI Register",
                        to: "/kpis/setup",
                        icon: <DatabaseOutlined />,
                    },

                    {
                        key: "kpis-tracker",
                        label: "KPI Tracker",
                        to: "/kpis/track",
                        icon: <ClockCircleOutlined />,
                    },
                ],
            },
            {
                key: "interventions",
                icon: <FileSearchOutlined />,
                to: "/projectadmin/movs",
                label: "MOVs Verification",
            },
            {
                key: "inquiries",
                label: "Inquiries",
                icon: <QuestionCircleOutlined />,
                children: [
                    {
                        key: "inquiries-db",
                        label: "All",
                        to: "/receptionist/inquiries",
                        icon: <DatabaseOutlined />,
                    },

                    {
                        key: "inquiries-followups",
                        label: "Follow Ups",
                        to: "/projectadmin/follow-ups",
                        icon: <ClockCircleOutlined />,
                    },
                ],
            },
            {
                key: "user-management",
                label: "Team",
                icon: <TeamOutlined />,
                children: [
                    {
                        key: "team-management",
                        to: "/team",
                        label: "Manage",
                        icon: <DatabaseOutlined />,
                    },
                    {
                        key: "department-workroom",
                        to: "/operations/tasks",
                        label: "Tasks",
                        icon: <ClockCircleOutlined />,
                    },
                ],
            },
            {
                key: "resources",
                icon: <ProjectOutlined />,
                label: "Resources",
                children: [
                    {
                        key: "resources-db",
                        icon: <DatabaseOutlined />,
                        label: "Database",
                        to: "/resources",
                    },
                    {
                        key: "resources-req",
                        icon: <InboxOutlined />,
                        label: "Incubatee Requests",
                        to: "/resources/requests",
                    },
                    {
                        key: "resources-internal",
                        icon: <ApartmentOutlined />,
                        label: "Internal Requests",
                        to: "/resources/internal",
                    },
                    {
                        key: "resources-all",
                        icon: <DeploymentUnitOutlined />,
                        label: "Allocations",
                        to: "/resources/allocations",
                    },
                ],
            },
            {
                key: "reports",
                to: "/projectadmin/reports",
                label: "Analytics",
                icon: <ReadOutlined />,
            },
            {
                key: "success-challenges",
                to: "/projectadmin/success-challenges",
                label: "Success & Challenges",
                icon: <TrophyOutlined />,
            },
        ],

        coordinator: [
            {
                key: "dashboard",
                to: "/coordinator",
                label: "Home",
                icon: <HomeOutlined />,
            },
            // SECTION: SYSTEM
            {
                key: "documentation",
                to: "/operations/documentation",
                label: "Documents Hub",
                icon: <FolderOpenOutlined />,
            },
            {
                key: "tutorials",
                to: "/tutorials",
                label: "Tutorials",
                icon: <VideoCameraOutlined />,
            },

            // SECTION: SME & ONBOARDING
            {
                key: "smes",
                label: "SMEs Overview",
                icon: <ClusterOutlined />,
                children: [
                    {
                        key: "sme-applications",
                        to: "/applications",
                        label: "Applications",
                        icon: <FormOutlined />,
                    },
                    {
                        key: "sme-incubatees",
                        to: "/participants",
                        label: "Incubatees",
                        icon: <AreaChartOutlined />,
                    },
                ],
            },

            // SECTION: STRATEGY & PLANNING
            {
                key: "diagnostic",
                to: "/operations/plan",
                label: "Developmental Plan",
                icon: <AuditOutlined />,
                children: [
                    {
                        key: "gap",
                        to: "/operations/gap",
                        label: "GAP Analytics",
                        icon: <DotChartOutlined />,
                    },
                    {
                        key: "plan",
                        to: "/operations/plan",
                        label: "Plan Builder",
                        icon: <BlockOutlined />,
                    },
                ],
            },

            // SECTION: EXECUTION & INTERVENTIONS
            {
                key: "interventions",
                label: "Interventions",
                icon: <FileSearchOutlined />,
                children: [
                    {
                        key: "allocated-active",
                        to: "/coordinator/allocated",
                        label: "My Interventions",
                        icon: <LineChartOutlined />,
                    },
                    {
                        key: "assignments",
                        to: "/interventions/assignments",
                        label: "Assign Interventions",
                        icon: <FileProtectOutlined />,
                    },
                    {
                        key: "coordinator-movs",
                        to: "/coordinator/movs",
                        label: "My MOVs",
                        icon: <DatabaseOutlined />,
                    },
                ],
            },
            {
                key: "finance",
                to: "/operations/finance",
                label: "Finance",
                icon: <MoneyCollectOutlined />,
            },

            // SECTION: SCHEDULING
            {
                key: "schedule",
                label: "Scheduling",
                icon: <CalendarOutlined />,
                children: [
                    {
                        key: "appointments",
                        to: "/interventions/appointments",
                        label: "Appointments",
                        icon: <ScheduleOutlined />,
                    },
                    {
                        key: "calendar",
                        to: "/calendar",
                        label: "Calendar & Notices",
                        icon: <CalendarOutlined />,
                    },
                ],
            },

            // SECTION: OPERATIONS & COMPLIANCE
            {
                key: "monitoring",
                label: "Monitoring",
                icon: <LineChartOutlined />,
                children: [
                    {
                        key: "compliance",
                        to: "/compliance",
                        label: "Compliance",
                        icon: <CheckSquareOutlined />,
                    },
                    {
                        key: "risk",
                        to: "/operations/participants/risk",
                        label: "Risk Register",
                        icon: <WarningOutlined />,
                    },
                ],
            },
            {
                key: "jobs",
                to: "/metrics/jobs",
                label: "Jobs Tracker",
                icon: <ShopOutlined />,
            },
            // SECTION: PERSONAL
            {
                key: "self-service",
                label: "Self Service",
                icon: <UserOutlined />,
                children: [
                    {
                        key: "timesheet",
                        to: "/timesheet",
                        label: "Timesheet",
                        icon: <ClockCircleOutlined />,
                    },
                    {
                        key: "tasks",
                        to: "/coordinator/tasks",
                        label: "Tasks",
                        icon: <LinkOutlined />,
                    },
                    {
                        key: "leave",
                        to: "/leave",
                        label: "Leave",
                        icon: <CalendarOutlined />,
                    },
                ],
            },

            // SECTION: RESOURCES & FEEDBACK
            {
                key: "resources",
                label: "Resources",
                icon: <ProjectOutlined />,
                children: [
                    {
                        key: "resources-db",
                        to: "/resources",
                        label: "Resources Database",
                        icon: <DatabaseOutlined />,
                    },
                    {
                        key: "resources-internal",
                        to: "/coordinator/inhouse/requests",
                        label: "Internal Requests",
                        icon: <ProjectOutlined />,
                    },
                ],
            },

            // SECTION: ANALYTICS
            {
                key: "analytics",
                label: "Analytics",
                icon: <LineChartOutlined />,
                children: [
                    {
                        key: "analytics-visualisations",
                        to: "/coordinator/analytics",
                        label: "Visualisations",
                        icon: <LineChartOutlined />,
                    },
                    {
                        key: "feedback",
                        to: "/coordinator/feedback",
                        label: "Incubatees Feedback",
                        icon: <MessageOutlined />,
                    },
                ],
            },
        ],

        funder: [
            {
                key: "dashboard",
                to: "/funder",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "incubatees",
                to: "/funder/smes",
                label: "Incubatees View",
                icon: <ProfileOutlined />,
            },
            {
                key: "analytics",
                to: "/funder/analytics",
                label: "Analytics",
                icon: <BarChartOutlined />,
            },
        ],

        director: [
            {
                key: "dashboard",
                to: "/director",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
            },
            {
                key: "reports",
                to: "/director/reports",
                label: "Analytics",
                icon: <BarChartOutlined />,
            },
            {
                key: "kpis",
                label: "KPIs",
                icon: <LineChartOutlined />,
                children: [
                    {
                        key: "kpis-register",
                        label: "KPI Register",
                        to: "/kpis/setup",
                        icon: <DatabaseOutlined />,
                    },
                    {
                        key: "kpis-tracker",
                        label: "KPI Tracker",
                        to: "/kpis/track",
                        icon: <ClockCircleOutlined />,
                    },
                ],
            },
            {
                key: "quality-objectives",
                to: "/director/hr/quality-objectives",
                label: "Quality Objectives",
                icon: <FileProtectOutlined />,
            },
        ],

        incubatee: [
            {
                key: "dashboard",
                to: "/incubatee",
                label: "My Home",
                icon: <HomeOutlined />,
            },
            {
                key: "calendar",
                to: "/calendar",
                label: "Calendar & Notices",
                icon: <CalendarOutlined />,
            },
            {
                key: "tutorials",
                to: "/tutorials",
                label: "Tutorials",
                icon: <VideoCameraOutlined />,
            },
            {
                key: "tracker",
                icon: <FileSearchOutlined />,
                label: "Tracker",
                children: [
                    {
                        key: "interventions-tracker",
                        label: "Interventions",
                        to: "/incubatee/interventions",
                        icon: <BarsOutlined />,
                    },
                    {
                        key: "appointments-tracker",
                        label: "Appointments",
                        to: "/incubatee/appointments",
                        icon: <ClockCircleOutlined />,
                    },
                    {
                        key: "metrics-tracker",
                        label: "Metrics",
                        to: "/incubatee/metrics",
                        icon: <BarChartOutlined />,
                    },
                    {
                        key: "inquiries-tracker",
                        label: "Feedback",
                        to: "/incubatee/feedback",
                        icon: <QuestionCircleOutlined />,
                    },
                    {
                        key: "resources-tracker",
                        label: "Resources",
                        to: "/incubatee/resources",
                        icon: <BoxPlotOutlined />,
                    },
                ],
            },
            {
                key: "library",
                label: "Library",
                to: "/incubatee/library",
                icon: <BookOutlined />,
            },
            {
                key: "academy-courses",
                label: "Courses",
                to: "/academy",
                icon: <ReadOutlined />,
            },
            {
                key: "roadmap",
                to: "/incubatee/roadmap",
                label: "Developmental Plan",
                icon: <HeatMapOutlined />,
            },
            {
                key: "documents",
                label: "Engagement",
                icon: <FileDoneOutlined />,
                children: [
                    {
                        key: "documents-hub",
                        label: "Surveys",
                        to: "/incubatee/documents/hub",
                        icon: <BarsOutlined />,
                    },
                    {
                        key: "compliance-tracker",
                        label: "Compliance",
                        to: "/incubatee/documents/compliance",
                        icon: <ClockCircleOutlined />,
                    },
                ],
            },
            {
                key: "analytics",
                to: "/incubatee/analytics",
                label: "Analytics",
                icon: <BarChartOutlined />,
            },
        ],

        operations: [
            {
                key: "dashboard",
                to: "/operations",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
            },
            {
                key: "kpis",
                label: "KPIs",
                icon: <LineChartOutlined />,
                children: [
                    {
                        key: "kpis-register",
                        label: "KPI Register",
                        to: "/kpis/setup",
                        icon: <DatabaseOutlined />,
                    },
                    {
                        key: "kpis-tracker",
                        label: "KPI Tracker",
                        to: "/kpis/track",
                        icon: <ClockCircleOutlined />,
                    },
                ],
            },
            {
                key: "op-library",
                label: "Digital Library",
                icon: <BookOutlined />,
                children: [
                    {
                        key: "success-challenges",
                        to: "/operations/success-challenges",
                        label: "Success & Challenges",
                        icon: <TrophyOutlined />,
                    },
                    {
                        key: "library",
                        to: "/operations/library",
                        label: "SME Library",
                        icon: <BookOutlined />,
                    },
                    {
                        key: "documentation",
                        to: "/operations/documentation",
                        label: "Documents Hub",
                        icon: <FileTextOutlined />,
                    },
                    {
                        key: "tutorials",
                        label: "Tutorials",
                        icon: <VideoCameraOutlined />,
                        to: "/tutorials",
                    },
                ],
            },
            {
                key: "sme-incubatees",
                to: "/projectadmin/smes",
                label: "Incubatees",
                icon: <AreaChartOutlined />,
            },
            {
                key: "timesheet",
                to: "/timesheet",
                label: "Timesheet",
                icon: <ClockCircleOutlined />,
            },
            {
                key: "requested",
                to: "/operations/inhouse/requested",
                label: "Resources Requests",
                icon: <FileDoneOutlined />,
            },
            {
                key: "invoices",
                to: "/operations/inhouse/invoices",
                label: "Departmental Invoices",
                icon: <FileTextOutlined />,
            },
            {
                key: "verification",
                to: "/operations/inhouse/verification",
                label: "Invoices History",
                icon: <DollarOutlined />,
            },
            {
                key: "user-management",
                to: "/admin",
                label: "User Management",
                icon: <UserOutlined />,
            },
            {
                key: "reported",
                to: "/operations/inhouse/reported",
                label: "Analytics",
                icon: <BarChartOutlined />,
            },
            {
                key: "employees",
                to: "/operations/hr/employees",
                label: "Employees",
                icon: <TeamOutlined />,
            },
            {
                key: "quality-objectives",
                to: "/operations/hr/quality-objectives",
                label: "Quality Objectives",
                icon: <FileProtectOutlined />,
            },
            {
                key: "leave",
                label: "Leave Monitoring",
                icon: <BarChartOutlined />,
                children: [
                    {
                        key: "leave-requests",
                        to: "/operations/hr/leave",
                        label: "Requests",
                        icon: <QuestionCircleOutlined />,
                    },
                    {
                        key: "leave-calendar",
                        to: "/operations/hr/leave/calendar",
                        label: "Calendar",
                        icon: <CalendarOutlined />,
                    },
                ],
            },
            {
                key: "linkages",
                to: "/coordinator/interventions/linkages",
                label: "Linkages Portal",
                icon: <LinkOutlined />,
            },
            {
                key: "surveys-portal",
                to: "/operations/surveys",
                label: "Surveys Portal",
                icon: <LinkOutlined />,
            },
            {
                key: "course-builder",
                to: "/operations/training/courses",
                label: "Courses",
                icon: <ReadOutlined />,
            },
            {
                key: "engagement",
                to: "/operations/stakeholder",
                label: "Engagement",
                icon: <FundProjectionScreenOutlined />,
            },
            {
                key: "impact",
                to: "/operations/impact",
                label: "Impact Analytics",
                icon: <FundProjectionScreenOutlined />,
            },
            {
                key: "diagnostic",
                to: "/operations/plan",
                label: "Developmental Plan",
                icon: <AuditOutlined />,
                children: [
                    {
                        key: "gap",
                        to: "/operations/gap",
                        label: "GAP Analytics",
                        icon: <DotChartOutlined />,
                    },
                    {
                        key: "plan",
                        to: "/operations/plan",
                        label: "Plan Builder",
                        icon: <BlockOutlined />,
                    },
                ],
            },
            {
                key: "finance",
                to: "/operations/finance",
                label: "Finance",
                icon: <MoneyCollectOutlined />,
            },
            {
                key: "requests",
                to: "/operations/requests",
                label: "Requests",
                icon: <PhoneOutlined />,
            },
            {
                key: "programs",
                label: "Programs Onboarding",
                icon: <LaptopOutlined />,
                to: "/programs",
            },
            {
                key: "department-workroom",
                to: "/operations/tasks",
                label: "Team Workroom",
                icon: <LaptopOutlined />,
            },
            {
                key: "interventions",
                icon: <FileSearchOutlined />,
                label: "Interventions",
                children: [
                    {
                        key: "hod-active",
                        label: "My Interventions",
                        to: "/coordinator/allocated",
                        icon: <BlockOutlined />,
                    },
                    {
                        key: "appointments",
                        to: "/interventions/appointments",
                        label: "Appointments",
                        icon: <CalendarOutlined />,
                    },
                    {
                        key: "movs",
                        to: "/operations/movs",
                        label: "MOV(s)",
                        icon: <PaperClipOutlined />,
                    },
                    {
                        key: "interventions-req",
                        label: "Requests",
                        to: "/operations/requests",
                        icon: <SendOutlined />,
                    },
                    {
                        key: "interventions-manager",
                        label: "Setup",
                        to: "/operations/interventions",
                        icon: <GroupOutlined />,
                    },
                ],
            },
            {
                key: "monitoring-interventions",
                icon: <FileSearchOutlined />,
                label: "Interventions",
                children: [
                    {
                        key: "movs",
                        to: "/operations/monitoring/movs",
                        label: "MOVs Verification ",
                        icon: <PaperClipOutlined />,
                    },
                    {
                        key: "interventions-manager",
                        label: "Setup",
                        icon: <GroupOutlined />,
                    },
                ],
            },
            {
                key: "coordinators",
                to: "/operations/coordinators",
                label: "Coordinators",
                icon: <TeamOutlined />,
                children: [
                    {
                        key: "coordinators-db",
                        to: "/operations/coordinators",
                        label: "Manage",
                        icon: <DatabaseOutlined />,
                    },
                    {
                        key: "assignments",
                        to: "/operations/assignments",
                        label: "Assignments",
                        icon: <FileProtectOutlined />,
                    },
                    {
                        key: "department-workroom",
                        to: "/operations/tasks",
                        label: "Tasks",
                        icon: <LaptopOutlined />,
                    },
                ],
            },
            {
                key: "personnel",
                label: "Personnel",
                icon: <TeamOutlined />,
                children: [
                    {
                        key: "personnel",
                        label: "Coordinators",
                        to: "/operations/coordinators",
                        icon: <TeamOutlined />,
                    },
                    {
                        key: "users",
                        to: "/admin",
                        label: "Users",
                        icon: <UserOutlined />,
                    },
                    {
                        key: "activity",
                        to: "/operations/monitoring/activity",
                        label: "Activity",
                        icon: <LineChartOutlined />,
                    },
                    {
                        key: "hr-leave",
                        to: "/operations/hr/leave",
                        label: "Leave",
                        icon: <BulbOutlined />,
                    },
                ],
            },
            {
                key: "participants",
                to: "/participants",
                label: "Incubatees",
                icon: <UserOutlined />,
            },
            {
                key: "rom-participants",
                label: "Incubatees",
                icon: <UserOutlined />,
                children: [
                    {
                        key: "applications",
                        to: "/applications",
                        label: "Applications",
                        icon: <FormOutlined />,
                    },
                    {
                        key: "sme-incubatees",
                        to: "/participants",
                        label: "Overview",
                        icon: <AreaChartOutlined />,
                    },
                    {
                        key: "groups",
                        to: "/operations/groups",
                        label: "Groups",
                        icon: <FieldTimeOutlined />,
                    },
                ],
            },
            {
                key: "monitoring-participants",
                label: "Incubatees",
                icon: <UserOutlined />,
                children: [
                    {
                        key: "monitoring-participants",
                        to: "/participants",
                        label: "Incubatees",
                        icon: <DatabaseOutlined />,
                    },
                    {
                        key: "groups",
                        to: "/operations/groups",
                        label: "Groups",
                        icon: <FieldTimeOutlined />,
                    },
                    {
                        key: "compliance",
                        to: "/compliance",
                        label: "Compliance",
                        icon: <CheckSquareOutlined />,
                    },
                ],
            },
            // Monitoring & Compliance
            {
                key: "monitoring",
                label: "Monitoring",
                icon: <LineChartOutlined />,
                children: [
                    {
                        key: "compliance",
                        to: "/compliance",
                        label: "Compliance",
                        icon: <CheckSquareOutlined />,
                    },
                    {
                        key: "risk",
                        label: "Risk Register",
                        icon: <WarningOutlined />,
                        to: "/operations/participants/risk",
                    },
                ],
            },
            {
                key: "forms",
                to: "/operations/surveys",
                label: "Surveys Portal",
                icon: <LinkOutlined />,
            },
            {
                key: "applications",
                to: "/applications",
                label: "Applications",
                icon: <FormOutlined />,
            },
            {
                key: "system",
                to: "/system",
                label: "System Setup",
                icon: <BankOutlined />,
            },
            {
                key: "resources",
                to: "/operations/resources",
                label: "Resources",
                icon: <FundProjectionScreenOutlined />,
            },
            {
                key: "library",
                to: "/operations/library",
                label: "SME Library",
                icon: <BookOutlined />,
            },
            {
                key: "reports",
                label: "Analytics",
                icon: <ReadOutlined />,
                children: [
                    {
                        key: "reports",
                        to: "/operations/reports",
                        label: "Visualisations",
                        icon: <BarChartOutlined />,
                    },
                    {
                        key: "collaborative-reports",
                        to: "/operations/reports/collaborative",
                        label: "Collaborative",
                        icon: <ReadOutlined />,
                    },
                ],
            },
            {
                key: "data-export",
                to: "/data-export",
                label: "Data Export",
                icon: <CloudDownloadOutlined />,
            },
        ],
        receptionist: [
            {
                key: "dashboard",
                to: "/receptionist",
                label: "Home",
                icon: <HomeOutlined />,
            },
            {
                key: "leave",
                to: "/leave",
                label: "Leave Management",
                icon: <DoubleRightOutlined />,
            },
            {
                key: "timesheet",
                to: "/timesheet",
                label: "Timesheet",
                icon: <ClockCircleOutlined />,
            },
            {
                key: "calendar",
                to: "/calendar",
                label: "Calendar & Notices",
                icon: <CalendarOutlined />,
            },
            {
                key: "inquiries",
                to: "/receptionist/inquiries",
                label: "All Inquiries",
                icon: <FileTextOutlined />,
            },
            {
                key: "contacts",
                to: "/receptionist/contacts",
                label: "Contacts",
                icon: <UserOutlined />,
            },
            {
                key: "follow-ups",
                to: "/receptionist/follow-ups",
                label: "Follow-ups",
                icon: <ClockCircleOutlined />,
            },
            {
                key: "reports",
                to: "/receptionist/reports",
                label: "Analytics",
                icon: <ReadOutlined />,
            },
        ],
        employee: [
            {
                key: "timesheet",
                to: "/timesheet",
                label: "Timesheet",
                icon: <ClockCircleOutlined />,
            },
            {
                key: "leave",
                to: "/leave",
                label: "Leave",
                icon: <DoubleRightOutlined />,
            },
        ],
    };

    // Resolve every profile doc id this account could be known by (mirrors
    // the identity lookups already used on the MOV/appointment pages), using
    // indexed email-equality lookups rather than scanning whole collections.
    const resolveMenuOwnerIds = async (): Promise<string[]> => {
        const ids = new Set<string>();
        const uid = String((user as any)?.uid || (user as any)?.id || "").trim();
        if (uid) ids.add(uid);

        const email = String((user as any)?.email || "")
            .trim()
            .toLowerCase();
        if (email) {
            for (const collectionName of [
                "coordinators",
                "consultants",
                "operationsStaff",
            ]) {
                try {
                    const snap = await getDocs(
                        query(
                            collection(db, collectionName),
                            where("email", "==", email),
                            limit(1)
                        )
                    );
                    if (!snap.empty) ids.add(snap.docs[0].id);
                } catch {
                    // Best-effort - a missed identity just skips that source for the badge count.
                }
            }
        }

        return Array.from(ids);
    };

    useEffect(() => {
        const isFocusCountRole =
            role === "coordinator" ||
            role === "operations" ||
            role === "receptionist" ||
            role === "projectadmin";
        if (!isFocusCountRole) {
            setMenuFocusCounts({});
            return;
        }

        let cancelled = false;

        const loadMenuFocusCounts = async () => {
            try {
                const nextCounts: Record<string, number> = {};
                const programScope =
                    activeProgramId && activeProgramId !== "all" ? activeProgramId : null;

                if (role === "coordinator" || role === "operations") {
                    const ownerIds = await resolveMenuOwnerIds();

                    if (ownerIds.length) {
                        // Interventions-sidebar badges are a "needs attention" indicator for
                        // queried MOVs only — general open/in-progress assignment counts don't
                        // belong here, so only queried MOVs are counted below.
                        if (role === "coordinator") {
                            const movSnapshots = await Promise.all(
                                ownerIds.map((id) =>
                                    getDocs(
                                        query(
                                            collection(db, "movDocuments"),
                                            where("facilitatorId", "==", id)
                                        )
                                    )
                                )
                            );
                            const movDocs = new Map<string, any>();
                            movSnapshots.forEach((snap) => {
                                snap.docs.forEach((d) => movDocs.set(d.id, d.data()));
                            });
                            let queriedMovs = 0;
                            movDocs.forEach((data) => {
                                if (
                                    programScope &&
                                    String(data.programId || "") !== programScope
                                )
                                    return;
                                if (String(data.status || "") === "queried") queriedMovs += 1;
                            });
                            nextCounts["/coordinator/movs"] = queriedMovs;
                        }

                        if (role === "operations") {
                            const opsSnap = await getDocs(
                                query(
                                    collection(db, "movDocuments"),
                                    where(
                                        "departmentName",
                                        "==",
                                        (user as any).departmentName || ""
                                    )
                                )
                            );
                            let awaitingHod = 0;
                            opsSnap.docs.forEach((d) => {
                                const data = d.data() as any;
                                if (
                                    programScope &&
                                    String(data.programId || "") !== programScope
                                )
                                    return;
                                const relevant =
                                    data.smmeAccepted === true ||
                                    data.status === "approved" ||
                                    data.status === "queried";
                                if (relevant && data.approvedByHod !== true) awaitingHod += 1;
                            });
                            nextCounts["/operations/movs"] = awaitingHod;
                        }
                    }
                }

                // Receptionists and center coordinators (projectadmin) get a badge for
                // SME-submitted inquiries in their branch that haven't been acknowledged
                // yet (opened by staff, or replied to). Clears once acknowledged.
                if (
                    (role === "receptionist" || role === "projectadmin") &&
                    assignedBranchId
                ) {
                    const inquiriesSnap = await getDocs(
                        query(
                            collection(db, "inquiries"),
                            where("branchId", "==", assignedBranchId)
                        )
                    );
                    let newSmeInquiries = 0;
                    inquiriesSnap.docs.forEach((d) => {
                        const data = d.data() as any;
                        if (data.source === "SME" && !data.acknowledgedAt)
                            newSmeInquiries += 1;
                    });
                    nextCounts["/receptionist/inquiries"] = newSmeInquiries;
                }

                if (!cancelled) setMenuFocusCounts(nextCounts);
            } catch (error) {
                console.warn("Failed to load menu focus counts", error);
            }
        };

        loadMenuFocusCounts();
        return () => {
            cancelled = true;
        };
    }, [
        role,
        (user as any)?.uid,
        (user as any)?.id,
        (user as any)?.email,
        (user as any)?.departmentName,
        activeProgramId,
        assignedBranchId,
    ]);

    // Sums badge counts across a subtree so a collapsed parent (e.g.
    // "Interventions") still shows a total even before it's expanded.
    const getMenuFocusCount = (item: any): number => {
        if (item.to && menuFocusCounts[item.to]) return menuFocusCounts[item.to];
        if (Array.isArray(item.children)) {
            return item.children.reduce(
                (sum: number, child: any) => sum + getMenuFocusCount(child),
                0
            );
        }
        return 0;
    };

    type MenuAccess = {
        topLevel: string[];
        children?: Record<string, string[]>;
    };

    const uniq = (arr: string[]) => Array.from(new Set(arr));

    const SHARED_OPERATIONS_TOP = [
        "dashboard",
        "proposals",
        "timesheet",
        "diagnostic",
        "monitoring",
        "employee-performance",
        "interventions",
        "op-library",
        "kpis",
        "reports",
    ];

    const OPERATIONS_INTERVENTION_CHILDREN = [
        "hod-active",
        "appointments",
        "interventions-db",
        "movs",
        "interventions-req",
        "interventions-manager",
    ];

    const SHARED_COORDINATOR_TOP = [
        "dashboard",
        "tutorials",
        "documentation",
        "monitoring",
        "schedule",
        "timesheet",
        "diagnostic",
        "sme-engagement",
        "self-service",
        "interventions",
        "analytics",
    ];

    const OPERATIONS_ACCESS: Record<string, MenuAccess> = {
        "Financial Compliance": {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "coordinators",
                "finance",
            ],
            children: {
                coordinators: ["coordinators-db", "assignments"],
            },
        },

        HSE: {
            topLevel: [...SHARED_OPERATIONS_TOP, "coordinators", "jobs"],
        },

        HRM: {
            topLevel: [
                "dashboard",
                "timesheet",
                "employees",
                "system",
                "employee-performance",
                "leave",
                "reports",
            ],
        },

        "M&E": {
            topLevel: [
                "dashboard",
                "timesheet",
                "documentation",
                "surveys-portal",
                "department-workroom",
                "personnel",
                "inquiries",
                "kpis",
                "reports",
                "data-export",
                "monitoring-participants",
                "monitoring-interventions",
            ],
            children: {
                personnel: ["personnel", "users", "activity", "hr-leave"],
                "monitoring-participants": [
                    "monitoring-participants",
                    "groups",
                    "compliance",
                ],
                "monitoring-interventions": [
                    "interventions-db",
                    "movs",
                    "interventions-req",
                    "interventions-manager",
                ],
            },
        },

        IHF: {
            topLevel: [
                "dashboard",
                "timesheet",
                "verification",
                "requested",
                "user-management",
                "invoices",
                "reported",
            ],
        },

        "Market Linkages": {
            topLevel: [...SHARED_OPERATIONS_TOP, "coordinators", "linkages"],
            children: {
                coordinators: ["coordinators-db", "assignments"],
            },
        },

        "Stakeholder Engagement": {
            topLevel: ["dashboard", "timesheet", "engagement", "reports"],
        },

        "PDS (Personal Development Services)": {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "coordinators",
                "surveys-portal",
                "interventions",
            ],
            children: {
                coordinators: ["coordinators-db", "assignments"],
                interventions: OPERATIONS_INTERVENTION_CHILDREN,
            },
        },

        "Training Academy": {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "course-builder",
                "coordinators",
                "surveys-portal",
                "interventions",
            ],
            children: {
                coordinators: ["coordinators-db", "assignments"],
                interventions: OPERATIONS_INTERVENTION_CHILDREN,
            },
        },

        "Legal Advisory Services": {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "coordinators",
                "sme-incubatees",
                "interventions",
            ],
            children: {
                coordinators: ["coordinators-db", "assignments"],
                interventions: OPERATIONS_INTERVENTION_CHILDREN,
            },
        },

        "Wellness Services": {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "coordinators",
                "surveys-portal",
                "interventions",
            ],
            children: {
                coordinators: ["coordinators-db", "assignments"],
                interventions: OPERATIONS_INTERVENTION_CHILDREN,
            },
        },

        "Marketing and Communication": {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "coordinators",
                "surveys-portal",
                "interventions",
            ],
            children: {
                coordinators: ["coordinators-db", "assignments"],
                interventions: OPERATIONS_INTERVENTION_CHILDREN,
            },
        },

        ROM: {
            topLevel: [
                ...SHARED_OPERATIONS_TOP,
                "coordinators",
                "interventions",
                "monitoring",
                "rom-participants",
                "inquiries",
            ]
        },
    };

    const COORDINATOR_ACCESS: Record<string, MenuAccess> = {
        IHF: {
            topLevel: [...SHARED_COORDINATOR_TOP, "resources"],
        },
        ROM: {
            topLevel: [...SHARED_COORDINATOR_TOP, "smes"],
        },
        HSE: {
            topLevel: [...SHARED_COORDINATOR_TOP, "analytics", "jobs"],
        },
        "Financial Compliance": {
            topLevel: [...SHARED_COORDINATOR_TOP, "finance"],
        },
        DEFAULT: {
            topLevel: [...SHARED_COORDINATOR_TOP, "analytics"],
        },
    };

    const matchDepartmentKey = (departmentName?: string) => {
        if (!departmentName) return null;
        if (departmentName.startsWith("HSE")) return "HSE";
        if (departmentName.startsWith("HRM")) return "HRM";
        if (departmentName.startsWith("M&E")) return "M&E";
        if (departmentName.startsWith("IHF")) return "IHF";
        if (departmentName.startsWith("ROM")) return "ROM";
        return departmentName;
    };

    const buildMenuAccess = ({
        role,
        department,
        effectiveDepartment,
    }: {
        role?: string | null;
        department?: string | null;
        effectiveDepartment?: string | null;
    }): MenuAccess => {
        if (!role) return { topLevel: [] };

        if (role === "operations") {
            const deptKey = matchDepartmentKey(effectiveDepartment || undefined);
            const departmentAccess =
                deptKey && OPERATIONS_ACCESS[deptKey]
                    ? OPERATIONS_ACCESS[deptKey]
                    : { topLevel: SHARED_OPERATIONS_TOP };
            return {
                ...departmentAccess,
                topLevel: uniq(["proposals", "kpis", ...departmentAccess.topLevel]),
            };
        }

        if (role === "coordinator") {
            const deptKey = matchDepartmentKey(department || undefined);
            return (
                (deptKey && COORDINATOR_ACCESS[deptKey]) || COORDINATOR_ACCESS.DEFAULT
            );
        }

        return {
            topLevel: (allMenus[role] || []).map((m: any) => m.key),
        };
    };

    const filterMenuTree = (
        items: any[],
        access: MenuAccess,
        parentKey?: string
    ): any[] => {
        const allowedTop = new Set(access.topLevel || []);
        const allowedChildren = access.children || {};

        return items
            .map((item) => {
                const isTopLevel = !parentKey;

                if (isTopLevel) {
                    if (!allowedTop.has(item.key)) return null;

                    if (item.children) {
                        const allowedChildKeys = new Set(allowedChildren[item.key] || []);
                        const filteredChildren =
                            allowedChildKeys.size > 0
                                ? item.children.filter((child: any) =>
                                    allowedChildKeys.has(child.key)
                                )
                                : item.children;

                        return {
                            ...item,
                            children: filteredChildren,
                        };
                    }

                    return item;
                }

                return item;
            })
            .filter(Boolean) as any[];
    };

    const dedupeMenuTree = (items: any[]): any[] => {
        const seen = new Set<string>();

        const walk = (nodes: any[]): any[] =>
            nodes
                .map((node) => {
                    const signature = `${node.key}::${node.to || ""}::${String(
                        node.label || ""
                    )}`;
                    if (seen.has(signature)) return null;
                    seen.add(signature);

                    if (node.children) {
                        return {
                            ...node,
                            children: walk(node.children),
                        };
                    }

                    return node;
                })
                .filter(Boolean) as any[];

        return walk(items);
    };

    const availableMenus = useMemo<NavigationItem[]>(() => {
        if (!role) return [];

        const menuRole = role;
        let baseMenus = [...(allMenus[menuRole] || [])];

        if (role === "operations" || role === "coordinator") {
            const access = buildMenuAccess({
                role,
                department,
                effectiveDepartment,
            });

            baseMenus = filterMenuTree(baseMenus, access);
            baseMenus = dedupeMenuTree(baseMenus);
        }

        if (role === "projectadmin" && isMainCenterCoordinator) {
            const alreadyHasSystem = baseMenus.some((m) => m.key === "system");

            if (!alreadyHasSystem) {
                baseMenus = [
                    ...baseMenus,
                    {
                        key: "system",
                        to: "/system",
                        label: "System Setup",
                        icon: <BankOutlined />,
                    },
                ];
            }
        }

        return [
            ...baseMenus,
            {
                key: "chat",
                to: "/chat",
                label: "Data Assistant",
                icon: <OpenAIOutlined />,
            },
        ];
    }, [
        role,
        department,
        effectiveDepartment,
        isMainCenterCoordinator,
    ]);

    const flatNavigation = useMemo(() => {
        const out: NavigationDestination[] = [];
        const walk = (
            items: NavigationItem[],
            parentKey?: string | null,
            parentLabel?: string | null
        ) => {
            items.forEach((item) => {
                const itemLabel = navigationLabel(item);
                const destinationParentKey = item.children?.length
                    ? item.key
                    : parentKey ?? null;
                const destinationParentLabel = item.children?.length
                    ? itemLabel
                    : parentLabel ?? null;
                if (item.to) {
                    out.push({
                        key: item.key,
                        label: itemLabel,
                        route: item.to,
                        icon: item.icon,
                        parentKey: destinationParentKey,
                        parentLabel: destinationParentLabel,
                        attentionCount: getMenuFocusCount(item),
                    });
                }
                if (item.children) {
                    walk(
                        item.children,
                        parentKey || item.key,
                        parentLabel || itemLabel
                    );
                }
            });
        };
        walk(availableMenus);
        return out;
    }, [availableMenus, menuFocusCounts]);

    const primaryDestinations = useMemo(() => {
        if (!role) return [];
        const departmentKey = matchDepartmentKey(effectiveDepartment || department || undefined);
        const preferredKeys =
            role === "operations"
                ? OPERATIONS_PRIMARY_KEYS[departmentKey || ""] || OPERATIONS_PRIMARY_KEYS.DEFAULT
                : PRIMARY_NAV_KEYS[role] || [];

        const selected: NavigationDestination[] = [];
        preferredKeys.forEach((key) => {
            const destination = flatNavigation.find((item) => item.key === key);
            if (destination && !selected.some((item) => item.route === destination.route)) {
                selected.push(destination);
            }
        });

        if (role === "operations" && selected.length < 4) {
            flatNavigation.forEach((destination) => {
                if (
                    selected.length < 4 &&
                    destination.key !== "chat" &&
                    !selected.some((item) => item.route === destination.route)
                ) {
                    selected.push(destination);
                }
            });
        }

        return selected.slice(0, 4);
    }, [role, department, effectiveDepartment, flatNavigation]);

    const visiblePrimaryDestinations = useMemo(() => {
        // On mobile the nav lives in its own bottom bar, so it is not competing
        // with the topbar actions for width and can show the full set.
        const limit = isMobile ? 4 : isCompactHeader ? 3 : 4;
        return primaryDestinations.slice(0, limit);
    }, [primaryDestinations, isMobile, isCompactHeader]);

    const analyticsDropdownDestinations = useMemo(() => {
        if (role !== "operations") return [];
        return flatNavigation.filter(
            (destination) => destination.parentKey === "reports"
        );
    }, [role, flatNavigation]);

    const analyticsTriggerRoute = visiblePrimaryDestinations.find(
        (destination) =>
            destination.parentKey === "reports" &&
            analyticsDropdownDestinations.some(
                (item) => item.route === destination.route
            )
    )?.route;

    /*
      Departments whose dashboard runs on the shared InterventionsDashboard
      shell, which is what reads the reporting period.
      Add to this list as each department is migrated — a dashboard that
      consumes the period without exposing this control would silently use a
      window the user cannot see or change.
    */
    /*
      Departments whose /operations dashboard runs on the shared
      InterventionsDashboard shell, which is what reads the reporting period.
    */
    const DEPARTMENTS_WITH_PERIOD_FILTER = ["HSE", "Legal Advisory Services"];

    /*
      Routes that read the reporting period directly rather than through a
      department dashboard.
    */
    const ROUTES_WITH_PERIOD_FILTER = ["/projectadmin", "/operations"];

    /*
      Extend one of these lists as each page is migrated. A page that consumes
      the period without exposing this control would be filtered by a window its
      user can neither see nor change.
    */
    const showDashboardFilter =
        ROUTES_WITH_PERIOD_FILTER.includes(location.pathname) ||
        (role === "operations" &&
            location.pathname === "/operations" &&
            DEPARTMENTS_WITH_PERIOD_FILTER.includes(
                matchDepartmentKey(effectiveDepartment || department || undefined) || ""
            ));

    const activeDestination = useMemo(() => {
        const exact = flatNavigation.find((item) => item.route === location.pathname);
        if (exact) return exact;
        return flatNavigation
            .filter((item) => location.pathname.startsWith(`${item.route}/`))
            .sort((a, b) => b.route.length - a.route.length)[0];
    }, [flatNavigation, location.pathname]);

    const primaryRouteSet = useMemo(
        () => new Set(visiblePrimaryDestinations.map((item) => item.route)),
        [visiblePrimaryDestinations]
    );

    const primaryCoveredRouteSet = useMemo(() => {
        const routes = new Set(primaryRouteSet);
        if (analyticsTriggerRoute) {
            analyticsDropdownDestinations.forEach((destination) =>
                routes.add(destination.route)
            );
        }
        return routes;
    }, [primaryRouteSet, analyticsTriggerRoute, analyticsDropdownDestinations]);

    const moreSections = useMemo(() => {
        const grouped = new Map<string, NavigationDestination[]>();
        const seenRoutes = new Set<string>();
        flatNavigation.forEach((destination) => {
            if (
                destination.key === "chat" ||
                primaryCoveredRouteSet.has(destination.route) ||
                seenRoutes.has(destination.route)
            ) return;
            const section = compactSectionLabel(
                destination.parentLabel ||
                DIRECT_DESTINATION_SECTIONS[destination.key] ||
                "Tools"
            );
            const current = grouped.get(section) || [];
            current.push(destination);
            grouped.set(section, current);
            seenRoutes.add(destination.route);
        });
        return Array.from(grouped.entries())
            .map(([title, items]) => ({ title, items }))
            .sort((a, b) => {
                if (a.title === "Tools") return 1;
                if (b.title === "Tools") return -1;
                return 0;
            });
    }, [flatNavigation, primaryCoveredRouteSet]);

    const hasMoreDestinations = moreSections.some((section) => section.items.length > 0);
    // With only a couple of destinations (e.g. directors) section tabs add
    // nothing, so the launcher lists them side by side without sections.
    const allMoreItems = useMemo(
        () => moreSections.flatMap((section) => section.items),
        [moreSections]
    );
    const flattenMore = allMoreItems.length <= 2;
    const selectedMoreSection =
        moreSections.find((section) => section.title === moreSection) || moreSections[0];
    const selectedMoreItems = flattenMore ? allMoreItems : selectedMoreSection?.items || [];
    const morePageSize = isMobile ? 3 : MORE_PAGE_SIZE;
    const pagedMoreItems = selectedMoreItems.slice(
        (morePage - 1) * morePageSize,
        morePage * morePageSize
    );
    const routeActiveSegment =
        activeDestination?.key === "chat"
            ? "chat"
            : analyticsTriggerRoute &&
                activeDestination &&
                analyticsDropdownDestinations.some(
                    (destination) => destination.route === activeDestination.route
                )
                ? analyticsTriggerRoute
                : activeDestination && primaryRouteSet.has(activeDestination.route)
                    ? activeDestination.route
                    : hasMoreDestinations
                        ? "more"
                        : visiblePrimaryDestinations[0]?.route;
    const activeSegment = pendingSegment || routeActiveSegment;

    useEffect(() => {
        setPendingSegment(null);
    }, [location.pathname]);

    useEffect(() => {
        if (!moreSections.length) {
            setMoreSection(null);
            setMorePage(1);
            return;
        }
        if (!moreSections.some((section) => section.title === moreSection)) {
            setMoreSection(moreSections[0].title);
            setMorePage(1);
        }
    }, [moreSections, moreSection]);

    useEffect(() => {
        const lastPage = Math.max(1, Math.ceil(selectedMoreItems.length / morePageSize));
        setMorePage((current) => Math.min(current, lastPage));
    }, [selectedMoreItems.length, morePageSize]);

    const openMore = () => {
        const activeSection = moreSections.find((section) =>
            section.items.some((item) => item.route === activeDestination?.route)
        );
        const nextSection = activeSection || selectedMoreSection || moreSections[0];
        if (nextSection) {
            const activeIndex = nextSection.items.findIndex(
                (item) => item.route === activeDestination?.route
            );
            setMoreSection(nextSection.title);
            setMorePage(activeIndex >= 0 ? Math.floor(activeIndex / morePageSize) + 1 : 1);
        }
        setPendingSegment("more");
        setMoreOpen(true);
    };

    const closeMore = () => {
        setMoreOpen(false);
        setPendingSegment(null);
    };

    const programOptions = useMemo(() => {
        const base = visiblePrograms.map((p) => ({
            value: p.id,
            label: p.name || p.title || p.code || p.id,
        }));

        if (softLock || hardLock) return base;

        if (canUseAllProgramsScope) {
            return [{ value: "all", label: allProgramsLabel }, ...base];
        }

        return base;
    }, [
        visiblePrograms,
        softLock,
        hardLock,
        canUseAllProgramsScope,
        allProgramsLabel,
    ]);

    // ─────────────────────────────────────────────────────
    // Program Select handlers (guarded for locked roles)
    // ─────────────────────────────────────────────────────
    const handleProgramChange = (value?: string) => {
        if (hardLock) return;

        if (softLock) {
            if (!value || !scopedProgramIds.includes(value)) return;
            setActiveProgramId(value);
            return;
        }

        if (value === "all") {
            if (!canUseAllProgramsScope) return;
            setActiveProgramId("all");
            return;
        }

        if (!value) {
            if (canUseAllProgramsScope) {
                setActiveProgramId("all");
            } else if (firstVisibleProgramId) {
                setActiveProgramId(firstVisibleProgramId);
            }
            return;
        }

        if (!visiblePrograms.some((p) => p.id === value)) return;

        setActiveProgramId(value as ActiveProgramId);
    };

    const layoutReady = !!role && programsLoaded;
    if (!layoutReady) {
        return (
            <div
                style={{
                    display: "flex",
                    height: "100vh",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#fff",
                }}
            >
                <LoadingOverlay tip="Preparing your workspace..." />
            </div>
        );
    }

    const ProgramControl = () => {
        if (hardLock && !visiblePrograms.length) {
            return (
                <div className="workspace-program-control workspace-program-control-error">
                    <FundProjectionScreenOutlined className="workspace-program-icon" />
                    <strong>Unavailable</strong>
                </div>
            );
        }

        if (isRestrictedRole && !hasAssignedList) {
            return (
                <Tooltip
                    title={
                        role === "incubatee"
                            ? "No accepted application found yet"
                            : "No program has been assigned to your profile yet"
                    }
                >
                    <div className="workspace-program-control workspace-program-control-error">
                        <FundProjectionScreenOutlined className="workspace-program-icon" />
                        <strong>Not assigned</strong>
                    </div>
                </Tooltip>
            );
        }

        if (hardLock) {
            const only = scopedProgramIds[0];
            const label =
                resolveProgramLabel(
                    activeProgramId === "all" ? only : activeProgramId
                ) || "Program";

            return (
                <Tooltip title="Your program is locked by your assignment">
                    <div className="workspace-program-control workspace-program-control-locked">
                        <FundProjectionScreenOutlined className="workspace-program-icon" />
                        <strong title={label}>{label}</strong>
                        <LockOutlined className="workspace-program-lock" />
                    </div>
                </Tooltip>
            );
        }

        return (
            <div
                className="workspace-program-control workspace-program-control-selectable"
                title={resolveProgramLabel(activeProgramId) || "Select programme"}
            >
                <FundProjectionScreenOutlined className="workspace-program-icon" />
                <Select
                    aria-label="Select programme"
                    allowClear={false}
                    showSearch
                    size="middle"
                    variant="borderless"
                    loading={loadingPrograms}
                    value={activeProgramId}
                    onChange={handleProgramChange}
                    optionFilterProp="label"
                    options={programOptions}
                    placeholder="Select programme"
                    popupMatchSelectWidth={false}
                />
            </div>
        );
    };

    // One nav implementation, two presentations: the desktop topbar pill strip
    // and the mobile bottom bar (icon-only, active item expands to its label).
    const renderNavItems = (variant: "top" | "bottom") => {
        const isBottom = variant === "bottom";
        const base = isBottom ? "workspace-bottom-nav-item" : "workspace-primary-segment";
        const activeClass = isBottom
            ? "workspace-bottom-nav-item-active"
            : "workspace-primary-segment-active";
        const iconClass = isBottom ? "workspace-bottom-nav-icon" : "workspace-segment-icon";
        const labelClass = isBottom ? "workspace-bottom-nav-label" : undefined;

        return (
            <>
                {visiblePrimaryDestinations.map((destination) => {
                    const isAnalyticsDropdown =
                        destination.route === analyticsTriggerRoute &&
                        analyticsDropdownDestinations.length > 1;
                    const isActive = activeSegment === destination.route;
                    const label = isAnalyticsDropdown ? "Analytics" : destination.label;

                    const segment = (
                        <button
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-current={isBottom && isActive ? "page" : undefined}
                            aria-label={isBottom ? label : undefined}
                            aria-haspopup={isAnalyticsDropdown ? "menu" : undefined}
                            className={`${base} ${isActive ? activeClass : ""}`}
                            onClick={isAnalyticsDropdown
                                ? undefined
                                : () => {
                                    const route = destination.route;
                                    setPendingSegment(route);
                                    navigate(route);
                                }}
                        >
                            <span className={iconClass}>{destination.icon}</span>
                            <span className={labelClass}>{label}</span>
                            {isAnalyticsDropdown && !isBottom && (
                                <DownOutlined className="workspace-segment-chevron" />
                            )}
                            {destination.attentionCount > 0 && (
                                <Badge
                                    count={destination.attentionCount}
                                    size="small"
                                    overflowCount={99}
                                />
                            )}
                        </button>
                    );

                    if (!isAnalyticsDropdown) {
                        return <React.Fragment key={destination.route}>{segment}</React.Fragment>;
                    }

                    return (
                        <Dropdown
                            key={destination.route}
                            trigger={["click"]}
                            // A bottom bar has no room below it for a menu.
                            placement={isBottom ? "top" : "bottom"}
                            menu={{
                                selectable: true,
                                selectedKeys: activeDestination
                                    ? [activeDestination.route]
                                    : [],
                                items: analyticsDropdownDestinations.map((item) => ({
                                    key: item.route,
                                    icon: item.icon,
                                    label: item.label,
                                })),
                                onClick: ({ key }) => {
                                    setPendingSegment(destination.route);
                                    navigate(key);
                                },
                            }}
                        >
                            {segment}
                        </Dropdown>
                    );
                })}

                {hasMoreDestinations && (
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeSegment === "more"}
                        aria-label={isBottom ? "More" : undefined}
                        className={`${base} ${activeSegment === "more" ? activeClass : ""}`}
                        onClick={openMore}
                    >
                        <span className={iconClass}><AppstoreOutlined /></span>
                        <span className={labelClass}>More</span>
                    </button>
                )}
            </>
        );
    };

    const renderAssistantAction = () => (
        <Tooltip title={assistantWorking ? "Data Assistant is working" : "Data Assistant"}>
            <Badge
                count={assistantUnreadCount}
                dot={assistantWorking && assistantUnreadCount === 0}
                size="small"
                offset={[-1, 2]}
            >
                <Button
                    type="text"
                    shape="circle"
                    className={`workspace-assistant-button ${location.pathname === "/chat" ? "workspace-assistant-button-active" : ""}`}
                    icon={<OpenAIOutlined />}
                    onClick={() => {
                        setPendingSegment("chat");
                        navigate("/chat");
                    }}
                    aria-label={assistantUnreadCount > 0
                        ? `Open Data Assistant, ${assistantUnreadCount} completed response${assistantUnreadCount === 1 ? "" : "s"}`
                        : "Open Data Assistant"}
                />
            </Badge>
        </Tooltip>
    );

    const renderLogoutAction = () => (
        <Tooltip title="Log out">
            <Button
                type="text"
                danger
                shape="circle"
                className="workspace-logout-button"
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                aria-label="Log out"
            />
        </Tooltip>
    );

    return (
        <Layout className="workspace-shell" style={{ minHeight: "100vh", background: pageBg }}>
            {!/^\/operations\/training\/courses\/builder(?:\/|$)/.test(location.pathname) && !isImmersiveChatMobile && (
                <div className="workspace-header-wrap">
                    <header
                        className={`workspace-topbar ${isMobile ? "workspace-topbar-mobile workspace-topbar-nonav" : ""} ${isIncubateeMobileHeader ? "workspace-topbar-incubatee-mobile" : ""}`}
                    >
                        {isIncubateeMobileHeader ? (
                            <>
                                <div className="workspace-incubatee-mobile-left">
                                    <CurrentUser />
                                    {renderAssistantAction()}
                                </div>

                                <button
                                    type="button"
                                    className="workspace-brand workspace-incubatee-mobile-brand"
                                    onClick={() => primaryDestinations[0] && navigate(primaryDestinations[0].route)}
                                    aria-label="Go to dashboard"
                                >
                                    <img src="/assets/images/lepharo.png" alt="Lepharo" />
                                </button>

                                <div className="workspace-incubatee-mobile-right">
                                    <ThemeToggle compact />
                                    {renderLogoutAction()}
                                </div>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="workspace-brand"
                                    onClick={() => primaryDestinations[0] && navigate(primaryDestinations[0].route)}
                                    aria-label="Go to dashboard"
                                >
                                    <img src="/assets/images/lepharo.png" alt="Lepharo" />
                                </button>

                                {!isMobile && (
                                    <div
                                        className="workspace-primary-nav"
                                        aria-label="Primary navigation"
                                        role="tablist"
                                    >
                                        {renderNavItems("top")}
                                    </div>
                                )}

                                <div className="workspace-topbar-actions">
                                    {renderAssistantAction()}
                                    <ProgramControl />
                                    {showDashboardFilter && (
                                        <DashboardFilterControl compact={isCompactHeader} />
                                    )}
                                    <GuideLauncher
                                        label={isCompactHeader ? "" : "Guide"}
                                        buttonProps={{
                                            type: "text",
                                            shape: "round",
                                            style: {
                                                height: 32,
                                                paddingInline: isCompactHeader ? 10 : 14,
                                                flex: "0 0 auto",
                                            },
                                            "aria-label": "Guide",
                                        }}
                                    />
                                    <ViewAsControls compact={isCompactHeader} />
                                    <ThemeToggle compact={isCompactHeader} />
                                    <CurrentUser />
                                    {renderLogoutAction()}
                                </div>
                            </>
                        )}
                    </header>
                </div>
            )}

            <Content
                style={{
                    background: pageBg,
                    flex: "1 1 auto",
                    minHeight: 0,
                    // Clears the fixed mobile bottom nav so the last row of a
                    // page is never trapped underneath it. Immersive chat has
                    // no bottom nav to clear (its composer docks flush to the
                    // bottom of its own screen instead).
                    paddingBottom: isMobile
                        && !isImmersiveChatMobile
                        && !/^\/operations\/training\/courses\/builder(?:\/|$)/.test(location.pathname)
                        ? "calc(84px + env(safe-area-inset-bottom))"
                        : 0,
                    overflow:
                        location.pathname === "/chat"
                            ? "hidden"
                            : undefined,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div
                    style={{
                        background: pageBg,
                        flex: "1 1 auto",
                        minHeight: 0,
                        width: "100%",

                        // Important: lets the routed page itself stretch.
                        display: "flex",
                        flexDirection: "column",

                        boxShadow: "none",

                        height:
                            location.pathname === "/chat"
                                ? "100%"
                                : undefined,
                    }}
                >
                    <Suspense fallback={<RouteFallback />}>
                        <Outlet />
                    </Suspense>
                </div>
            </Content>

            {/* ---- Mobile bottom navigation ---- */}
            {isMobile && !isImmersiveChatMobile && !/^\/operations\/training\/courses\/builder(?:\/|$)/.test(location.pathname) && (
                <nav className="workspace-bottom-nav" aria-label="Primary navigation" role="tablist">
                    {renderNavItems("bottom")}
                </nav>
            )}

            <Modal
                open={moreOpen}
                onCancel={closeMore}
                footer={null}
                centered
                width={1120}
                className="workspace-more-modal"
                title={
                    <div className="workspace-more-heading">
                        <span className="workspace-more-heading-icon"><AppstoreOutlined /></span>
                        <span>
                            <strong>Explore your workspace</strong>
                            <small>Open the tools and pages available for your role.</small>
                        </span>
                    </div>
                }
                styles={{ body: { overflow: "hidden" } }}
            >
                <div className="workspace-more-content">
                    {!flattenMore && <div className="workspace-more-segmented" role="tablist">
                        {moreSections.map((section) => {
                            const isActive = selectedMoreSection?.title === section.title;
                            return (
                                <button
                                    key={section.title}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    title={section.title}
                                    className={`workspace-more-segment ${isActive ? "workspace-more-segment-active" : ""}`}
                                    onClick={() => {
                                        setMoreSection(section.title);
                                        setMorePage(1);
                                    }}
                                >
                                    {section.title}
                                </button>
                            );
                        })}
                    </div>}

                    <section className="workspace-more-section">
                        <div className="workspace-more-grid">
                            {pagedMoreItems.map((destination) => (
                                <button
                                    type="button"
                                    key={`${destination.key}-${destination.route}`}
                                    className={`workspace-more-card ${activeDestination?.route === destination.route ? "workspace-more-card-active" : ""}`}
                                    onClick={() => {
                                        setMoreOpen(false);
                                        setPendingSegment("more");
                                        navigate(destination.route);
                                    }}
                                >
                                    <span className="workspace-more-card-icon">{destination.icon}</span>
                                    <span className="workspace-more-card-copy">
                                        <strong>{destination.label}</strong>
                                        <small>
                                            {NAV_DESCRIPTIONS[destination.key] ||
                                                `Use ${destination.label} to review related records, monitor progress, and complete the actions available to your role.`}
                                        </small>
                                    </span>
                                    {destination.attentionCount > 0 && (
                                        <Badge count={destination.attentionCount} size="small" />
                                    )}
                                    <RightOutlined className="workspace-more-card-arrow" />
                                </button>
                            ))}
                        </div>

                        {selectedMoreItems.length > morePageSize && (
                            <Pagination
                                current={morePage}
                                pageSize={morePageSize}
                                total={selectedMoreItems.length}
                                showSizeChanger={false}
                                hideOnSinglePage
                                onChange={setMorePage}
                                className="workspace-more-pagination"
                            />
                        )}
                    </section>
                </div>
            </Modal>
        </Layout>
    );
};
