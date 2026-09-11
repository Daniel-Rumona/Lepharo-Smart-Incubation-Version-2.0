import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import dayjs, { type Dayjs } from "dayjs";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LeftOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  RightOutlined,
  RocketOutlined,
  TeamOutlined,
  TrophyOutlined,
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
const tokens = {
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
} as const;

const serifDisplay = "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";

const activityColour = (kind: string) =>
  kind === "appointment"
    ? tokens.plum
    : kind === "intervention"
    ? tokens.teal
    : tokens.coral;
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
    [chartMonths, props.scope]
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

const TrailPreview: React.FC = () => (
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

// Small, quiet, and tied to the active month only — these move every time you
// step or drag to a new chapter, they never summarise the whole range.
const StatPill: React.FC<{
  value: number;
  label: string;
  colour: string;
  soft: string;
  icon: React.ReactNode;
}> = ({ value, label, colour, soft, icon }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      background: soft,
      color: colour,
      borderRadius: 999,
      padding: "5px 12px 5px 8px",
      fontSize: 12,
      fontWeight: 600,
    }}
  >
    <span style={{ display: "flex", fontSize: 13 }}>{icon}</span>
    <span style={{ fontFamily: serifDisplay, fontSize: 15 }}>{value}</span>
    <span style={{ fontWeight: 500, opacity: 0.85 }}>{label}</span>
  </div>
);

const Traveler: React.FC<{
  walking: boolean;
  celebrating: boolean;
  facing: "left" | "right";
}> = ({ walking, celebrating, facing }) => {
  const reduceMotion = useReducedMotion();
  return (
    <svg
      width="30"
      height="34"
      viewBox="0 0 30 34"
      style={{
        overflow: "visible",
        transform: facing === "left" ? "scaleX(-1)" : undefined,
      }}
      aria-hidden="true"
    >
      <circle cx="9" cy="17" r="4" fill={tokens.amber} />
      <path d="M15 12 L20 24 L10 24 Z" fill={tokens.teal} />
      <circle
        cx="15"
        cy="7"
        r="6"
        fill={tokens.skin}
        stroke={tokens.ink}
        strokeWidth="1"
      />
      <motion.line
        x1="13"
        y1="24"
        x2="11"
        y2="32"
        stroke={tokens.ink}
        strokeWidth="2"
        strokeLinecap="round"
        animate={!reduceMotion && walking ? { x2: [11, 15, 11] } : { x2: 11 }}
        transition={{
          duration: 0.55,
          repeat: walking && !reduceMotion ? Infinity : 0,
          ease: "easeInOut",
        }}
      />
      <motion.line
        x1="17"
        y1="24"
        x2="19"
        y2="32"
        stroke={tokens.ink}
        strokeWidth="2"
        strokeLinecap="round"
        animate={!reduceMotion && walking ? { x2: [19, 15, 19] } : { x2: 19 }}
        transition={{
          duration: 0.55,
          repeat: walking && !reduceMotion ? Infinity : 0,
          ease: "easeInOut",
          delay: 0.27,
        }}
      />
      {celebrating ? (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <path
            d="M10 14 L3 6"
            stroke={tokens.ink}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M20 14 L27 6"
            stroke={tokens.ink}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </motion.g>
      ) : (
        <path
          d="M10 16 L5 22 M20 16 L25 22"
          stroke={tokens.ink}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
};

const ConfettiBurst: React.FC = () => {
  const pieces = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: index,
        angle: (index / 12) * Math.PI * 2,
        colour: [tokens.amber, tokens.teal, tokens.coral, tokens.plum][
          index % 4
        ],
      })),
    []
  );
  return (
    <div
      style={{ position: "absolute", left: 15, top: 4, width: 0, height: 0 }}
      aria-hidden="true"
    >
      {pieces.map((piece) => (
        <motion.span
          key={piece.id}
          initial={{ opacity: 1, x: 0, y: 0 }}
          animate={{
            opacity: 0,
            x: Math.cos(piece.angle) * 36,
            y: Math.sin(piece.angle) * 36 - 12,
          }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{
            position: "absolute",
            width: 5,
            height: 5,
            borderRadius: 1,
            background: piece.colour,
          }}
        />
      ))}
    </div>
  );
};

