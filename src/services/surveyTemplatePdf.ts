/**
 * Prints a survey the way the department's paper questionnaire looks: a
 * letterhead table (logo, title, document control, approvals) on every page,
 * grey-labelled info rows, a 1–5 rating grid with circles, numbered open
 * questions with answer lines, and a sign-off block.
 *
 * The look comes from the template's exportDesign (src/lib/surveyExportDesign.ts).
 * With answers it prints a completed response; without, a blank form.
 */
import jsPDF from 'jspdf'
import autoTable, { type CellHookData } from 'jspdf-autotable'
import { type SurveyExportDesign } from '@/lib/surveyExportDesign'

export type ExportField = {
    id?: string
    type: string
    label: string
    name?: string
    options?: string[] | null
    required?: boolean
    description?: string | null
}

export type SurveyPdfInput = {
    title: string
    description?: string
    fields: ExportField[]
    design?: SurveyExportDesign | null
    /** A response's answers (keyed by field id or name, or by position). */
    answers?: Record<string, any> | any[] | null
    /** Printed under the title on a completed response. */
    respondent?: string
    /** Who answered and when, written onto matching sign-off lines. */
    signer?: { name?: string; date?: string }
}

/** Which sign-off line takes the respondent's name or the submission date. */
const signOffValue = (label: string, signer?: SurveyPdfInput['signer']) => {
    if (!signer) return ''
    const text = label.toLowerCase()
    if (/\bdate\b/.test(text)) return signer.date || ''
    if (/(conducted|completed|evaluated|submitted|prepared)\s+by|^name\b|full name/.test(text)) return signer.name || ''
    return ''
}

// ---------------------------------------------------------------------------
// Page geometry (mm, A4 portrait)
// ---------------------------------------------------------------------------

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 18
const CONTENT_W = PAGE_W - MARGIN * 2
const HEADER_TOP = 10
const PAGE_BOTTOM = PAGE_H - 15
const PT = 0.3528 // mm per point
const BORDER = 0.2
const LABEL_FILL: [number, number, number] = [242, 242, 242]
const RULE: [number, number, number] = [200, 200, 200]
const BODY_SIZE = 10.5
/** The paper forms use roomy 1.4-ish line spacing. */
const BODY_FACTOR = 1.4

const lineHeight = (fontSize: number, factor = 1.2) => fontSize * PT * factor

// The standard PDF fonts only cover Windows-1252; anything else would print
// as garbage, so it is mapped to the nearest plain character.
const CP1252_EXTRA = new Set([
    0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014,
    0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030,
    0x2039, 0x203a, 0x20ac, 0x2122
])
const pdfText = (value: unknown): string =>
    Array.from(String(value ?? '').normalize('NFKC'))
        .map(ch => {
            const code = ch.codePointAt(0) || 0
            if (code === 0x2212) return '-'
            if (code === 10 || (code >= 32 && code <= 0xff) || CP1252_EXTRA.has(code)) return ch
            return ''
        })
        .join('')

type Segment = { text: string; bold?: boolean; italic?: boolean }
type RichLine = Segment[]

const setFont = (pdf: jsPDF, seg: { bold?: boolean; italic?: boolean }) =>
    pdf.setFont(
        'helvetica',
        seg.bold && seg.italic ? 'bolditalic' : seg.bold ? 'bold' : seg.italic ? 'italic' : 'normal'
    )

/** Word-wraps mixed bold/normal text to a width at the current font size. */
const wrapRich = (pdf: jsPDF, segments: Segment[], width: number): RichLine[] => {
    const lines: RichLine[] = [[]]
    let lineWidth = 0
    const push = (seg: Segment) => {
        const line = lines[lines.length - 1]
        const last = line[line.length - 1]
        if (last && last.bold === seg.bold && last.italic === seg.italic) last.text += seg.text
        else line.push({ ...seg })
    }
    segments.forEach(seg => {
        setFont(pdf, seg)
        pdfText(seg.text)
            .split(/(\n|\s+)/)
            .filter(part => part !== '')
            .forEach(part => {
                if (part === '\n') {
                    lines.push([])
                    lineWidth = 0
                    return
                }
                const isSpace = /^\s+$/.test(part)
                const partWidth = pdf.getTextWidth(isSpace ? ' ' : part)
                if (isSpace) {
                    if (lineWidth > 0) {
                        push({ ...seg, text: ' ' })
                        lineWidth += partWidth
                    }
                    return
                }
                if (lineWidth > 0 && lineWidth + partWidth > width) {
                    // Drop the trailing space before breaking.
                    const line = lines[lines.length - 1]
                    const last = line[line.length - 1]
                    if (last) last.text = last.text.replace(/\s+$/, '')
                    lines.push([])
                    lineWidth = 0
                }
                // A single word wider than the line is split by characters.
                if (partWidth > width) {
                    pdf.splitTextToSize(part, width).forEach((chunk: string, i: number, all: string[]) => {
                        push({ ...seg, text: chunk })
                        if (i < all.length - 1) lines.push([])
                    })
                    lineWidth = pdf.getTextWidth(lines[lines.length - 1].map(s => s.text).join(''))
                    return
                }
                push({ ...seg, text: part })
                lineWidth += partWidth
            })
    })
    return lines
}

