// docx/movBuilder.ts
import dayjs from "dayjs"
import {
  Document,
  Paragraph,
  TextRun,
  Table as DocTable,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  AlignmentType,
  BorderStyle,
  TableLayoutType,
  PageOrientation
} from "docx"
import { getAgreementTemplate } from "@/services/complianceResolver"

// ---------- shared primitives ----------
const pct = (n: number) => ({ size: n, type: WidthType.PERCENTAGE })

const CELL_MARGINS = { top: 120, bottom: 120, left: 120, right: 120 }
const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" }
}

const TABLE_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" }
}

export const line = "___________________________"
export const tick = (on: boolean) => (on ? "X" : " ")

export const cell = (children: (string | TextRun | Paragraph)[] | string = "") =>
  new TableCell({
    margins: CELL_MARGINS,
    borders: CELL_BORDER,
    children: Array.isArray(children)
      ? children.map((c) =>
          typeof c === "string"
            ? new Paragraph(c)
            : c instanceof Paragraph
              ? c
              : new Paragraph({ children: [c] })
        )
      : [new Paragraph(String(children || ""))]
  })

const styledCell = (
  children: (string | TextRun | Paragraph)[] | string = "",
  options: { fill?: string; columnSpan?: number; alignment?: AlignmentType; width?: number } = {}
) => new TableCell({
  margins: CELL_MARGINS,
  borders: CELL_BORDER,
  ...(options.fill ? { shading: { fill: options.fill } } : {}),
  ...(options.columnSpan ? { columnSpan: options.columnSpan } : {}),
  ...(options.width ? { width: pct(options.width) } : {}),
  children: Array.isArray(children)
    ? children.map((c) => typeof c === "string"
      ? new Paragraph({ alignment: options.alignment, children: [new TextRun({ text: c })] })
      : c instanceof Paragraph ? c : new Paragraph({ alignment: options.alignment, children: [c] }))
    : [new Paragraph({ alignment: options.alignment, children: [new TextRun({ text: String(children || "") })] })]
})

export const row = (...cells: TableCell[]) => new TableRow({ children: cells })

const labelRow = (label: string, value = "") => row(cell(label), cell(value))

export const yesNoRow = (label: string, yes: boolean) =>
  row(cell(label), cell("Yes"), cell(tick(yes)), cell("No"), cell(tick(!yes)))

export const freqRow = (label: string, on: boolean) =>
  row(cell(label), cell(`[${tick(on)}]`))

export const table = (rows: TableRow[], columnWidths?: number[]) =>
  new DocTable({
    width: pct(100),
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDER,
    rows,
    ...(columnWidths?.length ? { columnWidths } : {})
  })

const boldParagraph = (text: string, alignment?: AlignmentType) =>
  new Paragraph({
    alignment,
    children: [new TextRun({ text, bold: true })]
  })

const textParagraph = (text: string, alignment?: AlignmentType) =>
  new Paragraph({
    alignment,
    children: [new TextRun({ text })]
  })

const headerCell = (lines: string[], alignment: AlignmentType = AlignmentType.CENTER) =>
  new TableCell({
    margins: CELL_MARGINS,
    borders: CELL_BORDER,
    shading: { fill: "FFC000" },
    children: lines.map((text) => boldParagraph(text, alignment))
  })

// ---------- date helpers ----------
const toJsDate = (value: any): Date | null => {
  if (!value) return null

  if (typeof value?.toDate === "function") {
    const d = value.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }

  if (typeof value?.seconds === "number") {
    const millis = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000)
    const d = new Date(millis)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const d = dayjs(value)
  return d.isValid() ? d.toDate() : null
}

export const fmt = (d: any) => {
  const parsed = toJsDate(d)
  return parsed ? dayjs(parsed).format("DD MMMM YYYY") : ""
}

const dateTime = (d: any) => {
  const parsed = toJsDate(d)
  return parsed ? parsed.getTime() : 0
}

// ---------- MOV intervention row helpers ----------
type MovInterventionRow = {
  title: string
  date: any
  signature?: string
}

const getSubInterventionTitle = (m: any): string => {
  const candidates = [
    m?.subInterventionTitle,
    m?.subInterventionName,
    m?.assignedIntervention?.subInterventionTitle,
    m?.assignment?.subInterventionTitle,
    m?.sourceAssignment?.subInterventionTitle,
    m?.snapshot?.selectedSubIntervention?.title
  ]

  const match = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim()
  )

  return match ? match.trim() : ""
}

