import React, { useEffect, useMemo, useState } from "react";
import {
    DragDropContext,
    Droppable,
    Draggable,
    type DropResult,
} from "@hello-pangea/dnd";
import {
    Card,
    DatePicker,
    Form,
    Input,
    Button,
    Select,
    Table,
    Space,
    message,
    Tag,
    Modal,
    Switch,
    Popconfirm,
    Row,
    Col,
    Statistic,
    InputNumber,
    Divider,
    Typography,
} from "antd";
import dayjs from "dayjs";
import {
    collection,
    addDoc,
    getDocs,
    updateDoc,
    doc,
    query,
    where,
    deleteDoc,
    Timestamp,
    getDoc,
    writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
    DeleteOutlined,
    EditOutlined,
    PlusCircleOutlined,
    FileDoneOutlined,
    ReloadOutlined,
    HolderOutlined,
    UnorderedListOutlined,
} from "@ant-design/icons";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import {
    MetricsGrid,
    type DashboardMetric,
} from "@/components/dashboards/metrics/MetricsGrid";
import { Helmet } from "react-helmet";
import { LoadingOverlay } from "@/components/shared/LoadingOverlay";
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration,
} from "@/components/guide-me";

const { Option } = Select;
const { Text } = Typography;

type RecurrenceUnit = "day" | "week" | "month" | "quarter" | "year";
type RecurrencePreset =
    | "as-needed"
    | "weekly"
    | "bi-weekly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "custom";
type SupportedFrequency = "as-needed" | "weekly" | "bi-weekly" | "monthly";
type RecurrenceEndMode =
    | "fixed-cycles"
    | "end-date"
    | "until-closed"
    | "programme-end";

type SubInterventionTemplate = {
    subId: string;
    title: string;
    description?: string;
    active?: boolean;
    archivedAt?: any;
    defaultPlannedSessions?: number;
};

type InterventionDoc = {
    id: string;
    interventionTitle: string;
    areaOfSupport: string;
    departmentId?: string | null;
    compulsory?: boolean;
    recurring?: boolean;

    recurrencePreset?: RecurrencePreset | null;
    recurrence?: { every: number; unit: RecurrenceUnit } | null;
    recurrenceFrequency?: "monthly" | "weekly" | "bi-weekly" | "other" | null;
    frequency?: "as-needed" | "weekly" | "bi-weekly" | "monthly" | null;
    recurrenceStrict?: boolean | null;
    recurrenceEnd?: {
        mode: RecurrenceEndMode;
        cycles?: number | null;
        endDate?: any;
    } | null;

    hasSubInterventions?: boolean;
    subInterventions?: SubInterventionTemplate[];
    definitionVersion?: number;
    defaultPlannedSessions?: number;
    /** Whether each new cycle rotates through sub-interventions or repeats the same scope every time. Only meaningful when hasSubInterventions is true. */
    subInterventionRotationMode?: "rotate" | "repeat";

    assignmentMode?: InterventionAssignmentMode;

    createdAt?: any;
    updatedAt?: any;
};

type InterventionAssignmentMode = "once-off" | "ad-hoc" | "recurring";

const presetToRecurrence = (
    preset: RecurrencePreset
): { every: number; unit: RecurrenceUnit } | null => {
    if (preset === "weekly") return { every: 1, unit: "week" };
    if (preset === "bi-weekly") return { every: 2, unit: "week" };
    if (preset === "monthly") return { every: 1, unit: "month" };
    if (preset === "quarterly") return { every: 1, unit: "quarter" };
    if (preset === "yearly") return { every: 1, unit: "year" };
    return null;
};

const derivePresetFromRecurrence = (
    recurrence: { every: number; unit: RecurrenceUnit } | null | undefined
): RecurrencePreset => {
    if (!recurrence) return "custom";
    if (recurrence.unit === "week" && recurrence.every === 1) return "weekly";
    if (recurrence.unit === "week" && recurrence.every === 2) return "bi-weekly";
    if (recurrence.unit === "month" && recurrence.every === 1) return "monthly";
    if (recurrence.unit === "quarter" && recurrence.every === 1)
        return "quarterly";
    if (recurrence.unit === "year" && recurrence.every === 1) return "yearly";
    return "custom";
};

const legacyFrequencyToRecurrence = (
    f: InterventionDoc["recurrenceFrequency"]
): { every: number; unit: RecurrenceUnit } | null => {
    if (!f) return null;
    if (f === "weekly") return { every: 1, unit: "week" };
    if (f === "bi-weekly") return { every: 2, unit: "week" };
    if (f === "monthly") return { every: 1, unit: "month" };
    return null;
};

const formatRecurrence = (
    rec: { every: number; unit: RecurrenceUnit } | null | undefined
) => {
    if (!rec) return "";
    const unitLabel =
        rec.unit === "day"
            ? "day(s)"
            : rec.unit === "week"
                ? "week(s)"
                : rec.unit === "month"
                    ? "month(s)"
                    : rec.unit === "quarter"
                        ? "quarter(s)"
                        : "year(s)";

    return rec.every === 1
        ? `Every ${unitLabel}`
        : `Every ${rec.every} ${unitLabel}`;
};

const isMonthlyCalendar = (
    rec: { every: number; unit: RecurrenceUnit } | null | undefined
) => !!rec && rec.unit === "month" && rec.every === 1;

const strictLabelFor = (
    rec: { every: number; unit: RecurrenceUnit } | null | undefined
) => {
    if (isMonthlyCalendar(rec)) return "Required Every Month";
    return "Required Every Cycle";
};

const strictExtraFor = (
    rec: { every: number; unit: RecurrenceUnit } | null | undefined
) => {
    if (isMonthlyCalendar(rec)) {
        return "On: expected monthly (Jan, Feb, Mar...). Off: optional monthly; can run in Jan and again in Apr without any day-count rule.";
    }
    return "On: expected on each cycle. Off: optional; can be skipped and assigned only when needed.";
};

