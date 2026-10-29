import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AutoComplete,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Slider,
  TimePicker,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
  theme,
} from "antd";
import type { ModalProps } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  AimOutlined,
  BulbOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckOutlined,
  LinkOutlined,
  MailOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FlagOutlined,
  FilePptOutlined,
  PlayCircleOutlined,
  SyncOutlined,
  PictureOutlined,
  PlusOutlined,
  RocketOutlined,
  SearchOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  collection,
  deleteField,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import dayjs, { Dayjs } from "dayjs";
import { db, storage } from "@/firebase";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
  DashboardFilterBar,
  MotionCard,
} from "@/components/dashboards/metrics/Header";
import {
  MetricsGrid,
  type DashboardMetric,
} from "@/components/dashboards/metrics/MetricsGrid";
import type { MetricTone } from "@/components/dashboards/metrics/MetricTile";
import { featureGovernanceService } from "@/services/featureGovernanceService";
import {
  FeatureGovernanceRecord,
  FeatureMeeting,
  GovernanceChallenge,
  GovernanceMeeting,
  GovernanceMeetingSchedule,
  MeetingFrequency,
} from "@/types/featureGovernance";
import {
  FeatureGovernanceReportRange,
  generateFeatureGovernancePptx,
} from "@/utils/featureGovernancePptx";
import { governanceMeetingService } from "@/services/governanceMeetingService";
import { governanceMeetingScheduleService } from "@/services/governanceMeetingScheduleService";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { useColorMode } from "@/contexts/ThemeContext";
import ReportPlayer from "./ReportPlayer";

const { Text, Title } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;
// Modals close from the header X, so the footer carries only the primary
// action, stretched across the row (okButtonProps sets block).
const okOnlyFooter: ModalProps["footer"] = (_, { OkBtn }) => <OkBtn />;
type ReportPeriod = "week" | "month" | "quarter" | "all" | "custom";
type GovernanceWorkspaceItem = {
  id: string;
  kind: "meeting" | "feature" | "challenge";
  title: string;
  subtitle: string;
  date?: string;
  status: string;
  data: any;
};
const DEPARTMENT_ROLES = ["operations", "coordinator", "headofdepartment"];
const BRANCH_ROLES = ["projectadmin", "receptionist", "employee"];
// Roles a feature can affect. System admins see everything, so they are not
// offered as an audience.
const ROLES = [
  "director",
  "operations",
  "coordinator",
  "projectadmin",
  "receptionist",
  "employee",
  "incubatee",
  "funder",
];
const ROLE_LABELS: Record<string, string> = {
  system_admin: "System Admin",
  director: "Director",
  operations: "Heads Of Departments",
  headofdepartment: "Heads Of Departments",
  headsofdepartment: "Heads Of Departments",
  coordinator: "Coordinator",
  projectadmin: "Center Coordinator",
  receptionist: "Receptionist",
  employee: "Employee",
  incubatee: "SME",
  funder: "Funder",
  government: "Government",
  consultant: "Employee",
  projectmanager: "Employee",
  auxiliary: "Employee",
};
const roleLabel = (role: string) =>
  ROLE_LABELS[
    String(role || "")
      .toLowerCase()
      .replace(/[\s_-]/g, "")
  ] || String(role || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
const uniqueRoleLabels = (roles: string[] = []) =>
  Array.from(new Set(roles.map(roleLabel).filter(Boolean)));
const resolveCompletion = (
  status: string,
  progressValue: unknown,
  completedOn?: Dayjs | null,
  existing?: string | null
) => {
  const awaiting = status === "awaiting-meeting";
  const progress = awaiting
    ? 100
    : status === "released"
    ? 100
    : Math.min(Number(progressValue || 0), 100);
  const finalStatus = awaiting ? status : progress >= 100 ? "released" : status;
  return {
    status: finalStatus,
    progress: finalStatus === "released" ? 100 : progress,
    completedAt:
      finalStatus === "released"
        ? completedOn?.format("YYYY-MM-DD") ||
          existing ||
          dayjs().format("YYYY-MM-DD")
        : null,
  };
};
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const SCHEDULE_DEFAULTS = () => ({
  frequency: "weekly",
  weekday: 1,
  dayOfMonth: 1,
  reminderEmail: "daniel@quantilytix.co.za",
  // Weekends can't be picked, so roll a Saturday/Sunday default to Monday.
  startDate:
    dayjs().day() === 6
      ? dayjs().add(2, "day")
      : dayjs().day() === 0
      ? dayjs().add(1, "day")
      : dayjs(),
  time: dayjs("09:00", "HH:mm"),
});
// Meetings run on weekdays only; values stay as WEEKDAYS indexes (0 = Sunday).
const WEEKDAY_CHIPS = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: WEEKDAYS[value].slice(0, 3),
}));
const occursOn = (schedule: GovernanceMeetingSchedule, date: Dayjs) => {
  if (date.isBefore(dayjs(schedule.startDate), "day")) return false;
  if (schedule.frequency === "monthly")
    return (
      date.date() === Math.min(schedule.dayOfMonth || 1, date.daysInMonth())
    );
  if (date.day() !== schedule.weekday) return false;
  if (schedule.frequency === "weekly") return true;
  const weeks = Math.floor(
    date.startOf("day").diff(dayjs(schedule.startDate).startOf("day"), "day") /
      7
  );
  return weeks % 2 === 0;
};
/** The most recent occurrence on or before today, as YYYY-MM-DD. */
const latestOccurrence = (schedule: GovernanceMeetingSchedule) => {
  const today = dayjs().startOf("day");
  for (let back = 0; back <= 62; back += 1) {
    const date = today.subtract(back, "day");
    if (date.isBefore(dayjs(schedule.startDate), "day")) return null;
    if (occursOn(schedule, date)) return date.format("YYYY-MM-DD");
  }
  return null;
};
/** The next occurrence after today, as YYYY-MM-DD. */
const nextOccurrence = (schedule: GovernanceMeetingSchedule) => {
  const today = dayjs().startOf("day");
  for (let ahead = 1; ahead <= 62; ahead += 1) {
    const date = today.add(ahead, "day");
    if (occursOn(schedule, date)) return date.format("YYYY-MM-DD");
  }
  return null;
};
const isWeekend = (date: Dayjs) => date.day() === 0 || date.day() === 6;
// Discussion is stored as plain text, one point per line, so older free-text
// notes still read the same.
const discussionPoints = (text?: string) =>
  String(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean);
const DiscussionText: React.FC<{ text?: string; empty: string }> = ({
  text,
  empty,
}) => {
  const points = discussionPoints(text);
  if (!points.length) return <Text type="secondary">{empty}</Text>;
  if (points.length === 1) return <Text>{points[0]}</Text>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {points.map((point, index) => (
        <li key={index}>
          <Text>{point}</Text>
        </li>
      ))}
    </ul>
  );
};
// One line to type in, a round add button, and the added items as cards
// with a delete button each.
const PointsListInput: React.FC<{
  points: string[];
  onChange: (points: string[]) => void;
  placeholder: string;
  noun: string;
}> = ({ points, onChange, placeholder, noun }) => {
  const { token } = theme.useToken();
  const [draft, setDraft] = useState("");
  const update = onChange;
  const addPoint = () => {
    const text = draft.trim();
    if (!text) return;
    update([...points, text]);
    setDraft("");
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            event.preventDefault();
            addPoint();
          }}
        />
        <Button
          type="primary"
          shape="circle"
          icon={<PlusOutlined />}
          aria-label={`Add ${noun}`}
          disabled={!draft.trim()}
          onClick={addPoint}
        />
      </div>
      {points.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {points.map((point, index) => (
            <div
              key={`${index}-${point}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 6px 6px 12px",
                borderRadius: 10,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorFillAlter,
              }}
            >
              <Text style={{ flex: 1, minWidth: 0 }}>{point}</Text>
              <Button
                danger
                type="text"
                shape="circle"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={`Remove ${noun}`}
                onClick={() =>
                  update(points.filter((_, itemIndex) => itemIndex !== index))
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
const DiscussionPointsInput: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
}> = ({ value, onChange }) => (
  <PointsListInput
    points={discussionPoints(value)}
    onChange={(next) => onChange?.(next.join("\n"))}
    placeholder="Type a point and press Enter"
    noun="point"
  />
);
// Challenges keep their stored shape ({ text }[]) so saving is unchanged.
const ChallengePointsInput: React.FC<{
  value?: { text?: string }[];
  onChange?: (value: { text: string }[]) => void;
}> = ({ value, onChange }) => (
  <PointsListInput
    points={(value || [])
      .map((item) => String(item?.text || "").trim())
      .filter(Boolean)}
    onChange={(next) => onChange?.(next.map((text) => ({ text })))}
    placeholder="Type a challenge and press Enter"
    noun="challenge"
  />
);
// Slim single-choice cards, used where a checkbox or select hid the choice.
const ChoiceCards: React.FC<{
  value?: string | boolean;
  onChange?: (value: any) => void;
  options: {
    value: string | boolean;
    title: string;
    hint?: string;
    icon: React.ReactNode;
  }[];
  /** Cards per row; defaults to all on one row. */
  columns?: number;
}> = ({ value, onChange, options, columns }) => {
  const { token } = theme.useToken();
  return (
    <div
      role="radiogroup"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${
          columns || options.length
        }, minmax(0, 1fr))`,
        gap: 10,
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(option.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              padding: "8px 12px",
              borderRadius: 12,
              border: `1px solid ${
                active ? token.colorPrimary : token.colorBorderSecondary
              }`,
              background: active
                ? token.colorPrimaryBg
                : token.colorBgContainer,
              color: token.colorText,
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontSize: 16,
                color: active ? token.colorPrimary : token.colorTextSecondary,
              }}
            >
              {option.icon}
            </span>
            <span style={{ minWidth: 0 }}>
              <Text strong style={{ display: "block", lineHeight: 1.3 }}>
                {option.title}
              </Text>
              {option.hint && (
                <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                  {option.hint}
                </Text>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};
// Multi-select cards (affected roles), three to a row.
const MultiChoiceCards: React.FC<{
  value?: string[];
  onChange?: (value: string[]) => void;
  options: { value: string; label: string }[];
}> = ({ value = [], onChange, options }) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 8,
      }}
    >
      {options.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={() =>
              onChange?.(
                active
                  ? value.filter((item) => item !== option.value)
                  : [...value, option.value]
              )
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              minWidth: 0,
              minHeight: 40,
              padding: "6px 10px",
              borderRadius: 10,
              border: `1px solid ${
                active ? token.colorPrimary : token.colorBorderSecondary
              }`,
              background: active
                ? token.colorPrimaryBg
                : token.colorBgContainer,
              color: active ? token.colorPrimary : token.colorText,
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {option.label}
            </span>
            {active && <CheckCircleFilled style={{ flex: "0 0 auto" }} />}
          </button>
        );
      })}
    </div>
  );
};
const STATUS_CARDS: Record<
  string,
  { title: string; hint: string; icon: React.ReactNode }
