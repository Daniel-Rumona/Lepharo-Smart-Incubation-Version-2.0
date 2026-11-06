import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Col, Empty, Progress, Row, Skeleton, Space, Tag, Typography, theme } from "antd";
import {
  ArrowRightOutlined,
  BookOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { LEARNER_COURSES, learnerCoursePath, useLearnerCourses } from "@/components/courses/learnerCourses";
import { type AgendaEntry, useMyAgenda } from "./useMyAgenda";
import type { TrainingAttendee } from "./trainingStorage";
import type { TrainingCertificate, TrainingCompanyProgress } from "./certification";
import { loadCompanyProgress } from "./certificationStorage";
import { myIssuedCertificates } from "./certificateStorage";
import { EligibilityChecklist, EligibilityTag } from "./EligibilityTag";
import { RespondButtons, entryState, entryWhen } from "./SmePlan";

export const SME_AGENDA = "/training/agenda";
export const SME_PEOPLE = "/training/people";

/** /training — the training SME's home: progress, what's next, upcoming sessions and scores. */
export default function SmeDashboard() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const agenda = useMyAgenda();
  const { user, role, enrollmentId, companyName, attendee, training, error, entries, upcoming, agendaLoading, companyTotals } = agenda;
  const learning = useLearnerCourses();
  const isEmployee = role === "employee";
  // Kept by the progress function; until it exists the totals are counted from the agenda.
  const [summary, setSummary] = useState<TrainingCompanyProgress | null>(null);
  useEffect(() => {
    if (!enrollmentId) return;
    let cancelled = false;
    loadCompanyProgress(enrollmentId)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enrollmentId]);
  const [certificates, setCertificates] = useState<TrainingCertificate[]>([]);
  const attendeeId = attendee?.id || null;
  useEffect(() => {
    if (!enrollmentId) return;
    let cancelled = false;
    myIssuedCertificates(enrollmentId, attendeeId, !isEmployee)
      .then((list) => !cancelled && setCertificates(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enrollmentId, attendeeId, isEmployee]);

  if (agendaLoading) return <Skeleton active style={{ padding: 24 }} />;
  if (error || !enrollmentId) return <Alert type="warning" showIcon style={{ margin: 24 }} message={error || "No training is linked to your account yet."} />;

  const courses = learning.courses;
  const required = courses.reduce((n, c) => n + (c.progress?.required || 0), 0);
  const completed = courses.reduce((n, c) => n + (c.progress?.completed || 0), 0);
  const overall = required ? Math.round((completed / required) * 100) : 0;
  const coursesDone = courses.filter((c) => c.progress?.required && c.progress.completed === c.progress.required).length;
  const scores = courses.flatMap((c) => (c.progress?.scores || []).map((s) => ({ ...s, courseId: c.id, courseTitle: c.title })));
  const average = scores.length ? Math.round(scores.reduce((n, s) => n + s.score, 0) / scores.length) : null;
  // The viewer's own held sessions (ones they were invited to).
  const held = entries.filter((e) => e.status === "completed" && e.invitationId);
  const attended = held.filter((e) => e.attended).length;
  const totals = summary
    ? { invitations: summary.invitations, attended: summary.attendances, held: summary.sessionsHeld }
    : companyTotals;
  const companyPercent = totals?.invitations ? Math.round((totals.attended / totals.invitations) * 100) : null;
  const nextSession = upcoming[0];
  const nextCourse = courses.find((c) => !c.progress || c.progress.completed < c.progress.required);
  const end = training ? dayjs(training.durationEnd) : null;
  const daysLeft = end ? Math.max(end.endOf("day").diff(dayjs(), "day"), 0) : null;

  const nextTile: DashboardMetric = {
    key: "next",
    title: "Next session",
    value: nextSession?.startAt ? dayjs(nextSession.startAt).format("DD MMM") : "—",
    subtitle: nextSession ? nextSession.title : "Nothing booked yet",
    icon: <CalendarOutlined style={{ fontSize: 20 }} />,
    tone: "accent",
    important: true,
    onClick: () => navigate(SME_AGENDA),
  };
  // An employee takes no courses: their own attendance, what's next, and the company's totals only.
  const employeeMetrics: DashboardMetric[] = [
    {
      key: "attendance",
      title: "Your attendance",
      value: held.length ? `${attended} / ${held.length}` : "—",
      subtitle: held.length ? "Sessions attended / held" : "No sessions held yet",
      icon: <CheckCircleOutlined style={{ fontSize: 20 }} />,
      tone: "success",
      important: true,
    },
    nextTile,
    {
      key: "company",
      title: "Company attendance",
      value: companyPercent === null ? "—" : `${companyPercent}%`,
      subtitle: totals?.held
        ? `${totals.attended} of ${totals.invitations} invitations across ${totals.held} session${totals.held === 1 ? "" : "s"}`
        : "No sessions held yet",
      icon: <TeamOutlined style={{ fontSize: 20 }} />,
      tone: "info",
    },
  ];

  // As on every dashboard, phones show only the two important tiles: progress and the next session.
  const metrics: DashboardMetric[] = isEmployee ? employeeMetrics : [
    {
      key: "progress",
      title: "Overall progress",
      value: learning.loading ? "…" : `${overall}%`,
      subtitle: `${completed} of ${required} required course items`,
      icon: <CheckCircleOutlined style={{ fontSize: 20 }} />,
      tone: "success",
      important: true,
      onClick: () => navigate(LEARNER_COURSES),
    },
    nextTile,
    {
      key: "courses",
      title: "Courses",
      value: learning.loading ? "…" : `${coursesDone} / ${courses.length}`,
      subtitle: "Completed / linked to your training",
      icon: <ReadOutlined style={{ fontSize: 20 }} />,
      tone: "info",
      onClick: () => navigate(LEARNER_COURSES),
    },
    {
      key: "scores",
      title: "Average score",
      value: average === null ? "—" : `${average}%`,
      subtitle: scores.length ? `Across ${scores.length} assessment${scores.length === 1 ? "" : "s"}` : "No assessments taken yet",
      icon: <TrophyOutlined style={{ fontSize: 20 }} />,
      tone: "warning",
    },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Welcome, {String(user?.name || "").split(" ")[0] || "back"}
        </Typography.Title>
        <Typography.Text type="secondary">
          {[training ? `${training.name}${daysLeft !== null ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}` : "", companyName]
            .filter(Boolean)
            .join(" · ")}
        </Typography.Text>
      </div>

      <MetricsGrid metrics={metrics} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="What's next" style={{ height: "100%" }}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {nextSession ? (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    NEXT SESSION
                  </Typography.Text>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    <Space direction="vertical" size={2}>
                      <Space size={8} wrap>
                        <Typography.Text strong>{nextSession.title}</Typography.Text>
                        <Tag color={entryState(nextSession).color}>{entryState(nextSession).label}</Tag>
                      </Space>
                      <Typography.Text type="secondary">
                        <ClockCircleOutlined /> {entryWhen(nextSession)}
                        {nextSession.location ? ` · ${nextSession.location}` : ""}
                      </Typography.Text>
                    </Space>
                    <RespondButtons entry={nextSession} agenda={agenda} />
                  </div>
                </div>
              ) : (
                <Typography.Text type="secondary">No upcoming sessions are booked yet — they'll appear here once your trainer schedules them.</Typography.Text>
              )}
              {isEmployee ? null : nextCourse ? (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    CONTINUE LEARNING
                  </Typography.Text>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <Typography.Text strong>
                        <BookOutlined /> {nextCourse.title}
                      </Typography.Text>
                      <div>
                        <Typography.Text type="secondary">
                          {nextCourse.progress?.nextItem ? `Up next: ${nextCourse.progress.nextItem.title}` : "Not started"}
                        </Typography.Text>
                      </div>
                      <Progress percent={nextCourse.progress?.percent || 0} size="small" />
                    </div>
                    <Button type="primary" shape="round" onClick={() => navigate(learnerCoursePath(nextCourse.id))}>
                      {nextCourse.progress ? "Continue" : "Start"} <ArrowRightOutlined />
                    </Button>
                  </div>
                </div>
              ) : courses.length ? (
                <Alert type="success" showIcon message="You've completed every course linked to your training." />
              ) : null}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title="Coming up"
            style={{ height: "100%" }}
            extra={
              <Button type="link" onClick={() => navigate(SME_AGENDA)}>
                Full agenda
              </Button>
            }
          >
            {upcoming.length ? (
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                {upcoming.slice(0, 4).map((entry) => (
                  <div key={entry.key} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ minWidth: 44, textAlign: "center", color: token.colorPrimary }}>
                      <div style={{ fontSize: 11 }}>{dayjs(entry.startAt).format("MMM").toUpperCase()}</div>
                      <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{dayjs(entry.startAt).format("DD")}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text ellipsis style={{ display: "block" }}>
                        {entry.title}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(entry.startAt).format("HH:mm")} · {entryState(entry).label}
                      </Typography.Text>
                    </div>
                  </div>
                ))}
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing booked yet" />
            )}
            {!!held.length && (
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
                Attended {attended} of {held.length} session{held.length === 1 ? "" : "s"} held so far
              </Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      {(summary?.certificationEnabled || !!certificates.length) && summary && (
        <CertificationCard summary={summary} attendee={attendee} isDirector={!isEmployee} certificates={certificates} />
      )}

      {!isEmployee && <TeamCard entries={entries} />}

      {!isEmployee && (
      <Card title="Assessment scores">
        {scores.length ? (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {scores.map((s) => {
              const passed = s.score >= s.passMark;
              return (
                <div key={`${s.courseId}_${s.itemId}`} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <Typography.Text strong>{s.title}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {s.courseTitle} · {s.kind === "test" ? "Test" : "Quiz"} · pass mark {s.passMark}%
                      </Typography.Text>
                    </div>
                  </div>
                  <Progress type="circle" size={44} percent={s.score} status={passed ? "success" : "exception"} format={(p) => `${p}`} />
                  <Tag color={passed ? "green" : "red"}>{passed ? "Passed" : "Not yet"}</Tag>
                </div>
              );
            })}
          </Space>
        ) : (
          <Typography.Text type="secondary">Quiz and test results from your courses will show here.</Typography.Text>
        )}
      </Card>
      )}
    </div>
  );
}

/**
 * Where the viewer stands on their certificate: their own checklist, or in
 * company mode the company's. A director also sees how many of the company's
 * people are eligible or certified.
 */
function CertificationCard({
  summary,
  attendee,
  isDirector,
  certificates,
}: {
  summary: TrainingCompanyProgress;
  attendee: TrainingAttendee | null;
  isDirector: boolean;
  certificates: TrainingCertificate[];
}) {
  const company = summary.awardTo === "company";
  const eligibility = company ? summary.companyEligibility : attendee?.attends ? attendee.progress?.eligibility : undefined;
  const status = eligibility?.status;
  const headline =
    status === "certified"
      ? company ? "The company's certificate has been issued." : "Your certificate has been issued."
      : status === "eligible"
        ? company ? "The company qualifies: its certificate is being prepared." : "You qualify: your certificate is being prepared."
        : company ? "What the company still needs for its certificate:" : "What you still need for your certificate:";
  return (
    <Card title={<Space><SafetyCertificateOutlined /> Certification</Space>} extra={eligibility && <EligibilityTag eligibility={eligibility} />}>
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {eligibility ? (
          <>
            <Typography.Text strong>{headline}</Typography.Text>
            <EligibilityChecklist eligibility={eligibility} />
          </>
        ) : (
          <Typography.Text type="secondary">
            {company ? "The company's progress appears here once sessions are held." : "Certificates go to the people who attend; your team's progress is below."}
          </Typography.Text>
        )}
        {isDirector && !company && (
          <Typography.Text type="secondary">
            Team: {summary.eligiblePeople} eligible · {summary.certifiedPeople} certified · {summary.attendingPeople} attending
          </Typography.Text>
        )}
        {!!certificates.length && (
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ISSUED CERTIFICATES
            </Typography.Text>
            {certificates.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{c.recipientName}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.certificateNumber} · {c.issuedAt ? dayjs(c.issuedAt).format("D MMM YYYY") : ""} · code {c.verificationCode}
                  </Typography.Text>
                </Space>
                {c.pdfUrl && (
                  <Button shape="round" size="small" icon={<DownloadOutlined />} href={c.pdfUrl} target="_blank" rel="noreferrer">
                    Download
                  </Button>
                )}
              </div>
            ))}
          </Space>
        )}
      </Space>
    </Card>
  );
}

