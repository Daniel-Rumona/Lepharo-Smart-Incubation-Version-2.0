import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Result,
  Grid,
  Pagination,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import dayjs, { type Dayjs } from "dayjs";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import FullscreenReveal from "@/components/shared/FullscreenReveal";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { useColorMode } from "@/contexts/ThemeContext";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  EnvironmentOutlined,
  LeftOutlined,
  PauseOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  RightOutlined,
  RocketOutlined,
  PhoneOutlined,
  TeamOutlined,
  TrophyOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  loadMilestoneJourney,
  type JourneyActivity,
  type JourneyMonth,
  type JourneyScope,
} from "@/services/milestoneJourneyService";

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

// ---------------------------------------------------------------------------
// Design tokens
// A "field journal" palette — ink + paper base, teal for verified growth,
// amber for milestones, coral/plum to tell activity kinds apart.
// ---------------------------------------------------------------------------
const lightTokens = {
  ink: "#15302C",
  paper: "#F4F7F5",
  paperRaised: "#FFFFFF",
  line: "#DCE6E1",
  teal: "#1F6F5E",
  tealSoft: "#DCEBE6",
  amber: "#B8862F",
  amberSoft: "#F3E6CB",
  coral: "#C4512F",
  coralSoft: "#F1DCD1",
  plum: "#5B4A82",
  plumSoft: "#E4DFEF",
  skin: "#F1D9AE",
};

type JourneyTokens = typeof lightTokens;

// Same roles on a dark surface: the accents are lifted so they keep their
// contrast, and the "soft" tints become deep, low-key washes.
const darkTokens: JourneyTokens = {
  ink: "#E6F0EC",
  paper: "#0F1A18",
  paperRaised: "#17251F",
  line: "#2C3F39",
  teal: "#3FB89C",
  tealSoft: "#1B3A33",
  amber: "#E0B25A",
  amberSoft: "#3A2F17",
  coral: "#E8805C",
  coralSoft: "#3B241B",
  plum: "#A793D6",
  plumSoft: "#2A2440",
  skin: "#F1D9AE",
};

const useJourneyTokens = (): JourneyTokens => {
  const { isDark } = useColorMode();
  return isDark ? darkTokens : lightTokens;
};

// "complete" is the closing step after the last chapter; it belongs to no month.
type SlideKey = "overview" | "done" | "appointments" | "smes" | "feedback" | "complete";

/** The pages a chapter is made of. A page only exists when the month has something for it. */
const monthSlides = (month: JourneyMonth | undefined, scope: JourneyScope): SlideKey[] => {
  const slides: SlideKey[] = ["overview"];
  if (!month) return slides;
  if (month.activities.some((activity) => activity.kind !== "appointment")) slides.push("done");
  if (month.activities.some((activity) => activity.kind === "appointment")) slides.push("appointments");
  if (scope === "operations" && month.participants.some((participant) => participant.name))
    slides.push("smes");
  if (scope === "operations" && month.feedback.length > 0) slides.push("feedback");
  return slides;
};

const serifDisplay = "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";

const activityColour = (kind: string, palette: JourneyTokens) =>
  kind === "appointment"
    ? palette.plum
    : kind === "intervention"
    ? palette.teal
    : palette.coral;
const activityVerb = (kind: string) =>
  kind === "appointment"
    ? "Attended"
    : kind === "intervention"
    ? "Completed"
    : "Confirmed";
const plural = (n: number) => (n === 1 ? "" : "s");
const joinClauses = (clauses: string[]) =>
  clauses.length === 1
    ? clauses[0]
    : clauses.length === 2
    ? clauses.join(" and ")
    : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;

