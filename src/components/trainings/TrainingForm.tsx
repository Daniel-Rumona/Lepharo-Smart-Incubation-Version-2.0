import React, { useEffect, useMemo, useState } from "react";
import { App, Button, Card, Checkbox, Col, DatePicker, Form, Input, Row, Select, Space, Typography, theme } from "antd";
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
  ReadOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { departmentService } from "@/services/departmentService";
import { listCatalog, type CatalogCourse } from "@/components/courses/learnerCourses";
import { stableValue } from "@/lib/useFormChanged";
import { TRAINING_DETAIL_FIELDS, type Training, type TrainingAccessGrant, type TrainingCapability, type TrainingCenter } from "./trainingStorage";

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
  courseIds: string[];
};

const CAPABILITY_LABELS: Record<TrainingCapability, string> = {
  repository: "Repository",
  progress: "Progress",
};

const DETAIL_PRESETS = TRAINING_DETAIL_FIELDS;

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

type SectionKey = "basic" | "contents" | "courses" | "access" | "documents" | "details";

const SECTIONS: { key: SectionKey; title: string; icon: React.ReactNode }[] = [
  { key: "basic", title: "Basic info", icon: <CalendarOutlined /> },
  { key: "contents", title: "Contents", icon: <TagsOutlined /> },
  { key: "courses", title: "Courses", icon: <ReadOutlined /> },
  { key: "access", title: "Department access", icon: <ApartmentOutlined /> },
  { key: "documents", title: "Required documents", icon: <FileTextOutlined /> },
  { key: "details", title: "Details", icon: <IdcardOutlined /> },
];

/**
 * Basic info lives in React state like every other section. antd only passes
 * onFinish the fields mounted on the current step, so on the wizard's last
 * step (or when editing any section but Basic info) name/duration/centers
 * would otherwise be missing and the save would throw before writing.
 */
const toBasics = (training?: Training | null): Partial<FormShape> =>
  training
    ? {
        name: training.name,
        duration: [dayjs(training.durationStart), dayjs(training.durationEnd)],
        centerIds: training.centers.map((c) => c.id),
      }
    : { name: "", duration: undefined, centerIds: [] };

/** Everything a save would write, as one comparable value (dates by their instant). */
const snapshotOf = (basics: Partial<FormShape>, rest: Omit<TrainingFormValues, "name" | "durationStart" | "durationEnd" | "centers">) =>
  stableValue({
    name: (basics.name || "").trim(),
    duration: (basics.duration || []).map((d) => (d ? d.valueOf() : null)),
    centerIds: [...(basics.centerIds || [])].sort(),
    ...rest,
  });

/**
 * Add or edit a training. It sits in a dialog closed by its ×, so it has one
 * full-width action: Next / Add training in the wizard, and Update when
 * editing, which is enabled only once something differs from how it opened.
 */