const TrailNav: React.FC<{
  months: JourneyMonth[];
  activeIndex: number;
  playing: boolean;
  onSelect: (index: number) => void;
}> = ({ months, activeIndex, playing, onSelect }) => {
  const reduceMotion = useReducedMotion();
  const trailRef = useRef<HTMLDivElement>(null);
  const prevIndexRef = useRef(activeIndex);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [celebrate, setCelebrate] = useState(false);

  const isLastChapter = activeIndex === months.length - 1 && months.length > 1;
  const pctFor = (index: number) =>
    months.length < 2 ? 0 : (index / (months.length - 1)) * 100;

  useEffect(() => {
    if (activeIndex !== prevIndexRef.current) {
      setFacing(activeIndex > prevIndexRef.current ? "right" : "left");
      prevIndexRef.current = activeIndex;
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!isLastChapter) return;
    setCelebrate(true);
    const timer = window.setTimeout(() => setCelebrate(false), 900);
    return () => window.clearTimeout(timer);
  }, [isLastChapter]);

  if (months.length < 2) return null;

  const handleDragEnd = (_: unknown, info: { point: { x: number } }) => {
    const rect = trailRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(
      1,
      Math.max(0, (info.point.x - rect.left) / rect.width)
    );
    onSelect(Math.round(ratio * (months.length - 1)));
  };

  return (
    <div
      ref={trailRef}
      style={{ position: "relative", margin: "30px 12px 30px", height: 2 }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 2,
          background: `repeating-linear-gradient(90deg, ${tokens.line} 0 6px, transparent 6px 11px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: 2,
          width: `${pctFor(activeIndex)}%`,
          background: tokens.teal,
          transition: reduceMotion ? undefined : "width .3s ease",
        }}
      />

      {months.map((month, index) => {
        const isActive = index === activeIndex;
        const isPast = index < activeIndex;
        return (
          <Tooltip title={month.label} key={month.key}>
            <button
              onClick={() => onSelect(index)}
              aria-label={`Go to ${month.label}`}
              aria-current={isActive}
              style={{
                position: "absolute",
                left: `${pctFor(index)}%`,
                top: 0,
                transform: "translate(-50%, -50%)",
                width: isActive ? 20 : 14,
                height: isActive ? 20 : 14,
                borderRadius: "50%",
                border: "none",
                cursor: "pointer",
                padding: 0,
                background: isActive
                  ? tokens.amber
                  : isPast
                  ? tokens.teal
                  : tokens.paperRaised,
                boxShadow: isActive
                  ? `0 0 0 4px ${tokens.amberSoft}`
                  : `0 0 0 2px ${tokens.line}`,
                transition: "all .25s ease",
              }}
            />
          </Tooltip>
        );
      })}

      {months.map((month, index) => (
        <Text
          key={month.key}
          type="secondary"
          style={{
            position: "absolute",
            left: `${pctFor(index)}%`,
            top: 16,
            transform: "translateX(-50%)",
            fontSize: 10,
            whiteSpace: "nowrap",
          }}
        >
          {dayjs(`${month.key}-01`).format("MMM")}
        </Text>
      ))}

      <motion.div
        role="slider"
        tabIndex={0}
        aria-label="Drag to scrub the journey"
        aria-valuemin={0}
        aria-valuemax={months.length - 1}
        aria-valuenow={activeIndex}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight")
            onSelect(Math.min(months.length - 1, activeIndex + 1));
          if (event.key === "ArrowLeft") onSelect(Math.max(0, activeIndex - 1));
        }}
        drag="x"
        dragConstraints={trailRef}
        dragElastic={0.12}
        dragMomentum={false}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
        animate={{ left: `${pctFor(activeIndex)}%` }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        style={{
          position: "absolute",
          top: 0,
          transform: "translate(-50%, calc(-100% - 6px))",
          cursor: "grab",
          touchAction: "none",
        }}
        whileDrag={{ cursor: "grabbing", scale: 1.08 }}
      >
        <motion.div
          animate={!reduceMotion && !playing ? { y: [0, -3, 0] } : { y: 0 }}
          transition={{
            duration: 1.6,
            repeat: !reduceMotion && !playing ? Infinity : 0,
            ease: "easeInOut",
          }}
        >
          <Traveler walking={playing} celebrating={celebrate} facing={facing} />
        </motion.div>
        {celebrate && !reduceMotion && <ConfettiBurst />}
      </motion.div>
    </div>
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
};

export const MilestoneJourney: React.FC<MilestoneJourneyProps> = ({
  scope,
  email,
  participantId,
  departmentId,
  departmentIds,
  programId,
  triggerOnly = false,
}) => {
  const { loading, months } = useJourneyMonths(
    scope,
    email,
    participantId,
    departmentId,
    departmentIds,
    programId
  );
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(5, "month").startOf("month"),
    dayjs().endOf("month"),
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
  const hasFeedbackSlide =
    scope === "operations" && (activeMonth?.feedback.length || 0) > 0;
  const atFinalChapter =
    visibleMonths.length > 0 &&
    activeIndex === visibleMonths.length - 1 &&
    (!hasFeedbackSlide || activeSlide === 1);

  const goNext = () => {
    if (hasFeedbackSlide && activeSlide === 0) {
      setActiveSlide(1);
      return;
    }
    setActiveSlide(0);
    setActiveIndex((current) =>
      Math.min(visibleMonths.length - 1, current + 1)
    );
  };

  const goPrevious = () => {
    if (activeSlide > 0) {
      setActiveSlide(0);
      return;
    }
    const previousIndex = activeIndex - 1;
    if (previousIndex < 0) return;
    const previousMonth = visibleMonths[previousIndex];
    setActiveIndex(previousIndex);
    setActiveSlide(
      scope === "operations" && previousMonth?.feedback.length ? 1 : 0
    );
  };

  useEffect(() => {
    setActiveIndex(0);
    setActiveSlide(0);
    setPlaying(false);
  }, [range, months.length]);
  useEffect(() => {
    if (!playing || !visibleMonths.length) return;
    if (atFinalChapter) {
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
    hasFeedbackSlide,
    atFinalChapter,
  ]);

  const title =
    scope === "sme" ? "My milestone journey" : "Department milestone journey";

  return (
    <>
      {triggerOnly ? (
        <Button
          type="primary"
          icon={<RocketOutlined />}
          onClick={() => setOpen(true)}
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
              onClick={() => setOpen(true)}
              style={{ background: tokens.teal, borderColor: tokens.teal }}
            >
              Open journey
            </Button>
          </div>
        </Card>
      )}

      {/* Modal's own title carries the accessible name — nothing this large repeats inside the body. */}
      <Modal
        open={open}
        onCancel={() => {
          setOpen(false);
          setPlaying(false);
          setIsFullscreen(false);
        }}
        footer={null}
        width={isFullscreen ? "100vw" : 980}
        title={title}
        style={
          isFullscreen
            ? { top: 0, maxWidth: "100vw", paddingBottom: 0 }
            : undefined
        }
        styles={{
          body: {
            padding: 0,
            height: isFullscreen ? "calc(100vh - 55px)" : undefined,
            overflowY: "auto",
          },
        }}
      >
        <div style={{ padding: 24, background: tokens.paper }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <Spin />
            </div>
          ) : !visibleMonths.length ? (
            <Alert
              type="info"
              showIcon
              message="No verified milestones for this period"
              description="Widen the date range below, or check back once activity has been recorded."
            />
          ) : (
            <Space direction="vertical" size={18} style={{ width: "100%" }}>
              {/* The trail leads — pick a range here and everything below follows it. */}
              <Card
                style={{ borderRadius: 14, border: `1px solid ${tokens.line}` }}
                bodyStyle={{ padding: "16px 20px 4px" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <Space size={8}>
                    <Tooltip
                      title={
                        isFullscreen ? "Exit fullscreen" : "View fullscreen"
                      }
                    >
                      <Button
                        aria-label={
                          isFullscreen ? "Exit fullscreen" : "View fullscreen"
                        }
                        icon={
                          isFullscreen ? (
                            <FullscreenExitOutlined />
                          ) : (
                            <FullscreenOutlined />
                          )
                        }
                        onClick={() => setIsFullscreen((current) => !current)}
                      />
                    </Tooltip>
                    <Button
                      aria-label="Previous scene"
                      icon={<LeftOutlined />}
                      disabled={activeIndex === 0 && activeSlide === 0}
                      onClick={goPrevious}
                    />
                    <Button
                      icon={
                        playing ? <PauseOutlined /> : <PlayCircleOutlined />
                      }
                      onClick={() => setPlaying((current) => !current)}
                      style={
                        playing
                          ? { color: tokens.coral, borderColor: tokens.coral }
                          : undefined
                      }
                    >
                      {playing ? "Pause" : "Play journey"}
                    </Button>
                    <Button
                      aria-label="Next scene"
                      icon={<RightOutlined />}
                      disabled={atFinalChapter}
                      onClick={goNext}
                    />
                    {atFinalChapter && (
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
                  <RangePicker
                    picker="month"
                    value={range}
                    allowClear={false}
                    onChange={(value) => {
                      if (value?.[0] && value?.[1])
                        setRange([value[0], value[1]]);
                    }}
                  />
                </div>
                <TrailNav
                  months={visibleMonths}
                  activeIndex={activeIndex}
                  playing={playing}
                  onSelect={(index) => {
                    setPlaying(false);
                    setActiveIndex(index);
                    setActiveSlide(0);
                  }}
                />
              </Card>

              {/* Everything below is scoped to the active month only — it changes every time the trail moves. */}
              <AnimatePresence mode="wait">
                {activeMonth && narrative && (
                  <motion.div
                    key={`${activeMonth.key}-${activeSlide}`}
                    initial={{ opacity: 0, x: reduceMotion ? 0 : 46 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: reduceMotion ? 0 : -46 }}
                    transition={{ duration: reduceMotion ? 0 : 0.34 }}
                  >
                    <Card
                      style={{
                        borderRadius: 14,
                        border: `1px solid ${tokens.line}`,
                      }}
                      bodyStyle={{ padding: 24 }}
                    >
                      <Space
                        direction="vertical"
                        size={16}
                        style={{ width: "100%" }}
                      >
                        {activeSlide === 0 && (
                          <>
                            <div>
                              <Text
                                style={{
                                  fontSize: 11,
                                  letterSpacing: 1,
                                  color: tokens.teal,
                                  fontWeight: 600,
                                }}
                              >
                                CHAPTER {activeIndex + 1} OF{" "}
                                {visibleMonths.length} · WHAT WAS ACCOMPLISHED
                              </Text>

                              {narrative.sentence ? (
                                <>
                                  <Title
                                    level={3}
                                    style={{
                                      margin: "4px 0 0",
                                      fontFamily: serifDisplay,
                                      color: tokens.ink,
                                      fontWeight: 400,
                                      lineHeight: 1.35,
                                    }}
                                  >
                                    {narrative.sentence}
                                  </Title>
                                  {narrative.trailing && (
                                    <Text type="secondary">
                                      {narrative.trailing}
                                    </Text>
                                  )}
                                </>
                              ) : (
                                <Title
                                  level={3}
                                  style={{
                                    margin: "4px 0 0",
                                    fontFamily: serifDisplay,
                                    color: tokens.ink,
                                    fontWeight: 400,
                                  }}
                                >
                                  {activeMonth.label} was quiet — no verified
                                  activity was recorded.
                                </Title>
                              )}
                            </div>

                            {narrative.sentence && (
                              <Space size={8} wrap>
                                {narrative.stats.completed > 0 && (
                                  <StatPill
                                    value={narrative.stats.completed}
                                    label="completed"
                                    colour={tokens.teal}
                                    soft={tokens.tealSoft}
                                    icon={<CheckCircleOutlined />}
                                  />
                                )}
                                {narrative.stats.attended > 0 && (
                                  <StatPill
                                    value={narrative.stats.attended}
                                    label={
                                      scope === "sme" ? "attended" : "held"
                                    }
                                    colour={tokens.plum}
                                    soft={tokens.plumSoft}
                                    icon={<CalendarOutlined />}
                                  />
                                )}
                                {narrative.stats.connections > 0 && (
                                  <StatPill
                                    value={narrative.stats.connections}
                                    label={
                                      scope === "operations"
                                        ? "SMEs"
                                        : "departments"
                                    }
                                    colour={tokens.amber}
                                    soft={tokens.amberSoft}
                                    icon={<TeamOutlined />}
                                  />
                                )}
                              </Space>
                            )}
                          </>
                        )}

                        {activeSlide === 1 &&
                          scope === "operations" &&
                          activeMonth.feedback.length > 0 && (
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

                        {activeSlide === 0 && displayActivities.length > 0 && (
                          <div style={{ position: "relative", paddingLeft: 4 }}>
                            <div
                              style={{
                                position: "absolute",
                                left: 8,
                                top: 6,
                                bottom: 6,
                                width: 2,
                                background: `repeating-linear-gradient(180deg, ${tokens.line} 0 4px, transparent 4px 8px)`,
                              }}
                            />
                            <Space
                              direction="vertical"
                              size={14}
                              style={{ width: "100%" }}
                            >
                              {displayActivities
                                .slice(0, 6)
                                .map((activity, index) => (
                                  <motion.div
                                    key={activity.id}
                                    initial={{
                                      opacity: 0,
                                      y: reduceMotion ? 0 : 10,
                                    }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{
                                      delay: reduceMotion ? 0 : index * 0.07,
                                    }}
                                    style={{
                                      display: "flex",
                                      gap: 12,
                                      alignItems: "start",
                                      position: "relative",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: "50%",
                                        marginTop: 5,
                                        background: activityColour(
                                          activity.kind
                                        ),
                                        boxShadow: `0 0 0 4px ${tokens.paperRaised}`,
                                        flex: "0 0 auto",
                                        zIndex: 1,
                                      }}
                                    />
                                    <div>
                                      <Text
                                        style={{
                                          fontSize: 11,
                                          letterSpacing: 0.5,
                                          color: activityColour(activity.kind),
                                          fontWeight: 700,
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        {activityVerb(activity.kind)}
                                      </Text>
                                      <div>
                                        <Text strong>{activity.title}</Text>
                                        {activity.department && (
                                          <Tag
                                            style={{
                                              marginLeft: 8,
                                              background: tokens.tealSoft,
                                              color: tokens.teal,
                                              border: "none",
                                            }}
                                          >
                                            {activity.department}
                                          </Tag>
                                        )}
                                      </div>
                                      {activity.detail && (
                                        <Text
                                          type="secondary"
                                          style={{ fontSize: 12 }}
                                        >
                                          {activity.detailLabel || "Covered"}:{" "}
                                          {activity.detail}
                                        </Text>
                                      )}
                                    </div>
                                  </motion.div>
                                ))}
                            </Space>
                          </div>
                        )}
                      </Space>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </Space>
          )}
        </div>
      </Modal>
    </>
  );
};

/** A reusable modal trigger for dashboards that should not render the journey card. */
export const MilestoneJourneyButton: React.FC<
  Omit<MilestoneJourneyProps, "triggerOnly">
> = (props) => <MilestoneJourney {...props} triggerOnly />;

export default MilestoneJourney;
