import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Space, Spin } from "antd";
import {
    CloseOutlined,
    LeftOutlined,
    PauseOutlined,
    PlayCircleFilled,
    RightOutlined,
} from "@ant-design/icons";

/*
  Shared "story mode" shell used by the report players (M&E programme report,
  project admin report). A player builds its slides; this owns the full-screen
  overlay, autoplay timer, keyboard shortcuts, controls and scroll lock.
*/

export const SLIDE_MS = 7000;
export const PURPLE = "#814DFF";
export const PINK = "#FF1F85";
export const GREEN = "#2BD9A0";
export const BLUE = "#243FFF";
export const ORANGE = "#FFA940";
export const TEAL = "#13C2C2";
export const TAG_COLORS = [PURPLE, BLUE, GREEN, PINK, ORANGE, TEAL];

export const CountUp = ({ to, active }: { to: number; active: boolean }) => {
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

export const STORY_CSS = `
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
.rp-root { position:fixed; inset:0; z-index:2147483000; color: var(--rp-fg); overflow:hidden;
  background: radial-gradient(1200px 700px at 15% 10%, var(--rp-bg1) 0%, transparent 60%),
              radial-gradient(1000px 700px at 90% 90%, var(--rp-bg2) 0%, transparent 55%), var(--rp-bg);
  font-family: inherit; }
.rp-orb { position:absolute; border-radius:50%; filter: blur(70px); animation: rp-glow 6s ease-in-out infinite; }
.rp-dark { --rp-fg:#fff; --rp-bg:#0b0a1a; --rp-bg1:#2a1a6b; --rp-bg2:#4a0f43; --rp-kicker:#b9b3ff; --rp-muted:#cfcaf5; --rp-card:rgba(255,255,255,.07); --rp-line:rgba(255,255,255,.14); --rp-track:rgba(255,255,255,.14); --rp-t1:#fff; --rp-t2:#c7b8ff; --rp-t3:#ff8cc4; --rp-shadow:none; }
.rp-light { --rp-fg:#1f1b3a; --rp-bg:#faf9ff; --rp-bg1:#ece8ff; --rp-bg2:#ffedf5; --rp-kicker:#6b4fe0; --rp-muted:#5b6070; --rp-card:#ffffff; --rp-line:rgba(107,79,224,.16); --rp-track:rgba(31,27,58,.09); --rp-t1:#2a2170; --rp-t2:#5a3fe0; --rp-t3:#c2358a; --rp-shadow:0 6px 20px rgba(60,40,140,.08); }
.rp-light .rp-orb { animation-name: rp-glow-light; }
.rp-stage { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:safe center; overflow-y:auto; padding: 48px 6vw 84px; text-align:center; }
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
.rp-cards { display:flex; flex-wrap:wrap; justify-content:center; align-items:flex-start; gap:16px; width:100%; max-width:1000px; margin-top:22px; }
.rp-cards > * { flex:0 1 auto; }
.rp-panels { display:flex; flex-wrap:wrap; justify-content:center; align-items:flex-start; gap:16px; width:100%; max-width:1000px; margin-top:22px; }
.rp-panels > * { flex:1 1 320px; max-width:480px; }
.rp-tags { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; max-width:820px; margin-top:30px; }
.rp-tag { display:inline-flex; align-items:baseline; gap:8px; padding:10px 18px; border-radius:999px; border:1px solid var(--rp-line); background: var(--rp-card); backdrop-filter: blur(10px); }
`;

export type StorySlide = { key: string; render: () => JSX.Element };

type ShellProps = {
    dark?: boolean;
    open: boolean;
    onClose: () => void;
    slides: StorySlide[];
    loading?: boolean;
    ariaLabel?: string;
    /**
     * By default the player renders straight into <body> so no page layout, top bar or
     * transformed ancestor can sit over (or clip) it. A caller that animates the player
     * itself wraps it and sets this so the wrapper stays in charge.
     */
    inline?: boolean;
};

const StoryPlayer = ({ dark = true, open, onClose, slides, loading = false, ariaLabel = "Report playback", inline = false }: ShellProps) => {
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);

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

    // Take the whole screen, browser chrome included, where the browser allows it. This has to
    // be requested from a click, so it quietly does nothing if the request is refused.
    useEffect(() => {
        if (!open) return;
        const root = document.documentElement;
        if (!document.fullscreenElement && root.requestFullscreen) {
            root.requestFullscreen().catch(() => undefined);
        }
        return () => {
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => undefined);
            }
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

    if (!open) return null;
    const slide = slides[Math.min(index, slides.length - 1)];

    const node = (
        <div className={`rp-root ${dark ? "rp-dark" : "rp-light"}`} role="dialog" aria-label={ariaLabel}>
            <style>{STORY_CSS}</style>
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
            {loading || !slide ? (
                <div className="rp-stage">
                    <Spin size="large" />
                    <div className="rp-sub">{loading ? "Pulling the story together..." : "Nothing to show for this period."}</div>
                </div>
            ) : (
                <>
                    <div className="rp-stage" key={slide.key}>
                        {slide.render()}
                    </div>
                    <div className="rp-ctrl">
                        <Space size={6}>
                            <Button type="text" shape="circle" icon={<LeftOutlined />} disabled={index === 0} onClick={() => setIndex(index - 1)} style={{ color: "var(--rp-fg)" }} />
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
                            <Button type="text" shape="circle" icon={<RightOutlined />} disabled={index === slides.length - 1} onClick={() => setIndex(index + 1)} style={{ color: "var(--rp-fg)" }} />
                        </Space>
                        <div style={{ display: "flex", gap: 8 }}>
                            {slides.map((sl, i) => (
                                <button key={sl.key} className="rp-dot" onClick={() => setIndex(i)} aria-label={`Slide ${i + 1}`}>
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
                </>
            )}
        </div>
    );

    return inline ? node : createPortal(node, document.body);
};

export default StoryPlayer;
