import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Empty, Modal, Progress, Row, Space, Table, Tag, Typography, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BookOutlined,
  CheckCircleOutlined,
  ScheduleOutlined,
  ShopOutlined,
  TeamOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { Helmet } from "react-helmet";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { DashboardLoader } from "@/components/layout/DashboardLoader";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import UpcomingAppointmentsCard from "@/components/modals/UpcomingAppointmentsCard";
import AppointmentsCalendarModal from "@/components/modals/AppointmentsCalender";
import AppointmentDetailsModal from "@/components/modals/AppointmentDetails";
import { fetchAppointments } from "@/services/appointmentService";
import type { Training, TrainingEnrollment } from "@/components/trainings/trainingStorage";
import { orderedPlan, planSessionLabel } from "@/components/trainings/trainingPlan";
import { learnerCourseKey, useTrainingProgram } from "./useTrainingProgram";

const { Text } = Typography;

const TRAININGS = "/operations/training/trainings";
const TRAINING_SMES = "/operations/training/enroll";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

type DrillKey = "smes" | "sessions" | "courses" | "scores";

const DRILL_TITLES: Record<DrillKey, string> = {
  smes: "Enrolled SMEs",
  sessions: "Sessions",
  courses: "Course completion by SME",
  scores: "Assessment results",
};

type SmeRow = {
  sme: TrainingEnrollment;
  attended: number;
  held: number;
  coursePercent: number | null;
  averageScore: number | null;
  flags: string[];
};

/**
 * The Training Academy dashboard when a training is the active programme:
 * enrolment, delivery against the plan, attendance, course progress and
 * assessment results for that one training.
 */
