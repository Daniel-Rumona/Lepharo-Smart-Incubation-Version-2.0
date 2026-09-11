import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Typography,
    Table,
    Space,
    Tag,
    Button,
    Modal,
    Form,
    Input,
    message,
    DatePicker,
    TimePicker,
    Select,
    Segmented,
    Row,
    Col,
    Progress,
    Tooltip,
    Empty,
    Result,
    Descriptions,
    Grid,
    Card,
    Divider,
    List,
    InputNumber,
    Checkbox,
} from "antd";
import {
    CheckCircleOutlined,
    CalendarOutlined,
    CommentOutlined,
    PayCircleOutlined,
    ReloadOutlined,
    TeamOutlined,
    UserAddOutlined,
    EyeOutlined,
    DeleteOutlined,
} from "@ant-design/icons";
import { Helmet } from "react-helmet";
import {
    collection,
    setDoc,
    doc,
    Timestamp,
    getDocs,
    query,
    where,
    limit,
    onSnapshot,
    getDoc,
    documentId,
    writeBatch,
    deleteField,
} from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration,
} from "@/components/guide-me";
import {
    AssigneeRole,
    Assignment,
    InterventionFrequency,
    InterventionType,
    Participant,
    Tracking,
} from "@/types/intervetion";
import { roundBtn } from "@/components/shared/StyledButton";
import { getAppointmentGroupKey } from "@/services/appointmentService";
import { hydrateAppointmentViews } from "@/services/appointmentSessionService";
import { normalizeAssignmentGroupKey } from "@/lib/assignmentIdentity";
import {
    assignedInterventionService,
    canonicalizeAssignedInterventionWrite,
    toAssignedInterventionView,
} from "@/services/assignedInterventionService";
import { resolveAssignmentLifecycle } from "@/services/assignmentLifecycleService";
import {
    GROUP_INTERVENTION_DELIVERIES_COLLECTION,
    type GroupInterventionDelivery,
} from "@/services/groupInterventionDeliveryService";

dayjs.extend(weekOfYear);

const { Title, Text, Paragraph } = Typography;

type RecurrenceUnit = "day" | "week" | "month" | "quarter" | "year";
type RecurrencePreset =
    | "weekly"
    | "bi-weekly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "custom";
type Recurrence = { every: number; unit: RecurrenceUnit };

type InterventionAssignmentMode = "recurring" | "once-off" | "ad-hoc";

type FirstAppointmentContext = {
    assignments: any[];
    grouped: boolean;
    groupKey: string | null;
    assigneeId: string;
    assigneeName: string;
    assigneeEmail: string;
    assigneeRole: AssigneeRole;
};

const norm = (s: any) =>
    String(s ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

const ciEq = (a?: string, b?: string) => norm(a) === norm(b);
const normalizeId = (v: any) => (v == null ? "" : String(v));
const safeLower = (v: any) =>
    String(v ?? "")
        .trim()
        .toLowerCase();
const safe = (v: any) => String(v ?? "").trim();
const displayStatusValue = (value: any) => {
    const text = String(value || "—").trim();
    return text ? text.replace(/^./, char => char.toUpperCase()) : "—";
};
const formatDisplayDate = (value: any) => {
    const parsed = dateLikeToDayjs(value);
    return parsed ? parsed.format("DD MMM YYYY") : "—";
};
const toMillis = (value: any): number => {
    if (!value) return 0;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.seconds === "number") return value.seconds * 1000;
    return 0;
};

const getActiveSubInterventions = (intervention: any) =>
    (Array.isArray(intervention?.subInterventions)
        ? intervention.subInterventions
        : []
    ).filter((sub: any) => sub?.active !== false && !sub?.archivedAt);

const unique = <T,>(arr: T[]) => [...new Set(arr)];

const isGroupedAssignmentRecord = (a: any) =>
    !!normalizeAssignmentGroupKey(a) || String(a?.type) === "grouped";

const dateLikeToDayjs = (value: any) => {
    if (!value) return null;
    const raw =
        typeof value?.toDate === "function"
            ? value.toDate()
            : value?.seconds
                ? new Date(value.seconds * 1000)
                : value;
    const parsed = dayjs(raw);
    return parsed.isValid() ? parsed : null;
};

const NON_CYCLE_VALUES = new Set([
    "once",
    "once-off",
    "once_off",
    "one-time",
    "one_time",
    "single",
    "single-cycle",
    "single_cycle",
    "daily",
    "weekly",
    "biweekly",
    "bi-weekly",
    "monthly",
    "quarterly",
    "annually",
    "annual",
    "other",
]);

const formatCycleLabel = (value: any) => {
    const dateValue = dateLikeToDayjs(value);
    if (dateValue) return dateValue.format("MMMM YYYY");

    const raw = safe(value);
    if (!raw || NON_CYCLE_VALUES.has(raw.toLowerCase())) return "";

    const yearMonth = raw.match(/^(\d{4})[-_/](\d{1,2})(?:\D|$)/);
    if (yearMonth) {
        const parsed = dayjs(
            `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, "0")}-01`
        );
        return parsed.isValid() ? parsed.format("MMMM YYYY") : "";
    }

    const monthYear = raw.match(/^(\d{1,2})[-_/](\d{4})(?:\D|$)/);
    if (monthYear) {
        const parsed = dayjs(
            `${monthYear[2]}-${String(monthYear[1]).padStart(2, "0")}-01`
        );
        return parsed.isValid() ? parsed.format("MMMM YYYY") : "";
    }

    const parsed = dayjs(raw);
    return parsed.isValid() ? parsed.format("MMMM YYYY") : raw;
};

const getCycleMonthKey = (value: any) => {
    const dateValue = dateLikeToDayjs(value);
    if (dateValue) return dateValue.format("YYYY-MM");

    const raw = safe(value);
    return formatCycleLabel(raw) ? raw : "";
};

const getAssignmentCycleSource = (a: any) =>
    a?.cycleMonth ||
    a?.monthKey ||
    a?.periodKey ||
    a?.cycleDate ||
    a?.dueDate ||
    a?.targetDate ||
    a?.scheduledDate ||
    a?.groupMeta?.cycleMonth ||
    a?.groupMeta?.monthKey ||
    a?.groupMeta?.periodKey ||
    a?.groupMeta?.cycleDate ||
    a?.groupMeta?.dueDate ||
    a?.groupMeta?.targetDate ||
    a?.groupMeta?.scheduledDate ||
    a?.cycleKey;

const getAssignmentCycleKey = (a: any) => {
    const directCycleKey = safe(a?.cycleKey);
    if (formatCycleLabel(directCycleKey)) return directCycleKey;

    return getCycleMonthKey(getAssignmentCycleSource(a));
};

const getAssignmentCycleLabel = (a: any) =>
    formatCycleLabel(getAssignmentCycleSource(a)) ||
    formatCycleLabel(getAssignmentCycleKey(a));

const cycleSortValue = (value: any) => {
    const raw = safe(value);
    const week = raw.match(/^(\d{4})-W(\d{1,2})$/i);
    if (week) return Number(week[1]) * 100 + Number(week[2]);
    const month = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (month) return Number(month[1]) * 100 + Number(month[2]);
    const parsed = dateLikeToDayjs(value);
    return parsed ? parsed.valueOf() : 0;
};

const makeCycleGroupKey = (args: {
    interventionId: string;
    assigneeId: string;
    programId?: string | null;
    departmentId?: string | null;
    cycleKey?: string | null;
}) => {
    const interventionId = safe(args.interventionId) || "unknown-intervention";
    const assigneeId = safe(args.assigneeId) || "unknown-assignee";
    const programId = safe(args.programId) || "no-program";
    const departmentId = safe(args.departmentId) || "no-department";
    const cycleKey = safe(args.cycleKey) || "single-cycle";

    return [
        "synthetic",
        assigneeId,
        programId,
        departmentId,
        interventionId,
        cycleKey,
    ].join("__");
};

const makeGroupKey = (args: {
    interventionId: string;
    assigneeId: string;
    programId?: string | null;
    departmentId?: string | null;
    cycleKey?: string | null;
}) => {
    return makeCycleGroupKey(args);
};

const getInterventionAssignmentMode = (iv: any): InterventionAssignmentMode => {
    const mode = safeLower(
        iv?.assignmentMode || iv?.interventionMode || iv?.deliveryScheduleType
    );

    if (mode === "once-off" || mode === "once_off" || mode === "onceoff")
        return "once-off";
    if (mode === "ad-hoc" || mode === "adhoc" || mode === "ad_hoc")
        return "ad-hoc";

    const meta = getRecurrenceFromIntervention(iv);
    if (meta.recurring && meta.recurrence) return "recurring";

    return "once-off";
};

const getCycleKeyForMode = (
    mode: InterventionAssignmentMode,
    rec: Recurrence | null,
    due: dayjs.Dayjs
) => {
    if (mode === "recurring")
        return rec ? toCycleKey(rec, due) : due.format("YYYY-MM");
    if (mode === "ad-hoc") return due.format("YYYY-MM");
    return due.format("YYYY-MM");
};

const getIvTitle = (iv: any) =>
    iv?.interventionTitle ||
    iv?.title ||
    iv?.name ||
    iv?.label ||
    iv?.intervention ||
    "Untitled";

const legacyFrequencyToRecurrence = (f: any): Recurrence | null => {
    if (!f) return null;
    if (f === "weekly") return { every: 1, unit: "week" };
    if (f === "bi-weekly") return { every: 2, unit: "week" };
    if (f === "monthly") return { every: 1, unit: "month" };
    if (f === "quarterly") return { every: 1, unit: "quarter" };
    if (f === "yearly") return { every: 1, unit: "year" };
    return null;
};

const presetToRecurrence = (preset: RecurrencePreset): Recurrence | null => {
    if (preset === "weekly") return { every: 1, unit: "week" };
    if (preset === "bi-weekly") return { every: 2, unit: "week" };
    if (preset === "monthly") return { every: 1, unit: "month" };
    if (preset === "quarterly") return { every: 1, unit: "quarter" };
    if (preset === "yearly") return { every: 1, unit: "year" };
    return null;
};

