import { db } from '@/firebase'
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
    BorderStyle,
    TableLayoutType,
    ImageRun,
    Header,
    Footer,
    PageNumber,
    HeadingLevel
} from 'docx'
import { saveAs } from 'file-saver'
import { getDoc, doc } from 'firebase/firestore'

/** -----------------------------
 * Types (Phase 1: pure data input)
 * ------------------------------ */

export type ReportMeta = {
    departmentName: string
    periodLabel: string // "July 2025"
    scopeLabel?: string

    programId?: string
    name?: string

    formNo?: string
    revisionNo?: string
    effectiveDate?: string
    preparedBy?: string
    reviewedBy?: string
    approvedBy?: string
    companyName?: string
}

export type ReportChartImage = {
    key: "confirmation" | "typeStatus" | "gapVariance"
    title: string
    pngDataUrl: string // data:image/png;base64,...
    caption?: string
    width?: number
    height?: number
  }


export type KPIStatus = 'green' | 'amber' | 'red'

export type KPIItem = {
    kpi: string
    annualTarget?: number | string
    monthlyTarget?: number | string
    achieved?: number | string
    ytdTotal?: number | string
    status?: KPIStatus
    narrative?: string
}

export type BeneficiaryStats = {
    totalAssigned?: number
    servicedThisMonth?: number
    notServiced?: number
    notServicedReasons?: Array<{
        reason: string
        count?: number
        notes?: string
    }>
    distributions?: Array<{
        label: string // "By Centre", "By Stage", etc.
        rows: Array<{ name: string; value: number }>
    }>
}

export type InterventionRow = {
    smmeName: string
    contact?: string
    stage?: string
    sector?: string
    intervention: string
    movAttached?: boolean
    date?: string // ISO or display
}

export type RiskRow = {
    issue: string
    impact: string
    rootCause?: string
    mitigation: string
    owner?: string
    dueDate?: string
}

export type ActionRow = {
    action: string
    responsible: string
    deadline: string
}

export type SuccessStory = {
    title?: string
    context: string
    intervention: string
    outcome: string
}

export type MonthlyReportData = {
    meta: ReportMeta

    executiveSummary: string // keep it short (<= 1 page)
    introduction?: string

    kpis?: KPIItem[]

    charts?: ReportChartImage[]

    progressNarratives?: Array<{
        title: string // e.g. "KPI 1: Health Risk Assessments"
        body: string
    }>

    beneficiaryStats?: BeneficiaryStats

    servicesCatalogue?: Array<{ name: string; description: string }>

    interventionsThisMonth?: InterventionRow[]
    engagementsWithoutMOV?: InterventionRow[]

    systemUsage?: {
        systemName: string // "Symphony"
        narrative?: string
        metrics?: Array<{ label: string; value: string | number }>
    }

    successStories?: SuccessStory[]

    challengesAndRisks?: RiskRow[]

    correctiveActionsNextMonth?: ActionRow[]

    conclusion?: string

    signOff?: {
        declarerName?: string
        declarerRole?: string // e.g. "HOD — Finance"
        declarerDate?: string

        reviewerName?: string
        reviewerRole?: string // e.g. "Programme Manager / ROM"
        reviewerDate?: string

        approverName?: string
        approverRole?: string // e.g. "CEO / Director"
        approverDate?: string
    }
}

export type ExportMonthlyReportParams = {
    logoUrl?: string // default: '/assets/images/lepharo.png'
    filenameBase?: string
}

/** -----------------------------
 * Main export
 * ------------------------------ */
