/**
 * Survey analytics for the Surveys Portal's Analytics window.
 *
 * Two levels:
 * - the overview, which is about response behaviour and fits every survey:
 *   response rate, median time to respond, who is still outstanding;
 * - a survey's profile, which looks at the questions that survey actually has
 *   and analyses each kind its own way: ratings (average, satisfaction),
 *   Yes/No (yes rate), other choices (what was picked), numbers (average,
 *   range) and written answers (sentiment). A survey without ratings simply
 *   has no ratings section.
 *
 * Only submitted responses count. Sentiment is keyword-based (a lexicon with
 * negation), run in the browser: good at "clean and comfortable" vs "too
 * noisy", blind to sarcasm.
 */
import {
    answerFor,
    isAnswered,
    recipientFields,
    responseRate,
    sentStatusOf,
    surveyQuestions,
    toDate,
    type SentStatus,
    type SentSurvey,
    type SurveyField,
    type SurveyRecipient
} from './surveyData'

export type Sentiment = 'positive' | 'neutral' | 'negative'
export type SentimentCounts = Record<Sentiment, number>

// ─────────────────────────────────────────────────────────────
// Sentiment
// ─────────────────────────────────────────────────────────────

const POSITIVE = new Set(
    `good great excellent helpful useful clean comfortable friendly love loved lovely enjoyed enjoy enjoyable
    amazing awesome fantastic perfect satisfied satisfying happy informative valuable insightful professional
    nice convenient easy clear organised organized spacious quiet fast stable reliable best beneficial
    impressive impressed recommend thank thanks appreciate appreciated supportive knowledgeable engaging
    interactive relevant practical smooth efficient accessible safe pleasant wonderful brilliant effective
    learned learnt worthwhile outstanding superb exceptional welcoming warm neat tidy spotless adequate
    sufficient punctual inspiring motivating empowering grateful glad pleased`.split(/\s+/)
)

const NEGATIVE = new Set(
    `bad poor terrible awful dirty uncomfortable noisy slow unstable broken late delay delayed delays difficult
    confusing unclear disorganised disorganized boring rude cramped crowded overcrowded expensive waste
    useless problem problems issue issues lacking lack lacked missing worse worst disappointed disappointing
    frustrating frustrated unhappy unsafe inadequate insufficient unreliable failed fail failing complicated
    rushed limited dissatisfied horrible annoying annoyed stuffy smelly leaking faulty unprofessional
    unhelpful inconvenient loud disruptive disrupted interrupted outdated cancelled canceled struggle
    struggled challenge challenges challenging wrong`.split(/\s+/)
)
// Not in the list on purpose: far, small, hot, cold, dark, tight. On their
// own they are neutral ("so far", "small groups"); "too far" is caught below.