const drawRich = (
    pdf: jsPDF,
    lines: RichLine[],
    x: number,
    y: number,
    fontSize: number,
    factor = BODY_FACTOR
) => {
    pdf.setFontSize(fontSize)
    const lh = lineHeight(fontSize, factor)
    lines.forEach((line, index) => {
        let cursor = x
        line.forEach(seg => {
            setFont(pdf, seg)
            pdf.text(seg.text, cursor, y + index * lh)
            cursor += pdf.getTextWidth(seg.text)
        })
    })
}

const plainLines = (pdf: jsPDF, text: string, width: number, fontSize: number, bold = false) => {
    pdf.setFontSize(fontSize)
    setFont(pdf, { bold })
    return pdf.splitTextToSize(pdfText(text), width) as string[]
}

/** "Accessibility & Location: The venue was…" → bold lead, normal rest. */
const labelSegments = (label: string, number?: number): Segment[] => {
    const prefix = number ? `${number}. ` : ''
    const colon = label.indexOf(':')
    if (colon > 0 && colon < 70 && colon < label.length - 1) {
        return [
            { text: `${prefix}${label.slice(0, colon + 1)}`, bold: true },
            { text: label.slice(colon + 1) }
        ]
    }
    return [
        ...(prefix ? [{ text: prefix, bold: true }] : []),
        { text: label }
    ]
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const answerOf = (answers: SurveyPdfInput['answers'], field: ExportField, index: number) => {
    if (!answers) return undefined
    if (Array.isArray(answers)) return answers[index]
    if (field.id && field.id in answers) return answers[field.id]
    if (field.name && field.name in answers) return answers[field.name]
    return undefined
}

const formatAnswer = (value: unknown): string => {
    if (value === undefined || value === null) return ''
    if (Array.isArray(value)) return value.map(formatAnswer).filter(Boolean).join(', ')
    if (typeof value === 'object') {
        const v = value as Record<string, any>
        if (typeof v.toDate === 'function') return v.toDate().toLocaleDateString('en-ZA')
        return String(v.name || v.fileName || v.label || v.url || '')
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    // Date pickers store ISO strings; print them the way the forms write dates.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
        const date = new Date(value)
        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        }
    }
    return String(value)
}