export async function exportMonthlyDepartmentReportDocx(
    data: MonthlyReportData,
    params: ExportMonthlyReportParams = {}
) {
    const { logoUrl = '/assets/images/lepharo.png' } = params

    const logoBuf = await safeFetchArrayBuffer(logoUrl)

    const doc = new DDocument({
        sections: [
            {
                properties: {},
                headers: {
                    default: buildHeader(logoBuf, data.meta)
                },
                footers: {
                    default: buildFooter()
                },
                children: [
                    ...buildCoverPage(data.meta),
                    pageBreak(),
                    ...buildTOCPlaceholder(),
                    pageBreak(),

                    heading('1. Executive Summary', 1),
                    para(data.executiveSummary),
                    spacer(),

                    heading('2. Introduction', 1),
                    para(
                        data.introduction ||
                        'This section outlines the department mandate and how it contributes to programme objectives.'
                    ),
                    spacer(),

                    // --- Section 3 (always present)
                    heading('3. Departmental KPIs & Performance Summary', 1),
                    ...(data.kpis?.length
                        ? [
                            ...buildKpiTable(data.kpis),
                            spacer(),
                            ...buildKpiNarratives(data.kpis)
                        ]
                        : [
                            para(
                                'No KPI performance data was captured for this reporting period.'
                            ),
                            spacer(6)
                        ]),

                    ...(data.charts?.length
                        ? [
                            heading('3.3 Performance Visualisations', 2),
                            ...buildChartsBlock(data.charts),
                            spacer()
                        ]
                        : [
                            para('No visualisations available for this reporting period.'),
                            spacer(6)
                        ]),

                    // --- Section 4 (always present)
                    heading('4. Progress To Date', 1),
                    ...(data.progressNarratives?.length
                        ? data.progressNarratives.flatMap(p => [
                            heading(p.title, 2),
                            para(p.body),
                            spacer(6)
                        ])
                        : [
                            para(
                                'Progress narratives will be added in the next iteration of reporting.'
                            ),
                            spacer()
                        ]),

                    // --- Section 5 (always present)
                    heading('5. Beneficiary / SMME Statistics', 1),
                    ...(data.beneficiaryStats
                        ? [...buildBeneficiaryBlock(data.beneficiaryStats), spacer()]
                        : [
                            para(
                                'Beneficiary statistics are not available for this reporting period.'
                            ),
                            spacer()
                        ]),

                    ...(data.servicesCatalogue?.length
                        ? [
                            heading('6. Services & Interventions Delivered', 1),
                            heading('6.1 Service Catalogue', 2),
                            ...buildServicesCatalogueTable(data.servicesCatalogue),
                            spacer()
                        ]
                        : [heading('6. Services & Interventions Delivered', 1)]),

                    heading('6.2 Monthly Intervention Tracker', 2),
                    ...(data.interventionsThisMonth?.length
                        ? buildInterventionsTable(data.interventionsThisMonth)
                        : [para('No interventions recorded for this reporting period.')]),
                    spacer(),

                    ...(data.engagementsWithoutMOV?.length
                        ? [
                            heading('6.3 Engagements Without MOV', 2),
                            ...buildInterventionsTable(data.engagementsWithoutMOV)
                        ]
                        : []),

                    ...(data.systemUsage
                        ? [
                            spacer(),
                            heading(`7. ${data.systemUsage.systemName} Usage`, 1),
                            ...(data.systemUsage.narrative
                                ? [para(data.systemUsage.narrative)]
                                : []),
                            ...(data.systemUsage.metrics?.length
                                ? buildKeyValueTable(data.systemUsage.metrics)
                                : [])
                        ]
                        : []),

                    ...(data.successStories?.length
                        ? [
                            spacer(),
                            heading('8. Success Stories / Highlights', 1),
                            ...data.successStories.flatMap((s, idx) => [
                                heading(s.title || `Success Story ${idx + 1}`, 2),
                                bulletList([
                                    `Context: ${s.context}`,
                                    `Intervention: ${s.intervention}`,
                                    `Outcome: ${s.outcome}`
                                ]),
                                spacer(6)
                            ])
                        ]
                        : []),

                    ...(data.challengesAndRisks?.length
                        ? [
                            heading('9. Challenges & Risks', 1),
                            ...buildRisksTable(data.challengesAndRisks)
                        ]
                        : []),

                    ...(data.correctiveActionsNextMonth?.length
                        ? [
                            spacer(),
                            heading('10. Corrective Actions & Next Month Plan', 1),
                            ...buildActionsTable(data.correctiveActionsNextMonth)
                        ]
                        : []),

                    spacer(),
                    heading('11. Conclusion', 1),
                    para(
                        data.conclusion ||
                        'Overall performance for the reporting period is noted above. The department will focus on the corrective actions outlined to improve delivery next month.'
                    ),

                    spacer(),
                    heading('12. Sign-off', 1),
                    ...buildSignOff(data)
                ]
            }
        ]
    })

    const blob = await Packer.toBlob(doc)
    const base =
        params.filenameBase ||
        `${safeFile(data.meta.departmentName)}-${safeFile(
            data.meta.periodLabel
        )}-Monthly-Report`
    saveAs(blob, `${base}.docx`)
}

/** -----------------------------
 * Header / Footer
 * ------------------------------ */

