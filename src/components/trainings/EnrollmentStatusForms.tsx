import React, { useState } from "react";
import { Button, Empty, Form, Input, Select, Typography } from "antd";
import { useFormChanged } from "@/lib/useFormChanged";
import { CategoryCards } from "./EnrollSmeForm";
import type { Training, TrainingEnrollment } from "./trainingStorage";

/*
 * Each of these sits in a dialog closed by its ×: one full-width action,
 * enabled once something has been chosen (pressing it shows what's missing).
 */

type AssignFormShape = { trainingId: string; categories?: string[] };

export function AssignTrainingForm({
  trainings,
  onSubmit,
}: {
  trainings: Training[];
  onSubmit: (trainingId: string, categories: string[]) => Promise<void>;
}) {
  const [form] = Form.useForm<AssignFormShape>();
  const trainingId = Form.useWatch("trainingId", form);
  const training = trainings.find((t) => t.id === trainingId);
  const [submitting, setSubmitting] = useState(false);
  const changed = useFormChanged(form);

  const handleFinish = async (values: AssignFormShape) => {
    setSubmitting(true);
    try {
      await onSubmit(values.trainingId, values.categories || []);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} autoComplete="off">
      <Form.Item label="Training" name="trainingId" rules={[{ required: true, message: "Choose a training" }]}>
        <Select
          placeholder="Choose a training"
          onChange={() => form.setFieldValue("categories", undefined)}
          options={trainings.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Form.Item>
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
      <Button shape="round" type="primary" htmlType="submit" block size="large" disabled={!changed} loading={submitting} style={{ marginTop: 8 }}>
        Enroll
      </Button>
    </Form>
  );
}

type PickExistingFormShape = { smeId: string; categories?: string[] };

export function PickExistingSmeForm({
  training,
  candidates,
  onSubmit,
}: {
  training: Training;
  candidates: TrainingEnrollment[];
  onSubmit: (smeId: string, categories: string[]) => Promise<void>;
}) {
  const [form] = Form.useForm<PickExistingFormShape>();
  const [submitting, setSubmitting] = useState(false);
  const changed = useFormChanged(form);

  const handleFinish = async (values: PickExistingFormShape) => {
    setSubmitting(true);
    try {
      await onSubmit(values.smeId, values.categories || []);
    } finally {
      setSubmitting(false);
    }
  };

  if (!candidates.length) {
    return <Empty description="No pre-added SMEs are awaiting a training right now. Add one from the Training SMEs page, or use New SME instead." />;
  }

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} autoComplete="off">
      <Form.Item label="SME" name="smeId" rules={[{ required: true, message: "Choose a pre-added SME" }]}>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="Choose a pre-added SME"
          options={candidates.map((c) => ({ value: c.id, label: `${c.name} — ${c.companyName}` }))}
        />
      </Form.Item>
      {!!training.categories?.length && (
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
      <Button shape="round" type="primary" htmlType="submit" block size="large" disabled={!changed} loading={submitting} style={{ marginTop: 8 }}>
        Enroll
      </Button>
    </Form>
  );
}

type DiscontinueFormShape = { reason: string };

export function DiscontinueForm({ smeName, onSubmit }: { smeName: string; onSubmit: (reason: string) => Promise<void> }) {
  const [form] = Form.useForm<DiscontinueFormShape>();
  const [submitting, setSubmitting] = useState(false);
  const changed = useFormChanged(form);

  const handleFinish = async (values: DiscontinueFormShape) => {
    setSubmitting(true);
    try {
      await onSubmit(values.reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} autoComplete="off">
      <Typography.Paragraph type="secondary">
        {smeName} will be marked as discontinued from this training. This can't be undone here.
      </Typography.Paragraph>
      <Form.Item label="Reason" name="reason" rules={[{ required: true, message: "Add a reason for discontinuing" }]}>
        <Input.TextArea rows={3} placeholder="e.g. Stopped attending after session 2" />
      </Form.Item>
      <Button shape="round" danger type="primary" htmlType="submit" block size="large" disabled={!changed} loading={submitting} style={{ marginTop: 8 }}>
        Discontinue
      </Button>
    </Form>
  );
}
