/**
 * The printed look of a survey: the letterhead, rating legend and sign-off
 * lines that a department's own questionnaire uses (QMS forms and the like).
 *
 * It is stored on the template (`formTemplates/{id}.exportDesign`) and read by
 * src/services/surveyTemplatePdf.ts. It is usually filled by uploading the
 * paper version of the form (src/services/surveyTemplateImport.ts), then
 * corrected by hand in the builder's Export design window.
 */

export type DesignPair = { label: string; value: string }

export type SurveyExportDesign = {
    /** The file the design was read from, for display only. */
    sourceFileName?: string
    /** Data URL (PNG or JPEG), kept small; see MAX_LOGO_DIMENSION. */
    logoDataUrl?: string
    /** Title in the letterhead; the survey title when blank. */
    headerTitle?: string
    /** The small label/value grid beside the title (Doc Ref. No., Issue No., …). */
    docControl: DesignPair[]
    /** The band under the title (Author By, Approved By, …). */
    approvals: DesignPair[]
    /** Line above the rating legend ("Please rate … on a scale of 1 to 5, where:"). */
    ratingIntro?: string
    /** One entry per scale point, e.g. "1 = Strongly Disagree / Poor". */
    ratingLegend: string[]
    /** First column heading of the rating grid. */
    ratingColumnTitle?: string
    /** Adds an N/A column to the rating grid. */
    includeNA: boolean
    /** Lines printed at the end for a signature ("Evaluation conducted by", "Date", …). */
    signOff: string[]
}

export const MAX_LOGO_DIMENSION = 600

export const emptyExportDesign = (): SurveyExportDesign => ({
    docControl: [],
    approvals: [],
    ratingLegend: [],
    includeNA: false,
    signOff: []
})

const cleanPairs = (pairs: unknown): DesignPair[] =>
    Array.isArray(pairs)
        ? pairs
            .map(pair => ({
                label: String((pair as any)?.label ?? '').trim(),
                value: String((pair as any)?.value ?? '').trim()
            }))
            .filter(pair => pair.label || pair.value)
        : []

const cleanLines = (lines: unknown): string[] =>
    Array.isArray(lines) ? lines.map(line => String(line ?? '').trim()).filter(Boolean) : []

/** Reads whatever is stored (or typed) into a complete design. */
export const normalizeExportDesign = (raw: unknown): SurveyExportDesign | undefined => {
    if (!raw || typeof raw !== 'object') return undefined
    const value = raw as Record<string, unknown>
    const design: SurveyExportDesign = {
        sourceFileName: String(value.sourceFileName || '').trim() || undefined,
        logoDataUrl:
            typeof value.logoDataUrl === 'string' && value.logoDataUrl.startsWith('data:image/')
                ? value.logoDataUrl
                : undefined,
        headerTitle: String(value.headerTitle || '').trim() || undefined,
        docControl: cleanPairs(value.docControl),
        approvals: cleanPairs(value.approvals),
        ratingIntro: String(value.ratingIntro || '').trim() || undefined,
        ratingLegend: cleanLines(value.ratingLegend),
        ratingColumnTitle: String(value.ratingColumnTitle || '').trim() || undefined,
        includeNA: value.includeNA === true,
        signOff: cleanLines(value.signOff)
    }
    return design
}

/** True when the design adds anything to a plain export. */
export const hasExportDesign = (design?: SurveyExportDesign | null) =>
    !!design &&
    !!(
        design.logoDataUrl ||
        design.headerTitle ||
        design.docControl.length ||
        design.approvals.length ||
        design.ratingLegend.length ||
        design.signOff.length ||
        design.includeNA
    )

// ---------------------------------------------------------------------------
// Reading a design out of a PDF's positioned text
// ---------------------------------------------------------------------------

/** One run of text as pdf.js reports it, in PDF points (y grows upwards). */
export type PdfToken = {
    str: string
    x: number
    y: number
    width: number
    height: number
}

export type PdfPageTokens = {
    width: number
    height: number
    tokens: PdfToken[]
}

/** A label ends in a colon: "Doc Ref. No.:", "Approved By:". */
const LABEL_RE = /^[^:_]{2,40}:$/
const SIGN_OFF_RE = /^([^_:]{2,60}?)\s*:?\s*_{3,}[\s_]*$/
const LEGEND_RE = /^(?:[•\-–o▪●]\s*)?(\d{1,2})\s*[=:\-–]\s*(.{2,80})$/
const WHITESPACE_RE = /\s+/g

