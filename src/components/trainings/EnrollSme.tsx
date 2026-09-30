import React, { useEffect, useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, theme } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, TeamOutlined, CheckCircleOutlined, ClockCircleOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { EnrollSmeForm } from "./EnrollSmeForm";
import { AssignTrainingForm, DiscontinueForm } from "./EnrollmentStatusForms";
import {
  type Training,
  type TrainingEnrollment,
  assignTraining,
  createEnrollment,
  deleteEnrollment,
  discontinueEnrollment,
  listAllEnrollments,
  listTrainings,
} from "./trainingStorage";

const STATUS_META = {
  unassigned: { color: "gold", label: "Awaiting training" },
  enrolled: { color: "green", label: "Enrolled" },
  discontinued: { color: "red", label: "Discontinued" },
} as const;

export default function EnrollSme() {
  const { token } = theme.useToken();
  const { user } = useFullIdentity();
  const { message } = App.useApp();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [trainingFilter, setTrainingFilter] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [assigning, setAssigning] = useState<TrainingEnrollment | null>(null);
  const [discontinuing, setDiscontinuing] = useState<TrainingEnrollment | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, e] = await Promise.all([listTrainings(), listAllEnrollments()]);
      setTrainings(t);
      setEnrollments(e);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not load enrollments.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const trainingName = (id: string) => trainings.find((t) => t.id === id)?.name || "—";

  const submitAdd = async (values: {
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
      message.success(values.trainingId ? "SME enrolled." : "SME added.");
      setAddOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not add this SME.");
    }
  };

  const submitAssign = async (trainingId: string, categories: string[]) => {
    if (!assigning) return;
    try {
      await assignTraining(assigning.id, trainingId, categories);
      message.success("SME enrolled.");
      setAssigning(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not enroll this SME.");
    }
  };

  const submitDiscontinue = async (reason: string) => {
    if (!discontinuing) return;
    try {
      await discontinueEnrollment(discontinuing.id, reason);
      message.success("Marked as discontinued.");
      setDiscontinuing(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not update this SME.");
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteEnrollment(id);
      message.success("Removed.");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not remove this record.");
    }
  };

  const filtered = enrollments.filter(
    (e) =>
      (!trainingFilter || e.trainingId === trainingFilter) &&
      (e.name + " " + e.companyName).toLowerCase().includes(search.trim().toLowerCase())
  );

  const enrolledCount = enrollments.filter((e) => e.status === "enrolled").length;
  const unassignedCount = enrollments.filter((e) => e.status === "unassigned").length;
  const discontinuedCount = enrollments.filter((e) => e.status === "discontinued").length;
  const count = (value: number) => (loading ? "…" : value);

  const metrics: DashboardMetric[] = [
    {
      key: "total",
      title: "Total SMEs",
      value: count(enrollments.length),
      subtitle: "Added so far",
      icon: <TeamOutlined style={{ color: token.colorPrimary }} />,
      important: true,
    },
    {
      key: "enrolled",
      title: "Enrolled",
      value: count(enrolledCount),
      subtitle: "Currently in a training",
      icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
      important: true,
    },
    {
      key: "unassigned",
      title: "Awaiting training",
      value: count(unassignedCount),
      subtitle: "Added, not yet enrolled",
      icon: <ClockCircleOutlined style={{ color: token.colorWarning }} />,
      important: true,
    },
    {
      key: "discontinued",
      title: "Discontinued",
      value: count(discontinuedCount),
      subtitle: "Stopped attending",
      icon: <StopOutlined style={{ color: token.colorError }} />,
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
              <Select
                placeholder="Filter by training"
                allowClear
                style={{ width: 220 }}
                value={trainingFilter}
                onChange={setTrainingFilter}
                options={trainings.map((t) => ({ value: t.id, label: t.name }))}
              />
              <Input.Search
                placeholder="Search by name or company"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
                style={{ width: 280 }}
              />
            </Space>
            <Space wrap>
              <Button type="primary" shape="round" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
                Add SME
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
            { title: "Company", dataIndex: "companyName" },
            { title: "Training", key: "training", render: (_: unknown, r: TrainingEnrollment) => trainingName(r.trainingId) },
            {
              title: "Categories",
              dataIndex: "categories",
              render: (list: string[]) => (list?.length ? list.map((c) => <Tag key={c}>{c}</Tag>) : "—"),
            },
            {
              title: "Status",
              key: "status",
              render: (_: unknown, r: TrainingEnrollment) => {
                const meta = STATUS_META[r.status] || STATUS_META.unassigned;
                const tag = <Tag color={meta.color}>{meta.label}</Tag>;
                return r.status === "discontinued" && r.discontinuedReason ? (
                  <Tooltip title={r.discontinuedReason}>{tag}</Tooltip>
                ) : (
                  tag
                );
              },
            },
            {
              title: "Documents",
              key: "documents",
              render: (_: unknown, r: TrainingEnrollment) => (
                <Space direction="vertical" size={0}>
                  {r.idDocument && (
                    <a href={r.idDocument.url} target="_blank" rel="noreferrer">
                      ID copy
                    </a>
                  )}
                  {r.qualificationDocument && (
                    <a href={r.qualificationDocument.url} target="_blank" rel="noreferrer">
                      Report / qualification
                    </a>
                  )}
                  {r.cvDocument && (
                    <a href={r.cvDocument.url} target="_blank" rel="noreferrer">
                      CV
                    </a>
                  )}
                  {r.registrationFormDocument && (
                    <a href={r.registrationFormDocument.url} target="_blank" rel="noreferrer">
                      Registration form
                    </a>
                  )}
                </Space>
              ),
            },
            { title: "Added", key: "createdAt", render: (_: unknown, r: TrainingEnrollment) => dayjs(r.createdAt).format("DD MMM YYYY") },
            {
              title: "",
              key: "actions",
              width: 180,
              render: (_: unknown, r: TrainingEnrollment) => (
                <Space>
                  {r.status === "unassigned" && (
                    <Button shape="round" size="small" type="primary" onClick={() => setAssigning(r)}>
                      Enroll
                    </Button>
                  )}
                  {r.status === "enrolled" && (
                    <Button shape="round" size="small" danger onClick={() => setDiscontinuing(r)}>
                      Discontinue
                    </Button>
                  )}
                  <Popconfirm title="Remove this SME?" onConfirm={() => void remove(r.id)}>
                    <Button shape="circle" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </MotionCard>

      <Modal title="Add an SME" open={addOpen} onCancel={() => setAddOpen(false)} footer={null} maskClosable={false} destroyOnClose width={720}>
        <EnrollSmeForm
          trainings={trainings}
          defaultTrainingId={trainingFilter}
          trainingRequired={false}
          onSubmit={submitAdd}
          onCancel={() => setAddOpen(false)}
        />
      </Modal>

      <Modal
        title={assigning ? `Enroll ${assigning.name}` : "Enroll"}
        open={!!assigning}
        onCancel={() => setAssigning(null)}
        footer={null}
        maskClosable={false}
        destroyOnClose
        width={560}
      >
        {assigning && <AssignTrainingForm trainings={trainings} onSubmit={submitAssign} onCancel={() => setAssigning(null)} />}
      </Modal>

      <Modal
        title={discontinuing ? `Discontinue ${discontinuing.name}` : "Discontinue"}
        open={!!discontinuing}
        onCancel={() => setDiscontinuing(null)}
        footer={null}
        maskClosable={false}
        destroyOnClose
        width={480}
      >
        {discontinuing && (
          <DiscontinueForm smeName={discontinuing.name} onSubmit={submitDiscontinue} onCancel={() => setDiscontinuing(null)} />
        )}
      </Modal>
    </div>
  );
}
