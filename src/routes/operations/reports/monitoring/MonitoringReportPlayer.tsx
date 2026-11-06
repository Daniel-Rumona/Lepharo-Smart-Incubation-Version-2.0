import { useMemo } from "react";
import { Typography } from "antd";
import {
    AppstoreFilled,
    FireFilled,
    RocketFilled,
    SafetyCertificateFilled,
    StarFilled,
    TrophyFilled,
} from "@ant-design/icons";
import type { MonthlyReportData } from "@/utils/monthlyReportDocx";
import StoryPlayer, { BLUE, CountUp, GREEN, PINK, PURPLE, TAG_COLORS, type StorySlide } from "@/components/reports/StoryPlayer";

// Retells the M&E programme report data as a story. The overlay itself is shared
// (src/components/reports/StoryPlayer.tsx).

const { Text } = Typography;

type Props = {
    dark?: boolean;
    open: boolean;
    onClose: () => void;
    data: MonthlyReportData | null;
    rangeLabel: string;
    inline?: boolean;
};

const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};


const MonitoringReportPlayer = ({ dark = true, open, onClose, data, rangeLabel, inline = false }: Props) => {
    const slides = useMemo(() => {
        if (!data) return [] as StorySlide[];
        const list: StorySlide[] = [];
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

    return <StoryPlayer dark={dark} open={open} onClose={onClose} slides={slides} ariaLabel="Programme report playback" inline={inline} />;
};

export default MonitoringReportPlayer;
