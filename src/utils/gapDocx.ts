// src/utils/gapDocx.ts
import dayjs from 'dayjs'
import {
  Document as DDocument,
  Packer,
  Paragraph,
  TextRun,
  Table as DTable,
  TableRow as DRow,
  TableCell as DCell,
  WidthType,
  AlignmentType,
  ImageRun,
  BorderStyle,
  TableLayoutType,
  Header,
  Footer,
  HeightRule,
  PageNumber
} from 'docx'
import { saveAs } from 'file-saver'

/** ─────────────────────────────────────────────────────────────────────────────
 * Public API
 *  - Call exportGapDocx(gap, { overrides, headerMeta })
 *  - It will generate and trigger a download of a .docx file.
 *  - This file is self-contained: no imports from component files.
 *    If you already share SECTION_ADAPTERS elsewhere, feel free to remove
 *    the local copy below and import yours.
 * ────────────────────────────────────────────────────────────────────────────*/

export type QA = { answer?: string; comment?: string }
export type SectionKey =
  | 'marketing'
  | 'psychometric'
  | 'finance'
  | 'hr'
  | 'wellness'
  | 'legal'
  | 'market'
  | 'quality'
  | 'training'

type SectionDef = {
  title: string
  qText: string[]
  getQA: (g: any) => QA[]
}

/** If you already have these in a shared module, replace this block with imports. */
const marketingCommunicationQ = [
  'Do you have a company profile, logo, domain, brochures, banners, and other Marketing/Advertising materials that are deemed necessary for the business?',
  'Does company have electronic signature software?'
]
const psychometricQ = [
  'Have you ever done a psychometric assessment?',
  'Have you in the past participated in or completed personal development courses/programmes for business growth (e.g., mentoring/coaching/counselling)?',
  'Does your organisation have a personal development plan in place for all directors that allows for the development of personal insight for business growth of an entrepreneur for each Director?'
]
const financialManagementQ = [
  'Do you have current or previous Accountant?',
  'Are you registered for Income Tax?',
  'Are you registered for Value Added Tax (VAT)?',
  'Are you registered for Pay As You Earn (PAYE)?',
  'Do you have your previous Annual Financial Statements (AFS)?',
  'Do you have a valid Tax Clearance Certificate (TCC)?',
  'Do you have a Business Plan in place (BP)?',
  'Do you have an existing accounting system in place?',
  'Do you have a Companies and Intellectual Property Commission (CIPC) disclosure certificate?',
  'Do you need assistance with industry tender pricing?',
  'Do you have a need for business funding?',
  'Do you need Finance training?',
  'Do you have current Management Accounts?',
  'Do you have a Fixed Asset Register?',
  'Do you have legacy accounting problems (prior year unfinished accounting/bookkeeping tasks)?',
  'Please assist with read-only access of business bank account – Bank statements only'
]
const labourHSEQ = [
  'UIF Registration (check if company has employees)?',
  'Are you registered for COID/RMA?',
  'Do your employees & directors have contracts of employment?',
  'Is the company registered/affiliated with any industry bodies? (e.g., Plumbing Council, CIDB, NAMC)',
  'Do you have an Occupational Health & Safety System in place?',
  'Have you done statutory OHS trainings (employer and employees)?',
  'Do you have a workshop/office where you operate from? (under lease or owned by the business)'
]
const wellnessQ = [
  'Are you aware that Lepharo offers Employee Wellness Services?',
  'Are you aware of your employees’ or your own mental/emotional state that can derail your business?',
  'Do you have employee assistance programmes implemented in your workplace?',
  'Have you or your employees completed a Wellness Health Risk Assessment over the past 6 months?',
  'Are you interested in incorporating Health and Wellness in your company?'
]
const legalQ = [
  'Are you aware that Lepharo provides business Legal Services?',
  'Do you need assistance with Broad-Based Black Economic Empowerment rating (B-BBEE)?',
  'Do the shareholders have shareholding certificates?',
  'Do you have employment contract templates in place?',
  'Does your company employ illegal immigrants?',
  'Do you have any Legal needs we can assist you with?',
  'Do you have a lease agreement in place?',
  'Does the business have insurance (e.g., public liability)?'
]
const marketLinkageQ = [
  'Are you registered with Central Supplier Database (CSD)?',
  'Is the competency of the management team and workforce adequate?',
  'Do you have a list of clients you desire to service?',
  'Do you know the net worth of your business?',
  'Do you have current/previous trade references?',
  'Do you have the capacity/equipment to deliver product?'
]
const qualityManagementQ = [
  'Are you aware of Quality Management Systems (QMS)?',
  'Have you attended ISO 9001:2015 QMS training before? (If yes, where and do you have the certificate?)',
  'Do you have a Quality Management System in place?',
  'Do you have 6-month records of the implemented QMS?'
]
const trainingNeedsYNQ = [
  'Does the business pay Skills Development Levies?',
  'If yes, to which SETA? (enter below)',
  'Does the business prepare a Workplace Skills Plan?',
  'Do you have a Skills Development Facilitator (SDF) in the business?',
  'Do you have training needs of personnel in middle and senior management levels?',
  'Do you have training needs of supervisors in the business?',
  'Do you have training needs for the workforce/staff in the business?',
  'Do you have training needs of support staff (Administrators, Finance, HR)?'
]