const formatRecurrence = (rec?: Recurrence | null) => {
    if (!rec) return "—";
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

const toCycleKey = (rec: Recurrence | null, due: dayjs.Dayjs) => {
    if (!rec) return null;
    if (rec.unit === "day") return due.format("YYYY-MM-DD");
    if (rec.unit === "week")
        return `${due.year()}-W${String(due.week()).padStart(2, "0")}`;
    if (rec.unit === "month") return due.format("YYYY-MM");
    // Derived by hand: dayjs' quarter helpers need the quarterOfYear plugin,
    // which this app never registers (only weekOfYear is extended above), so
    // due.quarter() returns undefined rather than throwing. month() is
    // 0-indexed, so Jan–Mar lands in Q1.
    if (rec.unit === "quarter")
        return `${due.year()}-Q${Math.floor(due.month() / 3) + 1}`;
    if (rec.unit === "year") return `${due.year()}`;
    return null;
};

/**
 * Provides a sortable rank for cycle keys so previous cycles can be compared reliably.
 */
const cycleKeyToRank = (unit: RecurrenceUnit, key: string): number | null => {
    const k = String(key || "").trim();
    if (!k) return null;

    if (unit === "year") {
        const y = Number(k);
        return Number.isFinite(y) ? y : null;
    }

    if (unit === "quarter") {
        const m = k.match(/^(\d{4})-Q([1-4])$/);
        if (!m) return null;
        const y = Number(m[1]);
        const q = Number(m[2]);
        return y * 10 + q;
    }

    if (unit === "month") {
        const m = k.match(/^(\d{4})-(\d{2})$/);
        if (!m) return null;
        const y = Number(m[1]);
        const mm = Number(m[2]);
        if (!(mm >= 1 && mm <= 12)) return null;
        return y * 100 + mm;
    }

    if (unit === "week") {
        const m = k.match(/^(\d{4})-W(\d{2})$/);
        if (!m) return null;
        const y = Number(m[1]);
        const w = Number(m[2]);
        if (!(w >= 1 && w <= 53)) return null;
        return y * 100 + w;
    }

    if (unit === "day") {
        const m = k.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const y = Number(m[1]);
        const mm = Number(m[2]);
        const dd = Number(m[3]);
        if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
        return y * 10000 + mm * 100 + dd;
    }

    return null;
};

const deriveAssignmentFrequency = (
    recPreset?: RecurrencePreset | null,
    rec?: Recurrence | null
): InterventionFrequency => {
    const p = recPreset || null;
    if (p === "weekly") return "weekly" as any;
    if (p === "bi-weekly") return "bi-weekly" as any;
    if (p === "monthly") return "monthly" as any;
    if (p === "quarterly") return "other" as any;
    if (p === "yearly") return "other" as any;

    const r = rec || null;
    if (r?.unit === "week" && r.every === 1) return "weekly" as any;
    if (r?.unit === "week" && r.every === 2) return "bi-weekly" as any;
    if (r?.unit === "month" && r.every === 1) return "monthly" as any;
    return "other" as any;
};

const getRecurrenceFromIntervention = (iv: any) => {
    const recurring =
        typeof iv?.recurring === "boolean"
            ? iv.recurring
            : !!(
                iv?.recurrence ||
                iv?.recurrencePreset ||
                iv?.recurrenceFrequency ||
                iv?.frequency === "monthly" ||
                iv?.frequency === "weekly" ||
                iv?.frequency === "bi-weekly" ||
                iv?.frequency === "quarterly" ||
                iv?.frequency === "yearly"
            );
    const recurrencePreset: RecurrencePreset | null =
        iv?.recurrencePreset ?? null;
    const recFromNew: Recurrence | null = iv?.recurrence ?? null;
    const recFromLegacy: Recurrence | null =
        legacyFrequencyToRecurrence(iv?.recurrenceFrequency) ?? null;
    const recurrence: Recurrence | null =
        recFromNew ||
        (recurrencePreset ? presetToRecurrence(recurrencePreset) : null) ||
        recFromLegacy;
    const recurrenceStrict: boolean | null =
        typeof iv?.recurrenceStrict === "boolean" ? !!iv.recurrenceStrict : null;

    return { recurring, recurrencePreset, recurrence, recurrenceStrict };
};

// Progress is derived automatically from held vs. planned sessions (see
// shared/appointments coverage save, which is the real source of truth once
// coverage exists). This is only used to seed an initial value at
// assignment-creation/reassignment time, before any coverage exists.
const computeProgress = (
    plannedSessions?: number | null,
    t?: Tracking | null
): number => {
    const sessionsLogged = t?.sessionsLogged ?? 0;
    return Math.min(
        100,
        (sessionsLogged / Math.max(1, Number(plannedSessions) || 1)) * 100
    );
};

async function resolveAssigneeByEmail(email?: string) {
    const result = {
        role: "unknown" as "operations" | "coordinator" | "unknown",
        docId: null as string | null,
        name: "",
    };

    const safeEmail = email?.trim().toLowerCase();
    if (!safeEmail) return result;

    try {
        const opsSnap = await getDocs(
            query(
                collection(db, "operationsStaff"),
                where("email", "==", safeEmail),
                limit(1)
            )
        );
        if (!opsSnap.empty) {
            const d = opsSnap.docs[0];
            const data = d.data() as any;
            return { role: "operations", docId: d.id, name: data?.name || "" };
        }

        const coordinatorSnap = await getDocs(
            query(
                collection(db, "coordinators"),
                where("email", "==", safeEmail),
                limit(1)
            )
        );
        if (!coordinatorSnap.empty) {
            const d = coordinatorSnap.docs[0];
            const data = d.data() as any;
            return { role: "coordinator", docId: d.id, name: data?.name || "" };
        }

        return result;
    } catch {
        return result;
    }
}

const dedupeInterventions = (items: any[]) => {
    const seen = new Set<string>();
    return (items || []).filter((iv) => {
        const key = normalizeId(iv?.id ?? iv?.interventionId ?? getIvTitle(iv));
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const pickLatestByUpdated = (arr: any[]) => {
    if (!arr.length) return null;
    return [...arr].sort((a, b) => {
        const ad = a?.updatedAt?.toDate?.() ?? a?.createdAt?.toDate?.() ?? 0;
        const bd = b?.updatedAt?.toDate?.() ?? b?.createdAt?.toDate?.() ?? 0;
        return Number(bd) - Number(ad);
    })[0];
};

const isActiveAssignment = (a: any) => resolveAssignmentLifecycle(a).isOpen;

const isCompletedForBusiness = (a: any) => {
    const lifecycle = resolveAssignmentLifecycle(a);
    return lifecycle.isCompleted || lifecycle.key === "cancelled";
};

type AppointmentResponseState = 'not_scheduled' | 'pending' | 'confirmed' | 'declined';

const getOperationsLifecycle = (assignment: any) => {
    const base = resolveAssignmentLifecycle(assignment);
    const appointmentResponse = assignment?.appointmentResponseState as AppointmentResponseState | undefined;

    // A completion rejection is a distinct SME decision. Legacy records can
    // carry assignmentStatus=in-progress after the rejection, so detect the
    // explicit completion field before interpreting that as normal delivery.
    if (safeLower(assignment?.participantCompletionStatus) === 'rejected') {
        return {
            ...base,
            key: 'participant-rejected' as const,
            label: 'Completion Rejected',
            color: 'red',
            waitingOn: 'assignee' as const,
            phase: 'delivery' as const,
            isOpen: true,
            isDeclined: false
        };
    }

    // Group delivery is shared. Once its delivery record is complete, the
    // remaining member-level decision is the SME's MOV confirmation—not a
    // first appointment. This keeps Assignment Statuses aligned with the
    // grouped-interventions view even for migrated legacy members.
    const groupDeliveryComplete = assignment?.groupDelivery && (
        safeLower(assignment.groupDelivery.deliveryStatus) === 'completed' ||
        Number(assignment.groupDelivery.progress || 0) >= 100
    );
    if (groupDeliveryComplete && base.key !== 'completed' && base.key !== 'participant-declined') {
        return {
            ...base,
            key: 'awaiting-participant-confirmation' as const,
            label: 'Awaiting MOV Confirmation',
            color: 'purple',
            waitingOn: 'participant' as const,
            phase: 'confirmation' as const,
            isOpen: true,
        };
    }

    // New delivery flow: the SME accepts the intervention through a linked
    // appointment. A pending assignment without that appointment is not an
    // SME bottleneck yet—it is ready for Operations to schedule.
    // Legacy records may already say `in-delivery` merely because the old
    // assignment-acceptance step was completed. For an unfinished assignment,
    // the linked appointment is now the source of truth for this stage.
    if (base.key === 'awaiting-participant-acceptance' || base.key === 'in-delivery') {
        if (appointmentResponse === 'not_scheduled') {
            return { ...base, key: 'assigned' as const, label: 'Ready to Schedule', color: 'blue', waitingOn: 'assignee' as const, phase: 'acceptance' as const };
        }
        if (appointmentResponse === 'pending') {
            return { ...base, label: 'Awaiting Appointment Response', color: 'orange', waitingOn: 'participant' as const };
        }
        if (appointmentResponse === 'confirmed') {
            // Confirmation only establishes that the SME has accepted a
            // scheduled session. It does not mean the session was delivered
            // or that attendance has been recorded yet.
            return { ...base, key: 'in-delivery' as const, label: 'Appointment Confirmed', color: 'geekblue', waitingOn: 'assignee' as const, phase: 'delivery' as const };
        }
        if (appointmentResponse === 'declined') {
            return { ...base, key: 'participant-declined' as const, label: 'Appointment Declined', color: 'red', waitingOn: 'none' as const, phase: 'closed' as const, isOpen: false, isDeclined: true };
        }
    }
    return base;
};

// A declined appointment closes that assignment without delivering the work.
// The intervention is still outstanding, so the department must be able to
// assign it again rather than being left with only a reassign of the closed
// record.
const isDeclinedAssignment = (a: any) =>
    getOperationsLifecycle(a).key === "participant-declined";

const getCompositeStatus = (a: any) => {
    const lifecycle = getOperationsLifecycle(a);
    if (!a?.assigneeId && lifecycle.key !== "cancelled") {
        return { label: "Needs Reassignment", color: "magenta" };
    }
    const label = String(lifecycle.label || '').trim();
    return { label: safeLower(label) === 'rejected' ? 'Rejected' : label, color: lifecycle.color };
};

const getSmeRejectionDetails = (assignment: any) => {
    const lifecycle = getOperationsLifecycle(assignment);
    const completionRejected = safeLower(assignment?.participantCompletionStatus) === 'rejected' || lifecycle.key === "participant-rejected";
    const assignmentDeclined = !completionRejected && lifecycle.key === "participant-declined";
    if (!assignmentDeclined && !completionRejected) return null;

    const reason = assignmentDeclined
        ? assignment?.participantDeclineReason || assignment?.declineReason || assignment?.smeDeclineReason
        : assignment?.participantCompletionRejectionReason || assignment?.completionRejectionReason || assignment?.rejectionReason;

    return {
        kind: assignmentDeclined ? "Assignment declined" : "Completion rejected",
        reason: String(reason || "No reason was recorded.").trim(),
        recordedAt: assignmentDeclined
            ? assignment?.participantDeclinedAt || assignment?.declinedAt || assignment?.updatedAt
            : assignment?.participantCompletionRejectedAt || assignment?.completionRejectedAt || assignment?.updatedAt,
    };
};

/**
 * Suggests which sub-intervention to work on next for a given participant:
 * whichever has gone longest without being completed (or was never
 * completed), tie-broken by the department's arranged delivery order. This
 * is a default, not a lock - the coordinator can always pick a different one.
 */
const suggestNextSubIntervention = (args: {
    participantId: string;
    interventionId: string;
    subInterventions: any[];
    assignments: any[];
    rotationMode?: "rotate" | "repeat";
}): string | null => {
    const {
        participantId,
        interventionId,
        subInterventions,
        assignments,
        rotationMode,
    } = args;
    if (!subInterventions.length) return null;

    // "Repeat" interventions always work the same scope - the first
    // (top-of-list) sub-intervention every cycle, no rotation.
    if (rotationMode === "repeat") {
        return String(
            subInterventions[0].subId ||
            subInterventions[0].id ||
            subInterventions[0].title
        );
    }

    const lastCompletedAtBySubId = new Map<string, number>();
    assignments.forEach((a) => {
        if (String(a?.participantId || "") !== String(participantId)) return;
        if (String(a?.interventionId || "") !== String(interventionId)) return;
        if (!resolveAssignmentLifecycle(a).isCompleted) return;

        const subId = String(a?.subInterventionId || "");
        if (!subId) return;

        const completedAt =
            a?.completedAt?.toDate?.() ?? a?.updatedAt?.toDate?.() ?? null;
        const ms = completedAt ? completedAt.getTime() : 0;
        const existing = lastCompletedAtBySubId.get(subId);
        if (existing == null || ms > existing)
            lastCompletedAtBySubId.set(subId, ms);
    });

    const ranked = subInterventions
        .map((sub, index) => ({
            subId: String(sub.subId || sub.id || sub.title),
            index,
            lastCompletedAt:
                lastCompletedAtBySubId.get(String(sub.subId || sub.id || sub.title)) ??
                -1,
        }))
        .sort((a, b) => a.lastCompletedAt - b.lastCompletedAt || a.index - b.index);

    return ranked[0]?.subId ?? null;
};

type Bottleneck = {
    label: string;
    pendingType:
    | "scheduling"
    | "smme_acceptance"
    | "assignee_completion"
    | "completion_remediation"
    | "smme_confirmation"
    | "none";
    followUpName: string;
    followUpId: string;
};

const LENIENT_OPEN_CYCLE_LIMIT = 3;

const ONCE_OFF_COMPLETED_REASON = "Already completed";

// A completed once-off item is the only reason that truly bars a new
// assignment. An open previous cycle is surfaced as a warning and left to the
// department to act on.
const isHardBlockReason = (reason: string | null) =>
    String(reason || "").trim() === ONCE_OFF_COMPLETED_REASON;

const getBottleneck = (a: any): Bottleneck => {
    const lifecycle = getOperationsLifecycle(a);

    if (!lifecycle.isOpen) {
        return {
            label: "—",
            pendingType: "none",
            followUpName: "",
            followUpId: "",
        };
    }

    const assigneeName = String(a?.assigneeName || "").trim();
    const assigneeId = String(a?.assigneeId || "").trim();

    if (lifecycle.key === "participant-rejected") {
        const details = getSmeRejectionDetails(a);
        return {
            label: `SME rejected completion${details?.reason ? `: ${details.reason}` : ". Review and resubmit the completion."}`,
            pendingType: "completion_remediation",
            followUpName: assigneeName,
            followUpId: assigneeId,
        };
    }

    if (lifecycle.label === "Ready to Schedule") {
        return {
            label: "First appointment still needs to be scheduled.",
            pendingType: "scheduling",
            followUpName: assigneeName,
            followUpId: assigneeId,
        };
    }

    if (lifecycle.key === "awaiting-participant-acceptance") {
        return {
            label: lifecycle.label === 'Awaiting Appointment Response'
                ? 'Pending appointment response.'
                : 'Pending SMME acceptance.',
            pendingType: "smme_acceptance",
            followUpName: "",
            followUpId: "",
        };
    }

    if (lifecycle.key === "in-delivery") {
        return {
            label: `Pending facilitator completion.`,
            pendingType: "assignee_completion",
            followUpName: assigneeName,
            followUpId: assigneeId,
        };
    }

    if (lifecycle.key === "awaiting-participant-confirmation") {
        return {
            label: `Pending SMME confirmation.`,
            pendingType: "smme_confirmation",
            followUpName: "",
            followUpId: "",
        };
    }

    return { label: "—", pendingType: "none", followUpName: "", followUpId: "" };
};

const isWorkNotCompletedBottleneck = (bottleneck: Bottleneck) =>
    bottleneck.pendingType === "assignee_completion" ||
    bottleneck.pendingType === "completion_remediation";

const isSmeResponsivenessBottleneck = (bottleneck: Bottleneck) =>
    bottleneck.pendingType === "smme_acceptance" ||
    bottleneck.pendingType === "smme_confirmation";

const sortPreviousCyclesNewestFirst = (unit: RecurrenceUnit, rows: any[]) =>
    [...rows].sort((a, b) => {
        const ar = cycleKeyToRank(unit, String(a?.cycleKey || "")) ?? -1;
        const br = cycleKeyToRank(unit, String(b?.cycleKey || "")) ?? -1;
        return br - ar;
    });

const getOpenPreviousCycles = (args: {
    assignedForParticipant: any[];
    ivId: string;
    recurrence: Recurrence;
    newCycleKey: string;
    selectedSubId?: string | null;
}) => {
    const {
        assignedForParticipant,
        ivId,
        recurrence,
        newCycleKey,
        selectedSubId,
    } = args;
    const unit = recurrence.unit;
    const newRank = cycleKeyToRank(unit, newCycleKey);
    if (newRank == null) return [];

    const sameIntervention = assignedForParticipant.filter((a) => {
        if (String(a?.interventionId) !== String(ivId)) return false;
        if ((selectedSubId ?? null) != null) {
            return String(a?.subInterventionId || "") === String(selectedSubId);
        }
        return true;
    });

    const openPrev = sameIntervention
        .filter((a) => safeLower(a?.assignmentStatus) !== "cancelled")
        .filter((a) => {
            const ck = String(a?.cycleKey || "");
            const r = cycleKeyToRank(unit, ck);
            if (r == null) return false;
            if (r >= newRank) return false;
            // A decline is an answer, not silence. It closes its cycle, so it
            // must not count towards the open-cycle backlog that holds up the
            // next assignment.
            if (isDeclinedAssignment(a)) return false;
            return !isCompletedForBusiness(a);
        });

    return sortPreviousCyclesNewestFirst(unit, openPrev);
};

const getOpenCyclePolicyDecision = (args: {
    assignedForParticipant: any[];
    ivId: string;
    recurring: boolean;
    recurrence: Recurrence | null;
    newCycleKey: string | null;
    selectedSubId?: string | null;
}) => {
    const {
        assignedForParticipant,
        ivId,
        recurring,
        recurrence,
        newCycleKey,
        selectedSubId,
    } = args;
    if (!recurring || !recurrence || !newCycleKey) {
        return {
            blocked: false,
            reason: "",
            openCycles: [],
            blockingCycle: null,
            lenientCycles: [],
            smeResponsivenessCycles: [] as any[],
        };
    }

    const openCycles = getOpenPreviousCycles({
        assignedForParticipant,
        ivId,
        recurrence,
        newCycleKey,
        selectedSubId,
    });

    if (!openCycles.length) {
        return {
            blocked: false,
            reason: "",
            openCycles,
            blockingCycle: null,
            lenientCycles: [],
            smeResponsivenessCycles: [] as any[],
        };
    }

    const blockingCycle =
        openCycles.find((a) => isWorkNotCompletedBottleneck(getBottleneck(a))) ||
        null;
    if (blockingCycle) {
        const bottleneck = getBottleneck(blockingCycle);
        const who = bottleneck.followUpName ? ` (${bottleneck.followUpName})` : "";
        return {
            blocked: true,
            reason: `Blocked: previous cycle still has uncompleted work (${String(
                blockingCycle?.cycleKey || ""
            )}). ${bottleneck.label}${who}`,
            openCycles,
            blockingCycle,
            lenientCycles: [],
            smeResponsivenessCycles: [] as any[],
        };
    }

    const lenientCycles = openCycles;
    const smeResponsivenessCycles = lenientCycles.filter((a) =>
        isSmeResponsivenessBottleneck(getBottleneck(a))
    );

    if (lenientCycles.length >= LENIENT_OPEN_CYCLE_LIMIT) {
        const latest = lenientCycles[0];
        const bottleneck = getBottleneck(latest);
        return {
            blocked: true,
            reason: `Blocked: ${lenientCycles.length
                } previous open cycle(s) are still awaiting acceptance or confirmation. Latest: ${String(
                    latest?.cycleKey || ""
                )}. ${bottleneck.label}`,
            openCycles,
            blockingCycle: latest,
            lenientCycles,
            smeResponsivenessCycles,
        };
    }

    return {
        blocked: false,
        reason: "",
        openCycles,
        blockingCycle: null,
        lenientCycles,
        smeResponsivenessCycles,
    };
};

const getOpenPrevCycleInfo = (args: {
    assignedForParticipant: any[];
    ivId: string;
    recurring: boolean;
    recurrence: Recurrence | null;
    currentCycleKey: string | null;
    selectedSubId?: string | null;
}) => {
    const {
        assignedForParticipant,
        ivId,
        recurring,
        recurrence,
        currentCycleKey,
        selectedSubId,
    } = args;

    if (!recurring || !recurrence || !currentCycleKey) return null;

    const policy = getOpenCyclePolicyDecision({
        assignedForParticipant,
        ivId,
        recurring,
        recurrence,
        newCycleKey: currentCycleKey,
        selectedSubId,
    });

    if (!policy.blocked) return null;

    const best = policy.blockingCycle || policy.openCycles[0];

    const bottleneck = getBottleneck(best);
    const overall = getCompositeStatus(best);

    return {
        openAssignment: best,
        openCycleKey: String(best?.cycleKey || ""),
        bottleneck,
        overallLabel: overall.label,
        overallColor: overall.color,
        lenientOpenCount: policy.lenientCycles.length,
        smeResponsivenessOpenCount: policy.smeResponsivenessCycles.length,
    };
};

const decideReassignStatuses = (prev: any) => {
    const participantAcceptanceStatus =
        prev?.participantAcceptanceStatus ?? "pending";
    const participantCompletionStatus =
        prev?.participantCompletionStatus ?? "pending";
    const assigneeAcceptanceStatus = "accepted";
    const assignmentStatus =
        participantAcceptanceStatus === "accepted" ? "in-progress" : "assigned";
    const assigneeCompletionStatus = ["done", "completed"].includes(
        safeLower(prev?.assigneeCompletionStatus)
    )
        ? prev.assigneeCompletionStatus
        : "pending";
    return {
        assignmentStatus,
        participantAcceptanceStatus,
        participantCompletionStatus,
        assigneeAcceptanceStatus,
        assigneeCompletionStatus,
    };
};

type LockSource = "manage" | null;

export const InterventionsAssignments: React.FC = () => {
    const { user } = useFullIdentity();
    const screens = Grid.useBreakpoint();
    const isMobile = !screens.md; // < md (xs/sm) treated as mobile

    const { activeProgramId } = useActiveProgramId();

    const [assigneeRole, setAssigneeRole] = useState<
        "coordinator" | "operations" | "unknown"
    >("unknown");
    const [assigneeId, setAssigneeId] = useState<string | null>(null);
    const [assigneeName, setAssigneeName] = useState<string>("");

    const isControlAccount = (user?.email || "")
        .toLowerCase()
        .endsWith("@quantilytix.co.za");

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: "intervention-assignments",
            pageTitle: "Intervention Assignments",
            guides: [
                {
                    id: "intervention-assignments-overview",
                    title: "Quick tour",
                    description:
                        "Understand intervention coverage, views, filters and the main assignment actions.",
                    kind: "page",
                    order: 1,
                    steps: [
                        {
                            element: guideTarget("assignment-metrics"),
                            popover: {
                                title: "Intervention coverage",
                                description:
                                    "These metrics summarise beneficiary coverage, assigned interventions and completion for the selected programme.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("assignment-views"),
                            popover: {
                                title: "Change workspace view",
                                description:
                                    "Switch between beneficiaries, grouped interventions, assignment statuses and intervention demand.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("assignment-filters"),
                            popover: {
                                title: "Find beneficiaries",
                                description:
                                    "These filters change with the selected workspace. Beneficiaries use coverage filters, Assignment Statuses use dates, and Intervention Demand uses intervention-level filters.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("assign-new-intervention"),
                            popover: {
                                title: "Assign an intervention",
                                description:
                                    "Start a new singular or grouped intervention assignment.",
                                side: "bottom",
                                align: "end",
                            },
                        },
                        {
                            element: guideTarget("beneficiaries-table"),
                            popover: {
                                title: "Beneficiary coverage",
                                description:
                                    "Review required, assigned and completed intervention coverage for each beneficiary. Use Manage to inspect one beneficiary in detail.",
                                side: "top",
                                align: "start",
                            },
                        },
                    ],
                },
                {
                    id: "assign-intervention",
                    title: "Assign an intervention",
                    description:
                        "Walk through assigning an intervention to one beneficiary or a group.",
                    kind: "task",
                    order: 2,
                    steps: [
                        {
                            element: guideTarget("assign-new-intervention"),
                            advanceOnClick: true,
                            popover: {
                                title: "Start an assignment",
                                description:
                                    "Select Assign New Intervention to open the assignment form.",
                                side: "bottom",
                                align: "end",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-assignment-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Assignment setup",
                                description:
                                    "The complete assignment is configured here. Grouped assignments use this same modal, so there is no separate SME picker to interrupt the flow.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-type",
                            waitForElement: 5000,
                            popover: {
                                title: "Assignment type",
                                description:
                                    "Choose Singular for one beneficiary or Grouped when several beneficiaries share the same intervention.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-beneficiary",
                            waitForElement: 5000,
                            popover: {
                                title: "Choose beneficiary",
                                description:
                                    "Start typing a beneficiary name instead of scrolling through the full list. For grouped assignments, search and select multiple beneficiaries here.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-intervention",
                            waitForElement: 5000,
                            popover: {
                                title: "Choose intervention",
                                description:
                                    "Select an intervention required by the chosen beneficiary. Grouped assignments only show interventions shared by the selected beneficiaries.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-assignee",
                            waitForElement: 5000,
                            popover: {
                                title: "Choose who will deliver it",
                                description:
                                    "Choose Assign to Self, Other Coordinator, or Head of Department. Assign to Self works whether you are a coordinator or HOD.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-sessions",
                            waitForElement: 5000,
                            popover: {
                                title: "Planned sessions",
                                description:
                                    "Set the expected number of sessions. Progress is calculated from sessions actually held.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-due-date",
                            waitForElement: 5000,
                            popover: {
                                title: "Due date",
                                description:
                                    "Set the date by which this intervention cycle should be delivered.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-submit",
                            waitForElement: 5000,
                            popover: {
                                title: "Create assignment",
                                description:
                                    "Create the assignment once the required details are complete. You will then be offered the option to schedule the first appointment.",
                                side: "top",
                                align: "center",
                            },
                        },
                    ],
                },
                {
                    id: "manage-beneficiary-interventions",
                    title: "Manage a beneficiary",
                    description:
                        "Review one beneficiary's intervention coverage, history and available assignment actions.",
                    kind: "task",
                    order: 3,
                    steps: [
                        {
                            element: guideTarget("manage-beneficiary"),
                            advanceOnClick: true,
                            popover: {
                                title: "Open beneficiary management",
                                description:
                                    "Select Manage for a beneficiary to review their intervention requirements and assignment history.",
                                side: "left",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-manage-beneficiary-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Beneficiary intervention workspace",
                                description:
                                    "This workspace focuses on the selected beneficiary only.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("manage-beneficiary-metrics"),
                            waitForElement: 5000,
                            popover: {
                                title: "Beneficiary metrics",
                                description:
                                    "See how many interventions are required, assigned, completed, currently open and grouped.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("manage-beneficiary-filter"),
                            waitForElement: 5000,
                            popover: {
                                title: "Filter interventions",
                                description:
                                    "Show all, assigned or unassigned interventions for this beneficiary.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("manage-beneficiary-table"),
                            waitForElement: 5000,
                            popover: {
                                title: "Intervention details",
                                description:
                                    "Review the current assignee and status, expand assignment history, or assign and reassign interventions from here.",
                                side: "top",
                                align: "start",
                            },
                        },
                    ],
                },
                {
                    id: "assign-from-manage",
                    title: "Assign from Manage",
                    description:
                        "Open one beneficiary and assign one of their unassigned interventions directly from the Manage workspace.",
                    kind: "task",
                    order: 4,
                    steps: [
                        {
                            element: guideTarget("manage-beneficiary"),
                            advanceOnClick: true,
                            popover: {
                                title: "Choose a beneficiary",
                                description:
                                    "Open Manage for the beneficiary whose intervention you want to assign.",
                                side: "left",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-manage-beneficiary-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Find an unassigned intervention",
                                description:
                                    "Use the filter if needed, then locate an intervention that is currently unassigned.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: '[data-guide="manage-assign-intervention"]',
                            waitForElement: 5000,
                            advanceOnClick: true,
                            popover: {
                                title: "Assign from this beneficiary",
                                description:
                                    "Select Assign. The beneficiary and intervention are carried into the assignment form automatically.",
                                side: "left",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-assignment-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Complete the assignment",
                                description:
                                    "The beneficiary and intervention are already locked. Choose who will deliver it, then confirm the session plan and due date.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-assignee",
                            waitForElement: 5000,
                            popover: {
                                title: "Choose the assignee",
                                description:
                                    "Assign to yourself, another coordinator, or the Head of Department.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: ".guide-assignment-submit",
                            waitForElement: 5000,
                            popover: {
                                title: "Save the assignment",
                                description:
                                    "Create the assignment when the remaining delivery details are complete.",
                                side: "top",
                                align: "center",
                            },
                        },
                    ],
                },
                {
                    id: "add-smes-to-group",
                    title: "Add SMEs to a group",
                    description:
                        "Add eligible beneficiaries to an existing grouped intervention that is still in progress.",
                    kind: "task",
                    order: 5,
                    steps: [
                        {
                            element: guideTarget("grouped-view-option"),
                            advanceOnClick: true,
                            popover: {
                                title: "Open grouped interventions",
                                description:
                                    "Select Grouped Interventions to see existing intervention groups.",
                                side: "bottom",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: guideTarget("grouped-interventions-table"),
                            waitForElement: 5000,
                            popover: {
                                title: "Choose an active group",
                                description:
                                    "Find the group you want to extend. SMEs can only be added while the group is not yet 100% complete.",
                                side: "top",
                                align: "start",
                            },
                        },
                        {
                            element: '[data-guide="group-add-sme"]',
                            waitForElement: 5000,
                            advanceOnClick: true,
                            popover: {
                                title: "Add an SME",
                                description:
                                    "Select Add SME on the relevant group.",
                                side: "left",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-add-group-member-modal",
                            waitForElement: 5000,
                            popover: {
                                title: "Eligible SMEs",
                                description:
                                    "Only SMEs eligible for the same intervention and programme rules are offered here.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("group-add-sme-select"),
                            waitForElement: 5000,
                            popover: {
                                title: "Search and select SMEs",
                                description:
                                    "Type a beneficiary name to search, then select one or more eligible SMEs to add.",
                                side: "right",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("group-add-sme-submit"),
                            waitForElement: 5000,
                            popover: {
                                title: "Update the group",
                                description:
                                    "Add the selected SMEs. Existing future group appointments are synchronised where applicable.",
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

    const [participants, setParticipants] = useState<Participant[]>([]);
    const [coordinators, setCoordinators] = useState<
        { id: string; name: string; email?: string; departmentName?: string }[]
    >([]);
    const [hodList, setHodList] = useState<
        { id: string; name: string; email?: string; departmentName?: string }[]
    >([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [groupDeliveries, setGroupDeliveries] = useState<Record<string, GroupInterventionDelivery>>({});
    const [groupSessionSummaries, setGroupSessionSummaries] = useState<Record<string, {
        sessionsHeld: number;
        attendanceCount: number;
        attendancePossible: number;
    }>>({});
    const [appointmentResponseByAssignmentId, setAppointmentResponseByAssignmentId] = useState<Record<string, AppointmentResponseState>>({});
    const [departments, setDepartments] = useState<any[]>([]);
    const [participantInterventionMap, setParticipantInterventionMap] = useState<
        Record<string, string[]>
    >({});
    const [appsByPid, setAppsByPid] = useState<Record<string, any>>({});
    const [dpByPid, setDpByPid] = useState<Record<string, any>>({});

    const [loading, setLoading] = useState(true);
    const [manageModalVisible, setManageModalVisible] = useState(false);
    const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
    const [savingAssignment, setSavingAssignment] = useState(false);
    const assignmentWriteLockRef = useRef(false);
    const [firstAppointmentOpen, setFirstAppointmentOpen] = useState(false);
    const [firstAppointmentContext, setFirstAppointmentContext] =
        useState<FirstAppointmentContext | null>(null);
    const [savingFirstAppointment, setSavingFirstAppointment] = useState(false);
    const [firstAppointmentForm] = Form.useForm();

    const [selectedParticipant, setSelectedParticipant] =
        useState<Participant | null>(null);
    const [interventionFilter, setInterventionFilter] = useState<
        "all" | "assigned" | "unassigned"
    >("all");
    const [searchText, setSearchText] = useState("");
    const [selectedProgram, setSelectedProgram] = useState<string | undefined>();

    const [viewMode, setViewMode] = useState<
        "beneficiaries" | "groups" | "range" | "demand"
    >("beneficiaries");

    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
        dayjs().startOf("month"),
        dayjs().endOf("month"),
    ]);

    const [beneficiaryCoverageFilter, setBeneficiaryCoverageFilter] = useState<
        "all" | "needs-assignment" | "open" | "completed"
    >("all");
    const [groupSearchText, setGroupSearchText] = useState("");
    const [groupProgressFilter, setGroupProgressFilter] = useState<
        "all" | "active" | "completed"
    >("all");
    const [rangeStatusFilter, setRangeStatusFilter] = useState<string>("all");
    const [demandSearchText, setDemandSearchText] = useState("");
    const [demandCoverageFilter, setDemandCoverageFilter] = useState<
        "all" | "needs-allocation" | "open" | "completed"
    >("all");

    const [assignmentForm] = Form.useForm();
    const [addToGroupForm] = Form.useForm();
    const [convertSinglesForm] = Form.useForm();
    const [selectedType, setSelectedType] =
        useState<InterventionType>("singular");
    const [sharedInterventions, setSharedInterventions] = useState<any[]>([]);
    const [lockedIntervention, setLockedIntervention] = useState<{
        id: string;
    } | null>(null);
    const [reassigningAssignment, setReassigningAssignment] =
        useState<Assignment | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<any | null>(null);
    const [groupMembersModalVisible, setGroupMembersModalVisible] =
        useState(false);
    const [groupDeliverySummary, setGroupDeliverySummary] = useState({
        loading: false,
        sessionsHeld: 0,
        plannedSessions: 0,
        attendanceCount: 0,
        attendancePossible: 0,
    });
    const [addToGroupModalVisible, setAddToGroupModalVisible] = useState(false);
    const [convertSinglesModalVisible, setConvertSinglesModalVisible] =
        useState(false);
    const [groupActionLoading, setGroupActionLoading] = useState(false);

    const [userDepartment, setUserDepartment] = useState<any>(null);

    const [lockedParticipantId, setLockedParticipantId] = useState<string | null>(
        null
    );
    const [lockSource, setLockSource] = useState<LockSource>(null);

    const watchedParticipant = Form.useWatch("participant", assignmentForm);
    const watchedType = Form.useWatch("type", assignmentForm);
    const watchedIntervention = Form.useWatch("intervention", assignmentForm);
    const watchedConvertGroupKey = Form.useWatch("groupKey", convertSinglesForm);

    const [ivDefsById, setIvDefsById] = useState<Record<string, any>>({});

    const [openPrevModal, setOpenPrevModal] = useState<{
        open: boolean;
        assignment: any | null;
    }>({
        open: false,
        assignment: null,
    });
    const [rejectionDetailsAssignment, setRejectionDetailsAssignment] = useState<any | null>(null);

    const isConfirmedValue = (v: any): boolean => {
        if (v === true) return true;
        if (v && typeof v === "object") return v.confirmed === true;
        return false;
    };

    const hasBothConfirmationsForDept = (
        dp: any,
        deptId?: string,
        deptName?: string
    ) => {
        const id = String(deptId || "").trim();
        const name = String(deptName || "").trim();

        const deptValById = id ? dp?.confirmedByDeptId?.[id] : undefined;
        const deptValByName = name ? dp?.confirmed?.[name] : undefined;

        const deptConfirmed =
            isConfirmedValue(deptValById) || isConfirmedValue(deptValByName);

        // Department saves can create an empty/partial smmeConfirmedByDeptId
        // map while the SME roadmap writes its confirmation to the incubatee
        // map. Check this department in every supported map, not just the
        // first truthy map (an empty object is truthy too).
        const smmeConfirmed = [
            id ? dp?.smmeConfirmedByDeptId?.[id] : undefined,
            id ? dp?.incubateeDepartmentConfirmationsByDeptId?.[id] : undefined,
            name ? dp?.smmeConfirmedByDept?.[name] : undefined,
            name ? dp?.incubateeConfirmedByDept?.[name] : undefined,
            name ? dp?.incubateeDepartmentConfirmations?.[name] : undefined,
            name ? dp?.smmeConfirmedMap?.[name] : undefined,
        ].some(isConfirmedValue);

        return deptConfirmed && smmeConfirmed;
    };

    const isMonitoringDepartment = useMemo(() => {
        return userDepartment?.isMonitoring === true;
    }, [userDepartment]);

    const computeShared = (ids: string[]) => {
        const selectedList = departmentFilteredParticipants.filter((p) =>
            ids.includes(String((p as any).id))
        );

        const sets = selectedList.map(
            (p) =>
                new Set(
                    ((p as any).requiredInterventions || []).map((i: any) =>
                        normalizeId(i.id)
                    )
                )
        );

        const sharedIds =
            sets.length === 0
                ? []
                : Array.from(
                    sets
                        .slice(1)
                        .reduce(
                            (acc, s) => new Set([...acc].filter((x) => s.has(x))),
                            sets[0]
                        )
                );

        const intersection = sharedIds
            .map((id) => {
                const example = selectedList.find((p) =>
                    ((p as any).requiredInterventions || []).some(
                        (i: any) => normalizeId(i.id) === id
                    )
                );
                return (example as any)?.requiredInterventions?.find(
                    (i: any) => normalizeId(i.id) === id
                );
            })
            .filter(Boolean) as any[];

        return intersection;
    };

    useEffect(() => {
        (async () => {
            const r = await resolveAssigneeByEmail(user?.email);
            setAssigneeRole(r.role as "coordinator" | "operations" | "unknown");
            setAssigneeId(r.docId);
            setAssigneeName(r.name || (user as any)?.name || "");
        })();
    }, [user?.email]);

    useEffect(() => {
        (async () => {
            const snap = await getDocs(collection(db, "operationsStaff"));
            const currentDepartmentId = String((user as any)?.departmentId || "").trim();
            const currentDepartmentName = String(user?.departmentName || "").trim();

            setHodList(
                snap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) }))
                    .filter((h: any) => h.name)
                    .filter((h: any) => {
                        if (isControlAccount) return true;

                        const hodDepartmentId = String(h?.departmentId || "").trim();
                        const hodDepartmentName = String(h?.departmentName || "").trim();

                        if (currentDepartmentId && hodDepartmentId) {
                            return hodDepartmentId === currentDepartmentId;
                        }

                        return ciEq(hodDepartmentName, currentDepartmentName);
                    })
            );
        })().catch(() => { });
    }, [
        isControlAccount,
        (user as any)?.departmentId,
        user?.departmentName,
    ]);

    useEffect(() => {
        if (!assignmentModalVisible || !watchedIntervention) return;
        if (ivDefsById[String(watchedIntervention)]) return;
        (async () => {
            const snap = await getDoc(
                doc(db, "interventions", String(watchedIntervention))
            );
            if (!snap.exists()) return;

            setIvDefsById((prev) => ({
                ...prev,
                [snap.id]: { id: snap.id, ...(snap.data() as any) },
            }));
        })().catch(() => { });
    }, [assignmentModalVisible, watchedIntervention, ivDefsById]);

    useEffect(() => {
        const run = async () => {
            const snap = await getDocs(collection(db, "departments"));
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            setDepartments(list);

            if ((user as any)?.departmentId) {
                const dep = list.find((d) => d.id === (user as any).departmentId);
                setUserDepartment(dep || null);
            }
        };
        run().catch(() => { });
    }, [(user as any)?.departmentId]);

    useEffect(() => {
        const loadDefs = async () => {
            if (!selectedParticipant) return;
            const required = ((selectedParticipant as any).requiredInterventions ||
                []) as any[];
            const ids = Array.from(
                new Set(required.map((iv) => String(iv?.id)).filter(Boolean))
            );
            if (!ids.length) return;

            const missing = ids.filter((id) => !ivDefsById[id]);
            if (!missing.length) return;

            const out: Record<string, any> = {};
            for (let i = 0; i < missing.length; i += 10) {
                const chunk = missing.slice(i, i + 10);
                const snap = await getDocs(
                    query(
                        collection(db, "interventions"),
                        where(documentId(), "in", chunk)
                    )
                );
                snap.docs.forEach((d) => {
                    out[d.id] = { id: d.id, ...(d.data() as any) };
                });
            }

            setIvDefsById((prev) => ({ ...prev, ...out }));
        };

        loadDefs().catch(() => { });
    }, [selectedParticipant?.id]);

    useEffect(() => {
        if (!assignmentModalVisible) return;

        const ivId = assignmentForm.getFieldValue("intervention");
        if (!ivId) {
            assignmentForm.setFieldsValue({
                derivedRecurrenceText: "—",
                recurring: false,
                recurrencePreset: null,
                recurrence: null,
                recurrenceStrict: null,
                plannedSessions: 1,
            });
            return;
        }

        (async () => {
            let iv: any = null;
            const isGrouped = assignmentForm.getFieldValue("type") === "grouped";

            if (isGrouped) {
                iv =
                    (sharedInterventions || []).find(
                        (x: any) => normalizeId(x?.id) === normalizeId(ivId)
                    ) || null;
            } else {
                const pid = assignmentForm.getFieldValue("participant");
                const p = participants.find(
                    (pp) => String((pp as any).id) === String(pid)
                );
                iv =
                    ((p as any)?.requiredInterventions || []).find(
                        (x: any) => normalizeId(x?.id) === normalizeId(ivId)
                    ) || null;
            }

            const missingRec =
                typeof iv?.recurring !== "boolean" ||
                (!iv?.recurrence && !iv?.recurrencePreset);
            if (missingRec) {
                const snap = await getDoc(doc(db, "interventions", String(ivId)));
                if (snap.exists()) iv = { id: snap.id, ...(snap.data() as any) };
            }

            if (!iv) return;

            const meta = getRecurrenceFromIntervention(iv);
            const text =
                meta.recurring && meta.recurrence
                    ? `${formatRecurrence(meta.recurrence)}${meta.recurrenceStrict === false
                        ? " — Optional"
                        : meta.recurrenceStrict === true
                            ? " — Required"
                            : ""
                    }`
                    : "—";

            const activeSubs = getActiveSubInterventions(iv);
            // Suggest which sub-intervention to work on next, based on
            // recency (oldest/never-completed-first) - still fully
            // overridable via the picker. Only for singular assignments for
            // now; grouped rotation isn't wired yet.
            let suggestedSubId: string | null = null;
            if (!isGrouped && activeSubs.length) {
                const pid = String(assignmentForm.getFieldValue("participant") || "");
                suggestedSubId = suggestNextSubIntervention({
                    participantId: pid,
                    interventionId: String(ivId),
                    subInterventions: activeSubs,
                    assignments,
                    rotationMode:
                        iv?.subInterventionRotationMode === "repeat" ? "repeat" : "rotate",
                });
            }
            const suggestedSub = suggestedSubId
                ? activeSubs.find(
                    (s: any) => String(s.subId || s.id || s.title) === suggestedSubId
                )
                : null;

            assignmentForm.setFieldsValue({
                recurring: meta.recurring,
                recurrencePreset: meta.recurrencePreset || null,
                recurrence: meta.recurrence || null,
                recurrenceStrict: meta.recurrenceStrict,
                derivedRecurrenceText: text,
                ...(suggestedSubId ? { subIntervention: suggestedSubId } : {}),
                // Pre-fill from the suggested sub-intervention's typical
                // session count when there is one, else the parent
                // intervention's - still editable per assignment.
                plannedSessions: Math.max(
                    1,
                    Number(
                        suggestedSub?.defaultPlannedSessions ?? iv?.defaultPlannedSessions
                    ) || 1
                ),
            });
        })().catch(() => { });
    }, [
        assignmentModalVisible,
        watchedIntervention,
        watchedParticipant,
        watchedType,
        sharedInterventions,
        participants,
        assignmentForm,
        assignments,
    ]);

    // Appointment confirmation is now the SME's intervention response. Keep
    // it as a display-only overlay so old pending assignment fields cannot
    // falsely imply that Operations is waiting on an SME before scheduling.
    useEffect(() => {
        const assignmentIds = assignments.map(item => String(item.id || '')).filter(Boolean);
        if (!assignmentIds.length) {
            setAppointmentResponseByAssignmentId({});
            return;
        }
        let cancelled = false;
        ; (async () => {
            // A grouped assignment can have historical appointments from a
            // previous group/cycle. Only an appointment written for this
            // assignment's actual group may drive its current response state.
            const expectedGroupKeyByAssignmentId = Object.fromEntries(
                assignments.map((assignment: any) => [
                    String(assignment.id || ''),
                    isGroupedAssignmentRecord(assignment)
                        ? String(getAssignmentGroupKey(assignment) || '').trim()
                        : '',
                ])
            );
            const state: Record<string, AppointmentResponseState> = Object.fromEntries(
                assignmentIds.map(id => [id, 'not_scheduled' as AppointmentResponseState])
            );

            const applyAppointmentResponse = (appointment: any) => {
                const assignmentId = String(appointment.assignedInterventionId || '');
                if (!assignmentId || !(assignmentId in state)) return;
                const expectedGroupKey = expectedGroupKeyByAssignmentId[assignmentId];
                const appointmentGroupKey = String(appointment.groupKey || '').trim();

                // Do not let an appointment belonging to a different
                // cycle/group (or a legacy ungrouped record) inflate the
                // response count for this grouped assignment.
                if (expectedGroupKey && appointmentGroupKey !== expectedGroupKey) return;

                const response = safeLower(appointment.smeConfirmation || 'pending');
                const previous = state[assignmentId] || 'not_scheduled';
                if (response === 'confirmed') state[assignmentId] = 'confirmed';
                else if (response === 'declined' && previous !== 'confirmed') state[assignmentId] = 'declined';
                else if (previous === 'not_scheduled') state[assignmentId] = 'pending';
            };

            // Group status must be calculated from the records belonging to
            // that exact group. This avoids legacy `in-progress` values and
            // unrelated historical appointments changing current group counts.
            const groupKeys = Array.from(new Set(
                Object.values(expectedGroupKeyByAssignmentId).filter(Boolean)
            ));
            for (let index = 0; index < groupKeys.length; index += 10) {
                const keys = groupKeys.slice(index, index + 10);
                const snapshot = await getDocs(query(
                    collection(db, 'appointments'),
                    where('groupKey', 'in', keys)
                ));
                snapshot.docs.forEach(item => applyAppointmentResponse(item.data() as any));
            }

            // Singular interventions do not have a group key, so retain the
            // direct assignment lookup for those records only.
            const singularAssignmentIds = assignmentIds.filter(id => !expectedGroupKeyByAssignmentId[id]);
            for (let index = 0; index < singularAssignmentIds.length; index += 10) {
                const ids = singularAssignmentIds.slice(index, index + 10);
                const snapshot = await getDocs(query(
                    collection(db, 'appointments'),
                    where('assignedInterventionId', 'in', ids)
                ));
                snapshot.docs.forEach(item => applyAppointmentResponse(item.data() as any));
            }
            if (!cancelled) setAppointmentResponseByAssignmentId(state);
        })().catch(error => console.error('Failed to resolve appointment response state:', error));
        return () => { cancelled = true; };
    }, [assignments]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                setLoading(true);

                const dpQ = activeProgramId
                    ? query(
                        collection(db, "diagnosticPlans"),
                        where("programId", "==", activeProgramId)
                    )
                    : collection(db, "diagnosticPlans");

                const appsQ = activeProgramId
                    ? query(
                        collection(db, "applications"),
                        where("programId", "==", activeProgramId)
                    )
                    : collection(db, "applications");

                const [
                    dpSnap,
                    appsSnap,
                    coordinatorsSnap,
                    participantsSnap,
                    interventionsSnap,
                ] = await Promise.all([
                    getDocs(dpQ),
                    getDocs(appsQ),
                    getDocs(collection(db, "coordinators")),
                    getDocs(collection(db, "participants")),
                    getDocs(collection(db, "interventions")),
                ]);

                if (cancelled) return;

                const dpMap: Record<string, any> = {};
                dpSnap.docs.forEach((docSnap) => {
                    const plan = { id: docSnap.id, ...(docSnap.data() as any) };
                    const participantId = String(plan?.participantId || "");
                    if (!participantId) return;

                    const current = dpMap[participantId];
                    if (
                        !current ||
                        toMillis(plan?.createdAt) >= toMillis(current?.createdAt)
                    ) {
                        dpMap[participantId] = plan;
                    }
                });
                setDpByPid(dpMap);

                const pMap = new Map(
                    participantsSnap.docs.map((d) => [d.id, d.data() as any])
                );

                const apps = appsSnap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) }))
                    .filter((a) => safeLower(a.applicationStatus) === "accepted");

                const appsByParticipant: Record<string, any> = {};
                apps.forEach((app) => {
                    appsByParticipant[app.participantId] = app;
                });
                setAppsByPid(appsByParticipant);

                const deptId = String(
                    (user as any)?.departmentId || userDepartment?.id || ""
                );
                const deptName = String(
                    user?.departmentName || userDepartment?.name || ""
                );

                const departmentInterventions = interventionsSnap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) }))
                    .filter((iv: any) => {
                        const ivDeptId = String(iv?.departmentId || "").trim();
                        const ivArea = String(
                            iv?.areaOfSupport || iv?.area || iv?.departmentName || ""
                        ).trim();

                        if (deptId && ivDeptId) return ivDeptId === deptId;
                        return ciEq(ivArea, deptName);
                    });

                const monitoringRequiredInterventions = dedupeInterventions(
                    departmentInterventions.map((iv: any) => ({
                        id: String(iv?.id || ""),
                        interventionTitle:
                            iv?.title || iv?.interventionTitle || iv?.name || "Untitled",
                        areaOfSupport: iv?.areaOfSupport || iv?.area || deptName,
                        departmentId: iv?.departmentId || deptId || null,
                        hasSubInterventions: !!iv?.hasSubInterventions,
                        subInterventions: getActiveSubInterventions(iv),
                        definitionVersion: Math.max(1, Number(iv?.definitionVersion || 1)),
                        assignmentMode:
                            iv?.assignmentMode ||
                            iv?.interventionMode ||
                            iv?.deliveryScheduleType ||
                            null,
                        recurring: iv?.recurring ?? false,
                        recurrencePreset: iv?.recurrencePreset ?? null,
                        recurrence: iv?.recurrence ?? null,
                        recurrenceStrict: iv?.recurrenceStrict ?? null,
                        frequency: iv?.frequency ?? null,
                        defaultPlannedSessions: Math.max(
                            1,
                            Number(iv?.defaultPlannedSessions) || 1
                        ),
                        subInterventionRotationMode:
                            iv?.subInterventionRotationMode === "repeat"
                                ? "repeat"
                                : "rotate",
                    }))
                );

                const visibleApps = isMonitoringDepartment
                    ? apps
                    : apps.filter((app) => {
                        const dp = dpMap[String(app.participantId)];
                        if (!dp) return false;
                        return hasBothConfirmationsForDept(dp, deptId, deptName);
                    });

                const fetchedParticipants: Participant[] = visibleApps.map((app) => {
                    const pData = pMap.get(app.participantId) || {};
                    const dp = dpMap[String(app.participantId)];

                    const dpInterventions = Array.isArray(dp?.interventions)
                        ? dp.interventions
                        : [];

                    const requiredForDeptRaw = isMonitoringDepartment
                        ? monitoringRequiredInterventions
                        : dpInterventions.filter((iv: any) => {
                            if (deptId && iv?.departmentId)
                                return String(iv.departmentId) === deptId;
                            return ciEq(iv?.area || iv?.areaOfSupport, deptName);
                        });

                    const requiredForDept = dedupeInterventions(
                        requiredForDeptRaw.map((iv: any) => ({
                            id: String(iv?.id || ""),
                            interventionTitle:
                                iv?.title || iv?.interventionTitle || iv?.name || "Untitled",
                            areaOfSupport: iv?.area || iv?.areaOfSupport || deptName,
                            departmentId: iv?.departmentId || deptId || null,
                            hasSubInterventions: !!iv?.hasSubInterventions,
                            subInterventions: getActiveSubInterventions(iv),
                            definitionVersion: Math.max(
                                1,
                                Number(iv?.definitionVersion || 1)
                            ),
                            assignmentMode:
                                iv?.assignmentMode ||
                                iv?.interventionMode ||
                                iv?.deliveryScheduleType ||
                                null,
                            recurring: iv?.recurring ?? false,
                            recurrencePreset: iv?.recurrencePreset ?? null,
                            recurrence: iv?.recurrence ?? null,
                            recurrenceStrict: iv?.recurrenceStrict ?? null,
                            frequency: iv?.frequency ?? null,
                            defaultPlannedSessions: Math.max(
                                1,
                                Number(iv?.defaultPlannedSessions) || 1
                            ),
                            subInterventionRotationMode:
                                iv?.subInterventionRotationMode === "repeat"
                                    ? "repeat"
                                    : "rotate",
                        }))
                    );

                    return {
                        id: app.participantId,
                        beneficiaryName:
                            app.beneficiaryName ||
                            pData.beneficiaryName ||
                            pData.businessName ||
                            "Unknown",
                        sector: pData.sector || app.sector || "—",
                        stage: pData.stage || app.stage || "—",
                        province: pData.province || app.province || "—",
                        city: pData.city || app.city || "—",
                        location: pData.location || app.location || "—",
                        programName: app.programName,
                        requiredInterventions: requiredForDept as any,
                        completedInterventions: app?.interventions?.completed || [],
                        smmeNo: app?.smmENo || app?.smmeNo || app?.SMMENo || null,
                        hasDiagnosticPlan: !!dp,
                        bypassedDpGate:
                            isMonitoringDepartment &&
                            !hasBothConfirmationsForDept(dp, deptId, deptName),
                    } as any;
                });

                const pim: Record<string, string[]> = {};
                fetchedParticipants.forEach((p) => {
                    pim[p.id as any] = ((p as any).requiredInterventions || []).map(
                        (iv: any) => normalizeId(iv?.id)
                    );
                });

                const fetchedCoordinators = coordinatorsSnap.docs
                    .map((d) => {
                        const data = d.data() as any;
                        return {
                            id: d.id,
                            departmentName: data.departmentName,
                            name: data.name,
                            email: data.email,
                        };
                    })
                    .filter((c) => {
                        const deptNameSafe =
                            user?.departmentName || userDepartment?.name || "";
                        return ciEq(c.departmentName, deptNameSafe);
                    })
                    .filter((c) => {
                        const email = String(c.email || "").toLowerCase();
                        return email.endsWith("@quantilytix.co.za")
                            ? isControlAccount
                            : true;
                    });

                setParticipants(fetchedParticipants);
                setCoordinators(fetchedCoordinators);
                setParticipantInterventionMap(pim);
            } catch (e) {
                if (cancelled) return;
                // eslint-disable-next-line no-console
                console.error(e);
                message.error("Failed to load data");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        if ((user as any)?.departmentId || userDepartment?.id) {
            load().catch(() => { });
        }

        return () => {
            cancelled = true;
        };
    }, [
        (user as any)?.departmentId,
        user?.departmentName,
        activeProgramId,
        userDepartment?.id,
        userDepartment?.name,
        isMonitoringDepartment,
    ]);

    useEffect(() => {
        const deptId = String(
            (user as any)?.departmentId || userDepartment?.id || ""
        );
        const deptName = String(
            (user as any)?.departmentName ||
            user?.departmentName ||
            userDepartment?.name ||
            ""
        );

        const qDept = deptId
            ? query(
                assignedInterventionService.collectionRef(),
                where("departmentId", "==", deptId)
            )
            : null;

        const qArea = deptName
            ? query(
                assignedInterventionService.collectionRef(),
                where("areaOfSupport", "==", deptName)
            )
            : null;

        let a1: any[] = [];
        let a2: any[] = [];

        const mergeAndSet = () => {
            const byId = new Map<string, any>();
            [...a1, ...a2].forEach((a) => byId.set(String(a.id), a));
            setAssignments(Array.from(byId.values()));
        };

        const unsub: Array<() => void> = [];

        if (qDept) {
            unsub.push(
                onSnapshot(
                    qDept,
                    (snap) => {
                        a1 = snap.docs.map((d) =>
                            toAssignedInterventionView(d.id, d.data())
                        );
                        mergeAndSet();
                    },
                    (err) => {
                        // eslint-disable-next-line no-console
                        console.error(err);
                    }
                )
            );
        }

        if (qArea) {
            unsub.push(
                onSnapshot(
                    qArea,
                    (snap) => {
                        a2 = snap.docs.map((d) =>
                            toAssignedInterventionView(d.id, d.data())
                        );
                        mergeAndSet();
                    },
                    (err) => {
                        // eslint-disable-next-line no-console
                        console.error(err);
                    }
                )
            );
        }

        return () => unsub.forEach((u) => u());
    }, [
        (user as any)?.departmentId,
        (user as any)?.departmentName,
        userDepartment?.id,
        userDepartment?.name,
    ]);

    const departmentFilteredParticipants = useMemo(() => {
        if (!userDepartment || userDepartment?.isMain) return participants;
        const depName = norm(userDepartment?.name);
        return (participants || []).filter((p) =>
            ((p as any).requiredInterventions || []).some(
                (iv: any) => norm(iv?.area || iv?.areaOfSupport) === depName
            )
        );
    }, [participants, userDepartment]);

    const baseParticipants = useMemo(() => {
        return (departmentFilteredParticipants || []).filter((p) => {
            return !selectedProgram || (p as any).programName === selectedProgram;
        });
    }, [departmentFilteredParticipants, selectedProgram]);

    const filteredParticipants = useMemo(() => {
        return baseParticipants.filter((p) => {
            const name = norm((p as any).beneficiaryName);
            return !searchText || name.includes(norm(searchText));
        });
    }, [baseParticipants, searchText]);

    const filteredParticipantOptions = useMemo(
        () =>
            (departmentFilteredParticipants || []).map((p) => ({
                value: String((p as any).id),
                label: String((p as any).beneficiaryName || "Unknown"),
            })),
        [departmentFilteredParticipants]
    );

    const filteredParticipantIds = useMemo(
        () => filteredParticipantOptions.map((o) => o.value),
        [filteredParticipantOptions]
    );

    const watchedGroupedParticipants = Form.useWatch(
        "participants",
        assignmentForm
    );
    const watchedDueDate = Form.useWatch("dueDate", assignmentForm);

    const getParticipantBlockReason = (
        participant: any,
        interventionId?: string
    ): string | null => {
        if (!interventionId) return null;

        const normalizedIvId = normalizeId(interventionId);
        const intervention =
            ivDefsById[normalizedIvId] ||
            ((participant.requiredInterventions || []) as any[]).find(
                (iv: any) => normalizeId(iv.id) === normalizedIvId
            );

        if (!intervention) return null;

        const assignmentMode = getInterventionAssignmentMode(intervention);
        const assignedForParticipant = (assignments || []).filter(
            (a) =>
                String(a?.participantId) === String(participant.id) &&
                isActiveAssignment(a)
        );

        if (assignmentMode === "once-off") {
            const alreadyCompleted = assignedForParticipant.some((a) => {
                if (normalizeId(a?.interventionId) !== normalizedIvId) return false;
                return getCompositeStatus(a).label === "Completed";
            });
            if (alreadyCompleted) return ONCE_OFF_COMPLETED_REASON;
            return null;
        }

        if (assignmentMode === "recurring") {
            const recurrence = getRecurrenceFromIntervention(intervention).recurrence;
            if (!recurrence) return null;

            const due = watchedDueDate ? dayjs(watchedDueDate) : dayjs();
            const newCycleKey = getCycleKeyForMode("recurring", recurrence, due);
            if (!newCycleKey) return null;

            const backlogGate = getOpenCyclePolicyDecision({
                assignedForParticipant,
                ivId: normalizedIvId,
                selectedSubId: null,
                recurring: true,
                recurrence,
                newCycleKey,
            });

            if (backlogGate.blocked) return backlogGate.reason;
        }

        return null;
    };

    const groupedParticipantOptions = useMemo(
        () =>
            (departmentFilteredParticipants || []).map((p) => {
                const blockReason =
                    selectedType === "grouped" && watchedIntervention
                        ? getParticipantBlockReason(p, String(watchedIntervention))
                        : null;

                const label = blockReason ? (
                    <span>
                        {String(p.beneficiaryName || "Unknown")}{" "}
                        <Tag
                            color={isHardBlockReason(blockReason) ? "red" : "orange"}
                            style={{ marginLeft: 8, verticalAlign: "middle" }}
                            title={blockReason}
                        >
                            {isHardBlockReason(blockReason) ? blockReason : "Open cycle"}
                        </Tag>
                    </span>
                ) : (
                    String(p.beneficiaryName || "Unknown")
                );

                return {
                    value: String((p as any).id),
                    label,
                    searchText: String(p.beneficiaryName || "Unknown"),
                    disabled: isHardBlockReason(blockReason),
                };
            }),
        [
            departmentFilteredParticipants,
            selectedType,
            watchedIntervention,
            watchedDueDate,
            assignments,
            ivDefsById,
        ]
    );

    useEffect(() => {
        if (
            !assignmentModalVisible ||
            selectedType !== "grouped" ||
            !watchedIntervention
        )
            return;

        const currentIds: string[] =
            assignmentForm.getFieldValue("participants") || [];
        const invalidIds = currentIds.filter((pid) => {
            const participant = departmentFilteredParticipants.find(
                (p) => String(p.id) === String(pid)
            );
            return (
                !!participant &&
                isHardBlockReason(
                    getParticipantBlockReason(participant, String(watchedIntervention))
                )
            );
        });

        if (invalidIds.length) {
            assignmentForm.setFieldsValue({
                participants: currentIds.filter((pid) => !invalidIds.includes(pid)),
            });
            message.warning(
                "Some selected SMEs cannot be assigned to the chosen intervention and were removed."
            );
        }
    }, [
        assignmentModalVisible,
        selectedType,
        watchedIntervention,
        watchedDueDate,
        assignments,
        departmentFilteredParticipants,
        ivDefsById,
        assignmentForm,
    ]);

    useEffect(() => {
        if (!assignmentModalVisible) return;
        if (selectedType !== "grouped") return;

        const ids = (watchedGroupedParticipants || []).map(String);
        setSharedInterventions(computeShared(ids));
    }, [
        assignmentModalVisible,
        selectedType,
        watchedGroupedParticipants,
        departmentFilteredParticipants,
    ]);

    const visibleAssignments = useMemo(() => {
        const ids = new Set(baseParticipants.map((p) => String((p as any).id)));
        return (assignments || [])
            .filter((a) => ids.has(String((a as any).participantId)))
            .map(a => {
                // The persisted key is the only key that can identify a
                // shared delivery document at this point in the render.
                const groupKey = isGroupedAssignmentRecord(a)
                    ? normalizeAssignmentGroupKey(a)
                    : '';
                return {
                    ...a,
                    groupDelivery: groupKey ? groupDeliveries[String(groupKey)] || null : null,
                    appointmentResponseState: appointmentResponseByAssignmentId[String((a as any).id || '')] || 'not_scheduled',
                };
            });
    }, [assignments, baseParticipants, appointmentResponseByAssignmentId, groupDeliveries]);

    const assignmentDate = (a: any) =>
        a.createdAt?.toDate?.() ||
        a.assignedAt?.toDate?.() ||
        a.updatedAt?.toDate?.() ||
        a.dueDate?.toDate?.() ||
        null;

    const rangeAssignments = useMemo(() => {
        const [start, end] = dateRange;

        return visibleAssignments.filter((a: any) => {
            const d = assignmentDate(a);
            if (!d) return false;

            return (
                dayjs(d).isAfter(start.startOf("day").subtract(1, "millisecond")) &&
                dayjs(d).isBefore(end.endOf("day").add(1, "millisecond"))
            );
        });
    }, [visibleAssignments, dateRange]);

    const rangeStatusRows = useMemo(() => {
        const map = new Map<string, any>();

        rangeAssignments.forEach((a: any) => {
            const s = getCompositeStatus(a);
            const key = s.label;

            const existing = map.get(key) || {
                status: s.label,
                color: s.color,
                count: 0,
            };

            existing.count += 1;
            map.set(key, existing);
        });

        return Array.from(map.values());
    }, [rangeAssignments]);

    const filteredRangeStatusRows = useMemo(() => {
        if (rangeStatusFilter === "all") return rangeStatusRows;
        return rangeStatusRows.filter(
            (row: any) => String(row.status) === rangeStatusFilter
        );
    }, [rangeStatusRows, rangeStatusFilter]);

    const rangeStatusOptions = useMemo(
        () => [
            { label: "All Statuses", value: "all" },
            ...rangeStatusRows.map((row: any) => ({
                label: row.status,
                value: row.status,
            })),
        ],
        [rangeStatusRows]
    );

    const getEffectiveCycleKey = (a: any, recurrence: Recurrence | null) => {
        const assigned =
            a?.assignedAt?.toDate?.() || a?.createdAt?.toDate?.() || null;

        if (!assigned) return String(a?.cycleKey || "");

        return recurrence
            ? toCycleKey(recurrence, dayjs(assigned))
            : String(a?.cycleKey || "");
    };

    const getAssignmentAudit = (
        participantId: string,
        interventionId: string
    ) => {
        const rows = (assignments || [])
            .filter(
                (a) =>
                    String((a as any).participantId) === String(participantId) &&
                    String((a as any).interventionId) === String(interventionId)
            )
            .sort((a, b) => {
                const ad = a?.updatedAt?.toDate?.() ?? a?.createdAt?.toDate?.() ?? 0;
                const bd = b?.updatedAt?.toDate?.() ?? b?.createdAt?.toDate?.() ?? 0;
                return Number(bd) - Number(ad);
            });

        const activeRows = rows.filter(
            (a) => safeLower(a?.assignmentStatus) !== "cancelled"
        );
        const current = activeRows[0] || rows[0] || null;

        const completed = rows.filter(
            (a) => getCompositeStatus(a).label === "Completed"
        );
        const inProgress = rows.filter(
            (a) => getCompositeStatus(a).label === "In Progress"
        );
        const awaitingAcceptance = rows.filter((a) => {
            const label = getCompositeStatus(a).label;
            return label === "Ready to Schedule" || label === "Awaiting Appointment Response";
        });
        const needsReassignment = rows.filter(
            (a) => getCompositeStatus(a).label === "Needs Reassignment"
        );
        const cancelled = rows.filter(
            (a) => getCompositeStatus(a).label === "Cancelled"
        );
        const declined = rows.filter((a) => isDeclinedAssignment(a));

        const groupedCount = rows.filter((a) =>
            isGroupedAssignmentRecord(a)
        ).length;
        const singleCount = rows.filter(
            (a) => !isGroupedAssignmentRecord(a)
        ).length;

        const currentStatus = current
            ? getCompositeStatus(current)
            : { label: "Unassigned", color: "default" };
        const bottleneck = current ? getBottleneck(current) : null;

        return {
            rows,
            current,
            currentStatus,
            bottleneck,
            totalAssignments: rows.length,
            completedCount: completed.length,
            inProgressCount: inProgress.length,
            awaitingAcceptanceCount: awaitingAcceptance.length,
            needsReassignmentCount: needsReassignment.length,
            cancelledCount: cancelled.length,
            declinedCount: declined.length,
            hasEverCompleted: completed.length > 0,
            latestCompletedAt:
                completed[0]?.updatedAt ?? completed[0]?.createdAt ?? null,
            groupedCount,
            singleCount,
            latestType: current?.type || null,
        };
    };

    const interventionDemandRows = useMemo(() => {
        const map = new Map<string, any>();

        baseParticipants.forEach((p: any) => {
            (p.requiredInterventions || []).forEach((iv: any) => {
                const key = String(iv.id);
                const audit = getAssignmentAudit(String(p.id), key);

                const row = map.get(key) || {
                    interventionId: key,
                    interventionTitle: iv.interventionTitle || iv.title || "Untitled",
                    needed: 0,
                    assigned: 0,
                    completed: 0,
                    unassigned: 0,
                    openStatuses: {} as Record<string, number>,
                };

                row.needed += 1;
                if (audit.totalAssignments > 0) row.assigned += 1;
                if (audit.totalAssignments === 0) {
                    row.unassigned += 1;
                } else if (audit.currentStatus.label === "Completed") {
                    row.completed += 1;
                } else {
                    const status = audit.currentStatus.label || "Open";
                    row.openStatuses[status] = (row.openStatuses[status] || 0) + 1;
                }

                map.set(key, row);
            });
        });

        return Array.from(map.values()).map((row) => ({
            ...row,
            completionRate: row.needed
                ? Math.round((row.completed / row.needed) * 100)
                : 0,
            openStatusSummary: Object.entries(row.openStatuses).map(
                ([status, count]) => ({ status, count })
            ),
        }));
    }, [baseParticipants, assignments]);

    const filteredInterventionDemandRows = useMemo(() => {
        const term = norm(demandSearchText);

        return interventionDemandRows.filter((row: any) => {
            const matchesSearch =
                !term || norm(row.interventionTitle).includes(term);

            const matchesCoverage =
                demandCoverageFilter === "all"
                    ? true
                    : demandCoverageFilter === "needs-allocation"
                        ? Number(row.unassigned || 0) > 0
                        : demandCoverageFilter === "open"
                            ? Number(row.assigned || 0) > Number(row.completed || 0)
                            : Number(row.completionRate || 0) >= 100;

            return matchesSearch && matchesCoverage;
        });
    }, [
        interventionDemandRows,
        demandSearchText,
        demandCoverageFilter,
    ]);

    const getParticipantCoverage = (pid: string) => {
        const requiredIds = Array.from(
            new Set((participantInterventionMap[pid] || []).map(String))
        );

        let assigned = 0;
        let completed = 0;
        let currentOpen = 0;
        let grouped = 0;

        requiredIds.forEach((ivId) => {
            const audit = getAssignmentAudit(pid, ivId);

            if (audit.totalAssignments > 0) assigned += 1;
            // if (audit.hasEverCompleted) completed += 1
            if (audit.currentStatus.label === "Completed") completed += 1;
            if (audit.current && audit.currentStatus.label !== "Completed")
                currentOpen += 1;
            if (audit.groupedCount > 0) grouped += 1;
        });

        return {
            required: requiredIds.length,
            assigned,
            completed,
            currentOpen,
            grouped,
        };
    };

    const beneficiaryRows = useMemo(() => {
        return filteredParticipants.filter((participant: any) => {
            if (beneficiaryCoverageFilter === "all") return true;

            const coverage = getParticipantCoverage(String(participant.id));

            if (beneficiaryCoverageFilter === "needs-assignment") {
                return coverage.assigned < coverage.required;
            }

            if (beneficiaryCoverageFilter === "open") {
                return coverage.currentOpen > 0;
            }

            return (
                coverage.required > 0 &&
                coverage.completed >= coverage.required
            );
        });
    }, [
        filteredParticipants,
        beneficiaryCoverageFilter,
        assignments,
        participantInterventionMap,
    ]);

    const activeSmeCount = baseParticipants.length;

    const totalAssigned = baseParticipants.reduce((sum, p) => {
        const stats = getParticipantCoverage(String((p as any).id));
        return sum + stats.assigned;
    }, 0);

    const totalRequired = baseParticipants.reduce((sum, p) => {
        const stats = getParticipantCoverage(String((p as any).id));
        return sum + stats.required;
    }, 0);

    const totalCompleted = baseParticipants.reduce((sum, p) => {
        const stats = getParticipantCoverage(String((p as any).id));
        return sum + stats.completed;
    }, 0);

    const completionRate = totalRequired
        ? Math.round((totalCompleted / totalRequired) * 100)
        : 0;
    const needsReassignCount = visibleAssignments.filter(
        (a) => getCompositeStatus(a).label === "Needs Reassignment"
    ).length;

    const handleManageParticipant = (p: Participant) => {
        setSelectedParticipant(p);
        setManageModalVisible(true);
        setInterventionFilter("all");
    };

    const getRecurrenceMetaSafe = (
        ivId: string,
        iv: any,
        assignedForParticipant: any[]
    ) => {
        // 1) Prefer definitions (interventions collection)
        const metaFromDef = getRecurrenceFromIntervention(iv);
        if (typeof metaFromDef.recurring === "boolean" && metaFromDef.recurrence)
            return metaFromDef;

        // 2) Fallback: infer from ANY existing assignment for this intervention
        const any = pickLatestByUpdated(
            assignedForParticipant.filter(
                (a) => String(a?.interventionId) === String(ivId)
            )
        );

        if (any) {
            const recurring = !!any.recurring;
            const recurrence = any.recurrence ?? null;
            const recurrencePreset = any.recurrencePreset ?? null;
            const recurrenceStrict =
                typeof any.recurrenceStrict === "boolean"
                    ? !!any.recurrenceStrict
                    : null;

            return { recurring, recurrence, recurrencePreset, recurrenceStrict };
        }

        // 3) Default
        return metaFromDef;
    };

    const getFilteredInterventions = () => {
        if (!selectedParticipant) return [];

        const participantId = String((selectedParticipant as any).id);
        const validArea = norm(userDepartment?.name || "");
        const requiredAllRaw = ((selectedParticipant as any)
            .requiredInterventions || []) as any[];

        const requiredAll = dedupeInterventions(
            requiredAllRaw.filter((iv) =>
                userDepartment && !userDepartment?.isMain
                    ? norm(iv?.area || iv?.areaOfSupport) === validArea
                    : true
            )
        );

        const assignedForParticipant = (assignments || []).filter(
            (a) =>
                String((a as any).participantId) === participantId &&
                isActiveAssignment(a)
        );

        const now = dayjs();

        const rows = requiredAll.map((ivRaw) => {
            const ivId = String(ivRaw?.id || "");
            const def = ivDefsById[ivId] || null;
            const iv = def ? { ...ivRaw, ...def } : ivRaw;

            const areaText =
                iv?.areaOfSupport || iv?.area || userDepartment?.name || null;
            const mapDep = departments.find((d) => ciEq(d?.name, areaText));
            const depId =
                iv?.departmentId ?? mapDep?.id ?? userDepartment?.id ?? null;

            const { recurring, recurrencePreset, recurrence, recurrenceStrict } =
                getRecurrenceMetaSafe(ivId, iv, assignedForParticipant);

            const currentCycleKey =
                recurring && recurrence ? toCycleKey(recurrence, now) : null;

            const openPrevInfo = getOpenPrevCycleInfo({
                assignedForParticipant,
                ivId,
                recurring,
                recurrence,
                currentCycleKey,
                selectedSubId: null,
            });

            const audit = getAssignmentAudit(participantId, ivId);

            const current =
                recurring && currentCycleKey
                    ? audit.rows.find(
                        (a: any) =>
                            getEffectiveCycleKey(a, recurrence) === currentCycleKey
                    ) || null
                    : audit.current;

            if (current) {
                return {
                    id: ivId,
                    interventionId: ivId,
                    interventionTitle: getIvTitle(iv),

                    isUnassigned: false,

                    assigneeName: current?.assigneeName || "—",
                    assigneeId: current?.assigneeId || "",
                    dueDate: current?.dueDate ?? null,

                    recurring,
                    recurrencePreset,
                    recurrence,
                    recurrenceStrict,
                    cycleKey: current?.cycleKey ?? currentCycleKey,

                    departmentId: depId,
                    areaOfSupport: areaText,

                    currentAssignment: current,

                    // The SME declined this one. It stays visible for history,
                    // but it must not stand in the way of a fresh assignment.
                    currentDeclined: isDeclinedAssignment(current),

                    currentStatus: getCompositeStatus(current),
                    bottleneck: getBottleneck(current),

                    totalAssignments: audit.totalAssignments,
                    completedCount: audit.completedCount,
                    inProgressCount: audit.inProgressCount,
                    awaitingAcceptanceCount: audit.awaitingAcceptanceCount,
                    needsReassignmentCount: audit.needsReassignmentCount,
                    hasEverCompleted: audit.hasEverCompleted,
                    latestCompletedAt: audit.latestCompletedAt,
                    groupedCount: audit.groupedCount,
                    singleCount: audit.singleCount,
                    latestType: audit.latestType,
                    auditRows: audit.rows,
                };
            }

            const blockedByPrevCycle = !!openPrevInfo;
            const pendingDetail = openPrevInfo?.bottleneck?.label
                ? ` ${openPrevInfo.bottleneck.label}`
                : "";

            const unassignedReason = recurring
                ? blockedByPrevCycle
                    ? `Previous cycle still open (${openPrevInfo!.openCycleKey
                    }).${pendingDetail}`
                    : currentCycleKey
                        ? `Not assigned for this period (${currentCycleKey}).`
                        : `Not assigned for the current period.`
                : `Not assigned.`;

            const unassignedLabel =
                recurring && currentCycleKey
                    ? `Unassigned (${currentCycleKey})`
                    : "Unassigned";

            return {
                id: ivId,
                interventionId: ivId,
                interventionTitle: getIvTitle(iv),

                assigneeName: "Not Assigned",
                assigneeId: "",
                dueDate: null,

                isUnassigned: true,
                departmentId: depId,
                areaOfSupport: areaText,

                recurring,
                recurrencePreset,
                recurrence,
                recurrenceStrict,
                cycleKey: currentCycleKey,

                unassignedReason,
                unassignedLabel,

                blockedByPrevCycle,
                openPrevCycleKey: openPrevInfo?.openCycleKey ?? null,
                bottleneck: openPrevInfo?.bottleneck ?? null,
                openPrevOverallLabel: openPrevInfo?.overallLabel ?? null,
                openPrevOverallColor: openPrevInfo?.overallColor ?? null,
                openPrevAssignment: openPrevInfo?.openAssignment ?? null,

                totalAssignments: audit.totalAssignments,
                completedCount: audit.completedCount,
                inProgressCount: audit.inProgressCount,
                awaitingAcceptanceCount: audit.awaitingAcceptanceCount,
                needsReassignmentCount: audit.needsReassignmentCount,
                hasEverCompleted: audit.hasEverCompleted,
                latestCompletedAt: audit.latestCompletedAt,
                groupedCount: audit.groupedCount,
                singleCount: audit.singleCount,
                latestType: audit.latestType,
                auditRows: audit.rows,
            };
        });

        if (interventionFilter === "assigned")
            return rows.filter((r: any) => !r.isUnassigned);
        if (interventionFilter === "unassigned")
            return rows.filter((r: any) => r.isUnassigned);
        return rows;
    };

    const openAssignNew = () => {
        setLockedParticipantId(null);
        setLockSource(null);
        setLockedIntervention(null);
        setReassigningAssignment(null);
        setSelectedType("singular");
        assignmentForm.resetFields();
        assignmentForm.setFieldsValue({
            type: "singular",
            assignTo: "self",
        });
        setAssignmentModalVisible(true);
    };

    const handleQuickAssign = (iv: any) => {
        if (!selectedParticipant) return;
        setLockedIntervention({ id: normalizeId(iv.id) });
        setLockedParticipantId(String((selectedParticipant as any).id));
        setLockSource("manage");
        setManageModalVisible(false);
        setReassigningAssignment(null);

        const useGrouped =
            !!iv?.groupedAssignment ||
            !!normalizeAssignmentGroupKey(iv) ||
            String(iv?.latestType) === "grouped";

        assignmentForm.setFieldsValue({
            type: useGrouped ? "grouped" : "singular",
            assignTo: "self",
            participant: useGrouped ? undefined : (selectedParticipant as any).id,
            participants: useGrouped
                ? [String((selectedParticipant as any).id)]
                : undefined,
            intervention: normalizeId(iv.id),
        });
        setSelectedType(useGrouped ? "grouped" : "singular");
        setAssignmentModalVisible(true);
    };

    const handleQuickReassign = (a: any) => {
        setReassigningAssignment(a);
        setLockedIntervention({ id: String((a as any)?.interventionId) });
        setLockedParticipantId(String((a as any)?.participantId));
        setLockSource("manage");
        setManageModalVisible(false);

        assignmentForm.setFieldsValue({
            type: "singular",
            assignTo: "self",
            participant: (a as any)?.participantId,
            intervention: String((a as any)?.interventionId),
            dueDate: (a as any)?.dueDate
                ? dayjs(
                    (a as any)?.dueDate?.toDate
                        ? (a as any).dueDate.toDate()
                        : (a as any)?.dueDate
                )
                : null,
        });
        setSelectedType("singular");
        setAssignmentModalVisible(true);
    };

    const isBlockedByOpenPreviousCycle = (args: {
        assignedForParticipant: any[];
        ivId: string;
        selectedSubId?: string | null;
        recurring: boolean;
        recurrence: Recurrence | null;
        newCycleKey: string | null;
    }) => {
        return getOpenCyclePolicyDecision(args);
    };

    const promptFirstAppointmentSetup = (
        appointmentContext: FirstAppointmentContext
    ) => {
        const createdAssignments = appointmentContext.assignments;

        Modal.confirm({
            centered: true,
            width: isMobile ? "calc(100% - 32px)" : 520,
            icon: null,
            title: null,
            maskClosable: false,
            keyboard: false,

            content: (
                <Result
                    status="success"
                    icon={<CalendarOutlined />}
                    title="Set Up the First Appointment?"
                    subTitle={
                        appointmentContext.grouped
                            ? `You can now schedule the first appointment for all ${createdAssignments.length} SMEs in the group. Each SME will receive a linked appointment invite.`
                            : "You can now schedule the first appointment. The SME will respond to the appointment and intervention together."
                    }
                    style={{
                        padding: isMobile ? "16px 0 8px" : "24px 12px 12px",
                    }}
                />
            ),

            okText: "Set Up Appointment",
            cancelText: "Not Now",

            okButtonProps: {
                type: "primary",
                shape: "round",
                block: true,
            },
            cancelButtonProps: {
                shape: "round",
                block: true,
            },

            footer: (_, { OkBtn, CancelBtn }) => (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                        width: "100%",
                    }}
                >
                    <CancelBtn />
                    <OkBtn />
                </div>
            ),

            onOk: () => {
                setFirstAppointmentContext(appointmentContext);

                firstAppointmentForm.resetFields();
                firstAppointmentForm.setFieldsValue({
                    sessionTitle: `${createdAssignments[0]?.interventionTitle || "Intervention"
                        } - First Session`,
                    plannedCoverage: [],
                    date: dayjs().add(1, "day").startOf("day"),
                    startTime: dayjs().hour(9).minute(0).second(0),
                    endTime: dayjs().hour(10).minute(0).second(0),
                    deliveryMethod: "in_person",
                    useDifferentLocation: false,
                    location: "At Center",
                });

                setFirstAppointmentOpen(true);
            },
        });
    };

    const handleAssignOrReassign = async (values: any) => {
        if (assignmentWriteLockRef.current) return;
        assignmentWriteLockRef.current = true;
        setSavingAssignment(true);
        try {
            const isGrouped = values.type === "grouped";
            const selectedIds: string[] = isGrouped
                ? values.participants
                : [values.participant];
            const assignTo = values.assignTo as "self" | "coordinator" | "hod";

            const selfId = assigneeId || user?.email || "operations-user";
            const selfName =
                assigneeName || (user as any)?.name || user?.email || "Operations";
            const selfAssigneeRole: AssigneeRole =
                assigneeRole === "operations" ? "operations" : "coordinator";

            // Progress is now purely automatic: planned vs. held sessions.
            // No target mode to choose - see shared/appointments coverage save.
            const plannedSessions = Math.max(1, Number(values.plannedSessions) || 1);

            if (!values.dueDate) {
                message.error("Please select a due date");
                return;
            }

            const due = dayjs(values.dueDate);
            const recurrence: Recurrence | null = values.recurrence ?? null;
            const recurrencePreset: RecurrencePreset | null =
                values.recurrencePreset ?? null;
            const recurring = !!values.recurring;
            const recurrenceStrict: boolean | null =
                typeof values.recurrenceStrict === "boolean"
                    ? !!values.recurrenceStrict
                    : null;

            const cycleKey =
                recurring && recurrence ? toCycleKey(recurrence, due) : null;
            const derivedFrequency: InterventionFrequency = deriveAssignmentFrequency(
                recurrencePreset,
                recurrence
            );

            const deptId = String(
                (user as any)?.departmentId || userDepartment?.id || ""
            );
            const deptName = String(
                user?.departmentName || userDepartment?.name || ""
            );

            const isAllowedByDp = (pid: string) => {
                if (isMonitoringDepartment) return true;

                const dp = dpByPid[String(pid)];
                return !!dp && hasBothConfirmationsForDept(dp, deptId, deptName);
            };

            for (const pid of selectedIds) {
                if (!isAllowedByDp(String(pid))) {
                    message.error(
                        "This SME is not ready: Diagnostic Plan must be confirmed by both the department and the SME."
                    );
                    return;
                }
            }

            if (reassigningAssignment) {
                let finalAssigneeId = selfId;
                let finalAssigneeName = selfName;
                let finalAssigneeEmail = String(user?.email || "")
                    .trim()
                    .toLowerCase();
                if (assignTo === "coordinator") {
                    const c = coordinators.find((c) => c.id === values.coordinator);

                    if (!c) {
                        message.error("Please select a facilitator");
                        return;
                    }

                    finalAssigneeId = c.id;
                    finalAssigneeName = c.name;
                    finalAssigneeEmail = String(c.email || "")
                        .trim()
                        .toLowerCase();
                } else if (assignTo === "hod") {
                    const h = hodList.find((h) => h.id === values.hodId);

                    if (!h) {
                        message.error("Please select an HOD");
                        return;
                    }

                    finalAssigneeId = h.id;
                    finalAssigneeName = h.name;
                    finalAssigneeEmail = String(h.email || "")
                        .trim()
                        .toLowerCase();
                }

                const prev: any = reassigningAssignment;
                const nextPlannedSessions = prev.plannedSessions ?? plannedSessions;
                const preservedTracking = prev.tracking ?? null;
                const computedProgress =
                    typeof prev.computedProgress === "number"
                        ? prev.computedProgress
                        : computeProgress(nextPlannedSessions, preservedTracking);

                const effectiveAssignTo: AssigneeRole =
                    assignTo === "self"
                        ? selfAssigneeRole
                        : assignTo === "hod"
                            ? "operations"
                            : "coordinator";
                const s = decideReassignStatuses(prev);

                const nextDueDate = values.dueDate
                    ? Timestamp.fromDate(values.dueDate.toDate())
                    : prev.dueDate ?? null;

                const reassignmentEntry = {
                    fromAssigneeId: prev.assigneeId || null,
                    fromAssigneeName: prev.assigneeName || null,
                    toAssigneeId: finalAssigneeId || null,
                    toAssigneeName: finalAssigneeName || null,
                    by: assigneeName || "System",
                    at: Timestamp.now(),
                };

                await assignedInterventionService.update(String(prev.id), {
                    assigneeRole: effectiveAssignTo,
                    assigneeId: finalAssigneeId,
                    assigneeName: finalAssigneeName,
                    assignmentStatus: s.assignmentStatus,
                    participantAcceptanceStatus: s.participantAcceptanceStatus,
                    participantCompletionStatus: s.participantCompletionStatus,
                    assigneeAcceptanceStatus: s.assigneeAcceptanceStatus,
                    assigneeAcceptedAt: Timestamp.now(),
                    assigneeDeclinedAt: null,
                    assigneeDeclineReason: null,
                    assigneeCompletionStatus: s.assigneeCompletionStatus,
                    programId: (prev as any).programId ?? activeProgramId ?? null,

                    dueDate: nextDueDate,

                    scheduleMode: recurring ? "recurring" : "once-off",
                    recurrence: recurrence
                        ? { ...recurrence, strict: !!recurrenceStrict }
                        : null,
                    cycleKey: cycleKey ?? (prev as any).cycleKey ?? null,

                    plannedSessions: nextPlannedSessions ?? null,
                    tracking: preservedTracking ?? undefined,
                    computedProgress,
                    updatedAt: Timestamp.now(),
                    countedAt: null,
                    reassignmentHistory: [
                        ...(Array.isArray((prev as any).reassignmentHistory)
                            ? (prev as any).reassignmentHistory
                            : []),
                        reassignmentEntry,
                    ],
                });

                const updatedAssignment = {
                    ...prev,
                    assigneeRole: effectiveAssignTo,
                    assigneeId: finalAssigneeId,
                    assigneeName: finalAssigneeName,
                    assigneeEmail: finalAssigneeEmail || null,

                    dueDate: nextDueDate,

                    scheduleMode: recurring ? "recurring" : "once-off",
                    recurrence: recurrence
                        ? {
                            ...recurrence,
                            strict: !!recurrenceStrict,
                        }
                        : null,
                    cycleKey: cycleKey ?? prev.cycleKey ?? null,

                    plannedSessions: nextPlannedSessions ?? null,
                    tracking: preservedTracking ?? undefined,
                    computedProgress,
                };

                const appointmentContext: FirstAppointmentContext = {
                    assignments: [updatedAssignment],
                    grouped: false,
                    groupKey: null,
                    assigneeId: finalAssigneeId,
                    assigneeName: finalAssigneeName,
                    assigneeEmail: finalAssigneeEmail,
                    assigneeRole: effectiveAssignTo,
                };

                message.success("Assignment reassigned successfully");

                setAssignmentModalVisible(false);
                setLockedIntervention(null);
                setReassigningAssignment(null);
                setLockedParticipantId(null);
                setLockSource(null);
                assignmentForm.resetFields();

                promptFirstAppointmentSetup(appointmentContext);
                return;
            }

            let finalAssigneeId = selfId;
            let finalAssigneeName = selfName;
            let finalAssigneeEmail = String(user?.email || "")
                .trim()
                .toLowerCase();
            if (assignTo === "coordinator") {
                const c = coordinators.find((c) => c.id === values.coordinator);
                if (!c) {
                    message.error("Please select a coordinator");
                    return;
                }
                finalAssigneeId = c.id;
                finalAssigneeName = c.name;
                finalAssigneeEmail = String(c.email || "")
                    .trim()
                    .toLowerCase();
            } else if (assignTo === "hod") {
                const h = hodList.find((h) => h.id === values.hodId);
                if (!h) {
                    message.error("Please select an HOD");
                    return;
                }
                finalAssigneeId = h.id;
                finalAssigneeName = h.name;
                finalAssigneeEmail = String(h.email || "")
                    .trim()
                    .toLowerCase();
            }

            const newAssigneeRole: AssigneeRole =
                assignTo === "self"
                    ? selfAssigneeRole
                    : assignTo === "hod"
                        ? "operations"
                        : "coordinator";

            const preparedRows: any[] = [];

            for (const pid of selectedIds) {
                const participant = participants.find(
                    (p) => String((p as any).id) === String(pid)
                );
                if (!participant) continue;

                const ivId = String(values.intervention);
                const intervention = (
                    (participant as any).requiredInterventions || []
                ).find((i: any) => String(i.id) === ivId);
                if (!intervention) continue;

                const interventionDef = ivDefsById[ivId] || null;
                const fullIntervention = interventionDef
                    ? { ...intervention, ...interventionDef }
                    : intervention;

                const subs = getActiveSubInterventions(fullIntervention);

                const hasSubs =
                    !!(fullIntervention as any)?.hasSubInterventions || subs.length > 0;

                const assignmentMode = getInterventionAssignmentMode(fullIntervention);

                const selectedSubId =
                    assignmentMode === "ad-hoc"
                        ? String(values.subIntervention || "").trim()
                        : hasSubs
                            ? String(values.subIntervention || "")
                            : "";

                if (hasSubs && !selectedSubId) {
                    message.error("Please select a sub-intervention");
                    return;
                }

                const subObj = hasSubs
                    ? subs.find((s: any) => String(s.subId) === selectedSubId)
                    : null;
                const selectedSubTitle =
                    assignmentMode === "ad-hoc"
                        ? String(values.subIntervention || "").trim()
                        : subObj?.title
                            ? String(subObj.title)
                            : "";

                const assignedForParticipant = (assignments || []).filter(
                    (a) =>
                        String((a as any).participantId) === String(pid) &&
                        isActiveAssignment(a)
                );

                const ivMeta = getRecurrenceFromIntervention(fullIntervention);
                const recurrenceLocal = ivMeta.recurrence ?? recurrence;
                const assignedAt = values.assignedAt
                    ? dayjs(values.assignedAt)
                    : dayjs();

                const cycleKeyLocal = getCycleKeyForMode(
                    assignmentMode,
                    recurrenceLocal,
                    assignedAt
                );

                if (assignmentMode === "once-off") {
                    const alreadyCompleted = assignedForParticipant.some((a) => {
                        if (String(a?.interventionId) !== String(ivId)) return false;
                        if (
                            hasSubs &&
                            String(a?.subInterventionId || "") !== String(selectedSubId)
                        )
                            return false;
                        return getCompositeStatus(a).label === "Completed";
                    });

                    if (alreadyCompleted) {
                        message.error(
                            "This once-off intervention has already been completed and cannot be assigned again."
                        );
                        return;
                    }
                }

                const backlogGate = isBlockedByOpenPreviousCycle({
                    assignedForParticipant,
                    ivId,
                    selectedSubId: hasSubs ? selectedSubId : null,
                    recurring: assignmentMode === "recurring",
                    recurrence: recurrenceLocal,
                    newCycleKey: cycleKeyLocal,
                });

                // An open previous cycle is a warning, not a stop. The
                // department still has to be able to assign the current cycle;
                // the backlog is surfaced here and recorded as risk below.
                if (backlogGate.blocked) {
                    message.warning(backlogGate.reason);
                }

                // Record every open previous cycle, not just the lenient ones.
                // A cycle that would once have stopped the assignment now lets
                // it through, so the risk trail is the only place it is kept.
                const priorOpenCycleRisk = backlogGate.openCycles?.length
                    ? {
                        issue: "SME responsiveness risk",
                        status: "watchlist",
                        reason:
                            "Previous cycle(s) remain open without SME acceptance or confirmation.",
                        threshold: LENIENT_OPEN_CYCLE_LIMIT,
                        assignedOverOpenCycle: !!backlogGate.blocked,
                        priorOpenCycleCount: backlogGate.openCycles.length,
                        priorSmeResponsivenessCycleCount:
                            backlogGate.smeResponsivenessCycles?.length || 0,
                        departmentId:
                            (fullIntervention as any)?.departmentId ??
                            (user as any)?.departmentId ??
                            null,
                        departmentName:
                            (fullIntervention as any)?.areaOfSupport ??
                            (fullIntervention as any)?.area ??
                            (user as any)?.departmentName ??
                            null,
                        cycles: backlogGate.openCycles.map((a: any) => ({
                            assignmentId: String(a?.id || ""),
                            cycleKey: String(a?.cycleKey || ""),
                            interventionTitle: String(
                                a?.interventionTitle || getIvTitle(fullIntervention) || ""
                            ),
                            issue: getBottleneck(a).pendingType,
                            label: getBottleneck(a).label,
                        })),
                    }
                    : null;

                const tracking: Tracking = {
                    sessionsLogged: 0,
                };

                const computedProgress = computeProgress(plannedSessions, tracking);

                const departmentIdToSave =
                    (fullIntervention as any)?.departmentId ??
                    (user as any)?.departmentId ??
                    null;
                const areaOfSupportToSave =
                    (fullIntervention as any)?.areaOfSupport ??
                    (fullIntervention as any)?.area ??
                    (user as any)?.departmentName ??
                    null;

                const app = appsByPid[String((participant as any).id)];
                const programIdToSave = app?.programId ?? activeProgramId ?? null;
                const smmeNo = app?.smmENo ?? app?.smmeNo ?? app?.SMMENo ?? null;

                const newId = `ai_${pid}_${ivId}_${hasSubs ? selectedSubId : "nosub"}_${cycleKeyLocal || "single-cycle"
                    }_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                preparedRows.push({
                    id: newId,
                    participantId: String((participant as any).id),
                    participantName: (participant as any).beneficiaryName || "Unknown",
                    smmeNo,
                    interventionId: ivId,
                    interventionTitle: getIvTitle(fullIntervention),
                    hasSubInterventions: hasSubs,
                    subInterventionId: hasSubs ? selectedSubId : null,
                    subInterventionTitle: hasSubs ? selectedSubTitle : null,
                    definitionVersion: Math.max(
                        1,
                        Number((fullIntervention as any)?.definitionVersion || 1)
                    ),
                    definitionSnapshot: {
                        version: Math.max(
                            1,
                            Number((fullIntervention as any)?.definitionVersion || 1)
                        ),
                        interventionId: ivId,
                        interventionTitle: getIvTitle(fullIntervention),
                        subInterventionId: hasSubs ? selectedSubId : null,
                        subInterventionTitle: hasSubs ? selectedSubTitle : null,
                        capturedAt: Timestamp.now(),
                    },
                    dueDate: values.dueDate
                        ? Timestamp.fromDate(values.dueDate.toDate())
                        : null,
                    assigneeRole: newAssigneeRole,
                    assigneeId: finalAssigneeId,
                    assigneeName: finalAssigneeName,
                    assigneeEmail: finalAssigneeEmail || null,
                    assignmentStatus: "assigned",
                    assigneeAcceptanceStatus: "accepted",
                    assigneeAcceptedAt: Timestamp.now(),
                    participantAcceptanceStatus: "pending",
                    assigneeCompletionStatus: "pending",
                    participantCompletionStatus: "pending",
                    areaOfSupport: areaOfSupportToSave,
                    departmentId: departmentIdToSave,
                    programId: programIdToSave,
                    scheduleMode: assignmentMode,
                    cycleKey: cycleKeyLocal,
                    recurrence:
                        ivMeta.recurrence ?? recurrence
                            ? {
                                ...(ivMeta.recurrence ?? recurrence),
                                strict: !!(ivMeta.recurrenceStrict ?? recurrenceStrict),
                            }
                            : null,
                    priorOpenCycleRisk,
                    plannedSessions,
                    tracking,
                    computedProgress,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });
            }

            if (!preparedRows.length) {
                message.error("No valid assignments were prepared.");
                return;
            }

            const first = preparedRows[0];
            const grouped = isGrouped && preparedRows.length > 1;

            const groupKey = grouped
                ? makeGroupKey({
                    interventionId: first.interventionId,
                    assigneeId: first.assigneeId,
                    programId: first.programId,
                    departmentId: first.departmentId,
                    cycleKey: first.cycleKey,
                })
                : null;

            const batch = writeBatch(db);

            for (const row of preparedRows) {
                const payload: any = {
                    ...row,
                    type: grouped ? "grouped" : "singular",
                    groupKey: grouped ? groupKey : null,
                    groupedAt: grouped ? Timestamp.now() : null,
                };

                batch.set(
                    assignedInterventionService.docRef(String(row.id)),
                    canonicalizeAssignedInterventionWrite(payload)
                );
            }

            await batch.commit();

            message.success(
                grouped
                    ? "Grouped intervention assigned successfully"
                    : "Intervention assigned successfully"
            );

            const createdAssignments = preparedRows.map((row) => ({
                ...row,
                type: grouped ? "grouped" : "singular",
                groupKey: grouped ? groupKey : null,
            }));
            const appointmentContext: FirstAppointmentContext = {
                assignments: createdAssignments,
                grouped,
                groupKey,
                assigneeId: finalAssigneeId,
                assigneeName: finalAssigneeName,
                assigneeEmail: finalAssigneeEmail,
                assigneeRole: newAssigneeRole,
            };

            setAssignmentModalVisible(false);
            setLockedIntervention(null);
            setReassigningAssignment(null);
            setLockedParticipantId(null);
            setLockSource(null);
            assignmentForm.resetFields();

            promptFirstAppointmentSetup(appointmentContext);
        } finally {
            assignmentWriteLockRef.current = false;
            setSavingAssignment(false);
        }
    };

    const getStoredAssignmentGroupKey = normalizeAssignmentGroupKey;

    const getAssignmentGroupKey = (a: any) => {
        const storedGroupKey = getStoredAssignmentGroupKey(a);
        if (storedGroupKey) return storedGroupKey;
        const cycleKey = getAssignmentCycleKey(a);
        if (!cycleKey) return null;

        return makeCycleGroupKey({
            interventionId: String(
                a?.interventionId || a?.groupMeta?.interventionId || ""
            ),
            assigneeId: String(a?.assigneeId || a?.groupMeta?.assigneeId || ""),
            programId: a?.programId ?? a?.groupMeta?.programId ?? null,
            departmentId: a?.departmentId ?? a?.groupMeta?.departmentId ?? null,
            cycleKey,
        });
    };

    useEffect(() => {
        let disposed = false;
        const constraints = activeProgramId
            ? [where("programId", "==", activeProgramId)]
            : [];
        getDocs(query(collection(db, GROUP_INTERVENTION_DELIVERIES_COLLECTION), ...constraints))
            .then((snapshot) => {
                if (disposed) return;
                const byKey: Record<string, GroupInterventionDelivery> = {};
                snapshot.docs.forEach((item) => {
                    const delivery = item.data() as GroupInterventionDelivery;
                    if (String(delivery.groupKey || "").trim()) {
                        byKey[delivery.groupKey] = { ...delivery, id: item.id };
                    }
                });
                setGroupDeliveries(byKey);
            })
            .catch((error) => {
                console.error("Failed to load shared group deliveries:", error);
                if (!disposed) setGroupDeliveries({});
            });
        return () => { disposed = true; };
    }, [activeProgramId]);

    useEffect(() => {
        let disposed = false;
        const constraints = activeProgramId ? [where("programId", "==", activeProgramId)] : [];
        getDocs(query(collection(db, "appointmentSessions"), ...constraints))
            .then((snapshot) => {
                if (disposed) return;
                const summaries: Record<string, { sessionsHeld: number; attendanceCount: number; attendancePossible: number }> = {};
                snapshot.docs.forEach((item) => {
                    const session = item.data() as any;
                    const groupKey = String(session.groupKey || "").trim();
                    const held = session?.coverage?.held === true || safeLower(session.status) === "completed";
                    if (!groupKey || !held || safeLower(session.status) === "cancelled") return;
                    const summary = summaries[groupKey] || { sessionsHeld: 0, attendanceCount: 0, attendancePossible: 0 };
                    summary.sessionsHeld += 1;
                    summary.attendanceCount += Math.max(0, Number(session?.attendanceSummary?.attendedCount) || Number(session?.attendanceSummary?.checkedInCount) || 0);
                    summary.attendancePossible += Math.max(0, Number(session?.attendanceSummary?.invitedCount) || 0);
                    summaries[groupKey] = summary;
                });
                setGroupSessionSummaries(summaries);
            })
            .catch((error) => {
                console.error("Failed to load group session summaries:", error);
                if (!disposed) setGroupSessionSummaries({});
            });
        return () => { disposed = true; };
    }, [activeProgramId]);

    const groupedInterventionRows = useMemo(() => {
        const map = new Map<string, any>();

        visibleAssignments
            .filter((a: any) => isGroupedAssignmentRecord(a))
            .filter((a: any) => safeLower(a?.assignmentStatus) !== "cancelled")
            .forEach((a: any) => {
                const key = getAssignmentGroupKey(a);
                if (!key) return;

                const current = map.get(key) || {
                    key,
                    groupKey: key,
                    interventionId: a?.interventionId || "",
                    interventionTitle:
                        a?.interventionTitle ||
                        a?.groupMeta?.interventionTitle ||
                        "Untitled",
                    assigneeId: a?.assigneeId || "",
                    assigneeName: a?.assigneeName || "—",
                    programId: a?.programId || null,
                    departmentId: a?.departmentId || null,
                    areaOfSupport: a?.areaOfSupport || null,
                    cycleKey: getAssignmentCycleKey(a) || a?.cycleKey || null,
                    cycleLabel: getAssignmentCycleLabel(a),
                    dueDate: a?.dueDate || a?.groupMeta?.dueDate || null,
                    createdAt: a?.createdAt || a?.assignedAt || null,
                    statusSummary: new Map<string, number>(),
                    participantIds: new Set<string>(),
                    storedGroupKeys: new Set<string>(),
                    members: [],
                    primary: a,
                };

                current.members.push(a);
                const participantId = String(a?.participantId || "");
                if (participantId) current.participantIds.add(participantId);
                const storedGroupKey = getStoredAssignmentGroupKey(a);
                if (storedGroupKey) current.storedGroupKeys.add(storedGroupKey);
                const status = getCompositeStatus(a).label;
                current.statusSummary.set(
                    status,
                    (current.statusSummary.get(status) || 0) + 1
                );

                const currentTime =
                    current.primary?.createdAt?.toDate?.()?.getTime?.() ||
                    current.primary?.assignedAt?.toDate?.()?.getTime?.() ||
                    0;
                const nextTime =
                    a?.createdAt?.toDate?.()?.getTime?.() ||
                    a?.assignedAt?.toDate?.()?.getTime?.() ||
                    0;
                if (nextTime && (!currentTime || nextTime < currentTime))
                    current.primary = a;

                map.set(key, current);
            });

        return Array.from(map.values())
            .map((row) => ({
                ...row,
                memberCount: row.participantIds.size || row.members.length,
                storedGroupKeys: Array.from(row.storedGroupKeys || []),
                statusTags: Array.from(
                    row.statusSummary.entries() as IterableIterator<[string, number]>
                ).map(([label, count]) => ({ label, count })),
            }))
            .sort((a, b) => {
                const cycleDifference = cycleSortValue(b.cycleKey) - cycleSortValue(a.cycleKey);
                if (cycleDifference) return cycleDifference;
                return String(a.interventionTitle).localeCompare(String(b.interventionTitle));
            });
    }, [visibleAssignments]);

    const hasGroupedInterventions = groupedInterventionRows.length > 0;

    useEffect(() => {
        if (!hasGroupedInterventions && viewMode === "groups") {
            setViewMode("beneficiaries");
        }
    }, [hasGroupedInterventions, viewMode]);

    const getGroupMemberName = (assignment: any) => {
        const participant = participants.find(
            (item: any) =>
                String(item?.id || "") === String(assignment?.participantId || "")
        ) as any;

        return (
            String(
                assignment?.beneficiaryName ||
                assignment?.participantName ||
                participant?.beneficiaryName ||
                participant?.name ||
                ""
            ).trim() || "—"
        );
    };

    const getGroupMembers = (groupKey: string) =>
        visibleAssignments
            .filter((a: any) => isGroupedAssignmentRecord(a))
            .filter((a: any) => getAssignmentGroupKey(a) === String(groupKey))
            .filter((a: any) => safeLower(a?.assignmentStatus) !== "cancelled")
            .map((assignment: any) => ({
                ...assignment,
                beneficiaryName: getGroupMemberName(assignment),
            }))
            .sort((a: any, b: any) =>
                String(a.beneficiaryName).localeCompare(String(b.beneficiaryName))
            );

    const getGroupDeliverySnapshot = (group: any) => {
        const sessionSummary = groupSessionSummaries[String(group?.groupKey || "")];
        const sharedDelivery = groupDeliveries[String(group?.groupKey || "")];
        if (sharedDelivery) {
            return {
                sessionsHeld: Math.max(0, Number(sessionSummary?.sessionsHeld) || Number(sharedDelivery.sessionsCompleted) || 0),
                plannedSessions: Math.max(1, Number(sharedDelivery.plannedSessions) || 1),
            };
        }
        if (sessionSummary) {
            return { sessionsHeld: sessionSummary.sessionsHeld, plannedSessions: 1 };
        }
        const members = group?.members?.length
            ? group.members
            : getGroupMembers(String(group?.groupKey || ""));
        const plannedSessions = Math.max(
            1,
            ...members.map((member: any) => Number(member?.plannedSessions) || 1)
        );
        const sessionsHeld = Math.min(
            plannedSessions,
            Math.max(
                0,
                ...members.map((member: any) =>
                    Number(
                        member?.tracking?.sessionsLogged ??
                        member?.progress?.sessionsLogged ??
                        0
                    )
                )
            )
        );

        return { sessionsHeld, plannedSessions };
    };

    const getGroupProgress = (group: any) => {
        const sharedDelivery = groupDeliveries[String(group?.groupKey || "")];
        if (sharedDelivery) {
            return Math.max(0, Math.min(100, Math.round(Number(sharedDelivery.progress) || 0)));
        }
        const members = group?.members?.length
            ? group.members
            : getGroupMembers(String(group?.groupKey || ""));
        if (!members.length) return 0;

        const total = members.reduce((sum: number, member: any) => {
            const progress =
                typeof member?.computedProgress === "number"
                    ? member.computedProgress
                    : getCompositeStatus(member).label === "Completed"
                        ? 100
                        : 0;
            return sum + Math.max(0, Math.min(100, progress));
        }, 0);

        return Math.round(total / members.length);
    };

    const isGroupComplete = (group: any) => getGroupProgress(group) >= 100;

    const filteredGroupedInterventionRows = useMemo(() => {
        const term = norm(groupSearchText);

        return groupedInterventionRows.filter((group: any) => {
            const matchesSearch =
                !term ||
                norm(group.interventionTitle).includes(term) ||
                norm(group.assigneeName).includes(term) ||
                norm(group.cycleLabel).includes(term);

            const progress = getGroupProgress(group);
            const matchesProgress =
                groupProgressFilter === "all"
                    ? true
                    : groupProgressFilter === "completed"
                        ? progress >= 100
                        : progress < 100;

            return matchesSearch && matchesProgress;
        });
    }, [
        groupedInterventionRows,
        groupSearchText,
        groupProgressFilter,
        groupDeliveries,
    ]);

    const singleAssignmentGroupOptions = useMemo(() => {
        const map = new Map<string, any>();

        visibleAssignments
            .filter((a: any) => !isGroupedAssignmentRecord(a))
            .filter((a: any) => safeLower(a?.assignmentStatus) !== "cancelled")
            .forEach((a: any) => {
                const cycleKey = getAssignmentCycleKey(a);
                if (!cycleKey || !a?.interventionId) return;

                const key = makeCycleGroupKey({
                    interventionId: String(a.interventionId || ""),
                    assigneeId: String(a.assigneeId || ""),
                    programId: a.programId ?? null,
                    departmentId: a.departmentId ?? null,
                    cycleKey,
                });

                const current = map.get(key) || {
                    key,
                    title: String(a?.interventionTitle || "Untitled"),
                    cycleLabel: getAssignmentCycleLabel(a),
                    cycleKey,
                    assignments: [],
                };

                current.assignments.push(a);
                map.set(key, current);
            });

        return Array.from(map.values())
            .map((option) => ({
                ...option,
                assignments: option.assignments.sort((a: any, b: any) =>
                    String(a?.beneficiaryName || "").localeCompare(
                        String(b?.beneficiaryName || "")
                    )
                ),
            }))
            .filter((option) => option.assignments.length > 1)
            .sort(
                (a, b) =>
                    String(a.title).localeCompare(String(b.title)) ||
                    String(a.cycleLabel).localeCompare(String(b.cycleLabel))
            );
    }, [visibleAssignments]);

    const selectedConvertSinglesGroup = useMemo(
        () =>
            singleAssignmentGroupOptions.find(
                (option) => option.key === watchedConvertGroupKey
            ),
        [singleAssignmentGroupOptions, watchedConvertGroupKey]
    );

    useEffect(() => {
        if (!groupMembersModalVisible || !selectedGroup?.groupKey) return;

        let cancelled = false;
        const members = getGroupMembers(String(selectedGroup.groupKey));
        const fallback = getGroupDeliverySnapshot({
            ...selectedGroup,
            members,
        });

        setGroupDeliverySummary({
            loading: true,
            sessionsHeld: fallback.sessionsHeld,
            plannedSessions: fallback.plannedSessions,
            attendanceCount: 0,
            attendancePossible: fallback.sessionsHeld * members.length,
        });

        getDocs(query(
            collection(db, "appointmentSessions"),
            where("groupKey", "==", String(selectedGroup.groupKey))
        ))
            .then((snapshot) => {
                if (cancelled) return;
                const completedSessions = snapshot.docs
                    .map((item) => ({ id: item.id, ...(item.data() as any) }))
                    .filter((session) =>
                        safeLower(session.status) !== "cancelled" &&
                        (session?.coverage?.held === true || safeLower(session.status) === "completed")
                    );
                const attendanceCount = completedSessions.reduce(
                    (total, session) => total + Math.max(
                        0,
                        Number(session?.attendanceSummary?.attendedCount) ||
                        Number(session?.attendanceSummary?.checkedInCount) || 0
                    ),
                    0
                );
                const attendancePossible = completedSessions.reduce(
                    (total, session) => total + Math.max(
                        0,
                        Number(session?.attendanceSummary?.invitedCount) || members.length
                    ),
                    0
                );
                const sharedDelivery = groupDeliveries[String(selectedGroup.groupKey)]
                const cachedSessionSummary = groupSessionSummaries[String(selectedGroup.groupKey)]

                setGroupDeliverySummary({
                    loading: false,
                    sessionsHeld: Number(cachedSessionSummary?.sessionsHeld) || completedSessions.length || Number(sharedDelivery?.sessionsCompleted) || fallback.sessionsHeld,
                    plannedSessions: Math.max(1, Number(sharedDelivery?.plannedSessions) || fallback.plannedSessions),
                    attendanceCount: Number(cachedSessionSummary?.attendanceCount) || attendanceCount,
                    attendancePossible: Number(cachedSessionSummary?.attendancePossible) || attendancePossible,
                });
            })
            .catch((error) => {
                console.error("Failed to load group delivery summary:", error);
                if (!cancelled)
                    setGroupDeliverySummary((current) => ({
                        ...current,
                        loading: false,
                    }));
            });

        return () => {
            cancelled = true;
        };
    }, [
        groupMembersModalVisible,
        selectedGroup,
        visibleAssignments,
        participants,
        groupDeliveries,
        groupSessionSummaries,
    ]);

    const openGroupMembers = (group: any) => {
        setSelectedGroup(group);
        setGroupMembersModalVisible(true);
    };

    const openAddToGroup = (group: any) => {
        if (isGroupComplete(group)) {
            message.warning(
                "This group is 100% complete. Create a new group instead of adding more SMEs."
            );
            return;
        }

        setSelectedGroup(group);
        addToGroupForm.resetFields();
        setAddToGroupModalVisible(true);
    };

    const handleConvertSinglesToGroup = async (values: any) => {
        const option = singleAssignmentGroupOptions.find(
            (item) => item.key === values.groupKey
        );
        const selectedIds = new Set((values.assignments || []).map(String));
        const selectedRows = (option?.assignments || []).filter((row: any) =>
            selectedIds.has(String(row.id))
        );

        if (!option || selectedRows.length < 2) {
            message.warning(
                "Select at least two single assignments to convert into a group."
            );
            return;
        }

        setGroupActionLoading(true);
        try {
            const groupKey = option.key;
            const base = selectedRows[0];
            const batch = writeBatch(db);

            selectedRows.forEach((row: any) => {
                batch.set(
                    assignedInterventionService.docRef(String(row.id)),
                    {
                        type: "grouped",
                        groupKey,
                        groupedAssignment: deleteField(),
                        groupMeta: deleteField(),
                        groupMemberCount: deleteField(),
                        cycleKey: option.cycleKey || row?.cycleKey || null,
                        groupedAt: Timestamp.now(),
                        convertedToGroupAt: Timestamp.now(),
                        convertedToGroupBy: user?.email || assigneeId || null,
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
            });

            await batch.commit();
            message.success(
                `Converted ${selectedRows.length} single assignment(s) into a grouped intervention.`
            );
            setConvertSinglesModalVisible(false);
            convertSinglesForm.resetFields();
        } catch (error) {
            console.error(error);
            message.error("Failed to convert single assignments into a group.");
        } finally {
            setGroupActionLoading(false);
        }
    };

    const getEligibleParticipantsForGroup = (group: any) => {
        if (!group) return [];

        const members = new Set(
            getGroupMembers(group.groupKey).map((a: any) => String(a.participantId))
        );
        const deptId = String(
            (user as any)?.departmentId || userDepartment?.id || ""
        );
        const deptName = String(user?.departmentName || userDepartment?.name || "");

        return baseParticipants.filter((p: any) => {
            const pid = String(p.id);
            if (members.has(pid)) return false;

            if (!isMonitoringDepartment) {
                const dp = dpByPid[pid];
                if (!dp || !hasBothConfirmationsForDept(dp, deptId, deptName))
                    return false;
            }

            return ((p.requiredInterventions || []) as any[]).some(
                (iv) => String(iv?.id) === String(group.interventionId)
            );
        });
    };

    const getImportableSingleAssignmentForGroup = (
        group: any,
        participantId: string
    ) => {
        const base = group?.primary || group?.members?.[0] || group;
        const groupCycleKey = String(
            group?.cycleKey || getAssignmentCycleKey(base) || ""
        );

        return (assignments || []).find(
            (a: any) =>
                !isGroupedAssignmentRecord(a) &&
                safeLower(a?.assignmentStatus) !== "cancelled" &&
                String(a?.participantId || "") === String(participantId) &&
                String(a?.interventionId || "") ===
                String(base?.interventionId || group?.interventionId || "") &&
                String(getAssignmentCycleKey(a) || "") === groupCycleKey
        );
    };

    const dateValueToDayjs = (value: any) => {
        if (!value) return null;
        const raw = typeof value?.toDate === "function" ? value.toDate() : value;
        const parsed = dayjs(raw);
        return parsed.isValid() ? parsed : null;
    };

    const appointmentHasStarted = (appt: any) => {
        const start = dateValueToDayjs(appt?.startTime);
        if (!start) return false;

        const date = String(appt?.date || "").trim();
        if (!date) return start.isBefore(dayjs());

        const time = start.format("HH:mm");
        const combined = dayjs(`${date} ${time}`, "YYYY-MM-DD HH:mm");
        return combined.isValid() && combined.isBefore(dayjs());
    };

    const canSyncAppointmentRow = (appt: any) => {
        const status = safeLower(appt?.status);
        if (status === "cancelled" || status === "completed") return false;
        if (status === "in_progress" || status === "in-progress") return false;
        return !appointmentHasStarted(appt);
    };

    const getAppointmentSlotKey = (appt: any) => {
        const start = dateValueToDayjs(appt?.startTime);
        const end = dateValueToDayjs(appt?.endTime);

        return [
            String(appt?.date || ""),
            start ? start.format("HH:mm") : "",
            end ? end.format("HH:mm") : "",
            String(appt?.deliveryMethod || ""),
        ].join("__");
    };

    const resolveParticipantEmailForAssignment = async (
        participantId: string
    ) => {
        const pid = String(participantId || "").trim();
        if (!pid) return "";

        try {
            const snap = await getDoc(doc(db, "participants", pid));
            const data = snap.data() as any;
            return String(
                data?.email ||
                data?.participantEmail ||
                data?.contactEmail ||
                data?.contactInfo?.email ||
                ""
            )
                .trim()
                .toLowerCase();
        } catch {
            return "";
        }
    };

    const handleScheduleFirstAppointment = async (values: any) => {
        if (!firstAppointmentContext || savingFirstAppointment) return;

        const dateKey = values.date?.format?.("YYYY-MM-DD");
        const sessionTitle = String(values.sessionTitle || "").trim();
        const plannedCoverage = (
            Array.isArray(values.plannedCoverage) ? values.plannedCoverage : []
        )
            .map((point: any) => String(point || "").trim())
            .filter(Boolean);

        if (!dateKey || !values.startTime || !values.endTime) {
            message.warning("Please select the appointment date and time.");
            return;
        }
        if (!sessionTitle || !plannedCoverage.length) {
            message.warning("Add a session title and at least one point to cover.");
            return;
        }

        const startDate = dayjs(values.date)
            .hour(values.startTime.hour())
            .minute(values.startTime.minute())
            .second(0)
            .millisecond(0);
        const endDate = dayjs(values.date)
            .hour(values.endTime.hour())
            .minute(values.endTime.minute())
            .second(0)
            .millisecond(0);

        if (!endDate.isAfter(startDate)) {
            message.warning("The end time must be after the start time.");
            return;
        }
        if (startDate.isBefore(dayjs())) {
            message.warning("The first appointment must be scheduled in the future.");
            return;
        }
        if (
            startDate.hour() < 6 ||
            endDate.hour() > 18 ||
            (endDate.hour() === 18 && endDate.minute() > 0)
        ) {
            message.warning("Appointment time must be between 06:00 and 18:00.");
            return;
        }

        const earliestDueAt = firstAppointmentContext.assignments
            .map((row) => dateValueToDayjs(row?.dueDate)?.valueOf() || 0)
            .filter(Boolean)
            .sort((a, b) => a - b)[0];
        if (
            earliestDueAt &&
            startDate.valueOf() > dayjs(earliestDueAt).endOf("day").valueOf()
        ) {
            message.warning(
                "The first appointment cannot be scheduled after the intervention due date."
            );
            return;
        }

        try {
            setSavingFirstAppointment(true);

            const conflictSnap = await getDocs(
                query(
                    collection(db, "appointments"),
                    where("assigneeId", "==", firstAppointmentContext.assigneeId)
                )
            );
            const conflictAppointments = await hydrateAppointmentViews(
                conflictSnap.docs.map((snapshot) => ({
                    id: snapshot.id,
                    data: snapshot.data() as any,
                }))
            );
            const hasConflict = conflictAppointments.some((appointment) => {
                if (safeLower(appointment.status) === "cancelled") return false;

                const existingDate = String(appointment.date || "").trim();
                if (existingDate && existingDate !== dateKey) return false;

                const existingStart = dateValueToDayjs(appointment.startTime);
                const existingEnd = dateValueToDayjs(appointment.endTime);
                if (!existingStart || !existingEnd) return false;

                return (
                    startDate.isBefore(existingEnd) && endDate.isAfter(existingStart)
                );
            });
            if (hasConflict) {
                message.error(
                    "The assigned facilitator already has an appointment during this time."
                );
                return;
            }

            const rowsWithEmail = await Promise.all(
                firstAppointmentContext.assignments.map(async (row) => ({
                    row,
                    participantEmail: await resolveParticipantEmailForAssignment(
                        String(row.participantId || "")
                    ),
                }))
            );
            const appointmentBatch = writeBatch(db);
            const sessionRef = doc(collection(db, "appointmentSessions"));
            const now = Timestamp.now();
            const start = Timestamp.fromDate(startDate.toDate());
            const end = Timestamp.fromDate(endDate.toDate());
            const deliveryMethod = String(values.deliveryMethod || "in_person") as
                | "in_person"
                | "virtual"
                | "telephonically";
            const meetingLink = deliveryMethod === "virtual"
                ? String(values.meetingLink || "").trim() || null
                : null;
            const location = deliveryMethod === "in_person"
                ? String(values.location || "At Center").trim() || null
                : null;
            const template = rowsWithEmail[0]?.row;
            const programId = String(template?.programId || activeProgramId || "");
            const departmentId = String(template?.departmentId || (user as any)?.departmentId || "");

            appointmentBatch.set(sessionRef, {
                schemaVersion: 5,
                programId,
                departmentId,
                interventionId: String(template?.interventionId || ""),
                interventionTitle: String(template?.interventionTitle || ""),
                cycleKey: template?.cycleKey || null,
                groupKey: firstAppointmentContext.grouped
                    ? firstAppointmentContext.groupKey || null
                    : null,
                sessionType: firstAppointmentContext.grouped ? "group" : "individual",
                assigneeId: firstAppointmentContext.assigneeId,
                assigneeName: firstAppointmentContext.assigneeName,
                assigneeEmail: firstAppointmentContext.assigneeEmail || null,
                assigneeRole: firstAppointmentContext.assigneeRole,
                title: sessionTitle,
                startAt: start,
                endAt: end,
                deliveryMethod,
                location,
                meetingLink,
                plannedCoverage,
                coverage: {
                    held: null,
                    outcomeSummary: null,
                    coveredPoints: [],
                    reasonNotHeld: null,
                    recordedAt: null,
                    recordedById: null,
                },
                attendanceSession: null,
                attendanceSummary: {
                    invitedCount: rowsWithEmail.length,
                    attendedCount: 0,
                    checkedInCount: 0,
                    checkedOutCount: 0,
                },
                foodMenu: [],
                status: "scheduled",
                createdAt: now,
                updatedAt: now,
                completedAt: null,
            });

            rowsWithEmail.forEach(({ row, participantEmail }) => {
                const appointmentRef = doc(collection(db, "appointments"));

                appointmentBatch.set(appointmentRef, {
                    schemaVersion: 5,
                    programId: String(row.programId || programId),
                    departmentId: String(row.departmentId || departmentId),
                    assignedInterventionId: String(row.id || ""),
                    appointmentSessionId: sessionRef.id,
                    smeId: String(row.participantId || ""),
                    smeName: String(row.participantName || "Unknown"),
                    smeEmail: participantEmail || null,
                    interventionId: String(row.interventionId || ""),
                    interventionTitle: String(row.interventionTitle || ""),
                    subInterventionId: row.subInterventionId || null,
                    subInterventionTitle: row.subInterventionTitle || null,
                    cycleKey: row.cycleKey || null,
                    assigneeId: firstAppointmentContext.assigneeId,
                    assigneeName: firstAppointmentContext.assigneeName,
                    assigneeEmail: firstAppointmentContext.assigneeEmail || null,
                    assigneeRole: firstAppointmentContext.assigneeRole,
                    groupKey: firstAppointmentContext.grouped
                        ? firstAppointmentContext.groupKey || null
                        : null,
                    status: "scheduled",
                    smeConfirmation: "pending",
                    smeDeclineReason: null,
                    attendance: {
                        status: "expected",
                        checkedInAt: null,
                        checkedOutAt: null,
                    },
                    foodSelections: [],
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null,
                });
            });

            await appointmentBatch.commit();

            message.success(
                firstAppointmentContext.grouped
                    ? `First appointment sent to ${rowsWithEmail.length} SMEs.`
                    : "First appointment sent to the SME."
            );
            setFirstAppointmentOpen(false);
            setFirstAppointmentContext(null);
            firstAppointmentForm.resetFields();
        } catch (error) {
            console.error("Failed to create first appointment:", error);
            message.error("Failed to create the first appointment.");
        } finally {
            setSavingFirstAppointment(false);
        }
    };

    const syncExistingAppointmentsForUpdatedGroup = async (args: {
        groupKey: string;
        allGroupRows: any[];
        addedRows?: any[];
        removedParticipantIds?: string[];
        base?: any;
    }) => {
        const groupKey = String(args.groupKey || "").trim();
        if (!groupKey)
            return {
                addedAppointments: 0,
                cancelledAppointments: 0,
                updatedAppointments: 0,
            };

        const allGroupRows = args.allGroupRows || [];
        const targetParticipantIds = new Set(
            allGroupRows
                .map((row) => String(row?.participantId || ""))
                .filter(Boolean)
        );
        const removedParticipantIds = new Set(
            (args.removedParticipantIds || []).map(String).filter(Boolean)
        );
        const addedRowsByParticipant = new Map(
            (args.addedRows || []).map((row) => [
                String(row?.participantId || ""),
                row,
            ])
        );
        const base = args.base || allGroupRows[0] || null;

        if (!base)
            return {
                addedAppointments: 0,
                cancelledAppointments: 0,
                updatedAppointments: 0,
            };

        const appointmentById = new Map<string, any>();
        const snap = await getDocs(
            query(collection(db, "appointments"), where("groupKey", "==", groupKey))
        );
        snap.docs.forEach((d) =>
            appointmentById.set(d.id, { id: d.id, ...(d.data() as any) })
        );

        const appointmentRows = Array.from(appointmentById.values()).filter(
            (row) => {
                if (
                    activeProgramId &&
                    row?.programId &&
                    row.programId !== activeProgramId
                )
                    return false;
                return true;
            }
        );

        if (!appointmentRows.length) {
            return {
                addedAppointments: 0,
                cancelledAppointments: 0,
                updatedAppointments: 0,
            };
        }

        const slotMap = new Map<string, any[]>();
        appointmentRows.forEach((row) => {
            const key = getAppointmentSlotKey(row);
            if (!slotMap.has(key)) slotMap.set(key, []);
            slotMap.get(key)!.push(row);
        });

        const batch = writeBatch(db);
        const appointmentsCol = collection(db, "appointments");
        let addedAppointments = 0;
        let cancelledAppointments = 0;
        let updatedAppointments = 0;

        for (const slotRows of slotMap.values()) {
            const template = slotRows[0];
            if (!template || !canSyncAppointmentRow(template)) continue;

            const existingByParticipant = new Map(
                slotRows.map((row) => [String(row?.participantId || ""), row])
            );

            for (const removedPid of removedParticipantIds) {
                const appointment = existingByParticipant.get(removedPid);
                if (!appointment || !canSyncAppointmentRow(appointment)) continue;

                batch.set(
                    doc(db, "appointments", String(appointment.id)),
                    {
                        status: "cancelled",
                        removedFromGroupAppointment: true,
                        removedFromGroupAppointmentAt: Timestamp.now(),
                        removedFromGroupAppointmentBy: user?.email || null,
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
                cancelledAppointments += 1;
            }

            for (const [pid, row] of addedRowsByParticipant.entries()) {
                if (!pid || existingByParticipant.has(pid)) continue;
                if (!targetParticipantIds.has(pid)) continue;

                const participantEmail = await resolveParticipantEmailForAssignment(
                    pid
                );
                const appointmentRef = doc(appointmentsCol);

                batch.set(appointmentRef, {
                    consultantId: String(row?.assigneeId || template?.consultantId || ""),
                    consultantName: String(
                        row?.assigneeName || template?.consultantName || ""
                    ),
                    participantId: pid,
                    participantName: String(row?.participantName || "Unknown"),
                    participantEmail,
                    departmentId: row?.departmentId ?? template?.departmentId ?? null,
                    interventionId: String(
                        row?.interventionId || template?.interventionId || ""
                    ),
                    interventionTitle: String(
                        row?.interventionTitle || template?.interventionTitle || ""
                    ),
                    deliveryMethod: template?.deliveryMethod || "in_person",
                    date: template?.date || "",
                    startTime: template?.startTime || null,
                    endTime: template?.endTime || null,
                    meetingLink: template?.meetingLink || "",
                    location: template?.location || "",
                    status: "scheduled",
                    userConfirmation: "pending",
                    createdAt: Timestamp.now(),
                    programId:
                        row?.programId ?? template?.programId ?? activeProgramId ?? null,
                    isGroupAppointment: true,
                    groupKey,
                    appointmentGroupKey: getAppointmentGroupKey(template),
                    groupTemplateId: String(
                        template?.groupTemplateId || row?.interventionId || ""
                    ),
                    groupTitle: String(
                        template?.groupTitle ||
                        row?.interventionTitle ||
                        template?.interventionTitle ||
                        ""
                    ),
                    groupParticipantCount: targetParticipantIds.size,
                    cycleKey: row?.cycleKey ?? template?.cycleKey ?? null,
                    syncedFromAssignmentGroup: true,
                    syncedFromAssignmentGroupAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                } as any);
                addedAppointments += 1;
            }

            slotRows.forEach((row) => {
                if (!canSyncAppointmentRow(row)) return;
                if (removedParticipantIds.has(String(row?.participantId || ""))) return;

                batch.set(
                    doc(db, "appointments", String(row.id)),
                    {
                        groupParticipantCount: targetParticipantIds.size,
                        groupKey,
                        syncedFromAssignmentGroupAt: Timestamp.now(),
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
                updatedAppointments += 1;
            });
        }

        if (addedAppointments || cancelledAppointments || updatedAppointments) {
            await batch.commit();
        }

        return { addedAppointments, cancelledAppointments, updatedAppointments };
    };

    const handleAddSmesToExistingGroup = async (values: any) => {
        if (!selectedGroup) return;

        const groupKey = String(selectedGroup.groupKey || "");
        const base = selectedGroup.primary || selectedGroup.members?.[0];
        const selectedCycleKey = String(
            selectedGroup.cycleKey || getAssignmentCycleKey(base) || ""
        );
        const participantIds = (values.participants || []).map(String);

        if (!groupKey || !base || !participantIds.length) {
            message.error("Select at least one SME to add to this group.");
            return;
        }

        const currentMembers = getGroupMembers(groupKey);
        if (
            getGroupProgress({ ...selectedGroup, members: currentMembers }) >= 100
        ) {
            message.error(
                "Cannot add SMEs to a group that is already 100% complete."
            );
            return;
        }

        setGroupActionLoading(true);
        try {
            const existingMembers = currentMembers;
            const existingParticipantIds = new Set(
                existingMembers.map((a: any) => String(a.participantId))
            );
            const newRows: any[] = [];
            const importedRows: any[] = [];

            for (const pid of participantIds) {
                if (existingParticipantIds.has(pid)) continue;

                const participant = participants.find(
                    (p: any) => String(p.id) === pid
                ) as any;
                if (!participant) continue;

                const importableSingle = getImportableSingleAssignmentForGroup(
                    selectedGroup,
                    pid
                );
                if (importableSingle) {
                    importedRows.push({
                        ...importableSingle,
                        cycleKey: selectedCycleKey || importableSingle?.cycleKey || null,
                        importedFromSingleAssignment: true,
                    });
                    continue;
                }

                const alreadyHasActiveGroupedSameCycle = assignments.some(
                    (a: any) =>
                        isGroupedAssignmentRecord(a) &&
                        String(a?.participantId) === pid &&
                        String(a?.interventionId) === String(base.interventionId) &&
                        String(getAssignmentCycleKey(a) || "") === selectedCycleKey &&
                        safeLower(a?.assignmentStatus) !== "cancelled"
                );

                if (alreadyHasActiveGroupedSameCycle) continue;

                const app = appsByPid[pid];
                const smmeNo = app?.smmENo ?? app?.smmeNo ?? app?.SMMENo ?? null;
                const assignedAt =
                    base?.assignedAt?.toDate?.() ||
                    base?.createdAt?.toDate?.() ||
                    new Date();
                const newId = `ai_${pid}_${base.interventionId}_${base.subInterventionId || "nosub"
                    }_${selectedCycleKey || "single-cycle"}_${Date.now()}_${Math.random()
                        .toString(36)
                        .slice(2, 8)}`;

                newRows.push({
                    ...base,
                    id: newId,
                    participantId: pid,
                    participantName: participant.beneficiaryName || "Unknown",
                    smmeNo,
                    assignmentStatus: "assigned",
                    assigneeAcceptanceStatus: "accepted",
                    assigneeAcceptedAt: Timestamp.now(),
                    participantAcceptanceStatus: "pending",
                    participantCompletionStatus: "pending",
                    assigneeCompletionStatus: "pending",
                    computedProgress: 0,
                    tracking: {
                        sessionsLogged: 0,
                    },
                    assignedAt: Timestamp.fromDate(assignedAt),
                    createdAt: Timestamp.fromDate(assignedAt),
                    updatedAt: Timestamp.now(),
                    cycleKey: selectedCycleKey || base?.cycleKey || null,
                    addedToExistingGroup: true,
                    addedToGroupAt: Timestamp.now(),
                    addedToGroupBy: user?.email || assigneeId || null,
                    addedToGroupByName: assigneeName || (user as any)?.name || null,
                    groupKey,
                    type: "grouped",
                });
            }

            if (!newRows.length && !importedRows.length) {
                message.warning(
                    "No SMEs were added. They may already belong to this intervention cycle."
                );
                return;
            }

            const allRows = [...existingMembers, ...importedRows, ...newRows];
            const batch = writeBatch(db);

            existingMembers.forEach((row: any) => {
                batch.set(
                    assignedInterventionService.docRef(String(row.id)),
                    {
                        groupMeta: deleteField(),
                        groupMemberCount: deleteField(),
                        groupedAssignment: deleteField(),
                        type: "grouped",
                        groupKey,
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
            });

            newRows.forEach((row) => {
                batch.set(
                    assignedInterventionService.docRef(String(row.id)),
                    canonicalizeAssignedInterventionWrite({
                        ...row,
                        groupKey,
                        type: "grouped",
                    })
                );
            });

            importedRows.forEach((row) => {
                batch.set(
                    assignedInterventionService.docRef(String(row.id)),
                    {
                        type: "grouped",
                        groupedAssignment: deleteField(),
                        groupKey,
                        groupMeta: deleteField(),
                        groupMemberCount: deleteField(),
                        cycleKey: selectedCycleKey || row?.cycleKey || null,
                        importedIntoGroupAt: Timestamp.now(),
                        importedIntoGroupBy: user?.email || assigneeId || null,
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
            });

            await batch.commit();

            const appointmentSync = await syncExistingAppointmentsForUpdatedGroup({
                groupKey,
                allGroupRows: allRows,
                addedRows: [...importedRows, ...newRows],
                base,
            });

            const syncText = appointmentSync.addedAppointments
                ? ` Also added ${appointmentSync.addedAppointments} appointment record(s) to existing group session(s).`
                : "";

            message.success(
                `${newRows.length + importedRows.length
                } SME(s) added to the existing group.${importedRows.length
                    ? ` Imported ${importedRows.length} from single assignment(s).`
                    : ""
                }${syncText}`
            );
            setAddToGroupModalVisible(false);
            addToGroupForm.resetFields();
        } catch (error) {
            console.error(error);
            message.error("Failed to add SME(s) to the group.");
        } finally {
            setGroupActionLoading(false);
        }
    };

    const handleRemoveMemberFromGroup = async (assignment: any) => {
        const groupKey = getAssignmentGroupKey(assignment);
        if (!groupKey) return;

        const members = getGroupMembers(groupKey);
        if (members.length <= 2) {
            message.warning(
                "A group needs at least two SMEs. Remove is blocked because this would leave only one SME in the group."
            );
            return;
        }

        setGroupActionLoading(true);
        try {
            const remaining = members.filter(
                (m: any) => String(m.id) !== String(assignment.id)
            );
            const base = remaining[0];
            const batch = writeBatch(db);

            batch.set(
                assignedInterventionService.docRef(String(assignment.id)),
                {
                    type: "singular",
                    groupedAssignment: deleteField(),
                    groupKey: null,
                    groupAssignmentId: deleteField(),
                    groupId: deleteField(),
                    groupMeta: deleteField(),
                    groupMemberCount: deleteField(),
                    removedFromGroupAt: Timestamp.now(),
                    removedFromGroupBy: user?.email || assigneeId || null,
                    updatedAt: Timestamp.now(),
                },
                { merge: true }
            );

            remaining.forEach((row: any) => {
                batch.set(
                    assignedInterventionService.docRef(String(row.id)),
                    {
                        groupMeta: deleteField(),
                        groupMemberCount: deleteField(),
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
            });

            await batch.commit();

            const appointmentSync = await syncExistingAppointmentsForUpdatedGroup({
                groupKey,
                allGroupRows: remaining,
                removedParticipantIds: [String(assignment.participantId || "")],
                base,
            });

            const syncText = appointmentSync.cancelledAppointments
                ? ` Cancelled ${appointmentSync.cancelledAppointments} future appointment record(s) for the removed SME.`
                : "";

            message.success(
                `SME removed from the group. The assignment was kept as a singular assignment.${syncText}`
            );
        } catch (error) {
            console.error(error);
            message.error("Failed to remove SME from group.");
        } finally {
            setGroupActionLoading(false);
        }
    };

    const renderGroupStatusTags = (group: any) => {
        const sharedDelivery = groupDeliveries[String(group?.groupKey || "")];
        const members = group.members || getGroupMembers(String(group?.groupKey || ""));
        const movDeclined = members.filter((member: any) =>
            ['rejected', 'declined'].includes(safeLower(member?.participantCompletionStatus))
        ).length;
        if (!sharedDelivery || Number(sharedDelivery.progress || 0) < 100) {
            const tags = (group.statusTags || [])
                .filter((status: any) => status.label !== 'Completion Rejected')
                .map((status: any) => {
                    const meta = getCompositeStatus({ assignmentStatus: status.label });
                    return <Tag key={status.label} color={meta.color}>{status.label}: {status.count}</Tag>;
                });
            if (movDeclined) {
                tags.push(<Tag key="mov-declined" color="red">MOV Declined: {movDeclined}</Tag>);
            }
            return tags;
        }

        const movConfirmed = members.filter((member: any) =>
            getCompositeStatus(member).label === "Completed"
        ).length;
        const awaitingMovConfirmation = members.filter((member: any) =>
            getCompositeStatus(member).label === "Awaiting SME Confirmation"
        ).length;
        const noSessionRecorded = members.filter((member: any) =>
            getCompositeStatus(member).label === "Ready to Schedule"
        ).length;
        const tags = [<Tag key="delivery" color="green">Group delivery complete</Tag>];
        if (movConfirmed) {
            tags.push(<Tag key="mov-confirmed" color="blue">MOV confirmed: {movConfirmed}</Tag>);
        }
        if (awaitingMovConfirmation) {
            tags.push(<Tag key="mov" color="purple">MOV confirmation: {awaitingMovConfirmation}</Tag>);
        }
        if (movDeclined) {
            tags.push(<Tag key="mov-declined" color="red">MOV Declined: {movDeclined}</Tag>);
        }
        if (noSessionRecorded) {
            tags.push(<Tag key="attendance" color="gold">No session recorded: {noSessionRecorded}</Tag>);
        }
        return tags;
    };

    const groupedColumns = [
        {
            title: "Grouped Intervention",
            key: "interventionTitle",
            render: (_: any, r: any) => (
                <Space direction="vertical" size={2}>
                    <Text strong>{r.interventionTitle}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.areaOfSupport || "—"}
                    </Text>
                </Space>
            ),
        },
        {
            title: "Facilitator",
            dataIndex: "assigneeName",
            responsive: ["md"],
        },
        {
            title: "Cycle / Due",
            key: "cycle",
            render: (_: any, r: any) => (
                <Space direction="vertical" size={2}>
                    <Tag color="geekblue">
                        {r.cycleLabel || getAssignmentCycleLabel(r) || "-"}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Due:{" "}
                        {formatDisplayDate(r.dueDate)}
                    </Text>
                </Space>
            ),
        },
        {
            title: "SMEs",
            dataIndex: "memberCount",
            render: (v: number) => <Tag color="purple">{v}</Tag>,
        },
        {
            title: "Group Progress",
            key: "progress",
            render: (_: any, r: any) => (
                <Progress percent={getGroupProgress(r)} size="small" />
            ),
        },
        {
            title: "Sessions",
            key: "delivery",
            render: (_: any, r: any) => {
                const delivery = getGroupDeliverySnapshot(r);
                return `${delivery.sessionsHeld} held`;
            },
        },
        {
            title: "Statuses",
            key: "statuses",
            responsive: ["md"],
            render: (_: any, r: any) => (
                <Space wrap>
                    {renderGroupStatusTags(r)}
                </Space>
            ),
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, r: any) => (
                <Space wrap>
                    <Button
                        data-guide="group-view-smes"
                        icon={<EyeOutlined />}
                        shape="round"
                        onClick={() => openGroupMembers(r)}
                    >
                        View SMEs
                    </Button>
                    {!isGroupComplete(r) && (
                        <Button
                            data-guide="group-add-sme"
                            icon={<UserAddOutlined />}
                            type="primary"
                            shape="round"
                            onClick={() => openAddToGroup(r)}
                        >
                            Add SME
                        </Button>
                    )}
                </Space>
            ),
        },
    ];

    const progressCards = [
        {
            title: "Total Beneficiaries",
            value: `${activeSmeCount}`,
            icon: <PayCircleOutlined style={{ fontSize: 18, color: "#722ed1" }} />,
            iconBg: "rgba(114,46,209,.12)",
            subtitle: "Confirmed SMEs currently available.",
        },
        {
            title: "Assigned / Required",
            value: `${totalAssigned} / ${totalRequired}`,
            icon: <CheckCircleOutlined style={{ fontSize: 18, color: "#1890ff" }} />,
            iconBg: "rgba(24,144,255,.12)",
            subtitle: "Allocated against total required.",
        },
        {
            title: "Completed / Assigned",
            value: `${totalCompleted} / ${totalAssigned}`,
            icon: <CalendarOutlined style={{ fontSize: 18, color: "#52c41a" }} />,
            iconBg: "rgba(82,196,26,.12)",
            subtitle: "Completed out of assigned.",
        },
        {
            title: "Completion Rate",
            value: `${completionRate}%`,
            icon: <CommentOutlined style={{ fontSize: 18, color: "#faad14" }} />,
            iconBg: "rgba(250,173,20,.12)",
            subtitle: (
                <div>
                    <div>Overall completion.</div>
                </div>
            ),
        },
        // {
        //     title: 'Needs Reassignment',
        //     value: `${needsReassignCount}`,
        //     icon: <CommentOutlined style={{ fontSize: 18, color: '#eb2f96' }} />,
        //     iconBg: 'rgba(235,47,150,.12)',
        //     subtitle: 'Items requiring a new allocation.'
        // }
    ];

    const selectedParticipantCoverage = selectedParticipant
        ? getParticipantCoverage(String((selectedParticipant as any).id))
        : {
            required: 0,
            assigned: 0,
            completed: 0,
            currentOpen: 0,
            grouped: 0,
        };

    const participantColumns = useMemo(() => {
        const cols: any[] = [
            {
                title: "Beneficiary",
                dataIndex: "beneficiaryName",
                key: "beneficiaryName",
            },
            {
                title: "Sector",
                dataIndex: "sector",
                key: "sector",
                responsive: ["md"],
            },
            // { title: 'Program', dataIndex: 'programName', key: 'programName', responsive: ['md'] },
            {
                title: "Required",
                key: "required",
                render: (_: any, r: any) => (
                    <Tag>{participantInterventionMap[String(r.id)]?.length || 0}</Tag>
                ),
            },
            {
                title: "Assignment Rate",
                key: "rate",
                responsive: ["md"],
                render: (_: any, r: any) => {
                    const { assigned, required, completed, currentOpen } =
                        getParticipantCoverage(String(r.id));
                    const pct = required ? (completed / required) * 100 : 0;
                    const color =
                        pct <= 25
                            ? "red"
                            : pct <= 60
                                ? "orange"
                                : pct <= 85
                                    ? "gold"
                                    : "green";

                    return (
                        <Space wrap>
                            <Tag>
                                Assigned: {assigned}/{required}
                            </Tag>
                            <Tag color="green">Completed: {completed}</Tag>
                            <Tag color={currentOpen > 0 ? "blue" : "default"}>
                                Open: {currentOpen}
                            </Tag>
                            <Tag color={color}>{pct.toFixed(0)}%</Tag>
                        </Space>
                    );
                },
            },
            {
                title: "Actions",
                key: "actions",
                render: (_: any, r: any) => (
                    <Button
                        data-guide="manage-beneficiary"
                        variant="filled"
                        color="geekblue"
                        shape="round"
                        style={{ border: "1px solid dodgerblue" }}
                        onClick={() => handleManageParticipant(r)}
                    >
                        Manage
                    </Button>
                ),
            },
        ];

        return cols;
    }, [participantInterventionMap, getParticipantCoverage]);

    const modalColumns = [
        {
            title: "Intervention Title",
            dataIndex: "interventionTitle",
            key: "interventionTitle",
        },
        {
            title: "Current Assignee",
            key: "assignee",
            render: (_: any, record: any) => {
                if (record.isUnassigned)
                    return <Text type="secondary">Not Assigned</Text>;
                return <Text>{record.assigneeName || "—"}</Text>;
            },
        },
        {
            title: "Current Status",
            key: "status",
            render: (_: any, record: any) => {
                if (record.isUnassigned) {
                    const blocked = !!record.blockedByPrevCycle;
                    return (
                        <Space>
                            <Tag color={blocked ? "red" : undefined}>
                                {record.unassignedLabel || "Unassigned"}
                            </Tag>
                            {blocked ? <Tag color="red">Previous cycle open</Tag> : null}
                        </Space>
                    );
                }

                return (
                    <Tag color={record.currentStatus?.color || "default"}>
                        {record.currentStatus?.label || "—"}
                    </Tag>
                );
            },
        },
        {
            title: "Action",
            key: "action",
            render: (_: any, record: any) => {
                if (record.isUnassigned) {
                    const blocked = !!record.blockedByPrevCycle;
                    if (blocked) {
                        return (
                            <Space>
                                <Tooltip
                                    title={`${String(
                                        record.unassignedReason || ""
                                    )} You can still assign this cycle; the open one stays on the SME's risk trail.`}
                                >
                                    <Button
                                        data-guide="manage-assign-intervention"
                                        type="link"
                                        onClick={() => handleQuickAssign(record)}
                                    >
                                        {record.recurring
                                            ? "Assign for this month"
                                            : "Assign"}
                                    </Button>
                                </Tooltip>
                                <Button
                                    type="link"
                                    onClick={() =>
                                        setOpenPrevModal({
                                            open: true,
                                            assignment: record.openPrevAssignment || null,
                                        })
                                    }
                                    disabled={!record.openPrevAssignment}
                                >
                                    View open cycle
                                </Button>
                            </Space>
                        );
                    }

                    return (
                        <Button
                            data-guide="manage-assign-intervention"
                            type="link"
                            onClick={() => handleQuickAssign(record)}
                        >
                            {record.recurring ? "Assign for this month" : "Assign"}
                        </Button>
                    );
                }

                return (
                    <Space>
                        {record.currentDeclined ? (
                            <Tooltip title="The SME declined this assignment. Assigning again starts a new one; the declined record is kept.">
                                <Button
                                    data-guide="manage-assign-intervention"
                                    type="link"
                                    onClick={() => handleQuickAssign(record)}
                                >
                                    {record.recurring ? "Assign for this month" : "Assign"}
                                </Button>
                            </Tooltip>
                        ) : null}
                        <Button
                            type="link"
                            onClick={() => handleQuickReassign(record.currentAssignment)}
                        >
                            Reassign
                        </Button>
                    </Space>
                );
            },
        },
    ];

    const resetViewFilters = () => {
        if (viewMode === "beneficiaries") {
            setSearchText("");
            setBeneficiaryCoverageFilter("all");
            return;
        }

        if (viewMode === "groups") {
            setGroupSearchText("");
            setGroupProgressFilter("all");
            return;
        }

        if (viewMode === "range") {
            setDateRange([
                dayjs().startOf("month"),
                dayjs().endOf("month"),
            ]);
            setRangeStatusFilter("all");
            return;
        }

        if (viewMode === "demand") {
            setDemandSearchText("");
            setDemandCoverageFilter("all");
        }
    };

    const assignmentFilterBar = (
        <Row
            data-guide="assignment-filters"
            gutter={[12, 12]}
            align="middle"
            style={{ width: "100%", margin: 0 }}
        >
            <Col span={24} data-guide="assignment-views">
                <Segmented
                    block
                    value={viewMode}
                    onChange={(value) => setViewMode(value as any)}
                    options={[
                        { label: "Beneficiaries", value: "beneficiaries" },
                        ...(hasGroupedInterventions ? [{
                            label: (
                                <span data-guide="grouped-view-option">
                                    Grouped Interventions
                                </span>
                            ),
                            value: "groups",
                        }] : []),
                        { label: "Assignment Statuses", value: "range" },
                        { label: "Intervention Demand", value: "demand" },
                    ]}
                />
            </Col>
            {viewMode === "beneficiaries" && (
                <>
                    <Col xs={24} md={8}>
                        <Input.Search
                            placeholder="Search beneficiary..."
                            allowClear
                            value={searchText}
                            onChange={(event) => setSearchText(event.target.value)}
                            style={{ width: "100%" }}
                        />
                    </Col>

                    <Col xs={24} md={6}>
                        <Select
                            value={beneficiaryCoverageFilter}
                            onChange={setBeneficiaryCoverageFilter}
                            style={{ width: "100%" }}
                            options={[
                                { label: "All Beneficiaries", value: "all" },
                                {
                                    label: "Needs Assignment",
                                    value: "needs-assignment",
                                },
                                { label: "Has Open Work", value: "open" },
                                { label: "Fully Completed", value: "completed" },
                            ]}
                        />
                    </Col>
                </>
            )}

            {viewMode === "groups" && (
                <>
                    <Col xs={24} md={8}>
                        <Input.Search
                            placeholder="Search intervention, facilitator or cycle..."
                            allowClear
                            value={groupSearchText}
                            onChange={(event) => setGroupSearchText(event.target.value)}
                            style={{ width: "100%" }}
                        />
                    </Col>

                    <Col xs={24} md={6}>
                        <Select
                            value={groupProgressFilter}
                            onChange={setGroupProgressFilter}
                            style={{ width: "100%" }}
                            options={[
                                { label: "All Groups", value: "all" },
                                { label: "In Progress", value: "active" },
                                { label: "Completed", value: "completed" },
                            ]}
                        />
                    </Col>
                </>
            )}

            {viewMode === "range" && (
                <>
                    <Col xs={24} md={8}>
                        <DatePicker.RangePicker
                            value={dateRange}
                            onChange={(value) => {
                                if (!value?.[0] || !value?.[1]) return;
                                setDateRange([value[0], value[1]]);
                            }}
                            style={{ width: "100%" }}
                            allowClear={false}
                        />
                    </Col>

                    <Col xs={24} md={6}>
                        <Select
                            value={rangeStatusFilter}
                            onChange={setRangeStatusFilter}
                            style={{ width: "100%" }}
                            options={rangeStatusOptions}
                        />
                    </Col>
                </>
            )}

            {viewMode === "demand" && (
                <>
                    <Col xs={24} md={8}>
                        <Input.Search
                            placeholder="Search intervention..."
                            allowClear
                            value={demandSearchText}
                            onChange={(event) => setDemandSearchText(event.target.value)}
                            style={{ width: "100%" }}
                        />
                    </Col>

                    <Col xs={24} md={6}>
                        <Select
                            value={demandCoverageFilter}
                            onChange={setDemandCoverageFilter}
                            style={{ width: "100%" }}
                            options={[
                                { label: "All Interventions", value: "all" },
                                {
                                    label: "Needs Allocation",
                                    value: "needs-allocation",
                                },
                                { label: "Has Open Work", value: "open" },
                                { label: "Fully Completed", value: "completed" },
                            ]}
                        />
                    </Col>
                </>
            )}

            <Col xs={24} md={10}>
                <Row
                    gutter={[8, 8]}
                    justify={screens.md ? "end" : "start"}
                >
                    <Col xs={24} sm={8}>
                        <Button
                            block
                            onClick={resetViewFilters}
                            icon={<ReloadOutlined />}
                            style={{ border: "1px solid orange" }}
                            shape="round"
                            color="orange"
                            variant="filled"
                        >
                            Reset
                        </Button>
                    </Col>

                    <Col xs={24} sm={16}>
                        <Tooltip
                            title={
                                totalRequired === 0
                                    ? "No required interventions for this department."
                                    : undefined
                            }
                        >
                            <Button
                                data-guide="assign-new-intervention"
                                block
                                type="primary"
                                style={roundBtn}
                                icon={<CheckCircleOutlined />}
                                onClick={openAssignNew}
                                disabled={totalRequired === 0}
                            >
                                Assign New Intervention
                            </Button>
                        </Tooltip>
                    </Col>
                </Row>
            </Col>
        </Row>
    );

    const noData = !loading && beneficiaryRows.length === 0;

    return (
        <div
            style={{
                // Fills the height the shell's Content gives us instead of
                // forcing a full viewport on top of the header, which pushed the
                // page down and left it stuck against the bottom.
                padding: isMobile ? "5px 12px" : "6px 24px",
                flex: 1,
                minHeight: 0,
            }}
        >
            <Helmet>
                <title>Interventions Assignments | Incubation Platform</title>
            </Helmet>

            <Row
                data-guide="assignment-metrics"
                gutter={[12, 12]}
                style={{ marginBottom: 12 }}
                wrap
            >
                {(isMobile
                    ? progressCards.filter(c => ['Assigned / Required', 'Completed / Assigned'].includes(c.title))
                    : progressCards
                ).map((c, i) => (
                    <Col xs={24} sm={12} lg={6} key={c.title}>
                        <MotionCard.Metric
                            loading={loading}
                            title={c.title}
                            value={c.value}
                            icon={c.icon}
                            iconBg={c.iconBg}
                            subtitle={c.subtitle}
                        />
                    </Col>
                ))}
            </Row>

            <MotionCard
                loading={loading}
                filterBar={assignmentFilterBar}
            >
                {viewMode === "groups" ? (
                    <Space direction="vertical" style={{ width: "100%" }} size={12}>
                        <Button
                            type="primary"
                            shape="round"
                            icon={<TeamOutlined />}
                            onClick={() => {
                                convertSinglesForm.resetFields();
                                setConvertSinglesModalVisible(true);
                            }}
                            disabled={!singleAssignmentGroupOptions.length}
                        >
                            Create Group from Singles
                        </Button>

                        <div data-guide="grouped-interventions-table">
                            <Table
                                rowKey="groupKey"
                                dataSource={filteredGroupedInterventionRows}
                                columns={groupedColumns as any}
                                pagination={{ pageSize: 4, position: ["bottomCenter"], showSizeChanger: false }}
                                scroll={isMobile ? { x: 900 } : undefined}
                                locale={{
                                    emptyText: (
                                        <Empty description="No grouped interventions match the current filters." />
                                    ),
                                }}
                            />
                        </div>
                    </Space>
                ) : viewMode === "range" ? (
                    <Table
                        rowKey="status"
                        dataSource={filteredRangeStatusRows}
                        pagination={false}
                        expandable={{
                            expandedRowRender: (statusRow: any) => {
                                const rows = rangeAssignments
                                    .filter(
                                        (a: any) => getCompositeStatus(a).label === statusRow.status
                                    )
                                    .map((a: any) => ({
                                        id: a.id,
                                        beneficiaryName: a.beneficiaryName || a.participantName || a.smeName || "—",
                                        interventionTitle: a.interventionTitle || "Untitled",
                                        facilitator: a.assigneeName || "—",
                                        type: isGroupedAssignmentRecord(a) ? "Grouped" : "Single",
                                        progress:
                                            Number(a.groupDelivery?.progress || 0) || typeof a.computedProgress === "number"
                                                ? Math.round(Number(a.groupDelivery?.progress || 0) || a.computedProgress || 0)
                                                : getCompositeStatus(a).label === "Completed"
                                                    ? 100
                                                    : 0,
                                        assignedDate:
                                            a.createdAt?.toDate?.() ||
                                            a.assignedAt?.toDate?.() ||
                                            null,

                                        deliveryDate:
                                            a.groupDelivery?.completedAt?.toDate?.() ||
                                            a.completedAt?.toDate?.() ||
                                            null,

                                        completedDate:
                                            a.completionConfirmedAt?.toDate?.() ||
                                            (getCompositeStatus(a).label === "Completed"
                                                ? a.completedAt?.toDate?.() || a.updatedAt?.toDate?.()
                                                : null),

                                        dueDate: a.dueDate?.toDate?.() || null,
                                        pendingAction: getBottleneck(a).label,
                                    }));

                                const isCompletedStatus = statusRow.status === "Completed";
                                const isMovStatus = [
                                    "Awaiting MOV Confirmation",
                                    "Completion Rejected",
                                ].includes(statusRow.status);
                                const showProgress = ![
                                    "Ready to Schedule",
                                    "Awaiting Appointment Response",
                                    "Appointment Declined",
                                    "Cancelled",
                                    "Completed",
                                    "Awaiting MOV Confirmation",
                                ].includes(statusRow.status);
                                const showNextStep = !isCompletedStatus && statusRow.status !== "Cancelled";

                                return (
                                    <Table
                                        rowKey="id"
                                        size="small"
                                        pagination={false}
                                        dataSource={rows}
                                        columns={[
                                            { title: "SME", dataIndex: "beneficiaryName" },
                                            { title: "Intervention", dataIndex: "interventionTitle" },
                                            { title: "Facilitator", dataIndex: "facilitator" },
                                            {
                                                title: "Type",
                                                dataIndex: "type",
                                                render: (v: string) => (
                                                    <Tag color={v === "Grouped" ? "purple" : "geekblue"}>
                                                        {v}
                                                    </Tag>
                                                ),
                                            },
                                            {
                                                title: "Progress",
                                                dataIndex: "progress",
                                                hidden: !showProgress,
                                                render: (v: number) => (
                                                    <Progress percent={v} size="small" />
                                                ),
                                            },
                                            {
                                                title: "Assigned",
                                                dataIndex: "assignedDate",
                                                render: (v: Date | null) => formatDisplayDate(v),
                                            },
                                            {
                                                title: isMovStatus
                                                    ? "Delivery completed"
                                                    : isCompletedStatus
                                                        ? "MOV confirmed"
                                                        : "Completed",
                                                dataIndex: "completedDate",
                                                hidden: !isMovStatus && !isCompletedStatus,
                                                render: (v: Date | null, record: any) =>
                                                    formatDisplayDate(isMovStatus ? record.deliveryDate : v),
                                            },
                                            {
                                                title: "Due",
                                                dataIndex: "dueDate",
                                                hidden: isCompletedStatus || isMovStatus,
                                                render: (v: Date | null) => formatDisplayDate(v),
                                            },
                                            {
                                                title: "Next step",
                                                dataIndex: "pendingAction",
                                                hidden: !showNextStep,
                                                render: (v: string) =>
                                                    v && v !== "—" ? <Tag color="red">{v}</Tag> : "—",
                                            },
                                        ]}
                                    />
                                );
                            },
                        }}
                        columns={[
                            {
                                title: "Status",
                                dataIndex: "status",
                                render: (_: any, r: any) => (
                                    <Tag color={r.color}>{r.status}</Tag>
                                ),
                            },
                            {
                                title: "Assignments in Selected Range",
                                dataIndex: "count",
                            },
                        ]}
                    />
                ) : viewMode === "demand" ? (
                    <Table
                        rowKey="interventionId"
                        dataSource={filteredInterventionDemandRows}
                        pagination={{ pageSize: 4, position: ["bottomCenter"], showSizeChanger: false }}
                        columns={[
                            { title: "Intervention", dataIndex: "interventionTitle" },
                            { title: "Need It", dataIndex: "needed" },
                            { title: "Received / Assigned", dataIndex: "assigned" },
                            { title: "Completed", dataIndex: "completed" },
                            {
                                title: "Open status",
                                dataIndex: "openStatusSummary",
                                render: (statuses: Array<{ status: string; count: number }>) =>
                                    statuses?.length ? (
                                        <Space size={[4, 4]} wrap>
                                            {statuses.map(({ status, count }) => {
                                                const meta = getCompositeStatus({
                                                    assignmentStatus: status,
                                                });
                                                return (
                                                    <Tag key={status} color={meta.color}>
                                                        {status}: {count}
                                                    </Tag>
                                                );
                                            })}
                                        </Space>
                                    ) : (
                                        "—"
                                    ),
                            },
                            { title: "Not allocated", dataIndex: "unassigned" },
                            {
                                title: "Completion",
                                dataIndex: "completionRate",
                                render: (v: number) => <Progress percent={v} size="small" />,
                            },
                        ]}
                    />
                ) : noData ? (
                    <Result
                        status="info"
                        title="No SMEs found"
                        subTitle={
                            isMonitoringDepartment
                                ? "Make sure this programme has accepted SMEs and your monitoring department has interventions configured."
                                : "This page only lists SMEs whose Diagnostic Plan is confirmed by both the department and the SME."
                        }
                    />
                ) : isMobile ? (
                    <List
                        data-guide="beneficiaries-table"
                        dataSource={beneficiaryRows as any}
                        loading={loading}
                        pagination={{ pageSize: 4, showSizeChanger: false }}
                        renderItem={(p: any) => {
                            const pid = String(p.id);
                            const { assigned, required, completed } =
                                getParticipantCoverage(pid);

                            return (
                                <Card
                                    style={{
                                        marginBottom: 12,
                                        borderRadius: 14,
                                        border: "1px solid #d6e4ff",
                                    }}
                                >
                                    <Space
                                        direction="vertical"
                                        style={{ width: "100%" }}
                                        size={8}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                gap: 12,
                                            }}
                                        >
                                            <div style={{ minWidth: 0 }}>
                                                <Text strong style={{ display: "block" }}>
                                                    {p.beneficiaryName}
                                                </Text>
                                                <Text
                                                    type="secondary"
                                                    style={{ display: "block", fontSize: 12 }}
                                                >
                                                    {(p as any).sector || "—"}{" "}
                                                    {p.programName ? `• ${p.programName}` : ""}
                                                </Text>
                                            </div>
                                            <Button
                                                data-guide="manage-beneficiary"
                                                type="primary"
                                                shape="round"
                                                onClick={() => handleManageParticipant(p)}
                                            >
                                                Manage
                                            </Button>
                                        </div>

                                        <Space wrap>
                                            <Tag color="blue">
                                                Assigned / Required: {assigned}/{required}
                                            </Tag>
                                            <Tag color="green">
                                                Completed / Assigned: {completed}/{assigned}
                                            </Tag>
                                        </Space>
                                    </Space>
                                </Card>
                            );
                        }}
                    />
                ) : (
                    <Table
                        data-guide="beneficiaries-table"
                        columns={participantColumns as any}
                        dataSource={beneficiaryRows as any}
                        rowKey="id"
                        pagination={{ pageSize: 4, position: ["bottomCenter"], showSizeChanger: false }}
                    />
                )}
            </MotionCard>

            <Modal
                className="guide-assignment-modal"
                centered
                title={
                    reassigningAssignment
                        ? "Reassign Intervention"
                        : "Assign New Intervention"
                }
                open={assignmentModalVisible}
                onCancel={() => {
                    setAssignmentModalVisible(false);
                    setLockedIntervention(null);
                    setReassigningAssignment(null);
                    setLockedParticipantId(null);
                    setLockSource(null);
                    assignmentForm.resetFields();
                }}
                width={isMobile ? "100%" : 520}
                bodyStyle={isMobile ? { paddingBottom: 24 } : undefined}
                footer={null}
                destroyOnClose
            >
                <Form
                    form={assignmentForm}
                    layout="vertical"
                    onFinish={handleAssignOrReassign}
                    onValuesChange={(changed) => {
                        if (changed.type) setSelectedType(changed.type);

                        if (
                            changed.participants &&
                            assignmentForm.getFieldValue("type") === "grouped"
                        ) {
                            const ids: string[] = changed.participants;
                            const selectedList = baseParticipants.filter((p) =>
                                ids.includes(String((p as any).id))
                            );
                            const sets = selectedList.map(
                                (p) =>
                                    new Set(
                                        ((p as any).requiredInterventions || []).map((i: any) =>
                                            normalizeId(i.id)
                                        )
                                    )
                            );
                            const shared = sets.length
                                ? Array.from(
                                    sets.reduce(
                                        (acc, s) => new Set([...acc].filter((x) => s.has(x)))
                                    )
                                )
                                : [];
                            const intersection = shared
                                .map((id) => {
                                    const example = selectedList.find((p) =>
                                        ((p as any).requiredInterventions || []).some(
                                            (i: any) => normalizeId(i.id) === id
                                        )
                                    );
                                    return (example as any)?.requiredInterventions?.find(
                                        (i: any) => normalizeId(i.id) === id
                                    );
                                })
                                .filter(Boolean) as any[];
                            setSharedInterventions(intersection);
                        }
                    }}
                >
                    {lockSource === "manage" && (
                        <Form.Item
                            noStyle
                            shouldUpdate={(prev, curr) =>
                                prev.type !== curr.type ||
                                prev.participant !== curr.participant ||
                                prev.participants !== curr.participants ||
                                prev.intervention !== curr.intervention
                            }
                        >
                            {({ getFieldValue }) => {
                                const isGrouped = getFieldValue("type") === "grouped";
                                const participantIds = isGrouped
                                    ? (getFieldValue("participants") || []).map(String)
                                    : [String(getFieldValue("participant") || "")];
                                const beneficiaries = participants
                                    .filter((p) => participantIds.includes(String((p as any).id)))
                                    .map((p) => (p as any).beneficiaryName || "Unnamed SME");
                                const interventionId = normalizeId(
                                    getFieldValue("intervention")
                                );
                                const intervention = isGrouped
                                    ? sharedInterventions.find(
                                        (iv) => normalizeId(iv.id) === interventionId
                                    )
                                    : participants
                                        .find((p) => String((p as any).id) === participantIds[0])
                                        ?.requiredInterventions?.find(
                                            (iv: any) => normalizeId(iv.id) === interventionId
                                        );
                                const definition = ivDefsById[interventionId];
                                const interventionName =
                                    definition?.interventionTitle ||
                                    definition?.title ||
                                    (intervention as any)?.interventionTitle ||
                                    (intervention as any)?.title ||
                                    "Selected intervention";

                                return (
                                    <Descriptions
                                        bordered
                                        size="small"
                                        column={1}
                                        style={{ marginBottom: 24 }}
                                    >
                                        <Descriptions.Item label="Assignment type">
                                            {isGrouped
                                                ? "Grouped (Multiple SMEs)"
                                                : "Singular (1 SME)"}
                                        </Descriptions.Item>
                                        <Descriptions.Item label="Beneficiary">
                                            {beneficiaries.join(", ") || "Selected SME"}
                                        </Descriptions.Item>
                                        <Descriptions.Item label="Intervention">
                                            {interventionName}
                                        </Descriptions.Item>
                                    </Descriptions>
                                );
                            }}
                        </Form.Item>
                    )}

                    <Form.Item
                        className="guide-assignment-type"
                        name="type"
                        label="Assignment Type"
                        rules={[
                            { required: true, message: "Please select assignment type" },
                        ]}
                        initialValue="singular"
                        hidden={lockSource === "manage"}
                    >
                        <Select
                            placeholder="Select type"
                            disabled={lockSource === "manage"}
                        >
                            <Select.Option value="singular">Singular (1 SME)</Select.Option>
                            <Select.Option value="grouped">
                                Grouped (Multiple SMEs)
                            </Select.Option>
                        </Select>
                    </Form.Item>

                    {selectedType === "grouped" ? (
                        <Form.Item
                            className="guide-assignment-beneficiary"
                            name="participants"
                            label="Select Multiple Beneficiaries"
                            hidden={lockSource === "manage"}
                            rules={[
                                {
                                    required: true,
                                    message: "Please select at least one participant",
                                },
                            ]}
                            extra={
                                <Text type="secondary">
                                    Showing {filteredParticipantOptions.length} SME(s) based on
                                    your current filters.
                                </Text>
                            }
                        >
                            <Select
                                mode="multiple"
                                placeholder="Choose beneficiaries"
                                disabled={lockSource === "manage"}
                                options={groupedParticipantOptions}
                                showSearch
                                maxTagCount="responsive"
                                filterOption={(input, option) =>
                                    norm((option as any)?.searchText).includes(norm(input))
                                }
                                notFoundContent="No beneficiary matches your search"
                                dropdownRender={(menu) => (
                                    <>
                                        <div style={{ padding: 8, display: "flex", gap: 8 }}>
                                            <Button
                                                size="small"
                                                type="primary"
                                                style={roundBtn}
                                                disabled={!filteredParticipantIds.length}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => {
                                                    const ids = [...filteredParticipantIds];
                                                    assignmentForm.setFieldsValue({ participants: ids });
                                                    setSharedInterventions(computeShared(ids));
                                                }}
                                            >
                                                Select all (filtered)
                                            </Button>

                                            <Button
                                                size="small"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() =>
                                                    assignmentForm.setFieldsValue({ participants: [] })
                                                }
                                            >
                                                Clear
                                            </Button>
                                        </div>

                                        <Divider style={{ margin: 0 }} />
                                        {menu}
                                    </>
                                )}
                            />
                        </Form.Item>
                    ) : (
                        <Form.Item
                            className="guide-assignment-beneficiary"
                            name="participant"
                            label="Select Beneficiary"
                            rules={[
                                { required: true, message: "Please select a participant" },
                            ]}
                            hidden={lockSource === "manage"}
                        >
                            <Select
                                placeholder="Type beneficiary name..."
                                disabled={lockSource === "manage" || !!lockedParticipantId}
                                open={
                                    lockSource === "manage" || !!lockedParticipantId
                                        ? false
                                        : undefined
                                }
                                showArrow={!(lockSource === "manage" || !!lockedParticipantId)}
                                onMouseDown={(e) => {
                                    if (lockSource === "manage" || !!lockedParticipantId)
                                        e.preventDefault();
                                }}
                                allowClear={!(lockSource === "manage" || !!lockedParticipantId)}
                                showSearch
                                optionFilterProp="label"
                                options={filteredParticipantOptions}
                                notFoundContent="No beneficiary matches your search"
                            />
                        </Form.Item>
                    )}

                    <Form.Item
                        shouldUpdate={(prev, curr) =>
                            prev.participant !== curr.participant ||
                            prev.participants !== curr.participants ||
                            prev.type !== curr.type
                        }
                        noStyle
                    >
                        {({ getFieldValue }) => {
                            const isGrouped = getFieldValue("type") === "grouped";
                            if (isGrouped) {
                                return (
                                    <Form.Item
                                        className="guide-assignment-intervention"
                                        name="intervention"
                                        label="Select Shared Intervention"
                                        rules={[
                                            {
                                                required: true,
                                                message: "Please select an intervention",
                                            },
                                        ]}
                                        preserve
                                        hidden={lockSource === "manage"}
                                    >
                                        <Select placeholder="Select intervention (shared)">
                                            {sharedInterventions.map((iv) => (
                                                <Select.Option
                                                    key={normalizeId(iv.id)}
                                                    value={normalizeId(iv.id)}
                                                >
                                                    {iv.interventionTitle || iv.title || "Untitled"}
                                                </Select.Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                );
                            }

                            const participantId = getFieldValue("participant");
                            const selectedP = participants.find(
                                (p) => String((p as any).id) === String(participantId)
                            );

                            const validArea = norm(userDepartment?.name || "");
                            let options = (
                                (selectedP as any)?.requiredInterventions || []
                            ).filter((iv: any) =>
                                userDepartment && !userDepartment?.isMain
                                    ? norm(iv?.area || iv?.areaOfSupport) === validArea
                                    : true
                            );

                            const lockedId = lockedIntervention?.id
                                ? normalizeId(lockedIntervention.id)
                                : null;
                            if (
                                lockedId &&
                                !options.some((iv: any) => normalizeId(iv.id) === lockedId)
                            ) {
                                const addBack = (
                                    (selectedP as any)?.requiredInterventions || []
                                ).find((iv: any) => normalizeId(iv.id) === lockedId);
                                if (addBack) options = [addBack, ...options];
                            }

                            const readOnly = !!lockedId;

                            return (
                                <Form.Item
                                    className="guide-assignment-intervention"
                                    name="intervention"
                                    label="Select Intervention"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please select an intervention",
                                        },
                                    ]}
                                    preserve
                                    dependencies={["participant", "type"]}
                                    hidden={lockSource === "manage"}
                                >
                                    <Select
                                        placeholder="Choose an intervention"
                                        disabled={!participantId}
                                        open={readOnly ? false : undefined}
                                        showArrow={!readOnly}
                                        onMouseDown={(e) => {
                                            if (readOnly) e.preventDefault();
                                        }}
                                        allowClear={!readOnly}
                                    >
                                        {options.map((iv: any) => (
                                            <Select.Option
                                                key={normalizeId(iv.id)}
                                                value={normalizeId(iv.id)}
                                            >
                                                {iv.interventionTitle || iv.title || "Untitled"}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            );
                        }}
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prev, curr) =>
                            prev.intervention !== curr.intervention ||
                            prev.participant !== curr.participant ||
                            prev.participants !== curr.participants ||
                            prev.type !== curr.type
                        }
                    >
                        {({ getFieldValue }) => {
                            const isGrouped = getFieldValue("type") === "grouped";
                            const ivId = getFieldValue("intervention");

                            if (!ivId) return null;

                            let intervention: any = null;

                            if (isGrouped) {
                                intervention = sharedInterventions.find(
                                    (iv) => normalizeId(iv.id) === normalizeId(ivId)
                                );
                            } else {
                                const participantId = getFieldValue("participant");

                                const selectedP = participants.find(
                                    (p) => String((p as any).id) === String(participantId)
                                );

                                intervention = (
                                    (selectedP as any)?.requiredInterventions || []
                                ).find((iv: any) => normalizeId(iv.id) === normalizeId(ivId));
                            }

                            const def = ivDefsById[String(ivId)] || null;
                            const mergedIntervention = def
                                ? { ...intervention, ...def }
                                : intervention;

                            const assignmentMode =
                                getInterventionAssignmentMode(mergedIntervention);

                            const subInterventions =
                                getActiveSubInterventions(mergedIntervention);

                            const hasSubInterventions =
                                !!mergedIntervention?.hasSubInterventions ||
                                subInterventions.length > 0;

                            // AD-HOC = FREE TEXT
                            if (assignmentMode === "ad-hoc") {
                                return (
                                    <Form.Item
                                        name="subIntervention"
                                        label="What is being done?"
                                        rules={[
                                            {
                                                required: true,
                                                message: "Please describe the ad-hoc intervention",
                                            },
                                        ]}
                                    >
                                        <Input placeholder="e.g. Emergency compliance support, Funding application review, Tender assistance" />
                                    </Form.Item>
                                );
                            }

                            // NORMAL SUB-INTERVENTION FLOW
                            if (!hasSubInterventions || !subInterventions.length) {
                                return null;
                            }

                            const suggestedSubId = !isGrouped
                                ? suggestNextSubIntervention({
                                    participantId: String(getFieldValue("participant") || ""),
                                    interventionId: String(ivId),
                                    subInterventions,
                                    assignments,
                                    rotationMode:
                                        mergedIntervention?.subInterventionRotationMode ===
                                            "repeat"
                                            ? "repeat"
                                            : "rotate",
                                })
                                : null;

                            return (
                                <Form.Item
                                    name="subIntervention"
                                    label="Select Sub-intervention"
                                    tooltip={
                                        suggestedSubId
                                            ? "Pre-selected: whichever sub-intervention this SME has gone longest without completing."
                                            : undefined
                                    }
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please select a sub-intervention",
                                        },
                                    ]}
                                >
                                    <Select placeholder="Choose what is being done">
                                        {subInterventions.map((sub: any) => {
                                            const subId = String(sub.subId || sub.id || sub.title);
                                            return (
                                                <Select.Option key={subId} value={subId}>
                                                    {sub.title || sub.name || sub.label || "Untitled"}
                                                    {subId === suggestedSubId ? (
                                                        <Tag color="blue" style={{ marginLeft: 8 }}>
                                                            Suggested
                                                        </Tag>
                                                    ) : null}
                                                </Select.Option>
                                            );
                                        })}
                                    </Select>
                                </Form.Item>
                            );
                        }}
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prev, curr) =>
                            prev.intervention !== curr.intervention ||
                            prev.participant !== curr.participant ||
                            prev.participants !== curr.participants ||
                            prev.type !== curr.type
                        }
                    >
                        {({ getFieldValue }) => {
                            const isGrouped = getFieldValue("type") === "grouped";
                            const ivId = getFieldValue("intervention");

                            if (!ivId) return null;

                            let intervention: any = null;

                            if (isGrouped) {
                                intervention = sharedInterventions.find(
                                    (iv) => normalizeId(iv.id) === normalizeId(ivId)
                                );
                            } else {
                                const participantId = getFieldValue("participant");

                                const selectedP = participants.find(
                                    (p) => String((p as any).id) === String(participantId)
                                );

                                intervention = (
                                    (selectedP as any)?.requiredInterventions || []
                                ).find((iv: any) => normalizeId(iv.id) === normalizeId(ivId));
                            }

                            const def = ivDefsById[String(ivId)] || null;

                            const mergedIntervention = def
                                ? { ...intervention, ...def }
                                : intervention;

                            const assignmentMode =
                                getInterventionAssignmentMode(mergedIntervention);

                            if (assignmentMode !== "recurring") {
                                return null;
                            }

                            return (
                                <Form.Item
                                    name="derivedRecurrenceText"
                                    label="Recurrence"
                                    initialValue="—"
                                >
                                    <Input disabled />
                                </Form.Item>
                            );
                        }}
                    </Form.Item>

                    <Form.Item name="recurring" hidden />
                    <Form.Item name="recurrencePreset" hidden />
                    <Form.Item name="recurrence" hidden />
                    <Form.Item name="recurrenceStrict" hidden />

                    <Form.Item
                        className="guide-assignment-assignee"
                        name="assignTo"
                        label="Assign To"
                        initialValue="self"
                        rules={[
                            { required: true, message: "Please choose who to assign to" },
                        ]}
                    >
                        <Select
                            placeholder="Assign to..."
                            options={[
                                {
                                    value: "self",
                                    label: `Assign to Self (${assigneeName || (user as any)?.name || "Me"})`,
                                },
                                { value: "coordinator", label: "Other Coordinator" },
                                { value: "hod", label: "Head of Department" },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prev, curr) => prev.assignTo !== curr.assignTo}
                    >
                        {({ getFieldValue }) =>
                            getFieldValue("assignTo") === "coordinator" ? (
                                <Form.Item
                                    name="coordinator"
                                    label="Select Coordinator"
                                    rules={[
                                        { required: true, message: "Please select a coordinator" },
                                    ]}
                                >
                                    <Select
                                        placeholder="Choose another coordinator"
                                        showSearch
                                        optionFilterProp="label"
                                        options={coordinators
                                            .filter(
                                                (c) =>
                                                    String(c.id) !== String(assigneeId || "") &&
                                                    safeLower(c.email) !== safeLower(user?.email)
                                            )
                                            .map((c) => ({
                                                value: c.id,
                                                label: c.name,
                                            }))}
                                    />
                                </Form.Item>
                            ) : null
                        }
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prev, curr) => prev.assignTo !== curr.assignTo}
                    >
                        {({ getFieldValue }) =>
                            getFieldValue("assignTo") === "hod" ? (
                                <Form.Item
                                    name="hodId"
                                    label="Select HOD"
                                    rules={[{ required: true, message: "Please select an HOD" }]}
                                >
                                    <Select
                                        placeholder="Choose Head of Department"
                                        showSearch
                                        optionFilterProp="label"
                                        options={hodList.map((h) => ({
                                            value: h.id,
                                            label: `${h.name}${h.departmentName ? ` — ${h.departmentName}` : ""}`,
                                        }))}
                                    />
                                </Form.Item>
                            ) : null
                        }
                    </Form.Item>

                    <Form.Item
                        className="guide-assignment-sessions"
                        name="plannedSessions"
                        label="Planned Sessions"
                        rules={[
                            {
                                required: true,
                                message: "Enter the number of planned sessions",
                            },
                        ]}
                        tooltip="Pre-filled from this intervention's typical session count - progress is now calculated automatically from held vs. planned sessions, no manual tracking mode to choose."
                    >
                        <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>

                    <Form.Item
                        className="guide-assignment-due-date"
                        name="dueDate"
                        label="Due Date"
                        rules={[{ required: true, message: "Please select a due date" }]}
                    >
                        <DatePicker
                            style={{ width: "100%" }}
                            disabledDate={(current) =>
                                current && current < dayjs().startOf("day")
                            }
                        />
                    </Form.Item>

                    <Form.Item>
                        <Button
                            className="guide-assignment-submit"
                            type="primary"
                            htmlType="submit"
                            block
                            loading={savingAssignment}
                            disabled={savingAssignment}
                        >
                            {reassigningAssignment
                                ? "Save Reassignment"
                                : "Create Assignment"}
                        </Button>
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                centered
                title="Set Up First Appointment"
                open={firstAppointmentOpen}
                maskClosable={false}
                keyboard={false}
                onCancel={() => {
                    setFirstAppointmentOpen(false);
                    setFirstAppointmentContext(null);
                    firstAppointmentForm.resetFields();
                }}
                onOk={() => firstAppointmentForm.submit()}
                okText="Create Appointment"
                confirmLoading={savingFirstAppointment}
                okButtonProps={{ disabled: savingFirstAppointment }}
                width={isMobile ? "100%" : 620}
                destroyOnClose
            >
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={
                        firstAppointmentContext?.grouped
                            ? `This creates one linked invite for each of the ${firstAppointmentContext.assignments.length} SMEs.`
                            : "The SME will accept or decline the intervention by responding to this appointment."
                    }
                />

                <Form
                    form={firstAppointmentForm}
                    layout="vertical"
                    onFinish={handleScheduleFirstAppointment}
                >
                    <Form.Item
                        name="sessionTitle"
                        label="Session Title"
                        rules={[
                            { required: true, message: "Please enter a session title" },
                        ]}
                    >
                        <Input placeholder="e.g. Introduction and needs review" />
                    </Form.Item>

                    <Form.Item
                        name="plannedCoverage"
                        label="Points to Cover"
                        rules={[
                            { required: true, message: "Add at least one point to cover" },
                        ]}
                        extra="Type a point and press Enter. These points will be used for session coverage."
                    >
                        <Select
                            mode="tags"
                            tokenSeparators={[","]}
                            placeholder="e.g. Introductions, objectives, next steps"
                        />
                    </Form.Item>

                    <Row gutter={12}>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name="date"
                                label="Date"
                                rules={[{ required: true, message: "Select a date" }]}
                            >
                                <DatePicker
                                    style={{ width: "100%" }}
                                    disabledDate={(current) =>
                                        current && current < dayjs().startOf("day")
                                    }
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={8}>
                            <Form.Item
                                name="startTime"
                                label="Start Time"
                                rules={[{ required: true, message: "Select a start time" }]}
                            >
                                <TimePicker
                                    style={{ width: "100%" }}
                                    format="HH:mm"
                                    minuteStep={15}
                                    needConfirm={false}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={12} md={8}>
                            <Form.Item
                                name="endTime"
                                label="End Time"
                                rules={[{ required: true, message: "Select an end time" }]}
                            >
                                <TimePicker
                                    style={{ width: "100%" }}
                                    format="HH:mm"
                                    minuteStep={15}
                                    needConfirm={false}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        name="deliveryMethod"
                        label="Delivery Method"
                        rules={[{ required: true, message: "Select a delivery method" }]}
                    >
                        <Select
                            options={[
                                { value: "in_person", label: "In Person" },
                                { value: "virtual", label: "Virtual" },
                                { value: "telephonically", label: "Telephonic" },
                            ]}
                        />
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(previous, current) =>
                            previous.deliveryMethod !== current.deliveryMethod
                        }
                    >
                        {({ getFieldValue }) => {
                            const deliveryMethod = getFieldValue("deliveryMethod");
                            if (deliveryMethod === "virtual") {
                                return (
                                    <Form.Item
                                        name="meetingLink"
                                        label="Meeting Link"
                                        rules={[
                                            {
                                                required: true,
                                                message: "Enter the virtual meeting link",
                                            },
                                            { type: "url", message: "Enter a valid URL" },
                                        ]}
                                    >
                                        <Input placeholder="https://..." />
                                    </Form.Item>
                                );
                            }
                            if (deliveryMethod === "in_person") {
                                return (
                                    <Form.Item
                                        noStyle
                                        shouldUpdate={(previous, current) =>
                                            previous.useDifferentLocation !==
                                            current.useDifferentLocation
                                        }
                                    >
                                        {({ getFieldValue }) => {
                                            const useDifferentLocation = !!getFieldValue(
                                                "useDifferentLocation"
                                            );

                                            return (
                                                <Row gutter={[12, 8]} align="middle">
                                                    <Col xs={24} md={16}>
                                                        <Form.Item
                                                            name="location"
                                                            label="Location"
                                                            rules={[
                                                                {
                                                                    required: true,
                                                                    message: "Enter the meeting location",
                                                                },
                                                            ]}
                                                        >
                                                            <Input
                                                                disabled={!useDifferentLocation}
                                                                placeholder={
                                                                    useDifferentLocation
                                                                        ? "Enter venue or address"
                                                                        : "At Center"
                                                                }
                                                            />
                                                        </Form.Item>
                                                    </Col>

                                                    <Col xs={24} md={8}>
                                                        <Form.Item
                                                            name="useDifferentLocation"
                                                            valuePropName="checked"
                                                            style={{
                                                                marginTop: isMobile ? 0 : 30,
                                                                marginBottom: isMobile ? 16 : 24,
                                                            }}
                                                        >
                                                            <Checkbox
                                                                onChange={(event) => {
                                                                    firstAppointmentForm.setFieldsValue({
                                                                        location: event.target.checked
                                                                            ? ""
                                                                            : "At Center",
                                                                    });
                                                                }}
                                                            >
                                                                Use different location
                                                            </Checkbox>
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                            );
                                        }}
                                    </Form.Item>
                                );
                            }
                            return null;
                        }}
                    </Form.Item>

                    <Form.Item name="description" label="Notes">
                        <Input.TextArea
                            rows={3}
                            placeholder="Optional information for the SME"
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                className="guide-manage-beneficiary-modal"
                centered
                title={`Interventions for ${(selectedParticipant as any)?.beneficiaryName || ""
                    }`}
                open={manageModalVisible}
                onCancel={() => setManageModalVisible(false)}
                footer={null}
                width={isMobile ? "100%" : 1200}
                destroyOnClose
            >
                <div
                    data-guide="manage-beneficiary-metrics"
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                            ? "repeat(2, minmax(0, 1fr))"
                            : "repeat(5, minmax(0, 1fr))",
                        gap: 10,
                        marginBottom: 16,
                    }}
                >
                    {[
                        {
                            title: "Required",
                            value: selectedParticipantCoverage.required,
                            icon: <PayCircleOutlined style={{ color: "#722ed1" }} />,
                            iconBg: "rgba(114,46,209,.12)",
                        },
                        {
                            title: "Assigned",
                            value: selectedParticipantCoverage.assigned,
                            icon: <CheckCircleOutlined style={{ color: "#1677ff" }} />,
                            iconBg: "rgba(22,119,255,.12)",
                        },
                        {
                            title: "Completed",
                            value: selectedParticipantCoverage.completed,
                            icon: <CalendarOutlined style={{ color: "#52c41a" }} />,
                            iconBg: "rgba(82,196,26,.12)",
                        },
                        {
                            title: "Open",
                            value: selectedParticipantCoverage.currentOpen,
                            icon: <CommentOutlined style={{ color: "#fa8c16" }} />,
                            iconBg: "rgba(250,140,22,.12)",
                        },
                        {
                            title: "Grouped",
                            value: selectedParticipantCoverage.grouped,
                            icon: <TeamOutlined style={{ color: "#722ed1" }} />,
                            iconBg: "rgba(114,46,209,.12)",
                        },
                    ].map((metric) => (
                        <MotionCard.Metric
                            title={metric.title}
                            value={metric.value}
                            icon={metric.icon}
                            iconBg={metric.iconBg}
                        />
                    ))}
                </div>

                <Form
                    data-guide="manage-beneficiary-filter"
                    layout={isMobile ? "vertical" : "inline"}
                    style={{ marginBottom: 16 }}
                >
                    <Form.Item label="Filter">
                        <Select
                            value={interventionFilter}
                            onChange={setInterventionFilter}
                            style={{ width: isMobile ? "100%" : 220 }}
                        >
                            <Select.Option value="all">All Interventions</Select.Option>
                            <Select.Option value="assigned">Assigned</Select.Option>
                            <Select.Option value="unassigned">Unassigned</Select.Option>
                        </Select>
                    </Form.Item>
                </Form>

                <Table
                    data-guide="manage-beneficiary-table"
                    columns={modalColumns as any}
                    dataSource={getFilteredInterventions() as any}
                    rowKey="id"
                    expandable={{
                        expandedRowRender: (record: any) => {
                            const isCompletedRow =
                                record.currentStatus?.label === "Completed";
                            return (
                                <div style={{ padding: 10 }}>
                                    {
                                        <Space
                                            direction="vertical"
                                            style={{ width: "100%" }}
                                            size={12}
                                        >
                                            {record.isUnassigned ? (
                                                <Text type="secondary">
                                                    {record.unassignedReason || "Not assigned."}
                                                </Text>
                                            ) : (
                                                <Paragraph>
                                                    <Text strong>Current status:</Text>{" "}
                                                    {!isCompletedRow &&
                                                        record.bottleneck?.pendingType !== "none" ? (
                                                        <Tag color="red">
                                                            {record.bottleneck?.label || "Action required"}
                                                        </Tag>
                                                    ) : (
                                                        <Tag
                                                            color={record.currentStatus?.color || "default"}
                                                        >
                                                            {record.currentStatus?.label || "—"}
                                                        </Tag>
                                                    )}
                                                </Paragraph>
                                            )}

                                            <Paragraph>
                                                <Text strong>Assignment history:</Text>
                                                <br />
                                                <Tag>Assignments: {record.totalAssignments || 0}</Tag>
                                                <Tag color="green">
                                                    Completed: {record.completedCount || 0}
                                                </Tag>
                                                <Tag color="blue">
                                                    In Progress: {record.inProgressCount || 0}
                                                </Tag>
                                                <Tag color="orange">
                                                    Awaiting scheduling or response:{" "}
                                                    {record.awaitingAcceptanceCount || 0}
                                                </Tag>
                                                <Tag color="purple">
                                                    Needs Reassignment:{" "}
                                                    {record.needsReassignmentCount || 0}
                                                </Tag>
                                            </Paragraph>

                                            <List
                                                size="small"
                                                bordered
                                                dataSource={record.auditRows || []}
                                                locale={{ emptyText: "No assignment history." }}
                                                renderItem={(item: any) => {
                                                    const s = getCompositeStatus(item);

                                                    const assignedDate =
                                                        item?.assignedAt?.toDate?.() ||
                                                        item?.createdAt?.toDate?.() ||
                                                        null;

                                                    const completedDate =
                                                        item?.completedAt?.toDate?.() ||
                                                        item?.completionConfirmedAt?.toDate?.() ||
                                                        (s.label === "Completed"
                                                            ? item?.updatedAt?.toDate?.()
                                                            : null);

                                                    const dueDate = item?.dueDate?.toDate?.() || null;

                                                    const cycle =
                                                        getAssignmentCycleLabel(item) ||
                                                        formatCycleLabel(
                                                            getEffectiveCycleKey(item, record.recurrence)
                                                        ) ||
                                                        "-";

                                                    const progress =
                                                        typeof item?.computedProgress === "number"
                                                            ? Math.round(item.computedProgress)
                                                            : typeof item?.progress === "number"
                                                                ? Math.round(item.progress)
                                                                : s.label === "Completed"
                                                                    ? 100
                                                                    : 0;

                                                    return (
                                                        <List.Item>
                                                            <Row
                                                                gutter={[12, 8]}
                                                                style={{ width: "100%" }}
                                                                align="middle"
                                                            >
                                                                <Col xs={24} md={8}>
                                                                    <Space direction="vertical" size={2}>
                                                                        <Space wrap>
                                                                            <Tag color={s.color}>{s.label}</Tag>

                                                                            <Tag color="default">Cycle: {cycle}</Tag>

                                                                            {isGroupedAssignmentRecord(item) ? (
                                                                                <Tag color="purple">Grouped</Tag>
                                                                            ) : (
                                                                                <Tag color="geekblue">Single</Tag>
                                                                            )}
                                                                            {getSmeRejectionDetails(item) ? (
                                                                                <Button
                                                                                    type="link"
                                                                                    size="small"
                                                                                    style={{ paddingInline: 0 }}
                                                                                    onClick={() => setRejectionDetailsAssignment(item)}
                                                                                >
                                                                                    View reason
                                                                                </Button>
                                                                            ) : null}
                                                                        </Space>

                                                                        <Text strong>
                                                                            {item?.assigneeName || "—"}
                                                                        </Text>

                                                                        {item?.subInterventionTitle ||
                                                                            item?.subInterventionId ? (
                                                                            <Text
                                                                                type="secondary"
                                                                                style={{ fontSize: 12 }}
                                                                            >
                                                                                {item?.subInterventionTitle ||
                                                                                    item?.subInterventionId}
                                                                            </Text>
                                                                        ) : (
                                                                            <Text
                                                                                type="secondary"
                                                                                style={{ fontSize: 12 }}
                                                                            >
                                                                                No sub-intervention
                                                                            </Text>
                                                                        )}
                                                                    </Space>
                                                                </Col>

                                                                <Col xs={24} md={8}>
                                                                    <Space direction="vertical" size={2}>
                                                                        <Text
                                                                            type="secondary"
                                                                            style={{ fontSize: 11 }}
                                                                        >
                                                                            Assigned
                                                                        </Text>

                                                                        <Text>
                                                                            {assignedDate
                                                                                ? dayjs(assignedDate).format(
                                                                                    "YYYY-MM-DD"
                                                                                )
                                                                                : "—"}
                                                                        </Text>

                                                                        <Text
                                                                            type="secondary"
                                                                            style={{ fontSize: 11 }}
                                                                        >
                                                                            Due
                                                                        </Text>

                                                                        <Text>
                                                                            {dueDate
                                                                                ? dayjs(dueDate).format("YYYY-MM-DD")
                                                                                : "—"}
                                                                        </Text>
                                                                    </Space>
                                                                </Col>

                                                                <Col xs={24} md={8}>
                                                                    <Space
                                                                        direction="vertical"
                                                                        size={2}
                                                                        style={{ width: "100%" }}
                                                                    >
                                                                        <Text
                                                                            type="secondary"
                                                                            style={{ fontSize: 11 }}
                                                                        >
                                                                            Completed
                                                                        </Text>

                                                                        <Text>
                                                                            {completedDate
                                                                                ? dayjs(completedDate).format(
                                                                                    "YYYY-MM-DD"
                                                                                )
                                                                                : "—"}
                                                                        </Text>

                                                                        <Text
                                                                            type="secondary"
                                                                            style={{ fontSize: 11 }}
                                                                        >
                                                                            Progress
                                                                        </Text>

                                                                        <Progress percent={progress} size="small" />
                                                                    </Space>
                                                                </Col>
                                                            </Row>
                                                        </List.Item>
                                                    );
                                                }}
                                            />
                                        </Space>
                                    }
                                </div>
                            );
                        },
                    }}
                    pagination={{
                        pageSize: 5,
                        position: ["bottomCenter"],
                        showSizeChanger: false,
                    }}
                    scroll={isMobile ? { x: 900 } : undefined}
                    size={isMobile ? "small" : "middle"}
                />
            </Modal>

            <Modal
                className="guide-group-members-modal"
                centered
                title="Grouped intervention members"
                open={groupMembersModalVisible}
                onCancel={() => setGroupMembersModalVisible(false)}
                footer={null}
                width={isMobile ? "100%" : 920}
                destroyOnClose
            >
                {selectedGroup ? (
                    <Space direction="vertical" style={{ width: "100%" }} size={14}>
                        <Descriptions bordered size="small" column={isMobile ? 1 : 2}>
                            <Descriptions.Item label="Intervention">
                                {selectedGroup.interventionTitle}
                            </Descriptions.Item>
                            <Descriptions.Item label="Assignee">
                                {selectedGroup.assigneeName || "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Cycle">
                                {selectedGroup.cycleLabel ||
                                    getAssignmentCycleLabel(selectedGroup) ||
                                    "-"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Members">
                                {selectedGroup.memberCount ||
                                    getGroupMembers(selectedGroup.groupKey).length}
                            </Descriptions.Item>
                            <Descriptions.Item label="Group progress">
                                <Progress
                                    percent={getGroupProgress(selectedGroup)}
                                    size="small"
                                    style={{ minWidth: 150 }}
                                />
                            </Descriptions.Item>
                            <Descriptions.Item label="Delivery sessions">
                                {groupDeliverySummary.loading
                                    ? "Loading…"
                                    : `${groupDeliverySummary.sessionsHeld} held`}
                            </Descriptions.Item>
                            <Descriptions.Item label="Attendance">
                                {groupDeliverySummary.loading
                                    ? "Loading…"
                                    : groupDeliverySummary.attendancePossible
                                        ? `${groupDeliverySummary.attendanceCount} attended of ${groupDeliverySummary.attendancePossible} possible attendances`
                                        : "No completed sessions yet"}
                            </Descriptions.Item>
                        </Descriptions>

                        <Table
                            rowKey="id"
                            size="small"
                            dataSource={getGroupMembers(selectedGroup.groupKey) as any}
                            pagination={{ pageSize: 8, position: ["bottomCenter"], showSizeChanger: false }}
                            scroll={isMobile ? { x: 850 } : undefined}
                            columns={
                                [
                                    { title: "SME", dataIndex: "beneficiaryName" },
                                    {
                                        title: "Status",
                                        render: (_: any, r: any) => {
                                            const s = getCompositeStatus(r);
                                            const rejection = getSmeRejectionDetails(r);
                                            return (
                                                <Space direction="vertical" size={2}>
                                                    <Tag color={s.color}>{s.label}</Tag>
                                                    {rejection ? (
                                                        <Button
                                                            type="link"
                                                            size="small"
                                                            style={{ paddingInline: 0, height: 'auto' }}
                                                            onClick={() => setRejectionDetailsAssignment(r)}
                                                        >
                                                            {rejection.kind}: view reason
                                                        </Button>
                                                    ) : null}
                                                </Space>
                                            );
                                        },
                                    },
                                    {
                                        title: "Action",
                                        render: (_: any, r: any) => (
                                            <Button
                                                danger
                                                icon={<DeleteOutlined />}
                                                shape="round"
                                                loading={groupActionLoading}
                                                disabled={getCompositeStatus(r).label === "Completed"}
                                                onClick={() => handleRemoveMemberFromGroup(r)}
                                            >
                                                Remove from group
                                            </Button>
                                        ),
                                    },
                                ] as any
                            }
                        />

                        {!isGroupComplete(selectedGroup) && (
                            <Button
                                data-guide="group-add-sme"
                                type="primary"
                                icon={<UserAddOutlined />}
                                shape="round"
                                onClick={() => openAddToGroup(selectedGroup)}
                            >
                                Add SME to this group
                            </Button>
                        )}
                    </Space>
                ) : (
                    <Empty description="No group selected." />
                )}
            </Modal>

            <Modal
                centered
                title="Create group from single assignments"
                open={convertSinglesModalVisible}
                onCancel={() => setConvertSinglesModalVisible(false)}
                footer={null}
                width={isMobile ? "100%" : 680}
                destroyOnClose
            >
                <Form
                    form={convertSinglesForm}
                    layout="vertical"
                    onFinish={handleConvertSinglesToGroup}
                >
                    <Form.Item
                        name="groupKey"
                        label="Single intervention cycle"
                        rules={[
                            { required: true, message: "Select an intervention cycle." },
                        ]}
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder="Select matching single assignments"
                            onChange={() =>
                                convertSinglesForm.setFieldsValue({ assignments: [] })
                            }
                            options={singleAssignmentGroupOptions.map((option) => ({
                                value: option.key,
                                label: `${option.title}${option.cycleLabel ? ` ${option.cycleLabel}` : ""
                                    } (${option.assignments.length})`,
                            }))}
                        />
                    </Form.Item>

                    <Form.Item
                        name="assignments"
                        label="SMEs to group"
                        rules={[{ required: true, message: "Select at least two SMEs." }]}
                    >
                        <Select
                            mode="multiple"
                            showSearch
                            optionFilterProp="label"
                            placeholder="Select SMEs"
                            disabled={!selectedConvertSinglesGroup}
                            options={(selectedConvertSinglesGroup?.assignments || []).map(
                                (row: any) => ({
                                    value: String(row.id),
                                    label: String(row.beneficiaryName || "Unknown"),
                                })
                            )}
                        />
                    </Form.Item>

                    <Button
                        type="primary"
                        htmlType="submit"
                        block
                        loading={groupActionLoading}
                    >
                        Convert selected assignments to grouped
                    </Button>
                </Form>
            </Modal>

            <Modal
                className="guide-add-group-member-modal"
                centered
                title="Add SME to existing group"
                open={addToGroupModalVisible}
                onCancel={() => setAddToGroupModalVisible(false)}
                footer={null}
                width={isMobile ? "100%" : 620}
                destroyOnClose
            >
                {selectedGroup ? (
                    <Form
                        form={addToGroupForm}
                        layout="vertical"
                        onFinish={handleAddSmesToExistingGroup}
                    >
                        <Descriptions
                            bordered
                            size="small"
                            column={1}
                            style={{ marginBottom: 16 }}
                        >
                            <Descriptions.Item label="Group">
                                {selectedGroup.interventionTitle}
                            </Descriptions.Item>
                            <Descriptions.Item label="Assignee">
                                {selectedGroup.assigneeName || "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Current SMEs">
                                {selectedGroup.memberCount ||
                                    getGroupMembers(selectedGroup.groupKey).length}
                            </Descriptions.Item>
                        </Descriptions>

                        <div data-guide="group-add-sme-select">
                            <Form.Item
                                name="participants"
                                label="SMEs to add"
                                rules={[{ required: true, message: "Select at least one SME." }]}
                                extra="Only SMEs with both DP confirmations and the same required intervention are shown."
                            >
                                <Select
                                    mode="multiple"
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select SMEs to add to this existing group"
                                    options={getEligibleParticipantsForGroup(selectedGroup).map(
                                        (p: any) => {
                                            const importableSingle =
                                                getImportableSingleAssignmentForGroup(
                                                    selectedGroup,
                                                    String(p.id)
                                                );
                                            return {
                                                value: String(p.id),
                                                label: `${String(p.beneficiaryName || "Unknown")}${importableSingle ? " (import single)" : ""
                                                    }`,
                                            };
                                        }
                                    )}
                                    maxTagCount="responsive"
                                    notFoundContent="No eligible SME matches your search"
                                />
                            </Form.Item>
                        </div>

                        <Button
                            data-guide="group-add-sme-submit"
                            type="primary"
                            htmlType="submit"
                            block
                            loading={groupActionLoading}
                        >
                            Add selected SME(s) to group
                        </Button>
                    </Form>
                ) : (
                    <Empty description="No group selected." />
                )}
            </Modal>

            <Modal
                centered
                title="SME rejection details"
                open={!!rejectionDetailsAssignment}
                onCancel={() => setRejectionDetailsAssignment(null)}
                footer={null}
                destroyOnClose
            >
                {rejectionDetailsAssignment && (() => {
                    const details = getSmeRejectionDetails(rejectionDetailsAssignment);
                    return details ? (
                        <Descriptions bordered size="small" column={1}>
                            <Descriptions.Item label="SME">
                                {String(rejectionDetailsAssignment.participantName || "—")}
                            </Descriptions.Item>
                            <Descriptions.Item label="Intervention">
                                {String(rejectionDetailsAssignment.interventionTitle || "—")}
                            </Descriptions.Item>
                            <Descriptions.Item label="Decision">
                                <Tag color="red">{details.kind}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Reason">
                                <Text>{details.reason}</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label="Recorded">
                                {details.recordedAt?.toDate
                                    ? dayjs(details.recordedAt.toDate()).format("YYYY-MM-DD HH:mm")
                                    : details.recordedAt
                                        ? String(details.recordedAt)
                                        : "—"}
                            </Descriptions.Item>
                        </Descriptions>
                    ) : <Empty description="No rejection details available." />;
                })()}
            </Modal>

            <Modal
                centered
                title="Open cycle details"
                open={openPrevModal.open}
                onCancel={() => setOpenPrevModal({ open: false, assignment: null })}
                footer={null}
                destroyOnClose
            >
                {openPrevModal.assignment ? (
                    <Descriptions bordered size="small" column={1}>
                        <Descriptions.Item label="Cycle Key">
                            {String(openPrevModal.assignment.cycleKey || "—")}
                        </Descriptions.Item>
                        <Descriptions.Item label="Overall Status">
                            {(() => {
                                const c = getCompositeStatus(openPrevModal.assignment);
                                return <Tag color={c.color}>{c.label}</Tag>;
                            })()}
                        </Descriptions.Item>
                        <Descriptions.Item label="Bottleneck">
                            {(() => {
                                const b = getBottleneck(openPrevModal.assignment);
                                return <Text>{b.label || "—"}</Text>;
                            })()}
                        </Descriptions.Item>
                        <Descriptions.Item label="Facilitator">
                            <Space>
                                <Text>
                                    {String(openPrevModal.assignment.assigneeName || "—")}
                                </Text>
                                {(() => {
                                    const id = String(openPrevModal.assignment.assigneeId || "");
                                    const email = coordinators.find((c) => c.id === id)?.email;
                                    return email ? <Text type="secondary">({email})</Text> : null;
                                })()}
                            </Space>
                        </Descriptions.Item>
                        <Descriptions.Item label="SMME acceptance">
                            {String(
                                openPrevModal.assignment.participantAcceptanceStatus || "—"
                            )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Assignee completion">
                            {String(openPrevModal.assignment.assigneeCompletionStatus || "—")}
                        </Descriptions.Item>
                        <Descriptions.Item label="SMME confirmation">
                            {String(
                                openPrevModal.assignment.participantCompletionStatus || "—"
                            )}
                        </Descriptions.Item>
                        {(() => {
                            const rejection = getSmeRejectionDetails(openPrevModal.assignment);
                            return rejection ? (
                                <Descriptions.Item label={`${rejection.kind} reason`}>
                                    <Text type="danger">{rejection.reason}</Text>
                                </Descriptions.Item>
                            ) : null;
                        })()}
                    </Descriptions>
                ) : (
                    <Empty description="No open cycle assignment available." />
                )}
            </Modal>
        </div >
    );
};

export default InterventionsAssignments;