function buildHeader(logoBuf: ArrayBuffer | null, meta: ReportMeta) {
    const title = meta.companyName || 'Departmental Monthly Report'

    // ✅ prefer name, fall back to scopeLabel, finally programId
    const programLabel =
    meta.name ||
    (meta.programId ? `Program: ${meta.programId}` : '')


    const subtitleParts = [
        meta.departmentName,
        meta.periodLabel,
        programLabel
    ].filter(Boolean)

    const subtitle = subtitleParts.join(' • ')

    const rightMetaRows: Array<[string, string]> = [
        ['Form No', meta.formNo || '—'],
        ['Rev No', meta.revisionNo || '—'],
        ['Effective Date', meta.effectiveDate || '—']
    ]

    return new Header({
        children: [
            new DTable({
                width: { size: 100, type: WidthType.PERCENTAGE },
                layout: TableLayoutType.FIXED,
                rows: [
                    new DRow({
                        children: [
                            new DCell({
                                width: { size: 25, type: WidthType.PERCENTAGE },
                                borders: noBorders(),
                                children: [
                                    new Paragraph({
                                        children: logoBuf
                                            ? [
                                                new ImageRun({
                                                    data: logoBuf,
                                                    transformation: { width: 90, height: 36 }
                                                })
                                            ]
                                            : [new TextRun({ text: '' })]
                                    })
                                ]
                            }),
                            new DCell({
                                width: { size: 50, type: WidthType.PERCENTAGE },
                                borders: noBorders(),
                                children: [
                                    new Paragraph({
                                        children: [
                                            new TextRun({ text: title, bold: true, size: 26 })
                                        ],
                                        alignment: AlignmentType.LEFT
                                    }),
                                    new Paragraph({
                                        children: [new TextRun({ text: subtitle, size: 20 })],
                                        alignment: AlignmentType.LEFT
                                    })
                                ]
                            }),
                            new DCell({
                                width: { size: 25, type: WidthType.PERCENTAGE },
                                borders: noBorders(),
                                children: rightMetaRows.map(
                                    ([k, v]) =>
                                        new Paragraph({
                                            children: [
                                                new TextRun({ text: `${k}: `, bold: true, size: 18 }),
                                                new TextRun({ text: v, size: 18 })
                                            ],
                                            alignment: AlignmentType.RIGHT
                                        })
                                )
                            })
                        ]
                    })
                ]
            }),
            // subtle divider line
            new Paragraph({
                children: [new TextRun({ text: ' ', size: 1 })],
                border: {
                    bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D9D9D9' }
                }
            })
        ]
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

function buildFooter() {
    return new Footer({
        children: [
            new Paragraph({
                children: [
                    new TextRun('Page '),
                    PageNumber.CURRENT,
                    new TextRun(' of '),
                    PageNumber.TOTAL_PAGES
                ],
                alignment: AlignmentType.CENTER
            })
        ]
    })
}

function periodEndDateFromLabel(periodLabel: string) {
    // expects "July 2025"
    const parsed = dayjs(periodLabel, 'MMMM YYYY', true)
    if (!parsed.isValid()) return dayjs().format('DD MMM YYYY')
    return parsed.endOf('month').format('DD MMM YYYY')
}
const fetchProgramTitle = async (programId: string) => {
    try {
      const snap = await getDoc(doc(db, 'programs', programId))
      if (!snap.exists()) return programId
      const data = snap.data() as any
      return (data?.name || data?.programName || data?.title || programId).toString().trim()
    } catch {
      return programId
    }
  }

/** -----------------------------
 * Cover page
 * ------------------------------ */

function buildCoverPage(meta: ReportMeta) {
    const lines = [
        { label: 'Department', value: meta.departmentName },
        { label: 'Reporting Period', value: meta.periodLabel },
        ...(meta.name ? [{ label: 'Programme', value: meta.name }] : []),
        ...(meta.formNo ? [{ label: 'Form No', value: meta.formNo }] : []),
        ...(meta.revisionNo
            ? [{ label: 'Revision No', value: meta.revisionNo }]
            : []),
        ...(meta.effectiveDate
            ? [{ label: 'Effective Date', value: meta.effectiveDate }]
            : []),
        ...(meta.preparedBy
            ? [{ label: 'Prepared By', value: meta.preparedBy }]
            : []),
        ...(meta.reviewedBy
            ? [{ label: 'Reviewed By', value: meta.reviewedBy }]
            : []),
        ...(meta.approvedBy
            ? [{ label: 'Approved By', value: meta.approvedBy }]
            : [])
    ]

    return [
        new Paragraph({
            text: 'DEPARTMENTAL MONTHLY REPORT',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER
        }),
        spacer(18),
        new Paragraph({
            text: meta.departmentName.toUpperCase(),
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER
        }),
        spacer(18),
        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            rows: lines.map(
                x =>
                    new DRow({
                        children: [
                            cell(x.label, { bold: true, shading: 'F3F5F7' }),
                            cell(x.value || '—')
                        ]
                    })
            )
        })
    ]
}

/** -----------------------------
 * TOC placeholder
 * docx supports TOC fields but rendering varies; we keep a placeholder heading.
 * ------------------------------ */
function buildTOCPlaceholder() {
    return [
        new Paragraph({
            text: 'TABLE OF CONTENTS',
            heading: HeadingLevel.HEADING_1
        }),
        para(
            'If you need an auto-updating TOC, open the file in Word and Update Fields (Ctrl+A → F9).'
        )
    ]
}

/** -----------------------------
 * KPI section
 * ------------------------------ */
function buildKpiTable(kpis: KPIItem[]) {
    const head = new DRow({
        children: [
            headerCell('KPI'),
            headerCell('Annual Target'),
            headerCell('Monthly Target'),
            headerCell('Achieved'),
            headerCell('YTD Total'),
            headerCell('Status')
        ]
    })

    const rows = kpis.map(
        k =>
            new DRow({
                children: [
                    cell(k.kpi),
                    cell(val(k.annualTarget)),
                    cell(val(k.monthlyTarget)),
                    cell(val(k.achieved)),
                    cell(val(k.ytdTotal)),
                    cell(statusLabel(k.status), { align: AlignmentType.CENTER })
                ]
            })
    )

    return [
        heading('3.1 KPI Performance Overview', 2),
        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            rows: [head, ...rows]
        })
    ]
}