const getQAArray = (obj: any): QA[] =>
  Array.isArray(obj) ? obj : Array.isArray(obj?.q) ? obj.q : []

const SECTION_ADAPTERS: Record<SectionKey, SectionDef> = {
  marketing: {
    title: 'Marketing & Communication',
    qText: marketingCommunicationQ,
    getQA: (g) => getQAArray(g?.sections?.marketingCommunication)
  },
  psychometric: {
    title: 'Psychometric',
    qText: psychometricQ,
    getQA: (g) => getQAArray(g?.sections?.psychometric)
  },
  finance: {
    title: 'Financial Management',
    qText: financialManagementQ,
    getQA: (g) => getQAArray(g?.sections?.financialManagement?.q)
  },
  hr: {
    title: 'Human Resources / HSE',
    qText: labourHSEQ,
    getQA: (g) => getQAArray(g?.sections?.labourHSE)
  },
  wellness: {
    title: 'Wellness',
    qText: wellnessQ,
    getQA: (g) => getQAArray(g?.sections?.wellness?.q)
  },
  legal: {
    title: 'Legal',
    qText: legalQ,
    getQA: (g) => getQAArray(g?.sections?.legal?.q)
  },
  market: {
    title: 'Market Linkage',
    qText: marketLinkageQ,
    getQA: (g) => getQAArray(g?.sections?.marketLinkage)
  },
  quality: {
    title: 'Quality Management',
    qText: qualityManagementQ,
    getQA: (g) => getQAArray(g?.sections?.qualityManagement)
  },
  training: {
    title: 'Training Needs',
    qText: trainingNeedsYNQ,
    getQA: (g) => getQAArray(g?.sections?.trainingNeeds?.yn)
  }
}

const SECTION_ORDER: SectionKey[] = [
  'marketing',
  'psychometric',
  'finance',
  'hr',
  'wellness',
  'legal',
  'market',
  'quality',
  'training'
]

/** Public params */
export type ExportGapDocxParams = {
  overrides?: { smmeSigUrl?: string; romSigUrl?: string }
  headerMeta?: {
    formNo: string
    revisionNo: string
    effectiveDate: string // e.g., '2025-10-22' or '22 October 2025'
    centerTitle: string
    onboardingComments?: string
  }
  /** Path/URL to your logo. Default: '/assets/images/lepharo.png' */
  logoUrl?: string
  /** Optional custom file name without extension. Default: <Company>-GAP-Analysis */
  filenameBase?: string
}

