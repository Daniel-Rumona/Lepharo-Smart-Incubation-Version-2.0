import React, { useEffect, useState } from "react";
import { App, Button, DatePicker, Dropdown, Input, Modal, Popconfirm, Segmented, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  MoreOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ReadOutlined,
  BookOutlined,
  FilePdfOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { MobileCardList } from "@/components/shared/MobileCardList";
import "@/components/shared/setup-segmented.css";

/** Tells the layout to refresh the trainings listed in the programme dropdown. */
const announceTrainingsChanged = () => window.dispatchEvent(new Event("training-programs-changed"));
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { TrainingForm, type TrainingFormValues } from "./TrainingForm";
import { TrainingPlanDrawer } from "./TrainingPlanDrawer";
import { CertificationSettingsModal } from "./CertificationSettingsModal";
import { CertificateTemplatesDrawer } from "./CertificateTemplatesDrawer";
import { listCatalog, type CatalogCourse } from "@/components/courses/learnerCourses";
import { EnrollSmeForm, type EnrollSmeFormValues } from "./EnrollSmeForm";
import { PickExistingSmeForm } from "./EnrollmentStatusForms";
import {
  type Training,
  type TrainingCenter,
  type TrainingEnrollment,
  assignTraining,
  createEnrollment,
  deleteTraining,
  listAllEnrollments,
  listBranches,
  listTrainings,
  saveTraining,
} from "./trainingStorage";

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

export default function AddTraining() {
  const { token } = theme.useToken();
  const { user } = useFullIdentity();
  const { message, modal } = App.useApp();
  const isMobile = useIsMobile();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [branches, setBranches] = useState<TrainingCenter[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [courses, setCourses] = useState<CatalogCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Training | null>(null);
  const [enrolling, setEnrolling] = useState<Training | null>(null);
  const [planning, setPlanning] = useState<Training | null>(null);
  /** The training whose certification rules are open, or "defaults" for the Academy-wide ones. */
  const [certifying, setCertifying] = useState<Training | "defaults" | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const { activeProgramId } = useActiveProgramId();
  const activeTraining = trainings.find((t) => t.id === activeProgramId);
  const [enrollMode, setEnrollMode] = useState<"new" | "existing">("new");

  const load = async () => {
    setLoading(true);
    try {
      const [t, b, e, c] = await Promise.all([
        listTrainings(),
        listBranches(),
        listAllEnrollments(),
        listCatalog().catch(() => [] as CatalogCourse[]),
      ]);
      setTrainings(t);
      setBranches(b);
      setEnrollments(e);
      setCourses(c);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not load trainings.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (t: Training) => {
    setEditing(t);
    setModalOpen(true);
  };
  const closeModal = () => setModalOpen(false);

  const openEnroll = (t: Training) => {
    setEnrollMode("new");
    setEnrolling(t);
  };

  const submit = async (values: TrainingFormValues) => {
    try {
      await saveTraining({ id: editing?.id, ...values }, user?.uid || "");
      message.success(editing ? "Training updated." : "Training added.");
      announceTrainingsChanged();
      setModalOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not save the training.");
    }
  };

  const remove = async (id: string) => {
    // Removing a training would orphan its SMEs (and their portal access) and booked sessions.
    const enrolledCount = enrollments.filter((e) => e.trainingId === id && e.status === "enrolled").length;
    const bookedCount = trainings.find((t) => t.id === id)?.plan?.filter((s) => s.appointmentSessionId).length || 0;
    if (enrolledCount || bookedCount) {
      message.warning(
        `This training has ${enrolledCount} enrolled SME${enrolledCount === 1 ? "" : "s"} and ${bookedCount} booked session${bookedCount === 1 ? "" : "s"}. Discontinue the SMEs and cancel the sessions first.`,
        6
      );
      return;
    }
    try {
      await deleteTraining(id);
      message.success("Training removed.");
      announceTrainingsChanged();
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not remove the training.");
    }
  };

  const submitEnroll = async (values: EnrollSmeFormValues) => {
    try {
      const result = await createEnrollment({ ...values, owner: user?.uid || "" });
      message.success(result.accountError ? "SME enrolled." : "SME enrolled and portal login emailed.");
      if (result.accountError) message.warning(result.accountError, 6);
      setEnrolling(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not enroll this SME.");
    }
  };

  const submitAssignExisting = async (smeId: string, categories: string[]) => {
    if (!enrolling) return;
    try {
      const result = await assignTraining(smeId, enrolling.id, categories);
      message.success(result.accountError ? "SME enrolled." : "SME enrolled and portal login emailed.");
      if (result.accountError) message.warning(result.accountError, 6);
      setEnrolling(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not enroll this SME.");
    }
  };

  const unassignedSmes = enrollments.filter((e) => e.status === "unassigned");

  const filtered = trainings.filter(
    (t) =>
      (!activeTraining || t.id === activeTraining.id) &&
      t.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!dateRange || (dayjs(t.durationStart).isSameOrBefore(dateRange[1], "day") && dayjs(t.durationEnd).isSameOrAfter(dateRange[0], "day")))
  );
  const uniqueCenters = new Set(trainings.flatMap((t) => t.centers.map((c) => c.id)));
  const withCourses = trainings.filter((t) => t.courseIds?.length).length;
  const courseTitles = new Map(courses.map((c) => [c.id, c.title]));
  const planLabel = (t: Training) => {
    const plan = t.deliveryPlan;
    if (!plan) return "Set up plan";
    if (plan.mode === "document") return "Plan document";
    return `${plan.items.length} item${plan.items.length === 1 ? "" : "s"}`;
  };
  const count = (value: number) => (loading ? "…" : value);

  const metrics: DashboardMetric[] = [
    {
      key: "total",
      title: "Total trainings",
      value: count(trainings.length),
      subtitle: "Set up so far",
      icon: <ReadOutlined style={{ color: token.colorPrimary }} />,
      important: true,
    },
    {
      key: "centers",
      title: "Centers covered",
      value: count(uniqueCenters.size),
      subtitle: "Branches running a training",
      icon: <EnvironmentOutlined style={{ color: token.colorInfo }} />,
      important: true,
    },
    {
      key: "courses",
      title: "With courses",
      value: count(withCourses),
      subtitle: "Linked to Academy courses",
      icon: <BookOutlined style={{ color: token.colorWarning }} />,
    },
  ];

  const toolbar = (
    // The shared setup toolbar: one line on wide screens, stacked full-width rows on phones.
    <div className="setup-toolbar">
      <div className="setup-toolbar-search" style={{ maxWidth: isMobile ? undefined : 320 }}>
        <Input.Search placeholder="Search trainings" value={search} onChange={(e) => setSearch(e.target.value)} allowClear />
      </div>
      <div className="setup-toolbar-search" style={{ maxWidth: isMobile ? undefined : 300 }}>
        <DatePicker.RangePicker
          value={dateRange}
          onChange={(range) => setDateRange(range && range[0] && range[1] ? [range[0], range[1]] : null)}
          format="DD MMM YYYY"
          placeholder={["From", "To"]}
          inputReadOnly={isMobile}
          style={{ width: "100%" }}
        />
      </div>
      <div className="setup-toolbar-action" style={{ marginLeft: isMobile ? undefined : "auto" }}>
      <Space size={8}>
        <Button type="primary" shape="round" icon={<PlusOutlined />} onClick={openCreate}>
          {isMobile ? "Add" : "Add Training"}
        </Button>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "defaults", icon: <SafetyCertificateOutlined />, label: "Certification defaults", onClick: () => setCertifying("defaults") },
              { key: "templates", icon: <FilePdfOutlined />, label: "Certificate templates", onClick: () => setTemplatesOpen(true) },
            ],
          }}
        >
          <Button shape="round" icon={<SafetyCertificateOutlined />}>
            Certification <DownOutlined />
          </Button>
        </Dropdown>
      </Space>
      </div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <MetricsGrid metrics={metrics} />
      <div style={{ height: 16 }} />
      {isMobile ? (
        // Phones drop the wrapping card: the toolbar stands on its own and the cards follow it.
        <>
          <DashboardFilterBar marginBottom={16} padding={14}>
            {toolbar}
          </DashboardFilterBar>
          <MobileCardList
            data={filtered}
            loading={loading}
            getKey={(t: Training) => t.id}
            emptyText="No trainings"
            renderCard={(t: Training) => ({
              title: t.name,
              subtitle: `${dayjs(t.durationStart).format("DD MMM YYYY")} – ${dayjs(t.durationEnd).format("DD MMM YYYY")}`,
              badge: t.certification ? <Tag color="gold">Own certification</Tag> : undefined,
              fields: [
                { label: "Centers", value: t.centers.map((c) => c.name).join(", ") || "—" },
                { label: "Plan", value: planLabel(t) },
                { label: "Categories", value: t.categories?.join(", ") || "—" },
                { label: "Courses", value: t.courseIds?.length ? t.courseIds.map((id) => courseTitles.get(id) || "Unavailable course").join(", ") : "—" },
              ],
              actions: [
                <Button key="plan" icon={<ScheduleOutlined />} onClick={() => setPlanning(t)}>
                  Plan
                </Button>,
                <Button key="enroll" icon={<UsergroupAddOutlined />} onClick={() => openEnroll(t)}>
                  Enroll
                </Button>,
                <Dropdown
                  key="more"
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "certification", icon: <SafetyCertificateOutlined />, label: "Certification rules", onClick: () => setCertifying(t) },
                      { key: "edit", icon: <EditOutlined />, label: "Edit", onClick: () => openEdit(t) },
                      {
                        key: "remove",
                        icon: <DeleteOutlined />,
                        danger: true,
                        label: "Remove",
                        onClick: () =>
                          modal.confirm({
                            title: "Remove this training?",
                            okText: "Remove",
                            okButtonProps: { danger: true },
                            centered: true,
                            className: "split-confirm",
                            onOk: () => remove(t.id),
                          }),
                      },
                    ],
                  }}
                >
                  <Button icon={<MoreOutlined />}>More</Button>
                </Dropdown>,
              ],
            })}
          />
        </>
      ) : (
        <MotionCard filterBarProps={{ marginBottom: 16, padding: 14 }} filterBar={toolbar}>
        <Table
          rowKey="id"
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false, position: ["bottomCenter"] }}
          columns={[
            { title: "Name", dataIndex: "name" },
            {
              title: "Duration",
              key: "duration",
              render: (_: unknown, record: Training) =>
                `${dayjs(record.durationStart).format("DD MMM YYYY")} – ${dayjs(record.durationEnd).format("DD MMM YYYY")}`,
            },
            {
              title: "Centers",
              dataIndex: "centers",
              render: (list: TrainingCenter[]) => list.map((c) => <Tag key={c.id}>{c.name}</Tag>),
            },
            {
              title: "Categories",
              dataIndex: "categories",
              render: (list: string[]) =>
                list?.length ? list.map((c) => <Tag key={c}>{c}</Tag>) : <Typography.Text type="secondary">—</Typography.Text>,
            },
            {
              title: "Courses",
              dataIndex: "courseIds",
              render: (ids: string[] | undefined) =>
                ids?.length ? (
                  ids.map((id) => (
                    <Tag key={id} color={courseTitles.has(id) ? "blue" : "default"} icon={<BookOutlined />}>
                      {courseTitles.get(id) || "Unavailable course"}
                    </Tag>
                  ))
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
            {
              title: "Plan",
              key: "plan",
              render: (_: unknown, record: Training) => (
                <Button size="small" shape="round" icon={<ScheduleOutlined />} onClick={() => setPlanning(record)}>
                  {planLabel(record)}
                </Button>
              ),
            },
            {
              title: "",
              key: "actions",
              width: 160,
              render: (_: unknown, record: Training) => (
                <Space>
                  <Tooltip title={record.certification ? "Certification: own rules" : "Certification: Academy defaults"}>
                    <Button
                      shape="circle"
                      size="small"
                      type={record.certification ? "primary" : "default"}
                      icon={<SafetyCertificateOutlined />}
                      onClick={() => setCertifying(record)}
                      aria-label={`Certification rules for ${record.name}`}
                    />
                  </Tooltip>
                  <Tooltip title="Enroll SMEs">
                    <Button shape="circle" size="small" icon={<UsergroupAddOutlined />} onClick={() => openEnroll(record)} />
                  </Tooltip>
                  <Button shape="circle" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                  <Popconfirm title="Remove this training?" onConfirm={() => void remove(record.id)}>
                    <Button shape="circle" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
        </MotionCard>
      )}

      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={editing ? "Edit training" : "Add a training"}
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        maskClosable={false}
        destroyOnClose
        width={640}
      >
        <TrainingForm initialValues={editing} branches={branches} onSubmit={submit} />
      </Modal>

      <CertificateTemplatesDrawer open={templatesOpen} onClose={() => setTemplatesOpen(false)} />

      <CertificationSettingsModal
        open={!!certifying}
        training={certifying === "defaults" ? null : certifying}
        courseTitles={courseTitles}
        onClose={() => setCertifying(null)}
        onSaved={() => void load()}
      />

      <TrainingPlanDrawer
        training={planning}
        enrollments={enrollments}
        onClose={() => setPlanning(null)}
        onSaved={(changes) => {
          setTrainings((list) => list.map((t) => (t.id === planning?.id ? { ...t, ...changes } : t)));
          setPlanning((t) => (t ? { ...t, ...changes } : t));
        }}
      />

      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={enrolling ? `Enroll SMEs into ${enrolling.name}` : "Enroll SMEs"}
        open={!!enrolling}
        onCancel={() => setEnrolling(null)}
        footer={null}
        maskClosable={false}
        destroyOnClose
        width={720}
      >
        {enrolling && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Segmented
              block
              value={enrollMode}
              onChange={(v) => setEnrollMode(v as "new" | "existing")}
              options={[
                { label: "New SME", value: "new" },
                { label: "Existing SME", value: "existing" },
              ]}
            />
            {enrollMode === "new" ? (
              <EnrollSmeForm
                trainings={[enrolling]}
                lockedTrainingId={enrolling.id}
                submitLabel="Enroll SME"
                onSubmit={submitEnroll}
              />
            ) : (
              <PickExistingSmeForm
                training={enrolling}
                candidates={unassignedSmes}
                onSubmit={submitAssignExisting}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
