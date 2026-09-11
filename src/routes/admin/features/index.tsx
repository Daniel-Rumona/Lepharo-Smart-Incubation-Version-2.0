import React, { useEffect, useMemo, useState } from "react";
import {
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
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
  theme,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FlagOutlined,
  FilePptOutlined,
  MinusCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  ProductOutlined,
  RocketOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { collection, getDocs, query, where } from "firebase/firestore";
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
import { featureGovernanceService } from "@/services/featureGovernanceService";
import {
  FeatureGovernanceRecord,
  FeatureMeeting,
  GovernanceChallenge,
  GovernanceMeeting,
} from "@/types/featureGovernance";
import {
  FeatureGovernanceReportRange,
  generateFeatureGovernancePptx,
} from "@/utils/featureGovernancePptx";
import { governanceMeetingService } from "@/services/governanceMeetingService";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { useColorMode } from "@/contexts/ThemeContext";

const { Text, Title } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;
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
const ROLES = [
  "admin",
  "director",
  "operations",
  "headofdepartment",
  "coordinator",
  "projectadmin",
  "receptionist",
  "employee",
  "incubatee",
  "funder",
  "government",
];
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
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
  const createFeatureFromMeeting = Form.useWatch("createFeature", meetingForm);
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
      const [items, savedMeetings, deptSnap, branchSnap] = await Promise.all([
        featureGovernanceService.list(),
        governanceMeetingService.list(),
        getDocs(query(collection(db, "departments"))),
        getDocs(query(collection(db, "branches"))),
      ]);
      setRecords(items);
      setGovernanceMeetings(savedMeetings);
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
  const meetingRows = useMemo(() => {
    const standalone = governanceMeetings
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
  }, [filtered, governanceMeetings, personFilter, records]);
  const metrics = {
    total: records.length,
    pipeline: records.filter((r) =>
      ["planned", "in-progress"].includes(r.status)
    ).length,
    pendingMeetings:
      governanceMeetings.filter((m) => m.status === "pending").length +
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

    if (reportPeriod === "week")
      return formatRange(
        today.startOf("week"),
        today.endOf("week"),
        "This week"
      );
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
  const addMeeting = async () => {
    const value = await meetingForm.validateFields();
    setSaving(true);
    try {
      const relatedFeatureIds: string[] = value.relatedFeatureIds || [];
      const createdFeatureIds: string[] = [];
      if (value.createFeature) {
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
        challenges: (value.challenges || [])
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
      const progress =
        value.status === "released"
          ? 100
          : Math.min(Number(value.progress || 0), 100);
      const status = progress >= 100 ? "released" : value.status;
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
        title: value.title.trim(),
        description: value.description.trim(),
        status,
        progress: status === "released" ? 100 : progress,
        dueDate: value.dueDate?.format("YYYY-MM-DD") || null,
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
          {r.audience.roles.slice(0, 3).map((role) => (
            <Tag key={role}>{roleLabel(role)}</Tag>
          ))}
          {r.audience.roles.length > 3 && (
            <Tag>+{r.audience.roles.length - 3}</Tag>
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
            released: "Completed",
          }[value] || value}
        </Tag>
      ),
    },
    {
      title: "Due",
      dataIndex: "dueDate",
      render: (value?: string) =>
        value ? dayjs(value).format("DD MMM YYYY") : "—",
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
          <Button
            shape="round"
            type="text"
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
        .filter((item) => item.status === "held")
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
        date: item.dueDate,
        status: item.status,
        data: item,
      }));
  }, [challengeRows, filtered, meetingRows, segment]);
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
      <Col xs={24} sm={12} lg={reportPeriod === "custom" ? 4 : 7}>
        <Button
          block
          shape="round"
          icon={<FilePptOutlined />}
          onClick={generate}
        >
          Generate Report
        </Button>
      </Col>
      <Col xs={24} lg={reportPeriod === "custom" ? 5 : 7}>
        {segment === "Meetings" ? (
          <Button
            block
            shape="round"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              meetingForm.resetFields();
              meetingForm.setFieldsValue({
                status: segment === "Meetings" ? "held" : "pending",
                challenges: [],
              });
              setMeetingOpen(true);
            }}
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
        ) : (
          <Button
            block
            shape="round"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => startCreate("released")}
          >
            Add completed feature
          </Button>
        )}
      </Col>
    </Row>
  );

  if (!identityLoading && user?.role !== "admin")
    return (
      <Empty description="Only system administrators can manage feature governance." />
    );
  return (
    <div style={{ padding: "24px", minHeight: "100vh" }}>
      <Row gutter={[16, 16]}>
        {[
          ["Total features", metrics.total, <ProductOutlined />, "#814DFF"],
          [
            "Features in pipeline",
            metrics.pipeline,
            <RocketOutlined />,
            "#243FFF",
          ],
          [
            "Meetings pending",
            metrics.pendingMeetings,
            <CalendarOutlined />,
            "#1A98FF",
          ],
          ["Overdue features", metrics.overdue, <WarningOutlined />, "#FF1F85"],
        ].map(([title, value, icon, color]: any) => (
          <Col xs={24} sm={12} lg={6} key={title}>
            <MotionCard.Metric
              title={title}
              value={value}
              icon={React.cloneElement(icon, { style: { color } })}
              iconBg={`${color}16`}
            />
          </Col>
        ))}
      </Row>
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
              <Segmented
                block
                value={segment}
                onChange={(value) => setSegment(String(value))}
                options={["Meetings", "Pipeline", "Completed", "Challenges"]}
              />
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="Search this register"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ marginTop: 12 }}
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
                                : item.status === "blocked"
                                ? "red"
                                : "gold"
                            }
                          >
                            {{
                              held: "Held",
                              released: "Completed",
                              resolved: "Resolved",
                              open: "Open",
                              planned: "Planned",
                              "in-progress": "In progress",
                              submitted: "Under review",
                              blocked: "At risk",
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
                          : selectedWorkspaceItem.status === "blocked"
                          ? "red"
                          : "gold"
                      }
                    >
                      {{
                        held: "Held",
                        released: "Completed",
                        resolved: "Resolved",
                        open: "Open",
                        planned: "Planned",
                        "in-progress": "In progress",
                        submitted: "Under review",
                        blocked: "At risk",
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
                                  <Text type="secondary">Target date</Text>
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
                              {item.audience.roles.map((role) => (
                                <Tag key={role}>{roleLabel(role)}</Tag>
                              ))}
                            </Space>
                          </div>
                        </div>
                        <Row gutter={[12, 12]} style={{ marginTop: 22 }}>
                          <Col xs={24} sm={12}>
                            <Button
                              block
                              shape="round"
                              icon={<EditOutlined />}
                              onClick={() => startEdit(item)}
                            >
                              Edit feature
                            </Button>
                          </Col>
                          <Col xs={24} sm={12}>
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
                        <div style={{ marginTop: 18 }}>
                          <Text type="secondary">What was discussed</Text>
                          <div style={{ ...sunkenPanel, marginTop: 6 }}>
                            <Text>
                              {item.discussion || "No discussion recorded"}
                            </Text>
                          </div>
                        </div>
                        <div style={{ marginTop: 18 }}>
                          <Text type="secondary">Challenges raised</Text>
                          <div style={{ marginTop: 8 }}>
                            <Space
                              direction="vertical"
                              style={{ width: "100%" }}
                            >
                              {challenges.length ? (
                                challenges.map((challenge) => (
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
                                ))
                              ) : (
                                <Text type="secondary">
                                  No challenges recorded
                                </Text>
                              )}
                            </Space>
                          </div>
                        </div>
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

      <Modal
        width={780}
        open={open}
        onCancel={() => {
          setOpen(false);
          setReleaseImages([]);
        }}
        title={
          editing
            ? "Update feature"
            : entryMode === "pipeline"
            ? "Add pipeline feature"
            : entryMode === "released"
            ? "Add completed feature"
            : "Add feature request"
        }
        okText={
          entryMode === "released"
            ? "Save completed feature"
            : entryMode === "pipeline"
            ? "Save pipeline feature"
            : "Save feature"
        }
        confirmLoading={saving}
        okButtonProps={{ shape: "round" }}
        cancelButtonProps={{ shape: "round" }}
        onOk={save}
        destroyOnClose={false}
        styles={{
          body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 8 },
        }}
      >
        <Form form={form} layout="vertical">
          <div style={sunkenPanel}>
            <Title level={5}>
              {entryMode === "pipeline"
                ? "Pipeline feature details"
                : entryMode === "released"
                ? "Completed feature details"
                : "Feature request details"}
            </Title>
            {entryMode !== "feature" && (
              <Form.Item name="type" hidden>
                <Input />
              </Form.Item>
            )}
            {entryMode === "released" ? (
              <Form.Item name="status" hidden>
                <Input />
              </Form.Item>
            ) : (
              <Row gutter={12}>
                {entryMode === "feature" && (
                  <Col span={12}>
                    <Form.Item
                      name="type"
                      label="Feature record type"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          ["request", "Feature request"],
                          ["update", "Feature update"],
                          ["new-feature", "New feature added"],
                        ].map(([value, label]) => ({ value, label }))}
                      />
                    </Form.Item>
                  </Col>
                )}
                <Col span={entryMode === "feature" ? 12 : 24}>
                  <Form.Item
                    name="status"
                    label="Delivery status"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={(entryMode === "pipeline"
                        ? [
                            ["planned", "Planned"],
                            ["in-progress", "In progress"],
                            ["blocked", "At risk"],
                            ["released", "Completed"],
                          ]
                        : [
                            ["submitted", "Under review"],
                            ["planned", "Planned"],
                            ["in-progress", "In progress"],
                            ["blocked", "At risk"],
                            ["released", "Completed"],
                          ]
                      ).map(([value, label]) => ({ value, label }))}
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
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
            <Form.Item name="programSpecific" valuePropName="checked">
              <Checkbox>
                <Text strong>Program-specific feature</Text>
                <br />
                <Text type="secondary">
                  Leave unchecked for system-wide features. When checked, this
                  applies to {programScopeLabel}.
                </Text>
              </Checkbox>
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="progress" label="Delivery progress (%)">
                  <InputNumber
                    min={0}
                    max={100}
                    disabled={entryMode === "released"}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="dueDate"
                  label={
                    entryMode === "released"
                      ? "Completion date"
                      : "Target completion date"
                  }
                >
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
          </div>
          {selectedFeatureStatus === "released" && (
            <>
              <Divider />
              <div style={sunkenPanel}>
                <Title level={5}>
                  <PictureOutlined /> What's New publication
                </Title>
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
            </>
          )}
          <Divider />
          <div style={sunkenPanel}>
            <Title level={5}>
              <TeamOutlined /> Affected users
            </Title>
            <Form.Item
              name="roles"
              label="Roles"
              rules={[
                {
                  required: true,
                  message: "Select at least one affected role",
                },
              ]}
            >
              <Select mode="multiple" showSearch options={roleOptions} />
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
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
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
        width={760}
        open={meetingOpen}
        title="Add meeting"
        okText="Save meeting"
        confirmLoading={saving}
        okButtonProps={{ shape: "round" }}
        cancelButtonProps={{ shape: "round" }}
        onOk={addMeeting}
        onCancel={() => setMeetingOpen(false)}
        destroyOnClose
        styles={{
          body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 8 },
        }}
      >
        <Form
          form={meetingForm}
          layout="vertical"
          initialValues={{
            status: "pending",
            createFeature: false,
            challenges: [],
          }}
        >
          <div style={sunkenPanel}>
            <Title level={5}>Meeting details</Title>
            <Form.Item
              name="title"
              label="Meeting title"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="status"
                  label="Meeting status"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={[
                      { value: "held", label: "Held" },
                      { value: "pending", label: "Pending / to be held" },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="withName"
                  label="With whom"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder="Name" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="meetingDate" label="Meeting date">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="dueDate" label="Follow-up due date">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="discussion" label="What was discussed">
              <TextArea rows={3} />
            </Form.Item>
            <Form.List name="challenges">
              {(fields, { add, remove }) => (
                <>
                  <Text strong>Challenges raised</Text>
                  {fields.map((field) => (
                    <Space
                      key={field.key}
                      align="baseline"
                      style={{ display: "flex", marginTop: 8 }}
                    >
                      <Form.Item
                        {...field}
                        name={[field.name, "text"]}
                        rules={[
                          {
                            required: true,
                            whitespace: true,
                            message: "Enter the challenge or remove this row",
                          },
                        ]}
                        style={{ flex: 1, marginBottom: 4 }}
                      >
                        <Input placeholder="Add one challenge" />
                      </Form.Item>
                      <Button
                        shape="round"
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </Space>
                  ))}
                  <Button
                    shape="round"
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => add()}
                    style={{ marginTop: 8 }}
                  >
                    Add challenge
                  </Button>
                </>
              )}
            </Form.List>
            <Form.Item
              name="relatedFeatureIds"
              label="Link existing features (optional)"
              style={{ marginTop: 16 }}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={records.map((record) => ({
                  value: record.id,
                  label: record.title,
                }))}
              />
            </Form.Item>
          </div>
          <Divider />
          <div style={sunkenPanel}>
            <Form.Item
              name="createFeature"
              valuePropName="checked"
              style={{ marginBottom: createFeatureFromMeeting ? 16 : 0 }}
            >
              <Checkbox>
                <Text strong>
                  A new feature request was raised in this meeting
                </Text>
              </Checkbox>
            </Form.Item>
            {createFeatureFromMeeting && (
              <>
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
                          meetingForm.getFieldValue("featureDepartmentIds") ||
                          [];
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
                          meetingForm.setFieldValue("featureBranchIds", [
                            "ALL",
                          ]);
                        else if (current.includes("ALL"))
                          meetingForm.setFieldValue("featureBranchIds", [
                            value,
                          ]);
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
              </>
            )}
          </div>
        </Form>
      </Modal>
      <Modal
        open={directChallengeOpen}
        title="Add implementation challenge"
        okText="Add challenge"
        confirmLoading={saving}
        okButtonProps={{ shape: "round" }}
        cancelButtonProps={{ shape: "round" }}
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
        open={!!challengeToResolve}
        title="Close out challenge"
        okText="Close out"
        confirmLoading={saving}
        okButtonProps={{ shape: "round" }}
        cancelButtonProps={{ shape: "round" }}
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
            {selectedMeeting?.discussion || "None recorded"}
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
    </div>
  );
};

export default FeatureGovernancePage;
