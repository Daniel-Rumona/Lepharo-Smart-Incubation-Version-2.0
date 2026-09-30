import { useEffect, useMemo, useState } from "react";
import { Button, Space, Typography } from "antd";
import {
    CalendarOutlined,
    CheckCircleFilled,
    CloseOutlined,
    CustomerServiceOutlined,
    FireFilled,
    LeftOutlined,
    MessageOutlined,
    PauseOutlined,
    PlayCircleFilled,
    RightOutlined,
    RocketFilled,
    SafetyCertificateFilled,
    StarFilled,
    ThunderboltFilled,
    TrophyFilled,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
    challengeInPeriod,
    meetingInPeriod,
} from "@/utils/featureGovernancePptx";
import {
    FeatureGovernanceRecord,
    GovernanceChallenge,
    GovernanceMeeting,
} from "@/types/featureGovernance";

const { Text } = Typography;

const SLIDE_MS = 7000;
const PURPLE = "#814DFF";
const BLUE = "#243FFF";
const PINK = "#FF1F85";
const GREEN = "#2BD9A0";

type Props = {
    dark?: boolean;
    open: boolean;
    onClose: () => void;
    records: FeatureGovernanceRecord[];
    meetings: GovernanceMeeting[];
    rangeLabel: string;
    startDate?: string;
    endDate?: string;
};

const normalizeChallenges = (
    value: GovernanceMeeting["challenges"]
): GovernanceChallenge[] =>
    Array.isArray(value)
        ? value.filter((item) => item?.text?.trim())
        : String(value || "")
            .split("\n")
            .map((text) => text.trim())
            .filter(Boolean)
            .map((text, index) => ({
                id: `legacy-${index}`,
                text,
                status: "open" as const,
            }));

