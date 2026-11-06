/**
 * Reading branch SME spreadsheets for the participant import.
 *
 * The files differ a lot: title rows above the header, headers split over two
 * merged rows, one sheet per group/status/category (and what a sheet means
 * changes from file to file), the same SME on several sheets, "tbc" in cells,
 * two phone numbers in one cell. So this module only reads and suggests; the
 * person importing confirms what each sheet and column is.
 *
 * No Firebase here, so it can be tested against real files outside the app.
 */
import * as XLSX from 'xlsx'
import { isValidZARegistration, normaliseRegistration } from '@/routes/operations/participants/new/registration'

// ---- fields a column can feed ----------------------------------------------

export type FieldKey =
    | 'companyName'
    | 'director'
    | 'idNumber'
    | 'phone'
    | 'email'
    | 'registrationNumber'
    | 'beeLevel'
    | 'blackOwnedPercent'
    | 'femaleOwnedPercent'
    | 'youthOwnedPercent'
    | 'disabilityOwnedPercent'
    | 'natureOfBusiness'
    | 'productsServices'
    | 'sector'
    | 'office'
    | 'businessAddress'
    | 'workshopAddress'
    | 'ward'
    | 'group'
    | 'status'
    | 'preAssessment'
    | 'preIncubationContract'
    | 'note'
    | 'ignore'

export const FIELD_LABELS: Record<FieldKey, string> = {
    companyName: 'Company name',
    director: 'Director(s)',
    idNumber: 'Director ID number',
    phone: 'Phone',
    email: 'Email',
    registrationNumber: 'Registration number',
    beeLevel: 'B-BBEE level',
    blackOwnedPercent: 'Black-owned %',
    femaleOwnedPercent: 'Women-owned %',
    youthOwnedPercent: 'Youth-owned %',
    disabilityOwnedPercent: 'Disability-owned %',
    natureOfBusiness: 'Nature of business',
    productsServices: 'Products / services',
    sector: 'Sector',
    office: 'Lepharo office (branch)',
    businessAddress: 'Business address',
    workshopAddress: 'Workshop / factory address',
    ward: 'Ward',
    group: 'Group (A/B/C)',
    status: 'Status (active, dormant, exited…)',
    preAssessment: 'Pre-assessment form (yes/no)',
    preIncubationContract: 'Pre-incubation contract (yes/no)',
    note: 'Keep as a note',
    ignore: "Don't import"
}