export const buildMovInterventionLabel = (m: any): string => {
  const title = String(m?.interventionTitle || "").trim() || "Intervention"
  const subtitle = getSubInterventionTitle(m)
  return subtitle ? `${title} - ${subtitle}` : title
}

const addSubInterventionToRows = (
  rows: MovInterventionRow[],
  mov: any
): MovInterventionRow[] => {
  const subInterventionTitle = getSubInterventionTitle(mov)
  if (!subInterventionTitle) return rows

  const bracketedTitle = `[${subInterventionTitle}]`

  return rows.map((row) => ({
    ...row,
    title: row.title.toLowerCase().includes(bracketedTitle.toLowerCase())
      ? row.title
      : `${row.title} ${bracketedTitle}`.trim()
  }))
}

const stripDuplicateSummary = (value?: string | null) => {
  const raw = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()

  if (!raw) return ""

  const cleaned = raw
    .replace(/^\s*Summary\s*:\s*/i, "")
    .replace(/^\s*Topics\s+(?:discussed|covered)\s*:/gim, "Coverage:")
    .trim()

  const lines = cleaned.split("\n")
  const mainText = lines
    .filter(line => !/^\s*Coverage\s*:/i.test(line))
    .join(" ")
    .toLowerCase()
  const normalizedLines = lines.flatMap(line => {
    const coverageMatch = line.match(/^\s*Coverage\s*:\s*(.*)$/i)
    if (!coverageMatch) return [line]

    const additionalCoverage = coverageMatch[1]
      .split(";")
      .map(point => point.trim())
      .filter(point => point && !mainText.includes(point.toLowerCase()))

    return additionalCoverage.length
      ? [`Coverage: ${additionalCoverage.join("; ")}`]
      : []
  })

  return normalizedLines
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const sessionDescriptionOnly = (value?: string | null) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(line =>
      !/^\s*(?:Coverage|Topics\s+(?:discussed|covered)|Notes\/outcomes)\s*:/i.test(line)
    )
    .join("\n")
    .trim()

export const buildMovInterventionRows = (m: any): MovInterventionRow[] => {
  // ROM service deliveries record their own dated, POE-supported details and
  // do not require an appointment or an allocated-intervention session.
  if (m?.sourceType === 'romServiceDelivery') {
    const title = String(m?.deliveryDetails || '').trim()
    return title ? [{
      title,
      date: m?.interventionDate || m?.activityCompletedAt || m?.periodStart,
      signature: m?.smmeSignatureUrl || ''
    }] : []
  }

  // appointmentInterventions is the canonical MOV session list. It is resolved
  // from actual held/attended appointment coverage before this builder runs.
  // Do not fall back to attendedSessions/progress history because that can mix
  // unrelated or historical intervention activity into the current MOV.
  const appointmentRecords: any[] = Array.isArray(m?.appointmentInterventions)
    ? m.appointmentInterventions
    : []

  const appointmentRows = appointmentRecords
    .map((appointment: any) => {
      const heading =
        appointment?.title ||
        appointment?.sessionTitle ||
        appointment?.interventionTitle ||
        m?.interventionTitle ||
        ""

      return {
        title: stripDuplicateSummary(sessionDescriptionOnly(heading)),
        date:
          appointment?.date ||
          appointment?.startTime ||
          appointment?.completedAt ||
          m?.interventionDate,
        signature: appointment?.signature || ""
      }
    })
    .filter((row: MovInterventionRow) => row.title)
    .sort((a: MovInterventionRow, b: MovInterventionRow) => dateTime(a.date) - dateTime(b.date))

  if (appointmentRows.length) return addSubInterventionToRows(appointmentRows, m)

  return []
}

// ---------- async helpers ----------
export async function fetchBytes(url?: string): Promise<ArrayBuffer | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

// ---------- header ----------
async function legacyHeaderTable(
  lepharoUrl?: string,
  sibanyeUrl?: string,
  titleTop = "CONFIRMATION SHEET FOR RECEIVING",
  titleSub?: string
) {
  const l = await fetchBytes(lepharoUrl)
  const s = await fetchBytes(sibanyeUrl)
  const movTemplate = await getAgreementTemplate("mov").catch(() => null)

  return table(
    [
      row(
        cell([
          l
            ? new Paragraph({
                children: [
                  new ImageRun({
                    data: l,
                    transformation: { width: 140, height: 40 }
                  })
                ]
              })
            : "Lepharo",
          s
            ? new Paragraph({
                children: [
                  new ImageRun({
                    data: s,
                    transformation: { width: 160, height: 34 }
                  })
                ]
              })
            : "SMALL ENTERPRISE DEVELOPMENT AGENCY"
        ]),
        new TableCell({
          margins: CELL_MARGINS,
          borders: CELL_BORDER,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: titleTop, bold: true, size: 28 })]
            }),
            titleSub
              ? new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: titleSub, bold: true, size: 28 })]
                })
              : new Paragraph(" "),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `Form No: ${movTemplate?.formNo || "—"}    `, bold: true }),
                new TextRun({ text: `Revision No: ${movTemplate?.revisionNo || "—"}    `, bold: true }),
                new TextRun({ text: `Effective date: ${movTemplate?.effectiveDate || "—"}`, bold: true })
              ]
            })
          ]
        })
      )
    ],
    [40, 60]
  )
}