const CountUp = ({ to, active }: { to: number; active: boolean }) => {
    const [value, setValue] = useState(0);
    useEffect(() => {
        if (!active) return setValue(0);
        const start = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            const t = Math.min((now - start) / 1400, 1);
            setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [to, active]);
    return <>{value}</>;
};

const css = `
@keyframes rp-rise { from { opacity:0; transform: translateY(34px) scale(.96);} to { opacity:1; transform:none; } }
@keyframes rp-pop { 0% { opacity:0; transform: scale(.4) rotate(-12deg);} 70% { transform: scale(1.12) rotate(3deg);} 100% { opacity:1; transform:none; } }
@keyframes rp-float { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-14px);} }
@keyframes rp-glow { 0%,100% { opacity:.35; transform: scale(1);} 50% { opacity:.6; transform: scale(1.15);} }
@keyframes rp-glow-light { 0%,100% { opacity:.1; transform: scale(1);} 50% { opacity:.2; transform: scale(1.15);} }
@keyframes rp-slide { from { opacity:0; transform: translateX(-40px);} to { opacity:1; transform:none; } }
@keyframes rp-bar { from { width:0; } }
@keyframes rp-ring { from { stroke-dashoffset: 340; } }
@keyframes rp-timer { from { transform: scaleX(0);} to { transform: scaleX(1);} }
.rp-rise { animation: rp-rise .7s cubic-bezier(.2,.8,.2,1) both; }
.rp-pop { animation: rp-pop .8s cubic-bezier(.2,.8,.2,1) both; }
.rp-float { animation: rp-float 3.4s ease-in-out infinite; }
.rp-slide { animation: rp-slide .6s cubic-bezier(.2,.8,.2,1) both; }
.rp-bar { animation: rp-bar 1.4s cubic-bezier(.2,.8,.2,1) both; }
.rp-root { position:fixed; inset:0; z-index:2000; color: var(--rp-fg); overflow:hidden;
  background: radial-gradient(1200px 700px at 15% 10%, var(--rp-bg1) 0%, transparent 60%),
              radial-gradient(1000px 700px at 90% 90%, var(--rp-bg2) 0%, transparent 55%), var(--rp-bg);
  font-family: inherit; }
.rp-orb { position:absolute; border-radius:50%; filter: blur(70px); animation: rp-glow 6s ease-in-out infinite; }
.rp-dark { --rp-fg:#fff; --rp-bg:#0b0a1a; --rp-bg1:#2a1a6b; --rp-bg2:#4a0f43; --rp-kicker:#b9b3ff; --rp-muted:#cfcaf5; --rp-card:rgba(255,255,255,.07); --rp-line:rgba(255,255,255,.14); --rp-track:rgba(255,255,255,.14); --rp-t1:#fff; --rp-t2:#c7b8ff; --rp-t3:#ff8cc4; --rp-shadow:none; }
.rp-light { --rp-fg:#1f1b3a; --rp-bg:#faf9ff; --rp-bg1:#ece8ff; --rp-bg2:#ffedf5; --rp-kicker:#6b4fe0; --rp-muted:#5b6070; --rp-card:#ffffff; --rp-line:rgba(107,79,224,.16); --rp-track:rgba(31,27,58,.09); --rp-t1:#2a2170; --rp-t2:#5a3fe0; --rp-t3:#c2358a; --rp-shadow:0 6px 20px rgba(60,40,140,.08); }
.rp-light .rp-orb { animation-name: rp-glow-light; }
.rp-stage { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:safe center; overflow-y:auto; padding: 72px 6vw 96px; text-align:center; }
.rp-kicker { letter-spacing:.28em; font-size:13px; text-transform:uppercase; color: var(--rp-kicker); font-weight:600; }
.rp-title { font-size: clamp(34px, 6vw, 72px); font-weight:800; line-height:1.2; padding-bottom:.12em; margin: 14px 0 0; background: linear-gradient(90deg, var(--rp-t1), var(--rp-t2) 60%, var(--rp-t3)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.rp-sub { font-size: clamp(16px, 2vw, 22px); color: var(--rp-muted); margin-top: 16px; max-width: 760px; }
.rp-card { background: var(--rp-card); border:1px solid var(--rp-line); box-shadow: var(--rp-shadow); border-radius:20px; backdrop-filter: blur(10px); }
.rp-grid { display:grid; gap:18px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); width:100%; max-width:980px; margin-top:34px; }
.rp-num { font-size: clamp(44px, 6vw, 68px); font-weight:800; line-height:1; }
.rp-ctrl { position:absolute; left:0; right:0; bottom:0; padding: 18px 24px 22px; display:flex; align-items:center; justify-content:center; gap:16px; flex-wrap:wrap; }
.rp-dot { width:34px; height:5px; border-radius:4px; background: var(--rp-track); overflow:hidden; cursor:pointer; border:0; padding:0; }
.rp-dot > i { display:block; height:100%; background: linear-gradient(90deg,#814DFF,#FF1F85); transform-origin:left; }
.rp-list { width:100%; max-width:none; margin-top:28px; display:flex; flex-direction:column; gap:12px; text-align:left; }
.rp-row { display:flex; align-items:center; gap:14px; padding:14px 18px; }
.rp-bartrack { height:10px; border-radius:6px; background: var(--rp-track); overflow:hidden; margin-top:8px; }
.rp-barfill { height:100%; border-radius:6px; background: linear-gradient(90deg,#814DFF,#FF1F85); }
`;

const ReportPlayer = ({
    dark = true,
    open,
    onClose,
    records,
    meetings,
    rangeLabel,
    startDate,
    endDate,
}: Props) => {
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);

    const data = useMemo(() => {
        const inRange = (value?: string | null) => {
            if (!startDate && !endDate) return true;
            if (!value) return false;
            const d = dayjs(value);
            if (!d.isValid()) return false;
            return (
                (!startDate || !d.isBefore(dayjs(startDate).startOf("day"))) &&
                (!endDate || !d.isAfter(dayjs(endDate).endOf("day")))
            );
        };
        // Mirrors the exported report: completed items are filtered by period,
        // while the pipeline lists every item still in delivery.
        const dateOf = (r: FeatureGovernanceRecord) => {
            if (r.status === "released" && r.completedAt) return r.completedAt;
            if (r.dueDate) return r.dueDate;
            const stamp = r.updatedAt?.toDate?.() || r.createdAt?.toDate?.();
            return stamp ? dayjs(stamp).format("YYYY-MM-DD") : undefined;
        };
        const completed = records
            .filter((r) => r.status === "released" && inRange(dateOf(r)))
            .sort((a, b) =>
                String(dateOf(b) || "").localeCompare(String(dateOf(a) || ""))
            );
        const pipeline = records
            .filter((r) => r.status !== "released")
            .sort((a, b) => (b.progress || 0) - (a.progress || 0));
        const awaiting = pipeline.filter((r) => r.status === "awaiting-meeting");
        const legacy = records.flatMap((r) =>
            (r.meetings || []).map((m) => ({ ...m } as any))
        );
        const everyMeeting = [...meetings, ...legacy];
        const allMeetings = everyMeeting.filter((m: any) =>
            meetingInPeriod(m, inRange)
        );
        const held = allMeetings.filter((m: any) => m.status === "held");
        const challenges = everyMeeting
            .flatMap((m: any) =>
                normalizeChallenges(m.challenges)
                    .filter((c) => challengeInPeriod(m, c, inRange))
                    .map((c) => ({ ...c, source: m.title as string }))
            )
            .sort((a, b) =>
                a.status === b.status ? 0 : a.status === "resolved" ? -1 : 1
            );
        const resolved = challenges.filter((c) => c.status === "resolved").length;
        const people = Object.entries(
            held.reduce((acc: Record<string, number>, m: any) => {
                if (m.withName) acc[m.withName] = (acc[m.withName] || 0) + 1;
                return acc;
            }, {})
        )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);
        const avgProgress = pipeline.length
            ? Math.round(
                pipeline.reduce((n, r) => n + (r.progress || 0), 0) / pipeline.length
            )
            : 0;
        return {
            completed,
            awaiting,
            pipeline,
            held: held.length,
            pendingMeetings: allMeetings.filter((m: any) => m.status === "pending")
                .length,
            challengeTotal: challenges.length,
            challenges,
            resolved,
            people,
            avgProgress,
        };
    }, [records, meetings, startDate, endDate]);

    const slides = useMemo(() => {
        const list: { key: string; render: () => JSX.Element }[] = [];
        list.push({
            key: "intro",
            render: () => (
                <>
                    <div
                        className="rp-pop rp-float"
                        style={{ fontSize: 76, color: PINK }}
                    >
                        <RocketFilled />
                    </div>
                    <div
                        className="rp-kicker rp-rise"
                        style={{ animationDelay: ".2s", marginTop: 18 }}
                    >
                        Feature governance · {rangeLabel}
                    </div>
                    <h1 className="rp-title rp-rise" style={{ animationDelay: ".35s" }}>
                        Let's see what we moved forward
                    </h1>
                    <div className="rp-sub rp-rise" style={{ animationDelay: ".6s" }}>
                        Every feature shipped, every conversation held, every blocker
                        cleared - in one story.
                    </div>
                </>
            ),
        });
        list.push({
            key: "numbers",
            render: () => (
                <>
                    <div className="rp-kicker rp-rise">The scoreboard</div>
                    <h2
                        className="rp-title rp-rise"
                        style={{
                            animationDelay: ".15s",
                            fontSize: "clamp(28px,4.5vw,52px)",
                        }}
                    >
                        Momentum you can measure
                    </h2>
                    <div className="rp-grid">
                        {[
                            {
                                icon: <TrophyFilled />,
                                label: "Features completed",
                                value: data.completed.length,
                                color: GREEN,
                            },
                            {
                                icon: <ThunderboltFilled />,
                                label: "In the pipeline",
                                value: data.pipeline.length,
                                color: PURPLE,
                            },
                            {
                                icon: <MessageOutlined />,
                                label: "Meetings held",
                                value: data.held,
                                color: BLUE,
                            },
                            {
                                icon: <SafetyCertificateFilled />,
                                label: "Challenges resolved",
                                value: data.resolved,
                                color: PINK,
                            },
                        ].map((stat, i) => (
                            <div
                                key={stat.label}
                                className="rp-card rp-rise"
                                style={{
                                    padding: "26px 18px",
                                    animationDelay: `${0.3 + i * 0.15}s`,
                                }}
                            >
                                <div style={{ fontSize: 30, color: stat.color }}>
                                    {stat.icon}
                                </div>
                                <div className="rp-num" style={{ marginTop: 10 }}>
                                    <CountUp to={stat.value} active />
                                </div>
                                <div style={{ color: "var(--rp-muted)", marginTop: 8 }}>
                                    {stat.label}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ),
        });
        list.push({
            key: "wins",
            render: () => (
                <>
                    <div className="rp-kicker rp-rise">Delivered</div>
                    <h2
                        className="rp-title rp-rise"
                        style={{
                            animationDelay: ".15s",
                            fontSize: "clamp(28px,4.5vw,52px)",
                        }}
                    >
                        {data.completed.length
                            ? `${data.completed.length} win${data.completed.length === 1 ? "" : "s"
                            } across the platform`
                            : "The next win is on its way"}
                    </h2>
                    <div className="rp-list">
                        {data.completed.slice(0, 5).map((r, i) => (
                            <div
                                key={r.id}
                                className="rp-card rp-row rp-slide"
                                style={{ animationDelay: `${0.35 + i * 0.18}s` }}
                            >
                                <CheckCircleFilled style={{ color: GREEN, fontSize: 26 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 18 }}>{r.title}</div>
                                    {r.description && (
                                        <div
                                            style={{
                                                color: "var(--rp-muted)",
                                                fontSize: 14,
                                                marginTop: 4,
                                                lineHeight: 1.45,
                                            }}
                                        >
                                            {r.description}
                                        </div>
                                    )}
                                </div>
                                <Text
                                    style={{ color: "var(--rp-kicker)", whiteSpace: "nowrap" }}
                                >
                                    <CalendarOutlined />{" "}
                                    {r.completedAt || r.dueDate
                                        ? dayjs(r.completedAt || r.dueDate).format("DD MMM")
                                        : "Done"}
                                </Text>
                            </div>
                        ))}
                        {data.completed.length > 5 && (
                            <div
                                className="rp-sub rp-rise"
                                style={{ animationDelay: "1.4s", textAlign: "center" }}
                            >
                                ...and {data.completed.length - 5} more
                            </div>
                        )}
                    </div>
                </>
            ),
        });
        list.push({
            key: "pipeline",
            render: () => (
                <>
                    <div className="rp-kicker rp-rise">In motion</div>
                    <h2
                        className="rp-title rp-rise"
                        style={{
                            animationDelay: ".15s",
                            fontSize: "clamp(28px,4.5vw,52px)",
                        }}
                    >
                        {data.pipeline.length
                            ? `${data.avgProgress}% average progress and climbing`
                            : "Pipeline clear - ready for what's next"}
                    </h2>
                    <div className="rp-list">
                        {data.pipeline.slice(0, 5).map((r, i) => (
                            <div
                                key={r.id}
                                className="rp-card rp-slide"
                                style={{
                                    padding: "14px 18px",
                                    animationDelay: `${0.35 + i * 0.15}s`,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 12,
                                    }}
                                >
                                    <span style={{ fontWeight: 700 }}>
                                        <FireFilled style={{ color: PINK }} /> {r.title}
                                    </span>
                                    <span style={{ color: "var(--rp-kicker)" }}>
                                        {r.status === "awaiting-meeting"
                                            ? "Awaiting meeting"
                                            : `${r.progress || 0}%`}
                                    </span>
                                </div>
                                {r.description && (
                                    <div
                                        style={{
                                            color: "var(--rp-muted)",
                                            fontSize: 14,
                                            marginTop: 4,
                                            lineHeight: 1.45,
                                        }}
                                    >
                                        {r.description}
                                    </div>
                                )}
                                <div className="rp-bartrack">
                                    <div
                                        className="rp-barfill rp-bar"
                                        style={{
                                            width: `${r.progress || 0}%`,
                                            animationDelay: `${0.5 + i * 0.15}s`,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ),
        });
        if (data.held || data.pendingMeetings)
            list.push({
                key: "people",
                render: () => (
                    <>
                        <div className="rp-kicker rp-rise">
                            {data.held ? "Listening" : "Up next"}
                        </div>
                        <h2
                            className="rp-title rp-rise"
                            style={{
                                animationDelay: ".15s",
                                fontSize: "clamp(28px,4.5vw,52px)",
                            }}
                        >
                            {data.held
                                ? `${data.held} conversation${data.held === 1 ? "" : "s"
                                } that shaped the roadmap`
                                : data.pendingMeetings
                                    ? `${data.pendingMeetings} conversation${data.pendingMeetings === 1 ? " is" : "s are"
                                    } scheduled`
                                    : ""}
                        </h2>
                        <div className="rp-grid">
                            {data.people.length
                                ? data.people.map(([name, count], i) => (
                                    <div
                                        key={name}
                                        className="rp-card rp-pop"
                                        style={{
                                            padding: 22,
                                            animationDelay: `${0.35 + i * 0.15}s`,
                                        }}
                                    >
                                        <StarFilled style={{ color: "#FFC857", fontSize: 26 }} />
                                        <div
                                            style={{ fontWeight: 700, fontSize: 18, marginTop: 10 }}
                                        >
                                            {name}
                                        </div>
                                        <div style={{ color: "var(--rp-muted)" }}>
                                            {count} meeting{count === 1 ? "" : "s"}
                                        </div>
                                    </div>
                                ))
                                : null}
                        </div>
                        {!data.held && (
                            <div className="rp-sub rp-rise" style={{ animationDelay: ".5s" }}>
                                System alignment engagements continue as the next phase of delivery
                                gets underway.
                            </div>
                        )}
                        {data.held > 0 && data.pendingMeetings > 0 && (
                            <div
                                className="rp-sub rp-rise"
                                style={{ animationDelay: "1.2s" }}
                            >
                                <CustomerServiceOutlined /> {data.pendingMeetings} more on the
                                calendar
                            </div>
                        )}
                    </>
                ),
            });
        if (data.challengeTotal)
            list.push({
                key: "challenges",
                render: () => {
                    const pct = data.challengeTotal
                        ? Math.round((data.resolved / data.challengeTotal) * 100)
                        : 100;
                    return (
                        <>
                            <div className="rp-kicker rp-rise">Clearing the path</div>
                            <div
                                style={{
                                    position: "relative",
                                    width: 190,
                                    height: 190,
                                    marginTop: 20,
                                }}
                                className="rp-pop"
                            >
                                <svg width="190" height="190" viewBox="0 0 120 120">
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r="54"
                                        fill="none"
                                        stroke="var(--rp-track)"
                                        strokeWidth="9"
                                    />
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r="54"
                                        fill="none"
                                        stroke={GREEN}
                                        strokeWidth="9"
                                        strokeLinecap="round"
                                        strokeDasharray="339.3"
                                        strokeDashoffset={339.3 * (1 - pct / 100)}
                                        transform="rotate(-90 60 60)"
                                        style={{
                                            animation: "rp-ring 1.6s cubic-bezier(.2,.8,.2,1) both",
                                        }}
                                    />
                                </svg>
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "grid",
                                        placeItems: "center",
                                    }}
                                    className="rp-num"
                                >
                                    <span style={{ fontSize: 44 }}>
                                        <CountUp to={pct} active />%
                                    </span>
                                </div>
                            </div>
                            <h2
                                className="rp-title rp-rise"
                                style={{
                                    animationDelay: ".4s",
                                    fontSize: "clamp(26px,4vw,46px)",
                                }}
                            >
                                {data.resolved} of {data.challengeTotal} challenges resolved
                            </h2>
                            <div className="rp-sub rp-rise" style={{ animationDelay: ".6s" }}>
                                Blockers named, owned and closed out.
                            </div>
                        </>
                    );
                },
            });
        for (let page = 0; page * 3 < data.challenges.length; page++) {
            const chunkItems = data.challenges.slice(page * 3, page * 3 + 3);
            list.push({
                key: `challenge-detail-${page}`,
                render: () => (
                    <>
                        <div className="rp-kicker rp-rise">
                            Challenges & resolutions
                            {data.challenges.length > 3
                                ? ` · ${page + 1}/${Math.ceil(data.challenges.length / 3)}`
                                : ""}
                        </div>
                        <div className="rp-list">
                            {chunkItems.map((c, i) => {
                                const done = c.status === "resolved";
                                return (
                                    <div
                                        key={c.id}
                                        className="rp-card rp-slide"
                                        style={{
                                            padding: "16px 20px",
                                            animationDelay: `${0.2 + i * 0.2}s`,
                                        }}
                                    >
                                        <div style={{ display: "flex", gap: 12 }}>
                                            {done ? (
                                                <CheckCircleFilled
                                                    style={{ color: GREEN, fontSize: 24, marginTop: 2 }}
                                                />
                                            ) : (
                                                <FireFilled
                                                    style={{
                                                        color: "#FFC857",
                                                        fontSize: 24,
                                                        marginTop: 2,
                                                    }}
                                                />
                                            )}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: 18 }}>
                                                    {c.text}
                                                </div>
                                                <div style={{ color: "var(--rp-muted)", fontSize: 13 }}>
                                                    {c.source} · {done ? "Resolved" : "In progress"}
                                                    {c.resolvedAt
                                                        ? ` · ${dayjs(c.resolvedAt).format("DD MMM YYYY")}`
                                                        : ""}
                                                </div>
                                                {done && c.resolution && (
                                                    <div
                                                        style={{
                                                            marginTop: 8,
                                                            padding: "10px 12px",
                                                            borderRadius: 10,
                                                            background: "var(--rp-track)",
                                                            fontSize: 15,
                                                            lineHeight: 1.45,
                                                        }}
                                                    >
                                                        <b>Resolution:</b> {c.resolution}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ),
            });
        }
        list.push({
            key: "outro",
            render: () => (
                <>
                    <div
                        className="rp-pop rp-float"
                        style={{ fontSize: 80, color: "#FFC857" }}
                    >
                        <TrophyFilled />
                    </div>
                    <h1 className="rp-title rp-rise" style={{ animationDelay: ".3s" }}>
                        {data.completed.length} delivered. {data.pipeline.length} on the
                        way.
                    </h1>
                    <div className="rp-sub rp-rise" style={{ animationDelay: ".55s" }}>
                        {data.awaiting.length
                            ? `${data.awaiting.length} finished feature${data.awaiting.length === 1 ? " is" : "s are"
                            } waiting on a conversation with the requestee.`
                            : "Great work - the platform keeps getting better."}
                    </div>
                </>
            ),
        });
        return list;
    }, [data, rangeLabel]);

    useEffect(() => {
        setIndex((i) => Math.min(i, slides.length - 1));
    }, [slides.length]);

    useEffect(() => {
        if (open) {
            setIndex(0);
            setPlaying(true);
        }
    }, [open]);

    useEffect(() => {
        if (!open || !playing) return;
        const timer = setTimeout(() => {
            if (index < slides.length - 1) setIndex(index + 1);
            else setPlaying(false);
        }, SLIDE_MS);
        return () => clearTimeout(timer);
    }, [open, playing, index, slides.length]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowRight")
                setIndex((i) => Math.min(i + 1, slides.length - 1));
            if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
            if (e.key === " ") {
                e.preventDefault();
                setPlaying((p) => !p);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose, slides.length]);

    if (!open) return null;
    const slide = slides[Math.min(index, slides.length - 1)];

    return (
        <div
            className={`rp-root ${dark ? "rp-dark" : "rp-light"}`}
            role="dialog"
            aria-label="Report playback"
        >
            <style>{css}</style>
            <div
                className="rp-orb"
                style={{
                    width: 420,
                    height: 420,
                    background: PURPLE,
                    top: -120,
                    left: -100,
                }}
            />
            <div
                className="rp-orb"
                style={{
                    width: 380,
                    height: 380,
                    background: PINK,
                    bottom: -140,
                    right: -80,
                    animationDelay: "2s",
                }}
            />
            <Button
                type="text"
                shape="circle"
                icon={<CloseOutlined />}
                onClick={onClose}
                style={{
                    position: "absolute",
                    top: 20,
                    right: 20,
                    color: "var(--rp-fg)",
                    zIndex: 2,
                }}
                aria-label="Close"
            />
            <div className="rp-stage" key={slide.key}>
                {slide.render()}
            </div>
            <div className="rp-ctrl">
                <Space size={6}>
                    <Button
                        type="text"
                        shape="circle"
                        icon={<LeftOutlined />}
                        disabled={index === 0}
                        onClick={() => setIndex(index - 1)}
                        style={{ color: "var(--rp-fg)" }}
                    />
                    <Button
                        type="text"
                        shape="circle"
                        icon={playing ? <PauseOutlined /> : <PlayCircleFilled />}
                        onClick={() => {
                            if (!playing && index === slides.length - 1) setIndex(0);
                            setPlaying(!playing);
                        }}
                        style={{ color: "var(--rp-fg)", fontSize: 20 }}
                    />
                    <Button
                        type="text"
                        shape="circle"
                        icon={<RightOutlined />}
                        disabled={index === slides.length - 1}
                        onClick={() => setIndex(index + 1)}
                        style={{ color: "var(--rp-fg)" }}
                    />
                </Space>
                <div style={{ display: "flex", gap: 8 }}>
                    {slides.map((s, i) => (
                        <button
                            key={s.key}
                            className="rp-dot"
                            onClick={() => setIndex(i)}
                            aria-label={`Slide ${i + 1}`}
                        >
                            <i
                                style={
                                    i < index
                                        ? undefined
                                        : i === index && playing
                                            ? { animation: `rp-timer ${SLIDE_MS}ms linear both` }
                                            : i === index
                                                ? undefined
                                                : { transform: "scaleX(0)" }
                                }
                            />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ReportPlayer;
