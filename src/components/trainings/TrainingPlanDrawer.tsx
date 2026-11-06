import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Modal,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Typography,
  Upload,
  theme,
} from "antd";
import { DeleteOutlined, FileTextOutlined, InboxOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import {
  type PlanDeliverer,
  type Training,
  type TrainingAttendee,
  type TrainingDeliveryMethod,
  type TrainingDeliveryPlan,
  type TrainingEnrollment,
  type TrainingPlanItem,
  uploadTrainingFile,
} from "./trainingStorage";
import { listTrainingAttendees, trainingInvitees } from "./attendeeStorage";
import { type TrainingStaff, listTrainingStaff, newPlanItemId, saveDeliveryPlan } from "./trainingPlan";

export const DELIVERY: { value: TrainingDeliveryMethod; label: string }[] = [
  { value: "in_person", label: "In person" },
  { value: "virtual", label: "Virtual" },
  { value: "telephonically", label: "Telephonically" },
];

const MAX_PLAN_DOCUMENT_MB = 15;

const staffRoleLabel = (role: string) => (role === "operations" ? "HOD" : "Coordinator");

/**
 * Picks who delivers a plan item: a Training Academy HOD or coordinator, or
 * any name typed in (an external provider, a guest speaker).
 */
export function DelivererSelect({
  staff,
  value,
  onChange,
  placeholder = "Pick someone or type a name",
}: {
  staff: TrainingStaff[];
  value?: PlanDeliverer | null;
  onChange?: (value: PlanDeliverer | null) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const selected = value ? (value.kind === "staff" ? `staff:${value.userId}` : `external:${value.name}`) : undefined;
  const staffOptions = staff.map((s) => ({ value: `staff:${s.id}`, label: `${s.name} · ${staffRoleLabel(s.role)}` }));
  // Someone picked earlier who has since left the department still shows by name.
  if (value?.kind === "staff" && !staff.some((s) => s.id === value.userId)) staffOptions.unshift({ value: selected!, label: value.name });
  const typedOptions = [
    ...(value?.kind === "external" && value.name !== typed ? [{ value: selected!, label: `${value.name} (not in the system)` }] : []),
    ...(typed && !staff.some((s) => s.name.toLowerCase() === typed.toLowerCase()) ? [{ value: `external:${typed}`, label: `Use “${typed}” (not in the system)` }] : []),
  ];
  return (
    <Select
      showSearch
      allowClear
      value={selected}
      placeholder={placeholder}
      optionFilterProp="label"
      searchValue={search}
      onSearch={setSearch}
      onChange={(next?: string) => {
        setSearch("");
        if (!next) return onChange?.(null);
        if (next.startsWith("external:")) return onChange?.({ kind: "external", name: next.slice("external:".length) });
        const person = staff.find((s) => `staff:${s.id}` === next);
        if (person) onChange?.({ kind: "staff", userId: person.id, name: person.name, email: person.email });
      }}
      options={[...typedOptions, ...(staffOptions.length ? [{ label: "Training Academy staff", options: staffOptions }] : [])]}
      notFoundContent={typed ? null : "No Training Academy staff found. Type a name instead."}
      style={{ width: "100%" }}
    />
  );
}

type PlanForm = { items: TrainingPlanItem[] };

/**
 * The training's plan: what will be covered and who delivers it, typed as a
 * list or uploaded as a document. Departments book sessions against it from
 * Appointments, where the booked sessions are shown.
 */
export function TrainingPlanDrawer({
  training,
  enrollments,
  onClose,
  onSaved,
}: {
  training: Training | null;
  enrollments: TrainingEnrollment[];
  onClose: () => void;
  onSaved: (changes: Partial<Training>) => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { user } = useFullIdentity();
  const isMobile = useIsMobile();
  const [form] = Form.useForm<PlanForm>();
  const [mode, setMode] = useState<TrainingDeliveryPlan["mode"]>("items");
  const [document, setDocument] = useState<TrainingDeliveryPlan["document"]>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<TrainingStaff[]>([]);
  const [attendees, setAttendees] = useState<TrainingAttendee[]>([]);

  const smes = useMemo(
    () => (training ? enrollments.filter((e) => e.trainingId === training.id && e.status === "enrolled") : []),
    [enrollments, training]
  );
  const peopleLabel = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

  useEffect(() => {
    const plan = training?.deliveryPlan;
    setMode(plan?.mode || "items");
    setDocument(plan?.document || null);
    // Only when a different training opens; saving updates `training` too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training?.id]);

  useEffect(() => {
    if (!training) return setAttendees([]);
    let cancelled = false;
    listTrainingAttendees(training.id)
      .then((list) => !cancelled && setAttendees(list))
      .catch(() => !cancelled && setAttendees([]));
    return () => {
      cancelled = true;
    };
  }, [training?.id]);

  useEffect(() => {
    if (!training) return;
    let cancelled = false;
    listTrainingStaff(String(user?.departmentId || ""))
      .then((list) => !cancelled && setStaff(list))
      .catch(() => !cancelled && setStaff([]));
    return () => {
      cancelled = true;
    };
  }, [training?.id, user?.departmentId]);

  const upload = async (file: File) => {
    if (!training) return;
    if (file.size > MAX_PLAN_DOCUMENT_MB * 1024 * 1024) {
      message.error(`The document must be under ${MAX_PLAN_DOCUMENT_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadTrainingFile(training.id, "plan", file);
      setDocument({ ...uploaded, uploadedAt: new Date().toISOString() });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not upload the document.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!training) return;
    let items: TrainingPlanItem[] = [];
    if (mode === "items") {
      const values = await form.validateFields().catch(() => null);
      if (!values) return;
      items = (values.items || [])
        .map((item) => ({ id: item.id || newPlanItemId(), topic: (item.topic || "").trim(), deliverer: item.deliverer || null }))
        .filter((item) => item.topic);
      if (!items.length) return void message.warning("Add at least one thing the training will cover.");
    } else {
      if (!document) return void message.warning("Upload the plan document first.");
      // The typed list is kept (not in force) so switching back loses nothing.
      items = (form.getFieldValue("items") || []).filter((item: TrainingPlanItem) => item?.topic?.trim());
    }
    const deliveryPlan: TrainingDeliveryPlan = {
      mode,
      items,
      document,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.uid || "",
    };
    setSaving(true);
    try {
      await saveDeliveryPlan(training.id, deliveryPlan);
      onSaved({ deliveryPlan });
      message.success("Plan saved. Departments can now book sessions against it from Appointments.");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not save the plan.");
    } finally {
      setSaving(false);
    }
  };

  const title = training ? `Training plan · ${training.name}` : "Training plan";
  const saveButton = (block: boolean) => (
    <Button type="primary" shape={block ? undefined : "round"} block={block} size={block ? "large" : undefined} loading={saving} disabled={uploading} onClick={() => void save()}>
      Save plan
    </Button>
  );
  // Narrow rows stack: what's covered, then who delivers it.
  const itemBasis = (desktop: string) => (isMobile ? "1 1 100%" : desktop);

  const content = training && (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Text type="secondary">
        {dayjs(training.durationStart).format("DD MMM YYYY")} – {dayjs(training.durationEnd).format("DD MMM YYYY")} · {smes.length} enrolled SME
        {smes.length === 1 ? "" : "s"} · {peopleLabel(trainingInvitees(smes, attendees, null).length)} attending
      </Typography.Text>

      <Alert
        type="info"
        showIcon
        message="Set out what the training covers and who delivers it. Departments then book each session from Appointments, choosing the plan item it delivers."
      />

      <Segmented
        block
        value={mode}
        onChange={(v) => setMode(v as TrainingDeliveryPlan["mode"])}
        options={[
          { label: "Type the plan", value: "items" },
          { label: "Upload a document", value: "document" },
        ]}
      />

      <div style={{ display: mode === "items" ? "block" : "none" }}>
        <Form
          key={training.id}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{
            items: training.deliveryPlan?.items?.length ? training.deliveryPlan.items : [{ id: newPlanItemId(), topic: "", deliverer: null }],
          }}
        >
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {fields.map((field, index) => (
                  <div
                    key={field.key}
                    style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", padding: 10, borderRadius: token.borderRadius, background: token.colorFillAlter }}
                  >
                    <Form.Item name={[field.name, "id"]} hidden>
                      <Input />
                    </Form.Item>
                    {!isMobile && (
                      <Typography.Text type="secondary" style={{ paddingTop: 5, minWidth: 18 }}>
                        {index + 1}.
                      </Typography.Text>
                    )}
                    <Form.Item
                      name={[field.name, "topic"]}
                      style={{ flex: itemBasis("2 1 240px"), margin: 0 }}
                      rules={[{ required: true, whitespace: true, message: "What will be covered?" }]}
                    >
                      <Input placeholder="What will be covered, e.g. Bookkeeping basics" />
                    </Form.Item>
                    <Form.Item name={[field.name, "deliverer"]} style={{ flex: isMobile ? "1 1 0" : "1 1 200px", margin: 0, minWidth: 0 }}>
                      <DelivererSelect staff={staff} placeholder="Delivered by" />
                    </Form.Item>
                    <Popconfirm title="Remove this item?" onConfirm={() => remove(field.name)}>
                      <Button shape="circle" size="small" danger icon={<DeleteOutlined />} aria-label="Remove item" style={{ marginTop: 4 }} />
                    </Popconfirm>
                  </div>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ id: newPlanItemId(), topic: "", deliverer: null })}>
                  Add item
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </div>

      {mode === "document" &&
        (document ? (
          <MotionCard styles={{ body: { padding: 14 } }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Space>
                <FileTextOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
                <div>
                  <Typography.Link href={document.url} target="_blank" rel="noreferrer" strong>
                    {document.name}
                  </Typography.Link>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Uploaded {dayjs(document.uploadedAt).format("DD MMM YYYY, HH:mm")}
                    </Typography.Text>
                  </div>
                </div>
              </Space>
              <Upload accept=".pdf,.doc,.docx" showUploadList={false} beforeUpload={(file) => (void upload(file), false)}>
                <Button shape="round" icon={<UploadOutlined />} loading={uploading}>
                  Replace
                </Button>
              </Upload>
            </Space>
          </MotionCard>
        ) : (
          <Upload.Dragger accept=".pdf,.doc,.docx" showUploadList={false} disabled={uploading} beforeUpload={(file) => (void upload(file), false)}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{uploading ? "Uploading…" : "Click or drop the plan document here"}</p>
            <p className="ant-upload-hint">A PDF or Word document saying what will be covered and who does what (up to {MAX_PLAN_DOCUMENT_MB} MB).</p>
          </Upload.Dragger>
        ))}
    </Space>
  );

  // Phones get the system's bottom sheet (mobile-sheet), like every other dialog.
  return isMobile ? (
    <Modal wrapClassName="mobile-sheet" centered title={title} open={!!training} onCancel={onClose} destroyOnClose footer={saveButton(true)}>
      {content}
    </Modal>
  ) : (
    <Drawer title={title} open={!!training} onClose={onClose} width={760} destroyOnClose extra={saveButton(false)}>
      {content}
    </Drawer>
  );
}
