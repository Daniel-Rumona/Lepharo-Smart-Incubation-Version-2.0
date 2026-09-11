import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  MailOutlined,
  NotificationOutlined,
  ReloadOutlined,
  SendOutlined,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import dayjs, { Dayjs } from "dayjs";
import { db, functions } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { MotionCard } from "@/components/dashboards/metrics/Header";

const { RangePicker } = DatePicker;
const { TextArea } = Input;
const { Option } = Select;
const { Text, Title } = Typography;

type UserRow = {
  id: string;
  name?: string;
  email?: string;
  role?: string;

  createdAt?: any;
  emailBounced?: boolean;
  emailDeliveryStatus?: string;
  emailBounceReason?: string | null;
  emailDeliveryUpdatedAt?: any;
  lastAccountCreationEmailAt?: any;
};

type EmailLogRow = {
  id: string;
  type?: string;
  to?: string;
  subject?: string;
  status?: "sent" | "failed" | "skipped";
  error?: string | null;
  userId?: string;

  source?: string;
  messageId?: string | null;
  accepted?: string[];
  rejected?: string[];
  transportResponse?: string | null;
  participantId?: string | null;
  programId?: string | null;
  createdAt?: any;
};

type SuppressionRow = {
  id: string;
  to?: string;
  reason?: string;
  lastError?: string | null;
  participantId?: string | null;
  programId?: string | null | null;
  updatedAt?: any;
};

type ViewKey = "users" | "bounced" | "logs" | "devPlanReminders";
type SystemNoticeKind = "outage" | "upgrade" | "resolved";

type SystemNoticeFormValues = {
  kind: SystemNoticeKind;
  subject: string;
  message: string;
  window?: [Dayjs, Dayjs];
};

const SYSTEM_NOTICE_PRESETS: Record<
  SystemNoticeKind,
  { label: string; subject: string; message: string; color: string }
> = {
  outage: {
    label: "System down",
    subject: "Important: Smart Incubation is currently unavailable",
    message:
      "Smart Incubation is currently unavailable. Our team is working to restore service as quickly as possible. We will notify you once the system is operational again.",
    color: "red",
  },
  upgrade: {
    label: "Planned upgrade",
    subject: "Scheduled Smart Incubation upgrade notice",
    message:
      "Smart Incubation will undergo a planned system upgrade. Some features may be temporarily unavailable or behave differently during this maintenance window.",
    color: "orange",
  },
  resolved: {
    label: "Service restored",
    subject: "Smart Incubation is fully operational",
    message:
      "The system work has been completed and Smart Incubation is fully operational again. You may continue using the platform as normal.",
    color: "green",
  },
};

