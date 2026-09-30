import React, { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { type Training, type TrainingEnrollment, listAllEnrollments, listTrainings } from "./trainingStorage";

const STATUS_META = {
  unassigned: { color: "gold", label: "Awaiting training" },
  enrolled: { color: "green", label: "Enrolled" },
  discontinued: { color: "red", label: "Discontinued" },
} as const;

/**
 * Read-only view for departments granted "repository" access to a training
 * (see Training.access). Deliberately self-contained and separate from the
 * main incubatee table/detail workspace above it — a training-sourced SME
 * record has none of the intervention/KPI/compliance history that workspace
 * assumes, so it gets its own purpose-built view instead of trying to hide
 * pieces of that one.
 */
export default function TrainingSmesRepository({ onBack }: { onBack: () => void }) {
  const { user } = useFullIdentity();
  const userRecord = user as Record<string, unknown> | null;
  const department = String(userRecord?.departmentName || "").trim();
  const isCenterCoordinator = userRecord?.role === "projectadmin";
  const assignedBranch = String(userRecord?.assignedBranch || "").trim();

  const [trainings, setTrainings] = useState<Training[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [branchProvince, setBranchProvince] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState<string>();
  const [contentFilter, setContentFilter] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listTrainings(), listAllEnrollments(), getDocs(collection(db, "branches"))])
      .then(([t, e, branchSnap]) => {
        if (cancelled) return;
        setTrainings(t);
        setEnrollments(e);
        const map: Record<string, string> = {};
        branchSnap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const location = data.location as Record<string, unknown> | undefined;
          const province = (location?.province as string) || (data.province as string);
          if (province) map[d.id] = province;
        });
        setBranchProvince(map);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accessibleTrainings = useMemo(
    () =>
      trainings.filter((t) => {
        const departmentGranted = t.access?.some((a) => a.department === department && a.capabilities.includes("repository"));
        const coordinatorGranted = isCenterCoordinator && t.centerCoordinatorAccess && !!assignedBranch && t.centers.some((c) => c.id === assignedBranch);
        return departmentGranted || coordinatorGranted;
      }),
    [trainings, department, isCenterCoordinator, assignedBranch]
  );
  const accessibleIds = useMemo(() => new Set(accessibleTrainings.map((t) => t.id)), [accessibleTrainings]);
  const trainingById = useMemo(() => new Map(accessibleTrainings.map((t) => [t.id, t])), [accessibleTrainings]);

  const regionOf = (training?: Training) => {
    if (!training) return [] as string[];
    const set = new Set<string>();
    training.centers.forEach((c) => {
      const province = branchProvince[c.id];
      if (province) set.add(province);
    });
    return Array.from(set);
  };

  const showsProgress = accessibleTrainings.some(
    (t) =>
      t.access.some((a) => a.department === department && a.capabilities.includes("progress")) ||
      (isCenterCoordinator && t.centerCoordinatorAccess)
  );

  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    accessibleTrainings.forEach((t) => regionOf(t).forEach((r) => set.add(r)));
    return Array.from(set).sort();
  }, [accessibleTrainings, branchProvince]);

  const contentOptions = useMemo(() => {
    const set = new Set<string>();
    accessibleTrainings.forEach((t) => (t.categories || []).forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [accessibleTrainings]);

  const rows = enrollments.filter((e) => {
    if (!accessibleIds.has(e.trainingId)) return false;
    if (search && !(e.name + " " + e.companyName).toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (regionFilter && !regionOf(trainingById.get(e.trainingId)).includes(regionFilter)) return false;
    if (contentFilter && !e.categories?.includes(contentFilter)) return false;
    return true;
  });

  const columns: ColumnsType<TrainingEnrollment> = [
    { title: "Name", dataIndex: "name" },
    { title: "Company", dataIndex: "companyName" },
    { title: "Training", key: "training", render: (_, r) => trainingById.get(r.trainingId)?.name || "—" },
    {
      title: "Categories",
      dataIndex: "categories",
      render: (list: string[]) => (list?.length ? list.map((c) => <Tag key={c}>{c}</Tag>) : "—"),
    },
    {
      title: "Status",
      key: "status",
      render: (_, r) => {
        const meta = STATUS_META[r.status] || STATUS_META.unassigned;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "Documents",
      key: "documents",
      render: (_, r) => (
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
  ];
  if (showsProgress) {
    columns.push({ title: "Progress", key: "progress", render: () => <Tag>Tracking coming soon</Tag> });
  }

  if (loading) return <Spin style={{ margin: 40 }} />;

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 16 }}>
        Back to Incubatees
      </Button>
      <Typography.Title level={4}>Training SMEs</Typography.Title>
      {!accessibleTrainings.length ? (
        <Empty description="No trainings have been shared with your department yet." />
      ) : (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search placeholder="Search by name or company" value={search} onChange={(e) => setSearch(e.target.value)} allowClear style={{ width: 260 }} />
            <Select placeholder="Region" allowClear style={{ width: 180 }} value={regionFilter} onChange={setRegionFilter} options={regionOptions.map((r) => ({ value: r, label: r }))} />
            <Select placeholder="Content" allowClear style={{ width: 180 }} value={contentFilter} onChange={setContentFilter} options={contentOptions.map((c) => ({ value: c, label: c }))} />
          </Space>
          <Table rowKey="id" dataSource={rows} columns={columns} pagination={{ pageSize: 10, showSizeChanger: false, position: ["bottomCenter"] }} />
        </>
      )}
    </div>
  );
}
