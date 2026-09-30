import React, { useEffect, useState } from "react";
import { Button, Card, Checkbox, Col, DatePicker, Form, Input, Row, Select, Space, Typography, theme } from "antd";
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  IdcardOutlined,
  PlusOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { departmentService } from "@/services/departmentService";
import type { Training, TrainingAccessGrant, TrainingCapability, TrainingCenter } from "./trainingStorage";

type FormShape = {
  name: string;
  duration: [Dayjs, Dayjs];
  centerIds: string[];
};

export type TrainingFormValues = {
  name: string;
  durationStart: string;
  durationEnd: string;
  centers: TrainingCenter[];
  categories: string[];
  access: TrainingAccessGrant[];
  centerCoordinatorAccess: boolean;
  requiredDocuments: string[];
  requiredDetails: string[];
};

const CAPABILITY_LABELS: Record<TrainingCapability, string> = {
  repository: "Repository",
  progress: "Progress",
};

const DETAIL_PRESETS: { key: string; label: string }[] = [
  { key: "gender", label: "Gender" },
  { key: "email", label: "Email Address" },
  { key: "phone", label: "Phone Number" },
  { key: "idNumber", label: "ID Number" },
  { key: "registrationNumber", label: "Registration Number" },
  { key: "sector", label: "Sector" },
  { key: "beeLevel", label: "B-BBEE Level" },
  { key: "province", label: "Province" },
  { key: "town", label: "Town / City" },
  { key: "location", label: "Location" },
  { key: "businessAddress", label: "Business Address" },
  { key: "blackOwnedPercent", label: "Black Ownership %" },
  { key: "femaleOwnedPercent", label: "Female Ownership %" },
  { key: "youthOwnedPercent", label: "Youth Ownership %" },
];

const LOWERCASE_WORDS = new Set(["of", "the", "and", "for", "to", "in", "on", "a", "an"]);