// Builds the "In {month}, you..." sentence straight from the month's own
// numbers — nothing here is aggregated across the range, so it changes with
// whichever month is active rather than sitting fixed at the top of the page.
const buildNarrative = (month: JourneyMonth, scope: JourneyScope) => {
  const subject = scope === "sme" ? "you" : "the team";
  const clauses: string[] = [];

  if (month.completedInterventions > 0) {
    clauses.push(
      `completed ${month.completedInterventions} intervention${plural(
        month.completedInterventions
      )}`
    );
  }

  const attended =
    scope === "sme" ? month.attendedAppointments : month.appointments;
  if (attended > 0) {
    clauses.push(
      `${scope === "sme" ? "attended" : "held"} ${attended} ${
        scope === "sme" ? "session" : "appointment"
      }${plural(attended)}`
    );
  }

  const connections =
    scope === "operations"
      ? new Set(month.participantIds)
      : new Set(
          month.activities
            .map((activity) => activity.department)
            .filter(Boolean)
        );
  const connectionLabel = scope === "operations" ? "SME" : "department";
  if (connections.size > 0) {
    clauses.push(
      `connected with ${connections.size} ${connectionLabel}${plural(
        connections.size
      )}`
    );
  }

  if (!clauses.length)
    return {
      sentence: null as string | null,
      trailing: null as string | null,
      stats: { completed: 0, attended, connections: connections.size },
    };

  return {
    sentence: `In ${month.label}, ${subject} ${joinClauses(clauses)}.`,
    trailing: null,
    stats: {
      completed: month.completedInterventions,
      attended,
      connections: connections.size,
    },
  };
};