/** Header words → field. Checked in order; the first rule that matches wins. */
const HEADER_RULES: { field: FieldKey; test: (h: string) => boolean }[] = [
    { field: 'ignore', test: h => /^(no|nr|#|number)$/.test(h) || /^column\d+$/.test(h) },
    { field: 'companyName', test: h => h.includes('company name') || h === 'company' || h.includes('business name') },
    { field: 'idNumber', test: h => /\bid (no|number)\b/.test(h) || h === 'id' },
    { field: 'director', test: h => h.includes('director') || h.includes('name and surname') || h.includes('owner name') },
    { field: 'email', test: h => h.includes('email') || h.includes('emali') || h.includes('e-mail') },
    { field: 'phone', test: h => h.includes('contact') || h.includes('phone') || h.includes('cell') || h.includes('tel') },
    { field: 'registrationNumber', test: h => h.includes('ck no') || h.includes('registration') || h.includes('reg no') || h === 'ck' },
    { field: 'beeLevel', test: h => /b-?bb-?ee|bee level/.test(h) },
    { field: 'femaleOwnedPercent', test: h => h.includes('women') || h.includes('female') },
    { field: 'youthOwnedPercent', test: h => h.includes('youth') },
    { field: 'disabilityOwnedPercent', test: h => h.includes('disab') },
    { field: 'blackOwnedPercent', test: h => h.includes('black owned') || h === 'ownership' },
    { field: 'natureOfBusiness', test: h => h.includes('functional area') || h.includes('fuctional area') || h.includes('nature of business') },
    { field: 'productsServices', test: h => h.includes('product') || h.includes('service') || h.includes('discription') || h.includes('description') },
    { field: 'sector', test: h => h === 'sector' || h.includes('sector') },
    { field: 'office', test: h => h.includes('lepharo office') || h === 'office' || h === 'branch' || h === 'hub' },
    { field: 'workshopAddress', test: h => h.includes('workshop') || h.includes('work shop') || h.includes('factory') },
    { field: 'businessAddress', test: h => h.includes('address') || h.includes('physical') || h.includes('location') },
    { field: 'ward', test: h => h.includes('ward') },
    { field: 'group', test: h => h.includes('group') },
    { field: 'status', test: h => h === 'status' || h.includes('active/dormant') || h.includes('active / dormant') },
    { field: 'preAssessment', test: h => h.includes('assessment') },
    { field: 'preIncubationContract', test: h => h.includes('pre-incubation') || h.includes('pre incubation') || h.includes('contract') || h.includes('contrcat') }
]

/** Fields that only make sense once per sheet: a second matching column becomes a note. */
const SINGLE_FIELDS = new Set<FieldKey>([
    'companyName', 'director', 'idNumber', 'email', 'phone', 'registrationNumber', 'beeLevel',
    'blackOwnedPercent', 'femaleOwnedPercent', 'youthOwnedPercent', 'disabilityOwnedPercent',
    'natureOfBusiness', 'productsServices', 'sector', 'office', 'businessAddress', 'workshopAddress', 'ward', 'group', 'status',
    'preAssessment', 'preIncubationContract'
])

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())
const headerKey = (v: unknown) => text(v).toLowerCase().replace(/['’]/g, '').replace(/\s*\/\s*/g, '/').replace(/[.:]+$/g, '')

export const suggestField = (header: string): FieldKey => {
    const h = headerKey(header)
    if (!h) return 'ignore'
    return HEADER_RULES.find(rule => rule.test(h))?.field ?? 'note'
}

// ---- what a sheet is ---------------------------------------------------------

export type IncubationGroup = 'A' | 'B' | 'C' | 'Graduated'

/**
 * Where an SME is in incubation, as the branch lists record it (one sheet per
 * status). Not the A/B/C group. Most final first: when an SME is on two status
 * sheets, the later stage is kept and the clash is flagged.
 */
export const SME_STATUSES = ['Exited', 'Potential exit', 'Dormant', 'Soft incubation', 'Active'] as const

/** A status named in a sheet name or cell, if it's one of the known ones. */
export const statusFromText = (value: string): string | null => {
    const v = value.toLowerCase()
    if (/potential\s*exit/.test(v)) return 'Potential exit'
    if (/\bexit(ed)?\b/.test(v)) return 'Exited'
    if (/dormant|non\s*-?\s*active|inactive/.test(v)) return 'Dormant'
    if (/soft\s*incubat/.test(v)) return 'Soft incubation'
    if (/^\s*active\s*$/.test(v)) return 'Active'
    return null
}

const statusRank = (status: string) => {
    const i = (SME_STATUSES as readonly string[]).indexOf(status)
    return i < 0 ? SME_STATUSES.length : i
}

export type SheetRole =
    /** Every SME in the file (or this branch): import its rows. */
    | { kind: 'main' }
    /** These SMEs are in a group: import them and set the group. */
    | { kind: 'group'; group: IncubationGroup }
    /** These SMEs have a status (Exited, Dormant, Soft incubation…): import them and set it. */
    | { kind: 'status'; status: string }
    /** A status or category the system has no field for: import and label them. */
    | { kind: 'label'; label: string }
    | { kind: 'skip' }

export type ColumnDef = {
    index: number
    header: string
    field: FieldKey
    sample: string
    /** Set when the values, not the heading, decided the field (the heading didn't match the data). */
    detectedFrom?: string
}

export type ParsedSheet = {
    name: string
    /** Text in the rows above the header (the sheet's own title), if any. */
    title: string
    headerRowNumber: number
    columns: ColumnDef[]
    /** Data rows, each the trimmed cell text by column index. */
    rows: string[][]
    role: SheetRole
    /** True when the role is only a guess from the sheet name and needs a look. */
    roleIsGuess: boolean
}

const groupFromText = (value: string): IncubationGroup | null => {
    const v = value.toLowerCase().replace(/^group\s*-?\s*/, '').trim()
    if (v === 'a') return 'A'
    if (v === 'b') return 'B'
    if (v === 'c') return 'C'
    if (['graduated', 'post-incubation', 'post incubation'].includes(v)) return 'Graduated'
    return null
}

/** A first guess at what a sheet is. Only "Group X" is safe; anything else is flagged as a guess. */
const suggestRole = (name: string, rowCount: number, largest: number): { role: SheetRole; guess: boolean } => {
    if (!rowCount) return { role: { kind: 'skip' }, guess: false }
    const n = name.trim()
    const group = /^group\s*([abc])$/i.exec(n)
    if (group) return { role: { kind: 'group', group: group[1].toUpperCase() as IncubationGroup }, guess: false }
    const status = statusFromText(n)
    if (status) return { role: { kind: 'status', status }, guess: false }
    if (rowCount === largest) return { role: { kind: 'main' }, guess: true }
    return { role: { kind: 'label', label: n.replace(/\s+/g, ' ') }, guess: true }
}

// ---- reading a workbook ------------------------------------------------------

/** Row index (0-based) of the header: the first row with a "company" heading. */
const findHeaderRow = (rows: unknown[][]) =>
    rows.slice(0, 25).findIndex(row => row.some(cell => /company( name)?|business name/.test(headerKey(cell))))

/**
 * A second header row under the first: merged parents ("Ownership") split into
 * "Black Owned / Black Women Owned / …". Recognised by its words, and by holding
 * no email address or long number (which would make it a data row).
 */
const isSubHeaderRow = (row: unknown[], companyCol: number) => {
    const cells = row.map(text).filter(Boolean)
    if (cells.length < 2) return false
    if (cells.some(c => c.includes('@') || /\d{4}\/\d{4,}/.test(c) || /\d{9,}/.test(c.replace(/\D/g, '')))) return false
    // Under a merged header the company cell is blank (data rows always name the company)…
    if (!text(row[companyCol])) return cells.some(c => suggestField(c) !== 'note')
    // …or the row is plainly headings.
    return cells.some(c => /owned|assessment|incubation|contr|yes\/ ?no/i.test(c))
}

/** What a column's values look like, when most of them clearly are one thing. */
const CONTENT_RULES: { field: FieldKey; label: string; test: (v: string) => boolean }[] = [
    { field: 'email', label: 'email addresses', test: v => EMAIL_RE.test(v) },
    { field: 'idNumber', label: 'ID numbers', test: v => /^\d{13}$/.test(v.replace(/\s/g, '')) },
    { field: 'registrationNumber', label: 'registration numbers', test: v => /^(k|ck)?\(?\d{4}[\/\\]\d{4,8}[\/\\]\d{2}/i.test(v.replace(/\s/g, '')) },
    { field: 'ward', label: 'ward numbers', test: v => /^ward\s*\d+/i.test(v) }
]

const contentField = (values: string[]) => {
    const filled = values.filter(Boolean)
    if (filled.length < 2) return null
    for (const rule of CONTENT_RULES) {
        const hits = filled.filter(rule.test).length
        if (hits / filled.length >= 0.6) return rule
    }
    return null
}

export const parseWorkbook = (data: ArrayBuffer | Uint8Array): ParsedSheet[] => {
    const wb = XLSX.read(data, { type: 'array', cellDates: true })
    const drafts = wb.SheetNames.map(name => {
        const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', blankrows: false, raw: false })
        const h = findHeaderRow(raw)
        if (h < 0) return { name, title: '', headerRowNumber: 0, columns: [] as ColumnDef[], rows: [] as string[][] }

        const top = raw[h] || []
        const topCompanyCol = top.findIndex(cell => /company( name)?|business name/.test(headerKey(cell)))
        const sub = isSubHeaderRow(raw[h + 1] || [], topCompanyCol) ? raw[h + 1] : null
        const width = Math.max(top.length, sub?.length ?? 0)
        // A sub-header names the column more precisely ("Black Women Owned" under "Ownership").
        const headers = Array.from({ length: width }, (_, i) => text(sub?.[i]) || text(top[i]))

        const firstData = h + (sub ? 2 : 1)
        const companyCol = headers.findIndex(hd => suggestField(hd) === 'companyName')
        const rows = raw
            .slice(firstData)
            .map(r => headers.map((_, i) => text((r as unknown[])[i])))
            .filter(r => {
                const company = r[companyCol] || ''
                // Rows without a company, or a repeated header, aren't SMEs.
                return company && suggestField(company) !== 'companyName' && !/^(tbc|n\/a|-)$/i.test(company)
            })

        // Columns that are empty on every row add nothing (spreadsheets often carry hundreds).
        const candidates = headers
            .map((header, index) => ({ header, index, sample: rows.map(r => r[index]).find(Boolean) || '' }))
            .filter(c => c.sample)
            .map(c => {
                const byHeader: FieldKey = c.header ? suggestField(c.header) : 'note'
                // When a heading doesn't match its values (columns shifted in the sheet, or an
                // unlabelled column), clear values win: a column of ID numbers is ID numbers.
                const byContent = contentField(rows.map(r => r[c.index]))
                const overridden = byContent && byContent.field !== byHeader
                return {
                    ...c,
                    header: c.header || `Column ${XLSX.utils.encode_col(c.index)}`,
                    byHeader,
                    agrees: !!byContent && byContent.field === byHeader,
                    field: overridden ? byContent.field : byHeader,
                    detectedFrom: overridden ? `Its values look like ${byContent.label}` : undefined
                }
            })
        // One column per field, in order of confidence:
        // 1. a heading and its values agree ("Email Address" full of emails);
        // 2. values alone (a shifted or unlabelled column) — unless (1) took the field, then it
        //    keeps its heading's field (a "Contact Details" cell that also holds an email);
        // 3. headings alone, left to right. Anything left over is kept as a note.
        const used = new Set<FieldKey>()
        const take = (field: FieldKey) => {
            if (SINGLE_FIELDS.has(field) && used.has(field)) return false
            used.add(field)
            return true
        }
        const decided = new Map<number, ColumnDef>()
        const strip = ({ byHeader, agrees, ...col }: (typeof candidates)[number]): ColumnDef => col
        candidates.filter(c => c.agrees).forEach(c => decided.set(c.index, take(c.field) ? strip(c) : { ...strip(c), field: 'note' }))
        candidates
            .filter(c => !decided.has(c.index) && c.detectedFrom)
            .forEach(c => {
                if (take(c.field)) decided.set(c.index, strip(c))
                else decided.set(c.index, { ...strip(c), field: take(c.byHeader) ? c.byHeader : 'note', detectedFrom: undefined })
            })
        candidates
            .filter(c => !decided.has(c.index))
            .forEach(c => decided.set(c.index, take(c.field) ? strip(c) : { ...strip(c), field: 'note' }))
        const columns: ColumnDef[] = candidates.map(c => decided.get(c.index)!)

        const title = raw
            .slice(0, h)
            .map(r => (r as unknown[]).map(text).filter(Boolean).join(' · '))
            .filter(Boolean)
            .join(' — ')
        return { name, title, headerRowNumber: h + 1, columns, rows }
    })

    const largest = Math.max(0, ...drafts.map(d => d.rows.length))
    return drafts.map(d => {
        const { role, guess } = suggestRole(d.name, d.rows.length, largest)
        return { ...d, role, roleIsGuess: guess }
    })
}

// ---- cleaning values -----------------------------------------------------------

const PLACEHOLDER = /^(tbc|tba|n\/?a|none|nil|-+|\?+|0)$/i

const clean = (v: string) => (PLACEHOLDER.test(v.trim()) ? '' : v.trim())

/** "100%", "100", "0.51", "51 %" → 0–100; anything else (incl. "Yes") → null. */
export const toPercent = (v: string): number | null => {
    const s = v.replace(/\s/g, '')
    if (!s) return null
    const m = /^(\d+(?:[.,]\d+)?)%?$/.exec(s)
    if (!m) return null
    let n = Number(m[1].replace(',', '.'))
    if (!s.includes('%') && n > 0 && n <= 1 && m[1].includes('.')) n *= 100
    return n >= 0 && n <= 100 ? Math.round(n) : null
}

/** "Level 1", "1", "1%" (a common slip) → "1"; "Non-compliant" kept; else null. */
export const toBeeLevel = (v: string): string | null => {
    const s = v.trim()
    if (!s) return null
    if (/non[- ]?compl/i.test(s)) return 'Non-compliant'
    const m = /^(?:level\s*)?([1-8])\s*%?$/i.exec(s)
    return m ? m[1] : null
}

/** The first South African number in a cell that may hold two ("072 1092 480/ 074 …"). */
export const toPhone = (v: string): string | null => {
    for (const part of v.split(/[\/;,]|\bor\b|&/i)) {
        let d = part.replace(/\D/g, '')
        if (d.startsWith('27') && d.length === 11) d = `0${d.slice(2)}`
        if (d.length === 9 && !d.startsWith('0')) d = `0${d}`
        if (d.length === 10 && d.startsWith('0')) return d
    }
    return null
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const EMAIL_RE = EMAIL

/** The first email address in a cell (cells may hold two, or "tbc"). */
export const toEmail = (v: string): string | null => {
    const m = EMAIL.exec(v)
    return m ? m[0].toLowerCase() : null
}

/** Registration number with common slips fixed: "2015/171470/07%", "2011//14373/03", spaces. */
export const toRegistration = (v: string): string => {
    const s = clean(v)
    if (!s) return ''
    const tidy = normaliseRegistration(
        s
            .replace(/[()*?]/g, '')
            .replace(/\\/g, '/')
            .replace(/%+$/, '')
            .replace(/\/{2,}/g, '/')
            .replace(/^ck\s*/i, 'CK')
    )
    if (isValidZARegistration(tidy)) return tidy
    // The slashes left out: K201819661107 → K2018/196611/07, 2006082126/08 → 2006/082126/08.
    const prefix = /^(CK|K)/.exec(tidy)?.[1] ?? ''
    const digits = tidy.slice(prefix.length).replace(/\D/g, '')
    if (digits.length === 12) {
        const rebuilt = `${prefix}${digits.slice(0, 4)}/${digits.slice(4, 10)}/${digits.slice(10)}`
        if (isValidZARegistration(rebuilt)) return rebuilt
    }
    return tidy
}

export const toYesNo = (v: string): boolean | null => {
    const s = v.trim().toLowerCase()
    if (/^(y|yes|signed|true|1)\b/.test(s)) return true
    if (/^(n|no|false|0)\b/.test(s)) return false
    return null
}

/** "Mr Kopo Phatang", "Ms., Lerato, Koki", "Patricia & Christian Moholo" → names. */
export const toDirectors = (v: string): string[] => {
    const s = clean(v)
    if (!s) return []
    const withoutTitles = s.replace(/\b(mr|mrs|ms|miss|dr|prof)\b\.?,?\s*/gi, '').replace(/\s*,\s*/g, ' ').trim()
    return withoutTitles
        .split(/\s*(?:&|\/|;|\band\b)\s*/i)
        .map(n => n.replace(/\s+/g, ' ').trim())
        .filter(n => n.length > 1)
}

// ---- turning rows into SMEs ------------------------------------------------------

export type ImportIssue =
    | 'no-registration'
    | 'bad-registration'
    | 'no-email'
    | 'no-phone'
    | 'no-director'
    | 'group-conflict'
    | 'status-conflict'
    | 'registration-conflict'

export const ISSUE_LABELS: Record<ImportIssue, string> = {
    'no-registration': 'No registration number',
    'bad-registration': 'Registration number looks wrong',
    'no-email': 'No email',
    'no-phone': 'No phone',
    'no-director': 'No director',
    'group-conflict': 'In more than one group',
    'status-conflict': 'Has more than one status',
    'registration-conflict': 'Rows give different registration numbers'
}

export type ImportedSme = {
    /** Registration digits, or the cleaned company name when there's none. */
    key: string
    companyName: string
    registrationNumber: string
    directors: string[]
    idNumber: string | null
    email: string | null
    phone: string | null
    beeLevel: string | null
    blackOwnedPercent: number | null
    femaleOwnedPercent: number | null
    youthOwnedPercent: number | null
    disabilityOwnedPercent: number | null
    natureOfBusiness: string | null
    productsServices: string | null
    sector: string | null
    office: string | null
    businessAddress: string | null
    workshopAddress: string | null
    ward: string | null
    group: IncubationGroup | null
    status: string | null
    labels: string[]
    preAssessment: boolean | null
    preIncubationContract: boolean | null
    /** Unmapped columns kept as "header: value". */
    notes: Record<string, string>
    /** Where it came from, for the record and for the review list. */
    sources: { sheet: string; row: number }[]
    issues: ImportIssue[]
}

const companyKey = (name: string) =>
    name
        .toLowerCase()
        .replace(/\(pty\)|\bpty\b|\bltd\b|\(|\)|[.,'’]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

const rowToSme = (sheet: ParsedSheet, row: string[], rowNumber: number): ImportedSme | null => {
    const by = (field: FieldKey) => {
        const col = sheet.columns.find(c => c.field === field)
        return col ? row[col.index] || '' : ''
    }
    const companyName = clean(by('companyName'))
    if (!companyName) return null
    const registrationNumber = toRegistration(by('registrationNumber'))
    const regDigits = registrationNumber.replace(/\D/g, '')
    const notes: Record<string, string> = {}
    sheet.columns.filter(c => c.field === 'note' && row[c.index]).forEach(c => (notes[c.header] = row[c.index]))

    const role = sheet.role
    const rowGroup = groupFromText(by('group'))
    const officeCell = clean(by('office'))
    const officeIsId = /^\d{13}$/.test(officeCell.replace(/\s/g, ''))
    const idCell = by('idNumber').replace(/\D/g, '') || (officeIsId ? officeCell.replace(/\s/g, '') : '')
    return {
        key: regDigits.length >= 8 ? `reg:${regDigits}` : `name:${companyKey(companyName)}`,
        companyName,
        registrationNumber,
        directors: toDirectors(by('director')),
        idNumber: idCell.length === 13 ? idCell : null,
        email: toEmail(by('email')),
        phone: toPhone(by('phone')),
        beeLevel: toBeeLevel(by('beeLevel')),
        blackOwnedPercent: toPercent(by('blackOwnedPercent')),
        femaleOwnedPercent: toPercent(by('femaleOwnedPercent')),
        youthOwnedPercent: toPercent(by('youthOwnedPercent')),
        disabilityOwnedPercent: toPercent(by('disabilityOwnedPercent')),
        natureOfBusiness: clean(by('natureOfBusiness')) || null,
        productsServices: clean(by('productsServices')) || null,
        sector: clean(by('sector')) || null,
        office: officeIsId ? null : officeCell || null,
        businessAddress: clean(by('businessAddress')) || null,
        workshopAddress: clean(by('workshopAddress')) || null,
        ward: clean(by('ward')) || null,
        // A group column on the row beats the sheet's role.
        group: rowGroup ?? (role.kind === 'group' ? role.group : null),
        // A status cell on the row beats the sheet's role (e.g. Springs' ACTIVE/DORMANT column).
        status: statusFromText(by('status')) ?? (role.kind === 'status' && role.status.trim() ? role.status.trim() : null),
        labels: role.kind === 'label' && role.label.trim() ? [role.label.trim()] : [],
        preAssessment: toYesNo(by('preAssessment')),
        preIncubationContract: toYesNo(by('preIncubationContract')),
        notes,
        sources: [{ sheet: sheet.name, row: rowNumber }],
        issues: []
    }
}

const firstOf = <T,>(a: T | null, b: T | null) => (a === null || a === '' ? b : a)

/** Two rows for the same SME: keep what the first has, fill gaps from the second. */
const mergeSme = (a: ImportedSme, b: ImportedSme): ImportedSme => {
    const merged: ImportedSme = { ...a }
    ;(Object.keys(b) as (keyof ImportedSme)[]).forEach(k => {
        if (['labels', 'sources', 'notes', 'issues', 'directors', 'group', 'status', 'key'].includes(k)) return
        ;(merged as any)[k] = firstOf((a as any)[k], (b as any)[k])
    })
    merged.directors = a.directors.length ? a.directors : b.directors
    merged.labels = Array.from(new Set([...a.labels, ...b.labels]))
    merged.sources = [...a.sources, ...b.sources]
    merged.notes = { ...b.notes, ...a.notes }
    if (a.group && b.group && a.group !== b.group) merged.issues = Array.from(new Set([...a.issues, 'group-conflict' as ImportIssue]))
    // Same company, different registration numbers (a sheet pasted with shifted columns): keep
    // the first and flag it, rather than invent a second SME.
    const regA = a.registrationNumber.replace(/\D/g, '')
    const regB = b.registrationNumber.replace(/\D/g, '')
    if (regA && regB && regA !== regB) merged.issues = Array.from(new Set([...merged.issues, 'registration-conflict' as ImportIssue]))
    // Two different statuses (on a dormant sheet and an exit sheet): keep the later stage, flag it.
    if (a.status && b.status && a.status !== b.status) merged.issues = Array.from(new Set([...merged.issues, 'status-conflict' as ImportIssue]))
    merged.status = [a.status, b.status].filter((x): x is string => !!x).sort((x, y) => statusRank(x) - statusRank(y))[0] ?? null
    // An explicit group (B/C/Graduated) wins over the default A.
    merged.group = [a.group, b.group].filter(Boolean).sort((x, y) => (x === 'A' ? 1 : 0) - (y === 'A' ? 1 : 0))[0] ?? null
    return merged
}

const issuesOf = (sme: ImportedSme): ImportIssue[] => {
    const out = new Set<ImportIssue>(sme.issues.filter(i => ['group-conflict', 'status-conflict', 'registration-conflict'].includes(i)))
    if (!sme.registrationNumber) out.add('no-registration')
    else if (!isValidZARegistration(sme.registrationNumber)) out.add('bad-registration')
    if (!sme.email) out.add('no-email')
    if (!sme.phone) out.add('no-phone')
    if (!sme.directors.length) out.add('no-director')
    return Array.from(out)
}

/**
 * Every SME across the sheets being imported, the same SME on several sheets
 * merged (by registration number, else company name). Main sheets are read
 * first so their details win; group and label sheets add their group/label.
 */
export const collectSmes = (sheets: ParsedSheet[]): ImportedSme[] => {
    const order = (s: ParsedSheet) => (s.role.kind === 'main' ? 0 : s.role.kind === 'group' ? 1 : s.role.kind === 'status' ? 2 : 3)
    const byKey = new Map<string, ImportedSme>()
    // A name-keyed SME can match a registration-keyed one from another sheet.
    const nameIndex = new Map<string, string>()
    sheets
        .filter(s => s.role.kind !== 'skip')
        .sort((a, b) => order(a) - order(b))
        .forEach(sheet => {
            sheet.rows.forEach((row, i) => {
                const sme = rowToSme(sheet, row, sheet.headerRowNumber + 1 + i)
                if (!sme) return
                const name = companyKey(sme.companyName)
                const existingKey = byKey.has(sme.key) ? sme.key : nameIndex.get(name)
                if (existingKey && byKey.has(existingKey)) {
                    byKey.set(existingKey, mergeSme(byKey.get(existingKey)!, sme))
                } else {
                    byKey.set(sme.key, sme)
                    nameIndex.set(name, sme.key)
                }
            })
        })
    return Array.from(byKey.values()).map(sme => ({ ...sme, issues: issuesOf(sme) }))
}

/** Re-apply a column choice to every sheet that has the same header text. */
export const setColumnField = (sheets: ParsedSheet[], header: string, field: FieldKey): ParsedSheet[] =>
    sheets.map(s => ({ ...s, columns: s.columns.map(c => (c.header === header ? { ...c, field } : c)) }))

// ---- offices → branches ------------------------------------------------------------

const distance = (a: string, b: string) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 1; j <= b.length; j++) dp[0][j] = j
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return dp[a.length][b.length]
}

const placeKey = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '')

/**
 * The branch an office cell names, allowing for typing slips ("Khutsog",
 * "Srings"). Only a close, unambiguous match counts; otherwise null and the
 * person importing picks.
 */
export const matchBranch = (office: string, branches: { id: string; name: string }[]): string | null => {
    const o = placeKey(office)
    if (!o) return null
    const scored = branches
        .map(b => {
            const n = placeKey(b.name)
            const d = n.includes(o) || o.includes(n) ? 0 : distance(o, n)
            return { id: b.id, d }
        })
        .sort((x, y) => x.d - y.d)
    const best = scored[0]
    if (!best || best.d > Math.max(1, Math.floor(o.length / 3))) return null
    return scored[1] && scored[1].d === best.d ? null : best.id
}
