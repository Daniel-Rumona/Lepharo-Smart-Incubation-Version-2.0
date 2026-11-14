import { db } from "@/firebase"
import { collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore"
import { getSessionId } from "@/utils/sessionTracking"

/*
 * Page usage: one pageVisits doc per page a signed-in user opens, holding how
 * long they were actively on it and what they clicked there. The doc is created
 * on entry (so the visit counts even if the tab dies) and topped up while the
 * page is open and when it is left -- a few writes per visit, not one per click.
 *
 * Read by the System Admin usage page (src/routes/admin/usage).
 */

export const PAGE_VISITS = "pageVisits"

/** No input for this long and the time stops counting as active. */
const IDLE_AFTER_MS = 60_000
/** Unsaved time or actions are written at most this often while a page is open. */
const FLUSH_EVERY_MS = 60_000
/** Keeps a page left open all day from growing one doc without bound. */
const MAX_ACTIONS = 100
const MAX_LABEL = 60

export type UsageActionKind = "button" | "link" | "tab" | "menu" | "toggle" | "custom"

export type UsageAction = {
    label: string
    kind: UsageActionKind
    /** Milliseconds after the page was entered. */
    at: number
}

export type UsageUser = {
    uid: string
    email: string
    name: string
    role: string
    /** Set while a system admin is viewing the app as someone else. */
    viewingAsUid?: string | null
}

type Visit = {
    id: string
    enteredAt: number
    activeMs: number
    lastTickAt: number
    actions: UsageAction[]
    actionCount: number
    dirty: boolean
    lastFlushAt: number
}

let current: Visit | null = null
let lastInputAt = Date.now()
let visible = typeof document === "undefined" || document.visibilityState === "visible"

const looksLikeId = (segment: string) =>
    /^\d+$/.test(segment) ||
    segment.includes("@") ||
    segment.includes("%") ||
    /^[0-9a-f-]{32,36}$/i.test(segment) ||
    (segment.length >= 16 && /^[A-Za-z0-9_-]+$/.test(segment) && (/\d/.test(segment) || /[A-Z]/.test(segment)))

/** "/participants/aB3x.../edit" -> "/participants/:id/edit", so visits group by page rather than by record. */
export function pageKey(pathname: string) {
    const parts = pathname.split("/").filter(Boolean).map(s => (looksLikeId(s) ? ":id" : s))
    return "/" + parts.join("/")
}

/** The page's own <title>, without the product suffix every title carries. */
const pageTitle = () =>
    document.title.split("|")[0].trim() || "Untitled"

const localDay = (ms: number) => {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Adds time since the last tick, counting only while the tab is visible and the user is not idle. */
function tick(now = Date.now()) {
    if (!current) return
    const elapsed = now - current.lastTickAt
    current.lastTickAt = now
    if (!visible) return
    // Count up to the idle cut-off after the last input, not the whole gap.
    const activeUntil = Math.min(now, lastInputAt + IDLE_AFTER_MS)
    const from = now - elapsed
    if (activeUntil > from) {
        current.activeMs += activeUntil - from
        current.dirty = true
    }
}

export function noteInput() {
    const now = Date.now()
    // Close off the idle stretch before the clock starts counting again.
    if (now - lastInputAt > IDLE_AFTER_MS) tick(now)
    lastInputAt = now
}

/** Call when the tab is shown or hidden; time up to now is credited to the state it was in. */
export function noteVisibility(isVisible: boolean) {
    tick()
    visible = isVisible
    if (isVisible) lastInputAt = Date.now()
}

export function startVisit(user: UsageUser, pathname: string) {
    endVisit()
    const now = Date.now()
    const ref = doc(collection(db, PAGE_VISITS))
    current = {
        id: ref.id,
        enteredAt: now,
        activeMs: 0,
        lastTickAt: now,
        actions: [],
        actionCount: 0,
        dirty: false,
        lastFlushAt: now,
    }
    lastInputAt = now
    visible = document.visibilityState === "visible"

    setDoc(ref, {
        uid: user.uid,
        email: user.email || null,
        name: user.name || null,
        role: user.role || "unknown",
        viewingAsUid: user.viewingAsUid || null,
        sessionId: getSessionId(),
        path: pathname,
        page: pageKey(pathname),
        title: pageTitle(),
        day: localDay(now),
        enteredAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        activeMs: 0,
        totalMs: 0,
        actionCount: 0,
        actions: [],
        ended: false,
    }).catch(() => { })
}

export function flushVisit(ended = false) {
    if (!current) return
    tick()
    const visit = current
    if (!visit.dirty && !ended) return
    visit.dirty = false
    visit.lastFlushAt = Date.now()

    updateDoc(doc(db, PAGE_VISITS, visit.id), {
        // Titles are set by Helmet after the page renders, so take the latest one.
        title: pageTitle(),
        activeMs: Math.round(visit.activeMs),
        totalMs: Date.now() - visit.enteredAt,
        actionCount: visit.actionCount,
        actions: visit.actions,
        lastSeenAt: serverTimestamp(),
        ended,
    }).catch(() => { })
}

/** Called on a timer; writes only when there is something new and the last write is old enough. */
export function maybeFlushVisit() {
    if (!current) return
    tick()
    if (current.dirty && Date.now() - current.lastFlushAt >= FLUSH_EVERY_MS) flushVisit()
}

export function endVisit() {
    if (!current) return
    flushVisit(true)
    current = null
}

/** Records something done on the current page. Clicks are captured automatically; call this for anything else worth counting. */
export function trackAction(label: string, kind: UsageActionKind = "custom") {
    if (!current) return
    const clean = label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL)
    if (!clean) return
    current.actionCount += 1
    if (current.actions.length < MAX_ACTIONS) {
        current.actions.push({ label: clean, kind, at: Date.now() - current.enteredAt })
    }
    current.dirty = true
}

const ACTION_SELECTOR = [
    "button",
    "a[href]",
    "[role='button']",
    "[role='tab']",
    "[role='menuitem']",
    "[role='switch']",
    ".ant-segmented-item",
].join(",")

// Navigation is already recorded as the next page visit.
const IGNORE_SELECTOR = "nav, .workspace-primary-nav, .ant-layout-sider, .ant-layout-header, [data-usage-ignore]"

const kindOf = (el: Element): UsageActionKind => {
    const role = el.getAttribute("role")
    if (role === "tab" || el.classList.contains("ant-segmented-item")) return "tab"
    if (role === "menuitem") return "menu"
    if (role === "switch") return "toggle"
    if (el.tagName === "A") return "link"
    return "button"
}

const labelOf = (el: Element) => {
    const explicit = el.getAttribute("data-usage") || el.getAttribute("aria-label") || el.getAttribute("title")
    if (explicit) return explicit
    const text = (el as HTMLElement).innerText || el.textContent || ""
    if (text.trim()) return text
    // Icon-only buttons: antd icons carry their name, e.g. "delete", "edit".
    const icon = el.querySelector("[aria-label]")?.getAttribute("aria-label")
    return icon ? `${icon} (icon)` : ""
}

/** Click handler for the document: turns clicks on controls into actions. Never reads input values. */
export function captureClick(event: MouseEvent) {
    const target = event.target as Element | null
    const el = target?.closest?.(ACTION_SELECTOR)
    if (!el || el.closest(IGNORE_SELECTOR)) return
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return
    trackAction(labelOf(el), kindOf(el))
}
