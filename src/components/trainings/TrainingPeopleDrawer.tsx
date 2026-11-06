import React, { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Drawer, Dropdown, Form, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { EditOutlined, KeyOutlined, MoreOutlined, PaperClipOutlined, SafetyCertificateOutlined, StopOutlined, UploadOutlined, UserAddOutlined } from "@ant-design/icons";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileCardList } from "@/components/shared/MobileCardList";
import type { Training, TrainingAttendee, TrainingEnrollment } from "./trainingStorage";
import { EligibilityChecklist, EligibilityTag } from "./EligibilityTag";
import { setAttendeeOverride } from "./certificationStorage";
import { SmePeopleLayout } from "./SmePeopleLayout";
import {
  type AttendeeInput,
  addEmployee,
  createAttendeeLogin,
  ensureDirectorAttendee,
  listCompanyAttendees,
  updateAttendee,
  uploadAttendeeIdCopy,
  withdrawAttendee,
} from "./attendeeStorage";

type PersonForm = { name: string; email: string; phone?: string; idNumber?: string; categories: string[]; idCopy?: UploadFile[] };

/**
 * The people an SME sends to its training: the director (the enrollment's own
 * person) and its employees. Each person gives only their own identity (name,
 * email, ID number, ID copy); company documents stay on the enrollment. Staff
 * use this from the SMEs page; the SME's director gets the same view in the
 * portal (`asDirector`), and staff are notified of a director's changes.
 */
