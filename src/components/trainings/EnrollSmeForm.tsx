import React, { useState } from "react";
import { useFormChanged } from "@/lib/useFormChanged";
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Typography, Upload, theme } from "antd";
import { CheckCircleFilled, CheckCircleOutlined, DeleteOutlined, EditOutlined, FileOutlined, PlusOutlined } from "@ant-design/icons";
import {
  TRAINING_DETAIL_FIELDS,
  enrollmentDocuments,
  requiredDocumentsFor,
  type Training,
  type TrainingEnrollment,
} from "./trainingStorage";

type FormShape = {
  trainingId: string;
  name: string;
  companyName: string;
  email: string;
  categories?: string[];
  details?: Record<string, string | number | null>;
};

export type EnrollSmeFormValues = {
  trainingId: string;
  name: string;
  companyName: string;
  email: string;
  categories: string[];
  details: Record<string, string>;
  /** Newly attached files, labelled with the required document they meet. */
  files: { label: string; file: File }[];
};

const PROVINCES = ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"];
const BEE_LEVELS = ["Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8", "Non-compliant"];

/** Form.Item hands value/onChange to this wrapper, so they must be passed on to the real input. */
function DetailInput({ field, ...control }: { field: string; value?: any; onChange?: (value: any) => void; id?: string }) {
  if (field === "gender") return <Select {...control} options={["Female", "Male", "Other"].map((v) => ({ value: v, label: v }))} placeholder="Choose" />;
  if (field === "province") return <Select {...control} showSearch options={PROVINCES.map((v) => ({ value: v, label: v }))} placeholder="Choose a province" />;
  if (field === "beeLevel") return <Select {...control} options={BEE_LEVELS.map((v) => ({ value: v, label: v }))} placeholder="Choose a level" />;
  if (field.endsWith("Percent")) return <InputNumber {...control} min={0} max={100} addonAfter="%" style={{ width: "100%" }} />;
  return <Input {...control} />;
}

/**
 * Adds (or, with `enrollment`, edits) a training SME. The documents and
 * profile details asked for follow the chosen training's requiredDocuments
 * and requiredDetails; an SME not yet in a training gets the default set.
 */
