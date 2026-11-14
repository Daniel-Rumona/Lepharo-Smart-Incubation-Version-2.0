"use strict";
/**
 * The daily brief: one message a person gets instead of a stream of reminder emails.
 * Pure (no imports) so dailyBriefLogic.test.cjs runs without Firebase; dailyBrief.ts
 * holds reminders back, reads what happened and sends the brief.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sastDate = exports.renderBriefEmail = exports.buildBrief = void 0;
const SECTION_TITLES = {
    mov: "MOVs waiting on you",
    devplan: "Development plans to confirm",
    watch: "Your watches and chasers",
    notification: "Since your last brief",
};
const ORDER = ["watch", "mov", "devplan", "notification"];
const MAX_PER_SECTION = 8;
/** Newest of each repeated reminder, grouped into sections in a fixed order. */
function buildBrief(items, date) {
    const newest = new Map();
    for (const item of items) {
        const key = `${item.category}:${item.dedupeKey || item.title}`;
        const seen = newest.get(key);
        if (!seen || item.createdAt > seen.createdAt)
            newest.set(key, item);
    }
    const sections = ORDER.map((key) => ({
        key,
        title: SECTION_TITLES[key],
        items: [...newest.values()]
            .filter((item) => item.category === key)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_PER_SECTION)
            .map(({ title, detail, link }) => ({ title, detail, link })),
    })).filter((section) => section.items.length > 0);
    return { date, sections, total: sections.reduce((n, section) => n + section.items.length, 0) };
}
exports.buildBrief = buildBrief;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Monday, 2 November": written out, so it reads the same on every server. */
const longDate = (date) => {
    const day = new Date(`${date}T12:00:00Z`);
    return `${DAYS[day.getUTCDay()]}, ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
};
const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The one email of the day. Links are absolute (base + the item's path). */
function renderBriefEmail(name, brief, base, settingsPath = "/chat") {
    const url = (link) => (/^https?:\/\//.test(link) ? link : `${base.replace(/\/$/, "")}${link.startsWith("/") ? "" : "/"}${link}`);
    const first = (name || "").trim().split(/\s+/)[0] || "there";
    const when = longDate(brief.date);
    const subject = `Your daily brief: ${brief.total} thing${brief.total === 1 ? "" : "s"} for ${when}`;
    const sectionsHtml = brief.sections.map((section) => `
<h3 style="margin:20px 0 8px;font-size:15px;color:#14284b">${escape(section.title)}</h3>
<ul style="margin:0;padding-left:18px">${section.items.map((item) => `
<li style="margin:0 0 8px"><a href="${escape(url(item.link))}" style="color:#1d5fe0;text-decoration:none;font-weight:600">${escape(item.title)}</a>${item.detail ? `<br/><span style="color:#5d7396">${escape(item.detail)}</span>` : ""}</li>`).join("")}
</ul>`).join("");
    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px;color:#1f2937;max-width:600px">
<p>Good morning ${escape(first)},</p>
<p>Here is everything from your reminders and notifications in one place, instead of separate emails.</p>
${sectionsHtml}
<p style="margin-top:24px;color:#5d7396;font-size:12px">You get this brief because daily digest is on. Turn it off in the Data Assistant: <a href="${escape(url(settingsPath))}">${escape(url(settingsPath))}</a></p>
</div>`;
    const text = [
        `Good morning ${first},`,
        "",
        ...brief.sections.flatMap((section) => [
            section.title,
            ...section.items.map((item) => `- ${item.title}${item.detail ? ` (${item.detail})` : ""}: ${url(item.link)}`),
            "",
        ]),
        `Daily digest is on. Turn it off in the Data Assistant: ${url(settingsPath)}`,
    ].join("\n");
    return { subject, html, text };
}
exports.renderBriefEmail = renderBriefEmail;
/** YYYY-MM-DD in South Africa, where the brief's day is counted. */
function sastDate(at = Date.now()) {
    return new Date(at + 2 * 3600 * 1000).toISOString().slice(0, 10);
}
exports.sastDate = sastDate;
//# sourceMappingURL=dailyBriefLogic.js.map