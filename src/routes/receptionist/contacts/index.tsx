import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Select,
  message,
  Input,
  Modal,
  Row,
  Skeleton,
} from "antd";
import {
  ExportOutlined,
  PlusOutlined,
  RightOutlined,
  EditOutlined,
  FileTextOutlined,
  MailOutlined,
  PhoneOutlined,
  SearchOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Helmet } from "react-helmet";
import { format, isSameMonth, startOfMonth, subMonths } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { inquiryService } from "@/services/inquiryService";
import { contactService } from "@/services/contactService";
import {
  buildContactDirectory,
  CONTACT_CATEGORIES,
  contactEmail,
  contactPhone,
  type ContactInput,
  type SavedContact,
  type DirectoryContact as Contact,
} from "@/lib/contactDirectory";
import { Inquiry, STATUS_COLORS } from "@/types/inquiry";
import { AdminKpiTile, AdminMiniBars } from "@/components/admin/AdminKpiTile";
import InquiryDetail from "@/components/receptionist/InquiryDetail";
import "@/styles/admin-overview.css";
import "@/styles/receptionist-dashboard.css";
import "./contacts.css";
import { DashboardFilterBar } from "@/components/dashboards/metrics/Header";

/** The contact types the directory can be filtered by. */
const TYPE_FILTERS: [string, string][] = [
  ["all", "All contacts"],
  ["Stakeholder", "Stakeholders"],
  ["Funder", "Funders"],
  ["Incubatee", "Incubatees"],
  ["Potential Incubatee", "Potential Incubatees"],
  ["Visitor", "Visitors"],
  ["Unclassified", "Unclassified"],
];

const dateLabel = (date: Date) =>
  Number.isNaN(date.getTime())
    ? "Date unavailable"
    : format(date, "dd MMM yyyy");

