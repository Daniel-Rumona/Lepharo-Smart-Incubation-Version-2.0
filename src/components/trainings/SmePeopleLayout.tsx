import React from "react";
import { Avatar, Button, Card, Col, Collapse, Empty, Grid, Row, Skeleton, Space, Switch, Tag, Tooltip, Typography, theme } from "antd";
import {
  CheckCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  IdcardOutlined,
  KeyOutlined,
  MailOutlined,
  PhoneOutlined,
  StopOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import type { TrainingAttendee } from "./trainingStorage";
import { EligibilityTag } from "./EligibilityTag";

export type SmePeopleHandlers = {
  onAdd: () => void;
  onEdit: (p: TrainingAttendee) => void;
  onWithdraw: (p: TrainingAttendee) => void;
  onToggleAttends: (p: TrainingAttendee, attends: boolean) => void;
  onCreateLogin: (p: TrainingAttendee) => void;
  onSetUp: () => void;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

/** What still needs doing for a person before they're fully set up. */
const gaps = (p: TrainingAttendee, enrolled: boolean) => [
  ...(!p.idNumber ? ["ID number"] : []),
  ...(!p.idDocument ? ["ID copy"] : []),
  ...(enrolled && !p.userId ? ["login"] : []),
];

/**
 * The director's People page in the training portal: the company's people as
 * cards (the director first, then employees), with what each still needs and
 * the few things a director can do. The add/edit/withdraw dialogs and the
 * saving live in TrainingPeopleDrawer, which renders this for variant "page".
 */
export function SmePeopleLayout({
  companyName,
  trainingName,
  people,
  loading,
  enrolled,
  myUid,
  busy,
  handlers,
}: {
  companyName: string;
  trainingName?: string;
  people: TrainingAttendee[];
  loading: boolean;
  enrolled: boolean;
  myUid?: string;
  busy?: string;
  handlers: SmePeopleHandlers;
}) {
  const { token } = theme.useToken();
  const isMobile = !Grid.useBreakpoint().md;
  const director = people.find((p) => p.kind === "director");
  const employees = people.filter((p) => p.kind === "employee");
  const active = employees.filter((p) => p.status === "active").sort((a, b) => a.name.localeCompare(b.name));
  const withdrawn = employees.filter((p) => p.status === "withdrawn");
  const everyone = [...(director ? [director] : []), ...active];
  const attending = everyone.filter((p) => p.attends);
  const needAttention = everyone.filter((p) => gaps(p, enrolled).length);

  if (loading && !people.length) return <Skeleton active style={{ padding: 8 }} />;

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Your people
        </Typography.Title>
        <Typography.Text type="secondary">{[companyName, trainingName].filter(Boolean).join(" · ")}</Typography.Text>
      </div>
      {/* With no employees yet the empty state offers the one Add button. */}
      {director && !!active.length && (
        <Button type="primary" shape="round" icon={<UserAddOutlined />} onClick={handlers.onAdd} block={isMobile}>
          Add employee
        </Button>
      )}
    </div>
  );

  if (!director) {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {header}
        <Card>
          <Empty
            image={<TeamOutlined style={{ fontSize: 48, color: token.colorPrimary }} />}
            imageStyle={{ height: 56 }}
            description={
              <Space direction="vertical" size={4}>
                <Typography.Text strong>Set up your company's people</Typography.Text>
                <Typography.Text type="secondary">
                  We'll start with you as the director. Then you can add the employees you're sending to the training, each with their own login.
                </Typography.Text>
              </Space>
            }
          >
            <Button type="primary" shape="round" loading={busy === "director"} onClick={handlers.onSetUp}>
              Set up
            </Button>
          </Empty>
        </Card>
      </Space>
    );
  }

  const isSelf = (p: TrainingAttendee) => !!p.userId && p.userId === myUid;
  const idAction = (p: TrainingAttendee) =>
    !p.idNumber && !p.idDocument ? "Add ID number & copy" : !p.idNumber ? "Add ID number" : "Upload ID copy";
  // The first person still missing ID details: the "Need details" tile takes you straight there.
  const firstIdGap = everyone.find((p) => !p.idNumber || !p.idDocument);

  const metrics: DashboardMetric[] = [
    { key: "people", title: "People", value: everyone.length, subtitle: active.length ? `You and ${active.length} employee${active.length === 1 ? "" : "s"}` : "Just you so far", icon: <TeamOutlined style={{ fontSize: 20 }} />, tone: "accent", important: true },
    { key: "attending", title: "Attending", value: attending.length, subtitle: "Invited to sessions", icon: <CheckCircleOutlined style={{ fontSize: 20 }} />, tone: "success", important: true },
    {
      key: "logins",
      title: "Logins active",
      value: `${everyone.filter((p) => p.userId).length} / ${everyone.length}`,
      subtitle: enrolled ? "Can sign in to the portal" : "Created once you're enrolled",
      icon: <KeyOutlined style={{ fontSize: 20 }} />,
      tone: "info",
    },
    {
      key: "attention",
      title: "Need details",
      value: needAttention.length,
      subtitle: firstIdGap
        ? `${isSelf(firstIdGap) ? "You" : firstIdGap.name}: ${idAction(firstIdGap).toLowerCase()}`
        : needAttention.length
          ? "Missing a login"
          : "Everyone is complete",
      icon: <ExclamationCircleOutlined style={{ fontSize: 20 }} />,
      tone: needAttention.length ? "warning" : "success",
      ...(firstIdGap ? { onClick: () => handlers.onEdit(firstIdGap) } : {}),
    },
  ];

  const statusChips = (p: TrainingAttendee) => {
    const missing = gaps(p, enrolled);
    return (
      <Space size={[6, 6]} wrap>
        {/* Whoever is looking is signed in, so their own login needs no status. */}
        {isSelf(p) ? null : p.userId ? (
          <Tag color="green" icon={<KeyOutlined />}>
            Login active
          </Tag>
        ) : enrolled ? (
          <Button size="small" shape="round" icon={<KeyOutlined />} loading={busy === `login-${p.id}`} onClick={() => handlers.onCreateLogin(p)}>
            Send login
          </Button>
        ) : (
          <Tag>Login after enrolment</Tag>
        )}
        {p.idDocument && p.idNumber ? (
          <Tag color="green" icon={<IdcardOutlined />}>
            ID on file
          </Tag>
        ) : (
          // Says what's missing and opens the details to add it.
          <Tooltip title={`Opens ${isSelf(p) ? "your" : `${p.name}'s`} details to add the ${missing.filter((m) => m !== "login").join(" and ")}`}>
            <Button
              size="small"
              shape="round"
              icon={<IdcardOutlined />}
              onClick={() => handlers.onEdit(p)}
              style={{ color: token.colorWarningText, borderColor: token.colorWarningBorder, background: token.colorWarningBg }}
            >
              {idAction(p)}
            </Button>
          </Tooltip>
        )}
        {p.attends && <EligibilityTag eligibility={p.progress?.eligibility} />}
      </Space>
    );
  };

  const contact = (p: TrainingAttendee) => (
    <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
      <Typography.Text type="secondary" ellipsis style={{ fontSize: 13 }}>
        <MailOutlined style={{ marginRight: 6 }} />
        {p.email || "No email"}
      </Typography.Text>
      {p.phone && (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          <PhoneOutlined style={{ marginRight: 6 }} />
          {p.phone}
        </Typography.Text>
      )}
    </Space>
  );

  const categories = (p: TrainingAttendee) => (
    <Space size={[4, 4]} wrap>
      {p.categories?.length ? p.categories.map((c) => <Tag key={c} color="blue">{c}</Tag>) : <Tag>All sessions</Tag>}
    </Space>
  );

  const isMe = director.userId && director.userId === myUid;

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      {header}
      <MetricsGrid metrics={metrics} />

      <Card styles={{ body: { padding: isMobile ? 16 : 20 } }} style={{ borderColor: token.colorWarningBorder }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Avatar size={isMobile ? 44 : 56} style={{ background: token.colorWarningBg, color: token.colorWarningText, fontWeight: 700, flexShrink: 0 }}>
            {initials(director.name)}
          </Avatar>
          <Space direction="vertical" size={8} style={{ flex: "1 1 180px", minWidth: 0 }}>
            <Space size={8} wrap>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {director.name}
              </Typography.Title>
              <Tag color="gold">Director</Tag>
              {isMe && <Tag>You</Tag>}
            </Space>
            {contact(director)}
            {director.attends && categories(director)}
            {statusChips(director)}
          </Space>
          <Space direction="vertical" size={8} align={isMobile ? "start" : "end"} style={{ flex: isMobile ? "1 1 100%" : "0 0 auto" }}>
            <Space size={8}>
              <Switch
                checked={director.attends}
                loading={busy === `attends-${director.id}`}
                onChange={(attends) => handlers.onToggleAttends(director, attends)}
                aria-label="I attend sessions"
              />
              <Typography.Text>{isMe ? "I attend sessions" : "Attends sessions"}</Typography.Text>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 260, textAlign: isMobile ? "left" : "right" }}>
              {director.attends ? "You're invited to sessions and can earn a certificate." : "Off: you follow your team's progress without attending."}
            </Typography.Text>
            <Button size="small" icon={<EditOutlined />} onClick={() => handlers.onEdit(director)}>
              Edit my details
            </Button>
          </Space>
        </div>
      </Card>

      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, gap: "4px 12px", flexWrap: "wrap" }}>
          <Typography.Title level={5} style={{ margin: 0, whiteSpace: "nowrap" }}>
            Employees <Typography.Text type="secondary">({active.length})</Typography.Text>
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Training Academy staff are told when you add or withdraw someone.
          </Typography.Text>
        </div>
        {!active.length ? (
          <Card>
            <Empty
              image={<UserOutlined style={{ fontSize: 40, color: token.colorTextQuaternary }} />}
              imageStyle={{ height: 48 }}
              description={
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>No employees yet</Typography.Text>
                  <Typography.Text type="secondary">
                    Add each person you're sending. They get their own login to confirm their sessions and check in with the session QR code.
                  </Typography.Text>
                </Space>
              }
            >
              <Button type="primary" shape="round" icon={<UserAddOutlined />} onClick={handlers.onAdd}>
                Add employee
              </Button>
            </Empty>
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {active.map((p) => (
              <Col key={p.id} xs={24} md={12} xl={8}>
                <Card
                  style={{ height: "100%" }}
                  styles={{ body: { padding: 16, display: "flex", flexDirection: "column", gap: 12, height: "100%" } }}
                >
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                    <Avatar size={44} style={{ background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 700, flexShrink: 0 }}>
                      {initials(p.name)}
                    </Avatar>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Typography.Text strong ellipsis style={{ display: "block" }}>
                        {p.name}
                      </Typography.Text>
                      {contact(p)}
                    </div>
                  </div>
                  {categories(p)}
                  {statusChips(p)}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => handlers.onEdit(p)}>
                      Edit
                    </Button>
                    <Button size="small" danger icon={<StopOutlined />} onClick={() => handlers.onWithdraw(p)}>
                      Withdraw
                    </Button>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      {!!withdrawn.length && (
        <Collapse
          ghost
          items={[
            {
              key: "withdrawn",
              label: `Withdrawn (${withdrawn.length})`,
              children: (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {withdrawn.map((p) => (
                    <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", opacity: 0.75 }}>
                      <Avatar size={28} style={{ flexShrink: 0 }}>
                        {initials(p.name)}
                      </Avatar>
                      <Typography.Text delete>{p.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {p.withdrawnReason}
                      </Typography.Text>
                    </div>
                  ))}
                </Space>
              ),
            },
          ]}
        />
      )}
    </Space>
  );
}