export function EnrollSmeForm({
  trainings,
  enrollment,
  defaultTrainingId,
  lockedTrainingId,
  trainingRequired = true,
  submitLabel,
  onSubmit,
}: {
  trainings: Training[];
  /** Edit mode: the SME being corrected. Documents become optional (only missing ones are flagged). */
  enrollment?: TrainingEnrollment;
  defaultTrainingId?: string;
  /** When set, the training is fixed to this one and the picker is disabled. */
  lockedTrainingId?: string;
  /** When false, the training field is optional — the SME can be added and enrolled into a training later. */
  trainingRequired?: boolean;
  submitLabel?: string;
  onSubmit: (values: EnrollSmeFormValues) => Promise<void>;
}) {
  const { token } = theme.useToken();
  const [form] = Form.useForm<FormShape>();
  const watchedTrainingId = Form.useWatch("trainingId", form);
  const isEdit = !!enrollment;
  const fixedTrainingId = lockedTrainingId ?? (isEdit ? enrollment.trainingId : undefined);
  const trainingId = fixedTrainingId ?? watchedTrainingId ?? defaultTrainingId;
  const training = trainings.find((t) => t.id === trainingId);
  const required = requiredDocumentsFor(training);
  const onFile = new Map(enrollment ? enrollmentDocuments(enrollment).map((d) => [d.label.toLowerCase(), d]) : []);
  const detailFields = (training?.requiredDetails || [])
    .filter((key) => key !== "email")
    .map((key) => TRAINING_DETAIL_FIELDS.find((f) => f.key === key))
    .filter((f): f is { key: string; label: string } => !!f);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Chosen documents live outside the form, so they count as a change too.
  const changed = useFormChanged(
    form,
    Object.entries(files)
      .filter(([, f]) => !!f)
      .map(([label, f]) => `${label}:${f!.name}`)
  );

  const handleFinish = async (values: FormShape) => {
    const missing = required.filter((label) => !files[label] && !onFile.has(label.toLowerCase()));
    if (missing.length && !isEdit) {
      setFileError(`Attach: ${missing.join(", ")}.`);
      return;
    }
    const finalTrainingId = fixedTrainingId ?? values.trainingId ?? "";
    setFileError("");
    setSubmitting(true);
    try {
      await onSubmit({
        trainingId: finalTrainingId,
        name: values.name.trim(),
        companyName: values.companyName.trim(),
        email: values.email.trim().toLowerCase(),
        categories: values.categories || [],
        details: Object.fromEntries(
          Object.entries(values.details || {})
            .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
            .map(([k, v]) => [k, String(v).trim()])
        ),
        files: Object.entries(files)
          .filter((entry): entry is [string, File] => !!entry[1])
          .map(([label, file]) => ({ label, file })),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleFinish}
      autoComplete="off"
      initialValues={
        enrollment
          ? {
              trainingId: enrollment.trainingId,
              name: enrollment.name,
              companyName: enrollment.companyName,
              email: enrollment.email,
              categories: enrollment.categories,
              details: enrollment.details || {},
            }
          : { trainingId: lockedTrainingId ?? defaultTrainingId }
      }
    >
      {fixedTrainingId !== undefined ? (
        <Form.Item name="trainingId" hidden initialValue={fixedTrainingId}>
          <Input />
        </Form.Item>
      ) : (
        <Form.Item
          label="Training"
          name="trainingId"
          rules={trainingRequired ? [{ required: true, message: "Choose a training" }] : []}
        >
          <Select
            allowClear={!trainingRequired}
            placeholder={trainingRequired ? "Choose a training" : "Choose a training (optional — you can enroll them later)"}
            onChange={() => {
              form.setFieldValue("categories", undefined);
              setFiles({});
            }}
            options={trainings.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>
      )}

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item label="SME name" name="name" rules={[{ required: true, whitespace: true, message: "Add the SME's name" }]}>
            <Input placeholder="Full name" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item label="Company name" name="companyName" rules={[{ required: true, whitespace: true, message: "Add the company name" }]}>
            <Input placeholder="Company name" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item
        label="Email address"
        name="email"
        extra={
          enrollment?.userId
            ? "This is their portal login, so it can't be changed here."
            : "Their training portal login is sent here once they are enrolled."
        }
        rules={[
          { required: true, message: "Add the SME's email address" },
          { type: "email", message: "Enter a valid email address" },
        ]}
      >
        <Input placeholder="name@company.co.za" disabled={!!enrollment?.userId} />
      </Form.Item>

      {!!detailFields.length && (
        <Row gutter={16}>
          {detailFields.map((f) => (
            <Col xs={24} sm={12} key={f.key}>
              <Form.Item label={f.label} name={["details", f.key]} rules={[{ required: true, message: `Add ${f.label.toLowerCase()}` }]}>
                <DetailInput field={f.key} />
              </Form.Item>
            </Col>
          ))}
        </Row>
      )}

      <Form.Item
        label="Documents"
        required={!isEdit}
        extra={training?.requiredDocuments?.length ? `Required by ${training.name}.` : undefined}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {required.map((label) => (
            <DocumentCard
              key={label}
              label={label}
              file={files[label] || null}
              existing={onFile.get(label.toLowerCase())}
              onChange={(file) => setFiles((current) => ({ ...current, [label]: file }))}
            />
          ))}
        </div>
      </Form.Item>
      {isEdit && required.some((label) => !onFile.has(label.toLowerCase()) && !files[label]) && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Some required documents are still missing." />
      )}
      {!!fileError && <div style={{ color: token.colorError, marginBottom: 12 }}>{fileError}</div>}

      {!!training?.categories?.length && (
        <Form.Item
          label="Categories"
          name="categories"
          extra="An SME can fall under more than one category."
          rules={[{ required: true, message: "Choose at least one category" }]}
        >
          {training.categories.length < 10 ? (
            <CategoryCards categories={training.categories} />
          ) : (
            <Select mode="multiple" placeholder="Choose one or more categories" options={training.categories.map((c) => ({ value: c, label: c }))} />
          )}
        </Form.Item>
      )}

      {/* One action; the dialog's × cancels. Enabled once anything is entered or changed. */}
      <Button shape="round" type="primary" htmlType="submit" block size="large" disabled={!changed} loading={submitting} style={{ marginTop: 8 }}>
        {submitLabel || (isEdit ? "Save changes" : trainingRequired ? "Enroll SME" : "Add SME")}
      </Button>
    </Form>
  );
}

export function CategoryCards({ categories, value, onChange }: { categories: string[]; value?: string[]; onChange?: (v: string[]) => void }) {
  const { token } = theme.useToken();
  const selected = value || [];
  const toggle = (c: string) => {
    onChange?.(selected.includes(c) ? selected.filter((v) => v !== c) : [...selected, c]);
  };
  return (
    <Row gutter={[12, 12]}>
      {categories.map((c) => {
        const isSelected = selected.includes(c);
        return (
          <Col xs={12} sm={8} key={c}>
            <Card
              hoverable
              size="small"
              onClick={() => toggle(c)}
              style={{ borderColor: isSelected ? token.colorPrimary : undefined, borderWidth: isSelected ? 2 : 1 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isSelected ? (
                  <CheckCircleFilled style={{ color: token.colorPrimary }} />
                ) : (
                  <CheckCircleOutlined style={{ color: token.colorTextTertiary }} />
                )}
                <span>{c}</span>
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

function DocumentCard({
  label,
  file,
  existing,
  onChange,
}: {
  label: string;
  file: File | null;
  /** Already on file (edit mode); a new file replaces it. */
  existing?: { url: string; name: string };
  onChange: (file: File | null) => void;
}) {
  const { token } = theme.useToken();
  const done = !!file || !!existing;
  return (
    <Card
      size="small"
      style={{
        borderColor: done ? token.colorSuccess : token.colorBorderSecondary,
        background: done ? token.colorSuccessBg : token.colorBgContainer,
        transition: "border-color 0.2s, background 0.2s",
      }}
      styles={{ body: { padding: "10px 12px" } }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
        <Space size={8}>
          {done ? <CheckCircleFilled style={{ color: token.colorSuccess }} /> : <FileOutlined style={{ color: token.colorTextSecondary }} />}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Typography.Text strong>{label}</Typography.Text>
            {file ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {file.name}
                {existing ? " (replaces the file on record)" : ""}
              </Typography.Text>
            ) : existing ? (
              <a href={existing.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                {existing.name}
              </a>
            ) : null}
          </div>
        </Space>
        <Space size={4} style={{ flexShrink: 0 }}>
          <Button
            shape="circle"
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onChange(null)}
            style={{ visibility: file ? "visible" : "hidden" }}
          />
          <Upload maxCount={1} showUploadList={false} beforeUpload={(f) => { onChange(f); return false; }}>
            <Button shape="circle" size="small" type={done ? "default" : "primary"} icon={done ? <EditOutlined /> : <PlusOutlined />} />
          </Upload>
        </Space>
      </div>
    </Card>
  );
}