export function TrainingForm({
  initialValues,
  branches,
  onSubmit,
}: {
  initialValues?: Training | null;
  branches: TrainingCenter[];
  onSubmit: (values: TrainingFormValues) => Promise<void>;
}) {
  const { token } = theme.useToken();
  const isEdit = !!initialValues;
  const { message } = App.useApp();
  const [form] = Form.useForm<FormShape>();
  const [basics, setBasics] = useState<Partial<FormShape>>(() => toBasics(initialValues));

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

  const [courseIds, setCourseIds] = useState<string[]>(initialValues?.courseIds || []);
  const [catalog, setCatalog] = useState<CatalogCourse[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);

  const opened = useMemo(
    () =>
      snapshotOf(toBasics(initialValues), {
        categories: initialValues?.categories || [],
        access: initialValues?.access || [],
        centerCoordinatorAccess: initialValues?.centerCoordinatorAccess || false,
        requiredDocuments: initialValues?.requiredDocuments || [],
        requiredDetails: initialValues?.requiredDetails || [],
        courseIds: initialValues?.courseIds || [],
      }),
    [initialValues]
  );
  const changed =
    snapshotOf(basics, { categories, access, centerCoordinatorAccess, requiredDocuments: documents, requiredDetails: details, courseIds }) !== opened;

  useEffect(() => {
    setBasics(toBasics(initialValues));
    setCategories(initialValues?.categories || []);
    setAccess(initialValues?.access || []);
    setCenterCoordinatorAccess(initialValues?.centerCoordinatorAccess || false);
    setDocuments(initialValues?.requiredDocuments || []);
    setDetails(initialValues?.requiredDetails || []);
    setCourseIds(initialValues?.courseIds || []);
    setWizardStep(0);
    setActiveSection(null);
  }, [initialValues]);

  useEffect(() => {
    setDepartmentsLoading(true);
    departmentService
      .getDepartments()
      .then((list) => setDepartments(list.map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDepartments([]))
      .finally(() => setDepartmentsLoading(false));
    setCatalogLoading(true);
    listCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
      .finally(() => setCatalogLoading(false));
  }, []);

  const addAccess = () => {
    if (!pendingDepartment || access.some((a) => a.departmentId === pendingDepartment)) return;
    setAccess((prev) => [...prev, { departmentId: pendingDepartment, capabilities: [] }]);
    setPendingDepartment(undefined);
  };

  const removeAccess = (departmentId: string) => setAccess((prev) => prev.filter((a) => a.departmentId !== departmentId));

  const toggleCapability = (departmentId: string, capability: TrainingCapability) => {
    setAccess((prev) =>
      prev.map((a) =>
        a.departmentId === departmentId
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

  const handleFinish = async () => {
    const values = { ...basics, ...form.getFieldsValue(true) } as Partial<FormShape>;
    const name = String(values.name || "").trim();
    const [start, end] = values.duration || [];
    const centerIds = values.centerIds || [];
    if (!name || !start || !end || !centerIds.length) {
      message.error("Add the training's name, dates and centers under Basic info.");
      if (isEdit) setActiveSection("basic");
      else setWizardStep(0);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        durationStart: start.toISOString(),
        durationEnd: end.toISOString(),
        centers: branches.filter((b) => centerIds.includes(b.id)),
        categories,
        access,
        centerCoordinatorAccess,
        requiredDocuments: documents,
        requiredDetails: details,
        courseIds,
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
      case "courses": {
        const byId = new Map(catalog.map((c) => [c.id, c]));
        return (
          <Form.Item label="Courses (optional)" extra="Published Academy courses this training's SMEs take in their portal.">
            <Select
              mode="multiple"
              allowClear
              showSearch
              loading={catalogLoading}
              optionFilterProp="label"
              placeholder={catalog.length || catalogLoading ? "Choose courses" : "No published courses yet"}
              value={courseIds}
              onChange={setCourseIds}
              options={catalog.map((c) => ({ value: c.id, label: c.title }))}
            />
            {listWell(
              !courseIds.length,
              courseIds.length ? (
                courseIds.map((id) => (
                  <div
                    key={id}
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
                    <Space size={8}>
                      <ReadOutlined style={{ color: token.colorPrimary }} />
                      <Typography.Text>{byId.get(id)?.title || (catalogLoading ? "Loading…" : "Unpublished or deleted course")}</Typography.Text>
                    </Space>
                    <Button
                      shape="circle"
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setCourseIds((prev) => prev.filter((c) => c !== id))}
                    />
                  </div>
                ))
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No courses linked — SMEs will see the training plan only.
                </Typography.Text>
              )
            )}
          </Form.Item>
        );
      }
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
                options={departments.filter((d) => !access.some((a) => a.departmentId === d.id)).map((d) => ({ value: d.id, label: d.name }))}
              />
              <Button shape="circle" type="primary" icon={<PlusOutlined />} onClick={addAccess} />
            </div>
            {listWell(
              !access.length,
              access.length ? (
                access.map((a) => (
                  <div
                    key={a.departmentId}
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
                      <Typography.Text strong>{departments.find((d) => d.id === a.departmentId)?.name || a.departmentId}</Typography.Text>
                    </Space>
                    <Space size={16}>
                      {(Object.keys(CAPABILITY_LABELS) as TrainingCapability[]).map((capability) => (
                        <Checkbox key={capability} checked={a.capabilities.includes(capability)} onChange={() => toggleCapability(a.departmentId, capability)}>
                          {CAPABILITY_LABELS[capability]}
                        </Checkbox>
                      ))}
                      <Button shape="circle" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeAccess(a.departmentId)} />
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
        const name = basics.name;
        const count = (basics.centerIds || []).length;
        return `${name || "Untitled"} · ${count} center${count === 1 ? "" : "s"}`;
      }
      case "contents":
        return categories.length ? `${categories.length} categor${categories.length === 1 ? "y" : "ies"}` : "None set";
      case "courses":
        return courseIds.length ? `${courseIds.length} course${courseIds.length === 1 ? "" : "s"}` : "None linked";
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
      </div>
    );
  }

  const currentKey: SectionKey = isEdit ? activeSection! : SECTIONS[wizardStep].key;

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={basics}
      onValuesChange={(_, all) => setBasics((current) => ({ ...current, ...all }))}
      // Enter in a field only saves when editing; the wizard saves from its last step's button.
      onFinish={() => (isEdit ? void handleFinish() : wizardStep < SECTIONS.length - 1 ? void goNext() : undefined)}
      autoComplete="off"
    >
      {/* Going back is navigation, not cancelling, so it sits above the section as a link. */}
      {(isEdit || wizardStep > 0) && (
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          onClick={isEdit ? () => setActiveSection(null) : goBack}
          style={{ padding: 0, height: "auto", marginBottom: 12 }}
        >
          {isEdit ? "All sections" : `Back to ${SECTIONS[wizardStep - 1].title}`}
        </Button>
      )}

      {renderSection(currentKey)}

      <div style={{ marginTop: 8 }}>
        {isEdit ? (
          <Button shape="round" type="primary" htmlType="submit" block size="large" disabled={!changed} loading={submitting}>
            Update
          </Button>
        ) : wizardStep < SECTIONS.length - 1 ? (
          // Separate keys: reusing one <button> let the Next click land as a submit on the last step.
          <Button key="next" shape="round" type="primary" block size="large" onClick={goNext}>
            Next
          </Button>
        ) : (
          <Button key="add" shape="round" type="primary" block size="large" loading={submitting} onClick={() => void handleFinish()}>
            Add training
          </Button>
        )}
      </div>
    </Form>
  );
}
