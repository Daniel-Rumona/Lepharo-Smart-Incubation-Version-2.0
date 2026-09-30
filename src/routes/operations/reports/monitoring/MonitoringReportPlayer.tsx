import { useEffect, useMemo, useState } from "react";
import { Button, Space, Typography } from "antd";
import {
    AppstoreFilled,
    CloseOutlined,
    FireFilled,
    LeftOutlined,
    PauseOutlined,
    PlayCircleFilled,
    RightOutlined,
    RocketFilled,
    SafetyCertificateFilled,
    StarFilled,
    TrophyFilled,
} from "@ant-design/icons";
import type { MonthlyReportData } from "@/utils/monthlyReportDocx";

// Same "story mode" shell as the feature-governance report player
// (src/routes/admin/features/ReportPlayer.tsx), retold for M&E programme data.

const { Text } = Typography;

const SLIDE_MS = 7000;
const PURPLE = "#814DFF";
const PINK = "#FF1F85";
const GREEN = "#2BD9A0";
const BLUE = "#243FFF";
const TAG_COLORS = [PURPLE, BLUE, GREEN, PINK, "#FFA940", "#13C2C2"];

type Props = {
    dark?: boolean;
    open: boolean;
    onClose: () => void;
    data: MonthlyReportData | null;
    rangeLabel: string;
};

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

const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const css = `
@keyframes rp-rise { from { opacity:0; transform: translateY(34px) scale(.96);} to { opacity:1; transform:none; } }
@keyframes rp-pop { 0% { opacity:0; transform: scale(.4) rotate(-12deg);} 70% { transform: scale(1.12) rotate(3deg);} 100% { opacity:1; transform:none; } }
@keyframes rp-float { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-14px);} }
@keyframes rp-glow { 0%,100% { opacity:.35; transform: scale(1);} 50% { opacity:.6; transform: scale(1.15);} }
@keyframes rp-glow-light { 0%,100% { opacity:.1; transform: scale(1);} 50% { opacity:.2; transform: scale(1.15);} }
@keyframes rp-bar { from { width:0; } }
@keyframes rp-timer { from { transform: scaleX(0);} to { transform: scaleX(1);} }
.rp-rise { animation: rp-rise .7s cubic-bezier(.2,.8,.2,1) both; }
.rp-pop { animation: rp-pop .8s cubic-bezier(.2,.8,.2,1) both; }
.rp-float { animation: rp-float 3.4s ease-in-out infinite; }
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
.rp-title { font-size: clamp(30px, 5.2vw, 60px); font-weight:800; line-height:1.2; padding-bottom:.12em; margin: 14px 0 0; background: linear-gradient(90deg, var(--rp-t1), var(--rp-t2) 60%, var(--rp-t3)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.rp-sub { font-size: clamp(16px, 2vw, 22px); color: var(--rp-muted); margin-top: 16px; max-width: 760px; }
.rp-card { background: var(--rp-card); border:1px solid var(--rp-line); box-shadow: var(--rp-shadow); border-radius:20px; backdrop-filter: blur(10px); }
.rp-grid { display:grid; gap:18px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); width:100%; max-width:980px; margin-top:34px; }
.rp-num { font-size: clamp(40px, 5.6vw, 64px); font-weight:800; line-height:1; }
.rp-ctrl { position:absolute; left:0; right:0; bottom:0; padding: 18px 24px 22px; display:flex; align-items:center; justify-content:center; gap:16px; flex-wrap:wrap; }
.rp-dot { width:34px; height:5px; border-radius:4px; background: var(--rp-track); overflow:hidden; cursor:pointer; border:0; padding:0; }
.rp-dot > i { display:block; height:100%; background: linear-gradient(90deg,#814DFF,#FF1F85); transform-origin:left; }
.rp-list { width:100%; max-width:720px; margin-top:28px; display:flex; flex-direction:column; gap:12px; text-align:left; }
.rp-row { display:flex; align-items:center; gap:14px; padding:14px 18px; }
.rp-bartrack { height:10px; border-radius:6px; background: var(--rp-track); overflow:hidden; margin-top:8px; }
.rp-barfill { height:100%; border-radius:6px; background: linear-gradient(90deg,#814DFF,#FF1F85); }
.rp-tags { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; max-width:820px; margin-top:30px; }
.rp-tag { display:inline-flex; align-items:baseline; gap:8px; padding:10px 18px; border-radius:999px; border:1px solid var(--rp-line); background: var(--rp-card); backdrop-filter: blur(10px); }
`;