const makeSubId = () =>
    `sub_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const normalizeSubList = (subs: any[]): SubInterventionTemplate[] => {
    const safe = (subs || [])
        .filter((s) => s && String(s.title || "").trim())
        .map((s) => ({
            subId: String(s.subId || makeSubId()),
            title: String(s.title || "").trim(),
            description: String(s.description || "").trim() || "",
            active: s.active !== false && !s.archivedAt,
            archivedAt: s.archivedAt || null,
            defaultPlannedSessions: Math.max(
                1,
                Number(s.defaultPlannedSessions) || 1
            ),
        }));

    // Preserve the order the department entered/arranged them in - this is
    // the delivery order used for sub-intervention rotation, not alphabetical.
    return safe;
};

const activeSubList = (subs: any[]) =>
    normalizeSubList(subs).filter(
        (sub) => sub.active !== false && !sub.archivedAt
    );

const mergeSubInterventionsForSave = (
    previous: any[],
    submitted: SubInterventionTemplate[]
) => {
    const now = Timestamp.now();
    const previousSubs = normalizeSubList(previous);
    const submittedById = new Map(submitted.map((sub) => [sub.subId, sub]));

    const active = submitted.map((sub) => ({
        ...sub,
        active: true,
        archivedAt: null,
    }));

    const archived = previousSubs
        .filter((sub) => !submittedById.has(sub.subId))
        .map((sub) => ({
            ...sub,
            active: false,
            archivedAt: sub.archivedAt || now,
        }));

    return [...active, ...archived];
};

const normalize = (s?: string) =>
    String(s ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

const makeInterventionKey = (title?: string, departmentId?: string) =>
    `${normalize(title)}__${String(departmentId || "").trim()}`;

const InterventionsManager: React.FC = () => {
    const { user } = useFullIdentity();
    const [form] = Form.useForm();

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: "interventions-manager",
            pageTitle: "Interventions Manager",
            guides: [
                {
                    id: "interventions-manager-overview",
                    title: "Quick tour",
                    description:
                        "Understand the intervention repository, filters, schedules and definition controls available to your department.",
                    kind: "page",
                    order: 1,
                    steps: [
                        {
                            element: guideTarget("intervention-metrics"),
                            popover: {
                                title: "Intervention overview",
                                description:
                                    "These metrics show the number of intervention definitions in your department scope and how many are recurring.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-filters"),
                            popover: {
                                title: "Find an intervention",
                                description:
                                    "Search by intervention or department, then narrow the list by flags and delivery frequency.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("interventions-table"),
                            popover: {
                                title: "Intervention definitions",
                                description:
                                    "Review each intervention's ownership, schedule flags and management actions.",
                                side: "top",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("add-intervention-action"),
                            popover: {
                                title: "Add Intervention",
                                description:
                                    "Create a new intervention definition for your department.",
                                side: "bottom",
                                align: "end",
                            },
                        },
                    ],
                },
                {
                    id: "create-intervention",
                    title: "Create an intervention",
                    description:
                        "Define an intervention, its frequency, recurrence rules and milestone structure.",
                    kind: "task",
                    order: 2,
                    steps: [
                        {
                            element: guideTarget("add-intervention-action"),
                            advanceOnClick: true,
                            popover: {
                                title: "Add Intervention",
                                description:
                                    "Open the intervention editor to create a new definition.",
                                side: "bottom",
                                align: "end",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-intervention-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Intervention editor",
                                description:
                                    "This form defines how the intervention behaves when it is later assigned to beneficiaries.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-title-field"),
                            waitForElement: 5000,
                            popover: {
                                title: "Intervention title",
                                description:
                                    "Give the intervention a clear reusable name. Duplicate titles are blocked within the same department.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-frequency-field"),
                            waitForElement: 5000,
                            popover: {
                                title: "Delivery frequency",
                                description:
                                    "Choose whether this intervention is available as needed, weekly, every two weeks or once a month.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-compulsory-field"),
                            waitForElement: 5000,
                            popover: {
                                title: "Compulsory",
                                description:
                                    "Use this when the intervention is mandatory. Assignments are still created from the Assignments workspace.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-cycle-requirement"),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: "Cycle requirement",
                                description:
                                    "For recurring support, choose whether it is required every cycle or may be skipped when it is not needed.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-recurrence-end"),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: "When recurring support ends",
                                description:
                                    "Recurring support can stop after a number of cycles, on a date, when the HOD closes it, or when the programme ends.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-milestone-toggle"),
                            waitForElement: 5000,
                            popover: {
                                title: "Milestone structure",
                                description:
                                    "Turn on sub-interventions when delivery should be split into ordered MOV milestones under one main intervention.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-intervention-submit",
                            waitForElement: 5000,
                            popover: {
                                title: "Save the intervention",
                                description:
                                    "Save when the definition is complete. It will then be available in the assignment workflow.",
                                side: "top",
                                align: "center",
                            },
                        },
                    ],
                },
                {
                    id: "configure-sub-interventions",
                    title: "Configure sub-interventions",
                    description:
                        "Set up ordered MOV milestones within a main intervention.",
                    kind: "task",
                    order: 3,
                    steps: [
                        {
                            element: '[data-guide="edit-intervention-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: "Open an intervention",
                                description:
                                    "Edit an existing intervention to configure or change its milestone structure.",
                                side: "left",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-intervention-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Intervention editor",
                                description:
                                    "The milestone controls are in the lower part of the intervention definition.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-milestone-toggle"),
                            waitForElement: 5000,
                            popover: {
                                title: "Enable sub-interventions",
                                description:
                                    "Turn this on when the main intervention contains multiple delivery milestones or MOV sub-steps.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("intervention-rotation-mode"),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: "Cycle path",
                                description:
                                    "Choose whether each cycle advances to the next sub-step in order or reuses the same selected sub-step.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("sub-intervention-list"),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: "Ordered milestones",
                                description:
                                    "Add the milestones in delivery order. Drag them to rearrange the sequence and set typical sessions for each one.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("add-sub-intervention-action"),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: "Add another milestone",
                                description:
                                    "Add as many sub-interventions as required. Removing an existing one archives it for future assignments without changing completed history.",
                                side: "top",
                                align: "center",
                            },
                        },
                        {
                            element: ".guide-intervention-submit",
                            waitForElement: 5000,
                            popover: {
                                title: "Save the structure",
                                description:
                                    "Save after the milestone order and typical session counts are correct.",
                                side: "top",
                                align: "center",
                            },
                        },
                    ],
                },
            ],
        }),
        []
    );

    usePageGuides(guideRegistration);

    const [interventions, setInterventions] = useState<InterventionDoc[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);

    const [userDepartment, setUserDepartment] = useState<string>("");
    const [userDepartmentId, setUserDepartmentId] = useState<string>("");

    const [prevCompulsory, setPrevCompulsory] = useState(false);

    // Filters
    const [searchText, setSearchText] = useState("");
    const [flagFilter, setFlagFilter] = useState<string>("all");
    const [assignmentModeFilter, setAssignmentModeFilter] =
        useState<string>("all");

    // department scope
    const [effectiveDeptId, setEffectiveDeptId] = useState<string>(""); // used for create/edit defaults
    const [effectiveDeptName, setEffectiveDeptName] = useState<string>(""); // used for areaOfSupport display
    const [managedDeptIds, setManagedDeptIds] = useState<string[]>([]); // what user can SEE/MANAGE
    const [managedDeptNameMap, setManagedDeptNameMap] = useState<
        Record<string, string>
    >({}); // id -> name
    const [isParentDept, setIsParentDept] = useState(false);

    useEffect(() => {
        setUserDepartment(user?.departmentName || "");
    }, [user]);

    // Resolve user's department doc and compute managed dept IDs
    useEffect(() => {
        (async () => {
            // Prefer explicit departmentId if you store it on the user doc
            const maybeDeptId = String((user as any)?.departmentId || "").trim();

            try {
                let deptSnap = null as any;

                if (maybeDeptId) {
                    const s = await getDoc(doc(db, "departments", maybeDeptId));
                    if (s.exists()) deptSnap = s;
                }

                // fallback by name
                if (!deptSnap && userDepartment) {
                    const qDept = query(
                        collection(db, "departments"),
                        where("name", "==", userDepartment)
                    );
                    const snap = await getDocs(qDept);
                    if (!snap.empty) deptSnap = snap.docs[0];
                }

                if (!deptSnap) {
                    setUserDepartmentId("");
                    setEffectiveDeptId("");
                    setEffectiveDeptName(userDepartment || "");
                    setManagedDeptIds([]);
                    setManagedDeptNameMap({});
                    setIsParentDept(false);
                    return;
                }

                const deptId = deptSnap.id;
                const dept = deptSnap.data() as any;
                const parentDepartmentId = dept.parentDepartmentId
                    ? String(dept.parentDepartmentId)
                    : null;

                // Load potential children
                const childrenSnap = await getDocs(
                    query(
                        collection(db, "departments"),
                        where("parentDepartmentId", "==", deptId)
                    )
                );
                const childIds = childrenSnap.docs.map((d) => d.id);
                const childNameMap: Record<string, string> = {};
                childrenSnap.docs.forEach((d) => {
                    const dd = d.data() as any;
                    childNameMap[d.id] = String(dd.name || dd.departmentName || d.id);
                });

                const myName = String(
                    dept.name || dept.departmentName || userDepartment || ""
                );
                const map: Record<string, string> = {
                    ...childNameMap,
                    [deptId]: myName,
                };

                // If I have a parentDepartmentId => I'm a subdept, manage ONLY myself
                if (parentDepartmentId) {
                    setIsParentDept(false);
                    setUserDepartmentId(deptId);
                    setEffectiveDeptId(deptId);
                    setEffectiveDeptName(myName);
                    setManagedDeptIds([deptId]);
                    setManagedDeptNameMap(map);
                    return;
                }

                // If I have children => I'm a parent dept HOD, manage me + children
                if (childIds.length > 0) {
                    setIsParentDept(true);
                    setUserDepartmentId(deptId);
                    setEffectiveDeptId(deptId); // default create under parent unless you pick otherwise
                    setEffectiveDeptName(myName);
                    setManagedDeptIds([deptId, ...childIds]);
                    setManagedDeptNameMap(map);
                    return;
                }

                // Parent without children => just manage itself
                setIsParentDept(false);
                setUserDepartmentId(deptId);
                setEffectiveDeptId(deptId);
                setEffectiveDeptName(myName);
                setManagedDeptIds([deptId]);
                setManagedDeptNameMap(map);
            } catch (e) {
                console.error(
                    "[InterventionsManager] error resolving department scope",
                    e
                );
                setUserDepartmentId("");
                setEffectiveDeptId("");
                setEffectiveDeptName(userDepartment || "");
                setManagedDeptIds([]);
                setManagedDeptNameMap({});
                setIsParentDept(false);
            }
        })();
    }, [userDepartment, user]);

    const fetchInterventions = async () => {
        if (managedDeptIds.length === 0) {
            setInterventions([]);
            return;
        }

        setLoading(true);
        try {
            let list: InterventionDoc[] = [];

            // Primary: departmentId in managedDeptIds (use chunking because Firestore "in" max is 10)
            const chunk = <T,>(arr: T[], size: number) =>
                Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
                    arr.slice(i * size, i * size + size)
                );

            const managedChunks = chunk(managedDeptIds, 10);
            const pulls: InterventionDoc[] = [];

            for (const ids of managedChunks) {
                const q1 = query(
                    collection(db, "interventions"),
                    where("departmentId", "in", ids)
                );
                const snap1 = await getDocs(q1);
                snap1.docs.forEach((d) =>
                    pulls.push({ id: d.id, ...(d.data() as any) })
                );
            }

            list = pulls;

            // stable sort
            list.sort((a, b) =>
                (a.interventionTitle || "").localeCompare(b.interventionTitle || "")
            );

            setInterventions(list);
        } catch (err) {
            console.error(err);
            message.error("Failed to load interventions");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInterventions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managedDeptIds.join("|")]);

    const openModal = (record?: InterventionDoc) => {
        if (record) {
            const recFromNew = record.recurrence || null;
            const recFromLegacy =
                legacyFrequencyToRecurrence(record.recurrenceFrequency) || null;
            const recurrence = recFromNew || recFromLegacy;

            const preset =
                record.frequency === "as-needed" ||
                    record.assignmentMode === "ad-hoc" ||
                    record.assignmentMode === "once-off"
                    ? "as-needed"
                    : record.recurrencePreset || derivePresetFromRecurrence(recurrence);

            const strict =
                typeof record.recurrenceStrict === "boolean"
                    ? record.recurrenceStrict
                    : isMonthlyCalendar(recurrence)
                        ? true
                        : true;

            const hasSubs = !!record.hasSubInterventions;
            const subs = activeSubList(record.subInterventions || []);

            form.setFieldsValue({
                interventionTitle: record.interventionTitle,
                areaOfSupport: effectiveDeptName || userDepartment,
                compulsory: !!record.compulsory,
                assignmentMode: preset === "as-needed" ? "ad-hoc" : "recurring",
                recurring: record.assignmentMode === "recurring" || !!record.recurring,

                recurrencePreset: preset,
                recurrenceUnit:
                    recurrence?.unit ||
                    (preset !== "custom" ? presetToRecurrence(preset)?.unit : undefined),
                recurrenceEvery:
                    recurrence?.every ||
                    (preset !== "custom" ? presetToRecurrence(preset)?.every : undefined),

                recurrenceStrict: strict,
                recurrenceEndMode: record.recurrenceEnd?.mode || "until-closed",
                recurrenceCycles: record.recurrenceEnd?.cycles || undefined,
                recurrenceEndDate: record.recurrenceEnd?.endDate
                    ? dayjs(
                        typeof record.recurrenceEnd.endDate?.toDate === "function"
                            ? record.recurrenceEnd.endDate.toDate()
                            : record.recurrenceEnd.endDate
                    )
                    : undefined,

                defaultPlannedSessions: Math.max(
                    1,
                    Number(record.defaultPlannedSessions) || 1
                ),
                subInterventionRotationMode:
                    record.subInterventionRotationMode === "repeat" ? "repeat" : "rotate",

                hasSubInterventions: hasSubs,
                subInterventions: subs.length
                    ? subs
                    : [
                        {
                            subId: makeSubId(),
                            title: "",
                            description: "",
                        },
                    ],
            });

            setEditId(record.id);
            setPrevCompulsory(!!record.compulsory);
        } else {
            form.resetFields();
            form.setFieldsValue({
                areaOfSupport: effectiveDeptName || userDepartment,
                compulsory: false,
                assignmentMode: "ad-hoc",
                recurring: false,

                recurrencePreset: "as-needed",
                recurrenceUnit: undefined,
                recurrenceEvery: undefined,

                recurrenceStrict: true,
                recurrenceEndMode: "until-closed",
                recurrenceCycles: undefined,
                recurrenceEndDate: undefined,

                hasSubInterventions: false,
                subInterventions: [{ subId: makeSubId(), title: "", description: "" }],
            });

            setEditId(null);
            setPrevCompulsory(false);
        }

        setModalOpen(true);
    };

    const allocateCompulsoryToAccepted = async (
        interventionId: string,
        title: string,
        deptNameForAssignment: string
    ) => {
        void interventionId;
        void title;
        void deptNameForAssignment;
        message.info(
            "Compulsory intervention saved. Assignments are created from the Assignments workspace once an assignee and delivery cycle are selected."
        );
    };


    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            const selectedFrequency = values.recurrencePreset as
                | SupportedFrequency
                | undefined;
            if (
                !selectedFrequency ||
                !["as-needed", "weekly", "bi-weekly", "monthly"].includes(
                    selectedFrequency
                )
            ) {
                message.error("Choose a frequency of intervention.");
                setLoading(false);
                return;
            }
            const recurring = selectedFrequency !== "as-needed";
            const assignmentMode: InterventionAssignmentMode = recurring
                ? "recurring"
                : "ad-hoc";

            let recurrencePreset: RecurrencePreset | null = null;
            let recurrence: { every: number; unit: RecurrenceUnit } | null = null;
            let recurrenceStrict: boolean | null = null;
            let recurrenceEnd: InterventionDoc["recurrenceEnd"] = null;

            if (recurring) {
                const preset = selectedFrequency;

                recurrencePreset = preset;

                const built = presetToRecurrence(preset);
                if (!built) {
                    message.error("Invalid recurrence preset");
                    setLoading(false);
                    return;
                }
                recurrence = built;

                recurrenceStrict = !!values.recurrenceStrict;
                const recurrenceEndMode = values.recurrenceEndMode as RecurrenceEndMode;
                if (!recurrenceEndMode) {
                    message.error("Choose when recurring support should end.");
                    setLoading(false);
                    return;
                }
                if (recurrenceEndMode === "fixed-cycles") {
                    const cycles = Math.max(0, Number(values.recurrenceCycles) || 0);
                    if (!cycles) {
                        message.error(
                            "Enter how many cycles this recurring support should run."
                        );
                        setLoading(false);
                        return;
                    }
                    recurrenceEnd = { mode: recurrenceEndMode, cycles };
                } else if (recurrenceEndMode === "end-date") {
                    const endDate = values.recurrenceEndDate;
                    if (!endDate?.toDate) {
                        message.error("Select when this recurring support should end.");
                        setLoading(false);
                        return;
                    }
                    recurrenceEnd = {
                        mode: recurrenceEndMode,
                        endDate: Timestamp.fromDate(endDate.toDate()),
                    };
                } else {
                    recurrenceEnd = { mode: recurrenceEndMode };
                }
            } else {
                recurrenceStrict = null;
            }

            const hasSubInterventions = !!values.hasSubInterventions;
            const submittedSubInterventions = hasSubInterventions
                ? normalizeSubList(values.subInterventions || []).map((sub) => ({
                    ...sub,
                    active: true,
                    archivedAt: null,
                }))
                : [];

            if (hasSubInterventions && submittedSubInterventions.length === 0) {
                message.error(
                    "Add at least 1 sub-intervention item (or switch it off)."
                );
                setLoading(false);
                return;
            }

            // Keep an existing definition with its department; new ones belong
            // to the current HOD's department.
            const previousDefinition = editId
                ? interventions.find((item) => item.id === editId)
                : null;
            const owningDeptId =
                String(
                    previousDefinition?.departmentId || effectiveDeptId || ""
                ).trim() || null;

            if (!owningDeptId) {
                message.error("Department could not be resolved.");
                setLoading(false);
                return;
            }

            // Resolve owning dept name for areaOfSupport (always match actual owning dept)
            const owningDeptName =
                managedDeptNameMap[owningDeptId] ||
                effectiveDeptName ||
                userDepartment ||
                "";

            const nextTitle = String(values.interventionTitle || "").trim();
            const subInterventions = mergeSubInterventionsForSave(
                previousDefinition?.subInterventions || [],
                submittedSubInterventions
            );
            const definitionVersion = editId
                ? Math.max(1, Number(previousDefinition?.definitionVersion || 1)) + 1
                : 1;

            const duplicateSnap = await getDocs(
                query(
                    collection(db, "interventions"),
                    where("departmentId", "==", owningDeptId)
                )
            );

            const duplicate = duplicateSnap.docs.find((d) => {
                if (editId && d.id === editId) return false;

                const data = d.data() as any;

                return (
                    makeInterventionKey(data.interventionTitle, data.departmentId) ===
                    makeInterventionKey(nextTitle, owningDeptId)
                );
            });

            if (duplicate) {
                message.error(
                    "An intervention with this title already exists in this department."
                );
                setLoading(false);
                return;
            }

            const payload: Omit<InterventionDoc, "id"> = {
                interventionTitle: nextTitle,
                areaOfSupport: owningDeptName,
                departmentId: owningDeptId,
                compulsory: !!values.compulsory,
                assignmentMode,

                recurring,
                recurrencePreset,
                recurrence,
                recurrenceStrict,
                recurrenceEnd,
                frequency:
                    selectedFrequency === "as-needed" ? "as-needed" : selectedFrequency,
                recurrenceFrequency:
                    selectedFrequency === "as-needed" ? "other" : selectedFrequency,

                hasSubInterventions,
                subInterventions,
                definitionVersion,
                ...(hasSubInterventions
                    ? {
                        subInterventionRotationMode:
                            values.subInterventionRotationMode === "repeat"
                                ? "repeat"
                                : "rotate",
                    }
                    : {
                        defaultPlannedSessions: Math.max(
                            1,
                            Number(values.defaultPlannedSessions) || 1
                        ),
                    }),

                updatedAt: Timestamp.now(),
            };

            if (editId) {
                await updateDoc(doc(db, "interventions", editId), payload as any);
                message.success("Intervention updated!");

                if (!!values.compulsory && !prevCompulsory) {
                    await allocateCompulsoryToAccepted(
                        editId,
                        values.interventionTitle,
                        owningDeptName
                    );
                }
            } else {
                const ref = await addDoc(collection(db, "interventions"), {
                    ...(payload as any),
                    createdAt: Timestamp.now(),
                });
                message.success("Intervention added!");

                if (!!values.compulsory) {
                    await allocateCompulsoryToAccepted(
                        ref.id,
                        values.interventionTitle,
                        owningDeptName
                    );
                }
            }

            setModalOpen(false);
            setEditId(null);
            setPrevCompulsory(!!values.compulsory);
            form.resetFields();
            fetchInterventions();
        } catch (err) {
            console.error(err);
            message.error("Failed to save intervention");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (record: InterventionDoc) => {
        setLoading(true);
        try {
            const linkedAssignments = await getDocs(
                query(
                    collection(db, "assignedInterventions"),
                    where("interventionId", "==", record.id)
                )
            );

            if (!linkedAssignments.empty) {
                message.error(
                    `This intervention cannot be deleted because ${linkedAssignments.size} assignment${linkedAssignments.size === 1 ? "" : "s"} still reference it. Edit the definition or resolve those assignments first.`
                );
                return;
            }

            await deleteDoc(doc(db, "interventions", record.id));

            message.success("Intervention deleted.");
            fetchInterventions();
        } catch (e) {
            console.error(e);
            message.error("Failed to delete intervention");
        } finally {
            setLoading(false);
        }
    };

    const filteredInterventions = useMemo(() => {
        const text = normalize(searchText);

        return interventions.filter((item) => {
            const title = normalize(item.interventionTitle);
            const deptName = normalize(
                managedDeptNameMap[String(item.departmentId || "")] ||
                item.areaOfSupport
            );

            const matchesSearch =
                !text || title.includes(text) || deptName.includes(text);

            const matchesFlag =
                flagFilter === "all" ||
                (flagFilter === "compulsory" && !!item.compulsory) ||
                (flagFilter === "recurring" && !!item.recurring) ||
                (flagFilter === "subInterventions" && !!item.hasSubInterventions);

            const frequency =
                item.frequency === "as-needed" ||
                    (!item.recurring &&
                        ["ad-hoc", "once-off"].includes(item.assignmentMode || ""))
                    ? "as-needed"
                    : item.recurrencePreset ||
                    derivePresetFromRecurrence(
                        item.recurrence ||
                        legacyFrequencyToRecurrence(item.recurrenceFrequency)
                    );

            const matchesAssignmentMode =
                assignmentModeFilter === "all" || frequency === assignmentModeFilter;

            return matchesSearch && matchesFlag && matchesAssignmentMode;
        });
    }, [
        interventions,
        searchText,
        flagFilter,
        assignmentModeFilter,
        managedDeptNameMap,
    ]);

    const columns = [
        {
            title: "Intervention Title",
            dataIndex: "interventionTitle",
            key: "interventionTitle",
        },
        ...(isParentDept
            ? [
                {
                    title: "Department",
                    dataIndex: "departmentId",
                    key: "departmentId",
                    render: (deptId: string) => {
                        const label = managedDeptNameMap[String(deptId || "")] || "";

                        return label ? (
                            <Tag color="geekblue">{label}</Tag>
                        ) : (
                            <Tag>Unknown</Tag>
                        );
                    },
                },
            ]
            : []),
        {
            title: "Flags",
            key: "flags",
            render: (_: any, r: InterventionDoc) => {
                const rec =
                    r.recurrence ||
                    legacyFrequencyToRecurrence(r.recurrenceFrequency) ||
                    null;
                const recText = r.recurring ? formatRecurrence(rec) : "";
                const strict =
                    typeof r.recurrenceStrict === "boolean" ? r.recurrenceStrict : null;

                const strictSuffix =
                    r.recurring && rec
                        ? strict === false
                            ? "Optional"
                            : "Required"
                        : "";

                return (
                    <Space wrap>
                        {r.compulsory && <Tag color="red">Compulsory</Tag>}
                        {r.recurring && (
                            <Tag color="geekblue">
                                Scheduled
                                {recText ? ` — ${recText}` : ""}
                                {strictSuffix ? ` — ${strictSuffix}` : ""}
                            </Tag>
                        )}
                        {!r.recurring && <Tag color="blue">As needed</Tag>}
                        {r.hasSubInterventions && (
                            <Tag icon={<UnorderedListOutlined />} color="cyan">
                                Sub-steps (MOV)
                            </Tag>
                        )}
                    </Space>
                );
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: InterventionDoc) => (
                <Space>
                    <Button
                        data-guide="edit-intervention-action"
                        shape="round"
                        variant="filled"
                        color="geekblue"
                        style={{ border: "1px solid dodgerblue" }}
                        icon={<EditOutlined />}
                        onClick={() => openModal(record)}
                    >
                        Edit
                    </Button>
                    <Popconfirm
                        title="Delete intervention?"
                        description="This permanently removes the intervention definition."
                        okText="Delete"
                        okType="danger"
                        onConfirm={() => handleDelete(record)}
                    >
                        <Button
                            shape="round"
                            danger
                            style={{ border: "1px solid red" }}
                            icon={<DeleteOutlined />}
                        />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const totalInterventions = interventions.length;
    const recurringCount = useMemo(
        () => interventions.filter((i) => i.recurring).length,
        [interventions]
    );
    const summaryMetrics = useMemo<DashboardMetric[]>(
        () => [
            {
                key: "total-interventions",
                title: "Total Interventions",
                value: totalInterventions,
                icon: <FileDoneOutlined style={{ color: "#1677ff" }} />,
                iconBg: "rgba(22,119,255,.12)",
                important: true,
            },
            {
                key: "recurring-interventions",
                title: "Recurring Interventions",
                value: recurringCount,
                icon: <ReloadOutlined style={{ color: "#722ed1" }} />,
                iconBg: "rgba(114,46,209,.12)",
                important: true,
            },
        ],
        [recurringCount, totalInterventions]
    );
    return (
        <div style={{ minHeight: "100vh", padding: 24 }}>
            <Helmet>
                <title>Interventions Manager | Smart Incubation</title>
                <meta
                    name="description"
                    content="Manage departmental intervention definitions, schedules, compulsory allocation, and milestone sub-steps."
                />
            </Helmet>

            {loading ? (
                <div style={{ minHeight: "100vh" }}>
                    <LoadingOverlay tip="Loading interventions" />
                </div>
            ) : (
                <>
                    <div data-guide="intervention-metrics" style={{ marginBottom: 16 }}>
                        <MetricsGrid metrics={summaryMetrics} />
                    </div>

                    <MotionCard
                        filterBar={
                            <Row data-guide="intervention-filters" gutter={[12, 12]} align="middle" justify="space-between">
                                <Col xs={24} md={8}>
                                    <Input.Search
                                        allowClear
                                        placeholder="Search intervention or department"
                                        value={searchText}
                                        onChange={(e) => setSearchText(e.target.value)}
                                    />
                                </Col>

                                <Col xs={24} md={5}>
                                    <Select
                                        value={flagFilter}
                                        onChange={setFlagFilter}
                                        style={{ width: "100%" }}
                                        options={[
                                            { value: "all", label: "All flags" },
                                            { value: "compulsory", label: "Compulsory only" },
                                            { value: "recurring", label: "Recurring only" },
                                            {
                                                value: "subInterventions",
                                                label: "With sub-interventions",
                                            },
                                        ]}
                                    />
                                </Col>

                                <Col xs={24} md={5}>
                                    <Select
                                        value={assignmentModeFilter}
                                        onChange={setAssignmentModeFilter}
                                        style={{ width: "100%" }}
                                        options={[
                                            { value: "all", label: "All frequencies" },
                                            { value: "as-needed", label: "As needed" },
                                            { value: "weekly", label: "Weekly" },
                                            { value: "bi-weekly", label: "Every two weeks" },
                                            { value: "monthly", label: "Once a month" },
                                        ]}
                                    />
                                </Col>

                                <Col xs={24} md={6}>
                                    <Space
                                        wrap
                                        style={{ width: "100%", justifyContent: "flex-end" }}
                                    >
                                        <Button
                                            data-guide="add-intervention-action"
                                            shape="round"
                                            type="primary"
                                            icon={<PlusCircleOutlined />}
                                            onClick={() => openModal()}
                                        >
                                            Add Intervention
                                        </Button>
                                    </Space>
                                </Col>
                            </Row>
                        }
                    >
                        <div data-guide="interventions-table">
                            <Table
                                columns={columns as any}
                                dataSource={filteredInterventions}
                                rowKey="id"
                                pagination={{
                                    pageSize: 8,
                                    position: ["bottomCenter"],
                                    showSizeChanger: false,
                                }}
                            />
                        </div>
                    </MotionCard>

                    <Modal
                        className="guide-intervention-modal"
                        centered
                        title={editId ? "Edit Intervention" : "Add Intervention"}
                        open={modalOpen}
                        onCancel={() => {
                            setModalOpen(false);
                            setEditId(null);
                            setPrevCompulsory(false);
                            form.resetFields();
                        }}
                        onOk={() => form.submit()}
                        okText={editId ? "Update" : "Add"}
                        okButtonProps={{ className: "guide-intervention-submit" }}
                        confirmLoading={loading}
                        destroyOnClose
                        width={780}
                    >
                        <Form
                            layout="vertical"
                            form={form}
                            onFinish={onFinish}
                            initialValues={{
                                areaOfSupport: effectiveDeptName || userDepartment,
                                compulsory: false,
                                assignmentMode: "once-off",
                                recurring: false,
                                recurrencePreset: undefined,
                                recurrenceUnit: undefined,
                                recurrenceEvery: undefined,
                                recurrenceStrict: true,
                                hasSubInterventions: false,
                                subInterventions: [
                                    { subId: makeSubId(), title: "", description: "" },
                                ],
                            }}
                        >
                            <div data-guide="intervention-title-field">
                                <Form.Item
                                    label="Intervention Title"
                                    name="interventionTitle"
                                    rules={[
                                        { required: true, message: "Enter intervention title" },
                                    ]}
                                >
                                    <Input />
                                </Form.Item>
                            </div>

                            <Row gutter={[16, 8]}>
                                <Col xs={24} sm={10}>
                                    <div data-guide="intervention-frequency-field">
                                        <Form.Item
                                            label="Frequency of intervention"
                                            name="recurrencePreset"
                                            rules={[{ required: true, message: "Select a frequency" }]}
                                            extra="This applies to the main intervention and all of its sub-interventions."
                                            style={{ marginBottom: 8 }}
                                        >
                                            <Select placeholder="Select frequency">
                                                <Option value="as-needed">As needed</Option>
                                                <Option value="weekly">Weekly</Option>
                                                <Option value="bi-weekly">Every two weeks</Option>
                                                <Option value="monthly">Once a month</Option>
                                            </Select>
                                        </Form.Item>
                                    </div>
                                </Col>
                                <Col xs={24} sm={7}>
                                    <div data-guide="intervention-compulsory-field">
                                        <Form.Item
                                            label="Compulsory"
                                            name="compulsory"
                                            valuePropName="checked"
                                            style={{ marginBottom: 8 }}
                                        >
                                            <Switch />
                                        </Form.Item>
                                    </div>
                                </Col>
                                <Col xs={24} sm={7}>
                                    <Form.Item
                                        noStyle
                                        shouldUpdate={(prev, curr) =>
                                            prev.recurrencePreset !== curr.recurrencePreset
                                        }
                                    >
                                        {({ getFieldValue }) => {
                                            const preset = getFieldValue("recurrencePreset") as
                                                | RecurrencePreset
                                                | undefined;
                                            const recurrence =
                                                preset && preset !== "as-needed"
                                                    ? presetToRecurrence(preset)
                                                    : null;
                                            return recurrence ? (
                                                <div data-guide="intervention-cycle-requirement">
                                                    <Form.Item
                                                        label={strictLabelFor(recurrence)}
                                                        name="recurrenceStrict"
                                                        valuePropName="checked"
                                                        style={{ marginBottom: 8 }}
                                                    >
                                                        <Switch />
                                                    </Form.Item>
                                                </div>
                                            ) : (
                                                <Form.Item
                                                    label="Cycle requirement"
                                                    style={{ marginBottom: 8 }}
                                                >
                                                    <Text type="secondary">As needed</Text>
                                                </Form.Item>
                                            );
                                        }}
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item
                                noStyle
                                shouldUpdate={(prev, curr) =>
                                    prev.recurrencePreset !== curr.recurrencePreset ||
                                    prev.recurrenceEndMode !== curr.recurrenceEndMode
                                }
                            >
                                {({ getFieldValue }) => {
                                    const frequency = getFieldValue("recurrencePreset");
                                    const isRecurring = !!frequency && frequency !== "as-needed";
                                    const endMode = getFieldValue(
                                        "recurrenceEndMode"
                                    ) as RecurrenceEndMode;
                                    if (!isRecurring) return null;

                                    return (
                                        <div data-guide="intervention-recurrence-end">
                                            <Row gutter={[16, 8]}>
                                                <Col xs={24} md={12}>
                                                    <Form.Item
                                                        label="Recurring support ends"
                                                        name="recurrenceEndMode"
                                                        rules={[
                                                            {
                                                                required: true,
                                                                message: "Choose a support duration",
                                                            },
                                                        ]}
                                                    >
                                                        <Select>
                                                            <Option value="fixed-cycles">
                                                                After a set number of cycles
                                                            </Option>
                                                            <Option value="end-date">On a specific date</Option>
                                                            <Option value="until-closed">
                                                                When the HOD closes it
                                                            </Option>
                                                            <Option value="programme-end">
                                                                When the programme ends
                                                            </Option>
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    {endMode === "fixed-cycles" && (
                                                        <Form.Item
                                                            label="Number of cycles"
                                                            name="recurrenceCycles"
                                                            rules={[
                                                                {
                                                                    required: true,
                                                                    message: "Enter the number of cycles",
                                                                },
                                                            ]}
                                                        >
                                                            <InputNumber min={1} style={{ width: "100%" }} />
                                                        </Form.Item>
                                                    )}
                                                    {endMode === "end-date" && (
                                                        <Form.Item
                                                            label="End date"
                                                            name="recurrenceEndDate"
                                                            rules={[
                                                                { required: true, message: "Select an end date" },
                                                            ]}
                                                        >
                                                            <DatePicker style={{ width: "100%" }} />
                                                        </Form.Item>
                                                    )}
                                                    {endMode === "programme-end" && (
                                                        <Text type="secondary">
                                                            Ends with the programme and stops future milestones
                                                            and projections.
                                                        </Text>
                                                    )}
                                                    {endMode === "until-closed" && (
                                                        <Text type="secondary">
                                                            Continues until the HOD marks the support as closed
                                                            or no longer required.
                                                        </Text>
                                                    )}
                                                </Col>
                                            </Row>
                                        </div>
                                    );
                                }}
                            </Form.Item>

                            <Row gutter={[16, 8]}>
                                <Col xs={24} md={12}>
                                    <div data-guide="intervention-milestone-toggle">
                                        <Form.Item
                                            label="Sub-interventions (MOV breakdown)"
                                            name="hasSubInterventions"
                                            valuePropName="checked"
                                            extra="Turn this on if the action changes per month/cycle but it stays under one main intervention."
                                        >
                                            <Switch />
                                        </Form.Item>
                                    </div>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        noStyle
                                        shouldUpdate={(p, c) =>
                                            p.hasSubInterventions !== c.hasSubInterventions
                                        }
                                    >
                                        {({ getFieldValue }) =>
                                            getFieldValue("hasSubInterventions") ? (
                                                <div data-guide="intervention-rotation-mode">
                                                    <Form.Item
                                                        label="Substep path each cycle"
                                                        name="subInterventionRotationMode"
                                                        initialValue="rotate"
                                                        tooltip="Choose whether each new cycle advances through the ordered substep list, or keeps using the same selected substep."
                                                    >
                                                        <Select style={{ width: "100%" }}>
                                                            <Select.Option value="rotate">
                                                                Progress to the next substep in order
                                                            </Select.Option>
                                                            <Select.Option value="repeat">
                                                                Reuse the same selected substep each cycle
                                                            </Select.Option>
                                                        </Select>
                                                    </Form.Item>
                                                </div>
                                            ) : null
                                        }
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item
                                noStyle
                                shouldUpdate={(p, c) =>
                                    p.hasSubInterventions !== c.hasSubInterventions
                                }
                            >
                                {({ getFieldValue }) => {
                                    const on = !!getFieldValue("hasSubInterventions");
                                    if (!on) {
                                        return (
                                            <Form.Item
                                                label="Typical sessions"
                                                name="defaultPlannedSessions"
                                                initialValue={1}
                                                tooltip="How many sessions this intervention normally takes - pre-fills at assignment time, still editable per assignment."
                                            >
                                                <InputNumber min={1} style={{ width: "100%" }} />
                                            </Form.Item>
                                        );
                                    }

                                    return (
                                        <>
                                            <Text
                                                type="secondary"
                                                style={{ display: "block", marginBottom: 12 }}
                                            >
                                                Add the work items in delivery order. Removing one
                                                archives it for future assignments without changing
                                                completed history.
                                            </Text>

                                            <div data-guide="sub-intervention-list">
                                                <Form.List name="subInterventions">
                                                    {(fields, { add, remove, move }) => {
                                                        const onDragEnd = (result: DropResult) => {
                                                            if (!result.destination) return;
                                                            if (
                                                                result.destination.index === result.source.index
                                                            )
                                                                return;
                                                            move(result.source.index, result.destination.index);
                                                        };

                                                        return (
                                                            <>
                                                                <DragDropContext onDragEnd={onDragEnd}>
                                                                    <Droppable droppableId="subInterventions">
                                                                        {(provided) => (
                                                                            <div
                                                                                ref={provided.innerRef}
                                                                                {...provided.droppableProps}
                                                                            >
                                                                                {fields.map((field, index) => (
                                                                                    <Draggable
                                                                                        key={field.key}
                                                                                        draggableId={String(field.key)}
                                                                                        index={index}
                                                                                    >
                                                                                        {(dragProvided) => (
                                                                                            <Card
                                                                                                ref={dragProvided.innerRef}
                                                                                                {...dragProvided.draggableProps}
                                                                                                size="small"
                                                                                                style={{
                                                                                                    marginBottom: 10,
                                                                                                    background: "#fbfdff",
                                                                                                }}
                                                                                            >
                                                                                                <Row
                                                                                                    gutter={[12, 8]}
                                                                                                    align="middle"
                                                                                                >
                                                                                                    <Col
                                                                                                        flex="0 0 32px"
                                                                                                        {...dragProvided.dragHandleProps}
                                                                                                        style={{
                                                                                                            cursor: "grab",
                                                                                                            textAlign: "center",
                                                                                                            color: "#8c8c8c",
                                                                                                        }}
                                                                                                    >
                                                                                                        <HolderOutlined />
                                                                                                    </Col>

                                                                                                    <Col xs={24} md={14}>
                                                                                                        <Form.Item
                                                                                                            {...field}
                                                                                                            label="Sub-intervention title"
                                                                                                            name={[field.name, "title"]}
                                                                                                            rules={[
                                                                                                                {
                                                                                                                    required: true,
                                                                                                                    message:
                                                                                                                        "Enter sub-intervention title",
                                                                                                                },
                                                                                                            ]}
                                                                                                        >
                                                                                                            <Input placeholder="Sub-Intervention A" />
                                                                                                        </Form.Item>
                                                                                                    </Col>

                                                                                                    <Col xs={24} md={6}>
                                                                                                        <Form.Item
                                                                                                            {...field}
                                                                                                            label="Typical sessions"
                                                                                                            name={[
                                                                                                                field.name,
                                                                                                                "defaultPlannedSessions",
                                                                                                            ]}
                                                                                                            initialValue={1}
                                                                                                            tooltip="How many sessions this sub-intervention normally takes - pre-fills at assignment time, still editable per assignment."
                                                                                                        >
                                                                                                            <InputNumber
                                                                                                                min={1}
                                                                                                                style={{ width: "100%" }}
                                                                                                            />
                                                                                                        </Form.Item>
                                                                                                    </Col>

                                                                                                    <Col
                                                                                                        xs={24}
                                                                                                        md={2}
                                                                                                        style={{
                                                                                                            display: "flex",
                                                                                                            justifyContent: "flex-end",
                                                                                                        }}
                                                                                                    >
                                                                                                        <Button
                                                                                                            shape="round"
                                                                                                            danger
                                                                                                            style={{
                                                                                                                border: "1px solid red",
                                                                                                            }}
                                                                                                            onClick={() =>
                                                                                                                remove(field.name)
                                                                                                            }
                                                                                                            icon={<DeleteOutlined />}
                                                                                                        />
                                                                                                    </Col>

                                                                                                    <Form.Item
                                                                                                        {...field}
                                                                                                        name={[field.name, "subId"]}
                                                                                                        hidden
                                                                                                    >
                                                                                                        <Input />
                                                                                                    </Form.Item>
                                                                                                </Row>
                                                                                            </Card>
                                                                                        )}
                                                                                    </Draggable>
                                                                                ))}
                                                                                {provided.placeholder}
                                                                            </div>
                                                                        )}
                                                                    </Droppable>
                                                                </DragDropContext>

                                                                <Button
                                                                    data-guide="add-sub-intervention-action"
                                                                    type="dashed"
                                                                    onClick={() =>
                                                                        add({ subId: makeSubId(), title: "" })
                                                                    }
                                                                    icon={<PlusCircleOutlined />}
                                                                    block
                                                                >
                                                                    Add Sub-intervention
                                                                </Button>
                                                            </>
                                                        );
                                                    }}
                                                </Form.List>
                                            </div>
                                        </>
                                    );
                                }}
                            </Form.Item>
                        </Form>
                    </Modal>
                </>
            )}
        </div>
    );
};

export default InterventionsManager;