const squash = (text: string) => text.replace(WHITESPACE_RE, ' ').trim()

/**
 * Joins runs that sit on the same baseline and touch, the way pdf.js splits a
 * word at a kerning change ("January 202" + "6"). Runs in separate table cells
 * stay apart because of the gap between them.
 */
export const mergeTokens = (tokens: PdfToken[]): PdfToken[] => {
    const sorted = tokens
        .filter(token => token.str.trim())
        .slice()
        .sort((a, b) => b.y - a.y || a.x - b.x)
    const merged: PdfToken[] = []
    for (const token of sorted) {
        const last = merged[merged.length - 1]
        const sameLine = last && Math.abs(last.y - token.y) < Math.max(1.5, token.height * 0.2)
        const gap = last ? token.x - (last.x + last.width) : Infinity
        if (last && sameLine && gap > -1 && gap < token.height * 0.6) {
            const joiner = gap < token.height * 0.12 || last.str.endsWith(' ') || token.str.startsWith(' ') ? '' : ' '
            last.str = `${last.str}${joiner}${token.str}`
            last.width = token.x + token.width - last.x
            last.height = Math.max(last.height, token.height)
        } else {
            merged.push({ ...token })
        }
    }
    return merged.map(token => ({ ...token, str: squash(token.str) }))
}

/** Groups merged runs into reading lines (top to bottom). */
const toLines = (tokens: PdfToken[]) => {
    const lines: { y: number; tokens: PdfToken[] }[] = []
    for (const token of tokens.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
        const line = lines.find(l => Math.abs(l.y - token.y) < Math.max(2, token.height * 0.35))
        if (line) line.tokens.push(token)
        else lines.push({ y: token.y, tokens: [token] })
    }
    lines.forEach(line => line.tokens.sort((a, b) => a.x - b.x))
    return lines.sort((a, b) => b.y - a.y)
}

const tokenKey = (token: PdfToken) =>
    `${squash(token.str)}@${Math.round(token.x / 2)}@${Math.round(token.y / 2)}`

/**
 * The letterhead: text repeated in the same place on every page. A one-page
 * form has nothing to compare against, so its top band (above the first body
 * text) stands in.
 */
const headerTokensOf = (pages: PdfPageTokens[]): PdfToken[] => {
    const first = pages[0]
    if (!first) return []
    if (pages.length > 1) {
        const keySets = pages.slice(1).map(page => new Set(page.tokens.map(tokenKey)))
        const repeated = first.tokens.filter(token => keySets.every(set => set.has(tokenKey(token))))
        // Page furniture that isn't a letterhead (a footer, a page number)
        // sits low on the page; only the top half counts.
        return repeated.filter(token => token.y > first.height * 0.5)
    }
    return first.tokens.filter(token => token.y > first.height * 0.8)
}

const pairsFrom = (labels: PdfToken[], all: PdfToken[]): DesignPair[] => {
    return labels.map(label => {
        // The next label on the same line bounds this one's value on the right.
        const nextOnLine = labels
            .filter(other => other !== label && Math.abs(other.y - label.y) < 2 && other.x > label.x)
            .sort((a, b) => a.x - b.x)[0]
        const rightEdge = nextOnLine ? nextOnLine.x - 1 : Infinity
        const sameLine = all.filter(
            token =>
                !labels.includes(token) &&
                Math.abs(token.y - label.y) < 2 &&
                token.x > label.x + label.width - 1 &&
                token.x < rightEdge
        )
        if (!sameLine.length) return { label: label.str.replace(/:$/, '').trim(), value: '' }

        // Wrapped value: lines below starting at the same x, until the next
        // label in that column.
        const startX = sameLine[0].x
        const labelBelow = labels
            .filter(other => other.y < label.y - 2 && other.x <= startX + 2 && other.x + other.width >= label.x - 2)
            .sort((a, b) => b.y - a.y)[0]
        const floor = labelBelow ? labelBelow.y + 1 : label.y - label.height * 5
        const continuation = all
            .filter(
                token =>
                    !labels.includes(token) &&
                    token.y < label.y - 2 &&
                    token.y > floor &&
                    Math.abs(token.x - startX) < 3
            )
            .sort((a, b) => b.y - a.y)
        // Stop at the first gap bigger than a line and a half.
        const kept: PdfToken[] = []
        let lastY = label.y
        for (const token of continuation) {
            if (lastY - token.y > token.height * 2.2) break
            kept.push(token)
            lastY = token.y
        }
        const firstLine = sameLine.map(t => t.str).join(' ')
        return {
            label: label.str.replace(/:$/, '').trim(),
            value: [firstLine, ...kept.map(t => t.str)].join('\n').trim()
        }
    })
}

