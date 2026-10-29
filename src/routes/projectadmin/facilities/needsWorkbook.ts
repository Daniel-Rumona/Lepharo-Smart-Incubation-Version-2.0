/**
 * Reading a centre's needs assessment list from Excel.
 *
 * The lists centres keep look like the one in the monthly executive report:
 * a title row or two, then Quantity / Needs identified / Product / Price.
 * A category ("MACHINERY SYSTEM", "OFFICE FURNITURE") is written once in the
 * needs column and the products under it leave that cell blank, so the last
 * need seen carries down. Prices come as "R198 900,00", "R6000.00", "R80 000".
 *
 * No Firebase here, so it can be tested against real files outside the app.
 */
import * as XLSX from 'xlsx'

export type ParsedNeed = {
    row: number
    quantity: number
    need: string
    product: string
    price: number | null
    notes: string
}

export type NeedsParseResult = {
    needs: ParsedNeed[]
    sheetName: string
    headerRow: number
    warnings: string[]
}

type ColumnKey = 'quantity' | 'need' | 'product' | 'price' | 'notes'

const HEADER_PATTERNS: Record<ColumnKey, RegExp> = {
    quantity: /^(qty|quantity|no\.?\s*of\s*units|units)\b/i,
    need: /(needs?\s*identified|^needs?$|category|need\s*area)/i,
    product: /(product|item|description|equipment)/i,
    price: /(price|cost|amount|value|budget)/i,
    notes: /(note|comment|remark)/i
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

/** "R198 900,00" -> 198900, "R6000.00" -> 6000, "R1200, 00" -> 1200. */
export const parseRand = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const raw = String(value ?? '').replace(/[^\d.,]/g, '')
    if (!/\d/.test(raw)) return null
    const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'))
    const hasDecimals = lastSep >= 0 && raw.length - lastSep - 1 === 2
    const whole = (hasDecimals ? raw.slice(0, lastSep) : raw).replace(/[.,]/g, '')
    const cents = hasDecimals ? raw.slice(lastSep + 1) : '0'
    const amount = Number(`${whole || '0'}.${cents}`)
    return Number.isFinite(amount) ? amount : null
}

const parseQuantity = (value: unknown) => {
    const n = parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 1
}

// "1. Land for extra workshops" -> "Land for extra workshops"
const stripNumbering = (value: string) => value.replace(/^\d+\s*[.)]\s*/, '')

const findHeader = (rows: unknown[][]) => {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
        const columns: Partial<Record<ColumnKey, number>> = {}
        rows[r].forEach((cell, c) => {
            const text = clean(cell)
            if (!text) return
            for (const key of Object.keys(HEADER_PATTERNS) as ColumnKey[]) {
                if (columns[key] === undefined && HEADER_PATTERNS[key].test(text)) {
                    columns[key] = c
                    break
                }
            }
        })
        if (columns.price !== undefined && (columns.product !== undefined || columns.need !== undefined)) {
            return { row: r, columns }
        }
    }
    return null
}

const isTotalRow = (cells: string[]) => cells.some(text => /^(grand\s*)?total\b/i.test(text))

export const parseNeedsWorkbook = (data: ArrayBuffer): NeedsParseResult => {
    const workbook = XLSX.read(data, { type: 'array' })
    const warnings: string[] = []

    for (const sheetName of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
            header: 1,
            raw: true,
            defval: ''
        })
        const header = findHeader(rows)
        if (!header) continue

        const { columns } = header
        const cell = (row: unknown[], key: ColumnKey) =>
            columns[key] === undefined ? '' : row[columns[key] as number]

        const needs: ParsedNeed[] = []
        let currentNeed = ''

        for (let r = header.row + 1; r < rows.length; r++) {
            const row = rows[r]
            const texts = row.map(clean)
            if (texts.every(text => !text) || isTotalRow(texts)) continue

            const needText = stripNumbering(clean(cell(row, 'need')))
            const product = clean(cell(row, 'product'))
            const price = parseRand(cell(row, 'price'))
            if (needText) currentNeed = needText

            // A category heading on its own: carried down, not a line item.
            if (!product && price === null) continue

            needs.push({
                row: r + 1,
                quantity: parseQuantity(cell(row, 'quantity')),
                need: currentNeed || 'General',
                product: product || needText,
                price,
                notes: clean(cell(row, 'notes'))
            })
        }

        const unpriced = needs.filter(item => item.price === null).length
        if (unpriced) warnings.push(`${unpriced} item(s) have no price and will import as unpriced.`)

        return { needs, sheetName, headerRow: header.row + 1, warnings }
    }

    throw new Error('No sheet has a header row with a Price column and a Product or Needs column.')
}

/** A blank template with the expected columns and two example rows. */
export const downloadNeedsTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
        ['Quantity', 'Needs identified', 'Product', 'Price', 'Notes'],
        [1, 'Pool Car', 'Hyundai i10 2021 model', 198900, ''],
        [1, 'Security system', 'Electric fence', 80000, 'Priority'],
        [1, '', 'Alarm system', 75000, '']
    ])
    sheet['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 36 }, { wch: 14 }, { wch: 30 }]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Needs')
    XLSX.writeFile(workbook, 'needs-assessment-template.xlsx')
}
