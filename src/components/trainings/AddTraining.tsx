import React, { useEffect, useState } from "react";
import { App, Button, DatePicker, Input, Modal, Popconfirm, Segmented, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ReadOutlined,
  ReloadOutlined,
  TagsOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import "@/styles/nav-segmented.css";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { TrainingForm } from "./TrainingForm";
import { EnrollSmeForm } from "./EnrollSmeForm";
import { PickExistingSmeForm } from "./EnrollmentStatusForms";
import {
  type Training,
  type TrainingAccessGrant,
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
  const { message } = App.useApp();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [branches, setBranches] = useState<TrainingCenter[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Training | null>(null);
  const [enrolling, setEnrolling] = useState<Training | null>(null);
  const [enrollMode, setEnrollMode] = useState<"new" | "existing">("new");

  const load = async () => {
    setLoading(true);
    try {
      const [t, b, e] = await Promise.all([listTrainings(), listBranches(), listAllEnrollments()]);
      setTrainings(t);
      setBranches(b);
      setEnrollments(e);
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

  const submit = async (values: {
    name: string;
    durationStart: string;
    durationEnd: string;
    centers: TrainingCenter[];
    categories: string[];
    access: TrainingAccessGrant[];
    centerCoordinatorAccess: boolean;
    requiredDocuments: string[];
    requiredDetails: string[];
  }) => {
    try {
      await saveTraining({ id: editing?.id, ...values }, user?.uid || "");
      message.success(editing ? "Training updated." : "Training added.");
      setModalOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not save the training.");
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteTraining(id);
      message.success("Training removed.");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not remove the training.");
    }
  };

  const submitEnroll = async (values: {
    trainingId: string;
    name: string;
    companyName: string;
    categories: string[];
    idFile: File;
    qualificationFile: File;
    cvFile: File;
    registrationFormFile: File;
  }) => {
    try {
      await createEnrollment({ ...values, owner: user?.uid || "" });
      message.success("SME enrolled.");
      setEnrolling(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not enroll this SME.");
    }
  };

  const submitAssignExisting = async (smeId: string, categories: string[]) => {
    if (!enrolling) return;
    try {
      await assignTraining(smeId, enrolling.id, categories);
      message.success("SME enrolled.");
      setEnrolling(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not enroll this SME.");
    }
  };

  const unassignedSmes = enrollments.filter((e) => e.status === "unassigned");

  const filtered = trainings.filter(
    (t) =>
      t.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!dateRange || (dayjs(t.durationStart).isSameOrBefore(dateRange[1], "day") && dayjs(t.durationEnd).isSameOrAfter(dateRange[0], "day")))
  );
  const uniqueCenters = new Set(trainings.flatMap((t) => t.centers.map((c) => c.id)));
  const withCategories = trainings.filter((t) => t.categories?.length).length;
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
      key: "categories",
      title: "With categories",
      value: count(withCategories),
      subtitle: "Split by skill taught",
      icon: <TagsOutlined style={{ color: token.colorWarning }} />,
      important: true,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <MetricsGrid metrics={metrics} />
      <div style={{ height: 16 }} />
      <MotionCard
        filterBarProps={{ marginBottom: 16, padding: 14 }}
        filterBar={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <Space wrap>
              <Input.Search
                placeholder="Search trainings"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
                style={{ width: 280 }}
              />
              <DatePicker.RangePicker
                value={dateRange}
                onChange={(range) => setDateRange(range && range[0] && range[1] ? [range[0], range[1]] : null)}
                format="DD MMM YYYY"
                placeholder={["From", "To"]}
              />
            </Space>
            <Space wrap>
              <Button type="primary" shape="round" icon={<PlusOutlined />} onClick={openCreate}>
                Add Training
              </Button>
              <Button shape="round" icon={<ReloadOutlined />} onClick={load} loading={loading}>
                Refresh
              </Button>
            </Space>
          </div>
        }
      >
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
              title: "",
              key: "actions",
              width: 128,
              render: (_: unknown, record: Training) => (
                <Space>
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

      <Modal
        title={editing ? "Edit training" : "Add a training"}
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        maskClosable={false}
        destroyOnClose
        width={640}
      >
        <TrainingForm initialValues={editing} branches={branches} onSubmit={submit} onCancel={closeModal} />
      </Modal>

      <Modal
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
              className="nav-pill-segmented"
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
                onCancel={() => setEnrolling(null)}
              />
            ) : (
              <PickExistingSmeForm
                training={enrolling}
                candidates={unassignedSmes}
                onSubmit={submitAssignExisting}
                onCancel={() => setEnrolling(null)}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
