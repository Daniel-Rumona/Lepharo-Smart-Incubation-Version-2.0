import React, { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Drawer, Form, Input, Modal, Space, Switch, Table, Tag, Tooltip, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { EditOutlined, EyeOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useFormChanged } from "@/lib/useFormChanged";
import { CERTIFICATE_FIELDS, type CertificateTemplate } from "./certification";
import { listCertificateTemplates, previewCertificateTemplate, saveCertificateTemplate } from "./certificateStorage";

type TemplateForm = { name: string; active: boolean; file?: UploadFile[] };

const KNOWN = new Set<string>([...CERTIFICATE_FIELDS, "verificationQr"]);
const isKnown = (field: string) => KNOWN.has(field) || /^signature_\d+$/.test(field);

/**
 * Certificate templates: fillable PDFs whose form-field names are the
 * placeholders (recipientName, trainingName, signature_1, verificationQr, ...).
 * A training picks one in its certification settings.
 */
export function CertificateTemplatesDrawer({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { message } = App.useApp();
  const { user } = useFullIdentity();
  const [form] = Form.useForm<TemplateForm>();
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<CertificateTemplate | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<string>();
  const [editorValues, setEditorValues] = useState<TemplateForm>();
  const changed = useFormChanged(form, undefined, editing === "new" ? "new" : editing?.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listCertificateTemplates());
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not load the templates.");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // The dialog's form is created as it opens, so its values go in as initial values.
  const openEditor = (t: CertificateTemplate | "new") => {
    setEditorValues({ name: t === "new" ? "" : t.name, active: t === "new" ? true : t.active, file: [] });
    setEditing(t);
  };

  const save = async () => {
    const v = await form.validateFields();
    const previous = editing === "new" ? undefined : editing || undefined;
    setSaving(true);
    try {
      const { warnings } = await saveCertificateTemplate(
        { id: previous?.id, name: v.name, active: v.active, file: v.file?.[0]?.originFileObj as File | undefined, previous },
        user?.uid || ""
      );
      message.success(previous ? "Template saved." : "Template added.");
      warnings.forEach((w) => message.warning(w, 6));
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not save the template.", 6);
    } finally {
      setSaving(false);
    }
  };

  const preview = async (t: CertificateTemplate) => {
    setPreviewing(t.id);
    try {
      await previewCertificateTemplate(t);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not build the preview.");
    } finally {
      setPreviewing(undefined);
    }
  };

  return (
    <Drawer
      title="Certificate templates"
      open={open}
      onClose={onClose}
      width={820}
      destroyOnClose
      extra={
        <Button type="primary" shape="round" icon={<PlusOutlined />} onClick={() => openEditor("new")}>
          Add template
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="Upload a fillable PDF"
          description={
            <Typography.Paragraph style={{ margin: 0 }}>
              Design the certificate (Word, Canva, …), save it as PDF, then add form fields (e.g. in Acrobat) named after what goes in them:{" "}
              <Typography.Text code>recipientName</Typography.Text> (required), <Typography.Text code>trainingName</Typography.Text>,{" "}
              <Typography.Text code>companyName</Typography.Text>, <Typography.Text code>completionDate</Typography.Text>,{" "}
              <Typography.Text code>certificateNumber</Typography.Text>, <Typography.Text code>verificationCode</Typography.Text>,{" "}
              <Typography.Text code>signatory1Name</Typography.Text>, <Typography.Text code>signatory1Title</Typography.Text>; a box called{" "}
              <Typography.Text code>signature_1</Typography.Text> for the signature and <Typography.Text code>verificationQr</Typography.Text> for the QR code.
            </Typography.Paragraph>
          }
        />
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={templates}
          pagination={false}
          columns={[
            {
              title: "Template",
              key: "name",
              render: (_: unknown, t: CertificateTemplate) => (
                <Space direction="vertical" size={0}>
                  <Space size={6}>
                    <Typography.Text strong>{t.name}</Typography.Text>
                    {!t.active && <Tag>Inactive</Tag>}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Version {t.version} · updated {dayjs(t.updatedAt).format("DD MMM YYYY")}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: "Fields",
              key: "fields",
              render: (_: unknown, t: CertificateTemplate) => (
                <Space size={[4, 4]} wrap>
                  {t.fields.map((f) => (
                    <Tooltip key={f} title={isKnown(f) ? undefined : "Not a field the system fills: it stays blank"}>
                      <Tag color={isKnown(f) ? "blue" : "default"}>{f}</Tag>
                    </Tooltip>
                  ))}
                </Space>
              ),
            },
            {
              title: "",
              key: "actions",
              width: 120,
              render: (_: unknown, t: CertificateTemplate) => (
                <Space>
                  <Tooltip title="Preview with sample details">
                    <Button shape="circle" size="small" icon={<EyeOutlined />} loading={previewing === t.id} onClick={() => void preview(t)} aria-label={`Preview ${t.name}`} />
                  </Tooltip>
                  <Tooltip title="Rename, switch off, or upload a new version">
                    <Button shape="circle" size="small" icon={<EditOutlined />} onClick={() => openEditor(t)} aria-label={`Edit ${t.name}`} />
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Modal
        title={editing === "new" ? "Add a certificate template" : editing ? `Edit ${editing.name}` : ""}
        open={!!editing}
        onCancel={() => setEditing(null)}
        // One action; × cancels. Enabled once something is entered or changed.
        footer={
          <Button type="primary" block size="large" disabled={!changed} loading={saving} onClick={() => void save()}>
            {editing === "new" ? "Add template" : "Save"}
          </Button>
        }
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={editorValues}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: "Name the template" }]}>
            <Input placeholder="e.g. Certificate of completion" />
          </Form.Item>
          <Form.Item
            name="file"
            label="Fillable PDF"
            valuePropName="fileList"
            getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)?.slice(-1)}
            rules={[{ required: editing === "new", message: "Choose the PDF" }]}
            extra={editing !== "new" && editing ? "Upload only to replace it with a new version; certificates already issued keep theirs." : undefined}
          >
            <Upload beforeUpload={() => false} maxCount={1} accept="application/pdf">
              <Button icon={<UploadOutlined />}>Choose PDF</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="active" label="Available to trainings" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