/** "could be better", "needs improvement": a complaint without a negative word. */
const NEGATIVE_PHRASES = [
    /\bcould (have )?be(en)? better\b/,
    /\bneeds? (to )?improv/,
    /\bnot enough\b/,
    /\btoo (small|hot|cold|noisy|loud|long|short|far|slow|crowded|expensive|dark|tight)\b/,
    /\bdid ?n[o']?t work\b/,
    /\bnot working\b/
]

const NEGATORS = new Set(['not', 'no', 'never', 'nothing', 'without', 'hardly', 'barely', 'none', 'nor'])

/** Answers that say nothing either way ("No", "N/A", "None", "So far none"). */
const EMPTY_ANSWER =
    /^(n\/?a|na|no|none|nil|nothing|not applicable|(so far )?none( so far)?|nothing( really| so far)?|no comments?|-+|\.+)[.!]*$/i

export const sentimentOf = (text: string): Sentiment | null => {
    const clean = String(text || '').trim()
    if (!clean || EMPTY_ANSWER.test(clean)) return null
    const lower = clean.toLowerCase().replace(/[’']/g, "'")
    let score = 0
    // A negator only reaches within its own sentence or clause: in "So far
    // none. Everything was good" the "none" must not flip "good".
    lower
        .replace(/n't\b/g, ' not')
        .split(/[.!?;,]+|\bbut\b|\bhowever\b/)
        .forEach(clause => {
            const words = clause.split(/[^a-z']+/).filter(Boolean)
            words.forEach((word, i) => {
                const polarity = POSITIVE.has(word) ? 1 : NEGATIVE.has(word) ? -1 : 0
                if (!polarity) return
                // "not clean", "no wrong answer": a negator in the 3 words before flips it.
                const negated = words.slice(Math.max(0, i - 3), i).some(w => NEGATORS.has(w))
                score += negated ? -polarity : polarity
            })
        })
    NEGATIVE_PHRASES.forEach(phrase => {
        if (phrase.test(lower)) score -= 1
    })
    return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral'
}

const emptySentiment = (): SentimentCounts => ({ positive: 0, neutral: 0, negative: 0 })

export const sentimentScore = (counts: SentimentCounts): number | null => {
    const total = counts.positive + counts.neutral + counts.negative
    return total ? Math.round(((counts.positive - counts.negative) / total) * 100) : null
}

// ─────────────────────────────────────────────────────────────
// Question kinds
// ─────────────────────────────────────────────────────────────

const YES = /^(yes|y|yebo|true)$/i
const NO = /^(no|n|false)$/i
const NA = /^n\/?a$/i

/**
 * Choice question types. Imported forms often turn a Yes/No or 1–5 column
 * into checkboxes, whose answer is a list (["Yes"]), so they count too.
 */
const CHOICE_TYPES = new Set(['radio', 'select', 'checkbox', 'multiple'])

/** A choice answer as its list of picks: "Yes" and ["Yes"] alike. */
const picks = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).map(v => String(v ?? '').trim()).filter(Boolean)

const optionsOf = (field: SurveyField) => (field.options || []).map(o => String(o).trim()).filter(Boolean)

/**
 * Questions asking whether something went wrong ("Did you experience any
 * barriers?", "Were there any problems?"): for these, No is the good answer.
 */
const PROBLEM_WORDS =
    /\b(barriers?|problems?|issues?|difficult(y|ies)|challenges?|complaints?|concerns?|delays?|obstacles?|incidents?|accidents?|injur(y|ies|ed)|hazards?|unsafe|discriminat\w*|harass\w*|bull(y|ied|ying)|late|missing|faulty|broken|interrupt\w*|disrupt\w*|fail(ed|ures?)?|struggl\w*|dissatisf\w*|frustrat\w*|confus\w*|shortage|lack(ed|ing)?)\b/i

/** "Did the course address your challenges?": solving a problem is a yes. */
const SOLVING_WORDS =
    /\b(address(ed|es)?|solv(e|ed|es|ing)|resolv(e|ed|es|ing)|overcome|fix(ed)?|help(ed|s)? (you )?(with|to)|deal(t)? with|handl(e|ed)|tackl(e|ed)|support(ed)?|reduc(e|ed)|prevent(ed)?|report(ed)? .* to)\b/i

export const asksAboutProblems = (label: string) =>
    PROBLEM_WORDS.test(label || '') && !SOLVING_WORDS.test(label || '')

const isYesNo = (field: SurveyField) => {
    if (!CHOICE_TYPES.has(field.type)) return false
    const options = optionsOf(field)
    return options.some(o => YES.test(o)) && options.some(o => NO.test(o))
}

/** The top of the scale for rating questions and numbered choice columns (1–5, N/A). */
const scaleMax = (field: SurveyField): number | null => {
    if (field.type === 'rating') return 5
    if (!CHOICE_TYPES.has(field.type)) return null
    const numbers = optionsOf(field)
        .filter(o => !NA.test(o))
        .map(Number)
    if (numbers.length < 3 || numbers.some(n => !Number.isFinite(n))) return null
    return Math.max(...numbers)
}

/** Wording of number questions that ask for an identifier rather than an amount. */
const IDENTIFIER_LABEL =
    /\b(phone|cell(phone)?|mobile|tel(ephone)?|whatsapp|fax|contact (no|number)|id|identity|passport|registration|reg\.? ?(no|number)|account|bank|branch code|postal|post ?code|zip|vat|tax|cipc|reference|ref\.?|serial|pin|employee (no|number)|student (no|number))\b/i

/**
 * True when a "number" question is really an identifier: its wording says so,
 * or most answers look like one (a leading zero, as in 071…, or 9+ digits).
 */
const isIdentifierNumber = (field: SurveyField, values: unknown[]) => {
    if (IDENTIFIER_LABEL.test(field.label || '')) return true
    const raw = values.map(v => String(v ?? '').replace(/[\s+()-]/g, '')).filter(Boolean)
    if (!raw.length) return false
    const looksLikeId = raw.filter(v => /^0\d+$/.test(v) || /^\d{9,}$/.test(v)).length
    return looksLikeId / raw.length >= 0.5
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

// ─────────────────────────────────────────────────────────────
// Timing
// ─────────────────────────────────────────────────────────────

const median = (values: number[]): number | null => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Milliseconds from sending to submitting, per submitted response. SMEs added
 * to a survey later are measured from the survey's own send date, which is
 * the only one recorded.
 */
const responseTimes = (survey: SentSurvey): number[] => {
    const sent = toDate(survey.sentAt)?.getTime()
    if (!sent) return []
    return survey.recipients
        .filter(r => r.completed)
        .map(r => toDate(r.submittedAt)?.getTime())
        .filter((at): at is number => !!at && at >= sent)
        .map(at => at - sent)
}

export const formatDuration = (ms: number | null): string => {
    if (ms === null) return '—'
    const minutes = ms / 60000
    if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
    const hours = minutes / 60
    if (hours < 48) return `${Math.round(hours)} h`
    const days = hours / 24
    return `${days < 10 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days)} days`
}

// ─────────────────────────────────────────────────────────────
// A survey's profile
// ─────────────────────────────────────────────────────────────

export type RatingQuestion = {
    field: SurveyField
    max: number
    answered: number
    /** Out of 5, whatever the question's own scale. */
    average: number
    /** Share of answers in the top two-fifths (4–5 of 5), 0–100. */
    satisfaction: number
    /** Count per scale point, 1..max. */
    distribution: number[]
    notApplicable: number
}

export type YesNoQuestion = {
    field: SurveyField
    yes: number
    no: number
    /** Share answering yes, 0–100. */
    rate: number | null
    /** "Any barriers?", "Any problems?": here No is the good answer. */
    goodAnswer: 'yes' | 'no'
    /** Share giving the good answer, 0–100. */
    favourable: number | null
}

export type ChoiceQuestion = { field: SurveyField; answered: number; rows: { label: string; count: number }[] }

export type NumberQuestion = { field: SurveyField; answered: number; average: number; min: number; max: number }

export type WrittenQuestion = {
    field: SurveyField
    answered: number
    sentiment: SentimentCounts
    examples: { positive?: string; negative?: string }
}

export type SurveyProfile = {
    survey: SentSurvey
    status: SentStatus
    responses: number
    total: number
    responseRate: number
    awaiting: number
    medianResponseMs: number | null
    ratings: {
        average: number
        satisfaction: number
        answers: number
        questions: RatingQuestion[]
    } | null
    yesNo: {
        /** Share answering yes across all Yes/No questions. */
        rate: number | null
        /** Share giving the good answer: yes, or no on a problem question. */
        favourable: number | null
        answers: number
        questions: YesNoQuestion[]
    } | null
    choices: ChoiceQuestion[]
    numbers: NumberQuestion[]
    written: { sentiment: SentimentCounts; score: number | null; questions: WrittenQuestion[] } | null
    /** Plain-language observations, most useful first. */
    highlights: { tone: 'good' | 'bad' | 'info'; text: string }[]
}

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)

const shortLabel = (label: string) => {
    // "Lighting: The room had adequate lighting." reads best as "Lighting".
    const lead = label.split(':')[0].trim()
    const text = lead.length >= 3 && lead.length < label.length ? lead : label
    return text.length > 70 ? `${text.slice(0, 67)}…` : text
}

export const profileSurvey = (survey: SentSurvey): SurveyProfile => {
    const done = survey.recipients.filter(r => r.completed)
    const asked = (r: SurveyRecipient, field: SurveyField) => recipientFields(r).some(f => f.id === field.id)

    const ratingQuestions: RatingQuestion[] = []
    const yesNoQuestions: YesNoQuestion[] = []
    const choices: ChoiceQuestion[] = []
    const numbers: NumberQuestion[] = []
    const writtenQuestions: WrittenQuestion[] = []

    surveyQuestions(survey.recipients)
        // Profile-prefilled answers (company name, sector) aren't opinions.
        .filter(field => field.type !== 'heading' && !(field as { prefill?: string }).prefill)
        .forEach(field => {
            const values = done
                .filter(r => asked(r, field))
                .map(r => answerFor(r, field))
                .filter(isAnswered)

            if (isYesNo(field)) {
                // A checkbox answer ticking both Yes and No says neither.
                let yes = 0
                let no = 0
                values.forEach(v => {
                    const chosen = picks(v)
                    const y = chosen.some(c => YES.test(c))
                    const n = chosen.some(c => NO.test(c))
                    if (y && !n) yes += 1
                    else if (n && !y) no += 1
                })
                // Unanswered questions add nothing; a section shows only with data.
                if (yes + no) {
                    const goodAnswer = asksAboutProblems(field.label) ? 'no' : 'yes'
                    yesNoQuestions.push({
                        field,
                        yes,
                        no,
                        rate: percent(yes, yes + no),
                        goodAnswer,
                        favourable: percent(goodAnswer === 'yes' ? yes : no, yes + no)
                    })
                }
                return
            }

            const max = scaleMax(field)
            if (max) {
                const distribution = Array.from({ length: max }, () => 0)
                let notApplicable = 0
                const scores: number[] = []
                values.forEach(v => {
                    const chosen = picks(v)
                    // One pick per answer; a checkbox answer with several isn't a score.
                    if (chosen.length !== 1) return
                    if (NA.test(chosen[0])) {
                        notApplicable += 1
                        return
                    }
                    const n = Number(chosen[0])
                    if (!Number.isFinite(n) || n < 1 || n > max) return
                    distribution[Math.round(n) - 1] += 1
                    scores.push((n / max) * 5)
                })
                if (!scores.length && !notApplicable) return
                ratingQuestions.push({
                    field,
                    max,
                    answered: scores.length,
                    average: scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : 0,
                    satisfaction: percent(scores.filter(n => n >= 4).length, scores.length),
                    distribution,
                    notApplicable
                })
                return
            }

            if (CHOICE_TYPES.has(field.type)) {
                const counts = new Map<string, number>(optionsOf(field).map(option => [option, 0]))
                values.forEach(v => picks(v).forEach(choice => counts.set(choice, (counts.get(choice) || 0) + 1)))
                if (values.length) {
                    choices.push({
                        field,
                        answered: values.length,
                        rows: Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
                    })
                }
                return
            }

            if (field.type === 'number') {
                // Phone, ID and registration numbers are identifiers, not
                // quantities: an average of them means nothing.
                if (isIdentifierNumber(field, values)) return
                const nums = values.map(Number).filter(Number.isFinite)
                if (nums.length) {
                    numbers.push({
                        field,
                        answered: nums.length,
                        average: nums.reduce((s, n) => s + n, 0) / nums.length,
                        min: Math.min(...nums),
                        max: Math.max(...nums)
                    })
                }
                return
            }

            // Written feedback: long answers always; a short-answer question
            // only when people wrote sentences in it, so names, venues and
            // course titles don't drown the opinions in "neutral".
            if (field.type === 'textarea' || field.type === 'text') {
                const texts = values.map(v => String(v).trim())
                if (field.type === 'text' && texts.filter(t => wordCount(t) >= 5).length < Math.max(1, texts.length / 2)) {
                    return
                }
                const counts = emptySentiment()
                const examples: WrittenQuestion['examples'] = {}
                texts.forEach(text => {
                    const mood = sentimentOf(text)
                    if (!mood) return
                    counts[mood] += 1
                    // The longest of each is usually the most telling.
                    if (mood !== 'neutral' && (!examples[mood] || text.length > examples[mood]!.length)) {
                        examples[mood] = text
                    }
                })
                const answered = counts.positive + counts.neutral + counts.negative
                if (answered) writtenQuestions.push({ field, answered, sentiment: counts, examples })
            }
        })

    // Pooled figures for each kind present.
    const ratingAnswers = ratingQuestions.reduce((s, q) => s + q.answered, 0)
    const ratings = ratingAnswers
        ? {
            answers: ratingAnswers,
            average: ratingQuestions.reduce((s, q) => s + q.average * q.answered, 0) / ratingAnswers,
            satisfaction: Math.round(
                ratingQuestions.reduce((s, q) => s + (q.satisfaction / 100) * q.answered, 0) / ratingAnswers * 100
            ),
            questions: ratingQuestions
        }
        : null

    const yesTotal = yesNoQuestions.reduce((s, q) => s + q.yes, 0)
    const noTotal = yesNoQuestions.reduce((s, q) => s + q.no, 0)
    const goodTotal = yesNoQuestions.reduce((s, q) => s + (q.goodAnswer === 'yes' ? q.yes : q.no), 0)
    const yesNo = yesNoQuestions.length
        ? {
            rate: yesTotal + noTotal ? percent(yesTotal, yesTotal + noTotal) : null,
            favourable: yesTotal + noTotal ? percent(goodTotal, yesTotal + noTotal) : null,
            answers: yesTotal + noTotal,
            questions: yesNoQuestions
        }
        : null

    const pooled = emptySentiment()
    writtenQuestions.forEach(q => {
        pooled.positive += q.sentiment.positive
        pooled.neutral += q.sentiment.neutral
        pooled.negative += q.sentiment.negative
    })
    const written = writtenQuestions.length ? { sentiment: pooled, score: sentimentScore(pooled), questions: writtenQuestions } : null

    // What stands out.
    const highlights: SurveyProfile['highlights'] = []
    const rated = ratingQuestions.filter(q => q.answered >= 2)
    if (rated.length >= 2) {
        const best = rated.reduce((a, b) => (b.average > a.average ? b : a))
        const worst = rated.reduce((a, b) => (b.average < a.average ? b : a))
        if (best.average - worst.average >= 0.3) {
            highlights.push({ tone: 'bad', text: `Lowest rated: ${shortLabel(worst.field.label)} (${worst.average.toFixed(1)} / 5)` })
            highlights.push({ tone: 'good', text: `Highest rated: ${shortLabel(best.field.label)} (${best.average.toFixed(1)} / 5)` })
        }
    }
    // Judged by the good answer: 19% "yes" to "Any barriers?" is a good result.
    const weakest = yesNoQuestions
        .filter(q => q.favourable !== null && q.yes + q.no >= 2)
        .sort((a, b) => (a.favourable ?? 0) - (b.favourable ?? 0))[0]
    if (weakest && (weakest.favourable ?? 100) < 80) {
        highlights.push({
            tone: 'bad',
            text:
                weakest.goodAnswer === 'no'
                    ? `Most reported problem: ${shortLabel(weakest.field.label)} (${weakest.rate}% said yes)`
                    : `Fewest yeses: ${shortLabel(weakest.field.label)} (${weakest.rate}% yes)`
        })
    }
    const unanimous = yesNoQuestions.filter(q => q.favourable === 100 && q.yes + q.no >= 2).length
    if (unanimous) {
        highlights.push({
            tone: 'good',
            text: `${unanimous} Yes/No question${unanimous === 1 ? '' : 's'} where everyone gave the good answer`
        })
    }
    const sore = writtenQuestions
        .filter(q => q.sentiment.negative > 0)
        .sort((a, b) => b.sentiment.negative / b.answered - a.sentiment.negative / a.answered)[0]
    if (sore && sore.sentiment.negative / sore.answered >= 0.3) {
        highlights.push({
            tone: 'bad',
            text: `Most complaints: ${shortLabel(sore.field.label)} (${percent(sore.sentiment.negative, sore.answered)}% negative)`
        })
    }
    const status = sentStatusOf(survey)
    const awaiting = survey.total - survey.completed
    if (awaiting > 0 && status === 'pending') {
        const due = toDate(survey.dueDate)
        const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null
        highlights.push({
            tone: 'info',
            text: `${awaiting} still to respond${daysLeft !== null ? ` · due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : ''}`
        })
    } else if (awaiting > 0 && status === 'closed') {
        highlights.push({ tone: 'info', text: `${awaiting} never responded before it closed` })
    }

    return {
        survey,
        status,
        responses: survey.completed,
        total: survey.total,
        responseRate: responseRate(survey),
        awaiting,
        medianResponseMs: median(responseTimes(survey)),
        ratings,
        yesNo,
        choices,
        numbers,
        written,
        highlights
    }
}

// ─────────────────────────────────────────────────────────────
// Overview: response behaviour across surveys
// ─────────────────────────────────────────────────────────────

export type SurveysOverview = {
    sent: number
    responses: number
    total: number
    responseRate: number
    medianResponseMs: number | null
    awaiting: number
    /** Open surveys still collecting answers. */
    open: number
    /** Closed with people who never answered. */
    closedIncomplete: number
}

export const overviewOf = (surveys: SentSurvey[]): SurveysOverview => {
    const responses = surveys.reduce((s, x) => s + x.completed, 0)
    const total = surveys.reduce((s, x) => s + x.total, 0)
    return {
        sent: surveys.length,
        responses,
        total,
        responseRate: percent(responses, total),
        medianResponseMs: median(surveys.flatMap(responseTimes)),
        awaiting: surveys
            .filter(s => sentStatusOf(s) === 'pending')
            .reduce((sum, s) => sum + (s.total - s.completed), 0),
        open: surveys.filter(s => sentStatusOf(s) === 'pending').length,
        closedIncomplete: surveys.filter(s => sentStatusOf(s) === 'closed').length
    }
}

/** Per-survey response behaviour for the overview table (cheap; no answers read). */
export const surveyTiming = (survey: SentSurvey) => ({
    medianResponseMs: median(responseTimes(survey)),
    responseRate: responseRate(survey),
    status: sentStatusOf(survey),
    awaiting: survey.total - survey.completed
})