const sameChoice = (a: unknown, b: string) =>
    String(a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

const isNA = (value: string) => /^n\/?a$/i.test(value.trim())

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

type Block =
    | { kind: 'heading'; field: ExportField }
    | { kind: 'info'; fields: { field: ExportField; index: number }[] }
    | { kind: 'grid'; columns: string[]; rows: { field: ExportField; index: number }[] }
    | { kind: 'question'; field: ExportField; index: number }

const INFO_TYPES = new Set(['text', 'number', 'email', 'date'])

/** The columns of a rating-style question, or null if it isn't one. */
const scaleOf = (field: ExportField, design?: SurveyExportDesign | null): string[] | null => {
    if (field.type === 'rating') {
        const columns = ['1', '2', '3', '4', '5']
        return design?.includeNA ? [...columns, 'N/A'] : columns
    }
    if (['radio', 'select'].includes(field.type)) {
        const options = (field.options || []).filter(Boolean)
        if (options.length >= 3 && options.length <= 8 && options.every(o => /^(\d{1,2}|n\/?a)$/i.test(o.trim()))) {
            return options.map(o => (isNA(o) ? 'N/A' : o.trim()))
        }
    }
    return null
}

/** Loose match between a question and a sign-off line ("Date:" == "date"). */
const labelKey = (label: string) =>
    String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const toBlocks = (
    fields: ExportField[],
    design?: SurveyExportDesign | null,
    /** Field positions printed elsewhere (on the sign-off lines). */
    skip: Set<number> = new Set()
): Block[] => {
    const blocks: Block[] = []
    fields.forEach((field, index) => {
        if (skip.has(index)) return
        const last = blocks[blocks.length - 1]
        if (field.type === 'heading') {
            blocks.push({ kind: 'heading', field })
            return
        }
        const scale = scaleOf(field, design)
        if (scale) {
            if (last?.kind === 'grid' && last.columns.join('|') === scale.join('|')) {
                last.rows.push({ field, index })
            } else {
                blocks.push({ kind: 'grid', columns: scale, rows: [{ field, index }] })
            }
            return
        }
        if (INFO_TYPES.has(field.type)) {
            if (last?.kind === 'info') last.fields.push({ field, index })
            else blocks.push({ kind: 'info', fields: [{ field, index }] })
            return
        }
        blocks.push({ kind: 'question', field, index })
    })
    return blocks
}

// ---------------------------------------------------------------------------
// Letterhead
// ---------------------------------------------------------------------------

type Header = { height: number; draw: (pdf: jsPDF) => void }

const layoutHeader = (pdf: jsPDF, title: string, design?: SurveyExportDesign | null): Header => {
    const x0 = MARGIN
    const y0 = HEADER_TOP
    const logo = design?.logoDataUrl
    const docControl = design?.docControl || []
    const approvals = design?.approvals || []

    const logoW = logo ? 37 : 0
    const gridLabelW = 22
    const gridValueW = 24
    const gridW = docControl.length ? gridLabelW + gridValueW : 0
    const titleW = CONTENT_W - logoW - gridW
    const small = 7
    const smallLh = lineHeight(small, 1.15)
    const pad = 1.5

    const gridRows = docControl.map(pair => {
        const label = plainLines(pdf, `${pair.label}:`, gridLabelW - pad * 2, small, true)
        const value = plainLines(pdf, pair.value, gridValueW - pad * 2, small)
        return { label, value, height: Math.max(5, Math.max(label.length, value.length) * smallLh + 2.4) }
    })
    const titleSize = 13
    const titleLines = plainLines(pdf, title.toUpperCase(), titleW - 8, titleSize, true)
    const titleH = titleLines.length * lineHeight(titleSize) + 8
    const gridH = gridRows.reduce((sum, row) => sum + row.height, 0)
    const topH = Math.max(gridH, titleH, logo ? 22 : 0)
    // Stretch the grid to the band so its last line meets the title cell's.
    if (gridRows.length && gridH < topH) {
        const extra = (topH - gridH) / gridRows.length
        gridRows.forEach(row => (row.height += extra))
    }

    const bandX = x0 + logoW
    const bandW = CONTENT_W - logoW
    const pairW = approvals.length ? bandW / approvals.length : 0
    const bandLabelW = Math.min(24, pairW * 0.38)
    const bandCells = approvals.map(pair => ({
        label: plainLines(pdf, `${pair.label}:`, bandLabelW - pad * 2, small, true),
        value: plainLines(pdf, pair.value, pairW - bandLabelW - pad * 2, small)
    }))
    const bandH = approvals.length
        ? Math.max(8, Math.max(...bandCells.map(c => Math.max(c.label.length, c.value.length))) * smallLh + 3)
        : 0
    const height = topH + bandH

    const draw = (doc: jsPDF) => {
        doc.setDrawColor(0)
        doc.setTextColor(0)
        doc.setLineWidth(BORDER)
        doc.rect(x0, y0, CONTENT_W, height)

        if (logo) {
            doc.line(x0 + logoW, y0, x0 + logoW, y0 + height)
            try {
                const props = doc.getImageProperties(logo)
                const boxW = logoW - 4
                const boxH = height - 4
                const scale = Math.min(boxW / props.width, boxH / props.height)
                const w = props.width * scale
                const h = props.height * scale
                doc.addImage(logo, props.fileType || 'PNG', x0 + (logoW - w) / 2, y0 + (height - h) / 2, w, h)
            } catch (error) {
                console.warn('Could not draw the logo', error)
            }
        }

        // Title cell, centred.
        const titleX = x0 + logoW
        doc.setFontSize(titleSize)
        setFont(doc, { bold: true })
        const titleBlockH = titleLines.length * lineHeight(titleSize)
        const titleTop = y0 + (topH - titleBlockH) / 2 + titleSize * PT * 0.85
        titleLines.forEach((line, i) =>
            doc.text(line, titleX + titleW / 2, titleTop + i * lineHeight(titleSize), { align: 'center' })
        )

        // Document control grid.
        if (gridRows.length) {
            const gx = titleX + titleW
            doc.line(gx, y0, gx, y0 + topH)
            doc.line(gx + gridLabelW, y0, gx + gridLabelW, y0 + topH)
            let gy = y0
            gridRows.forEach((row, i) => {
                const textY = gy + pad + small * PT * 0.85 + 0.4
                doc.setFontSize(small)
                setFont(doc, { bold: true })
                doc.text(row.label, gx + pad, textY, { lineHeightFactor: 1.15 })
                setFont(doc, {})
                doc.text(row.value, gx + gridLabelW + pad, textY, { lineHeightFactor: 1.15 })
                gy += row.height
                if (i < gridRows.length - 1) doc.line(gx, gy, gx + gridW, gy)
            })
        }

        // Approvals band.
        if (approvals.length) {
            const by = y0 + topH
            doc.line(bandX, by, x0 + CONTENT_W, by)
            bandCells.forEach((cell, i) => {
                const cx = bandX + i * pairW
                if (i > 0) doc.line(cx, by, cx, by + bandH)
                doc.line(cx + bandLabelW, by, cx + bandLabelW, by + bandH)
                const textY = by + pad + small * PT * 0.85 + 0.4
                doc.setFontSize(small)
                setFont(doc, { bold: true })
                doc.text(cell.label, cx + pad, textY, { lineHeightFactor: 1.15 })
                setFont(doc, {})
                doc.text(cell.value, cx + bandLabelW + pad, textY, { lineHeightFactor: 1.15 })
            })
        }
    }

    return { height, draw }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function buildSurveyPdf(input: SurveyPdfInput): jsPDF {
    const pdf = new jsPDF('p', 'mm', 'a4')
    const design = input.design || null
    const title = (design?.headerTitle || input.title || 'Survey').trim()
    const header = layoutHeader(pdf, title, design)
    const bodyTop = HEADER_TOP + header.height + 8
    const filled = !!input.answers
    let y = bodyTop
    let number = 0

    pdf.setTextColor(0)
    pdf.setDrawColor(0)
    pdf.setLineWidth(BORDER)

    const ensure = (needed: number) => {
        if (y + needed > PAGE_BOTTOM) {
            pdf.addPage()
            y = bodyTop
        }
    }

    const paragraph = (text: string, opts: { size?: number; bold?: boolean; italic?: boolean; gap?: number } = {}) => {
        const size = opts.size ?? BODY_SIZE
        pdf.setFontSize(size)
        const lines = wrapRich(pdf, [{ text, bold: opts.bold, italic: opts.italic }], CONTENT_W)
        const lh = lineHeight(size, BODY_FACTOR)
        lines.forEach(line => {
            ensure(lh)
            drawRich(pdf, [line], MARGIN, y + size * PT * 0.85, size)
            y += lh
        })
        y += opts.gap ?? 3
    }

    // Title and introduction, as the form opens.
    paragraph((input.title || title).toUpperCase(), { size: 11.5, bold: true, gap: 4 })
    if (input.respondent) paragraph(`Respondent: ${input.respondent}`, { size: 9.5, italic: true, gap: 3 })
    if (input.description?.trim()) paragraph(input.description.trim(), { gap: 5 })

    const tableBase = {
        theme: 'grid' as const,
        margin: { left: MARGIN, right: MARGIN, top: bodyTop, bottom: PAGE_H - PAGE_BOTTOM },
        rowPageBreak: 'avoid' as const,
        styles: {
            font: 'helvetica',
            fontSize: BODY_SIZE,
            textColor: 0 as const,
            lineColor: 0 as const,
            lineWidth: BORDER,
            cellPadding: 2,
            valign: 'middle' as const,
            overflow: 'linebreak' as const
        }
    }

    let legendPrinted = false
    // A question named like a sign-off line ("Designation") is answered on
    // that line at the end, not printed again in the body.
    const signOffKeys = new Set((design?.signOff || []).map(labelKey))
    const signOffFields = new Map<string, { field: ExportField; index: number }>()
    input.fields.forEach((field, index) => {
        const key = labelKey(field.label)
        if (field.type !== 'heading' && signOffKeys.has(key) && !signOffFields.has(key)) {
            signOffFields.set(key, { field, index })
        }
    })
    const blocks = toBlocks(
        input.fields,
        design,
        new Set(Array.from(signOffFields.values()).map(entry => entry.index))
    )

    blocks.forEach((block, blockIndex) => {
        if (block.kind === 'heading') {
            // A heading right before info rows becomes the table's first row,
            // the way the paper forms title their "General Information" box.
            if (blocks[blockIndex + 1]?.kind === 'info' && !block.field.description) return
            ensure(16)
            y += 3
            paragraph(block.field.label, { size: BODY_SIZE, bold: true, gap: 3 })
            if (block.field.description) paragraph(block.field.description, { size: 9.5, italic: true, gap: 3 })
            return
        }

        if (block.kind === 'info') {
            const previous = blocks[blockIndex - 1]
            const title =
                previous?.kind === 'heading' && !previous.field.description ? previous.field.label : null
            autoTable(pdf, {
                ...tableBase,
                startY: y,
                body: [
                    ...(title ? [[pdfText(title), '']] : []),
                    ...block.fields.map(({ field, index }) => [
                        pdfText(field.label),
                        pdfText(formatAnswer(answerOf(input.answers, field, index)))
                    ])
                ],
                columnStyles: {
                    0: { cellWidth: CONTENT_W * 0.33, fillColor: LABEL_FILL, fontStyle: 'bold' },
                    1: { cellWidth: 'auto' }
                },
                bodyStyles: { minCellHeight: 7.3 }
            })
            y = (pdf as any).lastAutoTable.finalY + 8
            return
        }

        if (block.kind === 'grid') {
            if (!legendPrinted && design?.ratingLegend.length) {
                legendPrinted = true
                ensure(12 + design.ratingLegend.length * lineHeight(BODY_SIZE, 1.55))
                if (design.ratingIntro) paragraph(design.ratingIntro, { italic: true, gap: 1.5 })
                design.ratingLegend.forEach(item => {
                    pdf.setFontSize(BODY_SIZE)
                    setFont(pdf, {})
                    pdf.text('•', MARGIN + 6, y + BODY_SIZE * PT * 0.85)
                    setFont(pdf, { bold: true })
                    pdf.text(pdfText(item), MARGIN + 12, y + BODY_SIZE * PT * 0.85)
                    y += lineHeight(BODY_SIZE, 1.55)
                })
                y += 4
            }

            // Narrow circle columns; "N/A" needs a little more room.
            const columnW = block.columns.map(c => (c.length > 2 ? 10 : 7))
            const labelW = CONTENT_W - columnW.reduce((sum, w) => sum + w, 0)
            const numbers = block.rows.map(() => ++number)
            const richByRow = new Map<number, RichLine[]>()
            const answersByRow = block.rows.map(({ field, index }) => answerOf(input.answers, field, index))
            const rule = { top: 0, right: 0, bottom: BORDER, left: 0 }

            autoTable(pdf, {
                ...tableBase,
                // No grid: the paper form only rules between rows.
                theme: 'plain',
                startY: y,
                head: [[pdfText(design?.ratingColumnTitle || 'Evaluation Criterion'), ...block.columns]],
                body: block.rows.map(({ field }, i) => [
                    `${numbers[i]}. ${pdfText(field.label)}`,
                    ...block.columns.map(() => '')
                ]),
                styles: {
                    ...tableBase.styles,
                    lineColor: RULE,
                    lineWidth: rule,
                    cellPadding: { top: 2.2, bottom: 2.2, left: 1, right: 1 }
                },
                headStyles: { fontStyle: 'bold', halign: 'center' },
                columnStyles: Object.fromEntries([
                    [0, { cellWidth: labelW }],
                    ...columnW.map((w, i) => [i + 1, { cellWidth: w, halign: 'center' as const }])
                ]),
                didParseCell: (data: CellHookData) => {
                    if (data.column.index === 0) data.cell.styles.halign = 'left'
                    if (data.section !== 'body' || data.column.index !== 0) return
                    const row = block.rows[data.row.index]
                    pdf.setFontSize(BODY_SIZE)
                    const lines = wrapRich(pdf, labelSegments(row.field.label, numbers[data.row.index]), labelW - 4)
                    richByRow.set(data.row.index, lines)
                    data.cell.text = lines.map(line => line.map(s => s.text).join(''))
                    // Our own line spacing is roomier than autoTable's.
                    data.cell.styles.minCellHeight = lines.length * lineHeight(BODY_SIZE, BODY_FACTOR) + 4.4
                },
                willDrawCell: (data: CellHookData) => {
                    if (data.section === 'body' && data.column.index === 0) data.cell.text = []
                },
                didDrawCell: (data: CellHookData) => {
                    if (data.section !== 'body') return
                    const { cell } = data
                    if (data.column.index === 0) {
                        const lines = richByRow.get(data.row.index) || []
                        const lh = lineHeight(BODY_SIZE, BODY_FACTOR)
                        const top = cell.y + (cell.height - lines.length * lh) / 2 + BODY_SIZE * PT * 0.85
                        pdf.setTextColor(0)
                        drawRich(pdf, lines, cell.x + 1, top, BODY_SIZE)
                        return
                    }
                    const column = block.columns[data.column.index - 1]
                    const answer = answersByRow[data.row.index]
                    const cx = cell.x + cell.width / 2
                    const cy = cell.y + cell.height / 2
                    pdf.setDrawColor(0)
                    pdf.setLineWidth(0.25)
                    pdf.circle(cx, cy, 1.4, 'S')
                    const chosen =
                        filled &&
                        (sameChoice(answer, column) ||
                            (isNA(column) && typeof answer === 'string' && isNA(answer)))
                    if (chosen) {
                        pdf.setFillColor(0, 0, 0)
                        pdf.circle(cx, cy, 0.9, 'F')
                    }
                }
            })
            y = (pdf as any).lastAutoTable.finalY
            // The forms close the grid with a heavier grey rule.
            pdf.setDrawColor(150)
            pdf.setLineWidth(0.5)
            pdf.line(MARGIN, y, MARGIN + CONTENT_W, y)
            pdf.setDrawColor(0)
            y += 8
            return
        }

        // A numbered question: number, bold question, then an "o" answer line.
        const { field, index } = block
        number += 1
        const answer = answerOf(input.answers, field, index)
        const lh = lineHeight(BODY_SIZE, BODY_FACTOR)
        const numberX = MARGIN + 4
        const labelX = MARGIN + 11
        const bulletX = MARGIN + 18
        const textX = MARGIN + 24
        const textW = MARGIN + CONTENT_W - textX
        pdf.setFontSize(BODY_SIZE)
        const labelLines = wrapRich(pdf, [{ text: field.label, bold: true }], MARGIN + CONTENT_W - labelX)
        const options = (field.options || []).filter(Boolean)
        const isChoice = ['radio', 'select', 'checkbox'].includes(field.type) && options.length > 0
        const answerText = formatAnswer(answer)

        // Keep the question with at least the start of its answer.
        ensure(labelLines.length * lh + 10)
        pdf.setFontSize(BODY_SIZE)
        setFont(pdf, {})
        pdf.text(`${number}.`, numberX, y + BODY_SIZE * PT * 0.85)
        drawRich(pdf, labelLines, labelX, y + BODY_SIZE * PT * 0.85, BODY_SIZE)
        y += labelLines.length * lh
        if (field.description) {
            pdf.setFontSize(9)
            const lines = wrapRich(pdf, [{ text: field.description, italic: true }], MARGIN + CONTENT_W - labelX)
            drawRich(pdf, lines, labelX, y + 9 * PT * 0.85, 9)
            y += lines.length * lineHeight(9, BODY_FACTOR)
        }
        y += 1

        if (isChoice) {
            const selected = Array.isArray(answer) ? answer : answer !== undefined ? [answer] : []
            const square = field.type === 'checkbox'
            let x = bulletX
            ensure(7)
            options.forEach(option => {
                pdf.setFontSize(BODY_SIZE)
                setFont(pdf, {})
                const text = pdfText(option)
                const w = 5 + pdf.getTextWidth(text) + 7
                if (x + w > MARGIN + CONTENT_W && x > bulletX) {
                    x = bulletX
                    y += 6.5
                    ensure(7)
                }
                const cy = y + 2.4
                pdf.setDrawColor(0)
                pdf.setLineWidth(0.25)
                if (square) pdf.rect(x, cy - 1.4, 2.8, 2.8, 'S')
                else pdf.circle(x + 1.4, cy, 1.4, 'S')
                if (filled && selected.some(s => sameChoice(s, option))) {
                    pdf.setFillColor(0, 0, 0)
                    if (square) pdf.rect(x + 0.6, cy - 0.8, 1.6, 1.6, 'F')
                    else pdf.circle(x + 1.4, cy, 0.9, 'F')
                }
                pdf.text(text, x + 4.6, cy + BODY_SIZE * PT * 0.32)
                x += w
            })
            y += 9
            return
        }

        if (filled && answerText) {
            const lines = plainLines(pdf, answerText, textW, BODY_SIZE)
            ensure(Math.min(lines.length, 3) * lh + 2)
            setFont(pdf, {})
            pdf.text('o', bulletX, y + BODY_SIZE * PT * 0.85)
            lines.forEach(line => {
                ensure(lh)
                pdf.text(line, textX, y + BODY_SIZE * PT * 0.85)
                y += lh
            })
            y += 3
            return
        }

        // Unanswered: one ruled line, as on the paper form.
        ensure(8)
        pdf.setFontSize(BODY_SIZE)
        setFont(pdf, {})
        pdf.text('o', bulletX, y + 4)
        pdf.setDrawColor(0)
        pdf.setLineWidth(0.2)
        pdf.line(textX, y + 4.4, MARGIN + CONTENT_W - 2, y + 4.4)
        y += 7
        if (field.type === 'file') {
            pdf.setFontSize(8.5)
            setFont(pdf, { italic: true })
            pdf.text('Attach supporting documents separately.', textX, y + 1)
            y += 4
        }
        y += 2
    })

    // Sign-off block.
    const signOff = design?.signOff || []
    if (signOff.length) {
        const rowH = 11
        ensure(signOff.length * rowH + 8)
        y += 6
        signOff.forEach(label => {
            pdf.setFontSize(BODY_SIZE + 1)
            setFont(pdf, {})
            const text = `${pdfText(label)}:`
            const baseline = y + 5
            pdf.text(text, MARGIN, baseline)
            const start = MARGIN + pdf.getTextWidth(text) + 3
            // The respondent's own answer wins; otherwise their name / the
            // submission date where the line asks for it.
            const matched = signOffFields.get(labelKey(label))
            const answered = matched
                ? formatAnswer(answerOf(input.answers, matched.field, matched.index)).trim()
                : ''
            const value = answered || signOffValue(label, input.signer)
            if (value) pdf.text(pdfText(value), start + 2, baseline - 0.6)
            pdf.setLineWidth(0.2)
            pdf.line(start, baseline + 0.6, Math.max(start + 50, MARGIN + CONTENT_W * 0.8), baseline + 0.6)
            y += rowH
        })
    }

    // Letterhead on every page, drawn last so tables that broke across pages
    // get it too.
    const pages = pdf.getNumberOfPages()
    for (let page = 1; page <= pages; page++) {
        pdf.setPage(page)
        header.draw(pdf)
    }

    return pdf
}

export const surveyPdfFileName = (title: string, suffix?: string) =>
    `${[title || 'Survey', suffix].filter(Boolean).join(' - ')}.pdf`.replace(/[\\/:*?"<>|]+/g, '-')

export function downloadSurveyPdf(input: SurveyPdfInput, fileName?: string) {
    const pdf = buildSurveyPdf(input)
    pdf.save(fileName || surveyPdfFileName(input.design?.headerTitle || input.title))
}

/** Every response as its own PDF, in one zip. */
export async function downloadSurveyPdfZip(
    items: { input: SurveyPdfInput; fileName: string }[],
    zipName: string
) {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const used = new Map<string, number>()
    items.forEach(({ input, fileName }) => {
        // Two SMEs from one company must not overwrite each other.
        const count = used.get(fileName) || 0
        used.set(fileName, count + 1)
        const name = count ? fileName.replace(/\.pdf$/i, ` (${count + 1}).pdf`) : fileName
        zip.file(name, buildSurveyPdf(input).output('arraybuffer'))
    })
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = zipName.replace(/[\\/:*?"<>|]+/g, '-')
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Opens the PDF in a new tab instead of downloading it. */
export function previewSurveyPdf(input: SurveyPdfInput) {
    const pdf = buildSurveyPdf(input)
    const url = pdf.output('bloburl')
    window.open(String(url), '_blank', 'noopener')
}