export default function TrainingProgramDashboard({ training }: { training: Training }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useTrainingProgram(training);

  const view = useMemo(() => {
    if (!data) return null;
    const enrolled = data.smes.filter((s) => s.status === "enrolled");
    const discontinued = data.smes.filter((s) => s.status === "discontinued").length;
    const now = Date.now();
    const plan = orderedPlan(training.plan);
    const sessions = plan.map((p) => {
      const booked = p.appointmentSessionId ? data.booked[p.appointmentSessionId] : undefined;
      const invites = p.appointmentSessionId ? data.invitations[p.appointmentSessionId] || [] : [];
      const start = booked?.startAt?.toDate?.() || (p.startAt ? new Date(p.startAt) : null);
      return {
        plan: p,
        booked,
        invites,
        start,
        held: booked?.status === "completed",
        cancelled: booked?.status === "cancelled",
        upcoming: !!booked && booked.status !== "completed" && booked.status !== "cancelled" && !!start && start.getTime() >= now,
      };
    });
    const live = sessions.filter((s) => !s.cancelled);
    const held = live.filter((s) => s.held);
    const upcoming = live.filter((s) => s.upcoming).sort((a, b) => a.start!.getTime() - b.start!.getTime());
    const heldInvites = held.flatMap((s) => s.invites);
    const attendedTotal = heldInvites.filter((i) => i.attendance?.status === "attended").length;

    const courseIds = (training.courseIds || []).filter((id) => data.courseTitles[id]);
    const withLogin = enrolled.filter((s) => s.userId);
    const courses = courseIds.map((courseId) => {
      const values = withLogin.map((s) => data.progress[learnerCourseKey(s.userId!, courseId)]);
      const percents = values.map((v) => v?.percent || 0);
      return {
        courseId,
        title: data.courseTitles[courseId],
        average: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : 0,
        completed: values.filter((v) => v && v.required && v.completed === v.required).length,
        started: values.filter(Boolean).length,
      };
    });
    const allScores = Object.values(data.progress).flatMap((p) => p.scores || []);
    const averageScore = allScores.length ? Math.round(allScores.reduce((n, s) => n + s.score, 0) / allScores.length) : null;
    const passRate = allScores.length ? pct(allScores.filter((s) => s.score >= s.passMark).length, allScores.length) : null;

    const rows: SmeRow[] = enrolled.map((sme) => {
      const mine = held.flatMap((s) => s.invites.filter((i) => i.smeId === sme.id));
      const attended = mine.filter((i) => i.attendance?.status === "attended").length;
      const progress = sme.userId ? courseIds.map((c) => data.progress[learnerCourseKey(sme.userId!, c)]) : [];
      const coursePercent = sme.userId && courseIds.length ? Math.round(progress.reduce((n, p) => n + (p?.percent || 0), 0) / courseIds.length) : null;
      const scores = progress.flatMap((p) => p?.scores || []);
      const flags: string[] = [];
      if (!sme.userId) flags.push("No portal login");
      if (mine.length >= 2 && attended / mine.length < 0.75) flags.push("Low attendance");
      if (coursePercent === 0) flags.push("Courses not started");
      if (scores.some((s) => s.score < s.passMark)) flags.push("Failed an assessment");
      return {
        sme,
        attended,
        held: mine.length,
        coursePercent,
        averageScore: scores.length ? Math.round(scores.reduce((n, s) => n + s.score, 0) / scores.length) : null,
        flags,
      };
    });
    const overallCourse = rows.filter((r) => r.coursePercent !== null);
    return {
      enrolled,
      discontinued,
      withLogin,
      plan,
      live,
      held,
      upcoming,
      attendanceRate: heldInvites.length ? pct(attendedTotal, heldInvites.length) : null,
      courses,
      averageScore,
      passRate,
      rows,
      attention: rows.filter((r) => r.flags.length).sort((a, b) => b.flags.length - a.flags.length),
      courseAverage: overallCourse.length ? Math.round(overallCourse.reduce((n, r) => n + (r.coursePercent || 0), 0) / overallCourse.length) : null,
    };
  }, [data, training]);

  // Booked training sessions are appointments filed under the training's id,
  // so the programme view's appointments card and calendar work unchanged.
  const [appointments, setAppointments] = useState<any[]>([]);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAppointments({ programId: training.id })
      .then((rows) => !cancelled && setAppointments(Array.isArray(rows) ? rows : []))
      .catch(() => !cancelled && setAppointments([]));
    return () => {
      cancelled = true;
    };
  }, [training.id]);

  if (loading) return <DashboardLoader />;
  if (error || !view)
    return <Alert type="error" showIcon style={{ margin: 24 }} message={error || "Could not load this training."} action={<Button onClick={reload}>Retry</Button>} />;

  const start = dayjs(training.durationStart);
  const end = dayjs(training.durationEnd);
  const totalDays = Math.max(end.diff(start, "day"), 1);
  const elapsed = Math.min(Math.max(dayjs().diff(start, "day"), 0), totalDays);
  const phase = dayjs().isBefore(start) ? `Starts in ${start.diff(dayjs(), "day")} days` : dayjs().isAfter(end) ? "Finished" : `${end.diff(dayjs(), "day")} days left`;
  const unscheduled = view.live.filter((s) => !s.booked).length;
  const allScores = view.rows.flatMap((r) => (r.averageScore === null ? [] : [r]));

  // Two tiles carry the page on phones, as on every dashboard: who is enrolled and whether they turn up.
  const metrics: DashboardMetric[] = [
    {
      key: "smes",
      title: "Enrolled SMEs",
      value: view.enrolled.length,
      subtitle: `${view.withLogin.length} with portal login${view.discontinued ? ` · ${view.discontinued} discontinued` : ""}`,
      icon: <TeamOutlined style={{ fontSize: 20 }} />,
      tone: "accent",
      important: true,
      onClick: () => setDrillKey("smes"),
    },
    {
      key: "attendance",
      title: "Attendance",
      value: view.attendanceRate === null ? "—" : `${view.attendanceRate}%`,
      subtitle: view.held.length ? `Across ${view.held.length} session${view.held.length === 1 ? "" : "s"} held` : "No sessions held yet",
      icon: <CheckCircleOutlined style={{ fontSize: 20 }} />,
      tone: "success",
      important: true,
      onClick: () => setDrillKey("sessions"),
    },
    {
      key: "sessions",
      title: "Sessions held",
      value: `${view.held.length} / ${view.live.length}`,
      subtitle: `${view.upcoming.length} upcoming · ${unscheduled} not scheduled`,
      icon: <ScheduleOutlined style={{ fontSize: 20 }} />,
      tone: "info",
      onClick: () => setDrillKey("sessions"),
    },
    {
      key: "courses",
      title: "Course completion",
      value: view.courseAverage === null ? "—" : `${view.courseAverage}%`,
      subtitle: view.courses.length ? `Average across ${view.courses.length} course${view.courses.length === 1 ? "" : "s"}` : "No courses linked",
      icon: <BookOutlined style={{ fontSize: 20 }} />,
      tone: "warning",
      onClick: () => setDrillKey("courses"),
    },
    {
      key: "scores",
      title: "Assessment average",
      value: view.averageScore === null ? "—" : `${view.averageScore}%`,
      subtitle: view.passRate === null ? "No assessments taken yet" : `${view.passRate}% of attempts passed`,
      icon: <TrophyOutlined style={{ fontSize: 20 }} />,
      tone: "neutral",
      onClick: () => setDrillKey("scores"),
    },
  ];

  const smeIdentity = (sme: TrainingEnrollment) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span
        style={{
          width: 28,
          height: 28,
          flex: "0 0 28px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          color: token.colorPrimary,
          background: token.colorPrimaryBg,
        }}
      >
        <ShopOutlined />
      </span>
      <div style={{ minWidth: 0 }}>
        <Text strong style={{ display: "block" }}>
          {sme.name}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {sme.companyName}
        </Text>
      </div>
    </div>
  );

  const percentBar = (value: number | null) =>
    value === null ? (
      <Text type="secondary">—</Text>
    ) : (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Progress
          percent={value}
          showInfo={false}
          size="small"
          strokeColor={value >= 100 ? token.colorSuccess : token.colorPrimary}
          trailColor={token.colorFillSecondary}
          style={{ flex: 1, minWidth: 64, margin: 0 }}
        />
        <Text strong style={{ minWidth: 38, textAlign: "right", fontSize: 12 }}>
          {value}%
        </Text>
      </div>
    );

  const smeColumns: ColumnsType<SmeRow> = [
    { title: "SME", key: "sme", width: 260, render: (_, r) => smeIdentity(r.sme) },
    { title: "Attendance", key: "attendance", width: 120, render: (_, r) => (r.held ? `${r.attended}/${r.held}` : "—") },
    { title: "Courses", key: "courses", width: 200, render: (_, r) => percentBar(r.coursePercent) },
    { title: "Avg score", key: "score", width: 110, render: (_, r) => (r.averageScore === null ? "—" : `${r.averageScore}%`) },
    {
      title: "Flags",
      key: "flags",
      render: (_, r) =>
        r.flags.length ? (
          r.flags.map((f) => (
            <Tag key={f} color="orange">
              {f}
            </Tag>
          ))
        ) : (
          <Tag color="green">On track</Tag>
        ),
    },
  ];

  type SessionRow = (typeof view.live)[number];
  const sessionColumns: ColumnsType<SessionRow> = [
    { title: "Session", key: "title", render: (_, s) => <Text strong>{planSessionLabel(s.plan)}</Text> },
    {
      title: "When",
      key: "when",
      width: 190,
      render: (_, s) => (s.start ? dayjs(s.start).format("ddd DD MMM YYYY, HH:mm") : <Text type="secondary">Not dated</Text>),
    },
    { title: "Facilitator", key: "facilitator", width: 160, render: (_, s) => s.plan.facilitatorName || "—" },
    {
      title: "Status",
      key: "status",
      width: 130,
      render: (_, s) =>
        s.held ? <Tag color="green">Held</Tag> : s.booked ? <Tag color="blue">{s.upcoming ? "Upcoming" : "Scheduled"}</Tag> : <Tag>Not scheduled</Tag>,
    },
    {
      title: "Attendance",
      key: "attendance",
      width: 120,
      render: (_, s) => (s.invites.length ? `${s.invites.filter((i) => i.attendance?.status === "attended").length}/${s.invites.length}` : "—"),
    },
  ];

  const drillBody = () => {
    if (drillKey === "sessions")
      return view.live.length ? (
        <Table
          rowKey={(s) => s.plan.id}
          size="small"
          dataSource={view.live}
          columns={sessionColumns}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 5, showSizeChanger: false, position: ["bottomCenter"] }}
        />
      ) : (
        <Empty description="No sessions planned yet." />
      );
    const rows = drillKey === "scores" ? allScores : view.rows;
    return rows.length ? (
      <Table
        rowKey={(r) => r.sme.id}
        size="small"
        dataSource={rows}
        columns={smeColumns}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 5, showSizeChanger: false, position: ["bottomCenter"] }}
      />
    ) : (
      <Empty description={drillKey === "scores" ? "No assessments taken yet." : "No SMEs are enrolled in this training yet."} />
    );
  };

  return (
    <div style={{ padding: 24, minHeight: "100vh" }}>
      <Helmet>
        <title>{training.name} | Smart Incubation</title>
      </Helmet>

      <MetricsGrid metrics={metrics} />

      <Row gutter={[24, 24]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <MotionCard
              title="Who needs attention"
              extra={
                <Button type="link" onClick={() => navigate(TRAINING_SMES)} style={{ padding: 0 }}>
                  Training SMEs
                </Button>
              }
            >
              {view.attention.length ? (
                <Table
                  rowKey={(r) => r.sme.id}
                  size="small"
                  dataSource={view.attention}
                  columns={smeColumns.filter((c) => c.key !== "score")}
                  scroll={{ x: 560 }}
                  pagination={{ pageSize: 6, hideOnSinglePage: true, showSizeChanger: false, position: ["bottomCenter"] }}
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={view.enrolled.length ? "Every enrolled SME is on track." : "No SMEs are enrolled in this training yet."}
                />
              )}
            </MotionCard>

            <MotionCard title="Course progress">
              {view.courses.length ? (
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  {view.courses.map((c) => (
                    <div key={c.courseId}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <Text strong ellipsis>
                          <BookOutlined /> {c.title}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {c.completed} completed · {c.started} started
                        </Text>
                      </div>
                      {percentBar(c.average)}
                    </div>
                  ))}
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No courses linked to this training">
                  <Button shape="round" onClick={() => navigate(TRAININGS)}>
                    Link courses
                  </Button>
                </Empty>
              )}
            </MotionCard>
          </Space>
        </Col>

        <Col xs={24} xl={12}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <UpcomingAppointmentsCard programId={training.id} daysAhead={7} limit={8} onViewCalendar={() => setCalendarVisible(true)} />

            <MotionCard
              title="Delivery against plan"
              extra={
                <Tag color="blue" style={{ borderRadius: 999, marginInlineEnd: 0 }}>
                  {phase}
                </Tag>
              }
            >
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Training period
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {start.format("DD MMM")} – {end.format("DD MMM YYYY")}
                    </Text>
                  </div>
                  {percentBar(pct(elapsed, totalDays))}
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Sessions held
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {view.held.length} of {view.live.length}
                    </Text>
                  </div>
                  {percentBar(view.live.length ? pct(view.held.length, view.live.length) : null)}
                </div>
                <Space size={[8, 8]} wrap>
                  <Tag color="green">{view.held.length} held</Tag>
                  <Tag color="blue">{view.upcoming.length} upcoming</Tag>
                  <Tag color={unscheduled ? "orange" : "default"}>{unscheduled} not scheduled</Tag>
                </Space>
                <Button shape="round" icon={<ScheduleOutlined />} onClick={() => navigate(TRAININGS)} style={{ alignSelf: "flex-start" }}>
                  Open training plan
                </Button>
              </Space>
            </MotionCard>
          </Space>
        </Col>
      </Row>

      <Modal
        open={Boolean(drillKey)}
        onCancel={() => setDrillKey(null)}
        title={drillKey ? `${DRILL_TITLES[drillKey]} · ${training.name}` : ""}
        width="min(1100px, 94vw)"
        footer={null}
        destroyOnClose
        centered
      >
        {drillBody()}
      </Modal>

      <AppointmentsCalendarModal
        open={calendarVisible}
        onClose={() => setCalendarVisible(false)}
        appointments={appointments}
        onAppointmentClick={(appointment: any) => setSelectedAppointment(appointment)}
      />
      <AppointmentDetailsModal open={!!selectedAppointment} onClose={() => setSelectedAppointment(null)} appointment={selectedAppointment} />
    </div>
  );
}