function buildKpiNarratives(kpis: KPIItem[]) {
    const narr = kpis.filter(k => (k.narrative || '').trim().length > 0)
    if (!narr.length) return []
    return [
        heading('3.2 KPI Progress Narrative', 2),
        ...narr.flatMap(k => [heading(k.kpi, 3), para(k.narrative!), spacer(6)])
    ]
}

function buildChartsBlock(charts: ReportChartImage[]) {
    return charts.flatMap(c => [
        heading(c.title, 3),
        chartImage(c.pngDataUrl, c.width ?? 620, c.height ?? 320),
        ...(c.caption ? [para(c.caption)] : []),
        spacer(6)
    ])
}

function chartImage(dataUrl: string, width: number, height: number) {
    const buf = dataUrlToArrayBuffer(dataUrl)
    if (!buf) return para('Chart unavailable.')

    return new Paragraph({
        children: [
            new ImageRun({
                data: buf,
                transformation: { width, height }
            })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 }
    })
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | null {
    try {
        const base64 = dataUrl.split(',')[1]
        if (!base64) return null
        const binary = atob(base64)
        const len = binary.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
    } catch {
        return null
    }
}

/** -----------------------------
 * Beneficiary / SMME Stats
 * ------------------------------ */
function buildKeyValueTable(
    rows: Array<{ label: string; value: string | number }>,
    opts?: { columns?: 2 | 3 }
  ) {
    const cols = opts?.columns ?? 2
    const safeRows = (rows || []).filter(r => String(r?.label || "").trim().length > 0)

    if (!safeRows.length) return [para("No statistics available.")]

    // chunk rows into groups of `cols`
    const chunked: Array<Array<{ label: string; value: string | number }>> = []
    for (let i = 0; i < safeRows.length; i += cols) chunked.push(safeRows.slice(i, i + cols))

    return [
      new DTable({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: chunked.map(group => {
          const cells: DCell[] = []

          group.forEach(item => {
            cells.push(cell(item.label, { bold: true, shading: "F3F5F7" }))
            cells.push(cell(String(item.value ?? "—")))
          })

          // If last row has fewer than cols, pad empty pairs
          const missing = cols - group.length
          for (let i = 0; i < missing; i++) {
            cells.push(cell("", { bold: true, shading: "F3F5F7" }))
            cells.push(cell("—"))
          }

          return new DRow({ children: cells })
        })
      })
    ]
  }


function buildBeneficiaryBlock(stats: BeneficiaryStats) {
    const quick = [
        { label: 'Total Assigned', value: stats.totalAssigned },
        { label: 'Serviced This Month', value: stats.servicedThisMonth },
        { label: 'Not Serviced', value: stats.notServiced }
    ]

    const blocks: any[] = [
        heading('5.1 Beneficiary Coverage', 2),
        ...buildKeyValueTable(
            quick.map(x => ({ label: x.label, value: val(x.value) }))
        )
    ]

    if (stats.notServicedReasons?.length) {
        blocks.push(spacer(6))
        blocks.push(heading('Not Serviced Reasons', 3))
        blocks.push(
            new DTable({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                    new DRow({
                        children: [
                            headerCell('Reason'),
                            headerCell('Count'),
                            headerCell('Notes')
                        ]
                    }),
                    ...stats.notServicedReasons.map(
                        r =>
                            new DRow({
                                children: [
                                    cell(r.reason),
                                    cell(val(r.count)),
                                    cell(r.notes || '—')
                                ]
                            })
                    )
                ]
            })
        )
    }

    if (stats.distributions?.length) {
        blocks.push(spacer())
        blocks.push(heading('5.2 Distribution Analysis', 2))
        stats.distributions.forEach(d => {
            blocks.push(heading(d.label, 3))
            blocks.push(
                new DTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        new DRow({
                            children: [headerCell('Category'), headerCell('Value')]
                        }),
                        ...d.rows.map(
                            r => new DRow({ children: [cell(r.name), cell(String(r.value))] })
                        )
                    ]
                })
            )
            blocks.push(spacer(6))
        })
    }

    return blocks
}