export function TrainingPeopleDrawer({
  enrollment,
  training,
  asDirector = false,
  variant = "drawer",
  onClose,
  onChanged,
}: {
  enrollment: TrainingEnrollment | null;
  training?: Training;
  asDirector?: boolean;
  /** "page": the director's People page in the portal, laid out as cards (SmePeopleLayout). */
  variant?: "drawer" | "page";
  onClose?: () => void;
  onChanged?: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PersonForm>();
  const [people, setPeople] = useState<TrainingAttendee[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [editing, setEditing] = useState<TrainingAttendee | "new" | null>(null);
  const [withdrawing, setWithdrawing] = useState<TrainingAttendee | null>(null);
  const [overriding, setOverriding] = useState<TrainingAttendee | null>(null);
  const [editorValues, setEditorValues] = useState<PersonForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState("");
  const { user } = useFullIdentity();
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    if (!enrollment) return;
    setLoading(true);
    try {
      setPeople(await listCompanyAttendees(enrollment.id));
    } catch (e) {
      // A director's login can only list the company's people once they're set up; until then offer set-up.
      if (asDirector) setPeople([]);
      else message.error(e instanceof Error ? e.message : "Could not load this SME's people.");
    } finally {
      setLoading(false);
    }
  }, [enrollment, message, asDirector]);

  useEffect(() => {
    setPeople([]);
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    onChanged?.();
  };

  const run = async (key: string, task: () => Promise<{ loginProblem?: string | null } | void>, success: string) => {
    setBusy(key);
    try {
      const result = await task();
      message.success(success);
      if (result && result.loginProblem) message.warning(result.loginProblem, 6);
      await changed();
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  const director = people.find((p) => p.kind === "director");
  const employees = people.filter((p) => p.kind === "employee").sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
  const rows = director ? [director, ...employees] : employees;
  const categories = training?.categories || [];
  const enrolled = enrollment?.status === "enrolled";

  // The dialog's form is created when it opens, so its values go in as initial
  // values (setting them on the form beforehand would be lost).
  const openEditor = (person: TrainingAttendee | "new") => {
    const p = person === "new" ? null : person;
    setEditorValues({
      name: p?.name || "",
      email: p?.email || "",
      phone: p?.phone || "",
      idNumber: p?.idNumber || "",
      categories: p?.categories || [],
      idCopy: [],
    });
    setDirty(false);
    setEditing(person);
  };

  /** Save is offered only once something differs from what was opened (or a file is chosen). */
  const trackChanges = (_: Partial<PersonForm>, all: PersonForm) => {
    if (!editorValues) return;
    const plain = (v: PersonForm) =>
      JSON.stringify([v.name || "", v.email || "", v.phone || "", v.idNumber || "", [...(v.categories || [])].sort()]);
    setDirty(plain(all) !== plain(editorValues) || !!all.idCopy?.length);
  };

  const submitPerson = async () => {
    if (!enrollment) return;
    const values = await form.validateFields();
    const file = values.idCopy?.[0]?.originFileObj as File | undefined;
    const person = editing === "new" ? null : editing;
    await run(
      "save",
      async () => {
        const idDocument = file
          ? await uploadAttendeeIdCopy(enrollment.id, person?.id || `new_${crypto.randomUUID().slice(0, 8)}`, file)
          : undefined;
        const input: AttendeeInput = {
          name: values.name,
          email: values.email,
          phone: values.phone,
          idNumber: values.idNumber,
          categories: values.categories || [],
          ...(idDocument ? { idDocument } : {}),
        };
        return person ? updateAttendee(person.id, input) : addEmployee(enrollment.id, input);
      },
      person ? "Saved." : enrolled ? "Added. Their portal login has been emailed to them." : "Added. Their login is created when the SME is enrolled."
    ).then((ok) => ok && setEditing(null));
  };

  const submitWithdraw = async () => {
    if (!withdrawing) return;
    const ok = await run("withdraw", () => withdrawAttendee(withdrawing.id, reason.trim()), `${withdrawing.name} withdrawn. Their login is disabled and upcoming invitations cancelled.`);
    if (ok) {
      setWithdrawing(null);
      setReason("");
    }
  };

  const submitOverride = async () => {
    if (!overriding) return;
    const override = { by: user?.uid || "", byName: String(user?.name || user?.email || "Staff"), reason: reason.trim(), at: new Date().toISOString() };
    const ok = await run("override", () => setAttendeeOverride(overriding.id, override), `${overriding.name} marked eligible.`);
    if (ok) {
      setOverriding(null);
      setReason("");
    }
  };

  const loginCell = (p: TrainingAttendee) => {
    if (p.status === "withdrawn") return <Typography.Text type="secondary">Disabled</Typography.Text>;
    if (p.userId) return <Tag color="green">Active</Tag>;
    if (!enrolled) return <Typography.Text type="secondary">After enrolment</Typography.Text>;
    return (
      <Tooltip title={`Creates a training-only login for ${p.email} and emails it`}>
        <Button size="small" shape="round" icon={<KeyOutlined />} loading={busy === `login-${p.id}`} onClick={() => createLogin(p)}>
          Create login
        </Button>
      </Tooltip>
    );
  };

  const createLogin = (p: TrainingAttendee) => void run(`login-${p.id}`, () => createAttendeeLogin(p.id), "Login created and emailed.");
  const toggleAttends = (p: TrainingAttendee, attends: boolean) =>
    void run(`attends-${p.id}`, () => updateAttendee(p.id, { attends }), attends ? "The director attends sessions." : "The director no longer attends sessions.");
  const canOverride = (p: TrainingAttendee) => !asDirector && p.status === "active" && p.progress?.eligibility.status !== "certified";

  /** A person as a phone card: what the table spreads over columns, with the row actions underneath. */
  const personCard = (p: TrainingAttendee) => {
    const extras = [
      ...(p.status === "active" && !p.userId && enrolled ? [{ key: "login", icon: <KeyOutlined />, label: "Create login", onClick: () => createLogin(p) }] : []),
      ...(canOverride(p) && p.eligibilityOverride
        ? [{ key: "undo", icon: <SafetyCertificateOutlined />, label: "Undo eligible override", onClick: () => void run(`override-${p.id}`, () => setAttendeeOverride(p.id, null), "Override removed.") }]
        : canOverride(p) && p.progress?.eligibility.status !== "eligible"
          ? [{ key: "eligible", icon: <SafetyCertificateOutlined />, label: "Mark eligible", onClick: () => { setReason(""); setOverriding(p); } }]
          : []),
    ];
    return {
      title: <span style={{ textDecoration: p.status === "withdrawn" ? "line-through" : undefined }}>{p.name}</span>,
      subtitle: p.email || "No email",
      badge: p.status === "withdrawn" ? <Tag color="red">Withdrawn</Tag> : <Tag color={p.kind === "director" ? "gold" : "blue"}>{p.kind === "director" ? "Director" : "Employee"}</Tag>,
      fields: [
        {
          label: "ID",
          value: (
            <Space direction="vertical" size={0}>
              <span>{p.idNumber || "—"}</span>
              {p.idDocument ? (
                <a href={p.idDocument.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                  <PaperClipOutlined /> ID copy
                </a>
              ) : (
                <Typography.Text type="warning" style={{ fontSize: 12 }}>
                  ID copy missing
                </Typography.Text>
              )}
            </Space>
          ),
        },
        { label: "Categories", value: p.categories?.length ? p.categories.join(", ") : "All sessions" },
        {
          label: "Attends",
          value:
            p.kind === "director" ? (
              <Switch size="small" checked={p.attends} loading={busy === `attends-${p.id}`} onChange={(attends) => toggleAttends(p, attends)} />
            ) : p.status === "withdrawn" ? (
              "No"
            ) : (
              "Yes"
            ),
        },
        {
          label: "Login",
          value: p.status === "withdrawn" ? "Disabled" : p.userId ? "Active" : enrolled ? "Not created" : "After enrolment",
        },
        {
          label: "Certification",
          value: p.kind === "director" && !p.attends ? "Doesn't attend" : <EligibilityTag eligibility={p.progress?.eligibility} />,
        },
      ],
      note: p.status === "withdrawn" && p.withdrawnReason ? <Typography.Text type="secondary">{p.withdrawnReason}</Typography.Text> : undefined,
      actions:
        p.status === "active"
          ? [
              <Button key="edit" icon={<EditOutlined />} onClick={() => openEditor(p)}>
                Edit
              </Button>,
              ...(p.kind === "employee"
                ? [
                    <Button key="withdraw" danger icon={<StopOutlined />} onClick={() => { setReason(""); setWithdrawing(p); }}>
                      Withdraw
                    </Button>,
                  ]
                : []),
              ...(extras.length
                ? [
                    <Dropdown key="more" trigger={["click"]} menu={{ items: extras }}>
                      <Button icon={<MoreOutlined />} loading={busy === `login-${p.id}` || busy === `override-${p.id}`}>
                        More
                      </Button>
                    </Dropdown>,
                  ]
                : []),
            ]
          : undefined,
    };
  };

  const title = enrollment ? `People · ${enrollment.companyName || enrollment.name}` : "People";
  const addButton = director && (
    <Button type="primary" shape="round" icon={<UserAddOutlined />} onClick={() => openEditor("new")}>
      Add employee
    </Button>
  );

  const body = (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Each person has their own login: they confirm their own sessions and check in by scanning the session QR code. Company documents stay on the
          SME's record; a person only gives their own ID.
          {asDirector ? " Training Academy staff are told when you add or withdraw someone." : ""}
        </Typography.Text>
        {!loading && !director && enrollment && (
          <Alert
            type="info"
            showIcon
            message="This SME's people aren't set up yet"
            description="Setting up creates the director's record from the SME's details. Until then the SME is invited to sessions as one record, as before."
            action={
              <Button size="small" type="primary" loading={busy === "director"} onClick={() => void run("director", () => ensureDirectorAttendee(enrollment.id), "People set up.")}>
                Set up
              </Button>
            }
          />
        )}
        {isMobile ? (
          <MobileCardList data={rows} loading={loading} getKey={(p: TrainingAttendee) => p.id} pageSize={50} emptyText="No people yet" renderCard={personCard} />
        ) : (
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 920 }}
          columns={[
            {
              title: "Name",
              key: "name",
              render: (_: unknown, p: TrainingAttendee) => (
                <Space direction="vertical" size={0}>
                  <Space size={6}>
                    <Typography.Text strong={p.kind === "director"} delete={p.status === "withdrawn"}>
                      {p.name}
                    </Typography.Text>
                    <Tag color={p.kind === "director" ? "gold" : "blue"}>{p.kind === "director" ? "Director" : "Employee"}</Tag>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {p.email || "No email"}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: "ID",
              key: "id",
              render: (_: unknown, p: TrainingAttendee) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{p.idNumber || <Typography.Text type="secondary">No ID number</Typography.Text>}</Typography.Text>
                  {p.idDocument ? (
                    <a href={p.idDocument.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      <PaperClipOutlined /> ID copy
                    </a>
                  ) : (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      ID copy missing
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            {
              title: "Categories",
              key: "categories",
              render: (_: unknown, p: TrainingAttendee) => (p.categories?.length ? p.categories.map((c) => <Tag key={c}>{c}</Tag>) : <Typography.Text type="secondary">All sessions</Typography.Text>),
            },
            {
              title: "Attends",
              key: "attends",
              render: (_: unknown, p: TrainingAttendee) =>
                p.kind === "director" ? (
                  <Tooltip title="Off when the director only owns the company and doesn't attend sessions">
                    <Switch size="small" checked={p.attends} loading={busy === `attends-${p.id}`} onChange={(attends) => toggleAttends(p, attends)} />
                  </Tooltip>
                ) : p.status === "withdrawn" ? (
                  <Tooltip title={p.withdrawnReason}>
                    <Tag color="red">Withdrawn</Tag>
                  </Tooltip>
                ) : (
                  <Tag color="green">Yes</Tag>
                ),
            },
            { title: "Login", key: "login", render: (_: unknown, p: TrainingAttendee) => loginCell(p) },
            {
              title: "Certification",
              key: "certification",
              render: (_: unknown, p: TrainingAttendee) =>
                p.kind === "director" && !p.attends ? (
                  <Typography.Text type="secondary">Doesn't attend</Typography.Text>
                ) : (
                  <Space size={4} wrap>
                    <EligibilityTag eligibility={p.progress?.eligibility} />
                    {!asDirector && p.status === "active" && p.progress?.eligibility.status !== "certified" && (
                      p.eligibilityOverride ? (
                        <Tooltip title={`Marked eligible by ${p.eligibilityOverride.byName}: ${p.eligibilityOverride.reason}`}>
                          <Button size="small" type="link" loading={busy === `override-${p.id}`} onClick={() => void run(`override-${p.id}`, () => setAttendeeOverride(p.id, null), "Override removed.")}>
                            Undo override
                          </Button>
                        </Tooltip>
                      ) : (
                        p.progress?.eligibility.status !== "eligible" && (
                          <Button size="small" type="link" onClick={() => { setReason(""); setOverriding(p); }}>
                            Mark eligible
                          </Button>
                        )
                      )
                    )}
                  </Space>
                ),
            },
            {
              title: "",
              key: "actions",
              width: 90,
              render: (_: unknown, p: TrainingAttendee) =>
                p.status === "active" && (
                  <Space>
                    <Tooltip title="Edit">
                      <Button shape="circle" size="small" icon={<EditOutlined />} onClick={() => openEditor(p)} aria-label={`Edit ${p.name}`} />
                    </Tooltip>
                    {p.kind === "employee" && (
                      <Tooltip title="Withdraw (e.g. they left the company)">
                        <Button shape="circle" size="small" danger icon={<StopOutlined />} onClick={() => { setReason(""); setWithdrawing(p); }} aria-label={`Withdraw ${p.name}`} />
                      </Tooltip>
                    )}
                  </Space>
                ),
            },
          ]}
        />
        )}
      </Space>
  );

  // Someone editing their own record is addressed as "you".
  const editingSelf = editing !== "new" && !!editing?.userId && editing.userId === user?.uid;
  const their = editingSelf ? "your" : "their";

  const modals = (
    <>
      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={editing === "new" ? "Add an employee" : editingSelf ? "Your details" : editing ? `Edit ${editing.name}` : ""}
        open={!!editing}
        onCancel={() => setEditing(null)}
        // One full-width action; closing (×, Esc, outside) cancels.
        footer={
          <Button type="primary" block size="large" disabled={!dirty} loading={busy === "save"} onClick={() => void submitPerson()}>
            {editing === "new" ? "Add employee" : "Save"}
          </Button>
        }
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={editorValues || undefined} onValuesChange={trackChanges}>
          <Form.Item name="name" label="Full name" rules={[{ required: true, whitespace: true, message: `Enter ${their} name` }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            extra={
              editing !== "new" && editing?.userId
                ? `This is ${their} login, so it can't be changed.`
                : "Each person needs their own email: it is their login."
            }
            rules={[{ required: true, type: "email", message: "Enter a valid email address" }]}
          >
            <Input disabled={editing !== "new" && !!editing?.userId} />
          </Form.Item>
          {/* Side by side on wide screens; stacked on phones. */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", columnGap: 12 }}>
            <Form.Item name="idNumber" label="ID number" rules={[{ required: true, whitespace: true, message: `Enter ${their} ID number` }]}>
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            name="idCopy"
            label="ID copy"
            valuePropName="fileList"
            getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)?.slice(-1)}
            extra={
              editing !== "new" && editing?.idDocument
                ? "Upload a new copy only to replace the one on file."
                : "A clear photo or scan of the ID document (image or PDF)."
            }
            // Required until a copy is on file, so "complete my ID" ends with one.
            rules={[{ required: editing === "new" || (!!editing && !editing.idDocument), message: "Upload a copy of the ID" }]}
          >
            <Upload beforeUpload={() => false} maxCount={1} accept="image/*,application/pdf">
              <Button icon={<UploadOutlined />}>Choose file</Button>
            </Upload>
          </Form.Item>
          {/* Categories only choose which sessions a person is invited to, so a director who doesn't attend has none to pick. */}
          {editing !== "new" && editing?.kind === "director" && !editing.attends ? (
            <Typography.Text type="secondary">
              {editingSelf
                ? 'You don\'t attend sessions, so there are no categories to choose. Turn on "I attend sessions" first if you will.'
                : "The director doesn't attend sessions, so there are no categories to choose."}
            </Typography.Text>
          ) : (
            <Form.Item
              name="categories"
              label={editingSelf ? "Categories you attend" : "Categories they attend"}
              extra={
                categories.length
                  ? `Only sessions in these categories are sent to ${editingSelf ? "you" : "them"}. Leave empty for every session.`
                  : "This training has no categories."
              }
            >
              <Select mode="multiple" allowClear disabled={!categories.length} options={categories.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={withdrawing ? `Withdraw ${withdrawing.name}` : ""}
        open={!!withdrawing}
        onCancel={() => setWithdrawing(null)}
        onOk={() => void submitWithdraw()}
        okText="Withdraw"
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        confirmLoading={busy === "withdraw"}
        destroyOnClose
      >
        <Typography.Paragraph>
          Their login is disabled and their invitations to sessions that haven't started are cancelled (without emailing them). Attendance already recorded stays.
        </Typography.Paragraph>
        <Input.TextArea rows={3} placeholder="Why, e.g. left the company" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={overriding ? `Mark ${overriding.name} eligible` : ""}
        open={!!overriding}
        onCancel={() => setOverriding(null)}
        onOk={() => void submitOverride()}
        okText="Mark eligible"
        okButtonProps={{ disabled: !reason.trim() }}
        confirmLoading={busy === "override"}
        destroyOnClose
      >
        <Typography.Paragraph>
          They become eligible for a certificate whatever the rules say. Your name and reason are kept with the decision.
        </Typography.Paragraph>
        {overriding?.progress?.eligibility.missing.length ? (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Still missing" description={<EligibilityChecklist eligibility={{ ...overriding.progress.eligibility, met: [] }} />} />
        ) : null}
        <Input.TextArea rows={3} placeholder="Why, e.g. attended a make-up session" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );

  // The director's portal page: the same people and dialogs, laid out as cards.
  if (variant === "page" && enrollment) {
    return (
      <>
        <SmePeopleLayout
          companyName={enrollment.companyName || enrollment.name}
          trainingName={training?.name}
          people={people}
          loading={loading}
          enrolled={enrolled}
          myUid={user?.uid}
          busy={busy}
          handlers={{
            onAdd: () => openEditor("new"),
            onEdit: openEditor,
            onWithdraw: (p) => {
              setReason("");
              setWithdrawing(p);
            },
            onToggleAttends: (p, attends) =>
              void run(`attends-${p.id}`, () => updateAttendee(p.id, { attends }), attends ? "You're now invited to sessions." : "You no longer attend sessions."),
            onCreateLogin: (p) => void run(`login-${p.id}`, () => createAttendeeLogin(p.id), `Login sent to ${p.email}.`),
            onSetUp: () => void run("director", () => ensureDirectorAttendee(enrollment.id), "People set up."),
          }}
        />
        {modals}
      </>
    );
  }
  // Phones get the system's bottom sheet (mobile-sheet), with Add employee as its full-width action.
  if (isMobile) {
    return (
      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={title}
        open={!!enrollment}
        onCancel={onClose}
        destroyOnClose
        footer={
          director ? (
            <Button type="primary" block size="large" icon={<UserAddOutlined />} onClick={() => openEditor("new")}>
              Add employee
            </Button>
          ) : null
        }
      >
        {body}
        {modals}
      </Modal>
    );
  }
  return (
    <Drawer title={title} open={!!enrollment} onClose={onClose} width={980} destroyOnClose extra={addButton}>
      {body}
      {modals}
    </Drawer>
  );
}