const useJourneyMonths = (
  scope: JourneyScope,
  email?: string | null,
  participantId?: string | null,
  departmentId?: string | null,
  departmentIds?: string[],
  programId?: string | null
) => {
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<JourneyMonth[]>([]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadMilestoneJourney({
      scope,
      email,
      participantId,
      departmentId,
      departmentIds,
      programId,
    })
      .then((data) => {
        if (!cancelled) setMonths(data);
      })
      .catch((error) => {
        console.error("Failed to load milestone journey:", error);
        if (!cancelled) setMonths([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, email, participantId, departmentId, departmentIds, programId]);
  return { loading, months };
};

export const MilestoneActivityChart: React.FC<{
  scope: JourneyScope;
  email?: string | null;
  participantId?: string | null;
  departmentId?: string | null;
  departmentIds?: string[];
  programId?: string | null;
  dateRange?: [Dayjs, Dayjs];
}> = (props) => {
  const tokens = useJourneyTokens();
  const { loading, months } = useJourneyMonths(
    props.scope,
    props.email,
    props.participantId,
    props.departmentId,
    props.departmentIds,
    props.programId
  );
  const chartMonths = useMemo(
    () =>
      props.dateRange
        ? months.filter((month) => {
            const date = dayjs(`${month.key}-01`);
            return (
              (date.isAfter(props.dateRange![0], "month") ||
                date.isSame(props.dateRange![0], "month")) &&
              (date.isBefore(props.dateRange![1], "month") ||
                date.isSame(props.dateRange![1], "month"))
            );
          })
        : months,
    [months, props.dateRange]
  );
  const chartOptions = useMemo(
    () => ({
      credits: { enabled: false },
      title: { text: "" },
      xAxis: {
        categories: chartMonths.map((month) => month.label),
        lineColor: tokens.line,
        tickColor: tokens.line,
      },
      yAxis: {
        min: 0,
        title: { text: "Activity" },
        allowDecimals: false,
        gridLineColor: tokens.line,
      },
      tooltip: { shared: true },
      plotOptions: { series: { animation: { duration: 550 } } },
      series: [
        {
          type: "column",
          name: "Interventions completed",
          data: chartMonths.map((month) => month.completedInterventions),
          color: tokens.teal,
        },
        {
          type: "spline",
          name:
            props.scope === "sme" ? "Sessions attended" : "Appointments held",
          data: chartMonths.map((month) =>
            props.scope === "sme"
              ? month.attendedAppointments
              : month.appointments
          ),
          color: tokens.plum,
        },
      ],
    }),
    [chartMonths, props.scope, tokens]
  );
  return (
    <Card
      title="Month-on-month activity"
      style={{ borderRadius: 14 }}
      bodyStyle={{ padding: 14 }}
    >
      {loading ? (
        <Spin />
      ) : chartMonths.length ? (
        <HighchartsReact highcharts={Highcharts} options={chartOptions} />
      ) : (
        <Empty description="No activity recorded yet" />
      )}
    </Card>
  );
};

const TrailPreview: React.FC = () => {
  const tokens = useJourneyTokens();
  return (
  <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true">
    <path
      d="M4 30 C 14 10, 24 34, 34 14 S 52 6, 52 6"
      stroke={tokens.line}
      strokeWidth="2"
      fill="none"
      strokeDasharray="1 6"
      strokeLinecap="round"
    />
    {[
      [4, 30],
      [19, 20],
      [34, 14],
      [52, 6],
    ].map(([cx, cy], index) => (
      <circle
        key={index}
        cx={cx}
        cy={cy}
        r={index === 3 ? 5 : 3.5}
        fill={index === 3 ? tokens.amber : tokens.teal}
        opacity={index === 3 ? 1 : 0.55}
      />
    ))}
  </svg>
  );
};

export type MilestoneJourneyProps = {
  scope: JourneyScope;
  email?: string | null;
  participantId?: string | null;
  departmentId?: string | null;
  departmentIds?: string[];
  programId?: string | null;
  triggerOnly?: boolean;
  /**
   * Opened from outside (the agent page): no trigger is shown and the caller
   * owns open/close. `inline` means the caller already animates the reveal.
   */
  controlled?: { open: boolean; onClose: () => void; inline?: boolean };
};

export const MilestoneJourney: React.FC<MilestoneJourneyProps> = ({
  scope,
  email,
  participantId,
  departmentId,
  departmentIds,
  programId,
  triggerOnly = false,
  controlled,
}) => {
  const { loading, months } = useJourneyMonths(
    scope,
    email,
    participantId,
    departmentId,
    departmentIds,
    programId
  );
  const tokens = useJourneyTokens();
  const screens = Grid.useBreakpoint();
  const reduceMotion = useReducedMotion();
  const [internalOpen, setInternalOpen] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const open = controlled ? controlled.open : internalOpen;
  const openFrom = (event: React.MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    setInternalOpen(true);
  };
  const closeJourney = () => {
    setPlaying(false);
    if (controlled) controlled.onClose();
    else setInternalOpen(false);
  };
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(5, "month").startOf("month"),
    dayjs().endOf("month"),
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [complete, setComplete] = useState(false);
  const visibleMonths = useMemo(
    () =>
      months.filter((month) => {
        const date = dayjs(`${month.key}-01`);
        return (
          (date.isAfter(range[0], "month") || date.isSame(range[0], "month")) &&
          (date.isBefore(range[1], "month") || date.isSame(range[1], "month"))
        );
      }),
    [months, range]
  );
  const activeMonth = visibleMonths[activeIndex];
  const narrative = useMemo(
    () => (activeMonth ? buildNarrative(activeMonth, scope) : null),
    [activeMonth, scope]
  );
  const displayActivities = useMemo<JourneyActivity[]>(() => {
    const activities = activeMonth?.activities || [];
    if (scope !== "operations") return activities;

    const interventionSummaries = new Map<
      string,
      { title: string; department?: string; participantIds: Set<string> }
    >();
    const otherActivities: typeof activities = [];

    activities.forEach((activity) => {
      if (activity.kind !== "intervention") {
        otherActivities.push(activity);
        return;
      }
      const current = interventionSummaries.get(activity.title) || {
        title: activity.title,
        department: activity.department,
        participantIds: new Set<string>(),
      };
      (activity.participantIds || []).forEach((id) =>
        current.participantIds.add(id)
      );
      interventionSummaries.set(activity.title, current);
    });

    return [
      ...Array.from(interventionSummaries.values()).map((summary) => ({
        id: `intervention-summary-${summary.title}`,
        kind: "intervention" as const,
        title: `${summary.title} helped ${
          summary.participantIds.size
        } SME${plural(summary.participantIds.size)}`,
        department: summary.department,
      })),
      ...otherActivities,
    ];
  }, [activeMonth, scope]);
  const doneItems = displayActivities.filter((activity) => activity.kind !== "appointment");
  const appointmentItems = displayActivities.filter((activity) => activity.kind === "appointment");
  const smeItems = useMemo(() => {
    const names = new Map<string, string>();
    (activeMonth?.participants || []).forEach((participant) => {
      if (participant.name) names.set(participant.id, participant.name);
    });
    return Array.from(names.entries()).map(([id, name]) => {
      const involved = (activeMonth?.activities || []).filter((activity) =>
        (activity.participantIds || []).includes(id)
      );
      const interventions = involved.filter((activity) => activity.kind === "intervention").length;
      const appointments = involved.filter((activity) => activity.kind === "appointment").length;
      return {
        id,
        title: name,
        detail: [
          interventions ? `${interventions} intervention${plural(interventions)}` : "",
          appointments ? `${appointments} appointment${plural(appointments)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });
  }, [activeMonth]);

  // How a page of cards is laid out depends on how many there are: up to 5
  // stack vertically, 6-8 sit two across, 9 or more go three across, and past
  // a 3 x 3 page they stay three across and are paged.
  const [cardPage, setCardPage] = useState(1);
  useEffect(() => {
    setCardPage(1);
  }, [activeIndex, activeSlide, range]);
  const renderCardGrid = (
    items: Array<{ id: string; title: string; detail?: string; colour: string; meta?: React.ReactNode }>
  ) => {
    const count = items.length;
    const columns = !screens.md ? 1 : count <= 5 ? 1 : count <= 8 ? 2 : 3;
    const pageSize = columns === 3 ? 9 : Math.max(count, 1);
    const visible = items.slice((cardPage - 1) * pageSize, cardPage * pageSize);
    return (
      <>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: 12,
          }}
        >
          {visible.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : index * 0.05 }}
              style={{
                minWidth: 0,
                padding: "14px 16px",
                border: `1px solid ${item.colour}66`,
                borderRadius: 12,
                background: tokens.paperRaised,
                textAlign: "left",
              }}
            >
              <Text strong style={{ color: tokens.ink }}>
                {item.title}
              </Text>
              {item.meta && <div style={{ marginTop: 8 }}>{item.meta}</div>}
              {item.detail && (
                <div style={{ marginTop: 6 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.detail}
                  </Text>
                </div>
              )}
            </motion.div>
          ))}
        </div>
        {count > pageSize && (
          <Pagination
            current={cardPage}
            pageSize={pageSize}
            total={count}
            showSizeChanger={false}
            onChange={setCardPage}
            style={{ display: "flex", justifyContent: "center" }}
          />
        )}
      </>
    );
  };

  const slides = useMemo(() => monthSlides(activeMonth, scope), [activeMonth, scope]);
  const slideKey: SlideKey = complete
    ? "complete"
    : slides[Math.min(activeSlide, slides.length - 1)] ?? "overview";
  const journeySummary = useMemo(() => {
    const smes = new Set<string>();
    const departments = new Set<string>();
    let completed = 0;
    let appointments = 0;
    visibleMonths.forEach((month) => {
      completed += month.completedInterventions;
      appointments += scope === "sme" ? month.attendedAppointments : month.appointments;
      month.participantIds.forEach((id) => smes.add(id));
      month.activities.forEach((activity) => {
        if (activity.department) departments.add(activity.department);
      });
    });
    return {
      completed,
      appointments,
      reach: scope === "operations" ? smes.size : departments.size,
      months: visibleMonths.length,
      from: visibleMonths[0]?.label,
      to: visibleMonths[visibleMonths.length - 1]?.label,
    };
  }, [visibleMonths, scope]);

  const atFinalChapter =
    visibleMonths.length > 0 &&
    activeIndex === visibleMonths.length - 1 &&
    activeSlide >= slides.length - 1;

  const goNext = () => {
    if (complete) return;
    if (atFinalChapter) {
      setComplete(true);
      return;
    }
    if (activeSlide < slides.length - 1) {
      setActiveSlide(activeSlide + 1);
      return;
    }
    setActiveSlide(0);
    setActiveIndex((current) =>
      Math.min(visibleMonths.length - 1, current + 1)
    );
  };

  const goPrevious = () => {
    if (complete) {
      setComplete(false);
      return;
    }
    if (activeSlide > 0) {
      setActiveSlide(activeSlide - 1);
      return;
    }
    const previousIndex = activeIndex - 1;
    if (previousIndex < 0) return;
    setActiveIndex(previousIndex);
    setActiveSlide(monthSlides(visibleMonths[previousIndex], scope).length - 1);
  };

  useEffect(() => {
    setActiveIndex(0);
    setActiveSlide(0);
    setComplete(false);
    setPlaying(false);
  }, [range, months.length]);

  const replay = () => {
    setComplete(false);
    setActiveIndex(0);
    setActiveSlide(0);
    setPlaying(true);
  };

  // The journey starts playing by itself as soon as it opens and has data.
  useEffect(() => {
    if (open && !loading && visibleMonths.length) replay();
    else if (!open) setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, visibleMonths.length]);

  useEffect(() => {
    if (!playing || !visibleMonths.length) return;
    // Reaching the closing step ends playback; Replay starts it again.
    if (complete) {
      setPlaying(false);
      return;
    }
    const timer = window.setInterval(goNext, 6000);
    return () => window.clearInterval(timer);
  }, [
    playing,
    visibleMonths.length,
    activeIndex,
    activeSlide,
    slides.length,
    atFinalChapter,
    complete,
  ]);

  const title =
    scope === "sme" ? "My milestone journey" : "Department milestone journey";

  const closeButton = (
    <Button
      danger
      shape="circle"
      className="mj-close"
      aria-label="Close journey"
      icon={<CloseOutlined />}
      onClick={closeJourney}
    />
  );

  // Shared by the controls bar and the empty state, so a period with nothing in
  // it can still be widened.
  const rangePicker = (
    <RangePicker
      picker="month"
      value={range}
      allowClear={false}
      // The journey is a full-screen layer above the app's popups, so the
      // month dropdown needs to sit higher than it or it opens out of sight.
      popupStyle={{ zIndex: 2100 }}
      onChange={(value) => {
        if (value?.[0] && value?.[1]) setRange([value[0], value[1]]);
      }}
    />
  );

  return (
    <>
      {controlled ? null : triggerOnly ? (
        <Button
          type="primary"
          icon={<RocketOutlined />}
          onClick={openFrom}
          style={{ background: tokens.teal, borderColor: tokens.teal }}
        >
          Open journey
        </Button>
      ) : (
        <Card
          style={{
            borderRadius: 14,
            border: `1px solid ${tokens.line}`,
            background: tokens.paperRaised,
            overflow: "hidden",
          }}
          bodyStyle={{ padding: 16, position: "relative" }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              background: tokens.amber,
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
              paddingLeft: 8,
            }}
          >
            <Space size={14}>
              <TrailPreview />
              <div>
                <Text strong style={{ fontSize: 15 }}>
                  {title}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Explore your verified progress as a story
                </Text>
              </div>
            </Space>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={openFrom}
              style={{ background: tokens.teal, borderColor: tokens.teal }}
            >
              Open journey
            </Button>
          </div>
        </Card>
      )}

      <FullscreenReveal
        open={open}
        onClose={closeJourney}
        ariaLabel={title}
        origin={origin}
        inline={controlled?.inline}
      >
        <div
          style={{
            padding: 24,
            background: tokens.paper,
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              maxWidth: 1280,
              width: "100%",
              margin: "0 auto",
              flex: "1 1 auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
          {loading ? (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{closeButton}</div>
              <div style={{ flex: "1 1 auto", display: "grid", placeItems: "center" }}>
                <Spin size="large" />
              </div>
            </>
          ) : !visibleMonths.length ? (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                {rangePicker}
                {closeButton}
              </div>
              <div style={{ flex: "1 1 auto", display: "grid", placeItems: "center" }}>
                <Result
                  status="info"
                  title="No verified milestones for this period"
                  subTitle="Try a wider date range, or check back once activity has been recorded."
                />
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
                width: "100%",
                flex: "1 1 auto",
              }}
            >
              {/* Pick a range and everything below follows it. */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <Space size={8} wrap>
                  {rangePicker}
                    <Space size={8}>
                      <Button
                        shape="circle"
                        aria-label="Previous scene"
                        icon={<LeftOutlined />}
                        disabled={activeIndex === 0 && activeSlide === 0 && !complete}
                        onClick={goPrevious}
                      />
                      <Button
                        icon={
                          complete ? (
                            <ReloadOutlined />
                          ) : playing ? (
                            <PauseOutlined />
                          ) : (
                            <PlayCircleOutlined />
                          )
                        }
                        shape="circle"
                        aria-label={complete ? "Replay journey" : playing ? "Pause journey" : "Play journey"}
                        title={complete ? "Replay" : playing ? "Pause" : "Play journey"}
                        onClick={() =>
                          complete ? replay() : setPlaying((current) => !current)
                        }
                        style={
                          playing && !complete
                            ? { color: tokens.coral, borderColor: tokens.coral }
                            : undefined
                        }
                      />
                      <Button
                        shape="circle"
                        aria-label="Next scene"
                        icon={<RightOutlined />}
                        disabled={complete}
                        onClick={goNext}
                      />
                      {complete && (
                        <Tag
                          icon={<TrophyOutlined />}
                          style={{
                            background: tokens.amberSoft,
                            color: tokens.amber,
                            border: "none",
                          }}
                        >
                          Journey complete
                        </Tag>
                      )}
                    </Space>
                </Space>
                {closeButton}
              </div>

              {/* Everything below is scoped to the active month only — it changes every time the trail moves. */}
              <AnimatePresence mode="wait">
                {activeMonth && narrative && (
                  <motion.div
                    key={complete ? "complete" : `${activeMonth.key}-${activeSlide}`}
                    initial={{ opacity: 0, x: reduceMotion ? 0 : 46 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: reduceMotion ? 0 : -46 }}
                    transition={{ duration: reduceMotion ? 0 : 0.34 }}
                    style={{
                      flex: "1 1 auto",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                    }}
                  >
                    {/* No card around any page: the content sits straight on the page, centred. */}
                    <Card
                      style={{
                        flex: "1 1 auto",
                        display: "flex",
                        flexDirection: "column",
                        border: "none",
                        background: "transparent",
                        boxShadow: "none",
                      }}
                      bodyStyle={{
                        padding: 0,
                        flex: "1 1 auto",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                      }}
                    >
                      <Space
                        direction="vertical"
                        size={16}
                        style={{
                          width: "100%",
                          maxWidth: 1100,
                          margin: "0 auto",
                          textAlign: "center",
                        }}
                      >
                        {slideKey === "complete" && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              textAlign: "center",
                              gap: 10,
                              padding: "24px 0",
                            }}
                          >
                            <div
                              style={{
                                width: 72,
                                height: 72,
                                borderRadius: "50%",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 32,
                                color: tokens.amber,
                                background: tokens.amberSoft,
                              }}
                            >
                              <TrophyOutlined />
                            </div>
                            <Text
                              style={{
                                fontSize: 11,
                                letterSpacing: 1,
                                color: tokens.teal,
                                fontWeight: 600,
                              }}
                            >
                              JOURNEY COMPLETE
                            </Text>
                            <Title
                              level={2}
                              style={{
                                margin: 0,
                                fontFamily: serifDisplay,
                                color: tokens.ink,
                                fontWeight: 400,
                                maxWidth: 820,
                                lineHeight: 1.3,
                              }}
                            >
                              {scope === "sme" ? "You" : "The team"} completed{" "}
                              {journeySummary.completed} intervention
                              {plural(journeySummary.completed)}, {scope === "sme" ? "attended" : "held"}{" "}
                              {journeySummary.appointments}{" "}
                              {scope === "sme" ? "session" : "appointment"}
                              {plural(journeySummary.appointments)} and reached{" "}
                              {journeySummary.reach}{" "}
                              {scope === "operations" ? "SME" : "department"}
                              {plural(journeySummary.reach)}.
                            </Title>
                            <Text type="secondary">
                              {journeySummary.months} month{plural(journeySummary.months)}
                              {journeySummary.from && journeySummary.to
                                ? ` · ${journeySummary.from}${
                                    journeySummary.from === journeySummary.to ? "" : ` – ${journeySummary.to}`
                                  }`
                                : ""}
                            </Text>
                            <Space size={12} style={{ marginTop: 18 }}>
                              <Button type="primary" icon={<ReloadOutlined />} onClick={replay}>
                                Replay
                              </Button>
                              {closeButton}
                            </Space>
                          </div>
                        )}

                        {slideKey === "overview" && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              textAlign: "center",
                              gap: 8,
                              padding: "24px 0 12px",
                            }}
                          >
                              <Text
                              style={{
                                fontSize: 11,
                                letterSpacing: 1,
                                color: tokens.teal,
                                fontWeight: 600,
                              }}
                            >
                              CHAPTER {activeIndex + 1} OF {visibleMonths.length} · THE MONTH IN NUMBERS
                            </Text>
                            <Title
                              level={3}
                              style={{
                                margin: "4px 0 0",
                                fontFamily: serifDisplay,
                                color: tokens.ink,
                                fontWeight: 400,
                                lineHeight: 1.35,
                                maxWidth: 820,
                              }}
                            >
                              {narrative.sentence ||
                                `${activeMonth.label} was quiet — no verified activity was recorded.`}
                            </Title>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                                gap: 18,
                                width: "100%",
                                maxWidth: 980,
                                marginTop: 28,
                              }}
                            >
                              {[
                                {
                                  key: "completed",
                                  icon: <CheckCircleOutlined />,
                                  value: narrative.stats.completed,
                                  label: "Interventions completed",
                                  colour: tokens.teal,
                                  soft: tokens.tealSoft,
                                },
                                {
                                  key: "appointments",
                                  icon: <CalendarOutlined />,
                                  value: narrative.stats.attended,
                                  label: scope === "sme" ? "Sessions attended" : "Appointments held",
                                  colour: tokens.plum,
                                  soft: tokens.plumSoft,
                                },
                                {
                                  key: "reach",
                                  icon: <TeamOutlined />,
                                  value: narrative.stats.connections,
                                  label: scope === "operations" ? "SMEs reached" : "Departments reached",
                                  colour: tokens.amber,
                                  soft: tokens.amberSoft,
                                },
                              ].map((metric, index) => (
                                <motion.div
                                  key={metric.key}
                                  initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: reduceMotion ? 0 : index * 0.1 }}
                                  style={{
                                    padding: "28px 20px",
                                    borderRadius: 20,
                                    border: `1px solid ${tokens.line}`,
                                    background: tokens.paperRaised,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 44,
                                      height: 44,
                                      margin: "0 auto",
                                      borderRadius: "50%",
                                      display: "grid",
                                      placeItems: "center",
                                      fontSize: 20,
                                      color: metric.colour,
                                      background: metric.soft,
                                    }}
                                  >
                                    {metric.icon}
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 14,
                                      fontSize: "clamp(44px, 6vw, 68px)",
                                      fontWeight: 800,
                                      lineHeight: 1,
                                      color: tokens.ink,
                                    }}
                                  >
                                    {metric.value}
                                  </div>
                                  <Text type="secondary" style={{ display: "block", marginTop: 10 }}>
                                    {metric.label}
                                  </Text>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                        )}

                        {slideKey === "done" && (
                          <>
                              <Text
                                style={{
                                  fontSize: 11,
                                  letterSpacing: 1,
                                  color: tokens.teal,
                                  fontWeight: 600,
                                }}
                              >
                                CHAPTER {activeIndex + 1} OF {visibleMonths.length} · WHAT WAS DONE
                              </Text>
                            {renderCardGrid(
                              doneItems.map((activity) => ({
                                id: activity.id,
                                title: activity.title,
                                detail: activity.detail
                                  ? `${activity.detailLabel || "Covered"}: ${activity.detail}`
                                  : undefined,
                                colour: activityColour(activity.kind, tokens),
                              }))
                            )}
                          </>
                        )}

                        {slideKey === "appointments" && (
                          <>
                              <Text
                                style={{
                                  fontSize: 11,
                                  letterSpacing: 1,
                                  color: tokens.teal,
                                  fontWeight: 600,
                                }}
                              >
                                CHAPTER {activeIndex + 1} OF {visibleMonths.length} · APPOINTMENTS
                              </Text>
                            {renderCardGrid(
                              appointmentItems.map((activity) => {
                                const invited = activity.invited ?? 0;
                                const attended = activity.attended ?? 0;
                                const rate = invited ? Math.round((attended / invited) * 100) : null;
                                const chip = {
                                  margin: 0,
                                  border: "none",
                                  borderRadius: 999,
                                  background: tokens.plumSoft,
                                  color: tokens.plum,
                                };
                                const mode = (activity.delivery || "").toLowerCase();
                                return {
                                  id: activity.id,
                                  title: activity.title,
                                  detail: activity.detail
                                    ? `${activity.detailLabel || "Covered"}: ${activity.detail}`
                                    : undefined,
                                  colour: tokens.plum,
                                  meta: (
                                    <Space size={6} wrap>
                                      {activity.delivery && (
                                        <Tag
                                          style={chip}
                                          icon={
                                            mode.includes("person") ? (
                                              <EnvironmentOutlined />
                                            ) : mode.includes("tele") ? (
                                              <PhoneOutlined />
                                            ) : (
                                              <VideoCameraOutlined />
                                            )
                                          }
                                        >
                                          {activity.delivery}
                                        </Tag>
                                      )}
                                      {invited > 0 && (
                                        <Tag style={chip} icon={<TeamOutlined />}>
                                          {invited} invited
                                        </Tag>
                                      )}
                                      {rate !== null && (
                                        <Tag
                                          style={{
                                            ...chip,
                                            background: rate >= 70 ? tokens.tealSoft : rate >= 40 ? tokens.amberSoft : tokens.coralSoft,
                                            color: rate >= 70 ? tokens.teal : rate >= 40 ? tokens.amber : tokens.coral,
                                          }}
                                          icon={<CheckCircleOutlined />}
                                        >
                                          {attended} attended · {rate}%
                                        </Tag>
                                      )}
                                    </Space>
                                  ),
                                };
                              })
                            )}
                          </>
                        )}

                        {slideKey === "smes" && (
                          <>
                              <Text
                                style={{
                                  fontSize: 11,
                                  letterSpacing: 1,
                                  color: tokens.teal,
                                  fontWeight: 600,
                                }}
                              >
                                CHAPTER {activeIndex + 1} OF {visibleMonths.length} · SMEs HELPED
                              </Text>
                            {renderCardGrid(
                              smeItems.map((sme) => ({ ...sme, colour: tokens.amber }))
                            )}
                          </>
                        )}

                        {slideKey === "feedback" && (
                            <div>
                              <Text
                                strong
                                style={{
                                  color: tokens.ink,
                                  fontFamily: serifDisplay,
                                  fontSize: 17,
                                }}
                              >
                                CHAPTER {activeIndex + 1} OF{" "}
                                {visibleMonths.length} · WHAT SMEs said about us
                              </Text>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns:
                                    "repeat(3, minmax(0, 1fr))",
                                  gap: 10,
                                  marginTop: 10,
                                }}
                              >
                                {activeMonth.feedback
                                  .slice(0, 9)
                                  .map((feedback, index) => (
                                    <motion.div
                                      key={feedback.id}
                                      initial={{
                                        opacity: 0,
                                        x: reduceMotion
                                          ? 0
                                          : [-24, 0, 24][index % 3],
                                        y: reduceMotion ? 0 : 16,
                                      }}
                                      animate={{ opacity: 1, x: 0, y: 0 }}
                                      transition={{
                                        delay: reduceMotion ? 0 : index * 0.11,
                                        duration: 0.32,
                                      }}
                                      style={{
                                        minWidth: 0,
                                        padding: 12,
                                        textAlign: "left",
                                        border: `1px solid ${tokens.line}`,
                                        borderRadius: 12,
                                        background: tokens.paperRaised,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          display: "block",
                                          color: tokens.ink,
                                          fontSize: 13,
                                          lineHeight: 1.45,
                                        }}
                                      >
                                        “{feedback.message}”
                                      </Text>
                                      <Text
                                        type="secondary"
                                        style={{
                                          display: "block",
                                          marginTop: 8,
                                          fontSize: 11,
                                        }}
                                      >
                                        {feedback.smeName || "SME feedback"}
                                        {typeof feedback.rating ===
                                          "number" && (
                                          <span
                                            aria-label={`Rated ${feedback.rating} out of 5`}
                                            style={{
                                              display: "inline-flex",
                                              gap: 1,
                                              marginLeft: 7,
                                              color: tokens.amber,
                                            }}
                                          >
                                            {Array.from(
                                              { length: 5 },
                                              (_, star) => (
                                                <span key={star}>
                                                  {star <
                                                  Math.round(
                                                    Math.max(
                                                      0,
                                                      Math.min(
                                                        5,
                                                        feedback.rating ?? 0
                                                      )
                                                    )
                                                  )
                                                    ? "★"
                                                    : "☆"}
                                                </span>
                                              )
                                            )}
                                          </span>
                                        )}
                                      </Text>
                                    </motion.div>
                                  ))}
                              </div>
                            </div>
                          )}

                      </Space>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          </div>
        </div>
      </FullscreenReveal>
    </>
  );
};

/** A reusable modal trigger for dashboards that should not render the journey card. */
export const MilestoneJourneyButton: React.FC<
  Omit<MilestoneJourneyProps, "triggerOnly">
> = (props) => <MilestoneJourney {...props} triggerOnly />;

export default MilestoneJourney;