/** -----------------------------
 * Services catalogue
 * ------------------------------ */
function buildServicesCatalogueTable(
    items: Array<{ name: string; description: string }>
) {
    return [
        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new DRow({
                    children: [
                        headerCell('Service / Intervention'),
                        headerCell('Description')
                    ]
                }),
                ...items.map(
                    i => new DRow({ children: [cell(i.name), cell(i.description)] })
                )
            ]
        })
    ]
}

/** -----------------------------
 * Intervention tracker table
 * ------------------------------ */
function buildInterventionsTable(rows: InterventionRow[]) {
    return [
        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            rows: [
                new DRow({
                    children: [
                        headerCell('SMME'),
                        headerCell('Contact'),
                        headerCell('Stage'),
                        headerCell('Sector'),
                        headerCell('Intervention'),
                        headerCell('MOV'),
                        headerCell('Date')
                    ]
                }),
                ...rows.map(
                    r =>
                        new DRow({
                            children: [
                                cell(r.smmeName),
                                cell(r.contact || '—'),
                                cell(r.stage || '—'),
                                cell(r.sector || '—'),
                                cell(r.intervention),
                                cell(r.movAttached ? 'Yes' : 'No', {
                                    align: AlignmentType.CENTER
                                }),
                                cell(r.date ? formatDate(r.date) : '—')
                            ]
                        })
                )
            ]
        })
    ]
}

/** -----------------------------
 * Risks & actions
 * ------------------------------ */
function buildRisksTable(rows: RiskRow[]) {
    return [
        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new DRow({
                    children: [
                        headerCell('Issue'),
                        headerCell('Impact'),
                        headerCell('Root Cause'),
                        headerCell('Mitigation')
                    ]
                }),
                ...rows.map(
                    r =>
                        new DRow({
                            children: [
                                cell(r.issue),
                                cell(r.impact),
                                cell(r.rootCause || '—'),
                                cell(r.mitigation)
                            ]
                        })
                )
            ]
        })
    ]
}

function buildActionsTable(rows: ActionRow[]) {
    return [
        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new DRow({
                    children: [
                        headerCell('Action'),
                        headerCell('Responsible'),
                        headerCell('Deadline')
                    ]
                }),
                ...rows.map(
                    a =>
                        new DRow({
                            children: [cell(a.action), cell(a.responsible), cell(a.deadline)]
                        })
                )
            ]
        })
    ]
}

/** -----------------------------
 * Sign-off
 * ------------------------------ */
