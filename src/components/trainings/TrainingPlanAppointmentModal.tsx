import AppointmentDateTimeFields from '@/components/appointments/AppointmentDateTimeFields';
import React, { useEffect, useMemo, useState } from "react";
import { validatePlannedCoverage } from "@/lib/plannedCoverageValidation";
import { Alert, App, Button, Checkbox, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { PlanDeliverer, Training, TrainingAttendee, TrainingDeliveryMethod, TrainingEnrollment, TrainingPlanSession } from "./trainingStorage";
import { listTrainingAttendees, trainingInvitees } from "./attendeeStorage";
import { DELIVERY, DelivererSelect } from "./TrainingPlanDrawer";
import { type TrainingStaff, delivererName, listTrainingStaff, newPlanSessionId, recordBookedSession, scheduleTrainingSession } from "./trainingPlan";

type BookingForm = {
  planItemId?: string;
  title: string;
  description: string;
  deliverer: PlanDeliverer | null;
  category?: string | null;
  startsAt: Dayjs;
  endsAt: Dayjs;
  useDifferentLocation?: boolean;
  deliveryMethod: TrainingDeliveryMethod;
  location: string;
  meetingLink: string;
};

/**
 * Appointments' booking flow when the active programme is a training. Where
 * other programmes match a session to an assigned intervention, a training
 * matches it to an item of its plan (or, for a plan uploaded as a document,
 * to the document). The session is booked as a group appointment inviting
 * everyone attending (or one category), and recorded in training.plan so
 * the training dashboard, agenda and certificates count it.
 */
export function TrainingPlanAppointmentModal({
  open,
  trainingId,
  onClose,
  onBooked,
}: {
  open: boolean;
  trainingId: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { message } = App.useApp();
  const { user } = useFullIdentity();
  const isMobile = useIsMobile();
  const [form] = Form.useForm<BookingForm>();
  const [training, setTraining] = useState<Training | null>(null);
  const [smes, setSmes] = useState<TrainingEnrollment[]>([]);
  const [attendees, setAttendees] = useState<TrainingAttendee[]>([]);
  const [staff, setStaff] = useState<TrainingStaff[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !trainingId) return;
    let cancelled = false;
    setLoading(true);
    setTraining(null);
    setSmes([]);
    setAttendees([]);
    Promise.all([
      getDoc(doc(db, "trainings", trainingId)),
      getDocs(query(collection(db, "trainingEnrollments"), where("trainingId", "==", trainingId))),
      listTrainingAttendees(trainingId),
      listTrainingStaff(String(user?.departmentId || "")).catch(() => [] as TrainingStaff[]),
    ])
      .then(([trainingSnap, enrollmentSnap, people, staffList]) => {
        if (cancelled) return;
        setTraining(trainingSnap.exists() ? ({ ...(trainingSnap.data() as Omit<Training, "id">), id: trainingSnap.id } as Training) : null);
        setSmes(enrollmentSnap.docs.map((d) => ({ ...(d.data() as Omit<TrainingEnrollment, "id">), id: d.id })).filter((e) => e.status === "enrolled"));
        setAttendees(people);
        setStaff(staffList);
      })
      .catch((e) => !cancelled && message.error(e instanceof Error ? e.message : "Could not load the training plan."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, trainingId, user?.departmentId]);

  const plan = training?.deliveryPlan;
  const usesDocument = plan?.mode === "document";
  const items = useMemo(() => (usesDocument ? [] : plan?.items || []), [plan, usesDocument]);
  const bookedCount = (itemId: string) => (training?.plan || []).filter((s) => s.planItemId === itemId && s.appointmentSessionId).length;
  const isMine = (deliverer: PlanDeliverer | null) => deliverer?.kind === "staff" && deliverer.userId === user?.uid;
  // Items you deliver come first; anyone may book any item for the department.
  const itemOptions = [...items]
    .sort((a, b) => Number(isMine(b.deliverer)) - Number(isMine(a.deliverer)))
    .map((item) => ({
      value: item.id,
      selectedLabel: item.topic,
      label: (
        <Space size={6} wrap style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%' }}>
          <span>{item.topic}</span>
          {item.deliverer && <Typography.Text type="secondary">· {delivererName(item.deliverer)}</Typography.Text>}
          {isMine(item.deliverer) && <Tag color="green">You</Tag>}
          {!!bookedCount(item.id) && <Tag>{bookedCount(item.id)} booked</Tag>}
        </Space>
      ),
      search: `${item.topic} ${delivererName(item.deliverer)}`,
    }));

  // Starts on the first item you deliver. The form mounts only once the plan has loaded,
  // so these go in as its initial values (values set on it beforehand would be lost).
  const first = items.find((i) => isMine(i.deliverer)) || items[0];
  const initialValues: Partial<BookingForm> = {
    planItemId: first?.id,
    title: first?.topic || "",
    deliverer: first?.deliverer || null,
    deliveryMethod: "in_person",
    location: "At Center",
    useDifferentLocation: false,
  };

  const pickItem = (itemId?: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) form.setFieldsValue({ title: item.topic, deliverer: item.deliverer || null });
  };

  // The plan already says who delivers an item, so that isn't asked again; only an item
  // without one (or a plan uploaded as a document) asks who delivers the session.
  const pickedItemId = Form.useWatch("planItemId", form);
  const plannedDeliverer = items.find((i) => i.id === pickedItemId)?.deliverer || null;

  const delivery = Form.useWatch("deliveryMethod", form);
  const useDifferentLocation = Form.useWatch("useDifferentLocation", form);
  const category = Form.useWatch("category", form);
  const inviteCount = trainingInvitees(smes, attendees, category).length;
  const peopleLabel = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

  // destroyOnClose with preserve={false} clears the form, so closing needs no reset
  // (resetting while the "no plan" notice shows warns that the form isn't mounted).
  const close = () => onClose();

  const submit = async () => {
    if (!training || !user) return;
    const values = await form.validateFields();
    const deliverer = plannedDeliverer || values.deliverer;
    const person = deliverer?.kind === "staff" ? staff.find((s) => s.id === deliverer.userId) : undefined;
    // An external deliverer can't hold the appointment, so the person booking it does.
    const facilitator =
      deliverer?.kind === "staff"
        ? { id: deliverer.userId, name: deliverer.name, email: deliverer.email }
        : { id: user.uid, name: user.name || user.email || "", email: user.email || null };
    const session: TrainingPlanSession = {
      id: newPlanSessionId(),
      title: values.title.trim(),
      description: (values.description || "").trim(),
      topics: [values.title.trim()],
      category: values.category || null,
      courseIds: [],
      startAt: values.startsAt.second(0).millisecond(0).toISOString(),
      endAt: values.endsAt.second(0).millisecond(0).toISOString(),
      deliveryMethod: values.deliveryMethod,
      location: values.deliveryMethod === "in_person" ? (values.useDifferentLocation ? values.location.trim() : "At Center") : "",
      meetingLink: values.deliveryMethod === "virtual" ? (values.meetingLink || "").trim() : "",
      facilitatorId: facilitator.id,
      facilitatorName: facilitator.name,
      facilitatorEmail: facilitator.email,
      planItemId: values.planItemId || null,
      deliveredBy: deliverer?.kind === "external" ? deliverer.name : null,
    };
    const invitees = trainingInvitees(smes, attendees, session.category);
    setSaving(true);
    try {
      const appointmentSessionId = await scheduleTrainingSession(training, session, invitees, {
        departmentId: person?.departmentId || String(user.departmentId || ""),
        role: person?.role || String(user.role || ""),
      });
      await recordBookedSession(training.id, { ...session, appointmentSessionId });
      message.success(`Booked for ${peopleLabel(invitees.length)}. Invitations are on their agenda.`);
      onBooked();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not book the session.");
    } finally {
      setSaving(false);
    }
  };

  // Two fields to a row on wide screens; stacked on phones.
  const pairStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", columnGap: 12 };

  const noPlan = !loading && training && !plan;
  const nothingToBook = !loading && training && plan && !usesDocument && !items.length;

  return (
    <Modal
      wrapClassName="mobile-sheet"
      centered
      title={training ? `Schedule a session · ${training.name}` : "Schedule a session"}
      open={open}
      onCancel={close}
      destroyOnClose
      width={800}
      styles={{ body: { maxHeight: "72vh", overflowY: "auto", overflowX: "hidden" } }}
      footer={
        <Button type="primary" block size="large" loading={saving} disabled={loading || !training || !!noPlan || !!nothingToBook} onClick={() => void submit()}>
          {inviteCount ? `Book for ${peopleLabel(inviteCount)}` : "Book session"}
        </Button>
      }
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 32 }}>
          <Spin />
        </div>
      ) : !training ? (
        <Empty description="This training could not be found." />
      ) : noPlan || nothingToBook ? (
        <Alert
          type="warning"
          showIcon
          message="This training has no plan yet"
          description="Set out what it covers and who delivers it under Training → Trainings → Plan, then book its sessions here."
        />
      ) : (
        <Form form={form} layout="vertical" preserve={false} requiredMark={false} initialValues={initialValues}>
          {usesDocument ? (
            <Alert
              type="info"
              showIcon
              icon={<FileTextOutlined />}
              style={{ marginBottom: 16 }}
              message={
                <span>
                  This training's plan is a document:{" "}
                  <Typography.Link href={plan!.document!.url} target="_blank" rel="noreferrer">
                    {plan!.document!.name}
                  </Typography.Link>
                  . Name the part of it this session delivers.
                </span>
              }
            />
          ) : (
            <Form.Item name="planItemId" label="Plan item" rules={[{ required: true, message: "Choose what this session delivers" }]}>
              <Select showSearch optionFilterProp="search" optionLabelProp="selectedLabel" options={itemOptions} onChange={pickItem} placeholder="What this session delivers" style={{ width: '100%', minWidth: 0 }} />
            </Form.Item>
          )}
          <div style={{ ...pairStyle, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 2fr) minmax(0, 1fr)" }}>
          <Form.Item name="title" label="Session title" rules={[{ required: true, whitespace: true, message: "Name the session" }]}>
            <Input placeholder="e.g. Bookkeeping basics" />
          </Form.Item>
          {plannedDeliverer ? (
            <Form.Item
              label="Delivered by"
            >
              <Typography.Text strong>{plannedDeliverer.name}</Typography.Text>
            </Form.Item>
          ) : (
            <Form.Item
              name="deliverer"
              label="Delivered by"
              rules={[{ required: true, message: "Who delivers it?" }]}
              extra={
                usesDocument
                  ? "Who delivers this part of the plan document. Someone not in the system is shown by name; you hold the appointment for them."
                  : "No facilitator assigned. Choose someone or type an external name."
              }
            >
              <DelivererSelect key={pickedItemId || "document"} staff={staff} />
            </Form.Item>
          )}
          </div>
          <Form.Item name="description" label="What it covers" rules={[{ required: true, message: "Describe what the session will cover." }, { validator: validatePlannedCoverage }]} extra="At least 5 words. Explain what participants will learn or do.">
            <Input.TextArea rows={2} placeholder="Shown to SMEs on their agenda" />
          </Form.Item>
          <AppointmentDateTimeFields form={form} />
          <div style={pairStyle}>
            <Form.Item name="deliveryMethod" label="Delivery">
              <Select options={DELIVERY} onChange={() => form.setFieldsValue({ location: "At Center", useDifferentLocation: false, meetingLink: "" })} />
            </Form.Item>
            <Form.Item
              name="category"
              label="For category"
              extra={training.categories?.length ? "Leave empty to invite everyone attending." : undefined}
            >
              <Select
                allowClear
                placeholder="Everyone attending"
                disabled={!training.categories?.length}
                options={(training.categories || []).map((c) => ({ value: c, label: c }))}
              />
            </Form.Item>
          </div>
          {delivery === "virtual" ? (
            <Form.Item name="meetingLink" label="Meeting link" rules={[{ required: true, whitespace: true, message: "Please provide the meeting link." }]}>
              <Input placeholder="https://" />
            </Form.Item>
          ) : delivery === "in_person" ? (
            <div style={pairStyle}>
              <Form.Item name="location" label="Location" rules={[{ required: true, whitespace: true, message: "Please provide the appointment location." }]}>
                <Input disabled={!useDifferentLocation} placeholder={useDifferentLocation ? "Enter venue or address" : "At Center"} />
              </Form.Item>
              <Form.Item name="useDifferentLocation" valuePropName="checked" style={{ marginTop: isMobile ? 0 : 30 }}>
                <Checkbox onChange={event => form.setFieldValue("location", event.target.checked ? "" : "At Center")}>
                  Use different location
                </Checkbox>
              </Form.Item>
            </div>
          ) : null}
          {!inviteCount && (
            <Alert
              type="warning"
              showIcon
              message={
                !smes.length
                  ? "No SMEs are enrolled in this training yet."
                  : category
                    ? `No one attending is in the ${category} category yet.`
                    : "No one from the enrolled SMEs is set to attend yet. Set who attends under Training → SMEs → People."
              }
            />
          )}
        </Form>
      )}
    </Modal>
  );
}