const MOV_LANDSCAPE_PAGE = {
  size: {
    orientation: PageOrientation.LANDSCAPE,
    width: 15840,
    height: 12240
  },
  margin: { top: 720, bottom: 720, left: 720, right: 720 }
}

export async function headerTable(
  lepharoUrl?: string,
  sibanyeUrl?: string,
  titleTop = "CONFIRMATION SHEET FOR RECEIVING",
  titleSub?: string
) {
  const [l, s, movTemplate] = await Promise.all([
    fetchBytes(lepharoUrl),
    fetchBytes(sibanyeUrl),
    getAgreementTemplate("mov").catch(() => null)
  ])

  return table([
    row(
      styledCell([
        l ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: l, transformation: { width: 140, height: 40 } })] }) : "Lepharo"
      ], { width: 18, alignment: AlignmentType.CENTER }),
      styledCell([
        s ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: s, transformation: { width: 160, height: 42 } })] }) : "SMALL ENTERPRISE DEVELOPMENT AGENCY"
      ], { width: 18, alignment: AlignmentType.CENTER }),
      styledCell([
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: titleTop, bold: true, size: 28 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: titleSub || "BDS (MOV)", bold: true, size: 28 })] })
      ], { width: 38, alignment: AlignmentType.CENTER }),
      styledCell([
        `Form No: ${movTemplate?.formNo || "-"}`,
        `Revision No: ${movTemplate?.revisionNo || "-"}`,
        `Effective date: ${movTemplate?.effectiveDate || "-"}`
      ], { width: 26 })
    )
  ], [18, 18, 38, 26])
}

// ---------- body sections ----------
export function officeDatesBlock(m: any) {
  return table(
    [
      labelRow("OFFICE/AREA NAME", m.officeAreaName || ""),
      labelRow("Start Date:", fmt(m.periodStart || m.interventionDate)),
      labelRow("End Date", fmt(m.smmeAcceptedAt || m.smmeSignedAt || m.periodEnd))
    ],
    [35, 65]
  )
}

export function clientBlock(m: any) {
  const g = String(m.gapGroup || "").toUpperCase()
  const A = g === "A"
  const B = g === "B"
  const C = g === "C"

  return table(
    [
      labelRow("NAME OF THE CLIENT:", m.smmeCompanyName || ""),
      labelRow("SMME No", m.smmeNo || ""),
      labelRow("SMME Sector:", m.smmeSector || ""),
      row(cell("Group stage:"), cell(`A [${tick(A)}]   B [${tick(B)}]   C [${tick(C)}]`)),
      labelRow("KPI serviced:", buildMovInterventionLabel(m))
    ],
    [35, 65]
  )
}

