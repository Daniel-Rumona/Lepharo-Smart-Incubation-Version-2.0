import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Layout,
    Menu,
    Typography,
    Spin,
    Button,
    Drawer,
    Select,
    Tag,
    Tooltip,
    Badge,
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
    serverTimestamp,
    updateDoc,
    where,
} from "firebase/firestore";
import { db } from "@/firebase";
import { Link, Outlet, useLocation } from "react-router-dom";
import { CurrentUser } from "@/components/layout/current-user";
import { useWindowSize } from "react-use";
import {
    MenuUnfoldOutlined,
    MenuFoldOutlined,
    DashboardOutlined,
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
    SettingOutlined,
    FileOutlined,
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
} from "@ant-design/icons";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { safeLocal } from "@/utils/safeStorage";
import { LoadingOverlay } from "../shared/LoadingOverlay";
import { endSession } from "@/utils/sessionTracking";
import {
    ViewAsBanner,
    ViewAsControls,
} from "@/components/view-as/ViewAsControls";
import { GuideLauncher } from "@/components/guide-me";

const { Sider, Content } = Layout;
const { Title } = Typography;

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
};

type ActiveProgramId = string | "all";

const PROGRAM_STORAGE_KEY = "activeProgramId";

export const CustomLayout: React.FC = () => {
    const pageBg = "#fff";
    const { width } = useWindowSize();
    const isMobile = width < 768;
    const { user } = useFullIdentity();
    const { mutate: logout } = useLogout();

    const [role, setRole] = useState<UserRole | null>(null);
    const [department, setDepartment] = useState<string | null>(null);

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

    const [collapsed, setCollapsed] = useState(false);
    const [drawerVisible, setDrawerVisible] = useState(false);

    const location = useLocation();
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [openKeys, setOpenKeys] = useState<string[]>([]);

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
        return activePrograms;
    }, [
        programs,
        scopedProgramIds,
        hardLock,
        softLock,
        isRestrictedRole,
        hasAssignedList,
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

    useEffect(() => {
        if (!isMobile) return;
        setDrawerVisible(false);
    }, [location.pathname, isMobile]);

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
                return (
                    <Tag
                        color="red"
                        style={{
                            marginRight: 8,
                            height: 32,
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: 999,
                        }}
                    >
                        Program unavailable
                    </Tag>
                );
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

    // Header title (unchanged)
    const getDashboardTitle = (r: UserRole | null) => {
        if (!r) return "";
        const nameMap = {
            projectadmin: "Center Coordinator",
            coordinator: "Project Coordinator",
            funder: "Sponsor",
            operations: "Operations",
            employee: "Employee",
            admin: "Admin",
            system_admin: "System Admin",
            director: "CEO",
            incubatee: "Incubatee",
            receptionist: "Receptionist",
        } as const;
        const hour = new Date().getHours();
        const salutation =
            hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
        const roleTitle = nameMap[r as keyof typeof nameMap] || "Dashboard";
        return department ? `${salutation}, ${user?.name}` : `${roleTitle}`;
    };

    // Simplified menu
    const allMenus = {
        system_admin: [
            {
                key: "dashboard",
                to: "/admin",
                label: "Dashboard",
                icon: <DashboardOutlined />,
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
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
                        label: "Assigned To Me",
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
            },
            {
                key: "documentation",
                to: "/operations/documentation",
                label: "Documents Hub",
                icon: <FileSearchOutlined />,
            },
            {
                key: "reports",
                to: "/director/reports",
                label: "Analytics",
                icon: <BarChartOutlined />,
            },
            {
                key: "interventions-db",
                to: "/interventions",
                label: "Interventions Overview",
                icon: <DatabaseOutlined />,
            },
            {
                key: "user-management",
                to: "/admin",
                label: "User Management",
                icon: <UserOutlined />,
            },
            {
                key: "quality-objectives",
                to: "/director/hr/quality-objectives",
                label: "Quality Objectives",
                icon: <FileProtectOutlined />,
            },
            {
                key: "system",
                to: "/system",
                label: "System Setup",
                icon: <BankOutlined />,
            },
        ],

        incubatee: [
            {
                key: "dashboard",
                to: "/incubatee",
                label: "My Dashboard",
                icon: <DashboardOutlined />,
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
                key: "roadmap",
                to: "/incubatee/roadmap",
                label: "Roadmap",
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
            },
            {
                key: "proposals",
                to: "/proposals",
                label: "Proposal Pipeline",
                icon: <FileTextOutlined />,
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
            // {
            //     key: "employee-performance",
            //     to: "/operations/hr/performance",
            //     label: "Performance",
            //     icon: <TrophyOutlined />,
            // },
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
                        label: "Assigned",
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
                        label: <Link to="/operations/interventions">Setup</Link>,
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
                        label: "Analytics",
                        icon: <ReadOutlined />,
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
                label: "Dashboard",
                icon: <DashboardOutlined />,
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

    const renderMenu = (items: any[]): any[] =>
        items.map((item: any) => {
            const count = getMenuFocusCount(item);

            if (item.children) {
                return {
                    key: item.key,
                    icon: item.icon,
                    label:
                        count > 0 ? (
                            <Badge count={count} size="small" offset={[10, 2]}>
                                <span className="menu-label-text">{item.label}</span>
                            </Badge>
                        ) : (
                            item.label
                        ),
                    children: renderMenu(item.children),
                };
            }

            return {
                key: item.key,
                icon: item.icon,
                label: item.to ? (
                    <Link to={item.to}>
                        {count > 0 ? (
                            <Badge count={count} size="small" offset={[10, 2]}>
                                <span className="menu-label-text">{item.label}</span>
                            </Badge>
                        ) : (
                            <span className="menu-label-text">{item.label}</span>
                        )}
                    </Link>
                ) : (
                    <span className="menu-label-text">{item.label}</span>
                ),
            };
        });

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
                topLevel: uniq(["proposals", ...departmentAccess.topLevel]),
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

    const menuItems = useMemo(() => {
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

        const built = [
            ...renderMenu(baseMenus),
            {
                key: "chat",
                label: <Link to="/chat">Data Assistant</Link>,
                icon: <OpenAIOutlined />,
            },
        ];

        return built;
    }, [
        role,
        department,
        effectiveDepartment,
        isMainCenterCoordinator,
        menuFocusCounts,
    ]);

    // Flatten menu for selection mapping (unchanged)
    const extractRoute = (node: React.ReactNode): string | undefined =>
        React.isValidElement(node) ? (node.props as any)?.to : undefined;

    const flatMenu = useMemo(() => {
        type Flat = { key: string; route?: string; parent?: string | null };
        const out: Flat[] = [];
        const walk = (items: any[], parent?: string | null) => {
            items.forEach((it) => {
                const route = extractRoute(it.label);
                out.push({ key: it.key, route, parent: parent ?? null });
                if (it.children) walk(it.children, it.key);
            });
        };
        walk(menuItems);
        return out;
    }, [menuItems]);

    useEffect(() => {
        const path = location.pathname;
        const candidates = flatMenu.filter((f) => !!f.route) as Array<{
            key: string;
            route: string;
            parent?: string | null;
        }>;
        let best = candidates.find((c) => c.route === path);
        if (!best) {
            const pref = candidates
                .filter((c) => path.startsWith(c.route))
                .sort((a, b) => b.route.length - a.route.length)[0];
            if (pref) best = pref;
        }
        if (best) {
            setSelectedKeys([best.key]);
            const chain: string[] = [];
            let p = best.parent;
            while (p) {
                chain.push(p);
                p = flatMenu.find((f) => f.key === p)?.parent ?? null;
            }
            setOpenKeys(chain);
        } else {
            setSelectedKeys([]);
            setOpenKeys([]);
        }
    }, [location.pathname, flatMenu]);

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

    const siderWidth = 250;
    const headerHeight = 56;
    const edgeGap = 12;

    const ProgramControl = () => {
        if (isRestrictedRole && !hasAssignedList) {
            return (
                <Tooltip
                    title={
                        role === "incubatee"
                            ? "No accepted application found yet"
                            : "No program has been assigned to your profile yet"
                    }
                >
                    <Tag
                        color="red"
                        style={{
                            marginRight: 8,
                            height: 32,
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: 999,
                        }}
                    >
                        No Program
                    </Tag>
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
                    <Tag
                        icon={<LockOutlined />}
                        color="processing"
                        style={{
                            marginRight: 8,
                            height: 32,
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: 999,
                        }}
                    >
                        {label}
                    </Tag>
                </Tooltip>
            );
        }

        return (
            <Select
                allowClear={false}
                showSearch
                loading={loadingPrograms}
                value={activeProgramId}
                onChange={handleProgramChange}
                optionFilterProp="label"
                style={{ minWidth: isMobile ? 160 : 240, marginRight: 8 }}
                options={programOptions}
                placeholder="Select Program"
            />
        );
    };

    const renderDesktopSider = () => (
        <Sider
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            collapsedWidth={80}
            width={siderWidth}
            trigger={null}
            style={{
                // let the card inside cast the shadow; keep the outer transparent
                background: "transparent",
                height: "100vh",
                position: "fixed",
                left: 0,
                top: 0,
                zIndex: 100,
                padding: edgeGap,
                boxSizing: "border-box",
            }}
        >
            {/* vertical pill card */}
            <div
                className={`sider-card ${collapsed ? "sider-card-collapsed" : ""}`}
                style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    background: "#fff",
                    border: "1px solid #eee",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
                    borderRadius: collapsed ? 28 : 20,
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        height: headerHeight,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 8,
                        borderBottom: "1px solid #f0f0f0",
                    }}
                >
                    <img
                        src="/assets/images/lepharo.png"
                        alt="Logo"
                        style={{
                            maxHeight: "100%",
                            maxWidth: "100%",
                            height: "auto",
                            width: collapsed ? 40 : 120,
                            transition: "width .2s ease-in-out",
                            objectFit: "contain",
                        }}
                    />
                </div>

                {/* scrollable menu area */}
                <div style={{ flex: 1, overflow: "auto" }}>
                    <Menu
                        theme="light"
                        mode="inline"
                        items={menuItems}
                        style={{
                            borderRight: "none",
                            background: "transparent",
                            padding: 6,
                        }}
                        selectedKeys={selectedKeys}
                        openKeys={openKeys}
                        onOpenChange={(keys) => setOpenKeys(keys as string[])}
                        inlineIndent={16}
                    />
                </div>

                <div style={{ padding: 12, borderTop: "1px solid #f0f0f0" }}>
                    <Button block danger onClick={handleLogout} shape="round">
                        {collapsed ? <LogoutOutlined /> : "Logout"}
                    </Button>
                </div>
            </div>
        </Sider>
    );

    const renderMobileDrawer = () => (
        <Drawer
            placement="left"
            closable={false}
            onClose={() => setDrawerVisible(false)}
            open={drawerVisible}
            width={280}
            styles={{ body: { padding: edgeGap, background: pageBg } }}
            destroyOnClose
        >
            {/* One cohesive card that holds header, menu (scroll), and footer buttons */}
            <div
                className="sider-card"
                style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    background: "#fff",
                    border: "1px solid #eee",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
                    borderRadius: 20,
                    overflow: "hidden",
                }}
            >
                {/* Header / logo */}
                <div
                    style={{
                        height: headerHeight,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 8,
                        borderBottom: "1px solid #f0f0f0",
                    }}
                >
                    <img
                        src="/assets/images/lepharo.png"
                        alt="Logo"
                        style={{
                            maxHeight: "100%",
                            maxWidth: "100%",
                            height: "auto",
                            width: 120,
                            objectFit: "contain",
                        }}
                    />
                </div>

                {/* Scrollable menu area */}
                <div style={{ flex: 1, overflow: "auto" }}>
                    <Menu
                        theme="light"
                        mode="inline"
                        items={menuItems}
                        style={{
                            borderRight: "none",
                            background: "transparent",
                            padding: 6,
                        }}
                        selectedKeys={selectedKeys}
                        openKeys={openKeys}
                        onOpenChange={(keys) => setOpenKeys(keys as string[])}
                        inlineIndent={16}
                    />
                </div>

                {/* Footer actions inside the SAME card */}
                <div style={{ padding: 12, borderTop: "1px solid #f0f0f0" }}>
                    <Button
                        block
                        danger
                        onClick={handleLogout}
                        icon={<LogoutOutlined />}
                        shape="round"
                    >
                        Logout
                    </Button>
                </div>
            </div>
        </Drawer>
    );

    return (
        <Layout style={{ height: "100vh", background: pageBg }}>
            {/* Desktop Sider */}
            {!isMobile && renderDesktopSider()}

            {/* Mobile Drawer */}
            {isMobile && renderMobileDrawer()}
            <Layout
                style={{
                    marginLeft: isMobile ? 0 : collapsed ? 80 : siderWidth,
                    transition: "all 0.2s ease-in-out",
                    background: pageBg,
                }}
            >
                {/* Sticky header pill (unchanged visuals) */}
                <div
                    style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 200,
                        background: pageBg,
                        padding: `${edgeGap}px ${edgeGap}px ${edgeGap}px`,
                    }}
                >
                    <div
                        style={{
                            height: headerHeight,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "0 12px",
                            borderRadius: 9999,
                            background: "#fff",
                            border: "1px solid #eee",
                            boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
                            overflow: "hidden",
                        }}
                    >
                        <Button
                            data-view-as-control="true"
                            type="text"
                            icon={
                                isMobile ? (
                                    <MenuUnfoldOutlined />
                                ) : collapsed ? (
                                    <MenuUnfoldOutlined />
                                ) : (
                                    <MenuFoldOutlined />
                                )
                            }
                            onClick={() =>
                                isMobile ? setDrawerVisible(true) : setCollapsed(!collapsed)
                            }
                            style={{ fontSize: 18, width: 40, height: 40, borderRadius: 999 }}
                        />
                        <Title
                            level={5}
                            style={{
                                margin: 0,
                                flex: 1,
                                textAlign: "center",
                                fontSize: isMobile ? 14 : 16,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {`${getDashboardTitle(role)}`}
                        </Title>

                        {/* Program filter */}
                        <ProgramControl />

                        {/* Context-aware page guide */}
                        <GuideLauncher
                            label={isMobile ? "" : "Guide Me"}
                            buttonProps={{
                                type: "text",
                                shape: "round",
                                style: {
                                    height: 36,
                                    paddingInline: isMobile ? 10 : 14,
                                    flex: "0 0 auto",
                                },
                                "aria-label": "Guide Me",
                            }}
                        />

                        <ViewAsControls compact={isMobile} />
                        <CurrentUser />
                    </div>
                </div>

                <ViewAsBanner />

                <Content
                    style={{
                        background: pageBg,
                        minHeight: location.pathname === "/chat" ? 0 : "100vh",
                        paddingBottom: location.pathname === "/chat" ? 0 : 16,
                        overflow: location.pathname === "/chat" ? "hidden" : undefined,
                    }}
                >
                    <div
                        style={{
                            background: "#fff",
                            boxShadow:
                                location.pathname === "/chat"
                                    ? "none"
                                    : "0 1px 3px rgba(0,0,0,0.05)",
                            height: location.pathname === "/chat" ? "100%" : undefined,
                            minHeight:
                                location.pathname === "/chat"
                                    ? 0
                                    : `calc(100vh - ${headerHeight + (isMobile ? 32 : 48)}px)`,
                        }}
                    >
                        <Outlet />
                    </div>
                </Content>
            </Layout>
        </Layout>
    );
};