const MonitoringReportPlayer = ({ dark = true, open, onClose, data, rangeLabel }: Props) => {
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);

    const slides = useMemo(() => {
        if (!data) return [] as { key: string; render: () => JSX.Element }[];
        const list: { key: string; render: () => JSX.Element }[] = [];
        const departmentName = data.meta?.departmentName || "Programme";
        const periodLabel = data.meta?.periodLabel || rangeLabel;

        list.push({
            key: "intro",
            render: () => (
                <>
                    <div className="rp-pop rp-float" style={{ fontSize: 72, color: PINK }}>
                        <RocketFilled />
                    </div>
                    <div className="rp-kicker rp-rise" style={{ animationDelay: ".2s", marginTop: 18 }}>
                        {departmentName} · {periodLabel}
                    </div>
                    <h1 className="rp-title rp-rise" style={{ animationDelay: ".35s" }}>
                        Here&apos;s what moved this period
                    </h1>
                    {data.meta?.scopeLabel && (
                        <div className="rp-sub rp-rise" style={{ animationDelay: ".6s" }}>
                            {data.meta.scopeLabel}
                        </div>
                    )}
                </>
            ),
        });

        // Only present when the report spans every program at once, so a single-program
        // report never shows an unnecessary "one programme" slide.
        const programs = data.programsBreakdown || [];
        if (programs.length > 1) {
            list.push({
                key: "programmes",
                render: () => (
                    <>
                        <div className="rp-pop" style={{ fontSize: 60, color: PURPLE }}>
                            <AppstoreFilled />
                        </div>
                        <div className="rp-kicker rp-rise" style={{ marginTop: 14 }}>Across the board</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s" }}>
                            <CountUp to={programs.length} active={open} /> programmes in this story
                        </h2>
                        <div className="rp-tags">
                            {programs.map((program, i) => {
                                const color = TAG_COLORS[i % TAG_COLORS.length];
                                return (
                                    <div
                                        key={program.programId}
                                        className="rp-tag rp-rise"
                                        style={{ animationDelay: `${0.2 + i * 0.08}s`, borderColor: color }}
                                    >
                                        <span
                                            style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: "50%",
                                                background: color,
                                                flex: "0 0 auto",
                                            }}
                                        />
                                        <Text strong style={{ color: "var(--rp-fg)" }}>{program.programName}</Text>
                                        <Text style={{ color: "var(--rp-muted)" }}>{program.count}</Text>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ),
            });
        }

        if (data.executiveSummary?.trim()) {
            list.push({
                key: "summary",
                render: () => (
                    <>
                        <div className="rp-kicker rp-rise">In summary</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s", fontSize: "clamp(24px,3.6vw,40px)" }}>
                            The headline
                        </h2>
                        <div className="rp-sub rp-rise" style={{ animationDelay: ".3s", maxWidth: 820 }}>
                            {data.executiveSummary}
                        </div>
                    </>
                ),
            });
        }

        // interventionsThisMonth carries one row per assigned intervention, but rows are
        // grouped by SME for the exported table's merged-cell look: only the first row of
        // each SME's group keeps its name (see buildMonthlyInterventionTrackerRows.ts), so
        // counting the non-blank names gives a true unique-SME count rather than an
        // intervention count.
        const totalInterventionRows = data.interventionsThisMonth?.length || 0;
        const uniqueSmesReached = (data.interventionsThisMonth || [])
            .filter(row => row.smmeName?.trim()).length;
        const avgInterventionsPerSme = uniqueSmesReached > 0
            ? Math.round((totalInterventionRows / uniqueSmesReached) * 10) / 10
            : 0;

        if (uniqueSmesReached > 0) {
            list.push({
                key: "beneficiaries",
                render: () => (
                    <>
                        <div className="rp-kicker rp-rise">The scoreboard</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s", fontSize: "clamp(28px,4.5vw,52px)" }}>
                            SMEs reached this period
                        </h2>
                        <div className="rp-grid" style={{ maxWidth: 640 }}>
                            <div
                                className="rp-card rp-rise"
                                style={{ padding: "26px 20px", animationDelay: ".2s" }}
                            >
                                <div className="rp-num" style={{ color: BLUE }}>
                                    <CountUp to={uniqueSmesReached} active={open} />
                                </div>
                                <div style={{ marginTop: 6, color: "var(--rp-muted)", fontWeight: 600 }}>
                                    Unique SMEs reached
                                </div>
                            </div>
                            <div
                                className="rp-card rp-rise"
                                style={{ padding: "26px 20px", animationDelay: ".32s" }}
                            >
                                <div className="rp-num" style={{ color: PINK }}>
                                    {avgInterventionsPerSme}
                                </div>
                                <div style={{ marginTop: 6, color: "var(--rp-muted)", fontWeight: 600 }}>
                                    Avg. interventions per SME
                                </div>
                            </div>
                        </div>
                    </>
                ),
            });
        }

        const kpis = (data.kpis || []).filter(k => k.kpi);
        if (kpis.length) {
            list.push({
                key: "kpis",
                render: () => (
                    <>
                        <div className="rp-kicker rp-rise">KPI progress</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s", fontSize: "clamp(26px,4vw,44px)" }}>
                            How we&apos;re tracking
                        </h2>
                        <div className="rp-list">
                            {kpis.slice(0, 5).map((kpi, i) => {
                                const achieved = num(kpi.achieved)
                                const target = num(kpi.monthlyTarget) || num(kpi.annualTarget)
                                const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : achieved > 0 ? 100 : 0
                                return (
                                    <div key={i} className="rp-card rp-row rp-rise" style={{ animationDelay: `${0.15 + i * 0.08}s`, flexDirection: "column", alignItems: "stretch" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
                                            <Text strong style={{ color: "var(--rp-fg)" }}>{kpi.kpi}</Text>
                                            <Text style={{ color: "var(--rp-muted)", whiteSpace: "nowrap" }}>
                                                {kpi.achieved ?? 0}{target ? ` / ${target}` : ""}
                                            </Text>
                                        </div>
                                        <div className="rp-bartrack">
                                            <div className="rp-barfill rp-bar" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </>
                ),
            });
        }

        const interventionCount = data.interventionsThisMonth?.length || 0;
        const byDept = data.interventionsByDepartment || [];
        if (interventionCount > 0 && byDept.length) {
            const maxCount = Math.max(...byDept.map(d => d.count), 1);
            list.push({
                key: "by-department",
                render: () => (
                    <>
                        <div className="rp-pop" style={{ fontSize: 60, color: GREEN }}>
                            <FireFilled />
                        </div>
                        <div className="rp-kicker rp-rise" style={{ marginTop: 14 }}>Delivered this period</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s" }}>
                            <CountUp to={interventionCount} active={open} /> intervention{interventionCount === 1 ? "" : "s"}
                        </h2>
                        <div
                            className="rp-list"
                            style={{
                                maxWidth: "min(1180px, 100%)",
                                width: "100%",
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            }}
                        >
                            {byDept.slice(0, 6).map((row, i) => (
                                <div key={row.department} className="rp-card rp-row rp-rise" style={{ animationDelay: `${0.15 + i * 0.08}s`, flexDirection: "column", alignItems: "stretch" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
                                        <Text strong style={{ color: "var(--rp-fg)" }}>{row.department}</Text>
                                        <Text style={{ color: "var(--rp-muted)" }}>{row.count}</Text>
                                    </div>
                                    <div className="rp-bartrack">
                                        <div className="rp-barfill rp-bar" style={{ width: `${Math.round((row.count / maxCount) * 100)}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ),
            });
        }

        const movStats = data.movStats;
        if (movStats && movStats.submitted > 0) {
            const rate = Math.round((movStats.validated / movStats.submitted) * 100);
            list.push({
                key: "movs",
                render: () => {
                    const itemRate = movStats.items > 0
                        ? Math.round((movStats.itemsValidated / movStats.items) * 100)
                        : null;
                    const cards = [
                        { label: "Packs submitted", value: movStats.submitted, color: BLUE },
                        { label: "Packs validated", value: movStats.validated, color: GREEN },
                        ...(movStats.items > 0
                            ? [
                                { label: "MOVs submitted", value: movStats.items, color: PURPLE },
                                { label: "MOVs validated", value: movStats.itemsValidated, color: PINK },
                            ]
                            : []),
                    ];
                    return (
                        <>
                            <div className="rp-pop" style={{ fontSize: 52 }}>
                                <SafetyCertificateFilled style={{ color: PURPLE }} />
                            </div>
                            <div className="rp-kicker rp-rise" style={{ marginTop: 10 }}>Evidence of delivery</div>
                            <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s", fontSize: "clamp(24px,3.6vw,38px)" }}>
                                MOV packs &amp; individual MOVs
                            </h2>
                            <div
                                className="rp-grid"
                                style={{ maxWidth: 640, marginTop: 24, gridTemplateColumns: "repeat(2, minmax(140px, 1fr))" }}
                            >
                                {cards.map((card, i) => (
                                    <div
                                        key={card.label}
                                        className="rp-card rp-rise"
                                        style={{ padding: "18px 16px", animationDelay: `${0.15 + i * 0.08}s` }}
                                    >
                                        <div className="rp-num" style={{ fontSize: "clamp(30px,4.2vw,46px)", color: card.color }}>
                                            <CountUp to={card.value} active={open} />
                                        </div>
                                        <div style={{ marginTop: 4, color: "var(--rp-muted)", fontWeight: 600, fontSize: 13 }}>
                                            {card.label}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="rp-sub rp-rise" style={{ animationDelay: ".5s", marginTop: 16, fontSize: 14 }}>
                                {rate}% of packs validated{itemRate != null ? ` · ${itemRate}% of individual MOVs validated` : ""}.
                            </div>
                        </>
                    );
                },
            });
        }

        const stories = (data.successStories || []).filter(s => s.outcome);
        stories.slice(0, 2).forEach((story, i) => {
            list.push({
                key: `story-${i}`,
                render: () => (
                    <>
                        <div className="rp-pop" style={{ fontSize: 60, color: PINK }}>
                            <StarFilled />
                        </div>
                        <div className="rp-kicker rp-rise" style={{ marginTop: 14 }}>Success story</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s", fontSize: "clamp(24px,3.6vw,40px)" }}>
                            {story.title || story.intervention || "A win worth sharing"}
                        </h2>
                        <div className="rp-sub rp-rise" style={{ animationDelay: ".3s", maxWidth: 780 }}>
                            {story.outcome}
                        </div>
                    </>
                ),
            });
        });

        const risks = (data.challengesAndRisks || []).filter(r => r.issue);
        if (risks.length) {
            list.push({
                key: "risks",
                render: () => (
                    <>
                        <div className="rp-kicker rp-rise">Worth watching</div>
                        <h2 className="rp-title rp-rise" style={{ animationDelay: ".15s", fontSize: "clamp(26px,4vw,44px)" }}>
                            Challenges &amp; risks
                        </h2>
                        <div className="rp-list">
                            {risks.slice(0, 4).map((risk, i) => (
                                <div key={i} className="rp-card rp-row rp-rise" style={{ animationDelay: `${0.15 + i * 0.08}s`, alignItems: "flex-start" }}>
                                    <SafetyCertificateFilled style={{ color: PURPLE, fontSize: 18, flex: "0 0 auto", marginTop: 2 }} />
                                    <div style={{ minWidth: 0 }}>
                                        <Text strong style={{ color: "var(--rp-fg)", display: "block" }}>{risk.issue}</Text>
                                        {risk.mitigation && (
                                            <Text style={{ color: "var(--rp-muted)", fontSize: 13 }}>{risk.mitigation}</Text>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ),
            });
        }

        list.push({
            key: "closing",
            render: () => (
                <>
                    <div className="rp-pop rp-float" style={{ fontSize: 72, color: GREEN }}>
                        <TrophyFilled />
                    </div>
                    <div className="rp-kicker rp-rise" style={{ marginTop: 18 }}>
                        {periodLabel}
                    </div>
                    <h1 className="rp-title rp-rise" style={{ animationDelay: ".2s" }}>
                        That&apos;s the story so far
                    </h1>
                    <div className="rp-sub rp-rise" style={{ animationDelay: ".4s" }}>
                        {data.meta?.preparedBy ? `Prepared by ${data.meta.preparedBy}. ` : ""}
                        Export the full report for the detailed breakdown.
                    </div>
                </>
            ),
        });

        return list;
    }, [data, rangeLabel, open]);

    useEffect(() => {
        setIndex(i => Math.min(i, Math.max(slides.length - 1, 0)));
    }, [slides.length]);

    useEffect(() => {
        if (open) {
            setIndex(0);
            setPlaying(true);
        }
    }, [open]);

    // The player sits on top of the page as a fixed overlay, but the page behind it can
    // still scroll unless we lock it -- which otherwise reads as two scrollbars at once.
    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [open]);

    useEffect(() => {
        if (!open || !playing || !slides.length) return;
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
            if (e.key === "ArrowRight") setIndex(i => Math.min(i + 1, slides.length - 1));
            if (e.key === "ArrowLeft") setIndex(i => Math.max(i - 1, 0));
            if (e.key === " ") {
                e.preventDefault();
                setPlaying(p => !p);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose, slides.length]);

    if (!open || !slides.length) return null;
    const slide = slides[Math.min(index, slides.length - 1)];

    return (
        <div className={`rp-root ${dark ? "rp-dark" : "rp-light"}`} role="dialog" aria-label="Programme report playback">
            <style>{css}</style>
            <div className="rp-orb" style={{ width: 420, height: 420, background: PURPLE, top: -120, left: -100 }} />
            <div className="rp-orb" style={{ width: 380, height: 380, background: PINK, bottom: -140, right: -80, animationDelay: "2s" }} />
            <Button
                type="text"
                shape="circle"
                icon={<CloseOutlined />}
                onClick={onClose}
                style={{ position: "absolute", top: 20, right: 20, color: "var(--rp-fg)", zIndex: 2 }}
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
                        <button key={s.key} className="rp-dot" onClick={() => setIndex(i)} aria-label={`Slide ${i + 1}`}>
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

export default MonitoringReportPlayer;