/** Main reusable function */
export async function exportGapDocx(gap: any, params: ExportGapDocxParams = {}) {
  const { overrides, headerMeta, logoUrl = '/assets/images/lepharo.png' } = params

  const logoBuf = await fetchArrayBuffer(logoUrl)

  const INCH = (v: number) => Math.round(v * 1440)
  const A4_W_P = 11906, A4_H_P = 16838 // docx units
  const A4_W = A4_H_P, A4_H = A4_W_P // landscape
  const MARGIN = INCH(0.785)
  const CONTENT_W = A4_W - 2 * MARGIN

  const HEADER_ROW_HEIGHT = INCH(1.18)
  const HEADER_TABLE_WIDTH = INCH(10.12)
  const CENTER_W = INCH(5.07)
  const LEFT_W = INCH(2.2)
  const RIGHT_W = HEADER_TABLE_WIDTH - CENTER_W - LEFT_W

  const DXA = 1440
  const COLS = [DXA * 0.5, DXA * 3.6, DXA * 0.4, DXA * 0.4, DXA * 1.2]

  const cellPad = { top: 70, bottom: 70, left: 120, right: 120 }
  const bwHeaderCell = (text: string, w: number, align = AlignmentType.CENTER) =>
    new DCell({
      width: { size: w, type: WidthType.DXA },
      margins: cellPad,
      borders: bwBorders(4),
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold: true })] })]
    })
  const bwBorders = (size = 2) => ({
    top: { style: BorderStyle.SINGLE, size, color: '000000' },
    bottom: { style: BorderStyle.SINGLE, size, color: '000000' },
    left: { style: BorderStyle.SINGLE, size, color: '000000' },
    right: { style: BorderStyle.SINGLE, size, color: '000000' }
  })

  const bwCell = (text: string, w: number, align = AlignmentType.LEFT, bold = false) =>
    new DCell({
      width: { size: w, type: WidthType.DXA },
      margins: cellPad,
      borders: bwBorders(2),
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text: text ?? '', bold })] })]
    })

  const sectionRowBW = (title: string) =>
    new DRow({
      children: [
        new DCell({
          columnSpan: 5,
          width: { size: COLS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
          margins: cellPad,
          borders: bwBorders(2),
          children: [new Paragraph({ children: [new TextRun({ text: title.toUpperCase(), bold: true })] })]
        })
      ]
    })

  const makeHeader = () =>
    new Header({
      children: [
        new DTable({
          layout: TableLayoutType.FIXED,
          width: { size: HEADER_TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [LEFT_W, CENTER_W, RIGHT_W],
          borders: bwBorders(4),
          rows: [
            new DRow({
              height: { value: HEADER_ROW_HEIGHT, rule: HeightRule.EXACT },
              children: [
                new DCell({
                  width: { size: LEFT_W, type: WidthType.DXA },
                  margins: { top: 40, bottom: 40, left: 120, right: 120 },
                  children: [
                    logoBuf
                      ? new Paragraph({
                          alignment: AlignmentType.LEFT,
                          children: [new ImageRun({ data: logoBuf, transformation: { width: 200, height: 52 } })]
                        })
                      : new Paragraph({ children: [new TextRun({ text: 'Lepharo', bold: true })] })
                  ]
                }),
                new DCell({
                  width: { size: CENTER_W, type: WidthType.DXA },
                  margins: { top: 40, bottom: 40, left: 120, right: 120 },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: headerMeta?.centerTitle || 'SMME GAP ANALYSIS - RUSTERNBERG',
                          bold: true,
                          font: 'Arial',
                          size: 36
                        })
                      ]
                    })
                  ]
                }),
                new DCell({
                  width: { size: RIGHT_W, type: WidthType.DXA },
                  margins: { top: 40, bottom: 40, left: 120, right: 120 },
                  children: [
                    labeledPair('Form No: ', headerMeta?.formNo),
                    labeledPair('Revision No: ', headerMeta?.revisionNo),
                    labeledPair('Effective date: ', headerMeta?.effectiveDate)
                  ]
                })
              ]
            })
          ]
        })
      ]
    })

  const makeFooter = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Page ', size: 22 }), PageNumber.CURRENT, new TextRun({ text: ' of ', size: 22 }), PageNumber.TOTAL_PAGES]
        })
      ]
    })

  // Company details table
  const detailLeft = INCH(2.2)
  const detailRight = CONTENT_W - detailLeft
  const detailsTable = new DTable({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [detailLeft, detailRight],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      insideH: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
      insideV: { style: BorderStyle.SINGLE, size: 2, color: '000000' }
    },
    rows: [
      new DRow({ children: [bwCell('Company Name:', detailLeft, AlignmentType.LEFT, true), bwCell(String(gap?.company?.name || ''), detailRight)] }),
      new DRow({ children: [bwCell('Region:', detailLeft, AlignmentType.LEFT, true), bwCell(String(gap?.company?.region || ''), detailRight)] }),
      new DRow({
        children: [bwCell('Contact Details:', detailLeft, AlignmentType.LEFT, true), bwCell(String(gap?.company?.phone || gap?.company?.contact || ''), detailRight)]
      }),
      new DRow({ children: [bwCell('Email Address:', detailLeft, AlignmentType.LEFT, true), bwCell(String(gap?.company?.email || ''), detailRight)] }),
      new DRow({
        children: [
          bwCell('Date of engagement:', detailLeft, AlignmentType.LEFT, true),
          bwCell(formatPossiblyTimestamp(gap?.company?.dateOfEngagement || gap?.submittedAt), detailRight)
        ]
      })
    ]
  })

  // Questions table
  const repeatingSpacerRow = new DRow({
    tableHeader: true,
    children: [
      new DCell({
        columnSpan: 5,
        width: { size: COLS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        margins: { top: 90, bottom: 30, left: 1, right: 1 },
        borders: noBorders(),
        children: [new Paragraph({ text: '' })]
      })
    ]
  })
  const headerRow = new DRow({
    tableHeader: true,
    children: [
      bwHeaderCell('No', COLS[0]),
      bwHeaderCell('QUESTIONNAIRE', COLS[1]),
      bwHeaderCell('YES', COLS[2]),
      bwHeaderCell('NO', COLS[3]),
      bwHeaderCell('COMMENT', COLS[4])
    ]
  })

  const qaRows: DRow[] = [repeatingSpacerRow, headerRow]
  const pushQuestion = (q: string, rowNo: number, qa?: { answer?: string; comment?: string }) => {
    const ans = (qa?.answer || '').toString().toLowerCase()
    const isYes = ans === 'yes'
    const isNo = ans === 'no'
    qaRows.push(
      new DRow({
        children: [
          bwCell(String(rowNo).padStart(2, '0') + '.', COLS[0], AlignmentType.CENTER),
          bwCell(q, COLS[1]),
          bwCell(isYes ? '✓' : '', COLS[2], AlignmentType.CENTER),
          bwCell(isNo ? '✓' : '', COLS[3], AlignmentType.CENTER),
          bwCell(qa?.comment || '', COLS[4])
        ]
      })
    )
  }

  for (const sec of SECTION_ORDER) {
    const def = SECTION_ADAPTERS[sec]
    const qas = def.getQA(gap)
    qaRows.push(sectionRowBW(def.title))
    let runningRow = 1
    def.qText.forEach((q, i) => pushQuestion(q, runningRow++, qas?.[i]))
  }

  const qaTable = new DTable({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: COLS,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      insideH: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
      insideV: { style: BorderStyle.SINGLE, size: 2, color: '000000' }
    },
    rows: qaRows
  })

  // Comments + signatures page
  const pageBreak = new Paragraph({ text: '', pageBreakBefore: true })
  const commentsHeading = new Paragraph({ children: [new TextRun({ text: 'Comments by the onboarding:', bold: true })], spacing: { after: 80 } })
  const commentsBody = buildCommentsBody(headerMeta?.onboardingComments)

  const smmeName =
    gap?.signatures?.smmeNameSurname || gap?.company?.contactName || gap?.company?.ownerName || ''
  const romNameVal = gap?.romReview?.reviewerName || gap?.romReview?.reviewerEmail || ''

  const sigColW = Math.floor(CONTENT_W / 2)
  const nameLabelsRow = new DRow({
    children: [bwCell(`SMME’s: Name & Surname`, sigColW, AlignmentType.LEFT, true), bwCell(`R&O Manager: Name & Surname`, sigColW, AlignmentType.LEFT, true)]
  })
  const nameValuesRow = new DRow({
    children: [
      underlinedCell(smmeName, sigColW),
      underlinedCell(romNameVal, sigColW)
    ]
  })

  const sigLabelsRow = new DRow({
    children: [bwCell(`SMME’s: Signature`, sigColW, AlignmentType.LEFT, true), bwCell(`R&O Manager: Signature`, sigColW, AlignmentType.LEFT, true)]
  })

  const smmeSig = overrides?.smmeSigUrl || gap?.signatures?.smmeSignatureUrl || ''
  const romSig = overrides?.romSigUrl || gap?.romReview?.romSignatureUrl || ''
  const smmeImg = smmeSig ? await fetchArrayBuffer(smmeSig) : null
  const romImg = romSig ? await fetchArrayBuffer(romSig) : null

  const sigImgsRow = new DRow({
    children: [signatureCell(smmeImg, sigColW), signatureCell(romImg, sigColW)]
  })

  const signaturesTable = new DTable({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [sigColW, sigColW],
    borders: noBorders(),
    rows: [nameLabelsRow, nameValuesRow, sigLabelsRow, sigImgsRow]
  })

  const firstSpacer = new Paragraph({ text: '', spacing: { after: 120 } })

  // Build document
  const doc = new DDocument({
    styles: { default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { after: 80 } } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_W, height: A4_H },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 360, footer: 360 }
          }
        },
        headers: { default: makeHeader() },
        footers: { default: makeFooter() },
        children: [firstSpacer, detailsTable, new Paragraph({ text: '', spacing: { after: 120 } }), qaTable, pageBreak, commentsHeading, ...commentsBody, signaturesTable]
      }
    ]
  })

  const blob = await Packer.toBlob(doc)
  const base =
    params.filenameBase ||
    (String(gap?.company?.name || 'GAP-Analysis').replace(/[^\w\- ]/g, '') || 'GAP-Analysis')
  saveAs(blob, `${base}-GAP-Analysis.docx`)
}

