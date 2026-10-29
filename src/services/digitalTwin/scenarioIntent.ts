import type { Levers } from './goalSeek'

/**
 * Turns a sentence like "add 2 centre coordinators and 30 new SMEs over 12 weeks" into scenario levers.
 *
 * This is a rule-based reader, not a language model: it looks for a number, what it is about and whether it is
 * hours, people or days. It never guesses. Anything it cannot use is returned in `ignored` so the user sees it.
 * A model-backed version can return the same `ScenarioIntent` shape and replace `parseScenarioIntent`.
 */
export type IntentContext = {
    /** Weekly hours one facilitator or centre coordinator works on this, from centre operating hours. */
    hoursPerCentreStaff: number
    /** Weekly hours assumed for one M&E person (operations staff are not on centre hours). */
    hoursPerMe: number
    /** Review days a week the head of department has today. */
    hodWindows: number
}
export type ScenarioIntent = {
    /** Levers the sentence sets. Only the ones it mentions are present. */
    levers: Partial<Levers>
    weeks?: number
    /** What was understood, in plain words, including any conversion such as people to hours. */
    understood: string[]
    /** Parts of the sentence that could not be used. */
    ignored: string[]
    /** Who read it: the assistant, or the built-in rules when the assistant was not available. */
    reader?: 'assistant' | 'rules'
}

const CAPS: Record<keyof Levers, number> = { hours: 160, cc: 100, me: 100, hod: 5, intake: 300 }

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50 }
const NUM = '(\\d+(?:\\.\\d+)?|' + Object.keys(WORDS).join('|') + ')'
const toNumber = (raw: string) => /^\d/.test(raw) ? Number(raw) : WORDS[raw]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const round1 = (v: number) => Math.round(v * 10) / 10

export function parseScenarioIntent(text: string, ctx: IntentContext): ScenarioIntent {
    let rest = ` ${text.toLowerCase().replace(/[“”"]/g, ' ')} `
    const out: ScenarioIntent = { levers: {}, understood: [], ignored: [] }

    // How far ahead: "over 12 weeks", "for the next 3 months".
    const horizon = rest.match(new RegExp(`(?:over|for|in|within|across|during|the next|next)?\\s*${NUM}\\s*(weeks?|wks?|months?)\\b`))
    if (horizon) {
        const n = toNumber(horizon[1]), weeks = clamp(Math.round(/^m/.test(horizon[2]) ? n * 4 : n), 1, 26)
        out.weeks = weeks; out.understood.push(`look ${weeks} weeks ahead`)
        rest = rest.replace(horizon[0], ' ')
    }

    const add = (key: keyof Levers, amount: number) => { out.levers[key] = round1((out.levers[key] ?? 0) + amount) }
    const clauses = rest.split(/\s*(?:,|;|\bplus\b|\balso\b|\band\b|\+)\s*/).map(c => c.trim()).filter(Boolean)
    const staff: Partial<Record<keyof Levers, string[]>> = {}
    const note = (key: keyof Levers, line: string) => { (staff[key] ||= []).push(line) }

    for (const clause of clauses) {
        const q = clause.match(new RegExp(NUM))
        if (!q) { if (/[a-z]/.test(clause) && clause.length > 2 && !/^(add|more|extra|and|with|then|please)$/.test(clause)) out.ignored.push(clause); continue }
        const n = toNumber(q[1]), hours = /\d\s*(?:h|hrs?|hours?)\b|\b(?:hours?|hrs?)\b/.test(clause), days = /\b(days?|x|times)\b/.test(clause)
        if (/m\s*&\s*e|\bme\b|monitoring/.test(clause)) {
            if (hours) { add('me', n); note('me', `+${n} M&E hours a week`) }
            else { add('me', n * ctx.hoursPerMe); note('me', `${n} more M&E ${n === 1 ? 'person' : 'people'} ≈ +${round1(n * ctx.hoursPerMe)} hours a week`) }
        } else if (/centre|center|coordinator/.test(clause) && !/facilitator/.test(clause)) {
            if (hours) { add('cc', n); note('cc', `+${n} coordinator hours a week`) }
            else { add('cc', n * ctx.hoursPerCentreStaff); note('cc', `${n} more centre ${n === 1 ? 'coordinator' : 'coordinators'} ≈ +${round1(n * ctx.hoursPerCentreStaff)} hours a week`) }
        } else if (/facilitator|delivery|delivering/.test(clause)) {
            if (hours) { add('hours', n); note('hours', `+${n} facilitator hours a week`) }
            else { add('hours', n * ctx.hoursPerCentreStaff); note('hours', `${n} more ${n === 1 ? 'facilitator' : 'facilitators'} ≈ +${round1(n * ctx.hoursPerCentreStaff)} hours a week`) }
        } else if (/\bhod\b|head of dep|review|approv/.test(clause)) {
            const more = /\b(more|extra|additional|another)\b/.test(clause)
            const target = clamp(Math.round(more ? ctx.hodWindows + n : n), 0, 5)
            out.levers.hod = target; note('hod', `head-of-department review ${target} ${target === 1 ? 'day' : 'days'} a week`)
            if (!days && !more) { /* a bare number is read as days a week */ }
        } else if (/\b(smmes?|smes?|businesses|participants?|newcomers|intake)\b/.test(clause) || /\bnew\b/.test(clause)) {
            add('intake', n); note('intake', `${n} new ${n === 1 ? 'SME' : 'SMEs'}`)
        } else if (/session/.test(clause)) {
            out.ignored.push(`${clause} (sessions are not a lever; try facilitator hours or facilitators)`)
        } else out.ignored.push(clause)
    }

    // Keep every lever inside what the Scenarios page allows.
    for (const key of Object.keys(out.levers) as Array<keyof Levers>) out.levers[key] = clamp(out.levers[key]!, 0, CAPS[key])
    out.reader = 'rules'
    out.understood = [...(['hours', 'cc', 'me', 'hod', 'intake'] as const).flatMap(key => staff[key] || []), ...out.understood]
    return out
}

/** Checks an answer from the assistant before it is used: known levers only, finite numbers, inside the page limits. */
export function normaliseIntent(raw: unknown): ScenarioIntent {
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
    const levers: Partial<Levers> = {}
    for (const key of Object.keys(CAPS) as Array<keyof Levers>) {
        const value = data.levers?.[key]
        if (typeof value === 'number' && Number.isFinite(value)) levers[key] = clamp(round1(value), 0, CAPS[key])
    }
    const weeks = Number(data.weeks)
    const strings = (list: unknown) => (Array.isArray(list) ? list : []).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim().slice(0, 160)).slice(0, 8)
    return { levers, weeks: Number.isFinite(weeks) && weeks > 0 ? clamp(Math.round(weeks), 1, 26) : undefined, understood: strings(data.understood), ignored: strings(data.ignored) }
}