/**
 * The director's view of the company's people: for each person invited to a
 * session, how many held sessions they attended and what is still to come.
 */
function TeamCard({ entries }: { entries: AgendaEntry[] }) {
  const navigate = useNavigate();
  const now = Date.now();
  const people = new Map<string, { name: string; isMe: boolean; held: number; attended: number; upcoming: number }>();
  entries.forEach((e) =>
    e.people.forEach((p) => {
      const key = p.attendeeId || "sme";
      const row = people.get(key) || { name: p.name, isMe: p.isMe, held: 0, attended: 0, upcoming: 0 };
      if (e.status === "completed") {
        row.held += 1;
        if (p.attended) row.attended += 1;
      } else if (e.startAt && (e.endAt || e.startAt).getTime() >= now) row.upcoming += 1;
      people.set(key, row);
    })
  );
  const rows = [...people.values()].sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
  return (
    <Card
      title="Your team"
      extra={
        <Button type="link" icon={<TeamOutlined />} onClick={() => navigate(SME_PEOPLE)}>
          Manage people
        </Button>
      }
    >
      {rows.length ? (
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <Typography.Text strong>{r.isMe ? `${r.name} (you)` : r.name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.held ? `Attended ${r.attended} of ${r.held} held` : "No sessions held yet"}
                    {r.upcoming ? ` · ${r.upcoming} coming up` : ""}
                  </Typography.Text>
                </div>
              </div>
              <Progress percent={r.held ? Math.round((r.attended / r.held) * 100) : 0} size="small" style={{ width: 140, margin: 0 }} />
            </div>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary">Once sessions are booked, each person's attendance shows here. Add the employees you're sending under Manage people.</Typography.Text>
      )}
    </Card>
  );
}
