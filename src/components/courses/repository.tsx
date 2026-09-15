import React, { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Select,
  Dropdown,
  theme,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  BookOutlined,
  EditOutlined,
  DeleteOutlined,
  UndoOutlined,
  PlusOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  CloudSyncOutlined,
  FilterOutlined,
  EllipsisOutlined,
  PlayCircleOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import {
  listCourses,
  setCourseDeleted,
  reviewQueue,
  courseAction,
  type SavedCourse,
  type Enrollment,
  type Course,
} from "./courseStorage";
import MetricsGrid from "@/components/dashboards/metrics/MetricsGrid";
import { MaterialPreview } from "./Materials";
import "./styles.css";
export function AcademyCatalog() {
  const [courses, setCourses] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    navigate = useNavigate();
  useEffect(() => {
    getDocs(collection(db, "academyCatalog"))
      .then((s) => setCourses(s.docs.filter(d => !d.data().deletedAt).map((d) => ({ ...d.data(), id: d.id }))))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3}>Training Academy courses</Typography.Title>
      {error ? (
        <Alert type="error" message={error} />
      ) : loading ? (
        <Spin />
      ) : !courses.length ? (
        <Empty description="No published courses yet" />
      ) : (
        <div className="course-repository-grid">
          {courses.map((course) => (
            <MotionCard key={course.id}>
              <Typography.Title level={4}>{course.title}</Typography.Title>
              <Typography.Paragraph>{course.description}</Typography.Paragraph>
              <Button
                type="primary"
                onClick={() => navigate(`/academy/${course.id}`)}
              >
                Open course
              </Button>
            </MotionCard>
          ))}
        </div>
      )}
    </div>
  );
}
export default function CoursesRepository() {
  const { token } = theme.useToken();
  const [status, setStatus] = useState("all");
  const [level, setLevel] = useState("all");
  const [sort, setSort] = useState("recent");
  const { user } = useFullIdentity(),
    { message } = App.useApp(),
    owner = user?.uid || "",
    navigate = useNavigate();
  const [courses, setCourses] = useState<SavedCourse[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [retry, setRetry] = useState(0),
    [reviewing, setReviewing] = useState<SavedCourse>(),
    [queue, setQueue] = useState<Enrollment[]>([]),
    [versions, setVersions] = useState<Record<string, Course>>({}),
    [feedback, setFeedback] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listCourses(owner)
      .then((rows) => {
        if (!cancelled) setCourses(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, retry]);
  async function reviews(course: SavedCourse) {
    setReviewing(course);
    setQueue([]);
    setVersions({});
    setBusy(true);
    try {
      const rows = await reviewQueue(owner, course.id);
      const entries = await Promise.all(
        [...new Set(rows.map((e) => `${e.courseId}_${e.revision}`))].map(
          async (id) => {
            const snap = await getDoc(doc(db, "academyVersions", id));
            return [id, snap.data()] as const;
          }
        )
      );
      setVersions(Object.fromEntries(entries) as Record<string, Course>);
      setQueue(rows);
    } catch (error) {
      message.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  const recoveryOnly = (course: SavedCourse) =>
    !!course.localRecovery || !course.revision;
  const activeCourses = courses.filter(c => !c.deletedAt);
  async function remove(course: SavedCourse, deleted: boolean) {
    await setCourseDeleted(course, deleted);
    setRetry(n => n + 1);
    message.success(deleted ? "Course moved to Deleted." : "Course restored.");
  }
  const filtered = courses
    .filter(
      (course) =>
        (status === "deleted" ? !!course.deletedAt : !course.deletedAt) &&
        (course.title + " " + course.description)
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (status === "all" || status === "deleted" ||
          (status === "published"
            ? !!course.publishedRevision
            : status === "draft"
            ? !course.publishedRevision
            : recoveryOnly(course))) &&
        (level === "all" || course.level === level)
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "oldest"
        ? a.updatedAt.localeCompare(b.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt)
    );
  const shareLink = (course: SavedCourse) =>
    Modal.info({
      className: "academy-modal",
      title: "Learner course link",
      content: (
        <Input
          readOnly
          value={`${window.location.origin}/academy/${course.id}`}
          onFocus={(e) => e.target.select()}
        />
      ),
      okText: "Done",
    });
  const count = (value: number) => (loading ? "…" : error ? "—" : value);
  const metrics = [
    {
      key: "all",
      title: "Total courses",
      value: count(activeCourses.length),
      subtitle: "Your course repository",
      icon: <BookOutlined style={{ color: token.colorPrimary }} />,
      important: true,
      onClick: () => setStatus("all"),
    },
    {
      key: "published",
      title: "Published",
      value: count(activeCourses.filter((c) => c.publishedRevision).length),
      subtitle: "Have a published version",
      icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
      important: true,
      onClick: () => setStatus("published"),
    },
    {
      key: "draft",
      title: "Unpublished",
      value: count(activeCourses.filter((c) => !c.publishedRevision).length),
      subtitle: "Still being prepared",
      icon: <FileTextOutlined style={{ color: token.colorWarning }} />,
      important: true,
      onClick: () => setStatus("draft"),
    },
    {
      key: "recovery",
      title: "Not synced",
      value: count(activeCourses.filter(recoveryOnly).length),
      subtitle: "Local recovery copies",
      icon: <CloudSyncOutlined style={{ color: token.colorError }} />,
      important: true,
      onClick: () => setStatus("recovery"),
    },
  ];
  return (
    <div
      className="course-repository"
      style={
        {
          padding: 24,
          "--repo-border": token.colorBorderSecondary,
          "--repo-accent": token.colorPrimary,
          "--repo-accent-bg": token.colorPrimaryBg,
          "--repo-subtle": token.colorFillAlter,
        } as React.CSSProperties
      }
    >
      <MetricsGrid metrics={metrics} />
      <MotionCard
        size="small"
        className="course-repository-filter"
        styles={{ body: { padding: "14px 16px" } }}
      >
        <div className="course-repository-filter-controls">
          <FilterOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
          <Input
            className="course-repository-search"
            prefix={<SearchOutlined />}
            placeholder="Search courses"
            aria-label="Search courses"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Select
            aria-label="Course status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "published", label: "Published" },
              { value: "draft", label: "Unpublished" },
              { value: "recovery", label: "Not synced" },
              { value: "deleted", label: "Deleted" },
            ]}
          />
          <Select
            aria-label="Course level"
            value={level}
            onChange={setLevel}
            options={[
              { value: "all", label: "All levels" },
              ...["Beginner", "Intermediate", "Advanced"].map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
          <Select
            aria-label="Sort courses"
            value={sort}
            onChange={setSort}
            options={[
              { value: "recent", label: "Recently updated" },
              { value: "oldest", label: "Oldest first" },
              { value: "title", label: "Title A–Z" },
            ]}
          />
          <Button
            type="primary"
            shape="round"
            icon={<PlusOutlined />}
            onClick={() => navigate("/operations/training/courses/builder")}
          >
            New course
          </Button>
        </div>
      </MotionCard>
      {loading ? (
        <Spin />
      ) : error ? (
        <Alert
          type="error"
          message={error}
          action={<Button onClick={() => setRetry((n) => n + 1)}>Retry</Button>}
        />
      ) : !filtered.length ? (
        <Empty
          description={
            courses.length
              ? "No courses match these filters"
              : "Create your first course to start building a learning journey"
          }
        />
      ) : (
        <div className="course-repository-rows">
          {filtered.map((course) => {
            const menuItems = [
              ...(course.publishedRevision
                ? [
                    {
                      key: "review",
                      label: "Review submissions",
                      onClick: () => void reviews(course),
                    },
                    ...(!course.deletedAt
                      ? [
                          {
                            key: "link",
                            label: "Course link",
                            onClick: () => shareLink(course),
                          },
                        ]
                      : []),
                  ]
                : []),
              ...(!course.deletedAt
                ? [
                    {
                      key: "delete",
                      label: "Delete course",
                      danger: true,
                      icon: <DeleteOutlined />,
                      onClick: () =>
                        Modal.confirm({
                          className: "academy-modal",
                          title: `Delete “${course.title}”?`,
                          content:
                            "This removes the course from the active repository and closes new enrollment. Existing learner progress is retained. You can restore it from the Deleted filter.",
                          okText: "Delete course",
                          okButtonProps: { danger: true },
                          cancelText: "Keep course",
                          onOk: async () => {
                            try {
                              await remove(course, true);
                            } catch (error) {
                              message.error(String(error));
                              throw error;
                            }
                          },
                        }),
                    },
                  ]
                : []),
            ];
            return (
              <MotionCard
                key={course.id}
                className="course-repository-row"
                styles={{ body: { padding: "12px 16px" } }}
              >
                <div className="course-repository-row-content">
                  <span className="course-repository-icon"><BookOutlined /></span>
                  <div className="course-repository-row-summary">
                    <Typography.Title level={4} style={{ margin: 0 }}>{course.title}</Typography.Title>
                    <Space size={6} wrap>
                      <Tag color={course.deletedAt ? "default" : course.publishedRevision ? "green" : "gold"}>
                        {course.deletedAt ? "Deleted" : course.publishedRevision ? `Published v${course.publishedRevision}` : "Draft"}
                      </Tag>
                      <Typography.Text type="secondary">{course.level}</Typography.Text>
                    </Space>
                  </div>
                  <div className="course-repository-row-details">
                    <Space wrap>
                      <span><ApartmentOutlined /> {course.modules?.length || 1} modules</span>
                      <span><FileTextOutlined /> {course.items.length} items</span>
                      <span><ClockCircleOutlined /> {course.items.reduce((sum, item) => sum + item.minutes, 0)} min</span>
                    </Space>
                    {recoveryOnly(course) && <Typography.Text type="warning" style={{ display: "block", marginTop: 6 }}><CloudSyncOutlined /> Local recovery</Typography.Text>}
                  </div>
                  <div className="course-repository-row-actions">
                    {course.deletedAt ? (
                      <Button shape="round" icon={<UndoOutlined />} onClick={() => void remove(course, false).catch((error) => message.error(error.message))}>Restore</Button>
                    ) : (
                      <>
                        <Button type="primary" shape="round" icon={<EditOutlined />} onClick={() => navigate(`/operations/training/courses/builder/${course.id}`)}>Edit draft</Button>
                        {!!course.publishedRevision && <Button shape="round" icon={<PlayCircleOutlined />} onClick={() => navigate(`/academy/${course.id}`)}>Learner view</Button>}
                      </>
                    )}
                    <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                      <Button shape="circle" icon={<EllipsisOutlined />} aria-label={`More actions for ${course.title}`} />
                    </Dropdown>
                  </div>
                </div>
              </MotionCard>
            );
          })}
        </div>
      )}
      <Modal
        className="academy-modal"
        open={!!reviewing}
        title="Assignment submissions"
        width={800}
        onCancel={() => setReviewing(undefined)}
        footer={
          <Button block onClick={() => setReviewing(undefined)}>
            Close
          </Button>
        }
      >
        {busy ? (
          <Spin />
        ) : queue.length ? (
          queue.flatMap((enrollment) =>
            Object.entries(enrollment.items)
              .filter(([, p]) => p.status === "submitted")
              .map(([itemId, p]) => {
                const item = versions[
                    `${enrollment.courseId}_${enrollment.revision}`
                  ]?.items.find((i) => i.id === itemId),
                  key = `${enrollment.id}_${itemId}`;
                return (
                  <MotionCard key={key} style={{ marginBottom: 12 }}>
                    <Typography.Title level={5}>
                      {item?.title || "Assignment"} · v{enrollment.revision}
                    </Typography.Title>
                    <Typography.Paragraph type="secondary">
                      Learner: {enrollment.learnerName || enrollment.learnerId}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      <strong>Criteria:</strong> {item?.rubric}
                    </Typography.Paragraph>
                    <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                      {p.text}
                    </Typography.Paragraph>
                    <MaterialPreview materials={p.files || []} />
                    <Input.TextArea
                      rows={3}
                      value={feedback[key] || ""}
                      placeholder="Feedback for the learner"
                      onChange={(e) =>
                        setFeedback({ ...feedback, [key]: e.target.value })
                      }
                    />
                    <div className="course-footer">
                      {(["revise", "approve"] as const).map((decision) => (
                        <Button
                          key={decision}
                          type={decision === "approve" ? "primary" : "default"}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await courseAction("review", {
                                enrollmentId: enrollment.id,
                                itemId,
                                decision,
                                feedback: feedback[key] || "",
                              });
                              await reviews(reviewing!);
                            } catch (error) {
                              message.error(String(error));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {decision === "approve"
                            ? "Approve completion"
                            : "Request changes"}
                        </Button>
                      ))}
                    </div>
                  </MotionCard>
                );
              })
          )
        ) : (
          <Empty description="No assignments awaiting review" />
        )}
      </Modal>
    </div>
  );
}