/**
 * Reads the printed design out of a questionnaire PDF. Every field is a best
 * guess the user can correct; nothing here is required to be found.
 */
export const designFromPdfPages = (pages: PdfPageTokens[]): SurveyExportDesign => {
    const design = emptyExportDesign()
    if (!pages.length) return design

    const merged = pages.map(page => ({ ...page, tokens: mergeTokens(page.tokens) }))
    const header = headerTokensOf(merged)
    const headerKeys = new Set(header.map(tokenKey))

    if (header.length) {
        const heights = header.map(t => t.height).sort((a, b) => a - b)
        const median = heights[Math.floor(heights.length / 2)]
        const titleTokens = header
            .filter(t => t.height >= median * 1.3 && !LABEL_RE.test(t.str))
            .sort((a, b) => b.y - a.y || a.x - b.x)
        design.headerTitle = squash(titleTokens.map(t => t.str).join(' ')) || undefined

        const labels = header.filter(t => LABEL_RE.test(t.str))
        // Some exports keep "Doc Ref: QMS" as one run.
        if (!labels.length) {
            header.forEach(token => {
                const match = token.str.match(/^([^:]{2,40}):\s+(.+)$/)
                if (match && !titleTokens.includes(token)) {
                    design.docControl.push({ label: match[1].trim(), value: match[2].trim() })
                }
            })
        }
        const pairs = pairsFrom(labels, header)
        // Labels beside the title are document control; labels below the
        // title's last line form the approvals band.
        const titleBottom = titleTokens.length ? Math.min(...titleTokens.map(t => t.y)) : -Infinity
        labels.forEach((label, index) => {
            const target = label.y < titleBottom - 4 ? design.approvals : design.docControl
            target.push(pairs[index])
        })
    }

    // Body text: everything that isn't letterhead, page by page, as lines.
    const bodyLines = merged.flatMap(page =>
        toLines(page.tokens.filter(token => !headerKeys.has(tokenKey(token)))).map(line =>
            squash(line.tokens.map(t => t.str).join(' '))
        )
    )

    bodyLines.forEach((line, index) => {
        const legend = line.match(LEGEND_RE)
        if (legend && !/_{3,}/.test(line)) {
            const expected = design.ratingLegend.length + 1
            if (Number(legend[1]) === expected || (expected === 1 && Number(legend[1]) <= 1)) {
                if (!design.ratingLegend.length) {
                    const previous = bodyLines[index - 1]
                    if (previous && /:\s*$/.test(previous)) design.ratingIntro = previous
                }
                design.ratingLegend.push(`${legend[1]} = ${legend[2].trim()}`)
            }
            return
        }

        // The rating grid's heading row: "Evaluation Criterion 1 2 3 4 5 N/A".
        const gridHead = line.match(/^(.*?)\s+1\s+2\s+3(?:\s+\d+)*(\s+N\/?A)?\s*$/i)
        if (gridHead) {
            if (gridHead[1].trim()) design.ratingColumnTitle ||= gridHead[1].trim()
            if (gridHead[2]) design.includeNA = true
            return
        }

        const signOff = line.match(SIGN_OFF_RE)
        if (signOff) {
            const label = signOff[1].trim()
            // "o ____" answer lines under open questions have no label.
            if (label.length > 1 && !/^[o•\-–\d.)\s]+$/.test(label)) {
                design.signOff.push(label.replace(/:$/, ''))
            }
        }
    })

    return design
}

/**
 * Sign-off lines are printed by the design, so the same lines imported as
 * questions would appear twice. Matches a question to a sign-off label.
 */
export const isSignOffLabel = (design: SurveyExportDesign | undefined, label: string) => {
    if (!design?.signOff.length) return false
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const target = norm(label)
    return design.signOff.some(line => norm(line) === target)
}