/** ───────────────────────── helpers ───────────────────────── */

async function fetchArrayBuffer(url?: string) {
  if (!url) return null
  try {
    const r = await fetch(url, { mode: 'cors' })
    if (!r.ok) return null
    return await r.arrayBuffer()
  } catch {
    return null
  }
}

function labeledPair(label: string, value?: string) {
  return new Paragraph({
    spacing: { after: 30 },
    children: [new TextRun({ text: label, bold: true }), new TextRun({ text: value || '—' })]
  })
}

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  }
}

function formatPossiblyTimestamp(ts: any): string {
  const dt = ts?.seconds ? ts.toDate?.() : ts
  return ts ? dayjs(dt).format('YYYY-MM-DD') : ''
}

function buildCommentsBody(text?: string) {
  const NBSP = '\u00A0'
  const underlineLines = (count = 6, charsPerLine = 110) =>
    Array.from({ length: count }, () =>
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: NBSP.repeat(charsPerLine), underline: { type: 'single' } })]
      })
    )

  if (text && text.trim()) {
    return [
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text, underline: { type: 'single' } })]
      }),
      ...underlineLines(4)
    ]
  }
  return underlineLines(6)
}

function underlinedCell(text: string, w: number) {
  return new DCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 40, bottom: 20, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    },
    children: [new Paragraph({ children: [new TextRun({ text: text || '' })] })]
  })
}

function signatureCell(imgBuf: ArrayBuffer | null, w: number) {
  return new DCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 20, bottom: 80, left: 120, right: 120 },
    borders: noBorders(),
    children: imgBuf
      ? [new Paragraph({ children: [new ImageRun({ data: imgBuf, transformation: { width: 200, height: 80 } })] })]
      : [new Paragraph({ text: '' })]
  })
}
