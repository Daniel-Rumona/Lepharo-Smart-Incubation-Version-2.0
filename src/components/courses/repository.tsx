import React, { useEffect, useState } from "react";
import {
  Alert,
  App,
  Badge,
  Button,
  Popover,
  Segmented,
  Empty,
  Input,
  Select,
  Dropdown,
  theme,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BookOutlined,
  EditOutlined,
  DeleteOutlined,
  UndoOutlined,
  PlusOutlined,
  SearchOutlined,
  FileTextOutlined,
  CloudSyncOutlined,
  FilterOutlined,
  EllipsisOutlined,
  PlayCircleOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import { FilterPanel } from "@/components/workspace";
import "@/routes/operations/movs/movs.css";
import {
  listCourses,
  setCourseDeleted,
  reviewQueue,
  courseAction,
  type SavedCourse,
  type Enrollment,
  type Course,
} from "./courseStorage";
import { MaterialPreview } from "./Materials";
import { learnerCoursePath } from "./learnerCourses";
import { listTrainings, type Training } from "@/components/trainings/trainingStorage";
import "./styles.css";
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
    [busy, setBusy] = useState(false),
    [trainings, setTrainings] = useState<Training[]>([]);
  useEffect(() => {
    listTrainings().then(setTrainings).catch(() => setTrainings([]));
  }, []);
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
  const formatDuration = (mins: number) => {
    if (mins <= 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };
  const activeCourses = courses.filter(c => !c.deletedAt);
  const trainingsFor = (courseId: string) => trainings.filter((t) => t.courseIds?.includes(courseId));
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
          value={`${window.location.origin}${learnerCoursePath(course.id)}`}
          onFocus={(e) => e.target.select()}
        />
      ),
      okText: "Done",
    });
  const statusCounts: Record<string, number> = {
    all: activeCourses.length,
    published: activeCourses.filter((c) => c.publishedRevision).length,
    draft: activeCourses.filter((c) => !c.publishedRevision).length,
    recovery: activeCourses.filter(recoveryOnly).length,
    deleted: courses.filter((c) => c.deletedAt).length,
  };
  // "Not synced" and "Deleted" only show when there's something in them.
  const statusSegments = [
    { value: "all", label: "All", tone: "neutral" },
    { value: "published", label: "Published", tone: "success" },
    { value: "draft", label: "Unpublished", tone: "warning" },
    { value: "recovery", label: "Not synced", tone: "danger" },
    { value: "deleted", label: "Deleted", tone: "neutral" },
  ].filter((segment) => !["recovery", "deleted"].includes(segment.value) || statusCounts[segment.value] > 0 || status === segment.value);
  const extraFilters = [level !== "all", sort !== "recent"].filter(Boolean).length;
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
      <DashboardFilterBar>
        <div className="ws-toolbar">
          <Segmented
            className="ws-toolbar-status mv-status-strip"
            block
            value={status}
            onChange={(value) => setStatus(String(value))}
            aria-label="Course status"
            options={statusSegments.map((segment) => ({
              value: segment.value,
              label: (
                <span className="mv-seg">
                  {segment.label}
                  {!loading && !error && <span className={`mv-seg-count qtx-tone-${segment.tone}`}>{statusCounts[segment.value]}</span>}
                </span>
              ),
            }))}
          />
          <Input
            className="ws-toolbar-search"
            prefix={<SearchOutlined />}
            placeholder="Search courses"
            aria-label="Search courses"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Popover
            trigger="click"
            placement="bottomLeft"
            title="Filters"
            content={
              <FilterPanel canReset={extraFilters > 0} onReset={() => { setLevel("all"); setSort("recent"); }}>
                <div>
                  <span className="ws-filter-label">Level</span>
                  <Segmented
                    block
                    value={level}
                    onChange={(value) => setLevel(String(value))}
                    options={[{ value: "all", label: "Any" }, ...["Beginner", "Intermediate", "Advanced"].map((value) => ({ value, label: value }))]}
                  />
                </div>
                <div>
                  <label className="ws-filter-label" htmlFor="course-sort">Order</label>
                  <Select
                    id="course-sort"
                    style={{ width: "100%" }}
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "recent", label: "Recently updated" },
                      { value: "oldest", label: "Oldest first" },
                      { value: "title", label: "Title A–Z" },
                    ]}
                  />
                </div>
              </FilterPanel>
            }
          >
            <Badge className="ws-toolbar-button" count={extraFilters} size="small" offset={[-6, 4]}>
              <Button block icon={<FilterOutlined />}>Filters</Button>
            </Badge>
          </Popover>
          <Button
            className="ws-toolbar-button"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate("/operations/training/courses/builder")}
          >
            New course
          </Button>
        </div>
      </DashboardFilterBar>
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
                      {trainingsFor(course.id).map((t) => (
                        <Tooltip key={t.id} title="Linked training — its SMEs take this course in their portal">
                          <Tag color="blue" icon={<ScheduleOutlined />} style={{ cursor: "pointer" }} onClick={() => navigate("/operations/training/trainings")}>
                            {t.name}
                          </Tag>
                        </Tooltip>
                      ))}
                    </Space>
                  </div>
                  <div className="course-repository-row-details">
                    <Space wrap>
                      <span><ApartmentOutlined /> {course.modules?.length || 1} modules</span>
                      <span><FileTextOutlined /> {course.items.length} items</span>
                      <span><ClockCircleOutlined /> {formatDuration(course.items.reduce((sum, item) => sum + item.minutes, 0))}</span>
                    </Space>
                    {recoveryOnly(course) && (
                      <Tooltip title="This draft's latest changes are only saved on this device — they haven't synced to the server yet. Reopen it here to retry saving.">
                        <Tag className="course-repository-row-recovery" icon={<CloudSyncOutlined />} color="warning">
                          Not synced
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                  <div className="course-repository-row-actions">
                    {course.deletedAt ? (
                      <Button shape="round" icon={<UndoOutlined />} onClick={() => void remove(course, false).catch((error) => message.error(error.message))}>Restore</Button>
                    ) : (
                      <>
                        <Button type="primary" shape="round" icon={<EditOutlined />} onClick={() => navigate(`/operations/training/courses/builder/${course.id}`)}>Edit draft</Button>
                        {!!course.publishedRevision && <Button shape="round" icon={<PlayCircleOutlined />} onClick={() => navigate(learnerCoursePath(course.id))}>Learner view</Button>}
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