function buildSignOff(data: MonthlyReportData) {
    const s = data.signOff || {}

    // ✅ default dates to end of reporting month (NOT "today")
    const defaultDate = data.meta?.periodLabel
        ? periodEndDateFromLabel(data.meta.periodLabel)
        : dayjs().format('DD MMM YYYY')

    const declDate = s.declarerDate || defaultDate
    const revDate = s.reviewerDate || defaultDate
    const appDate = s.approverDate || defaultDate

    const declaration = s.declarerName
        ? `I, ${s.declarerName}, acknowledge that the information provided herein is a true reflection of the performance for the period indicated.`
        : 'I hereby acknowledge that the information provided herein is a true reflection of the performance for the period indicated.'

    // ✅ defaults (no more forced "M&E HOD")
    const declRole = s.declarerRole || `HOD — ${data.meta.departmentName}`
    const revRole = s.reviewerRole || 'Programme Manager / ROM'
    const appRole = s.approverRole || 'Director / CEO'

    return [
        para(declaration),
        spacer(6),

        new DTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            rows: [
                new DRow({
                    children: [
                        cell('Declared By', { bold: true, shading: 'F3F5F7' }),
                        cell(s.declarerName || '—'),
                        cell('Date', { bold: true, shading: 'F3F5F7' }),
                        cell(declDate)
                    ]
                }),
                new DRow({
                    children: [
                        cell('Role', { bold: true, shading: 'F3F5F7' }),
                        cell(declRole),
                        cell('Signature', { bold: true, shading: 'F3F5F7' }),
                        cell('_____________________')
                    ]
                }),

                new DRow({
                    children: [
                        cell('Reviewed By', { bold: true, shading: 'F3F5F7' }),
                        cell(s.reviewerName || '—'),
                        cell('Date', { bold: true, shading: 'F3F5F7' }),
                        cell(revDate)
                    ]
                }),
                new DRow({
                    children: [
                        cell('Role', { bold: true, shading: 'F3F5F7' }),
                        cell(revRole),
                        cell('Signature', { bold: true, shading: 'F3F5F7' }),
                        cell('_____________________')
                    ]
                }),

                new DRow({
                    children: [
                        cell('Approved By', { bold: true, shading: 'F3F5F7' }),
                        cell(s.approverName || '—'),
                        cell('Date', { bold: true, shading: 'F3F5F7' }),
                        cell(appDate)
                    ]
                }),
                new DRow({
                    children: [
                        cell('Role', { bold: true, shading: 'F3F5F7' }),
                        cell(appRole),
                        cell('Signature', { bold: true, shading: 'F3F5F7' }),
                        cell('_____________________')
                    ]
                })
            ]
        })
    ]
}

/** -----------------------------
 * Small helpers
 * ------------------------------ */

function heading(text: string, level: 1 | 2 | 3) {
    const map = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3
    } as const
    return new Paragraph({ text, heading: map[level] })
}

function para(text: string) {
    return new Paragraph({
        children: [new TextRun({ text: text || '', size: 22 })],
        spacing: { after: 180 }
    })
}

function bulletList(items: string[]) {
    return items.map(i => new Paragraph({ text: i, bullet: { level: 0 } }))
}

function spacer(lines: number = 10) {
    return new Paragraph({
        children: [new TextRun({ text: ' '.repeat(1) })],
        spacing: { after: lines * 120 }
    })
}

function pageBreak() {
    return new Paragraph({ children: [new TextRun({ break: 1 })] })
}

function headerCell(text: string) {
    return cell(text, {
        bold: true,
        shading: 'EAF2FF',
        align: AlignmentType.CENTER
    })
}

function cell(
    text: string,
    opts?: { bold?: boolean; shading?: string; align?: AlignmentType }
) {
    return new DCell({
        width: { size: 1, type: WidthType.AUTO },
        children: [
            new Paragraph({
                children: [
                    new TextRun({
                        text: String(text ?? ''),
                        bold: !!opts?.bold
                    })
                ],
                alignment: opts?.align
            })
        ],
        shading: opts?.shading ? { fill: opts.shading } : undefined,
        borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' }
        }
    })
}

function statusLabel(s?: KPIStatus) {
    if (s === 'green') return '🟢'
    if (s === 'amber') return '🟠'
    if (s === 'red') return '🔴'
    return '—'
}

function val(v: any) {
    if (v === 0) return '0'
    return v == null || v === '' ? '—' : String(v)
}

function formatDate(d: string) {
    const parsed = dayjs(d)
    return parsed.isValid() ? parsed.format('DD MMM YYYY') : d
}

function safeFile(s: string) {
    return String(s || 'Report')
        .replace(/[^\w\s.-]+/g, '')
        .replace(/\s+/g, '-')
        .trim()
}

async function safeFetchArrayBuffer(url: string) {
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        return await res.arrayBuffer()
    } catch {
        return null
    }
}
