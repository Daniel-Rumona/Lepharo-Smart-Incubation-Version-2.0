import React from "react";
import { Alert, Button, Empty, Progress, Skeleton, Space, Tag, Typography } from "antd";
import { CheckCircleOutlined, PlayCircleOutlined, ReadOutlined, ReloadOutlined } from "@ant-design/icons";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { LEARNER_COURSES, learnerCoursePath, useLearnerCourses, type LearnerCourse } from "./learnerCourses";
import "./styles.css";

/** Old /academy/:id links (shared before the move) open the same course in the training family. */
export function AcademyRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? learnerCoursePath(id) : LEARNER_COURSES} replace />;
}

function actionLabel(course: LearnerCourse) {
  if (!course.progress) return "Start course";
  if (course.progress.required && course.progress.completed === course.progress.required) return "Review course";
  return "Continue";
}

/** /training/courses — the courses the signed-in learner can take, with their progress. */
export default function LearnerCatalog() {
  const navigate = useNavigate();
  const { courses, trainingName, loading, error, reload } = useLearnerCourses();

  const started = courses.filter((c) => c.progress);
  const done = started.filter((c) => c.progress!.required && c.progress!.completed === c.progress!.required);
  const count = (value: number) => (loading ? "…" : value);
  const metrics: DashboardMetric[] = [
    {
      key: "available",
      title: "Available",
      value: count(courses.length),
      subtitle: trainingName ? `Linked to ${trainingName}` : "Courses open to you",
      icon: <ReadOutlined style={{ fontSize: 20 }} />,
      tone: "accent",
      important: true,
    },
    {
      key: "progress",
      title: "In progress",
      value: count(started.length - done.length),
      subtitle: "Started, not yet complete",
      icon: <PlayCircleOutlined style={{ fontSize: 20 }} />,
      tone: "warning",
    },
    {
      key: "completed",
      title: "Completed",
      value: count(done.length),
      subtitle: "Every required item done",
      icon: <CheckCircleOutlined style={{ fontSize: 20 }} />,
      tone: "success",
      important: true,
    },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Courses
        </Typography.Title>
        <Typography.Text type="secondary">
          {trainingName ? `Learning for ${trainingName}` : "Training Academy courses"}
        </Typography.Text>
      </div>
      <MetricsGrid metrics={metrics} />
      {error ? (
        <Alert type="error" showIcon message={error} action={<Button icon={<ReloadOutlined />} onClick={reload}>Retry</Button>} />
      ) : loading ? (
        <Skeleton active />
      ) : !courses.length ? (
        <Empty
          description={
            trainingName !== undefined
              ? "No courses have been linked to your training yet."
              : "No published courses yet"
          }
        />
      ) : (
        <div className="course-repository-grid">
          {courses.map((course) => (
            <MotionCard key={course.id}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {course.title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ margin: 0 }}>
                  {course.description}
                </Typography.Paragraph>
                {course.progress ? (
                  <div>
                    <Progress percent={course.progress.percent} size="small" />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {course.progress.completed} of {course.progress.required} required complete
                    </Typography.Text>
                  </div>
                ) : (
                  <Tag>Not started</Tag>
                )}
                <Button type="primary" shape="round" onClick={() => navigate(learnerCoursePath(course.id))}>
                  {actionLabel(course)}
                </Button>
              </Space>
            </MotionCard>
          ))}
        </div>
      )}
    </div>
  );
}
