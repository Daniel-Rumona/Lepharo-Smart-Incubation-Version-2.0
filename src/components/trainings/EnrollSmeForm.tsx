import React, { useState } from "react";
import { Button, Card, Col, Form, Input, Row, Select, Space, Typography, Upload, theme } from "antd";
import { CheckCircleFilled, CheckCircleOutlined, DeleteOutlined, EditOutlined, FileOutlined, PlusOutlined } from "@ant-design/icons";
import type { Training } from "./trainingStorage";

type FormShape = {
  trainingId: string;
  name: string;
  companyName: string;
  categories?: string[];
};

export type EnrollSmeFormValues = {
  trainingId: string;
  name: string;
  companyName: string;
  categories: string[];
  idFile: File;
  qualificationFile: File;
  cvFile: File;
  registrationFormFile: File;
};

export function EnrollSmeForm({
  trainings,
  defaultTrainingId,
  lockedTrainingId,
  trainingRequired = true,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  trainings: Training[];
  defaultTrainingId?: string;
  /** When set, the training is fixed to this one and the picker is disabled. */
  lockedTrainingId?: string;
  /** When false, the training field is optional — the SME can be added and enrolled into a training later. */
  trainingRequired?: boolean;
  submitLabel?: string;
  onSubmit: (values: EnrollSmeFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { token } = theme.useToken();
  const [form] = Form.useForm<FormShape>();
  const watchedTrainingId = Form.useWatch("trainingId", form);
  const trainingId = lockedTrainingId ?? watchedTrainingId ?? defaultTrainingId;
  const training = trainings.find((t) => t.id === trainingId);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [qualificationFile, setQualificationFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [registrationFormFile, setRegistrationFormFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async (values: FormShape) => {
    if (!idFile || !qualificationFile || !cvFile || !registrationFormFile) {
      setFileError("Attach their ID copy, report/qualification, CV, and registration form.");
      return;
    }
    const finalTrainingId = lockedTrainingId ?? values.trainingId ?? "";
    if (finalTrainingId && training?.categories?.length && !values.categories?.length) return;
    setFileError("");
    setSubmitting(true);
    try {
      await onSubmit({
        trainingId: finalTrainingId,
        name: values.name,
        companyName: values.companyName,
        categories: values.categories || [],
        idFile,
        qualificationFile,
        cvFile,
        registrationFormFile,
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
      initialValues={{ trainingId: lockedTrainingId ?? defaultTrainingId }}
    >
      {lockedTrainingId ? (
        <Form.Item name="trainingId" hidden initialValue={lockedTrainingId}>
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
            onChange={() => form.setFieldValue("categories", undefined)}
            options={trainings.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>
      )}

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item label="SME name" name="name" rules={[{ required: true, message: "Add the SME's name" }]}>
            <Input placeholder="Full name" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item label="Company name" name="companyName" rules={[{ required: true, message: "Add the company name" }]}>
            <Input placeholder="Company name" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item label="Documents" required>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <DocumentCard label="ID copy" file={idFile} onChange={setIdFile} />
          <DocumentCard label="Report / qualification" file={qualificationFile} onChange={setQualificationFile} />
          <DocumentCard label="CV" file={cvFile} onChange={setCvFile} />
          <DocumentCard label="Registration form" file={registrationFormFile} onChange={setRegistrationFormFile} />
        </div>
      </Form.Item>
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

      <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
        <Button shape="round" onClick={onCancel} style={{ flex: 1 }}>
          Cancel
        </Button>
        <Button shape="round" type="primary" htmlType="submit" loading={submitting} style={{ flex: 1 }}>
          {submitLabel || (trainingRequired ? "Enroll SME" : "Add SME")}
        </Button>
      </div>
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

function DocumentCard({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  const { token } = theme.useToken();
  return (
    <Card
      size="small"
      style={{
        borderColor: file ? token.colorSuccess : token.colorBorderSecondary,
        background: file ? token.colorSuccessBg : token.colorBgContainer,
        transition: "border-color 0.2s, background 0.2s",
      }}
      styles={{ body: { padding: "10px 12px" } }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
        <Space size={8}>
          {file ? <CheckCircleFilled style={{ color: token.colorSuccess }} /> : <FileOutlined style={{ color: token.colorTextSecondary }} />}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Typography.Text strong>{label}</Typography.Text>
            {file && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {file.name}
              </Typography.Text>
            )}
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
            <Button shape="circle" size="small" type={file ? "default" : "primary"} icon={file ? <EditOutlined /> : <PlusOutlined />} />
          </Upload>
        </Space>
      </div>
    </Card>
  );
}