export function officeClientBlock(m: any) {
  const g = String(m.gapGroup || '').toUpperCase()
  return table([
    row(
      styledCell('OFFICE/AREA NAME', { fill: 'F4B183', width: 21 }),
      cell(m.officeAreaName || ''),
      styledCell('Start Date:', { fill: 'BFBFBF', width: 12 }),
      cell(fmt(m.periodStart || m.interventionDate)),
      styledCell('End Date', { fill: 'BFBFBF', width: 10 }),
      cell(fmt(m.smmeAcceptedAt || m.smmeSignedAt || m.periodEnd))
    ),
    row(
      styledCell('NAME OF THE SMME:', { fill: 'BFBFBF', width: 21 }),
      new TableCell({ margins: CELL_MARGINS, borders: CELL_BORDER, columnSpan: 3, children: [new Paragraph({ children: [new TextRun({ text: m.smmeCompanyName || '', bold: true })] })] }),
      styledCell('SMME No', { fill: 'BFBFBF', width: 10 }),
      cell(m.smmeNo || '')
    ),
    row(
      styledCell('SMME Sector:', { fill: 'BFBFBF', width: 21 }),
      cell(m.smmeSector || ''),
      styledCell('Group stage:', { fill: 'BFBFBF', width: 12 }),
      styledCell('A', { fill: g === 'A' ? '9BCB9B' : 'FFFFFF', alignment: AlignmentType.CENTER }),
      styledCell('B', { fill: g === 'B' ? '9BCB9B' : 'FFFFFF', alignment: AlignmentType.CENTER }),
      styledCell('C', { fill: g === 'C' ? '9BCB9B' : 'FFFFFF', alignment: AlignmentType.CENTER })
    ),
    row(
      styledCell('KPI serviced:', { fill: 'BFBFBF', width: 21 }),
      new TableCell({ margins: CELL_MARGINS, borders: CELL_BORDER, columnSpan: 5, children: [new Paragraph(buildMovInterventionLabel(m))] })
    )
  ], [21, 29, 12, 14, 10, 14])
}

export function methodBlock(m: any) {
  return table(
    [
      row(cell("Intervention method"), cell(""), cell(""), cell(""), cell("")),
      yesNoRow("In person", !!m.methodInPerson),
      yesNoRow("Online", !!m.methodOnline),
      yesNoRow("Telephonic", !!m.methodTelephonic),
      labelRow("Other (Specify", m.methodOther || line)
    ],
    [50, 10, 10, 10, 20]
  )
}

export function frequencyBlock(m: any) {
  return table(
    [
      row(cell("Frequency of intervention"), cell("")),
      freqRow("Once a month", m.frequency === "monthly"),
      freqRow("Every two weeks", m.frequency === "biweekly"),
      freqRow("Weekly", m.frequency === "weekly")
    ],
    [80, 20]
  )
}

export function methodFrequencyBlock(m: any) {
  const f = String(m.frequency || '').toLowerCase()
  const choice = (on: boolean, label: string) => styledCell(label, { fill: on ? '9BCB9B' : 'FFFFFF', alignment: AlignmentType.CENTER })
  return table([
    row(styledCell('Intervention method', { fill: 'BFBFBF', columnSpan: 9, alignment: AlignmentType.CENTER })),
    row(
      styledCell('In person', { fill: 'BFBFBF' }), choice(!!m.methodInPerson, 'Yes'), choice(!m.methodInPerson, 'No'),
      styledCell('Online', { fill: 'BFBFBF' }), choice(!!m.methodOnline, 'Yes'), choice(!m.methodOnline, 'No'),
      styledCell('Telephonic', { fill: 'BFBFBF' }), choice(!!m.methodTelephonic, 'Yes'), choice(!m.methodTelephonic, 'No')
    ),
    row(styledCell('Other (Specify)', { fill: 'BFBFBF' }), new TableCell({ margins: CELL_MARGINS, borders: CELL_BORDER, columnSpan: 8, children: [new Paragraph(m.methodOther || line)] })),
    row(
      styledCell('Frequency of intervention', { fill: 'BFBFBF' }),
      styledCell('Once a month', { fill: 'BFBFBF', columnSpan: 2, alignment: AlignmentType.CENTER }),
      styledCell('', { fill: f === 'monthly' ? '9BCB9B' : 'FFFFFF' }),
      styledCell('Every two weeks', { fill: 'BFBFBF', columnSpan: 2, alignment: AlignmentType.CENTER }),
      styledCell('', { fill: f === 'biweekly' ? '9BCB9B' : 'FFFFFF' }),
      styledCell('Weekly', { fill: 'BFBFBF', alignment: AlignmentType.CENTER }),
      styledCell('', { fill: f === 'weekly' ? '9BCB9B' : 'FFFFFF' })
    )
  ], [16, 10, 10, 16, 10, 10, 16, 10, 10])
}