> = {
  submitted: {
    title: "Under review",
    hint: "Not yet planned",
    icon: <EyeOutlined />,
  },
  planned: {
    title: "Planned",
    hint: "Scheduled, not started",
    icon: <CalendarOutlined />,
  },
  "in-progress": {
    title: "In progress",
    hint: "Being built",
    icon: <SyncOutlined />,
  },
  blocked: {
    title: "At risk",
    hint: "Blocked or slipping",
    icon: <WarningOutlined />,
  },
  "awaiting-meeting": {
    title: "Meeting pending",
    hint: "Done, awaiting sign-off",
    icon: <TeamOutlined />,
  },
  released: {
    title: "Completed",
    hint: "Live for users",
    icon: <CheckCircleOutlined />,
  },
};
type FeatureSection = "details" | "delivery" | "release" | "audience";
// Sections offered when editing; picking some turns each into a step.
const FEATURE_SECTIONS: {
  key: FeatureSection;
  title: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "details",
    title: "Details",
    hint: "Title, description and scope",
    icon: <EditOutlined />,
  },
  {
    key: "delivery",
    title: "Status and progress",
    hint: "Where delivery stands",
    icon: <RocketOutlined />,
  },
  {
    key: "release",
    title: "What's New publication",
    hint: "Announce a completed feature",
    icon: <PictureOutlined />,
  },
  {
    key: "audience",
    title: "Affected users",
    hint: "Roles, departments and centres",
    icon: <TeamOutlined />,
  },
];
const FEATURE_STEP_TITLES: Record<string, string> = {
  choose: "What do you want to update?",
  details: "Details",
  delivery: "Status and progress",
  release: "What's New publication",
  audience: "Affected users",
};
const FEATURE_STEP_FIELDS: Record<string, string[]> = {
  details: [
    "title",
    "description",
    "category",
    "requestedByName",
    "programSpecific",
  ],
  delivery: ["type", "status", "progress", "dueDate", "completedAt"],
  release: [
    "publishToWhatsNew",
    "releaseHeadline",
    "releaseSummary",
    "releaseDate",
  ],
  audience: ["roles", "departmentIds", "branchIds"],
};
// Slim read-only "before → after" row for a value an update will change.
const ChangeCard: React.FC<{
  label: string;
  from: string;
  to: string;
  icon: React.ReactNode;
}> = ({ label, from, to, icon }) => {
  const { token } = theme.useToken();
  const changed = from !== to;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 12,
        border: `1px solid ${
          changed ? token.colorPrimary : token.colorBorderSecondary
        }`,
        background: changed ? token.colorPrimaryBg : token.colorFillAlter,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
          width: 30,
          height: 30,
          borderRadius: 8,
          fontSize: 15,
          color: changed ? "#fff" : token.colorPrimary,
          background: changed ? token.colorPrimary : token.colorPrimaryBg,
        }}
      >
        {icon}
      </span>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {label}
      </Text>
      <span
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
        }}
      >
        <Text strong={!changed} type={changed ? "secondary" : undefined}>
          {from}
        </Text>
        {changed && (
          <>
            <ArrowRightOutlined
              style={{ fontSize: 12, color: token.colorPrimary }}
            />
            <Text strong style={{ color: token.colorPrimary }}>
              {to}
            </Text>
          </>
        )}
      </span>
    </div>
  );
};
const MeetingStatusCards: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
}> = ({ value, onChange }) => {
  const { token } = theme.useToken();
  const options = [
    {
      value: "held",
      title: "Held",
      hint: "It already took place",
      icon: <CheckCircleOutlined />,
    },
    {
      value: "pending",
      title: "Upcoming",
      hint: "It is still to be held",
      icon: <ClockCircleOutlined />,
    },
  ];
  return (
    <div
      role="radiogroup"
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(option.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${
                active ? token.colorPrimary : token.colorBorderSecondary
              }`,
              background: active
                ? token.colorPrimaryBg
                : token.colorBgContainer,
              color: token.colorText,
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontSize: 18,
                color: active ? token.colorPrimary : token.colorTextSecondary,
              }}
            >
              {option.icon}
            </span>
            <span style={{ minWidth: 0 }}>
              <Text strong style={{ display: "block" }}>
                {option.title}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {option.hint}
              </Text>
            </span>
          </button>
        );
      })}
    </div>
  );
};
type MeetingExtra = "challenges" | "feature" | "links";
// Optional parts of a meeting record. Each one picked on the first step of
// "Add meeting" becomes its own step, in this order.
const MEETING_EXTRAS: {
  key: MeetingExtra;
  title: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "challenges",
    title: "Challenges raised",
    hint: "Problems or blockers that came up",
    icon: <WarningOutlined />,
  },
  {
    key: "feature",
    title: "New feature request",
    hint: "Log a request that came out of the meeting",
    icon: <BulbOutlined />,
  },
  {
    key: "links",
    title: "Link existing features",
    hint: "Connect features that were discussed",
    icon: <LinkOutlined />,
  },
];
const MEETING_STEP_FIELDS: Record<string, string[]> = {
  details: [
    "title",
    "status",
    "withName",
    "meetingDate",
    "dueDate",
    "discussion",
  ],
  challenges: ["challenges"],
  feature: [
    "featureTitle",
    "featureDescription",
    "featureRoles",
    "featureDepartmentIds",
    "featureBranchIds",
    "featureDueDate",
  ],
  links: ["relatedFeatureIds"],
};
const MEETING_STEP_TITLES: Record<string, string> = {
  choose: "What are you recording?",
  details: "Meeting details",
  challenges: "Challenges raised",
  feature: "New feature request",
  links: "Link existing features",
};
const roleOptions = ROLES.map((value) => ({ value, label: roleLabel(value) }));
const normalizeChallenges = (
  value: GovernanceMeeting["challenges"]
): GovernanceChallenge[] => {
  if (Array.isArray(value))
    return value
      .filter((item) => item?.text?.trim())
      .map((item, index) => ({
        id: item.id || `legacy-${index}`,
        text: item.text.trim(),
        status: item.status === "resolved" ? "resolved" : "open",
        resolvedAt: item.resolvedAt,
        resolvedBy: item.resolvedBy,
        resolution: item.resolution,
      }));
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `legacy-${index}`,
      text,
      status: "open" as const,
    }));
};
const FeatureGovernancePage: React.FC = () => {
  const { user, loading: identityLoading } = useFullIdentity();
  const { token } = theme.useToken();
  const { isDark } = useColorMode();
  const sunkenPanel: React.CSSProperties = {
    padding: 16,
    borderRadius: 12,
    background: isDark ? "rgba(255,255,255,.055)" : token.colorFillAlter,
    border: `1px solid ${token.colorBorderSecondary}`,
    boxShadow: isDark
      ? "inset 0 2px 8px rgba(0,0,0,.24)"
      : "inset 0 2px 8px rgba(15,23,42,.06)",
  };
  const workspacePanel: React.CSSProperties = {
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 16,
    background: token.colorBgContainer,
    overflow: "hidden",
  };
  const { activeProgramId, isAllPrograms } = useActiveProgramId();
  const [records, setRecords] = useState<FeatureGovernanceRecord[]>([]);
  const [governanceMeetings, setGovernanceMeetings] = useState<
    GovernanceMeeting[]
  >([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeatureGovernanceRecord | null>(null);
  const [entryMode, setEntryMode] = useState<
    "feature" | "pipeline" | "released"
  >("feature");
  const [updating, setUpdating] = useState<FeatureGovernanceRecord | null>(
    null
  );
  const [updateForm] = Form.useForm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [schedules, setSchedules] = useState<GovernanceMeetingSchedule[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm] = Form.useForm();
  const scheduleFrequency: MeetingFrequency =
    Form.useWatch("frequency", scheduleForm) || "weekly";
  const [meetingUpdating, setMeetingUpdating] = useState<any | null>(null);
  const [meetingUpdateForm] = Form.useForm();
  const [notHeldMeeting, setNotHeldMeeting] = useState<any | null>(null);
  const [notHeldForm] = Form.useForm();
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerOrigin, setPlayerOrigin] = useState<{ x: number; y: number } | null>(null);
  const [formStep, setFormStep] = useState(0);
  const [featureSections, setFeatureSections] = useState<FeatureSection[]>([]);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [directChallengeOpen, setDirectChallengeOpen] = useState(false);
  const [meetings, setMeetings] = useState<FeatureMeeting[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>();
  const [personFilter, setPersonFilter] = useState<string>();
  const [segment, setSegment] = useState<string>("Meetings");
  const [selectedWorkspaceItemId, setSelectedWorkspaceItemId] = useState("");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("month");
  const [customReportRange, setCustomReportRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);
  const [selectedMeeting, setSelectedMeeting] = useState<
    (FeatureMeeting & { featureTitle: string }) | null
  >(null);
  const [challengeToResolve, setChallengeToResolve] = useState<
    (GovernanceChallenge & { meetingId: string }) | null
  >(null);
  const [resolution, setResolution] = useState("");
  const [releaseImages, setReleaseImages] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();
  const [meetingForm] = Form.useForm();
  const [directChallengeForm] = Form.useForm();
  const selectedRoles = Form.useWatch("roles", form) || [];
  const selectedFeatureStatus = Form.useWatch("status", form);
  const publishToWhatsNew = Form.useWatch("publishToWhatsNew", form);
  const [meetingStep, setMeetingStep] = useState(0);
  const [meetingExtras, setMeetingExtras] = useState<MeetingExtra[]>([]);
  const meetingSteps = [
    "choose",
    "details",
    ...MEETING_EXTRAS.map((extra) => extra.key).filter((key) =>
      meetingExtras.includes(key)
    ),
  ];
  const currentMeetingStep = meetingSteps[meetingStep];
  const onLastMeetingStep = meetingStep === meetingSteps.length - 1;
  const createFeatureFromMeeting = meetingExtras.includes("feature");
  const [scheduleView, setScheduleView] = useState<"list" | "form">("form");
  const [editingSchedule, setEditingSchedule] =
    useState<GovernanceMeetingSchedule | null>(null);
  const scheduleWeekday = Form.useWatch("weekday", scheduleForm);
  const scheduleDayOfMonth = Form.useWatch("dayOfMonth", scheduleForm);
  const scheduleTime = Form.useWatch("time", scheduleForm);
  const scheduleStartDate = Form.useWatch("startDate", scheduleForm);
  const meetingRoles = Form.useWatch("featureRoles", meetingForm) || [];
  const needsDepartments = selectedRoles.some((role: string) =>
    DEPARTMENT_ROLES.includes(role)
  );
  const needsBranches = selectedRoles.some((role: string) =>
    BRANCH_ROLES.includes(role)
  );
  const meetingNeedsDepartments = meetingRoles.some((role: string) =>
    DEPARTMENT_ROLES.includes(role)
  );
  const meetingNeedsBranches = meetingRoles.some((role: string) =>
    BRANCH_ROLES.includes(role)
  );
  const programScopeLabel = isAllPrograms
    ? "all active programs"
    : "your selected program";

  const load = async () => {
    setLoading(true);
    try {
      const [items, savedMeetings, savedSchedules, deptSnap, branchSnap] =
        await Promise.all([
          featureGovernanceService.list(),
          governanceMeetingService.list(),
          governanceMeetingScheduleService.list().catch(() => []),
          getDocs(query(collection(db, "departments"))),
          getDocs(query(collection(db, "branches"))),
        ]);
      setRecords(items);
      setGovernanceMeetings(savedMeetings);
      setSchedules(savedSchedules);
      setDepartments(deptSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setBranches(branchSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error(error);
      message.error("Could not load feature governance data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!identityLoading) load();
  }, [identityLoading]);

  // Names for the "Requested by" suggestions, loaded the first time the
  // feature form opens.
  const [userDirectory, setUserDirectory] = useState<
    { id: string; name: string; email: string }[]
  >([]);
  useEffect(() => {
    if (!open || userDirectory.length) return;
    getDocs(collection(db, "users"))
      .then((snap) =>
        setUserDirectory(
          snap.docs
            .map((d) => {
              const data = d.data() as any;
              return {
                id: d.id,
                name: String(
                  data.name || data.fullName || data.displayName || ""
                ).trim(),
                email: String(data.email || "").trim(),
              };
            })
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch((error) => console.warn("Could not load users", error));
  }, [open, userDirectory.length]);
  const featureCategory = Form.useWatch("category", form);
  const featureProgress = Form.useWatch("progress", form);
  const updateProgress: number =
    Form.useWatch("progress", updateForm) ?? updating?.progress ?? 0;
  const updateAtRisk: boolean = !!Form.useWatch("atRisk", updateForm);
  // The progress update never picks a status directly; it follows from how
  // far delivery has moved (and whether it's flagged at risk).
  const nextUpdateStatus = (() => {
    const current = updating?.status || "planned";
    const touched =
      updateProgress !== (updating?.progress || 0) ||
      updateAtRisk !== (current === "blocked");
    if (!touched) return current;
    if (updateProgress >= 100)
      return current === "awaiting-meeting" ? "awaiting-meeting" : "released";
    if (updateAtRisk) return "blocked";
    if (updateProgress > 0) return "in-progress";
    return current === "blocked" ? "planned" : current;
  })();
  const people = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...governanceMeetings.map((m) => m.withName),
            ...records.flatMap((r) =>
              (r.meetings || []).map((m) => m.withName)
            ),
          ].filter(Boolean)
        )
      ).sort(),
    [records, governanceMeetings]
  );
  const filtered = useMemo(
    () =>
      records.filter((record) => {
        const needle = search.toLowerCase();
        return (
          (!needle ||
            `${record.title} ${record.description}`
              .toLowerCase()
              .includes(needle)) &&
          (!statusFilter || record.status === statusFilter) &&
          (!personFilter ||
            record.meetings.some((m) => m.withName === personFilter))
        );
      }),
    [records, search, statusFilter, personFilter]
  );
  // The reminder cron only writes an occurrence 30 minutes after it starts
  // (and not at all if the cron isn't running), so each active schedule's
  // latest occurrence is shown straight away. Until someone answers it, it
  // lives only here ("virtual"); answering writes it under the cron's id.
  const recurringOccurrences = useMemo(
    () =>
      schedules
        .filter((schedule) => schedule.active)
        .flatMap((schedule) =>
          (
            [
              ["latest", latestOccurrence(schedule)],
              ["next", nextOccurrence(schedule)],
            ] as const
          ).map(([kind, date]) => {
            if (!date) return null;
            const id = `${schedule.id}_${date}`;
            const saved = governanceMeetings.find(
              (meeting) => meeting.id === id
            );
            if (saved) return { schedule, kind, meeting: saved };
            const meeting: GovernanceMeeting & { virtual: true } = {
              id,
              virtual: true,
              source: "recurring",
              scheduleId: schedule.id,
              occurrenceDate: date,
              title: schedule.title,
              status: "pending",
              withName: schedule.withName,
              meetingDate: date,
              dueDate: "",
              discussion: "",
              challenges: [],
              requests: "",
              relatedFeatureIds: [],
              createdFeatureIds: [],
              createdBy: schedule.createdBy || "system",
              createdByName: schedule.createdByName || "Recurring schedule",
            };
            return { schedule, kind, meeting };
          })
        )
        .filter(Boolean) as {
        schedule: GovernanceMeetingSchedule;
        kind: "latest" | "next";
        meeting: GovernanceMeeting & { virtual?: boolean };
      }[],
    [schedules, governanceMeetings]
  );
  const allGovernanceMeetings = useMemo(
    () => [
      ...governanceMeetings,
      ...recurringOccurrences
        .map((item) => item.meeting)
        .filter((meeting) => meeting.virtual),
    ],
    [governanceMeetings, recurringOccurrences]
  );
  const meetingRows = useMemo(() => {
    const standalone = allGovernanceMeetings
      .filter((meeting) => !personFilter || meeting.withName === personFilter)
      .map((meeting) => ({
        ...meeting,
        featureTitle:
          meeting.relatedFeatureIds
            .map((id) => records.find((r) => r.id === id)?.title)
            .filter(Boolean)
            .join(", ") || "Independent meeting",
      }));
    const legacy = filtered.flatMap((record) =>
      (record.meetings || []).map((meeting) => ({
        ...meeting,
        featureId: record.id,
        featureTitle: record.title,
        legacy: true,
      }))
    );
    return [...standalone, ...legacy];
  }, [filtered, allGovernanceMeetings, personFilter, records]);
  const metrics = {
    total: records.length,
    pipeline: records.filter((r) =>
      ["planned", "in-progress"].includes(r.status)
    ).length,
    pendingMeetings:
      allGovernanceMeetings.filter((m) => m.status === "pending").length +
      records.reduce(
        (n, r) =>
          n + (r.meetings || []).filter((m) => m.status === "pending").length,
        0
      ),
    overdue: records.filter(
      (r) =>
        r.dueDate &&
        dayjs(r.dueDate).isBefore(dayjs(), "day") &&
        r.status !== "released"
    ).length,
  };
  const reportRange = useMemo<FeatureGovernanceReportRange>(() => {
    const today = dayjs();
    const formatRange = (start: Dayjs, end: Dayjs, label: string) => ({
      label: `${label}: ${start.format("DD MMM YYYY")} - ${end.format(
        "DD MMM YYYY"
      )}`,
      startDate: start.format("YYYY-MM-DD"),
      endDate: end.format("YYYY-MM-DD"),
    });

    if (reportPeriod === "week") {
      const monday = today
        .subtract((today.day() + 6) % 7, "day")
        .startOf("day");
      return formatRange(
        monday,
        monday.add(6, "day").endOf("day"),
        "This week"
      );
    }
    if (reportPeriod === "month")
      return formatRange(
        today.startOf("month"),
        today.endOf("month"),
        "This month"
      );
    if (reportPeriod === "quarter") {
      const quarterStart = today
        .month(Math.floor(today.month() / 3) * 3)
        .startOf("month");
      return formatRange(
        quarterStart,
        quarterStart.add(2, "month").endOf("month"),
        "This quarter"
      );
    }
    if (
      reportPeriod === "custom" &&
      customReportRange?.[0] &&
      customReportRange?.[1]
    ) {
      return formatRange(
        customReportRange[0],
        customReportRange[1],
        "Custom period"
      );
    }
    return { label: "All time" };
  }, [customReportRange, reportPeriod]);

  const startCreate = (
    mode: "feature" | "pipeline" | "released" = "feature"
  ) => {
    setEntryMode(mode);
    setFormStep(0);
    setFeatureSections([]);
    setEditing(null);
    form.resetFields();
    setReleaseImages([]);
    form.setFieldsValue({
      type:
        mode === "pipeline"
          ? "pipeline"
          : mode === "released"
          ? "new-feature"
          : "request",
      status:
        mode === "pipeline"
          ? "planned"
          : mode === "released"
          ? "released"
          : "submitted",
      progress: mode === "released" ? 100 : 0,
      roles: [],
      programSpecific: false,
      publishToWhatsNew: false,
      releaseDate: mode === "released" ? dayjs() : undefined,
    });
    setOpen(true);
  };
  const startEdit = (record: FeatureGovernanceRecord) => {
    setEntryMode(
      record.status === "released"
        ? "released"
        : record.type === "pipeline"
        ? "pipeline"
        : "feature"
    );
    setEditing(record);
    setFormStep(0);
    setFeatureSections([]);
    form.setFieldsValue({
      ...record,
      roles: record.audience.roles,
      departmentIds: record.audience.allDepartments
        ? ["ALL"]
        : record.audience.departmentIds,
      branchIds: record.audience.allBranches
        ? ["ALL"]
        : record.audience.branchIds,
      dueDate: record.dueDate ? dayjs(record.dueDate) : undefined,
      completedAt: record.completedAt ? dayjs(record.completedAt) : undefined,
      programSpecific: !!record.programSpecific,
      publishToWhatsNew: !!record.whatsNew?.published,
      releaseHeadline: record.whatsNew?.headline,
      releaseSummary: record.whatsNew?.summary,
      releaseDate: record.whatsNew?.releaseDate
        ? dayjs(record.whatsNew.releaseDate)
        : undefined,
    });
    setReleaseImages(
      (record.whatsNew?.imageUrls || []).map((url, index) => ({
        uid: `existing-${index}`,
        name: `Release image ${index + 1}`,
        status: "done",
        url,
      }))
    );
    setOpen(true);
  };
  // Adding walks every section; editing first asks which sections to change.
  const featureSteps: string[] = editing
    ? [
        "choose",
        ...FEATURE_SECTIONS.map((section) => section.key).filter((key) =>
          featureSections.includes(key)
        ),
      ]
    : ["details", "delivery", "audience"];
  const currentFeatureStep = featureSteps[formStep] || featureSteps[0];
  const onLastFeatureStep = formStep >= featureSteps.length - 1;
  const showFeatureStep = (key: string) => currentFeatureStep === key;
  const nextStep = async () => {
    try {
      await form.validateFields(FEATURE_STEP_FIELDS[currentFeatureStep] || []);
      setFormStep(formStep + 1);
    } catch {
      /* validation messages are shown on the fields */
    }
  };
  const toggleFeatureSection = (key: FeatureSection) =>
    setFeatureSections((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  // Every section stays mounted, so saving validates all of them. If a
  // section that was not picked fails (e.g. an older record missing a
  // field), add it and jump there so the message is visible.
  const saveFeature = async () => {
    try {
      await save();
    } catch (error: any) {
      const field = String(error?.errorFields?.[0]?.name?.[0] || "");
      const section = (
        Object.keys(FEATURE_STEP_FIELDS) as FeatureSection[]
      ).find((key) => FEATURE_STEP_FIELDS[key].includes(field));
      if (!section) return;
      if (editing) {
        const picked = featureSections.includes(section)
          ? featureSections
          : [...featureSections, section];
        setFeatureSections(picked);
        const order = [
          "choose",
          ...FEATURE_SECTIONS.map((item) => item.key).filter((key) =>
            picked.includes(key)
          ),
        ];
        setFormStep(order.indexOf(section));
      } else {
        setFormStep(featureSteps.indexOf(section));
      }
    }
  };
  const startUpdate = (record: FeatureGovernanceRecord) => {
    setUpdating(record);
    updateForm.resetFields();
    updateForm.setFieldsValue({
      atRisk: record.status === "blocked",
      progress: record.progress || 0,
      dueDate: record.dueDate ? dayjs(record.dueDate) : undefined,
    });
  };
  const saveUpdate = async () => {
    if (!updating) return;
    const value = await updateForm.validateFields();
    setSaving(true);
    try {
      const result = resolveCompletion(
        nextUpdateStatus,
        Math.max(value.progress ?? 0, updating.progress || 0),
        null,
        updating.completedAt
      );
      await featureGovernanceService.update(updating.id, {
        ...result,
        dueDate: value.dueDate?.format("YYYY-MM-DD") || null,
      } as any);
      message.success("Progress updated");
      setUpdating(null);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error(error);
      message.error("Could not update the feature");
    } finally {
      setSaving(false);
    }
  };
  const startMeetingUpdate = (item: any) => {
    setMeetingUpdating(item);
    meetingUpdateForm.resetFields();
    meetingUpdateForm.setFieldsValue({
      meetingDate: dayjs(item.meetingDate || item.occurrenceDate || undefined),
      discussion: item.discussion || "",
      dueDate: item.dueDate ? dayjs(item.dueDate) : undefined,
      challenges: [],
    });
  };
  const startNotHeld = (item: any) => {
    setNotHeldMeeting(item);
    notHeldForm.resetFields();
  };
  // A virtual recurring occurrence has no document yet; write it whole.
  const writeMeeting = (item: any, patch: Partial<GovernanceMeeting>) => {
    if (!item.virtual) return governanceMeetingService.update(item.id, patch);
    const { virtual, featureTitle, ...base } = item;
    return governanceMeetingService.upsert(item.id, {
      ...base,
      ...patch,
      createdAt: serverTimestamp(),
    });
  };
  const saveMeetingUpdate = async () => {
    if (!meetingUpdating) return;
    const value = await meetingUpdateForm.validateFields();
    setSaving(true);
    try {
      const added = (value.challenges || [])
        .map((entry: any) => entry?.text?.trim())
        .filter(Boolean)
        .map((text: string, index: number) => ({
          id: `challenge-${Date.now()}-${index}`,
          text,
          status: "open" as const,
        }));
      await writeMeeting(meetingUpdating, {
        status: "held",
        notHeldReason: "",
        meetingDate: value.meetingDate.format("YYYY-MM-DD"),
        discussion: value.discussion?.trim() || "",
        dueDate: value.dueDate?.format("YYYY-MM-DD") || "",
        challenges: [
          ...normalizeChallenges(meetingUpdating.challenges),
          ...added,
        ],
      } as any);
      message.success("Meeting updated");
      setMeetingUpdating(null);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error(error);
      message.error("Could not update the meeting");
    } finally {
      setSaving(false);
    }
  };
  const saveNotHeld = async () => {
    if (!notHeldMeeting) return;
    const value = await notHeldForm.validateFields();
    setSaving(true);
    try {
      await writeMeeting(notHeldMeeting, {
        status: "not-held",
        notHeldReason: value.reason.trim(),
        notHeldAt: dayjs().format("YYYY-MM-DD"),
      } as any);
      message.success("Reason logged");
      setNotHeldMeeting(null);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error(error);
      message.error("Could not log the reason");
    } finally {
      setSaving(false);
    }
  };
  const saveSchedule = async () => {
    const value = await scheduleForm.validateFields();
    setSaving(true);
    try {
      const details = {
        title: value.title.trim(),
        withName: value.withName.trim(),
        frequency: value.frequency,
        time: value.time.format("HH:mm"),
        startDate: value.startDate.format("YYYY-MM-DD"),
        reminderEmail: value.reminderEmail.trim(),
        ...(value.frequency === "monthly"
          ? { dayOfMonth: value.dayOfMonth }
          : { weekday: value.weekday }),
      };
      if (editingSchedule) {
        // Applies from the next occurrence; meetings already recorded keep
        // their own date. Drop the day field the new frequency doesn't use.
        await governanceMeetingScheduleService.update(editingSchedule.id, {
          ...details,
          ...(value.frequency === "monthly"
            ? { weekday: deleteField() }
            : { dayOfMonth: deleteField() }),
        } as any);
      } else {
        await governanceMeetingScheduleService.create({
          ...details,
          active: true,
          createdBy: user.id,
          createdByName: user.name,
        } as any);
      }
      message.success(
        editingSchedule
          ? "Recurring meeting updated"
          : "Recurring meeting scheduled"
      );
      setEditingSchedule(null);
      scheduleForm.resetFields();
      scheduleForm.setFieldsValue(SCHEDULE_DEFAULTS());
      setScheduleView("list");
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error(error);
      message.error("Could not save the schedule");
    } finally {
      setSaving(false);
    }
  };
  const startNewSchedule = () => {
    setEditingSchedule(null);
    scheduleForm.resetFields();
    scheduleForm.setFieldsValue(SCHEDULE_DEFAULTS());
    setScheduleView("form");
  };
  const startEditSchedule = (item: GovernanceMeetingSchedule) => {
    setEditingSchedule(item);
    scheduleForm.resetFields();
    scheduleForm.setFieldsValue({
      ...SCHEDULE_DEFAULTS(),
      title: item.title,
      withName: item.withName,
      frequency: item.frequency,
      weekday: item.weekday ?? 1,
      dayOfMonth: item.dayOfMonth ?? 1,
      time: dayjs(item.time || "09:00", "HH:mm"),
      startDate: dayjs(item.startDate),
      reminderEmail: item.reminderEmail,
    });
    setScheduleView("form");
  };
  const openSchedules = () => {
    startNewSchedule();
    setScheduleView(schedules.length ? "list" : "form");
    setScheduleOpen(true);
  };
  const toggleSchedule = async (item: GovernanceMeetingSchedule) => {
    await governanceMeetingScheduleService.setActive(item.id, !item.active);
    await load();
  };
  const removeSchedule = async (item: GovernanceMeetingSchedule) => {
    await governanceMeetingScheduleService.remove(item.id);
    await load();
  };
  const describeSchedule = (item: GovernanceMeetingSchedule) => {
    const when =
      item.frequency === "monthly"
        ? `Monthly on day ${item.dayOfMonth}`
        : `${item.frequency === "weekly" ? "Weekly" : "Every 2 weeks"} on ${
            WEEKDAYS[item.weekday ?? 1]
          }`;
    return `${when} at ${item.time}`;
  };
  const openAddMeeting = () => {
    meetingForm.resetFields();
    meetingForm.setFieldsValue({
      status: segment === "Meetings" ? "held" : "pending",
      challenges: [],
    });
    setMeetingExtras([]);
    setMeetingStep(0);
    setMeetingOpen(true);
  };
  const toggleMeetingExtra = (key: MeetingExtra) => {
    const adding = !meetingExtras.includes(key);
    setMeetingExtras(
      adding
        ? [...meetingExtras, key]
        : meetingExtras.filter((item) => item !== key)
    );
  };
  const nextMeetingStep = async () => {
    try {
      await meetingForm.validateFields(
        MEETING_STEP_FIELDS[currentMeetingStep] || [],
        { recursive: true }
      );
      setMeetingStep(meetingStep + 1);
    } catch {
      /* validation messages are shown on the fields */
    }
  };
  const addMeeting = async () => {
    const value = await meetingForm.validateFields();
    setSaving(true);
    try {
      // Only the parts picked on the first step are saved.
      const relatedFeatureIds: string[] = meetingExtras.includes("links")
        ? [...(value.relatedFeatureIds || [])]
        : [];
      const createdFeatureIds: string[] = [];
      if (meetingExtras.includes("feature")) {
        const departmentIds = value.featureDepartmentIds || [];
        const branchIds = value.featureBranchIds || [];
        const created = await featureGovernanceService.create({
          programSpecific: !!value.featureProgramSpecific,
          programId:
            value.featureProgramSpecific && !isAllPrograms
              ? activeProgramId || null
              : null,
          appliesToAllPrograms: !!value.featureProgramSpecific && isAllPrograms,
          type: "request",
          title: value.featureTitle.trim(),
          description: value.featureDescription.trim(),
          status: "submitted",
          progress: 0,
          dueDate: value.featureDueDate?.format("YYYY-MM-DD") || null,
          audience: {
            roles: value.featureRoles,
            allDepartments: departmentIds.includes("ALL"),
            departmentIds: departmentIds.filter((id: string) => id !== "ALL"),
            allBranches: branchIds.includes("ALL"),
            branchIds: branchIds.filter((id: string) => id !== "ALL"),
          },
          meetings: [],
          createdBy: user.id,
          createdByName: user.name,
        } as any);
        createdFeatureIds.push(created.id);
        relatedFeatureIds.push(created.id);
      }
      await governanceMeetingService.create({
        title: value.title.trim(),
        status: value.status,
        withName: value.withName.trim(),
        meetingDate: value.meetingDate?.format("YYYY-MM-DD") || "",
        dueDate: value.dueDate?.format("YYYY-MM-DD") || "",
        discussion: value.discussion?.trim() || "",
        challenges: (meetingExtras.includes("challenges")
          ? value.challenges || []
          : []
        )
          .map((item: any) => item?.text?.trim())
          .filter(Boolean)
          .map((text: string, index: number) => ({
            id: `challenge-${Date.now()}-${index}`,
            text,
            status: "open",
          })),
        requests: "",
        relatedFeatureIds,
        createdFeatureIds,
        createdBy: user.id,
        createdByName: user.name,
      });
      message.success("Meeting saved");
      meetingForm.resetFields();
      setMeetingOpen(false);
      await load();
    } catch (error) {
      console.error(error);
      message.error("Could not save the meeting");
    } finally {
      setSaving(false);
    }
  };
  const addDirectChallenge = async () => {
    const value = await directChallengeForm.validateFields();
    setSaving(true);
    try {
      const challengeId = `challenge-${Date.now()}`;
      const relatedFeatureIds = value.relatedFeatureId
        ? [value.relatedFeatureId]
        : [];
      await governanceMeetingService.create({
        source: "direct-challenge",
        title: value.relatedFeatureId
          ? records.find((record) => record.id === value.relatedFeatureId)
              ?.title || "Implementation challenge"
          : "Implementation challenge",
        status: "pending",
        withName: user.name,
        meetingDate: "",
        dueDate: value.dueDate?.format("YYYY-MM-DD") || "",
        discussion: value.context?.trim() || "",
        challenges: [
          { id: challengeId, text: value.challenge.trim(), status: "open" },
        ],
        requests: "",
        relatedFeatureIds,
        createdFeatureIds: [],
        createdBy: user.id,
        createdByName: user.name,
      });
      message.success("Challenge added");
      directChallengeForm.resetFields();
      setDirectChallengeOpen(false);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error(error);
      message.error("Could not add the challenge");
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    const value = await form.validateFields();
    setSaving(true);
    try {
      const departmentIds = value.departmentIds || [];
      const branchIds = value.branchIds || [];
      const { status, progress, completedAt } = resolveCompletion(
        value.status,
        value.progress,
        value.completedAt,
        editing?.completedAt
      );
      const imageUrls = await Promise.all(
        releaseImages.map(async (file, index) => {
          if (file.url && !file.originFileObj) return file.url;
          const rawFile = file.originFileObj as File | undefined;
          if (!rawFile) return "";
          const safeName = rawFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const destination = storageRef(
            storage,
            `feature-releases/${
              editing?.id || "new"
            }/${Date.now()}_${index}_${safeName}`
          );
          await uploadBytes(destination, rawFile);
          return getDownloadURL(destination);
        })
      );
      const publishRelease = status === "released" && !!value.publishToWhatsNew;
      const payload: any = {
        programSpecific: !!value.programSpecific,
        programId:
          value.programSpecific && !isAllPrograms
            ? activeProgramId || null
            : null,
        appliesToAllPrograms: !!value.programSpecific && isAllPrograms,
        type: value.type,
        ...(entryMode === "pipeline"
          ? (() => {
              const requestedByName =
                value.category === "requested"
                  ? String(value.requestedByName || "").trim()
                  : "";
              const match = userDirectory.find(
                (item) =>
                  item.name.toLowerCase() === requestedByName.toLowerCase()
              );
              return {
                category: value.category,
                requestedByName,
                requestedById: match?.id || null,
              };
            })()
          : {}),
        title: value.title.trim(),
        description: value.description.trim(),
        status,
        progress,
        completedAt,
        dueDate: value.dueDate
          ? value.dueDate.format("YYYY-MM-DD")
          : editing?.dueDate || null,
        audience: {
          roles: value.roles,
          allDepartments: departmentIds.includes("ALL"),
          departmentIds: departmentIds.filter((id: string) => id !== "ALL"),
          allBranches: branchIds.includes("ALL"),
          branchIds: branchIds.filter((id: string) => id !== "ALL"),
        },
        meetings: editing?.meetings || [],
        whatsNew: {
          published: publishRelease,
          headline: value.releaseHeadline?.trim() || value.title.trim(),
          summary: value.releaseSummary?.trim() || value.description.trim(),
          releaseDate:
            value.releaseDate?.format("YYYY-MM-DD") ||
            value.dueDate?.format("YYYY-MM-DD") ||
            dayjs().format("YYYY-MM-DD"),
          imageUrls: imageUrls.filter(Boolean),
        },
        createdBy: editing?.createdBy || user.id,
        createdByName: editing?.createdByName || user.name,
      };
      if (editing) await featureGovernanceService.update(editing.id, payload);
      else await featureGovernanceService.create(payload);
      message.success(
        editing ? "Feature record updated" : "Feature record created"
      );
      setOpen(false);
      setReleaseImages([]);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error(error);
      message.error("Could not save the feature record");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await featureGovernanceService.remove(id);
      message.success("Record deleted");
      await load();
    } catch {
      message.error("Could not delete record");
    }
  };
  const resolveChallenge = async () => {
    if (!challengeToResolve) return;
    setSaving(true);
    try {
      const meeting = governanceMeetings.find(
        (item) => item.id === challengeToResolve.meetingId
      );
      if (!meeting) throw new Error("Meeting not found");
      const challenges = normalizeChallenges(meeting.challenges).map((item) =>
        item.id === challengeToResolve.id
          ? {
              ...item,
              status: "resolved" as const,
              resolution: resolution.trim() || undefined,
              resolvedAt: dayjs().format("YYYY-MM-DD"),
              resolvedBy: user.name,
            }
          : item
      );
      await governanceMeetingService.updateChallenges(meeting.id, challenges);
      message.success("Challenge closed out");
      setChallengeToResolve(null);
      setResolution("");
      await load();
    } catch (error) {
      console.error(error);
      message.error("Could not close out the challenge");
    } finally {
      setSaving(false);
    }
  };
  const generate = async () => {
    const exportMeetings = governanceMeetings.filter(
      (meeting) => !personFilter || meeting.withName === personFilter
    );
    if (!filtered.length && !exportMeetings.length)
      return message.info("There are no records in the current view");
    if (
      reportPeriod === "custom" &&
      (!customReportRange?.[0] || !customReportRange?.[1])
    )
      return message.info("Select a custom report date range first");
    try {
      await generateFeatureGovernancePptx(
        filtered,
        {
          departments: Object.fromEntries(
            departments.map((d) => [d.id, d.name])
          ),
          branches: Object.fromEntries(branches.map((b) => [b.id, b.name])),
        },
        exportMeetings,
        reportRange
      );
      message.success("PowerPoint generated");
    } catch (error) {
      console.error(error);
      message.error("Could not generate the PowerPoint");
    }
  };

  const columns: any[] = [
    {
      title: "Feature",
      key: "feature",
      render: (_: any, r: FeatureGovernanceRecord) => (
        <Space direction="vertical" size={1}>
          <Text strong>{r.title}</Text>
          <Text type="secondary">
            {r.status === "released"
              ? "Completed feature"
              : "Feature in delivery"}
          </Text>
        </Space>
      ),
    },
    {
      title: "Scope",
      key: "scope",
      render: (_: any, r: FeatureGovernanceRecord) =>
        r.programSpecific ? (
          <Tag color="blue">
            {r.appliesToAllPrograms ? "All programs" : "Current program"}
          </Tag>
        ) : (
          <Tag>System-wide</Tag>
        ),
    },
    {
      title: "Audience",
      key: "audience",
      render: (_: any, r: FeatureGovernanceRecord) => (
        <Space wrap>
          {uniqueRoleLabels(r.audience.roles)
            .slice(0, 3)
            .map((label) => (
              <Tag key={label}>{label}</Tag>
            ))}
          {uniqueRoleLabels(r.audience.roles).length > 3 && (
            <Tag>+{uniqueRoleLabels(r.audience.roles).length - 3}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: "Progress",
      dataIndex: "progress",
      width: 170,
      render: (value: number) => (
        <Progress percent={value} size="small" strokeColor="#814DFF" />
      ),
    },
    {
      title: "Delivery status",
      dataIndex: "status",
      render: (value: string) => (
        <Tag
          color={
            value === "blocked"
              ? "red"
              : value === "released"
              ? "green"
              : value === "in-progress"
              ? "blue"
              : "purple"
          }
        >
          {{
            submitted: "Under review",
            planned: "Planned",
            "in-progress": "In progress",
            blocked: "At risk",
            "awaiting-meeting": "Completed - meeting pending",
            released: "Completed",
          }[value] || value}
        </Tag>
      ),
    },
    {
      title: "Due / Completed",
      key: "dueDate",
      render: (_: any, r: FeatureGovernanceRecord) => {
        const value =
          r.status === "released" ? r.completedAt || r.dueDate : r.dueDate;
        return value ? dayjs(value).format("DD MMM YYYY") : "—";
      },
    },
    {
      title: "Meetings",
      key: "meetings",
      render: (_: any, r: FeatureGovernanceRecord) =>
        `${
          (r.meetings || []).filter((m) => m.status === "held").length
        } held / ${
          (r.meetings || []).filter((m) => m.status === "pending").length
        } pending`,
    },
    {
      title: "",
      key: "actions",
      width: 90,
      render: (_: any, r: FeatureGovernanceRecord) => (
        <Space>
          {r.status !== "released" && (
            <Button
              shape="round"
              type="text"
              title="Update progress"
              icon={<RocketOutlined />}
              onClick={() => startUpdate(r)}
            />
          )}
          <Button
            shape="round"
            type="text"
            title="Edit details"
            icon={<EditOutlined />}
            onClick={() => startEdit(r)}
          />
          <Popconfirm
            title="Delete this record?"
            onConfirm={() => remove(r.id)}
            okButtonProps={{ shape: "round" }}
            cancelButtonProps={{ shape: "round" }}
          >
            <Button
              shape="round"
              danger
              type="text"
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const meetingColumns: any[] = [
    {
      title: "Meeting",
      key: "meeting",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.title}</Text>
          <Text type="secondary">{r.featureTitle}</Text>
        </Space>
      ),
    },
    { title: "With", dataIndex: "withName" },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string) => (
        <Tag color={value === "held" ? "green" : "gold"}>{value}</Tag>
      ),
    },
    {
      title: "Meeting date",
      dataIndex: "meetingDate",
      render: (value?: string) =>
        value ? dayjs(value).format("DD MMM YYYY") : "—",
    },
    {
      title: "Follow-up due",
      dataIndex: "dueDate",
      render: (value?: string) =>
        value ? dayjs(value).format("DD MMM YYYY") : "—",
    },
    {
      title: "Challenges",
      dataIndex: "challenges",
      ellipsis: true,
      render: (value?: string) => value || "—",
    },
    {
      title: "",
      width: 55,
      render: (_: any, r: any) => (
        <Button
          shape="round"
          type="text"
          icon={<EyeOutlined />}
          onClick={() => setSelectedMeeting(r)}
        />
      ),
    },
  ];
  const challengeRows = useMemo(
    () =>
      governanceMeetings.flatMap((meeting) =>
        normalizeChallenges(meeting.challenges).map((challenge) => ({
          ...challenge,
          challenge: challenge.text,
          id: `${meeting.id}-${challenge.id}`,
          challengeId: challenge.id,
          meetingId: meeting.id,
          meeting: meeting.title,
          source: meeting.source,
          withName: meeting.withName,
          dueDate: meeting.dueDate,
        }))
      ),
    [governanceMeetings]
  );
  const challengeColumns: any[] = [
    { title: "Challenge", dataIndex: "challenge" },
    { title: "Meeting", dataIndex: "meeting" },
    { title: "Raised with", dataIndex: "withName" },
    {
      title: "Follow-up due",
      dataIndex: "dueDate",
      render: (value?: string) =>
        value ? dayjs(value).format("DD MMM YYYY") : "No due date",
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: GovernanceChallenge["status"]) => (
        <Tag color={value === "resolved" ? "green" : "gold"}>
          {value === "resolved" ? "Resolved" : "Open"}
        </Tag>
      ),
    },
    {
      title: "Resolution",
      dataIndex: "resolution",
      render: (value?: string) => value || "—",
    },
    {
      title: "",
      key: "actions",
      render: (_: any, row: any) =>
        row.status === "resolved" ? (
          <Text type="secondary">
            Closed{" "}
            {row.resolvedAt ? dayjs(row.resolvedAt).format("DD MMM YYYY") : ""}
          </Text>
        ) : (
          <Button
            shape="round"
            size="small"
            onClick={() => {
              setChallengeToResolve({
                id: row.challengeId,
                text: row.text,
                status: row.status,
                meetingId: row.meetingId,
              });
              setResolution("");
            }}
          >
            Close out
          </Button>
        ),
    },
  ];
  const workspaceItems = useMemo<GovernanceWorkspaceItem[]>(() => {
    if (segment === "Meetings") {
      return meetingRows
        .filter(
          (item: any) =>
            item.status !== "pending" || item.source === "recurring"
        )
        .map((item: any) => ({
          id: `meeting-${item.featureId || "standalone"}-${item.id}`,
          kind: "meeting" as const,
          title: item.title,
          subtitle: item.withName || "Meeting",
          date: item.meetingDate || item.dueDate,
          status: item.status,
          data: item,
        }));
    }
    if (segment === "Challenges") {
      return challengeRows.map((item: any) => ({
        id: `challenge-${item.id}`,
        kind: "challenge" as const,
        title: item.challenge,
        subtitle:
          item.source === "direct-challenge"
            ? "Direct implementation challenge"
            : item.meeting,
        date: item.dueDate,
        status: item.status,
        data: item,
      }));
    }
    return filtered
      .filter((item) =>
        segment === "Pipeline"
          ? item.status !== "released"
          : item.status === "released"
      )
      .map((item) => ({
        id: `feature-${item.id}`,
        kind: "feature" as const,
        title: item.title,
        subtitle:
          item.status === "released"
            ? "Completed feature"
            : "Feature in delivery",
        date:
          item.status === "released"
            ? item.completedAt || item.dueDate
            : item.dueDate,
        status: item.status,
        data: item,
      }));
  }, [challengeRows, filtered, meetingRows, segment]);
  // The metric cards double as the register switcher, so each count matches
  // exactly what that register lists.
  const registerMeetings = meetingRows.filter(
    (item: any) => item.status !== "pending" || item.source === "recurring"
  ).length;
  const openChallenges = challengeRows.filter(
    (item: any) => item.status !== "resolved"
  ).length;
  const registerMetric = (
    key: string,
    value: number,
    subtitle: string,
    icon: React.ReactElement,
    color: string,
    tone: MetricTone
  ): DashboardMetric => ({
    key,
    title: key,
    value,
    subtitle,
    icon,
    tone,
    important: true,
    onClick: () => setSegment(key),
    wrapperStyle:
      segment === key
        ? {
            outline: `2px solid ${color}`,
            outlineOffset: 0,
            borderRadius: 14,
          }
        : undefined,
  });
  const registerMetrics: DashboardMetric[] = [
    registerMetric(
      "Meetings",
      registerMeetings,
      `${metrics.pendingMeetings} pending`,
      <CalendarOutlined />,
      "#1A98FF",
      "info"
    ),
    registerMetric(
      "Pipeline",
      filtered.filter((item) => item.status !== "released").length,
      metrics.overdue ? `${metrics.overdue} overdue` : "None overdue",
      <RocketOutlined />,
      "#243FFF",
      "accent"
    ),
    registerMetric(
      "Completed",
      filtered.filter((item) => item.status === "released").length,
      "Released features",
      <CheckCircleOutlined />,
      "#52C41A",
      "success"
    ),
    registerMetric(
      "Challenges",
      challengeRows.length,
      `${openChallenges} open`,
      <WarningOutlined />,
      "#FF1F85",
      "warning"
    ),
  ];
  const selectedWorkspaceItem =
    workspaceItems.find((item) => item.id === selectedWorkspaceItemId) ||
    workspaceItems[0];
  useEffect(() => {
    if (
      workspaceItems.length &&
      !workspaceItems.some((item) => item.id === selectedWorkspaceItemId)
    ) {
      setSelectedWorkspaceItemId(workspaceItems[0].id);
    }
  }, [selectedWorkspaceItemId, workspaceItems]);
  useEffect(() => {
    const meetingId = searchParams.get("confirmMeeting");
    if (!meetingId || loading || !governanceMeetings.length) return;
    const meeting = governanceMeetings.find((item) => item.id === meetingId);
    const answer = searchParams.get("answer");
    setSearchParams({}, { replace: true });
    if (!meeting) {
      message.warning("That meeting could not be found");
      return;
    }
    setSegment("Meetings");
    setSelectedWorkspaceItemId(`meeting-standalone-${meeting.id}`);
    if (meeting.status !== "pending") {
      message.info("This meeting has already been recorded");
      return;
    }
    if (answer === "no") startNotHeld(meeting);
    else startMeetingUpdate(meeting);
  }, [searchParams, governanceMeetings, loading]);
  const filterControls = (
    <Row gutter={[12, 12]}>
      <Col xs={24} lg={10}>
        <Segmented
          block
          value={reportPeriod}
          onChange={(value) => setReportPeriod(value as ReportPeriod)}
          options={[
            { label: "Week", value: "week" },
            { label: "Month", value: "month" },
            { label: "Quarter", value: "quarter" },
            { label: "All", value: "all" },
            { label: "Custom", value: "custom" },
          ]}
        />
      </Col>
      {reportPeriod === "custom" && (
        <Col xs={24} sm={12} lg={5}>
          <RangePicker
            value={customReportRange}
            onChange={(value) => setCustomReportRange(value)}
            style={{ width: "100%" }}
          />
        </Col>
      )}
      <Col xs={12} lg={reportPeriod === "custom" ? 3 : 4}>
        <Button
          block
          shape="round"
          icon={<FilePptOutlined />}
          onClick={generate}
        >
          Report
        </Button>
      </Col>
      <Col xs={12} lg={reportPeriod === "custom" ? 3 : 4}>
        <Button
          block
          shape="round"
          type="primary"
          icon={<PlayCircleOutlined />}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setPlayerOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
            setPlayerOpen(true);
          }}
        >
          Play
        </Button>
      </Col>
      {segment === "Meetings" && (
        <Col xs={12} lg={3}>
          <Button
            block
            shape="round"
            icon={<SyncOutlined />}
            onClick={openSchedules}
          >
            Recurring
          </Button>
        </Col>
      )}
      <Col
        xs={segment === "Meetings" ? 12 : 24}
        lg={segment === "Meetings" ? 3 : reportPeriod === "custom" ? 4 : 6}
      >
        {segment === "Meetings" ? (
          <Button
            block
            shape="round"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAddMeeting}
          >
            Add meeting
          </Button>
        ) : segment === "Challenges" ? (
          <Button
            block
            shape="round"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              directChallengeForm.resetFields();
              setDirectChallengeOpen(true);
            }}
          >
            Add challenge
          </Button>
        ) : segment === "Pipeline" ? (
          <Button
            block
            shape="round"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => startCreate("pipeline")}
          >
            Add pipeline feature
          </Button>
        ) : null}
      </Col>
    </Row>
  );

  if (!identityLoading && user?.role !== "system_admin")
    return (
      <Empty description="Only system administrators can manage feature governance." />
    );
  return (
    <div style={{ padding: "24px", minHeight: "100vh" }}>
      <MetricsGrid metrics={registerMetrics} />
      <DashboardFilterBar style={{ marginTop: 16, marginBottom: 0 }}>
        {filterControls}
      </DashboardFilterBar>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={9} xl={8}>
          <div style={workspacePanel}>
            <div
              style={{
                padding: 16,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={`Search ${segment.toLowerCase()}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div style={{ maxHeight: "62vh", overflowY: "auto", padding: 10 }}>
              {loading ? (
                <Text type="secondary">Loading register…</Text>
              ) : workspaceItems.length ? (
                workspaceItems.map((item) => {
                  const selected = item.id === selectedWorkspaceItem?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedWorkspaceItemId(item.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: `1px solid ${
                          selected
                            ? token.colorPrimary
                            : token.colorBorderSecondary
                        }`,
                        borderRadius: 12,
                        background: selected
                          ? isDark
                            ? "rgba(129,77,255,.22)"
                            : "#f5f0ff"
                          : token.colorBgContainer,
                        color: token.colorText,
                        fontFamily: "inherit",
                        padding: 14,
                        marginBottom: 8,
                        cursor: "pointer",
                      }}
                    >
                      <Space
                        direction="vertical"
                        size={5}
                        style={{ width: "100%" }}
                      >
                        <Text strong ellipsis={{ tooltip: item.title }}>
                          {item.title}
                        </Text>
                        <Text type="secondary" ellipsis>
                          {item.subtitle}
                        </Text>
                        <Space wrap size={6}>
                          <Tag
                            color={
                              item.status === "resolved" ||
                              item.status === "released" ||
                              item.status === "held"
                                ? "green"
                                : item.status === "blocked" ||
                                  item.status === "not-held"
                                ? "red"
                                : "gold"
                            }
                          >
                            {{
                              held: "Held",
                              "not-held": "Not held",
                              pending: "Upcoming",
                              released: "Completed",
                              resolved: "Resolved",
                              open: "Open",
                              planned: "Planned",
                              "in-progress": "In progress",
                              submitted: "Under review",
                              blocked: "At risk",
                              "awaiting-meeting": "Completed - meeting pending",
                            }[item.status] || item.status}
                          </Tag>
                          {item.date && (
                            <Text type="secondary">
                              <CalendarOutlined />{" "}
                              {dayjs(item.date).format("DD MMM YYYY")}
                            </Text>
                          )}
                        </Space>
                      </Space>
                    </button>
                  );
                })
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={`No ${segment.toLowerCase()} found`}
                />
              )}
            </div>
          </div>
        </Col>
        <Col xs={24} lg={15} xl={16}>
          <div style={{ ...workspacePanel, minHeight: "68vh", padding: 20 }}>
            {!selectedWorkspaceItem ? (
              <Empty
                description="Select an item to see its details"
                style={{ marginTop: 120 }}
              />
            ) : (
              <>
                <Row gutter={[16, 16]} align="middle" justify="space-between">
                  <Col flex="auto">
                    <Space direction="vertical" size={3}>
                      <Text type="secondary">
                        {selectedWorkspaceItem.kind === "feature"
                          ? "Feature governance"
                          : selectedWorkspaceItem.kind === "meeting"
                          ? "Meeting record"
                          : "Challenge register"}
                      </Text>
                      <Title level={3} style={{ margin: 0 }}>
                        {selectedWorkspaceItem.title}
                      </Title>
                    </Space>
                  </Col>
                  <Col>
                    <Tag
                      color={
                        selectedWorkspaceItem.status === "resolved" ||
                        selectedWorkspaceItem.status === "released" ||
                        selectedWorkspaceItem.status === "held"
                          ? "green"
                          : selectedWorkspaceItem.status === "blocked" ||
                            selectedWorkspaceItem.status === "not-held"
                          ? "red"
                          : "gold"
                      }
                    >
                      {{
                        held: "Held",
                        "not-held": "Not held",
                        pending: "Upcoming",
                        released: "Completed",
                        resolved: "Resolved",
                        open: "Open",
                        planned: "Planned",
                        "in-progress": "In progress",
                        submitted: "Under review",
                        blocked: "At risk",
                        "awaiting-meeting": "Completed - meeting pending",
                      }[selectedWorkspaceItem.status] ||
                        selectedWorkspaceItem.status}
                    </Tag>
                  </Col>
                </Row>
                <Divider style={{ margin: "16px 0" }} />

                {selectedWorkspaceItem.kind === "feature" &&
                  (() => {
                    const item =
                      selectedWorkspaceItem.data as FeatureGovernanceRecord;
                    return (
                      <>
                        <Row gutter={[12, 12]}>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Space>
                                <ClockCircleOutlined
                                  style={{ color: "#814DFF" }}
                                />
                                <div>
                                  <Text type="secondary">
                                    {item.status === "released"
                                      ? "Completed at"
                                      : "Target date"}
                                  </Text>
                                  <br />
                                  <Text strong>
                                    {(
                                      item.status === "released"
                                        ? item.completedAt || item.dueDate
                                        : item.dueDate
                                    )
                                      ? dayjs(
                                          item.status === "released"
                                            ? item.completedAt || item.dueDate
                                            : item.dueDate
                                        ).format("DD MMM YYYY")
                                      : "Not set"}
                                  </Text>
                                </div>
                              </Space>
                            </div>
                          </Col>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Space>
                                <FlagOutlined style={{ color: "#243FFF" }} />
                                <div>
                                  <Text type="secondary">Scope</Text>
                                  <br />
                                  <Text strong>
                                    {item.programSpecific
                                      ? item.appliesToAllPrograms
                                        ? "All programs"
                                        : "Selected program"
                                      : "System-wide"}
                                  </Text>
                                </div>
                              </Space>
                            </div>
                          </Col>
                        </Row>
                        {item.status === "awaiting-meeting" && (
                          <div style={{ ...sunkenPanel, marginTop: 12 }}>
                            <Text strong>Awaiting meeting with requestee</Text>
                            <br />
                            <Text type="secondary">
                              Delivery is done. Use Update to mark it completed
                              once the meeting has been held.
                            </Text>
                          </div>
                        )}
                        <div style={{ ...sunkenPanel, marginTop: 12 }}>
                          <Text type="secondary">Delivery progress</Text>
                          <Progress
                            percent={item.progress}
                            strokeColor="#814DFF"
                            style={{ marginTop: 8 }}
                          />
                        </div>
                        <div style={{ marginTop: 18 }}>
                          <Text type="secondary">Delivery description</Text>
                          <div style={{ marginTop: 6 }}>
                            <Text>{item.description}</Text>
                          </div>
                        </div>
                        <div style={{ marginTop: 18 }}>
                          <Text type="secondary">Affected users</Text>
                          <div style={{ marginTop: 8 }}>
                            <Space wrap>
                              {uniqueRoleLabels(item.audience.roles).map(
                                (label) => (
                                  <Tag key={label}>{label}</Tag>
                                )
                              )}
                            </Space>
                          </div>
                        </div>
                        {(item.audience.allDepartments ||
                          item.audience.departmentIds?.length > 0) && (
                          <div style={{ marginTop: 18 }}>
                            <Text type="secondary">Affected departments</Text>
                            <div style={{ marginTop: 8 }}>
                              <Space wrap>
                                {item.audience.allDepartments ? (
                                  <Tag>All departments</Tag>
                                ) : (
                                  Array.from(
                                    new Set(
                                      item.audience.departmentIds.map(
                                        (id: string) =>
                                          departments.find((d) => d.id === id)
                                            ?.name || id
                                      )
                                    )
                                  ).map((name) => (
                                    <Tag key={String(name)}>{String(name)}</Tag>
                                  ))
                                )}
                              </Space>
                            </div>
                          </div>
                        )}
                        <Row gutter={[12, 12]} style={{ marginTop: 22 }}>
                          {item.status !== "released" && (
                            <Col xs={24} sm={8}>
                              <Button
                                block
                                shape="round"
                                type="primary"
                                icon={<RocketOutlined />}
                                onClick={() => startUpdate(item)}
                              >
                                Update
                              </Button>
                            </Col>
                          )}
                          <Col xs={24} sm={item.status !== "released" ? 8 : 12}>
                            <Button
                              block
                              shape="round"
                              icon={<EditOutlined />}
                              onClick={() => startEdit(item)}
                            >
                              Edit
                            </Button>
                          </Col>
                          <Col xs={24} sm={item.status !== "released" ? 8 : 12}>
                            <Popconfirm
                              title="Delete this record?"
                              onConfirm={() => remove(item.id)}
                              okButtonProps={{ shape: "round" }}
                              cancelButtonProps={{ shape: "round" }}
                            >
                              <Button
                                block
                                shape="round"
                                danger
                                icon={<DeleteOutlined />}
                              >
                                Delete
                              </Button>
                            </Popconfirm>
                          </Col>
                        </Row>
                      </>
                    );
                  })()}

                {selectedWorkspaceItem.kind === "meeting" &&
                  (() => {
                    const item = selectedWorkspaceItem.data as any;
                    const challenges = normalizeChallenges(item.challenges);
                    return (
                      <>
                        <Row gutter={[12, 12]}>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Space>
                                <UserOutlined style={{ color: "#814DFF" }} />
                                <div>
                                  <Text type="secondary">Meeting with</Text>
                                  <br />
                                  <Text strong>{item.withName}</Text>
                                </div>
                              </Space>
                            </div>
                          </Col>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Space>
                                <CalendarOutlined
                                  style={{ color: "#243FFF" }}
                                />
                                <div>
                                  <Text type="secondary">Meeting date</Text>
                                  <br />
                                  <Text strong>
                                    {item.meetingDate
                                      ? dayjs(item.meetingDate).format(
                                          "DD MMM YYYY"
                                        )
                                      : "Not set"}
                                  </Text>
                                </div>
                              </Space>
                            </div>
                          </Col>
                        </Row>
                        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Text type="secondary">Follow-up due</Text>
                              <br />
                              <Text strong>
                                {item.dueDate
                                  ? dayjs(item.dueDate).format("DD MMM YYYY")
                                  : "Not set"}
                              </Text>
                            </div>
                          </Col>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Text type="secondary">Related feature</Text>
                              <br />
                              <Text strong>
                                {item.featureTitle || "Independent meeting"}
                              </Text>
                            </div>
                          </Col>
                        </Row>
                        {item.status === "not-held" && (
                          <div style={{ marginTop: 18 }}>
                            <Text type="secondary">
                              Why the meeting was not held
                            </Text>
                            <div style={{ ...sunkenPanel, marginTop: 6 }}>
                              <Text>{item.notHeldReason}</Text>
                              {item.notHeldAt && (
                                <>
                                  <br />
                                  <Text type="secondary">
                                    Logged{" "}
                                    {dayjs(item.notHeldAt).format(
                                      "DD MMM YYYY"
                                    )}
                                  </Text>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                        {item.status === "pending" &&
                          item.source === "recurring" &&
                          dayjs(item.occurrenceDate).isAfter(
                            dayjs(),
                            "day"
                          ) && (
                            <Text
                              type="secondary"
                              style={{ display: "block", marginTop: 18 }}
                            >
                              Upcoming ·{" "}
                              {dayjs(item.occurrenceDate).format("dddd D MMM")}.
                              You can record it from that day.
                            </Text>
                          )}
                        {item.status !== "held" &&
                          !item.featureId &&
                          !(
                            item.status === "pending" &&
                            item.source === "recurring" &&
                            dayjs(item.occurrenceDate).isAfter(dayjs(), "day")
                          ) && (
                            <Row gutter={[12, 12]} style={{ marginTop: 18 }}>
                              <Col xs={24} sm={12}>
                                <Button
                                  block
                                  shape="round"
                                  type="primary"
                                  icon={<CheckCircleOutlined />}
                                  onClick={() => startMeetingUpdate(item)}
                                >
                                  Meeting was held - update
                                </Button>
                              </Col>
                              {item.status === "pending" && (
                                <Col xs={24} sm={12}>
                                  <Button
                                    block
                                    shape="round"
                                    danger
                                    onClick={() => startNotHeld(item)}
                                  >
                                    Meeting was not held
                                  </Button>
                                </Col>
                              )}
                            </Row>
                          )}
                        <div style={{ marginTop: 18 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <Text type="secondary">What was discussed</Text>
                            {item.status === "held" && !item.featureId && (
                              <Tooltip title="Edit what was discussed">
                                <Button
                                  shape="circle"
                                  size="small"
                                  icon={<EditOutlined />}
                                  aria-label="Edit what was discussed"
                                  onClick={() => startMeetingUpdate(item)}
                                />
                              </Tooltip>
                            )}
                          </div>
                          <div style={{ ...sunkenPanel, marginTop: 6 }}>
                            <DiscussionText
                              text={item.discussion}
                              empty="No discussion recorded"
                            />
                          </div>
                        </div>
                        {challenges.length > 0 && (
                          <div style={{ marginTop: 18 }}>
                            <Text type="secondary">Challenges raised</Text>
                            <div style={{ marginTop: 8 }}>
                              <Space
                                direction="vertical"
                                style={{ width: "100%" }}
                              >
                                {challenges.map((challenge) => (
                                  <div
                                    key={challenge.id}
                                    style={{ ...sunkenPanel, padding: 10 }}
                                  >
                                    <Space>
                                      <CheckCircleOutlined
                                        style={{
                                          color:
                                            challenge.status === "resolved"
                                              ? "#52c41a"
                                              : "#faad14",
                                        }}
                                      />
                                      <Text>{challenge.text}</Text>
                                      <Tag
                                        color={
                                          challenge.status === "resolved"
                                            ? "green"
                                            : "gold"
                                        }
                                      >
                                        {challenge.status === "resolved"
                                          ? "Resolved"
                                          : "Open"}
                                      </Tag>
                                    </Space>
                                  </div>
                                ))}
                              </Space>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                {selectedWorkspaceItem.kind === "challenge" &&
                  (() => {
                    const item = selectedWorkspaceItem.data as any;
                    return (
                      <>
                        <Row gutter={[12, 12]}>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Space>
                                <UserOutlined style={{ color: "#814DFF" }} />
                                <div>
                                  <Text type="secondary">Raised with</Text>
                                  <br />
                                  <Text strong>{item.withName}</Text>
                                </div>
                              </Space>
                            </div>
                          </Col>
                          <Col xs={24} sm={12}>
                            <div style={sunkenPanel}>
                              <Space>
                                <CalendarOutlined
                                  style={{ color: "#243FFF" }}
                                />
                                <div>
                                  <Text type="secondary">Follow-up due</Text>
                                  <br />
                                  <Text strong>
                                    {item.dueDate
                                      ? dayjs(item.dueDate).format(
                                          "DD MMM YYYY"
                                        )
                                      : "Not set"}
                                  </Text>
                                </div>
                              </Space>
                            </div>
                          </Col>
                        </Row>
                        <div style={{ ...sunkenPanel, marginTop: 12 }}>
                          <Text type="secondary">
                            {item.source === "direct-challenge"
                              ? "Source"
                              : "Meeting"}
                          </Text>
                          <br />
                          <Text strong>
                            {item.source === "direct-challenge"
                              ? "Directly reported"
                              : item.meeting}
                          </Text>
                        </div>
                        <div style={{ marginTop: 18 }}>
                          <Text type="secondary">Resolution</Text>
                          <div style={{ ...sunkenPanel, marginTop: 6 }}>
                            <Text>
                              {item.resolution ||
                                (item.status === "resolved"
                                  ? "Resolved without notes"
                                  : "This challenge is still open.")}
                            </Text>
                            {item.resolvedAt && (
                              <>
                                <br />
                                <Text type="secondary">
                                  Closed{" "}
                                  {dayjs(item.resolvedAt).format("DD MMM YYYY")}
                                  {item.resolvedBy
                                    ? ` by ${item.resolvedBy}`
                                    : ""}
                                </Text>
                              </>
                            )}
                          </div>
                        </div>
                        {item.status !== "resolved" && (
                          <Row style={{ marginTop: 22 }}>
                            <Col span={24}>
                              <Button
                                block
                                shape="round"
                                type="primary"
                                icon={<CheckCircleOutlined />}
                                onClick={() => {
                                  setChallengeToResolve({
                                    id: item.challengeId,
                                    text: item.text,
                                    status: item.status,
                                    meetingId: item.meetingId,
                                  });
                                  setResolution("");
                                }}
                              >
                                Close out challenge
                              </Button>
                            </Col>
                          </Row>
                        )}
                      </>
                    );
                  })()}
              </>
            )}
          </div>
        </Col>
      </Row>

      <ReportPlayer
        dark={isDark}
        open={playerOpen}
        origin={playerOrigin}
        onClose={() => setPlayerOpen(false)}
        records={filtered}
        meetings={governanceMeetings.filter(
          (meeting) => !personFilter || meeting.withName === personFilter
        )}
        rangeLabel={reportRange.label}
        startDate={reportRange.startDate}
        endDate={reportRange.endDate}
      />
      <Modal
        centered
        width={460}
        open={!!updating}
        title={updating ? `Update: ${updating.title}` : "Update feature"}
        okText="Save update"
        confirmLoading={saving}
        okButtonProps={{ shape: "round", block: true }}
        footer={okOnlyFooter}
        onOk={saveUpdate}
        onCancel={() => setUpdating(null)}
      >
        <Form form={updateForm} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            <ChangeCard
              label="Status"
              icon={<FlagOutlined />}
              from={STATUS_CARDS[updating?.status || "planned"]?.title || "—"}
              to={STATUS_CARDS[nextUpdateStatus]?.title || "—"}
            />
            <ChangeCard
              label="Progress"
              icon={<RocketOutlined />}
              from={`${updating?.progress || 0}%`}
              to={`${updateProgress}%`}
            />
          </div>
          <Form.Item
            name="progress"
            label="Move delivery forward"
            extra={
              (updating?.progress || 0) >= 100
                ? "This feature is already at 100%."
                : undefined
            }
          >
            <Slider
              // Starts at the saved progress, so it can't go backwards.
              min={updating?.progress || 0}
              max={100}
              step={1}
              disabled={(updating?.progress || 0) >= 100}
              tooltip={{ formatter: (value) => `${value}%` }}
            />
          </Form.Item>
          {updateProgress < 100 && (
            <Form.Item name="atRisk" label="Is delivery at risk?">
              <ChoiceCards
                options={[
                  {
                    value: false,
                    title: "No",
                    hint: "On track",
                    icon: <CheckCircleOutlined />,
                  },
                  {
                    value: true,
                    title: "Yes",
                    hint: "Blocked or slipping",
                    icon: <WarningOutlined />,
                  },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="dueDate" label="Target completion date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        centered
        width={680}
        open={open}
        onCancel={() => {
          setOpen(false);
          setReleaseImages([]);
        }}
        title={
          <div>
            <div>
              {editing
                ? "Update feature"
                : entryMode === "pipeline"
                ? "Add pipeline feature"
                : entryMode === "released"
                ? "Add completed feature"
                : "Add feature request"}
            </div>
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
              {FEATURE_STEP_TITLES[currentFeatureStep]}
            </Text>
          </div>
        }
        footer={
          <div style={{ display: "flex", gap: 12 }}>
            {formStep > 0 && (
              <Button
                block
                shape="round"
                icon={<ArrowLeftOutlined />}
                onClick={() => setFormStep(formStep - 1)}
              >
                Back
              </Button>
            )}
            {onLastFeatureStep ? (
              <Button
                block
                shape="round"
                type="primary"
                icon={<CheckOutlined />}
                loading={saving}
                disabled={!!editing && featureSteps.length === 1}
                onClick={() => void saveFeature()}
              >
                {editing ? "Save changes" : "Save pipeline feature"}
              </Button>
            ) : (
              <Button
                block
                shape="round"
                type="primary"
                icon={<ArrowRightOutlined />}
                iconPosition="end"
                onClick={() => void nextStep()}
              >
                Next
              </Button>
            )}
          </div>
        }
        destroyOnClose={false}
        styles={{
          body: { maxHeight: "72vh", overflowY: "auto" },
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          {entryMode !== "feature" && (
            <Form.Item name="type" hidden>
              <Input />
            </Form.Item>
          )}

          {editing && (
            <div
              style={{
                display: showFeatureStep("choose") ? undefined : "none",
              }}
            >
              <Text type="secondary">
                Pick the parts of this feature you want to change.
              </Text>
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {FEATURE_SECTIONS.filter(
                  (section) =>
                    section.key !== "release" ||
                    selectedFeatureStatus === "released"
                ).map((section) => {
                  const active = featureSections.includes(section.key);
                  return (
                    <button
                      key={section.key}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => toggleFeatureSection(section.key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 14,
                        border: `1px solid ${
                          active
                            ? token.colorPrimary
                            : token.colorBorderSecondary
                        }`,
                        background: active
                          ? token.colorPrimaryBg
                          : token.colorBgContainer,
                        color: token.colorText,
                        font: "inherit",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          flex: "0 0 auto",
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          fontSize: 17,
                          color: active ? "#fff" : token.colorPrimary,
                          background: active
                            ? token.colorPrimary
                            : token.colorPrimaryBg,
                        }}
                      >
                        {section.icon}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <Text strong style={{ display: "block" }}>
                          {section.title}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {section.hint}
                        </Text>
                      </span>
                      {active && (
                        <CheckCircleFilled
                          style={{ fontSize: 18, color: token.colorPrimary }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            style={{ display: showFeatureStep("details") ? undefined : "none" }}
          >
            <Form.Item
              name="title"
              label="Feature title"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input placeholder="What is changing or being requested?" />
            </Form.Item>
            <Form.Item
              name="description"
              label="Delivery description"
              rules={[{ required: true, whitespace: true }]}
            >
              <TextArea
                rows={4}
                placeholder="Describe the need, value and expected outcome"
              />
            </Form.Item>
            {entryMode === "pipeline" && (
              <>
                <Form.Item
                  name="category"
                  label="Category"
                  rules={[{ required: true, message: "Pick a category" }]}
                >
                  <ChoiceCards
                    options={[
                      {
                        value: "requested",
                        title: "Requested",
                        hint: "Someone asked for it",
                        icon: <UserOutlined />,
                      },
                      {
                        value: "improvement",
                        title: "Improvement",
                        hint: "Raised by the team, no owner",
                        icon: <ToolOutlined />,
                      },
                    ]}
                  />
                </Form.Item>
                {featureCategory === "requested" && (
                  <Form.Item
                    name="requestedByName"
                    label="Requested by"
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: "Who requested this?",
                      },
                    ]}
                  >
                    <AutoComplete
                      placeholder="Start typing a name"
                      filterOption={(input, option) =>
                        String(option?.value || "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      options={userDirectory.map((item) => ({
                        value: item.name,
                        label: (
                          <div>
                            <div>{item.name}</div>
                            {item.email && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {item.email}
                              </Text>
                            )}
                          </div>
                        ),
                      }))}
                    />
                  </Form.Item>
                )}
              </>
            )}
            <Form.Item name="programSpecific" label="Applies to">
              <ChoiceCards
                options={[
                  {
                    value: false,
                    title: "All programs",
                    hint: "System-wide",
                    icon: <AppstoreOutlined />,
                  },
                  {
                    value: true,
                    title: "Current program",
                    hint: `Only ${programScopeLabel}`,
                    icon: <AimOutlined />,
                  },
                ]}
              />
            </Form.Item>
          </div>

          <div
            style={{
              display: showFeatureStep("delivery") ? undefined : "none",
            }}
          >
            {entryMode === "feature" && (
              <Form.Item
                name="type"
                label="Record type"
                rules={[{ required: true }]}
              >
                <ChoiceCards
                  options={[
                    {
                      value: "request",
                      title: "Request",
                      icon: <BulbOutlined />,
                    },
                    {
                      value: "update",
                      title: "Update",
                      icon: <SyncOutlined />,
                    },
                    {
                      value: "new-feature",
                      title: "New feature",
                      icon: <RocketOutlined />,
                    },
                  ]}
                />
              </Form.Item>
            )}
            {entryMode === "released" ? (
              <Form.Item name="status" hidden>
                <Input />
              </Form.Item>
            ) : (
              <Form.Item
                name="status"
                label="Delivery status"
                rules={[{ required: true }]}
              >
                <ChoiceCards
                  columns={2}
                  options={(entryMode === "pipeline"
                    ? ["planned", "in-progress", "blocked", "awaiting-meeting"]
                    : ["submitted", "planned", "in-progress", "blocked"]
                  )
                    // Completing is an update, never part of adding.
                    .concat(
                      editing
                        ? entryMode === "pipeline"
                          ? ["released"]
                          : ["awaiting-meeting", "released"]
                        : []
                    )
                    .map((key) => ({ value: key, ...STATUS_CARDS[key] }))}
                />
              </Form.Item>
            )}
            <Form.Item
              name="progress"
              label={`Delivery progress · ${featureProgress ?? 0}%`}
              extra={
                editing
                  ? "Reaching 100% marks the feature as completed."
                  : undefined
              }
            >
              <Slider
                min={0}
                // A new feature can't start out completed.
                max={editing ? 100 : 95}
                step={5}
                disabled={entryMode === "released"}
                tooltip={{ formatter: (value) => `${value}%` }}
                marks={
                  editing
                    ? { 0: "0%", 50: "50%", 100: "100%" }
                    : { 0: "0%", 50: "50%", 95: "95%" }
                }
              />
            </Form.Item>
            {entryMode === "released" ||
            selectedFeatureStatus === "released" ? (
              <Form.Item name="completedAt" label="Completed at">
                <DatePicker
                  style={{ width: "100%" }}
                  placeholder="Defaults to today"
                />
              </Form.Item>
            ) : (
              <Form.Item name="dueDate" label="Target completion date">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            )}
          </div>

          {selectedFeatureStatus === "released" && (
            <div
              style={{
                display: showFeatureStep("release") ? undefined : "none",
              }}
            >
              <Form.Item
                name="publishToWhatsNew"
                valuePropName="checked"
                style={{ marginBottom: publishToWhatsNew ? 16 : 0 }}
              >
                <Checkbox>
                  <Text strong>
                    Publish this completed feature on What's New
                  </Text>
                  <br />
                  <Text type="secondary">
                    Only the affected users selected below will see this
                    release.
                  </Text>
                </Checkbox>
              </Form.Item>
              {publishToWhatsNew && (
                <>
                  <Form.Item
                    name="releaseHeadline"
                    label="Release headline"
                    rules={[{ required: true, whitespace: true }]}
                  >
                    <Input placeholder="A short, user-friendly headline" />
                  </Form.Item>
                  <Form.Item
                    name="releaseSummary"
                    label="What changed"
                    rules={[{ required: true, whitespace: true }]}
                  >
                    <TextArea
                      rows={4}
                      placeholder="Explain what users can now do and why it is useful."
                    />
                  </Form.Item>
                  <Form.Item
                    name="releaseDate"
                    label="Release date"
                    rules={[{ required: true }]}
                  >
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    label="Screenshots (optional)"
                    extra="Add up to eight images. They will appear in a carousel in the order shown."
                  >
                    <Upload
                      accept="image/*"
                      listType="picture-card"
                      fileList={releaseImages}
                      maxCount={8}
                      multiple
                      beforeUpload={(file) => {
                        if (!file.type.startsWith("image/")) {
                          message.error("Release media must be an image.");
                          return Upload.LIST_IGNORE;
                        }
                        if (file.size > 10 * 1024 * 1024) {
                          message.error(
                            "Each release image must be 10 MB or smaller."
                          );
                          return Upload.LIST_IGNORE;
                        }
                        return false;
                      }}
                      onChange={({ fileList }) => setReleaseImages(fileList)}
                    >
                      {releaseImages.length < 8 && (
                        <div>
                          <PlusOutlined />
                          <div style={{ marginTop: 8 }}>Add image</div>
                        </div>
                      )}
                    </Upload>
                  </Form.Item>
                </>
              )}
            </div>
          )}

          <div
            style={{
              display: showFeatureStep("audience") ? undefined : "none",
            }}
          >
            <Form.Item
              name="roles"
              label="Affected roles"
              rules={[
                {
                  required: true,
                  message: "Select at least one affected role",
                },
              ]}
            >
              <MultiChoiceCards options={roleOptions} />
            </Form.Item>
            {needsDepartments && (
              <Form.Item
                name="departmentIds"
                label="Affected departments"
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  onSelect={(value) => {
                    const current = form.getFieldValue("departmentIds") || [];
                    if (value === "ALL")
                      form.setFieldValue("departmentIds", ["ALL"]);
                    else if (current.includes("ALL"))
                      form.setFieldValue("departmentIds", [value]);
                  }}
                  options={[
                    { value: "ALL", label: "ALL departments" },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: d.name,
                    })),
                  ]}
                />
              </Form.Item>
            )}
            {needsBranches && (
              <Form.Item
                name="branchIds"
                label="Affected centres"
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  onSelect={(value) => {
                    const current = form.getFieldValue("branchIds") || [];
                    if (value === "ALL")
                      form.setFieldValue("branchIds", ["ALL"]);
                    else if (current.includes("ALL"))
                      form.setFieldValue("branchIds", [value]);
                  }}
                  options={[
                    { value: "ALL", label: "ALL centres" },
                    ...branches.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
              </Form.Item>
            )}
          </div>
        </Form>
      </Modal>
      <Modal
        centered
        width={640}
        open={meetingOpen}
        title={
          <div>
            <div>Add meeting</div>
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
              {MEETING_STEP_TITLES[currentMeetingStep]}
            </Text>
          </div>
        }
        onCancel={() => setMeetingOpen(false)}
        destroyOnClose
        footer={
          <div style={{ display: "flex", gap: 12 }}>
            {meetingStep > 0 && (
              <Button
                block
                shape="round"
                icon={<ArrowLeftOutlined />}
                onClick={() => setMeetingStep(meetingStep - 1)}
              >
                Back
              </Button>
            )}
            {onLastMeetingStep ? (
              <Button
                block
                shape="round"
                type="primary"
                icon={<CheckOutlined />}
                loading={saving}
                onClick={() => void addMeeting().catch(() => undefined)}
              >
                Save meeting
              </Button>
            ) : (
              <Button
                block
                shape="round"
                type="primary"
                icon={<ArrowRightOutlined />}
                iconPosition="end"
                onClick={() => void nextMeetingStep()}
              >
                Next
              </Button>
            )}
          </div>
        }
        styles={{
          body: { maxHeight: "68vh", overflowY: "auto", paddingRight: 8 },
        }}
      >
        <Form
          form={meetingForm}
          layout="vertical"
          initialValues={{ status: "pending", challenges: [] }}
          style={{ marginTop: 8 }}
        >
          {/* Every picked step stays mounted (only hidden) so its values are
              kept while moving back and forth. */}
          <div hidden={currentMeetingStep !== "choose"}>
            <Text type="secondary">
              Meeting details are always recorded. Pick anything else that came
              out of this meeting.
            </Text>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {MEETING_EXTRAS.map((extra) => {
                const active = meetingExtras.includes(extra.key);
                return (
                  <button
                    key={extra.key}
                    type="button"
                    role="checkbox"
                    aria-checked={active}
                    onClick={() => toggleMeetingExtra(extra.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: `1px solid ${
                        active ? token.colorPrimary : token.colorBorderSecondary
                      }`,
                      background: active
                        ? token.colorPrimaryBg
                        : token.colorBgContainer,
                      color: token.colorText,
                      font: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        flex: "0 0 auto",
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        fontSize: 17,
                        color: active ? "#fff" : token.colorPrimary,
                        background: active
                          ? token.colorPrimary
                          : token.colorPrimaryBg,
                      }}
                    >
                      {extra.icon}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ display: "block" }}>
                        {extra.title}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {extra.hint}
                      </Text>
                    </span>
                    {active && (
                      <CheckCircleFilled
                        style={{ fontSize: 18, color: token.colorPrimary }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div hidden={currentMeetingStep !== "details"}>
            <Form.Item
              name="title"
              label="Meeting title"
              rules={[{ required: true, message: "Add a meeting title" }]}
            >
              <Input placeholder="e.g. Monthly product review" />
            </Form.Item>
            <Form.Item
              name="withName"
              label="With whom"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input prefix={<UserOutlined />} placeholder="Name" />
            </Form.Item>
            <Form.Item
              name="status"
              label="Meeting status"
              rules={[{ required: true }]}
            >
              <MeetingStatusCards />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="meetingDate" label="Meeting date">
                  <DatePicker
                    disabledDate={isWeekend}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="dueDate" label="Follow-up due date">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="discussion"
              label="What was discussed"
              style={{ marginBottom: 0 }}
            >
              <DiscussionPointsInput />
            </Form.Item>
          </div>

          {meetingExtras.includes("challenges") && (
            <div hidden={currentMeetingStep !== "challenges"}>
              <Text type="secondary">
                Add each challenge raised. They are tracked until closed out.
              </Text>
              <Form.Item
                name="challenges"
                style={{ marginTop: 12, marginBottom: 0 }}
                rules={[
                  {
                    validator: async (_, value) => {
                      if (!(value || []).length)
                        throw new Error("Add at least one challenge");
                    },
                  },
                ]}
              >
                <ChallengePointsInput />
              </Form.Item>
            </div>
          )}

          {createFeatureFromMeeting && (
            <div hidden={currentMeetingStep !== "feature"}>
              <Form.Item
                name="featureTitle"
                label="Feature request title"
                rules={[{ required: true, whitespace: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="featureDescription"
                label="Feature request description"
                rules={[{ required: true, whitespace: true }]}
              >
                <TextArea rows={3} />
              </Form.Item>
              <Form.Item
                name="featureRoles"
                label="Affected roles"
                rules={[{ required: true }]}
              >
                <Select mode="multiple" options={roleOptions} />
              </Form.Item>
              {meetingNeedsDepartments && (
                <Form.Item
                  name="featureDepartmentIds"
                  label="Affected departments"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    onSelect={(value) => {
                      const current =
                        meetingForm.getFieldValue("featureDepartmentIds") || [];
                      if (value === "ALL")
                        meetingForm.setFieldValue("featureDepartmentIds", [
                          "ALL",
                        ]);
                      else if (current.includes("ALL"))
                        meetingForm.setFieldValue("featureDepartmentIds", [
                          value,
                        ]);
                    }}
                    options={[
                      { value: "ALL", label: "ALL departments" },
                      ...departments.map((d) => ({
                        value: d.id,
                        label: d.name,
                      })),
                    ]}
                  />
                </Form.Item>
              )}
              {meetingNeedsBranches && (
                <Form.Item
                  name="featureBranchIds"
                  label="Affected centres"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    onSelect={(value) => {
                      const current =
                        meetingForm.getFieldValue("featureBranchIds") || [];
                      if (value === "ALL")
                        meetingForm.setFieldValue("featureBranchIds", ["ALL"]);
                      else if (current.includes("ALL"))
                        meetingForm.setFieldValue("featureBranchIds", [value]);
                    }}
                    options={[
                      { value: "ALL", label: "ALL centres" },
                      ...branches.map((b) => ({
                        value: b.id,
                        label: b.name,
                      })),
                    ]}
                  />
                </Form.Item>
              )}
              <Form.Item name="featureDueDate" label="Requested due date">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </div>
          )}

          {meetingExtras.includes("links") && (
            <div hidden={currentMeetingStep !== "links"}>
              <Form.Item
                name="relatedFeatureIds"
                label="Features discussed"
                rules={[
                  { required: true, message: "Pick at least one feature" },
                ]}
              >
                <Select
                  mode="multiple"
                  showSearch
                  placeholder="Search features"
                  optionFilterProp="label"
                  options={records.map((record) => ({
                    value: record.id,
                    label: record.title,
                  }))}
                />
              </Form.Item>
            </div>
          )}
        </Form>
      </Modal>
      <Modal
        centered
        open={directChallengeOpen}
        title="Add implementation challenge"
        okText="Add challenge"
        confirmLoading={saving}
        okButtonProps={{ shape: "round", block: true }}
        footer={okOnlyFooter}
        onOk={addDirectChallenge}
        onCancel={() => {
          directChallengeForm.resetFields();
          setDirectChallengeOpen(false);
        }}
        destroyOnClose
      >
        <Form form={directChallengeForm} layout="vertical">
          <Form.Item
            name="challenge"
            label="What is stopping implementation?"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "Describe the challenge",
              },
            ]}
          >
            <TextArea
              rows={4}
              placeholder="Describe the blocker or challenge you have faced"
            />
          </Form.Item>
          <Form.Item name="relatedFeatureId" label="Related feature (optional)">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Choose the feature this affects"
              options={records.map((record) => ({
                value: record.id,
                label: record.title,
              }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label="Follow-up due date (optional)">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="context" label="Context or impact (optional)">
            <TextArea
              rows={3}
              placeholder="Add any useful implementation context"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        centered
        open={!!challengeToResolve}
        title="Close out challenge"
        okText="Close out"
        confirmLoading={saving}
        okButtonProps={{ shape: "round", block: true }}
        footer={okOnlyFooter}
        onOk={resolveChallenge}
        onCancel={() => {
          setChallengeToResolve(null);
          setResolution("");
        }}
        destroyOnClose
      >
        <Text>{challengeToResolve?.text}</Text>
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Resolution notes (optional)">
            <TextArea
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              rows={4}
              placeholder="What resolved the challenge?"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        centered
        open={!!selectedMeeting}
        title={selectedMeeting?.title}
        footer={
          <Button shape="round" onClick={() => setSelectedMeeting(null)}>
            Close
          </Button>
        }
        onCancel={() => setSelectedMeeting(null)}
      >
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Feature">
            {selectedMeeting?.featureTitle}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={selectedMeeting?.status === "held" ? "green" : "gold"}>
              {selectedMeeting?.status}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="With">
            {selectedMeeting?.withName}
          </Descriptions.Item>
          <Descriptions.Item label="Meeting date">
            {selectedMeeting?.meetingDate
              ? dayjs(selectedMeeting.meetingDate).format("DD MMM YYYY")
              : "Not set"}
          </Descriptions.Item>
          <Descriptions.Item label="Follow-up due">
            {selectedMeeting?.dueDate
              ? dayjs(selectedMeeting.dueDate).format("DD MMM YYYY")
              : "Not set"}
          </Descriptions.Item>
          <Descriptions.Item label="Discussed">
            <DiscussionText
              text={selectedMeeting?.discussion}
              empty="None recorded"
            />
          </Descriptions.Item>
          <Descriptions.Item label="Challenges">
            {selectedMeeting?.challenges ? (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {normalizeChallenges(selectedMeeting.challenges).map(
                  (challenge) => (
                    <li key={challenge.id}>
                      {challenge.text}{" "}
                      {challenge.status === "resolved" && (
                        <Tag color="green">Resolved</Tag>
                      )}
                    </li>
                  )
                )}
              </ul>
            ) : (
              "None recorded"
            )}
          </Descriptions.Item>
        </Descriptions>
      </Modal>
      <Modal
        centered
        width={600}
        open={scheduleOpen}
        title={
          scheduleView === "list"
            ? "Recurring meetings"
            : editingSchedule
            ? "Edit recurring meeting"
            : "New recurring meeting"
        }
        onCancel={() => setScheduleOpen(false)}
        footer={
          scheduleView === "list" ? (
            <Button
              block
              shape="round"
              type="primary"
              icon={<PlusOutlined />}
              onClick={startNewSchedule}
            >
              New recurring meeting
            </Button>
          ) : (
            <div style={{ display: "flex", gap: 12 }}>
              {schedules.length > 0 && (
                <Button
                  block
                  shape="round"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => {
                    setEditingSchedule(null);
                    setScheduleView("list");
                  }}
                >
                  Back
                </Button>
              )}
              <Button
                block
                shape="round"
                type="primary"
                icon={<SyncOutlined />}
                loading={saving}
                onClick={() => void saveSchedule().catch(() => undefined)}
              >
                {editingSchedule ? "Save changes" : "Add recurring meeting"}
              </Button>
            </div>
          )
        }
        styles={{
          body: { maxHeight: "70vh", overflowY: "auto", paddingRight: 8 },
        }}
      >
        {scheduleView === "list" ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {schedules.map((item) => (
              <div
                key={item.id}
                style={{
                  ...sunkenPanel,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  opacity: item.active ? 1 : 0.6,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text strong>
                    {item.title} · {item.withName}
                  </Text>
                  <br />
                  <Text type="secondary">
                    {describeSchedule(item)} · {item.reminderEmail}
                  </Text>
                  {(() => {
                    const occurrence = recurringOccurrences.find(
                      (entry) =>
                        entry.schedule.id === item.id && entry.kind === "latest"
                    )?.meeting;
                    const next = item.active ? nextOccurrence(item) : null;
                    const nextLine = next ? (
                      <Text
                        type="secondary"
                        style={{ display: "block", fontSize: 13, marginTop: 6 }}
                      >
                        {occurrence ? "Next" : "First meeting"} ·{" "}
                        {dayjs(next).format("ddd D MMM")} at {item.time}
                      </Text>
                    ) : null;
                    if (!occurrence) return nextLine;
                    const when = dayjs(occurrence.occurrenceDate).format(
                      "ddd D MMM"
                    );
                    const openOccurrence = (answer: "held" | "not-held") => {
                      setScheduleOpen(false);
                      if (answer === "held") startMeetingUpdate(occurrence);
                      else startNotHeld(occurrence);
                    };
                    return (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                            marginTop: 8,
                          }}
                        >
                          <Text style={{ fontSize: 13 }}>Latest · {when}</Text>
                          {occurrence.status === "pending" ? (
                            <>
                              <Button
                                size="small"
                                shape="round"
                                type="primary"
                                icon={<CheckCircleOutlined />}
                                onClick={() => openOccurrence("held")}
                              >
                                Held
                              </Button>
                              <Button
                                size="small"
                                shape="round"
                                danger
                                onClick={() => openOccurrence("not-held")}
                              >
                                Not held
                              </Button>
                            </>
                          ) : (
                            <>
                              <Tag
                                color={
                                  occurrence.status === "held" ? "green" : "red"
                                }
                                style={{
                                  marginInlineEnd: 0,
                                  borderRadius: 999,
                                }}
                              >
                                {occurrence.status === "held"
                                  ? "Held"
                                  : "Not held"}
                              </Tag>
                              {occurrence.status === "held" && (
                                <Button
                                  size="small"
                                  shape="round"
                                  type="link"
                                  icon={<EditOutlined />}
                                  onClick={() => openOccurrence("held")}
                                >
                                  Edit notes
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                        {nextLine}
                      </>
                    );
                  })()}
                </div>
                <Space>
                  <Tooltip title="Edit schedule">
                    <Button
                      size="small"
                      shape="circle"
                      icon={<EditOutlined />}
                      aria-label="Edit schedule"
                      onClick={() => startEditSchedule(item)}
                    />
                  </Tooltip>
                  <Button
                    size="small"
                    shape="round"
                    onClick={() => toggleSchedule(item)}
                  >
                    {item.active ? "Pause" : "Resume"}
                  </Button>
                  <Popconfirm
                    title="Delete this recurring meeting?"
                    onConfirm={() => removeSchedule(item)}
                    okButtonProps={{ shape: "round" }}
                    cancelButtonProps={{ shape: "round" }}
                  >
                    <Button
                      size="small"
                      shape="round"
                      danger
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>
                </Space>
              </div>
            ))}
          </Space>
        ) : (
          <Form
            form={scheduleForm}
            layout="vertical"
            requiredMark={false}
            style={{ marginTop: 8 }}
          >
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="title"
                  label="Meeting title"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder="e.g. Weekly check-in" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="withName"
                  label="Meeting with"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="Name" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="frequency" label="Repeats">
              <Segmented
                block
                options={[
                  { value: "weekly", label: "Weekly" },
                  { value: "biweekly", label: "Every 2 weeks" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </Form.Item>
            {scheduleFrequency === "monthly" ? (
              <Form.Item name="dayOfMonth" label="Day of the month">
                <InputNumber min={1} max={31} style={{ width: "100%" }} />
              </Form.Item>
            ) : (
              <Form.Item name="weekday" label="On">
                <Segmented
                  block
                  options={WEEKDAY_CHIPS}
                />
              </Form.Item>
            )}
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="time"
                  label="Start time"
                  rules={[{ required: true }]}
                >
                  <TimePicker
                    format="HH:mm"
                    minuteStep={15}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="startDate"
                  label="Starting from"
                  rules={[{ required: true }]}
                >
                  <DatePicker
                    disabledDate={isWeekend}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Text
              type="secondary"
              style={{ fontSize: 13, display: "block", marginBottom: 16 }}
            >
              <CalendarOutlined />{" "}
              {scheduleFrequency === "monthly"
                ? `Monthly on day ${scheduleDayOfMonth ?? 1}`
                : `${
                    scheduleFrequency === "weekly"
                      ? "Every week"
                      : "Every 2 weeks"
                  } on ${WEEKDAYS[scheduleWeekday ?? 1]}`}
              {scheduleTime ? ` at ${scheduleTime.format("HH:mm")}` : ""}
              {scheduleStartDate
                ? `, from ${scheduleStartDate.format("D MMM YYYY")}`
                : ""}
            </Text>

            <Form.Item
              name="reminderEmail"
              label="Send reminders to"
              rules={[{ required: true, type: "email" }]}
              extra="Emailed 30 minutes after each meeting starts, asking whether it was held."
              style={{ marginBottom: 0 }}
            >
              <Input prefix={<MailOutlined />} />
            </Form.Item>
          </Form>
        )}
      </Modal>
      <Modal
        centered
        width={640}
        open={!!meetingUpdating}
        title={
          meetingUpdating ? `Update meeting: ${meetingUpdating.title}` : ""
        }
        okText="Save meeting update"
        confirmLoading={saving}
        okButtonProps={{ shape: "round", block: true }}
        footer={okOnlyFooter}
        onOk={saveMeetingUpdate}
        onCancel={() => setMeetingUpdating(null)}
        destroyOnClose
        styles={{
          body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 8 },
        }}
      >
        <Form form={meetingUpdateForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="meetingDate"
                label="Meeting date"
                rules={[{ required: true }]}
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dueDate" label="Follow-up due (optional)">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="discussion" label="What was discussed">
            <DiscussionPointsInput />
          </Form.Item>
          <Form.Item name="challenges" label="Challenges raised">
            <ChallengePointsInput />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        centered
        width={520}
        open={!!notHeldMeeting}
        title={
          notHeldMeeting ? `Meeting not held: ${notHeldMeeting.title}` : ""
        }
        okText="Log reason"
        confirmLoading={saving}
        okButtonProps={{ shape: "round", danger: true, block: true }}
        footer={okOnlyFooter}
        onOk={saveNotHeld}
        onCancel={() => setNotHeldMeeting(null)}
        destroyOnClose
      >
        <Form form={notHeldForm} layout="vertical">
          <Form.Item
            name="reason"
            label="Why was the meeting not held?"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "Please give a reason",
              },
            ]}
          >
            <TextArea
              rows={4}
              placeholder="e.g. Requestee unavailable, rescheduled to next week"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FeatureGovernancePage;