const sunkenPanelStyle: React.CSSProperties = {
  background: "#f5f7fb",
  border: "1px solid #d9e2f0",
  borderRadius: 16,
  padding: 14,
  boxShadow: "inset 0 2px 8px rgba(15, 23, 42, 0.06)",
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(value: any) {
  const d = toDate(value);
  return d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "Not recorded";
}

function statusTag(status?: string) {
  if (status === "sent" || status === "ok")
    return <Tag color="green">SMTP accepted</Tag>;
  if (status === "failed" || status === "bounced")
    return <Tag color="red">Bounced</Tag>;
  if (status === "skipped") return <Tag color="orange">Skipped</Tag>;
  return <Tag>Unknown</Tag>;
}

function parseEmailList(value?: string) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

const AdminEmailMonitor: React.FC = () => {
  const { user } = useFullIdentity();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<EmailLogRow[]>([]);
  const [devPlanLogs, setDevPlanLogs] = useState<EmailLogRow[]>([]);
  const [devPlanSuppressions, setDevPlanSuppressions] = useState<
    SuppressionRow[]
  >([]);
  const [devPlanSearch, setDevPlanSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [resending, setResending] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("users");
  const [selectedUserIds, setSelectedUserIds] = useState<React.Key[]>([]);
  const [emailSearch, setEmailSearch] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState<string[]>([]);
  const [logTypeFilter, setLogTypeFilter] = useState<string[]>([]);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [emailListModalOpen, setEmailListModalOpen] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(1, "month").startOf("month"),
    dayjs().subtract(1, "month").endOf("month"),
  ]);
  const [testForm] = Form.useForm();
  const [broadcastForm] = Form.useForm<SystemNoticeFormValues>();
  const [emailListForm] = Form.useForm();
  const [roleForm] = Form.useForm();

  const bouncedUsers = useMemo(
    () =>
      users.filter(
        (row) =>
          row.emailBounced === true ||
          row.emailDeliveryStatus === "bounced" ||
          row.emailDeliveryStatus === "failed"
      ),
    [users]
  );
  const filteredUsers = useMemo(() => {
    const needle = emailSearch.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((row) =>
      [row.email, row.name, row.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [emailSearch, users]);
  const roleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          users.map((row) => String(row.role || "").trim()).filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [users]
  );
  const logTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          logs.map((row) => String(row.type || "EMAIL").trim()).filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [logs]
  );
  const filteredLogs = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    return logs.filter((row) => {
      const status = row.status || "unknown";
      const type = row.type || "EMAIL";
      const matchesText =
        !needle ||
        [
          row.to,
          row.subject,
          row.error,
          row.userId,
          row.source,
          row.messageId,
          type,
          status,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      const matchesStatus =
        logStatusFilter.length === 0 || logStatusFilter.includes(status);
      const matchesType =
        logTypeFilter.length === 0 || logTypeFilter.includes(type);
      return matchesText && matchesStatus && matchesType;
    });
  }, [logSearch, logStatusFilter, logTypeFilter, logs]);

  const devPlanSuppressionByEmail = useMemo(() => {
    const map = new Map<string, SuppressionRow>();
    devPlanSuppressions.forEach((row) => {
      if (row.to) map.set(row.to.toLowerCase(), row);
    });
    return map;
  }, [devPlanSuppressions]);

  const devPlanRows = useMemo(
    () =>
      devPlanLogs.map((row) => ({
        ...row,
        bounce: row.to
          ? devPlanSuppressionByEmail.get(row.to.toLowerCase())
          : undefined,
      })),
    [devPlanLogs, devPlanSuppressionByEmail]
  );

  const filteredDevPlanRows = useMemo(() => {
    const needle = devPlanSearch.trim().toLowerCase();
    if (!needle) return devPlanRows;
    return devPlanRows.filter((row) =>
      [row.to, row.subject, row.error, row.participantId, row.programId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [devPlanRows, devPlanSearch]);

  const loadData = async () => {
    setLoading(true);
    try {
      const userQuery = query(collection(db, "users"), limit(500));
      const logQuery = query(
        collection(db, "emailLogs"),
        orderBy("createdAt", "desc"),
        limit(150)
      );
      // Keep in sync with the SME reminder types tagged in functions/src (emailDevPlan.ts,
      // workflowEmailFunctions.ts, emailCampaigns.ts, complianceExpiry.ts).
      const devPlanLogQuery = query(
        collection(db, "emailLogs"),
        where("type", "in", [
          "DEV_PLAN_SME_REMINDER",
          "INTERVENTION_REMINDER",
          "COMPLIANCE_REMINDER",
          "COMPLIANCE_EXPIRY_REMINDER",
        ]),
        orderBy("createdAt", "desc"),
        limit(300)
      );
      const devPlanSuppressionQuery = query(
        collection(db, "emailSuppressions"),
        limit(500)
      );

      const [userSnap, logSnap, devPlanLogSnap, devPlanSuppressionSnap] =
        await Promise.all([
          getDocs(userQuery),
          getDocs(logQuery),
          getDocs(devPlanLogQuery),
          getDocs(devPlanSuppressionQuery),
        ]);

      setUsers(
        userSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as UserRow))
      );
      setLogs(
        logSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as EmailLogRow)
        )
      );
      setDevPlanLogs(
        devPlanLogSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as EmailLogRow)
        )
      );
      setDevPlanSuppressions(
        devPlanSuppressionSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as SuppressionRow)
        )
      );
    } catch (error) {
      console.error(error);
      message.error("Failed to load email monitoring data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sendTestEmail = async (values: { to?: string }) => {
    setSendingTest(true);
    try {
      const fn = httpsCallable(functions, "sendAdminTestEmail");
      await fn({ to: values.to || user?.email });
      message.success("Test email sent.");
      setTestModalOpen(false);
      await loadData();
    } catch (error: any) {
      message.error(error?.message || "Test email failed.");
    } finally {
      setSendingTest(false);
    }
  };

  const openSystemNotice = () => {
    const preset = SYSTEM_NOTICE_PRESETS.outage;
    broadcastForm.setFieldsValue({
      kind: "outage",
      subject: preset.subject,
      message: preset.message,
      window: undefined,
    });
    setBroadcastModalOpen(true);
  };

  const chooseEmailAction = (
    action:
      | "systemNotice"
      | "test"
      | "selected"
      | "dateRange"
      | "emailList"
      | "roles"
  ) => {
    setActionModalOpen(false);
    if (action === "systemNotice") return openSystemNotice();
    if (action === "test") return setTestModalOpen(true);
    if (action === "selected") return resendAccountCreation("selected");
    if (action === "dateRange") return setDateModalOpen(true);
    if (action === "emailList") return setEmailListModalOpen(true);
    setRoleModalOpen(true);
  };

  const changeSystemNoticeKind = (kind: SystemNoticeKind) => {
    const preset = SYSTEM_NOTICE_PRESETS[kind];
    broadcastForm.setFieldsValue({
      kind,
      subject: preset.subject,
      message: preset.message,
      window:
        kind === "upgrade" ? broadcastForm.getFieldValue("window") : undefined,
    });
  };

  const queueSystemNotice = (values: SystemNoticeFormValues) => {
    const preset = SYSTEM_NOTICE_PRESETS[values.kind];
    Modal.confirm({
      title: `Send “${preset.label}” email to all users?`,
      icon: <ExclamationCircleOutlined />,
      width: 560,
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            This queues a separate email for every registered user with a valid,
            deliverable address.
          </Text>
          <Text strong>Subject: {values.subject}</Text>
          <Text type="warning">
            This action cannot be recalled after the campaign starts.
          </Text>
        </Space>
      ),
      okText: "Send to all users",
      okButtonProps: { danger: values.kind === "outage" },
      onOk: async () => {
        setBroadcastSending(true);
        try {
          const fn = httpsCallable(functions, "queueSystemStatusBroadcast");
          const res: any = await fn({
            kind: values.kind,
            subject: values.subject,
            message: values.message,
            startsAt: values.window?.[0]?.toISOString() || null,
            endsAt: values.window?.[1]?.toISOString() || null,
            confirmation: "SEND TO ALL USERS",
          });
          const data = res.data || {};
          const skipped =
            Number(data.skippedInvalid || 0) +
            Number(data.skippedDuplicate || 0) +
            Number(data.skippedSuppressed || 0) +
            Number(data.skippedExcludedDomain || 0);
          message.success(
            `Notice queued for ${data.recipients || 0} user(s)${
              skipped
                ? `; ${skipped} invalid, duplicate, suppressed, or excluded address(es) omitted.`
                : "."
            } Oversight copy queued for helperzhou@gmail.com and admin@quantilytix.com.`
          );
          setBroadcastModalOpen(false);
          broadcastForm.resetFields();
          setActiveView("logs");
        } catch (error: any) {
          message.error(error?.message || "Failed to queue the system notice.");
          throw error;
        } finally {
          setBroadcastSending(false);
        }
      },
    });
  };

  const resendAccountCreation = async (mode: "selected" | "dateRange") => {
    const payload =
      mode === "selected"
        ? { userIds: selectedUserIds.map(String) }
        : {
            createdFrom: dateRange?.[0]?.format("YYYY-MM-DD"),
            createdTo: dateRange?.[1]?.format("YYYY-MM-DD"),
          };

    if (mode === "selected" && selectedUserIds.length === 0) {
      message.warning("Select at least one user.");
      return;
    }

    if (mode === "dateRange" && (!payload.createdFrom || !payload.createdTo)) {
      message.warning("Choose a creation date range.");
      return;
    }

    Modal.confirm({
      title: "Resend account creation email?",
      icon: <ExclamationCircleOutlined />,
      content:
        mode === "selected"
          ? `This will email ${selectedUserIds.length} selected user(s).`
          : `This will email users created from ${payload.createdFrom} to ${payload.createdTo}.`,
      okText: "Send",
      onOk: async () => {
        setResending(true);
        try {
          const fn = httpsCallable(functions, "resendAccountCreationEmails");
          const res: any = await fn(payload);
          const data = res.data || {};
          message.success(
            `Processed ${data.total || 0}: ${data.sent || 0} sent, ${
              data.failed || 0
            } failed, ${data.skipped || 0} skipped.`
          );
          setSelectedUserIds([]);
          setDateModalOpen(false);
          await loadData();
        } catch (error: any) {
          message.error(
            error?.message || "Failed to resend account creation emails."
          );
        } finally {
          setResending(false);
        }
      },
    });
  };

  const sendAccountCreationToEmailList = async (values: {
    emails?: string;
  }) => {
    const emailList = values.emails || "";
    const emails = parseEmailList(emailList);
    if (emails.length === 0) {
      message.warning("Add at least one email address.");
      return;
    }

    Modal.confirm({
      title: "Send registration email to list?",
      icon: <ExclamationCircleOutlined />,
      content: `This will send the account registration email to ${emails.length} email address(es).`,
      okText: "Send",
      onOk: async () => {
        setResending(true);
        try {
          const fn = httpsCallable(functions, "resendAccountCreationEmails");
          const res: any = await fn({
            emails,
            emailList,
            emailsText: emailList,
          });
          const data = res.data || {};
          message.success(
            `Processed ${data.total || 0}: ${data.sent || 0} sent, ${
              data.failed || 0
            } failed, ${data.skipped || 0} skipped.`
          );
          emailListForm.resetFields();
          setEmailListModalOpen(false);
          await loadData();
        } catch (error: any) {
          message.error(
            error?.message || "Failed to send registration emails."
          );
        } finally {
          setResending(false);
        }
      },
    });
  };

  const sendAccountCreationToRoles = async (values: { roles?: string[] }) => {
    const roles = (values.roles || [])
      .map((role) => String(role).trim())
      .filter(Boolean);
    if (roles.length === 0) {
      message.warning("Select at least one role.");
      return;
    }

    const matchingCount = users.filter((row) =>
      roles.includes(String(row.role || "").trim())
    ).length;
    Modal.confirm({
      title: "Send registration email by role?",
      icon: <ExclamationCircleOutlined />,
      content: `This will send the account registration email to users with: ${roles.join(
        ", "
      )}${matchingCount ? ` (${matchingCount} loaded user(s) match).` : "."}`,
      okText: "Send",
      onOk: async () => {
        setResending(true);
        try {
          const fn = httpsCallable(functions, "resendAccountCreationEmails");
          const res: any = await fn({ roles });
          const data = res.data || {};
          message.success(
            `Processed ${data.total || 0}: ${data.sent || 0} sent, ${
              data.failed || 0
            } failed, ${data.skipped || 0} skipped.`
          );
          roleForm.resetFields();
          setRoleModalOpen(false);
          await loadData();
        } catch (error: any) {
          message.error(
            error?.message || "Failed to send registration emails by role."
          );
        } finally {
          setResending(false);
        }
      },
    });
  };

  const userColumns = [
    {
      title: "User",
      key: "user",
      render: (_: any, row: UserRow) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.name || "Unnamed user"}</Text>
          <Text type="secondary">{row.email || "No email"}</Text>
        </Space>
      ),
    },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      render: (role: string) => <Tag>{role || "Unknown"}</Tag>,
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      key: "createdAt",
      render: fmtDate,
    },
    {
      title: "Delivery",
      key: "delivery",
      render: (_: any, row: UserRow) =>
        statusTag(
          row.emailDeliveryStatus || (row.emailBounced ? "bounced" : "ok")
        ),
    },
    {
      title: "Last Account Email",
      dataIndex: "lastAccountCreationEmailAt",
      key: "lastAccountCreationEmailAt",
      render: fmtDate,
    },
  ];

  const bouncedColumns = [
    ...userColumns,
    {
      title: "Reason",
      dataIndex: "emailBounceReason",
      key: "emailBounceReason",
      render: (reason: string) => (
        <Text type="danger">{reason || "Send failed"}</Text>
      ),
    },
  ];

  const logColumns = [
    {
      title: "When",
      dataIndex: "createdAt",
      key: "createdAt",
      render: fmtDate,
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      render: (type: string) => <Tag color="blue">{type || "EMAIL"}</Tag>,
    },
    {
      title: "To",
      dataIndex: "to",
      key: "to",
    },
    {
      title: "Subject",
      dataIndex: "subject",
      key: "subject",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: statusTag,
    },
    {
      title: "Transport",
      key: "transport",
      render: (_: any, row: EmailLogRow) => (
        <Space direction="vertical" size={0}>
          <Text type="secondary">{row.source || "Email service"}</Text>
          {row.messageId ? (
            <Text
              copyable={{ text: row.messageId }}
              type="secondary"
              style={{ fontSize: 12 }}
            >
              {row.messageId}
            </Text>
          ) : null}
          {row.rejected?.length ? (
            <Text type="danger">Rejected: {row.rejected.join(", ")}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Error",
      dataIndex: "error",
      key: "error",
      render: (error: string) =>
        error ? (
          <Text type="danger">{error}</Text>
        ) : (
          <Text type="secondary">None</Text>
        ),
    },
  ];

  const devPlanColumns = [
    {
      title: "When",
      dataIndex: "createdAt",
      key: "createdAt",
      render: fmtDate,
    },
    {
      title: "SME Email",
      dataIndex: "to",
      key: "to",
    },
    {
      title: "Participant / Program",
      key: "participant",
      render: (_: any, row: EmailLogRow) => (
        <Space direction="vertical" size={0}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.participantId || "Unknown participant"}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.programId || "Unknown program"}
          </Text>
        </Space>
      ),
    },
    {
      title: "Send Status",
      dataIndex: "status",
      key: "status",
      render: statusTag,
    },
    {
      title: "Bounce",
      key: "bounce",
      render: (_: any, row: EmailLogRow & { bounce?: SuppressionRow }) =>
        row.bounce ? (
          <Tag color="red">
            Bounced: {row.bounce.reason || "invalid_recipient"}
          </Tag>
        ) : (
          <Tag color="green">No bounce recorded</Tag>
        ),
    },
    {
      title: "Error",
      dataIndex: "error",
      key: "error",
      render: (error: string) =>
        error ? (
          <Text type="danger">{error}</Text>
        ) : (
          <Text type="secondary">None</Text>
        ),
    },
  ];

  return (
    <div style={{ padding: 24, minHeight: "100vh" }}>
      <Row
        justify="space-between"
        align="middle"
        gutter={[16, 16]}
        style={{ marginBottom: 16 }}
      >
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Email Monitor
          </Title>
          <Text type="secondary">
            Monitor all function and scheduled-reminder email attempts.
          </Text>
        </Col>
        <Col>
          <Space wrap>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => setActionModalOpen(true)}
            >
              Email Action
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadData}
              loading={loading}
            >
              Refresh
            </Button>
          </Space>
        </Col>
      </Row>

      <MotionCard
        filterBar={
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Segmented<ViewKey>
              value={activeView}
              onChange={setActiveView}
              options={[
                { label: `Users (${filteredUsers.length})`, value: "users" },
                { label: `Bounced (${bouncedUsers.length})`, value: "bounced" },
                { label: `Logs (${filteredLogs.length})`, value: "logs" },
                {
                  label: `SME Reminders (${filteredDevPlanRows.length})`,
                  value: "devPlanReminders",
                },
              ]}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              SMTP accepted means the outgoing server accepted the message;
              later mailbox bounces require a provider webhook.
            </Text>
            {activeView === "devPlanReminders" ? (
              <Input.Search
                allowClear
                value={devPlanSearch}
                onChange={(event) => setDevPlanSearch(event.target.value)}
                placeholder="Search by SME email, participant, program, or company"
                prefix={<MailOutlined />}
                style={{ maxWidth: 480 }}
              />
            ) : activeView === "logs" ? (
              <Row gutter={[12, 12]}>
                <Col xs={24} md={10}>
                  <Input.Search
                    allowClear
                    value={logSearch}
                    onChange={(event) => setLogSearch(event.target.value)}
                    placeholder="Search logs by recipient, subject, error, type, or company"
                    prefix={<MailOutlined />}
                  />
                </Col>
                <Col xs={24} md={7}>
                  <Select
                    mode="multiple"
                    allowClear
                    value={logStatusFilter}
                    onChange={setLogStatusFilter}
                    placeholder="Status"
                    style={{ width: "100%" }}
                  >
                    <Option value="sent">Sent</Option>
                    <Option value="failed">Failed</Option>
                    <Option value="skipped">Skipped</Option>
                  </Select>
                </Col>
                <Col xs={24} md={7}>
                  <Select
                    mode="multiple"
                    allowClear
                    value={logTypeFilter}
                    onChange={setLogTypeFilter}
                    placeholder="Type"
                    style={{ width: "100%" }}
                  >
                    {logTypeOptions.map((type) => (
                      <Option key={type} value={type}>
                        {type}
                      </Option>
                    ))}
                  </Select>
                </Col>
              </Row>
            ) : (
              <Input.Search
                allowClear
                value={emailSearch}
                onChange={(event) => setEmailSearch(event.target.value)}
                placeholder="Search users by email, name, role, or company"
                prefix={<MailOutlined />}
                style={{ maxWidth: 480 }}
              />
            )}
          </Space>
        }
        filterBarProps={{
          style: sunkenPanelStyle,
          marginBottom: 18,
          padding: 0,
          background: "transparent",
          borderColor: "transparent",
          boxShadow: "none",
        }}
      >
        {activeView === "devPlanReminders" ? (
          <Table
            rowKey="id"
            loading={loading}
            columns={devPlanColumns}
            dataSource={filteredDevPlanRows}
            pagination={{
              pageSize: 10,
              position: ["bottomCenter"],
              showSizeChanger: false,
            }}
          />
        ) : activeView === "logs" ? (
          <Table
            rowKey="id"
            loading={loading}
            columns={logColumns}
            dataSource={filteredLogs}
            pagination={{
              pageSize: 10,
              position: ["bottomCenter"],
              showSizeChanger: false,
            }}
          />
        ) : activeView === "bounced" ? (
          <Table
            rowKey="id"
            loading={loading}
            columns={bouncedColumns}
            dataSource={bouncedUsers}
            pagination={{
              pageSize: 10,
              position: ["bottomCenter"],
              showSizeChanger: false,
            }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={userColumns}
            dataSource={filteredUsers}
            rowSelection={{
              selectedRowKeys: selectedUserIds,
              onChange: setSelectedUserIds,
            }}
            pagination={{
              pageSize: 10,
              position: ["bottomCenter"],
              showSizeChanger: false,
            }}
          />
        )}
      </MotionCard>

      <Modal
        title="Choose an email action"
        open={actionModalOpen}
        onCancel={() => setActionModalOpen(false)}
        footer={null}
        width={760}
        centered
      >
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <div>
            <Text strong>System communication</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 2 }}>
              Send an operational status update to all eligible users.
            </Text>
          </div>
          <Card
            hoverable
            onClick={() => chooseEmailAction("systemNotice")}
            style={{ borderColor: "#bfd4ff", background: "#f7faff" }}
          >
            <Space size={14} align="start">
              <NotificationOutlined
                style={{ fontSize: 24, color: "#1677ff", marginTop: 2 }}
              />
              <div>
                <Text strong>System status notice</Text>
                <Text
                  type="secondary"
                  style={{ display: "block", marginTop: 4 }}
                >
                  Choose system down, planned upgrade, or service restored, then
                  review the message before sending.
                </Text>
                <Space wrap size={4} style={{ marginTop: 10 }}>
                  <Tag color="red" icon={<WarningOutlined />}>
                    Down
                  </Tag>
                  <Tag color="orange" icon={<ToolOutlined />}>
                    Upgrade
                  </Tag>
                  <Tag color="green" icon={<CheckCircleOutlined />}>
                    Restored
                  </Tag>
                </Space>
              </div>
            </Space>
          </Card>

          <div>
            <Text strong>Account and delivery actions</Text>
            <Text type="secondary" style={{ display: "block", marginTop: 2 }}>
              Test email delivery or resend the standard account-creation email.
            </Text>
          </div>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>
              <Card
                hoverable
                onClick={() => chooseEmailAction("test")}
                style={{ height: "100%" }}
              >
                <Space align="start">
                  <MailOutlined
                    style={{ fontSize: 20, color: "#1677ff", marginTop: 2 }}
                  />
                  <div>
                    <Text strong>Test email</Text>
                    <Text type="secondary" style={{ display: "block" }}>
                      Check delivery to one address.
                    </Text>
                  </div>
                </Space>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card
                hoverable={selectedUserIds.length > 0}
                onClick={
                  selectedUserIds.length
                    ? () => chooseEmailAction("selected")
                    : undefined
                }
                style={{
                  height: "100%",
                  opacity: selectedUserIds.length ? 1 : 0.55,
                  cursor: selectedUserIds.length ? "pointer" : "not-allowed",
                }}
              >
                <Space align="start">
                  <CheckCircleOutlined
                    style={{ fontSize: 20, color: "#16a34a", marginTop: 2 }}
                  />
                  <div>
                    <Text strong>Selected users</Text>
                    <Text type="secondary" style={{ display: "block" }}>
                      {selectedUserIds.length
                        ? `${selectedUserIds.length} user(s) selected.`
                        : "Select users in the table first."}
                    </Text>
                  </div>
                </Space>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card
                hoverable
                onClick={() => chooseEmailAction("dateRange")}
                style={{ height: "100%" }}
              >
                <Text strong>Creation date</Text>
                <Text type="secondary" style={{ display: "block" }}>
                  Target a user date range.
                </Text>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card
                hoverable
                onClick={() => chooseEmailAction("emailList")}
                style={{ height: "100%" }}
              >
                <Text strong>Email list</Text>
                <Text type="secondary" style={{ display: "block" }}>
                  Paste specific addresses.
                </Text>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card
                hoverable
                onClick={() => chooseEmailAction("roles")}
                style={{ height: "100%" }}
              >
                <Text strong>User roles</Text>
                <Text type="secondary" style={{ display: "block" }}>
                  Target one or more roles.
                </Text>
              </Card>
            </Col>
          </Row>
        </Space>
      </Modal>

      <Modal
        title="Email all users about system status"
        open={broadcastModalOpen}
        onCancel={() => setBroadcastModalOpen(false)}
        onOk={() => broadcastForm.submit()}
        confirmLoading={broadcastSending}
        okText="Review and send"
        width={680}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="This notice is sent to unique, valid user email addresses. Known bounced/suppressed addresses and every @quantilytix.co.za address are excluded. One oversight copy is CC’d to helperzhou@gmail.com and admin@quantilytix.com."
          style={{ marginBottom: 16 }}
        />
        <Form
          form={broadcastForm}
          layout="vertical"
          onFinish={queueSystemNotice}
          initialValues={{
            kind: "outage",
            subject: SYSTEM_NOTICE_PRESETS.outage.subject,
            message: SYSTEM_NOTICE_PRESETS.outage.message,
          }}
        >
          <Form.Item
            name="kind"
            label="Notice type"
            rules={[{ required: true }]}
          >
            <Select onChange={changeSystemNoticeKind}>
              {(Object.keys(SYSTEM_NOTICE_PRESETS) as SystemNoticeKind[]).map(
                (kind) => (
                  <Option key={kind} value={kind}>
                    <Tag color={SYSTEM_NOTICE_PRESETS[kind].color}>
                      {SYSTEM_NOTICE_PRESETS[kind].label}
                    </Tag>
                  </Option>
                )
              )}
            </Select>
          </Form.Item>
          <Form.Item
            name="subject"
            label="Email subject"
            rules={[
              { required: true, message: "Enter an email subject." },
              {
                min: 5,
                max: 160,
                message: "Use between 5 and 160 characters.",
              },
            ]}
          >
            <Input showCount maxLength={160} />
          </Form.Item>
          <Form.Item
            name="message"
            label="Message to users"
            extra="The email automatically includes the recipient greeting, Smart Incubation branding, and sign-off."
            rules={[
              { required: true, message: "Enter the notice message." },
              {
                min: 10,
                max: 2000,
                message: "Use between 10 and 2,000 characters.",
              },
            ]}
          >
            <TextArea rows={6} showCount maxLength={2000} />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) => previous.kind !== current.kind}
          >
            {({ getFieldValue }) =>
              getFieldValue("kind") === "upgrade" ? (
                <Form.Item
                  name="window"
                  label="Upgrade window"
                  extra="Times are shown to recipients in South African Standard Time (SAST)."
                  rules={[
                    {
                      required: true,
                      message: "Choose the planned start and completion time.",
                    },
                  ]}
                >
                  <RangePicker
                    showTime
                    format="DD MMM YYYY HH:mm"
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Send test email"
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        onOk={() => testForm.submit()}
        confirmLoading={sendingTest}
        okText="Send"
      >
        <Form form={testForm} layout="vertical" onFinish={sendTestEmail}>
          <Form.Item name="to" label="Test recipient">
            <Input
              placeholder={user?.email || "name@example.com"}
              prefix={<MailOutlined />}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Send by creation date"
        open={dateModalOpen}
        onCancel={() => setDateModalOpen(false)}
        onOk={() => resendAccountCreation("dateRange")}
        confirmLoading={resending}
        okText="Send"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text type="secondary">
            Choose the user creation window for the registration resend.
          </Text>
          <RangePicker
            value={dateRange}
            onChange={(value) => setDateRange(value as [Dayjs, Dayjs] | null)}
            style={{ width: "100%" }}
          />
        </Space>
      </Modal>

      <Modal
        title="Send to email list"
        open={emailListModalOpen}
        onCancel={() => setEmailListModalOpen(false)}
        onOk={() => emailListForm.submit()}
        confirmLoading={resending}
        okText="Send"
        width={720}
      >
        <Form
          form={emailListForm}
          layout="vertical"
          onFinish={sendAccountCreationToEmailList}
        >
          <Form.Item
            name="emails"
            label="Registration email list"
            extra="Paste addresses separated by commas, spaces, or new lines."
          >
            <TextArea
              rows={6}
              placeholder={"name@example.com\nsecond@example.com"}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Send to roles"
        open={roleModalOpen}
        onCancel={() => setRoleModalOpen(false)}
        onOk={() => roleForm.submit()}
        confirmLoading={resending}
        okText="Send"
      >
        <Form
          form={roleForm}
          layout="vertical"
          onFinish={sendAccountCreationToRoles}
        >
          <Form.Item
            name="roles"
            label="Registration email roles"
            extra="Every user with one of these roles receives the registration email."
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="Select one or more roles"
              optionFilterProp="children"
            >
              {roleOptions.map((role) => (
                <Option key={role} value={role}>
                  {role}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminEmailMonitor;