export function interventionsTable(rows: MovInterventionRow[]) {
  const safeRows = rows.length
    ? rows
    : [
        {
          title: "",
          date: "",
          signature: ""
        }
      ]

  return table(
    [
      row(
        headerCell(["No."]),
        headerCell(["TYPE OF INTERVENTION PROVIDED", "(give full details)"]),
        headerCell(["INTERVENTION", "date"]),
        headerCell(["Signature"])
      ),
      ...safeRows.map((it, i) =>
        row(
          cell([textParagraph(String(i + 1), AlignmentType.CENTER)]),
          cell(stripDuplicateSummary(it.title || "")),
          cell([textParagraph(fmt(it.date), AlignmentType.CENTER)]),
          cell(it.signature || "")
        )
      )
    ],
    [8, 57, 20, 15]
  )
}

export function interventionsTableRich(rows: MovInterventionRow[], smmeSig?: ArrayBuffer | null) {
  const safeRows = rows.length ? rows : [{ title: 'No intervention details recorded', date: '' }]
  return table([
    row(
      headerCell(['No.']),
      headerCell(['TYPE OF INTERVENTION PROVIDED', '(give full details)'], AlignmentType.LEFT),
      headerCell(['INTERVENTION', 'date:(dd/mm/yyyy)']),
      headerCell(['Signature'])
    ),
    ...safeRows.map((it, i) => row(
      cell([textParagraph(`${i + 1}.`, AlignmentType.CENTER)]),
      cell(stripDuplicateSummary(it.title || '')),
      cell([textParagraph(fmt(it.date), AlignmentType.CENTER)]),
      smmeSig
        ? cell([new Paragraph({ children: [new ImageRun({ data: smmeSig, transformation: { width: 180, height: 48 } })] })])
        : cell('Signature not provided')
    ))
  ], [4, 66, 15, 15])
}

export function signaturesBlock(m: any, facSig?: ArrayBuffer | null, smmeSig?: ArrayBuffer | null) {
  return table(
    [
      row(cell("Facilitator name"), cell("Client name")),
      row(cell(m.facilitatorName || ""), cell(m.smmeName || m.smmeCompanyName || "")),
      row(
        cell(
          facSig
            ? [
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: facSig,
                      transformation: { width: 240, height: 80 }
                    })
                  ]
                })
              ]
            : "Signature"
        ),
        cell(
          smmeSig
            ? [
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: smmeSig,
                      transformation: { width: 240, height: 80 }
                    })
                  ]
                })
              ]
            : "Signature"
        )
      ),
      row(cell("Department"), cell("Department")),
      row(cell(m.departmentName || ""), cell(m.departmentName || "")),
      row(cell("Date"), cell("Date")),
      row(
        cell(fmt(m.facilitatorSignedAt || m.assigneeCompletedAt || m.completedAt || m.interventionDate)),
        cell(fmt(m.smmeSignedAt || m.smmeAcceptedAt))
      )
    ],
    [50, 50]
  )
}

export function signaturesBlockRich(m: any, facSig?: ArrayBuffer | null, smmeSig?: ArrayBuffer | null) {
  const imageCell = (data?: ArrayBuffer | null) => data
    ? cell([new Paragraph({ children: [new ImageRun({ data, transformation: { width: 180, height: 60 } })] })])
    : cell('Signature missing')
  return table([
    row(styledCell('Facilitator name', { fill: 'FFC000' }), cell(m.facilitatorName || ''), styledCell('Client name', { fill: 'FFC000' }), cell(m.smmeCompanyName || '')),
    row(styledCell('Signature', { fill: 'BFBFBF' }), imageCell(facSig), styledCell('Signature', { fill: 'BFBFBF' }), imageCell(smmeSig)),
    row(styledCell('Department', { fill: 'BFBFBF' }), cell(m.departmentName || ''), styledCell('Designation', { fill: 'BFBFBF' }), cell(m.smmeRepresentativeDesignation || 'Director')),
    row(styledCell('Date', { fill: 'BFBFBF' }), cell(fmt(m.facilitatorSignedAt || m.assigneeCompletedAt || m.completedAt || m.interventionDate)), styledCell('Date', { fill: 'BFBFBF' }), cell(fmt(m.smmeSignedAt || m.smmeAcceptedAt)))
  ], [12, 38, 12, 38])
}

export function officeUseOnlyBlock(deptLabel = "Monitoring and evaluation") {
  return table(
    [
      row(cell("Office use only"), cell("")),
      labelRow("Final checker's name", ""),
      labelRow("Signature", ""),
      labelRow("Department", deptLabel),
      labelRow("Date", "")
    ],
    [50, 50]
  )
}

