import React, { useEffect, useMemo, useState } from "react";
import { Empty, Input, Popover, Segmented, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { listTrainingAttendees } from "./attendeeStorage";
import {
  type Training,
  type TrainingAttendee,
  type TrainingEnrollment,
  enrollmentDocuments,
  listAllEnrollments,
  listTrainings,
  requiredDocumentsFor,
} from "./trainingStorage";

/** The training ids, so a page can tell a picked training from a programme. */
export function useTrainingIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    listTrainings()
      .then((t) => !cancelled && setIds(new Set(t.map((x) => x.id))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return ids;
}

type Row = {
  enrollment: TrainingEnrollment;
  people: TrainingAttendee[];
  missing: string[];
  peopleWithoutId: TrainingAttendee[];
};

/**
 * Compliance for a training picked in the programme selector: the documents
 * each SME has uploaded against the training's required documents, and their
 * people's ID copies (uploaded from the SME portal's People page).
 */
export default function TrainingComplianceView({ trainingId }: { trainingId: string }) {
  const [training, setTraining] = useState<Training>();
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [attendees, setAttendees] = useState<TrainingAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "missing">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // People are additive: if they can't be read the company documents still show.
    Promise.all([listTrainings(), listAllEnrollments(), listTrainingAttendees(trainingId).catch(() => [] as TrainingAttendee[])])
      .then(([t, e, a]) => {
        if (cancelled) return;
        setTraining(t.find((x) => x.id === trainingId));
        setEnrollments(e.filter((x) => x.trainingId === trainingId && x.status !== "discontinued"));
        setAttendees(a.filter((x) => x.status === "active"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trainingId]);

  const required = requiredDocumentsFor(training);

  const rows: Row[] = useMemo(
    () =>
      enrollments.map((enrollment) => {
        const onFile = new Set(enrollmentDocuments(enrollment).map((d) => d.label.toLowerCase()));
        const people = attendees.filter((a) => a.enrollmentId === enrollment.id);
        return {
          enrollment,
          people,
          missing: required.filter((label) => !onFile.has(label.toLowerCase())),
          peopleWithoutId: people.filter((p) => !p.idDocument),
        };
      }),
    [enrollments, attendees, required]
  );

  const visibleRows = rows.filter((r) => {
    if (show === "missing" && !r.missing.length && !r.peopleWithoutId.length) return false;
    const q = search.trim().toLowerCase();
    return !q || `${r.enrollment.name} ${r.enrollment.companyName}`.toLowerCase().includes(q);
  });
  const complete = rows.filter((r) => !r.missing.length && !r.peopleWithoutId.length).length;

  const columns: ColumnsType<Row> = [
    {
      title: "SME",
      key: "sme",
      fixed: "left",
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{r.enrollment.companyName || r.enrollment.name}</Typography.Text>
          {r.enrollment.companyName && <Typography.Text type="secondary">{r.enrollment.name}</Typography.Text>}
        </Space>
      ),
    },
    ...required.map((label) => ({
      title: label,
      key: `doc:${label}`,
      render: (_: unknown, r: Row) => {
        const d = enrollmentDocuments(r.enrollment).find((x) => x.label.toLowerCase() === label.toLowerCase());
        return d ? (
          <a href={d.url} target="_blank" rel="noreferrer">
            View
          </a>
        ) : (
          <Tag color="orange">Missing</Tag>
        );
      },
    })),
    {
      title: "Other uploads",
      key: "other",
      render: (_, r) => {
        const requiredSet = new Set(required.map((l) => l.toLowerCase()));
        const other = enrollmentDocuments(r.enrollment).filter((d) => !requiredSet.has(d.label.toLowerCase()));
        return other.length ? (
          <Space direction="vertical" size={0}>
            {other.map((d) => (
              <a key={d.label} href={d.url} target="_blank" rel="noreferrer">
                {d.label}
              </a>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        );
      },
    },
    {
      title: "People's ID copies",
      key: "people",
      render: (_, r) => {
        if (!r.people.length) return <Typography.Text type="secondary">No people yet</Typography.Text>;
        const onFile = r.people.length - r.peopleWithoutId.length;
        return (
          <Popover
            title="ID copies"
            content={
              <Space direction="vertical" size={2}>
                {r.people.map((p) =>
                  p.idDocument ? (
                    <a key={p.id} href={p.idDocument.url} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  ) : (
                    <Typography.Text key={p.id} type="secondary">
                      {p.name}: missing
                    </Typography.Text>
                  )
                )}
              </Space>
            }
          >
            <Tag color={r.peopleWithoutId.length ? "orange" : "green"} style={{ cursor: "pointer" }}>
              {onFile} of {r.people.length} on file
            </Tag>
          </Popover>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      render: (_, r) =>
        r.missing.length || r.peopleWithoutId.length ? <Tag color="orange">Incomplete</Tag> : <Tag color="green">Complete</Tag>,
    },
  ];

  if (loading) return <Spin style={{ margin: 40 }} />;
  if (!training) return <Empty description="This training could not be found." />;

  return (
    <div>
      <Typography.Title level={4}>{training.name}: SME documents</Typography.Title>
      <Typography.Paragraph type="secondary">
        {complete} of {rows.length} SMEs have every required document and ID copy on file.
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search by name or company"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ width: 260 }}
        />
        <Segmented
          value={show}
          onChange={(v) => setShow(v as "all" | "missing")}
          options={[
            { value: "all", label: "All SMEs" },
            { value: "missing", label: "Missing documents" },
          ]}
        />
      </Space>
      <Table
        rowKey={(r) => r.enrollment.id}
        dataSource={visibleRows}
        columns={columns}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 10, showSizeChanger: false, position: ["bottomCenter"] }}
        locale={{ emptyText: rows.length ? "No SMEs match." : "No SMEs are enrolled in this training yet." }}
      />
    </div>
  );
}