const ContactsList: React.FC = () => {
  const { user, loading: userLoading } = useAuth();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [savedContacts, setSavedContacts] = useState<SavedContact[]>([]);
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ContactInput>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(20);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [inquiryId, setInquiryId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInquiries([]);
    setSavedContacts([]);
    setFormOpen(false);
    setSelected(null);
    setInquiryId(null);
    if (!user?.assignedBranch) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    Promise.all([
      inquiryService.getInquiriesByBranch(user.assignedBranch),
      contactService.list(user.assignedBranch),
    ])
      .then(([rows, saved]) => {
        if (!cancelled) {
          setInquiries(rows);
          setSavedContacts(saved);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.assignedBranch, retry]);

  const contacts = useMemo(
    () => buildContactDirectory(inquiries, savedContacts),
    [inquiries, savedContacts]
  );
  const openForm = (contact: Contact | null = null) => {
    setEditing(contact);
    form.resetFields();
    form.setFieldsValue(
      contact
        ? {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            company: contact.company,
            category:
              contact.category === "Unclassified"
                ? undefined
                : contact.category,
          }
        : {
            category: CONTACT_CATEGORIES.includes(
              category as ContactInput["category"]
            )
              ? (category as ContactInput["category"])
              : undefined,
          }
    );
    setFormOpen(true);
  };
  const saveContact = async (values: ContactInput) => {
    if (!user?.assignedBranch || !user.uid) return;
    const email = contactEmail(values.email || "");
    const phone = contactPhone(values.phone || "");
    const duplicate = contacts.find(
      (contact) =>
        contact.id !== editing?.id &&
        (email
          ? contactEmail(contact.email) === email
          : !contact.email && phone && contactPhone(contact.phone) === phone)
    );
    if (duplicate) {
      message.error(
        "This contact already exists. Edit their existing entry instead."
      );
      return;
    }
    setSaving(true);
    try {
      await contactService.save(
        {
          ...values,
          email: values.email || "",
          phone: values.phone || "",
          company: values.company || "",
          linkedInquiryIds: [
            ...new Set([
              ...(savedContacts.find(
                (contact) => contact.id === editing?.savedId
              )?.linkedInquiryIds || []),
              ...(editing?.inquiries.map((inquiry) => inquiry.id) || []),
            ]),
          ],
        },
        user.assignedBranch,
        user.uid,
        editing?.savedId
      );
      setFormOpen(false);
      setSelected(null);
      setCategory(values.category);
      setSearch("");
      setRetry((value) => value + 1);
      message.success("Contact saved");
    } catch {
      message.error(
        "Could not save the contact. Your changes are still here; please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  // How contacts and inquiries are coming in, month by month. These are figures
  // only; the directory itself is filtered by category, not by when or how often.
  const growth = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) =>
      startOfMonth(subMonths(new Date(), 5 - i))
    );
    const monthOf = (date: Date | null) =>
      date ? months.findIndex((m) => isSameMonth(m, date)) : -1;
    // A contact is new in the month it was first seen: its first inquiry, or when it was saved.
    const firstSeen = (contact: Contact): Date | null => {
      const created = (contact as any).createdAt;
      const dates = [
        ...contact.inquiries.map((inquiry) => new Date(inquiry.submittedAt)),
        ...(typeof created?.toDate === "function" ? [created.toDate()] : []),
      ].filter((date) => !Number.isNaN(date.getTime()));
      return dates.length
        ? new Date(Math.min(...dates.map((date) => date.getTime())))
        : null;
    };
    const newContacts = months.map(() => 0);
    contacts.forEach((contact) => {
      const index = monthOf(firstSeen(contact));
      if (index >= 0) newContacts[index] += 1;
    });
    const newInquiries = months.map(() => 0);
    inquiries.forEach((inquiry) => {
      const index = monthOf(new Date(inquiry.submittedAt));
      if (index >= 0) newInquiries[index] += 1;
    });
    const bars = (values: number[]) =>
      months.map((month, i) => ({
        key: month.getTime(),
        label: format(month, "MMM"),
        value: values[i],
      }));
    return {
      newThisMonth: newContacts[5],
      inquiriesThisMonth: newInquiries[5],
      newBars: bars(newContacts),
      inquiryBars: bars(newInquiries),
    };
  }, [contacts, inquiries]);

  const query = search.trim().toLowerCase();
  const visible = contacts.filter(
    (contact) =>
      (category === "all" || contact.category === category) &&
      [contact.name, contact.email, contact.phone, contact.company].some(
        (value) => value?.toLowerCase().includes(query)
      )
  );
  useEffect(() => {
    setShown(20);
  }, [search, category]);

  const exportContacts = () => {
    const cell = (value: string | number) => {
      const text = String(value);
      return `"${(/^[=+@\-\t\r\n]/.test(text) ? "'" + text : text).replace(
        /"/g,
        '""'
      )}"`;
    };
    const rows = [
      [
        "Name",
        "Email",
        "Phone",
        "Company",
        "Category",
        "Inquiries",
        "Latest inquiry",
        "Latest status",
      ],
      ...visible.map((c) => [
        c.name,
        c.email,
        c.phone,
        c.company || "",
        c.category,
        c.inquiries.length,
        c.latest ? dateLabel(new Date(c.latest.submittedAt)) : "",
        c.latest?.status || "",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8;" }
      )
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `contacts-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (userLoading)
    return (
      <div className="admin-overview rcp-dashboard">
        <Card className="admin-card" bordered={false}>
          <Skeleton active />
        </Card>
      </div>
    );
  if (!user?.assignedBranch)
    return (
      <div className="admin-overview rcp-dashboard">
        <Card className="admin-card" bordered={false}>
          <Empty description="Ask your Director to assign you to a branch to access contacts." />
        </Card>
      </div>
    );

  return (
    <div className="admin-overview rcp-dashboard rcp-contacts">
      <Helmet>
        <title>Contacts | Reception</title>
      </Helmet>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <AdminKpiTile
            icon={<UserOutlined />}
            label="Total contacts"
            value={contacts.length}
            loading={loading || error}
          />
        </Col>
        <Col xs={24} md={8}>
          <AdminKpiTile
            icon={<UserAddOutlined />}
            label="New contacts this month"
            value={growth.newThisMonth}
            loading={loading || error}
            visual={<AdminMiniBars bars={growth.newBars} />}
          />
        </Col>
        <Col xs={24} md={8}>
          <AdminKpiTile
            icon={<FileTextOutlined />}
            label="Inquiries this month"
            value={growth.inquiriesThisMonth}
            loading={loading || error}
            visual={<AdminMiniBars bars={growth.inquiryBars} />}
          />
        </Col>
      </Row>
      {/* One filter bar: what kind of contact, search, and the page's actions. */}
      <DashboardFilterBar className="rcp-contact-filterbar" borderRadius={16} marginBottom={16}>
        <Select
          className="rcp-contact-type"
          value={category}
          onChange={setCategory}
          aria-label="Contact type"
          popupMatchSelectWidth={false}
          options={TYPE_FILTERS.map(([value, label]) => ({
            value,
            label: (
              <span className="rcp-contact-type-option">
                {label}
                <span className="rcp-fu-tab-count">
                  {loading || error
                    ? "—"
                    : value === "all"
                    ? contacts.length
                    : contacts.filter((contact) => contact.category === value).length}
                </span>
              </span>
            ),
          }))}
        />
        <Input
          className="rcp-contact-search"
          prefix={<SearchOutlined />}
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, phone or company"
          aria-label="Search contacts"
        />
        <div className="rcp-contact-bar-actions">
          {(search || category !== "all") && (
            <Button
              type="text"
              onClick={() => {
                setSearch("");
                setCategory("all");
              }}
            >
              Clear filters
            </Button>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openForm()}
            disabled={loading || error}
          >
            Add contact
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={exportContacts}
            disabled={loading || error || !visible.length}
          >
            Export
          </Button>
        </div>
      </DashboardFilterBar>
      <Card className="admin-card rcp-fu-card" bordered={false}>
        {error ? (
          <Alert
            type="error"
            showIcon
            message="Could not load contacts"
            action={
              <Button onClick={() => setRetry((value) => value + 1)}>
                Retry
              </Button>
            }
          />
        ) : loading ? (
          <Skeleton active avatar paragraph={{ rows: 5 }} />
        ) : visible.length ? (
          <>
            {/* Aligned columns; the whole row opens the contact's card (edit is there). */}
            <div className="rcp-crow rcp-crow-head" aria-hidden="true">
              <span>Contact</span>
              <span>Reach</span>
              <span>Type</span>
              <span>Inquiries</span>
              <span>Latest inquiry</span>
              <span />
            </div>
            <ul className="rcp-crow-list">
              {visible.slice(0, shown).map((contact) => {
                const open = () => setSelected(contact);
                const stop = (event: React.MouseEvent) => event.stopPropagation();
                return (
                  <li key={contact.id} className="rcp-crow" onClick={open}>
                    <button
                      type="button"
                      className="rcp-crow-person"
                      onClick={(event) => {
                        event.stopPropagation();
                        open();
                      }}
                      aria-label={`Open ${contact.name}`}
                    >
                      <Avatar size={38} className="rcp-inquiry-avatar">
                        {contact.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((word) => word.charAt(0))
                          .join("")
                          .toUpperCase()}
                      </Avatar>
                      <span className="rcp-crow-name">
                        <strong>{contact.name}</strong>
                        <span>{contact.company || "Individual"}</span>
                      </span>
                    </button>
                    <span className="rcp-crow-reach">
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} onClick={stop} title={contact.email}>
                          <MailOutlined />
                          <span>{contact.email}</span>
                        </a>
                      ) : null}
                      {contact.phone ? (
                        <a href={`tel:${contact.phone}`} onClick={stop}>
                          <PhoneOutlined />
                          <span>{contact.phone}</span>
                        </a>
                      ) : null}
                      {!contact.email && !contact.phone && (
                        <span className="rcp-contact-meta">No contact details</span>
                      )}
                    </span>
                    <span className="rcp-crow-type">
                      <span
                        className="rcp-pill"
                        style={{ "--pill": "var(--rcp-accent)" } as React.CSSProperties}
                      >
                        {contact.category}
                      </span>
                    </span>
                    <span className="rcp-crow-count" data-label="Inquiries">
                      {contact.inquiries.length}
                    </span>
                    <span className="rcp-crow-latest">
                      {contact.latest ? dateLabel(new Date(contact.latest.submittedAt)) : "—"}
                    </span>
                    <RightOutlined className="rcp-crow-chevron" aria-hidden="true" />
                  </li>
                );
              })}
            </ul>
            {visible.length > shown && (
              <Button
                block
                type="text"
                onClick={() => setShown((value) => value + 20)}
                style={{ marginTop: 12 }}
              >
                Show {Math.min(20, visible.length - shown)} more contacts
              </Button>
            )}
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              search || category !== "all"
                ? "No contacts match your search and filters."
                : "Add your first contact or record an inquiry to populate the directory."
            }
          />
        )}
      </Card>
      {/* A contact's card: who they are, how to reach them, and every inquiry they have made. */}
      <Modal
        open={!!selected}
        onCancel={() => setSelected(null)}
        footer={null}
        width={640}
        className="rcp-contact-modal"
        title={null}
      >
        {selected && (() => {
          const history = [...selected.inquiries].sort(
            (a, b) =>
              new Date(b.submittedAt).getTime() -
              new Date(a.submittedAt).getTime()
          );
          const first = history[history.length - 1];
          return (
            <>
              <header className="rcp-cm-head">
                <Avatar size={56} className="rcp-inquiry-avatar">
                  {selected.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word.charAt(0))
                    .join("")
                    .toUpperCase()}
                </Avatar>
                <div className="rcp-cm-title">
                  <h2>{selected.name}</h2>
                  <span>{selected.company || "Individual"}</span>
                  <span
                    className="rcp-pill"
                    style={{ "--pill": "var(--rcp-accent)" } as React.CSSProperties}
                  >
                    {selected.category}
                  </span>
                </div>
                <Button
                  icon={<EditOutlined />}
                  onClick={() => openForm(selected)}
                  className="rcp-cm-edit"
                >
                  Edit
                </Button>
              </header>

              <div className="rcp-cm-reach">
                {selected.email ? (
                  <a href={`mailto:${selected.email}`}>
                    <MailOutlined />
                    <span>{selected.email}</span>
                  </a>
                ) : (
                  <span className="is-missing">
                    <MailOutlined /> No email
                  </span>
                )}
                {selected.phone ? (
                  <a href={`tel:${selected.phone}`}>
                    <PhoneOutlined />
                    <span>{selected.phone}</span>
                  </a>
                ) : (
                  <span className="is-missing">
                    <PhoneOutlined /> No phone
                  </span>
                )}
              </div>

              <dl className="rcp-cm-stats">
                <div>
                  <dt>Inquiries</dt>
                  <dd>{history.length}</dd>
                </div>
                <div>
                  <dt>First seen</dt>
                  <dd>{first ? dateLabel(new Date(first.submittedAt)) : "—"}</dd>
                </div>
                <div>
                  <dt>Latest</dt>
                  <dd>
                    {history[0] ? dateLabel(new Date(history[0].submittedAt)) : "—"}
                  </dd>
                </div>
              </dl>

              <h3 className="rcp-cm-section">Inquiry history</h3>
              {history.length ? (
                <ol className="rcp-cm-history">
                  {history.map((inquiry) => (
                    <li key={inquiry.id}>
                      <button
                        type="button"
                        onClick={() => setInquiryId(inquiry.id)}
                        aria-label={`Open the ${inquiry.inquiryDetails?.inquiryType || ""} inquiry from ${dateLabel(new Date(inquiry.submittedAt))}`}
                      >
                        <span className="rcp-cm-history-top">
                          <strong>
                            {inquiry.inquiryDetails?.inquiryType || "Inquiry"}
                          </strong>
                          <time>{dateLabel(new Date(inquiry.submittedAt))}</time>
                        </span>
                        {inquiry.inquiryDetails?.description && (
                          <span className="rcp-cm-history-text">
                            {inquiry.inquiryDetails.description}
                          </span>
                        )}
                        <span className="rcp-inquiry-meta">
                          <span
                            className="rcp-pill"
                            style={
                              {
                                "--pill":
                                  STATUS_COLORS[
                                    inquiry.status as keyof typeof STATUS_COLORS
                                  ] || "#8c8c8c",
                              } as React.CSSProperties
                            }
                          >
                            {inquiry.status}
                          </span>
                          {(inquiry.inquiryDetails as any)?.department && (
                            <span className="rcp-contact-meta">
                              {(inquiry.inquiryDetails as any).department}
                            </span>
                          )}
                          <RightOutlined className="rcp-cm-open" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No inquiries recorded for this contact yet."
                />
              )}
            </>
          );
        })()}
      </Modal>
      <Modal
        title={editing ? "Edit contact" : "Add contact"}
        open={formOpen}
        onCancel={() => {
          if (!saving) setFormOpen(false);
        }}
        onOk={() => form.submit()}
        okText="Save contact"
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={saveContact}
          disabled={saving}
        >
          <Form.Item
            name="name"
            label="Contact name"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "Enter a contact name",
              },
            ]}
          >
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item
            name="category"
            label="Category"
            rules={[{ required: true, message: "Choose a category" }]}
          >
            <Select
              placeholder="Choose a category"
              options={CONTACT_CATEGORIES.map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="company" label="Organisation / business">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            dependencies={["phone"]}
            rules={[
              {
                type: "email",
                message: "Enter a valid email address",
                transform: (value) => value?.trim(),
              },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  value?.trim() || getFieldValue("phone")?.trim()
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error("Enter an email address or phone number")
                      ),
              }),
            ]}
          >
            <Input maxLength={254} type="email" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Phone"
            dependencies={["email"]}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value?.trim()
                    ? getFieldValue("email")?.trim()
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error("Enter a phone number or email address")
                        )
                    : /^[+\d\s().-]+$/.test(value) &&
                      value.replace(/\D/g, "").length >= 7
                    ? Promise.resolve()
                    : Promise.reject(new Error("Enter a valid phone number")),
              }),
            ]}
          >
            <Input maxLength={40} type="tel" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="Inquiry details"
        open={!!inquiryId}
        onCancel={() => setInquiryId(null)}
        footer={null}
        width={1000}
        destroyOnClose
      >
        {inquiryId && <InquiryDetail inquiryId={inquiryId} embedded />}
      </Modal>
    </div>
  );
};

export default ContactsList;