/** "id copy" -> "ID Copy": short words (<=3 letters) go fully uppercase, common joiners stay lowercase. */
function normalizeDocumentName(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      if (word.length <= 3) return word.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

type SectionKey = "basic" | "contents" | "access" | "documents" | "details";

const SECTIONS: { key: SectionKey; title: string; icon: React.ReactNode }[] = [
  { key: "basic", title: "Basic info", icon: <CalendarOutlined /> },
  { key: "contents", title: "Contents", icon: <TagsOutlined /> },
  { key: "access", title: "Department access", icon: <ApartmentOutlined /> },
  { key: "documents", title: "Required documents", icon: <FileTextOutlined /> },
  { key: "details", title: "Details", icon: <IdcardOutlined /> },
];

export function TrainingForm({
  initialValues,
  branches,
  onSubmit,
  onCancel,
}: {
  initialValues?: Training | null;
  branches: TrainingCenter[];
  onSubmit: (values: TrainingFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { token } = theme.useToken();
  const isEdit = !!initialValues;
  const [form] = Form.useForm<FormShape>();
  const watchedName = Form.useWatch("name", form);
  const watchedCenterIds = Form.useWatch("centerIds", form);

  const [categories, setCategories] = useState<string[]>(initialValues?.categories || []);
  const [categoryInput, setCategoryInput] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [access, setAccess] = useState<TrainingAccessGrant[]>(initialValues?.access || []);
  const [pendingDepartment, setPendingDepartment] = useState<string>();
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [centerCoordinatorAccess, setCenterCoordinatorAccess] = useState(initialValues?.centerCoordinatorAccess || false);

  const [documents, setDocuments] = useState<string[]>(initialValues?.requiredDocuments || []);
  const [documentInput, setDocumentInput] = useState("");
  const [editingDocIndex, setEditingDocIndex] = useState<number | null>(null);
  const [editingDocValue, setEditingDocValue] = useState("");

  const [details, setDetails] = useState<string[]>(initialValues?.requiredDetails || []);

  const [submitting, setSubmitting] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);

  useEffect(() => {
    form.setFieldsValue(
      initialValues
        ? {
            name: initialValues.name,
            duration: [dayjs(initialValues.durationStart), dayjs(initialValues.durationEnd)],
            centerIds: initialValues.centers.map((c) => c.id),
          }
        : { name: "", duration: undefined, centerIds: [] }
    );
    setCategories(initialValues?.categories || []);
    setAccess(initialValues?.access || []);
    setCenterCoordinatorAccess(initialValues?.centerCoordinatorAccess || false);
    setDocuments(initialValues?.requiredDocuments || []);
    setDetails(initialValues?.requiredDetails || []);
    setWizardStep(0);
    setActiveSection(null);
  }, [initialValues, form]);

  useEffect(() => {
    setDepartmentsLoading(true);
    departmentService
      .getDepartments()
      .then((list) => setDepartments(list.map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDepartments([]))
      .finally(() => setDepartmentsLoading(false));
  }, []);

  const addAccess = () => {
    if (!pendingDepartment || access.some((a) => a.department === pendingDepartment)) return;
    setAccess((prev) => [...prev, { department: pendingDepartment, capabilities: [] }]);
    setPendingDepartment(undefined);
  };

  const removeAccess = (department: string) => setAccess((prev) => prev.filter((a) => a.department !== department));

  const toggleCapability = (department: string, capability: TrainingCapability) => {
    setAccess((prev) =>
      prev.map((a) =>
        a.department === department
          ? { ...a, capabilities: a.capabilities.includes(capability) ? a.capabilities.filter((c) => c !== capability) : [...a.capabilities, capability] }
          : a
      )
    );
  };

  const addCategory = () => {
    const value = categoryInput.trim();
    if (!value || categories.includes(value)) return;
    setCategories((prev) => [...prev, value]);
    setCategoryInput("");
  };

  const removeCategory = (idx: number) => {
    setCategories((prev) => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) setEditingIndex(null);
  };

  const startEdit = (idx: number) => {
    setEditingIndex(idx);
    setEditingValue(categories[idx]);
  };

  const commitEdit = () => {
    const value = editingValue.trim();
    if (editingIndex !== null && value && !categories.some((c, i) => i !== editingIndex && c === value)) {
      setCategories((prev) => prev.map((c, i) => (i === editingIndex ? value : c)));
    }
    setEditingIndex(null);
  };

  const addDocument = () => {
    const value = normalizeDocumentName(documentInput);
    if (!value || documents.includes(value)) return;
    setDocuments((prev) => [...prev, value]);
    setDocumentInput("");
  };

  const removeDocument = (idx: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== idx));
    if (editingDocIndex === idx) setEditingDocIndex(null);
  };

  const startEditDoc = (idx: number) => {
    setEditingDocIndex(idx);
    setEditingDocValue(documents[idx]);
  };

  const commitEditDoc = () => {
    const value = normalizeDocumentName(editingDocValue);
    if (editingDocIndex !== null && value && !documents.some((d, i) => i !== editingDocIndex && d === value)) {
      setDocuments((prev) => prev.map((d, i) => (i === editingDocIndex ? value : d)));
    }
    setEditingDocIndex(null);
  };

  const toggleDetail = (key: string) => {
    setDetails((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]));
  };

  const handleFinish = async (values: FormShape) => {
    setSubmitting(true);
    try {
      await onSubmit({
        name: values.name,
        durationStart: values.duration[0].toISOString(),
        durationEnd: values.duration[1].toISOString(),
        centers: branches.filter((b) => values.centerIds.includes(b.id)),
        categories,
        access,
        centerCoordinatorAccess,
        requiredDocuments: documents,
        requiredDetails: details,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = async () => {
    if (wizardStep === 0) {
      try {
        await form.validateFields(["name", "duration", "centerIds"]);
      } catch {
        return;
      }
    }
    setWizardStep((s) => Math.min(s + 1, SECTIONS.length - 1));
  };
  const goBack = () => setWizardStep((s) => Math.max(s - 1, 0));

  const listWell = (empty: boolean, children: React.ReactNode) => (
    <div
      style={{
        marginTop: 10,
        padding: empty ? 12 : 8,
        minHeight: 52,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: token.colorFillAlter,
        border: `1px dashed ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
      }}
    >
      {children}
    </div>
  );

  const renderSection = (key: SectionKey) => {
    switch (key) {
      case "basic":
        return (
          <>
            <Form.Item label="Name" name="name" rules={[{ required: true, message: "Give the training a name" }]}>
              <Input placeholder="e.g. Digital Marketing Fundamentals" />
            </Form.Item>
            <Form.Item label="Duration" name="duration" rules={[{ required: true, message: "Choose the training dates" }]}>
              <DatePicker.RangePicker style={{ width: "100%" }} format="DD MMM YYYY" />
            </Form.Item>
            <Form.Item label="Centers affected" name="centerIds" rules={[{ required: true, message: "Choose at least one center" }]}>
              <Select
                mode="multiple"
                placeholder="Choose which centers this training runs at"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </Form.Item>
            <Form.Item label="Should Center Coordinators have access?">
              <Row gutter={12}>
                {[
                  { value: true, label: "Yes" },
                  { value: false, label: "No" },
                ].map((option) => {
                  const isSelected = centerCoordinatorAccess === option.value;
                  return (
                    <Col span={12} key={option.label}>
                      <Card
                        hoverable
                        size="small"
                        onClick={() => setCenterCoordinatorAccess(option.value)}
                        style={{ borderColor: isSelected ? token.colorPrimary : undefined, borderWidth: isSelected ? 2 : 1 }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          {isSelected ? (
                            <CheckCircleFilled style={{ color: token.colorPrimary }} />
                          ) : (
                            <CheckCircleOutlined style={{ color: token.colorTextTertiary }} />
                          )}
                          <span>{option.label}</span>
                        </div>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
              {centerCoordinatorAccess && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Center Coordinators will get Repository and Progress access.
                </Typography.Text>
              )}
            </Form.Item>
          </>
        );
      case "contents":
        return (
          <Form.Item label="Contents (optional)" extra="Skills taught, if not everyone learns the same thing.">
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <Input
                style={{ flex: 1 }}
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onPressEnter={(e) => {
                  e.preventDefault();
                  addCategory();
                }}
                placeholder="e.g. Bookkeeping"
              />
              <Button shape="circle" type="primary" icon={<PlusOutlined />} onClick={addCategory} />
            </div>
            {listWell(
              !categories.length,
              categories.length ? (
                categories.map((c, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "6px 8px 6px 12px",
                      background: token.colorBgContainer,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadius,
                    }}
                  >
                    {editingIndex === idx ? (
                      <Input
                        size="small"
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onPressEnter={commitEdit}
                        onBlur={commitEdit}
                        style={{ marginRight: 8 }}
                      />
                    ) : (
                      <Space size={8}>
                        <TagsOutlined style={{ color: token.colorPrimary }} />
                        <Typography.Text>{c}</Typography.Text>
                      </Space>
                    )}
                    <Space size={2}>
                      {editingIndex === idx ? (
                        <Button shape="circle" size="small" type="text" icon={<CheckOutlined />} onClick={commitEdit} />
                      ) : (
                        <Button shape="circle" size="small" type="text" icon={<EditOutlined />} onClick={() => startEdit(idx)} />
                      )}
                      <Button shape="circle" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeCategory(idx)} />
                    </Space>
                  </div>
                ))
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No categories added yet — everyone will be trained on the same content.
                </Typography.Text>
              )
            )}
          </Form.Item>
        );
      case "access":
        return (
          <Form.Item label="Department access" extra="Departments allowed to view this training's SMEs.">
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <Select
                style={{ flex: 1 }}
                placeholder="Choose a department to grant access"
                loading={departmentsLoading}
                showSearch
                optionFilterProp="label"
                value={pendingDepartment}
                onChange={setPendingDepartment}
                options={departments.filter((d) => !access.some((a) => a.department === d.name)).map((d) => ({ value: d.name, label: d.name }))}
              />
              <Button shape="circle" type="primary" icon={<PlusOutlined />} onClick={addAccess} />
            </div>
            {listWell(
              !access.length,
              access.length ? (
                access.map((a) => (
                  <div
                    key={a.department}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                      width: "100%",
                      padding: "6px 8px 6px 12px",
                      background: token.colorBgContainer,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadius,
                    }}
                  >
                    <Space size={8}>
                      <ApartmentOutlined style={{ color: token.colorPrimary }} />
                      <Typography.Text strong>{a.department}</Typography.Text>
                    </Space>
                    <Space size={16}>
                      {(Object.keys(CAPABILITY_LABELS) as TrainingCapability[]).map((capability) => (
                        <Checkbox key={capability} checked={a.capabilities.includes(capability)} onChange={() => toggleCapability(a.department, capability)}>
                          {CAPABILITY_LABELS[capability]}
                        </Checkbox>
                      ))}
                      <Button shape="circle" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeAccess(a.department)} />
                    </Space>
                  </div>
                ))
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No departments have been granted access yet — only you can see this training.
                </Typography.Text>
              )
            )}
          </Form.Item>
        );
      case "documents":
        return (
          <Form.Item label="Required documents" extra="Documents an SME must provide when enrolling.">
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <Input
                style={{ flex: 1 }}
                value={documentInput}
                onChange={(e) => setDocumentInput(e.target.value)}
                onPressEnter={(e) => {
                  e.preventDefault();
                  addDocument();
                }}
                placeholder="e.g. id copy"
              />
              <Button shape="circle" type="primary" icon={<PlusOutlined />} onClick={addDocument} />
            </div>
            {listWell(
              !documents.length,
              documents.length ? (
                documents.map((d, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "6px 8px 6px 12px",
                      background: token.colorBgContainer,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadius,
                    }}
                  >
                    {editingDocIndex === idx ? (
                      <Input
                        size="small"
                        autoFocus
                        value={editingDocValue}
                        onChange={(e) => setEditingDocValue(e.target.value)}
                        onPressEnter={commitEditDoc}
                        onBlur={commitEditDoc}
                        style={{ marginRight: 8 }}
                      />
                    ) : (
                      <Space size={8}>
                        <FileTextOutlined style={{ color: token.colorPrimary }} />
                        <Typography.Text>{d}</Typography.Text>
                      </Space>
                    )}
                    <Space size={2}>
                      {editingDocIndex === idx ? (
                        <Button shape="circle" size="small" type="text" icon={<CheckOutlined />} onClick={commitEditDoc} />
                      ) : (
                        <Button shape="circle" size="small" type="text" icon={<EditOutlined />} onClick={() => startEditDoc(idx)} />
                      )}
                      <Button shape="circle" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeDocument(idx)} />
                    </Space>
                  </div>
                ))
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No documents required yet.
                </Typography.Text>
              )
            )}
          </Form.Item>
        );
      case "details":
        return (
          <Form.Item label="Details" extra="Profile details to collect for this training.">
            <Row gutter={[12, 12]}>
              {DETAIL_PRESETS.map((preset) => {
                const isSelected = details.includes(preset.key);
                return (
                  <Col xs={12} sm={8} key={preset.key}>
                    <Card
                      hoverable
                      size="small"
                      onClick={() => toggleDetail(preset.key)}
                      style={{ borderColor: isSelected ? token.colorPrimary : undefined, borderWidth: isSelected ? 2 : 1 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isSelected ? (
                          <CheckCircleFilled style={{ color: token.colorPrimary }} />
                        ) : (
                          <CheckCircleOutlined style={{ color: token.colorTextTertiary }} />
                        )}
                        <span>{preset.label}</span>
                      </div>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </Form.Item>
        );
      default:
        return null;
    }
  };

  const sectionSummary = (key: SectionKey) => {
    switch (key) {
      case "basic": {
        const name = watchedName || initialValues?.name;
        const count = (watchedCenterIds || initialValues?.centers.map((c) => c.id) || []).length;
        return `${name || "Untitled"} · ${count} center${count === 1 ? "" : "s"}`;
      }
      case "contents":
        return categories.length ? `${categories.length} categor${categories.length === 1 ? "y" : "ies"}` : "None set";
      case "access":
        return access.length ? `${access.length} department${access.length === 1 ? "" : "s"}` : "None granted";
      case "documents":
        return documents.length ? `${documents.length} document${documents.length === 1 ? "" : "s"}` : "None required";
      case "details":
        return details.length ? `${details.length} field${details.length === 1 ? "" : "s"}` : "None requested";
      default:
        return "";
    }
  };

  if (isEdit && !activeSection) {
    return (
      <div>
        <Row gutter={[12, 12]}>
          {SECTIONS.map((section) => (
            <Col xs={24} sm={12} key={section.key}>
              <Card hoverable onClick={() => setActiveSection(section.key)}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Space size={8}>
                    <span style={{ color: token.colorPrimary }}>{section.icon}</span>
                    <Typography.Text strong>{section.title}</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {sectionSummary(section.key)}
                  </Typography.Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
        <div style={{ marginTop: 16 }}>
          <Button shape="round" block onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const currentKey: SectionKey = isEdit ? activeSection! : SECTIONS[wizardStep].key;

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} autoComplete="off">
      {renderSection(currentKey)}

      <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
        {isEdit ? (
          <>
            <Button shape="round" icon={<ArrowLeftOutlined />} onClick={() => setActiveSection(null)} style={{ flex: 1 }}>
              Back
            </Button>
            <Button shape="round" type="primary" htmlType="submit" loading={submitting} style={{ flex: 1 }}>
              Update
            </Button>
          </>
        ) : (
          <>
            {wizardStep > 0 ? (
              <Button shape="round" onClick={goBack} style={{ flex: 1 }}>
                Back
              </Button>
            ) : (
              <Button shape="round" onClick={onCancel} style={{ flex: 1 }}>
                Cancel
              </Button>
            )}
            {wizardStep < SECTIONS.length - 1 ? (
              <Button shape="round" type="primary" onClick={goNext} style={{ flex: 1 }}>
                Next
              </Button>
            ) : (
              <Button shape="round" type="primary" htmlType="submit" loading={submitting} style={{ flex: 1 }}>
                Add training
              </Button>
            )}
          </>
        )}
      </div>
    </Form>
  );
}
