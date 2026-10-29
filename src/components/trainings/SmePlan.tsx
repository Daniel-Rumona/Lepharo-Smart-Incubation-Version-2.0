import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Col, Empty, Grid, Input, Modal, Row, Segmented, Select, Skeleton, Space, Tag, Typography, theme } from "antd";
import {
  BookOutlined,
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  EnvironmentOutlined,
  LeftOutlined,
  LinkOutlined,
  RightOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import type { DayCellContentArg, EventClickArg, EventContentArg, EventInput } from "@fullcalendar/core";
import { useNavigate } from "react-router-dom";
import { learnerCoursePath, useLearnerCourses } from "@/components/courses/learnerCourses";
import type { SmeConfirmation } from "@/types/appointment";
import { type AgendaEntry, type AgendaPerson, useMyAgenda } from "./useMyAgenda";
import "@/styles/calender.css";

const DELIVERY_LABEL: Record<string, string> = { in_person: "In person", virtual: "Virtual", telephonically: "Telephonic" };

export function entryState(entry: AgendaEntry): { color: string; label: string } {
  // A director who doesn't attend follows the session through the company's people.
  if (!entry.invitationId && entry.people.length) {
    if (entry.status === "completed") return { color: "green", label: `Held · ${entry.people.filter((p) => p.attended).length}/${entry.people.length} attended` };
    const waiting = entry.people.filter((p) => p.confirmation === "pending").length;
    return waiting ? { color: "gold", label: `${waiting} to reply` } : { color: "blue", label: `${entry.people.length} invited` };
  }
  if (entry.status === "completed") return entry.attended ? { color: "green", label: "Attended" } : { color: "default", label: "Held" };
  if (!entry.invitationId) return { color: "default", label: entry.startAt ? "Planned" : "Date to be confirmed" };
  if (entry.confirmation === "confirmed") return { color: "blue", label: "Confirmed" };
  if (entry.confirmation === "declined") return { color: "red", label: "Declined" };
  return { color: "gold", label: "Please respond" };
}

export const entryWhen = (entry: AgendaEntry) =>
  entry.startAt
    ? `${dayjs(entry.startAt).format("ddd DD MMM YYYY, HH:mm")}${entry.endAt ? ` – ${dayjs(entry.endAt).format("HH:mm")}` : ""}`
    : "Date to be confirmed";

type Agenda = Pick<ReturnType<typeof useMyAgenda>, "entries" | "respond" | "respondSeries">;

/** Confirm / decline buttons for a booked, upcoming session; a repeating one can be confirmed all at once. */
export function RespondButtons({ entry, agenda }: { entry: AgendaEntry; agenda: Agenda }) {
  const { message } = App.useApp();
  const { respond, respondSeries } = agenda;
  const seriesPending = entry.seriesId
    ? agenda.entries.filter(
        (e) => e.seriesId === entry.seriesId && e.invitationId && e.confirmation !== "confirmed" && e.startAt && e.startAt.getTime() > Date.now()
      ).length
    : 0;
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const upcoming = entry.startAt && (entry.endAt || entry.startAt).getTime() > Date.now();
  if (!entry.invitationId || !upcoming || entry.status === "completed") return null;
  const send = async (confirmation: "confirmed" | "declined") => {
    setBusy(true);
    try {
      await respond(entry.invitationId!, confirmation, reason.trim());
      message.success(confirmation === "confirmed" ? "Attendance confirmed." : "Your trainer has been told you can't attend.");
      setDeclining(false);
    } catch {
      message.error("Could not save your response. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Space size={8} wrap>
        {entry.confirmation !== "confirmed" && (
          <Button size="small" shape="round" type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => void send("confirmed")}>
            I'll attend
          </Button>
        )}
        {seriesPending > 1 && (
          <Button
            size="small"
            shape="round"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const n = await respondSeries(entry.seriesId!);
                message.success(`Confirmed ${n} upcoming session${n === 1 ? "" : "s"}.`);
              } catch {
                message.error("Could not save your responses. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Attend all {seriesPending}
          </Button>
        )}
        {entry.confirmation !== "declined" && (
          <Button size="small" shape="round" icon={<CloseOutlined />} onClick={() => setDeclining(true)}>
            Can't attend
          </Button>
        )}
      </Space>
      <Modal
        title="Can't attend?"
        open={declining}
        onCancel={() => setDeclining(false)}
        onOk={() => void send("declined")}
        okText="Let my trainer know"
        okButtonProps={{ danger: true, loading: busy, disabled: !reason.trim() }}
      >
        <Typography.Paragraph type="secondary">Tell your trainer why, so they can help you catch up.</Typography.Paragraph>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      </Modal>
    </>
  );
}

const REPLY_TAG: Record<SmeConfirmation, { color: string; label: string }> = {
  pending: { color: "gold", label: "No reply" },
  confirmed: { color: "blue", label: "Confirmed" },
  declined: { color: "red", label: "Declined" },
};

/** One person's line in the director's team list, with confirm / decline on their behalf before the session. */
function PersonReply({ person, entry, agenda }: { person: AgendaPerson; entry: AgendaEntry; agenda: Agenda }) {
  const { message } = App.useApp();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const upcoming = !!entry.startAt && (entry.endAt || entry.startAt).getTime() > Date.now() && entry.status !== "completed";
  const send = async (confirmation: "confirmed" | "declined") => {
    setBusy(true);
    try {
      await agenda.respond(person.invitationId, confirmation, reason.trim());
      message.success(confirmation === "confirmed" ? `${person.name} confirmed.` : `The trainer has been told ${person.name} can't attend.`);
      setDeclining(false);
    } catch {
      message.error("Could not save the response. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const tag = entry.status === "completed" ? (person.attended ? { color: "green", label: "Attended" } : { color: "default", label: "Not attended" }) : REPLY_TAG[person.confirmation];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Space size={6}>
        <Typography.Text>{person.isMe ? `${person.name} (you)` : person.name}</Typography.Text>
        <Tag color={tag.color}>{tag.label}</Tag>
      </Space>
      {upcoming && !person.isMe && (
        <Space size={4}>
          {person.confirmation !== "confirmed" && (
            <Button size="small" shape="round" icon={<CheckOutlined />} loading={busy} onClick={() => void send("confirmed")}>
              Will attend
            </Button>
          )}
          {person.confirmation !== "declined" && (
            <Button size="small" shape="round" icon={<CloseOutlined />} onClick={() => setDeclining(true)}>
              Can't attend
            </Button>
          )}
        </Space>
      )}
      <Modal
        title={`${person.name} can't attend?`}
        open={declining}
        onCancel={() => setDeclining(false)}
        onOk={() => void send("declined")}
        okText="Let the trainer know"
        okButtonProps={{ danger: true, loading: busy, disabled: !reason.trim() }}
      >
        <Typography.Paragraph type="secondary">Tell the trainer why, so they can help {person.name} catch up.</Typography.Paragraph>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      </Modal>
    </div>
  );
}

/** The director's view of who from the company is invited to a session. Only people check themselves in. */
function TeamReplies({ entry, agenda }: { entry: AgendaEntry; agenda: Agenda }) {
  const { token } = theme.useToken();
  if (!entry.people.length || (entry.people.length === 1 && entry.people[0].isMe)) return null;
  return (
    <div style={{ padding: "8px 10px", borderRadius: token.borderRadius, background: token.colorFillAlter }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <TeamOutlined /> FROM YOUR COMPANY
      </Typography.Text>
      <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
        {entry.people.map((p) => (
          <PersonReply key={p.invitationId} person={p} entry={entry} agenda={agenda} />
        ))}
      </Space>
    </div>
  );
}

/** Colour family for a session, reusing the shared calendar's event / appointment / task accents. */
function entryTone(entry: AgendaEntry): "event" | "appointment" | "task" {
  if (entry.status === "completed") return "event";
  if (entry.invitationId && entry.confirmation !== "confirmed" && entry.confirmation !== "declined") return "task";
  if (entry.people.some((p) => !p.isMe && p.confirmation === "pending")) return "task";
  return "appointment";
}

const TONE_LEGEND: { tone: "appointment" | "task" | "event"; label: string }[] = [
  { tone: "appointment", label: "Booked" },
  { tone: "task", label: "Needs your reply" },
  { tone: "event", label: "Held" },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, m) => ({ value: m, label: dayjs().month(m).format("MMMM") }));

const timeRange = (entry: AgendaEntry) =>
  entry.startAt ? `${dayjs(entry.startAt).format("HH:mm")}${entry.endAt ? ` – ${dayjs(entry.endAt).format("HH:mm")}` : ""}` : "Time to be confirmed";

const duration = (entry: AgendaEntry) => {
  if (!entry.startAt || !entry.endAt) return "";
  const mins = dayjs(entry.endAt).diff(entry.startAt, "minute");
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

/** The full session: where, who, what it covers, linked courses and the reply buttons. */
function EntryDetails({
  entry,
  courseTitle,
  agenda,
}: {
  entry: AgendaEntry;
  courseTitle: Map<string, { title: string; percent?: number }>;
  agenda: Agenda;
}) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Space size={[12, 2]} wrap style={{ color: token.colorTextSecondary, fontSize: 13 }}>
        <span>
          <CalendarOutlined /> {entryWhen(entry)}
        </span>
        <span>
          <EnvironmentOutlined /> {DELIVERY_LABEL[entry.deliveryMethod] || "Session"}
          {entry.location ? ` · ${entry.location}` : ""}
        </span>
        {entry.facilitatorName && (
          <span>
            <UserOutlined /> {entry.facilitatorName}
          </span>
        )}
        {entry.meetingLink && (
          <a href={entry.meetingLink} target="_blank" rel="noreferrer">
            <LinkOutlined /> Join link
          </a>
        )}
      </Space>
      {entry.description && <Typography.Paragraph style={{ margin: 0 }}>{entry.description}</Typography.Paragraph>}
      {(!!entry.courseIds.length || !!entry.topics.length) && (
        <Space size={[4, 4]} wrap>
          {entry.courseIds.map((id) => {
            const course = courseTitle.get(id);
            return course ? (
              <Tag key={id} color="blue" icon={<BookOutlined />} style={{ cursor: "pointer" }} onClick={() => navigate(learnerCoursePath(id))}>
                {course.title}
                {course.percent !== undefined ? ` · ${course.percent}%` : ""}
              </Tag>
            ) : null;
          })}
          {entry.topics.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </Space>
      )}
      <RespondButtons entry={entry} agenda={agenda} />
      <TeamReplies entry={entry} agenda={agenda} />
    </Space>
  );
}

/** List-view card: a date block beside the session details. */
function EntryCard({
  entry,
  courseTitle,
  agenda,
}: {
  entry: AgendaEntry;
  courseTitle: Map<string, { title: string; percent?: number }>;
  agenda: Agenda;
}) {
  const { token } = theme.useToken();
  const state = entryState(entry);
  return (
    <div className={`smart-agenda-card ${entryTone(entry)}`} style={{ cursor: "default", transform: "none" }}>
      <span className={`smart-agenda-card__accent ${entryTone(entry)}`} />
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div
          style={{
            minWidth: 52,
            textAlign: "center",
            padding: "6px 4px",
            borderRadius: token.borderRadiusLG,
            background: entry.startAt ? token.colorPrimaryBg : token.colorFillAlter,
            color: entry.startAt ? token.colorPrimary : token.colorTextTertiary,
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>{entry.startAt ? dayjs(entry.startAt).format("ddd") : "TBC"}</div>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{entry.startAt ? dayjs(entry.startAt).format("DD") : "–"}</div>
          {entry.startAt && <div style={{ fontSize: 11 }}>{dayjs(entry.startAt).format("MMM")}</div>}
        </div>
        <Space direction="vertical" size={6} style={{ flex: 1, minWidth: 0 }}>
          <Space size={8} wrap>
            <span className="smart-agenda-card__title">{entry.title}</span>
            <Tag color={state.color}>{state.label}</Tag>
          </Space>
          <EntryDetails entry={entry} courseTitle={courseTitle} agenda={agenda} />
        </Space>
      </div>
    </div>
  );
}

function ListSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="smart-agenda-group">
      <div className="smart-agenda-group__divider">
        <span className="smart-agenda-group__time">
          {title.toUpperCase()} · {count}
        </span>
      </div>
      <div className="smart-agenda-group__items">{children}</div>
    </div>
  );
}

/** /training/agenda — the SME's training sessions on a calendar (as the shared Calendar page) or as a list. */
export default function SmeAgenda() {
  const agenda = useMyAgenda();
  const { enrollmentId, categories, role, training, error, entries, upcoming, agendaLoading, agendaError } = agenda;
  const learning = useLearnerCourses();
  const calendarRef = useRef<FullCalendar | null>(null);
  const isMobile = !Grid.useBreakpoint().md;
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [month, setMonth] = useState(() => dayjs().month());
  const [year, setYear] = useState(() => dayjs().year());
  const [openEntry, setOpenEntry] = useState<AgendaEntry | null>(null);
  const [showPast, setShowPast] = useState(false);

  // Open on the next session's month the first time the agenda loads.
  const firstUpcoming = upcoming[0]?.startAt;
  useEffect(() => {
    if (!firstUpcoming) return;
    const d = dayjs(firstUpcoming).startOf("day");
    setSelectedDate(d);
    setMonth(d.month());
    setYear(d.year());
    // Only on first load: later replies change `upcoming` but shouldn't move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!firstUpcoming]);

  useEffect(() => {
    calendarRef.current?.getApi()?.gotoDate(new Date(year, month, 1));
  }, [month, year, view]);

  const dated = useMemo(() => entries.filter((e) => e.startAt), [entries]);
  const events: EventInput[] = useMemo(
    () =>
      dated.map((e) => ({
        id: e.key,
        title: e.title,
        start: e.startAt!,
        end: e.endAt || undefined,
        extendedProps: { tone: entryTone(e) },
      })),
    [dated]
  );
  const showWeekends = dated.some((e) => [0, 6].includes(e.startAt!.getDay()));
  const yearOptions = useMemo(() => {
    const years = new Set<number>([dayjs().year(), ...dated.map((e) => e.startAt!.getFullYear())]);
    if (training) [training.durationStart, training.durationEnd].forEach((d) => years.add(dayjs(d).year()));
    return [...years].sort();
  }, [dated, training]);

  if (agendaLoading) return <Skeleton active style={{ padding: 24 }} />;
  if (error || !enrollmentId) return <Alert type="warning" showIcon style={{ margin: 24 }} message={error || "No training is linked to your account yet."} />;
  if (!training) return <Empty style={{ margin: 48 }} description="Your agenda will appear here once you're enrolled." />;

  const courseTitle = new Map(learning.courses.map((c) => [c.id, { title: c.title, percent: c.progress?.percent }]));
  const dayEntries = dated.filter((e) => dayjs(e.startAt).isSame(selectedDate, "day"));
  const dayGroups = dayEntries.reduce<{ hour: string; rows: AgendaEntry[] }[]>((groups, e) => {
    const hour = dayjs(e.startAt).format("HH:00");
    const group = groups.find((g) => g.hour === hour);
    if (group) group.rows.push(e);
    else groups.push({ hour, rows: [e] });
    return groups;
  }, []);
  // Replies the viewer can give: their own, and for a director also the company's people.
  const awaiting = upcoming.filter(
    (e) =>
      (e.invitationId && e.confirmation !== "confirmed" && e.confirmation !== "declined") ||
      e.people.some((p) => !p.isMe && p.confirmation === "pending")
  );
  const now = Date.now();
  const past = dated.filter((e) => e.status === "completed" || (e.endAt || e.startAt)!.getTime() < now).reverse();
  const undated = entries.filter((e) => !e.startAt);

  const moveDay = (step: number) => {
    let next = selectedDate.add(step, "day");
    if (!showWeekends) while ([0, 6].includes(next.day())) next = next.add(step, "day");
    setSelectedDate(next);
    setMonth(next.month());
    setYear(next.year());
  };
  const goToday = () => {
    const today = dayjs().startOf("day");
    setSelectedDate(today);
    setMonth(today.month());
    setYear(today.year());
  };
  const shiftMonth = (step: number) => {
    const next = dayjs(new Date(year, month, 1)).add(step, "month");
    setMonth(next.month());
    setYear(next.year());
  };

  return (
    <div className="smart-calendar-workspace">
      <div className="smart-calendar-page">
        <Row gutter={[16, 16]} align="middle" justify="space-between" className="smart-calendar-topbar">
          <Col xs={24} lg={12}>
            <div className="smart-calendar-title-wrap">
              <div className="smart-calendar-title-icon">
                <CalendarOutlined />
              </div>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  Agenda
                </Typography.Title>
                <Typography.Text type="secondary">
                  {training.name} · {dayjs(training.durationStart).format("DD MMM")} – {dayjs(training.durationEnd).format("DD MMM YYYY")}
                </Typography.Text>
              </div>
            </div>
          </Col>
          <Col xs={24} lg={12}>
            <div className="smart-calendar-actions">
              {!!awaiting.length && (
                <Tag color="gold" style={{ marginInlineEnd: 0, gridColumn: "1 / -1", justifySelf: "start" }}>
                  {awaiting.length} awaiting a reply
                </Tag>
              )}
              <Segmented
                // On phones the switch spans the row with both views sharing it equally.
                block={isMobile}
                value={view}
                onChange={(v) => setView(v as "calendar" | "list")}
                options={[
                  { value: "calendar", label: "Calendar", icon: <CalendarOutlined /> },
                  { value: "list", label: "List", icon: <UnorderedListOutlined /> },
                ]}
              />
            </div>
          </Col>
        </Row>

        {!!categories.length && (
          <Space size={[4, 4]} wrap style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary">{role === "employee" ? "Your categories:" : "Your focus areas:"}</Typography.Text>
            {categories.map((c) => (
              <Tag key={c} color="blue">
                {c}
              </Tag>
            ))}
          </Space>
        )}
        {agendaError && <Alert type="error" showIcon message={agendaError} style={{ marginBottom: 12 }} />}

        {view === "calendar" ? (
          <>
            <div className="smart-calendar-nav" style={{ marginBottom: 10 }}>
              <Select value={month} onChange={setMonth} options={MONTH_OPTIONS} popupMatchSelectWidth={false} variant="borderless" className="smart-calendar-month-select" />
              <Select
                value={year}
                onChange={setYear}
                options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
                popupMatchSelectWidth={false}
                variant="borderless"
                className="smart-calendar-year-select"
              />
              <div className="smart-calendar-month-arrows">
                <Button type="text" shape="circle" icon={<LeftOutlined />} onClick={() => shiftMonth(-1)} aria-label="Previous month" />
                <Button type="text" shape="circle" icon={<RightOutlined />} onClick={() => shiftMonth(1)} aria-label="Next month" />
              </div>
              <Space size={12} wrap style={{ marginLeft: 12 }}>
                {TONE_LEGEND.map((l) => (
                  <span key={l.tone} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span className={`smart-month-pill__dot ${l.tone}`} />
                    {l.label}
                  </span>
                ))}
              </Space>
            </div>
            <div className="smart-calendar-body">
              <div className="smart-calendar-shell">
                <FullCalendar
                  ref={calendarRef}
                  plugins={[dayGridPlugin, interactionPlugin]}
                  initialView="dayGridMonth"
                  initialDate={new Date(year, month, 1)}
                  headerToolbar={false}
                  events={events}
                  eventClick={(arg: EventClickArg) => {
                    const match = dated.find((e) => e.key === arg.event.id);
                    if (match) setOpenEntry(match);
                  }}
                  eventContent={(info: EventContentArg) => {
                    const tone = info.event.extendedProps.tone as string;
                    return (
                      <div className={`smart-month-pill ${tone}`}>
                        <span className={`smart-month-pill__dot ${tone}`} />
                        <span className="smart-month-pill__title">
                          {dayjs(info.event.start).format("HH:mm")} {info.event.title}
                        </span>
                      </div>
                    );
                  }}
                  dateClick={(arg: DateClickArg) => setSelectedDate(dayjs(arg.date).startOf("day"))}
                  dayCellClassNames={(arg: DayCellContentArg) => (dayjs(arg.date).isSame(selectedDate, "day") ? ["smart-calendar-selected-day"] : [])}
                  editable={false}
                  selectable={false}
                  height="auto"
                  dayMaxEventRows={3}
                  weekends={showWeekends}
                  firstDay={1}
                />
              </div>

              <div className="smart-calendar-day-panel">
                <div className="smart-calendar-day-panel__header">
                  <div className="smart-calendar-day-panel__headline">
                    <Typography.Text strong className="smart-calendar-day-panel__title">
                      Scheduled
                    </Typography.Text>
                    <div className="smart-calendar-day-panel__nav">
                      <Button type="text" shape="circle" icon={<CalendarOutlined />} onClick={goToday} aria-label="Jump to today" />
                      <Button type="text" shape="circle" icon={<LeftOutlined />} onClick={() => moveDay(-1)} aria-label="Previous day" />
                      <Button type="text" shape="circle" icon={<RightOutlined />} onClick={() => moveDay(1)} aria-label="Next day" />
                    </div>
                  </div>
                  <Typography.Text type="secondary">{selectedDate.format("dddd, D MMMM YYYY")}</Typography.Text>
                </div>
                <div className="smart-calendar-day-panel__list">
                  {!dayGroups.length ? (
                    <Empty description="No sessions on this day" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    dayGroups.map((group) => (
                      <div className="smart-agenda-group" key={group.hour}>
                        <div className="smart-agenda-group__divider">
                          <span className="smart-agenda-group__time">{group.hour}</span>
                        </div>
                        <div className="smart-agenda-group__items">
                          {group.rows.map((e) => {
                            const state = entryState(e);
                            const tone = entryTone(e);
                            return (
                              <button type="button" key={e.key} className={`smart-agenda-card ${tone}`} onClick={() => setOpenEntry(e)}>
                                <span className={`smart-agenda-card__accent ${tone}`} />
                                <span className="smart-agenda-card__title">{e.title}</span>
                                <span className="smart-agenda-card__subtitle">
                                  {DELIVERY_LABEL[e.deliveryMethod] || "Session"}
                                  {e.location ? ` · ${e.location}` : ""}
                                  {e.facilitatorName ? ` · ${e.facilitatorName}` : ""}
                                </span>
                                <span className="smart-agenda-card__meta">
                                  <ClockCircleOutlined /> {timeRange(e)}
                                  {duration(e) && <> · {duration(e)}</>}
                                </span>
                                <span>
                                  <Tag color={state.color} style={{ marginInlineEnd: 0 }}>
                                    {state.label}
                                  </Tag>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                  {!!undated.length && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {undated.length} session{undated.length === 1 ? "" : "s"} still to be dated — see the List view.
                    </Typography.Text>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : !entries.length ? (
          <div className="smart-calendar-empty-wrap">
            <Empty description="Your trainer hasn't planned any sessions yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <Space direction="vertical" size={20} style={{ width: "100%", maxWidth: 900 }}>
            {!!upcoming.length && (
              <ListSection title="Coming up" count={upcoming.length}>
                {upcoming.map((e) => (
                  <EntryCard key={e.key} entry={e} courseTitle={courseTitle} agenda={agenda} />
                ))}
              </ListSection>
            )}
            {!!undated.length && (
              <ListSection title="Date to be confirmed" count={undated.length}>
                {undated.map((e) => (
                  <EntryCard key={e.key} entry={e} courseTitle={courseTitle} agenda={agenda} />
                ))}
              </ListSection>
            )}
            {!!past.length && (
              <ListSection title="Past" count={past.length}>
                {(showPast ? past : past.slice(0, 3)).map((e) => (
                  <EntryCard key={e.key} entry={e} courseTitle={courseTitle} agenda={agenda} />
                ))}
                {past.length > 3 && (
                  <Button type="link" onClick={() => setShowPast((v) => !v)} style={{ alignSelf: "flex-start", padding: 0 }}>
                    {showPast ? "Show fewer" : `Show all ${past.length} past sessions`}
                  </Button>
                )}
              </ListSection>
            )}
          </Space>
        )}
      </div>

      <Modal
        open={!!openEntry}
        onCancel={() => setOpenEntry(null)}
        footer={<Button onClick={() => setOpenEntry(null)}>Close</Button>}
        title={
          openEntry && (
            <Space size={8} wrap>
              <span>{openEntry.title}</span>
              <Tag color={entryState(openEntry).color}>{entryState(openEntry).label}</Tag>
            </Space>
          )
        }
        width={640}
      >
        {openEntry && (
          <EntryDetails
            // The reply buttons read the live entry so a response updates in place.
            entry={entries.find((e) => e.key === openEntry.key) || openEntry}
            courseTitle={courseTitle}
            agenda={agenda}
          />
        )}
      </Modal>
    </div>
  );
}