export function officeUseOnlyBlockRich(m: any, deptLabel = "Monitoring and evaluation") {
  const approval = Array.isArray(m?.approvals)
    ? m.approvals.find((a: any) => a.step === 'validation')
    : null
  const validatorName = m?.monitoringName || approval?.name || m?.monitoringValidatorName || m?.validatorName || ''
  const validatorSig = m?.monitoringSignatureUrl || m?.monitoringSignature || m?.monitoringSigUrl || approval?.signatureUrl || ''
  return table([
    row(styledCell('Office use only', { fill: '92D050', columnSpan: 2 })),
    row(styledCell("Final checker's name", { fill: 'BFBFBF' }), cell(m?.finalCheckerName || '')),
    row(styledCell('Signature', { fill: 'BFBFBF' }), cell(m?.finalCheckerSignature || '')),
    ...(validatorName || validatorSig ? [
      row(styledCell('M&E Validator', { fill: 'BFBFBF' }), cell(validatorName || '-')),
      row(styledCell('M&E Signature', { fill: 'BFBFBF' }), cell(validatorSig || 'Signature missing'))
    ] : []),
    row(styledCell('Department', { fill: 'BFBFBF' }), cell(m?.officeUseDepartment || deptLabel)),
    row(styledCell('Date', { fill: 'BFBFBF' }), cell(fmt(m?.officeUseDate)))
  ], [36, 64])
}

// ---------- full single-pack document ----------
export async function buildMovDoc(
  m: any,
  opts: {
    lepharoUrl?: string
    sibanyeUrl?: string
    headerTop: string
    headerSub?: string
    officeDept: string
  }
) {
  const facSig = await fetchBytes(m.facilitatorSignatureUrl)
  const smmeSig = await fetchBytes(m.smmeSignatureUrl)
  const list = buildMovInterventionRows(m)

  const hdr = await headerTable(opts.lepharoUrl, opts.sibanyeUrl, opts.headerTop, opts.headerSub)

  return new Document({
    sections: [
      {
        properties: { page: MOV_LANDSCAPE_PAGE },
        children: [
          hdr,
          new Paragraph(" "),
          officeClientBlock(m),
          new Paragraph(" "),
          methodFrequencyBlock(m),
          new Paragraph(" "),
          interventionsTableRich(list, smmeSig),
          new Paragraph({
            children: [new TextRun({ text: "ONE CONFIRMATION SHEET PER CLIENT", bold: true })]
          }),
          new Paragraph(" "),
          signaturesBlockRich(m, facSig, smmeSig),
          new Paragraph(" "),
          officeUseOnlyBlockRich(m, 'Monitoring and evaluation'),
          new Paragraph(
            "SMME number example: SPR2009/233707/08GA (regional office prefix, then at the end we capture group stages) GA = Group A, when they graduate we just change the A to B."
          ),
          new Paragraph("CIP -v02-06/2024")
        ]
      }
    ]
  })
}

// ---------- consolidated document ----------
export async function buildConsolidatedDoc(
  pack: any,
  opts: {
    lepharoUrl?: string
    sibanyeUrl?: string
    deptName: string
  }
) {
  const hdr = await headerTable(
    opts.lepharoUrl,
    opts.sibanyeUrl,
    "CONFIRMATION SHEET FOR RECEIVING",
    `${opts.deptName} Interventions`
  )

  const rows = (pack.interventions || pack.interventionsSnapshot || []).map((x: any, i: number) =>
    row(
      cell(String(i + 1)),
      cell(x.smmeCompanyName || ""),
      cell(x.interventionTitle || ""),
      cell(x.facilitatorName || ""),
      cell(fmt(x.interventionDate || x.completedAt))
    )
  )

  const listing = table(
    [row(cell("No."), cell("Beneficiary"), cell("Intervention"), cell("Facilitator"), cell("Date Completed")), ...rows],
    [8, 32, 32, 14, 14]
  )

  return new Document({
    sections: [
      {
        properties: { page: MOV_LANDSCAPE_PAGE },
        children: [
          hdr,
          new Paragraph(" "),
          listing,
          new Paragraph(" "),
          officeUseOnlyBlock("Monitoring and evaluation")
        ]
      }
    ]
  })
}
