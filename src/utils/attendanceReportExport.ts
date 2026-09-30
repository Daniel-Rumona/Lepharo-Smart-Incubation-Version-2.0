// Attendance report export (Word + PDF) for the appointments Session Review.
// Carries the exact same figures the "Story" view narrates — sessions held,
// unique SMEs invited/attended, attendance rate, delivery distribution,
// top covered topics — plus the underlying per-session coverage table, so
// the export is a faithful paper copy of what the story already shows.
// Delivery Distribution and Top Covered Topics are also rendered as real
// charts (via the same Highcharts-to-PNG renderer the monthly reports use),
// and the summary figures are laid out as coloured stat cards rather than a
// plain key/value table.

import dayjs from 'dayjs'
import type { Options as HighchartsOptions } from 'highcharts'
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
    TableLayoutType,
    ImageRun,
    HeadingLevel,
    ShadingType
} from 'docx'
import { saveAs } from 'file-saver'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { renderHighchartsToPngDataUrl } from '@/utils/reportChartRenderer'

export interface AttendanceReportRow {
    date: string
    branchName: string
    title: string
    invited: number
    attended: number
    delivery: string
}

export interface AttendanceReportData {
    /** e.g. "September 2026" or a custom date range label. */
    rangeLabel: string
    /** Optional context shown under the title, e.g. department/branch name. */
    scopeLabel?: string
    sessions: number
    held: number
    invited: number
    attended: number
    invitedInstances?: number
    attendedInstances?: number
    attendanceRate: number
    deliveryCounts: { name: string; y: number }[]
    coveredItems: { topic: string; count: number }[]
    rows: AttendanceReportRow[]
    photos?: AttendanceReportPhoto[]
}

export interface AttendanceReportPhoto {
    url: string
    title: string
    date: string
}

/** A photo with its URL already fetched and decoded, ready to embed. */
type LoadedPhoto = {
    dataUrl: string
    format: 'jpg' | 'png'
    width: number
    height: number
    title: string
    date: string
}

// Coverage sessions can carry a lot of photos; embedding every one would
// make the file huge and slow to build, so the report shows the first few
// and says how many more weren't included.
const MAX_REPORT_PHOTOS = 6

const loadImageAsDataUrl = (url: string) =>
    new Promise<{ dataUrl: string; format: 'jpg' | 'png'; width: number; height: number } | null>(
        (resolve) => {
            fetch(url)
                .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('fetch failed'))))
                .then(
                    (blob) =>
                        new Promise<string>((res, rej) => {
                            const reader = new FileReader()
                            reader.onload = () => res(reader.result as string)
                            reader.onerror = rej
                            reader.readAsDataURL(blob)
                        })
                )
                .then(
                    (dataUrl) =>
                        new Promise<{ dataUrl: string; format: 'jpg' | 'png'; width: number; height: number }>(
                            (res, rej) => {
                                const img = new Image()
                                img.onload = () =>
                                    res({
                                        dataUrl,
                                        format: dataUrl.startsWith('data:image/png') ? 'png' : 'jpg',
                                        width: img.naturalWidth || 1,
                                        height: img.naturalHeight || 1
                                    })
                                img.onerror = rej
                                img.src = dataUrl
                            }
                        )
                )
                .then(resolve)
                .catch(() => resolve(null))
        }
    )

const loadReportPhotos = async (photos?: AttendanceReportPhoto[]): Promise<LoadedPhoto[]> => {
    if (!photos?.length) return []
    const picked = photos.slice(0, MAX_REPORT_PHOTOS)
    const loaded = await Promise.all(
        picked.map(async (photo) => {
            const image = await loadImageAsDataUrl(photo.url)
            return image ? { ...image, title: photo.title, date: photo.date } : null
        })
    )
    return loaded.filter((photo): photo is LoadedPhoto => photo !== null)
}

type StatCard = {
    icon: string
    label: string
    value: string
    /** [R, G, B] */
    rgb: [number, number, number]
    /** hex without # */
    hex: string
    tintHex: string
}

const STAT_PALETTE = {
    blue: { rgb: [22, 119, 255] as [number, number, number], hex: '1677FF', tintHex: 'E6F0FF' },
    purple: { rgb: [114, 46, 209] as [number, number, number], hex: '722ED1', tintHex: 'F1EAFE' },
    green: { rgb: [22, 163, 74] as [number, number, number], hex: '16A34A', tintHex: 'E8F8EE' },
    orange: { rgb: [217, 119, 6] as [number, number, number], hex: 'D97706', tintHex: 'FDF0DF' }
}

const buildStatCards = (data: AttendanceReportData): StatCard[] => [
    {
        icon: '✅',
        label: 'Sessions held',
        value: `${data.held}/${data.sessions}`,
        ...STAT_PALETTE.blue
    },
    {
        icon: '👥',
        label:
            data.invitedInstances && data.invitedInstances !== data.invited
                ? `SMEs invited (${data.invitedInstances} invites)`
                : 'SMEs invited',
        value: String(data.invited),
        ...STAT_PALETTE.purple
    },
    {
        icon: '🙋',
        label:
            data.attendedInstances && data.attendedInstances !== data.attended
                ? `SMEs attended (${data.attendedInstances} attendances)`
                : 'SMEs attended',
        value: String(data.attended),
        ...STAT_PALETTE.green
    },
    {
        icon: '📈',
        label: 'Attendance rate',
        value: `${data.attendanceRate}%`,
        ...STAT_PALETTE.orange
    }
]

const DELIVERY_SLICE_COLORS = ['#1677FF', '#722ED1', '#16A34A', '#D97706', '#DC2626', '#0EA5E9']

// A method nobody used, or a topic nobody covered, is a 0-height/0-slice
// series — clutter, not signal — so both chart builders drop zero entries.
// The tables below them still list every method/topic, zero counts included.
const buildDeliveryChartOptions = (
    deliveryCounts: AttendanceReportData['deliveryCounts']
): HighchartsOptions => ({
    chart: { type: 'pie' },
    title: { text: undefined },
    plotOptions: {
        pie: {
            colors: DELIVERY_SLICE_COLORS,
            dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '13px' } }
        }
    },
    series: [
        {
            type: 'pie',
            name: 'Sessions',
            data: deliveryCounts
                .filter((item) => item.y > 0)
                .map((item) => ({ name: item.name, y: item.y }))
        }
    ]
})

const buildTopicsChartOptions = (
    coveredItems: AttendanceReportData['coveredItems']
): HighchartsOptions => {
    const charted = coveredItems.filter((item) => item.count > 0).slice(0, 8)
    return {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { categories: charted.map((item) => item.topic), labels: { rotation: -25 } },
        yAxis: { min: 0, allowDecimals: false, title: { text: 'Sessions' } },
        plotOptions: { column: { color: '#722ED1' } },
        series: [
            {
                type: 'column',
                name: 'Covered',
                data: charted.map((item) => item.count)
            }
        ]
    }
}

const safeFileSegment = (value: string) =>
    String(value || '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')

const buildFilenameBase = (data: AttendanceReportData) =>
    `Attendance-Report-${safeFileSegment(data.scopeLabel || '')}${
        data.scopeLabel ? '-' : ''
    }${safeFileSegment(data.rangeLabel)}`

/** -----------------------------
 * Word (.docx)
 * ------------------------------ */

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } })

const para = (text: string) =>
    new Paragraph({
        children: [new TextRun({ text: text || '', size: 22 })],
        spacing: { after: 180 }
    })

const docxCell = (
    text: string,
    opts?: { bold?: boolean; shading?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }
) =>
    new TableCell({
        width: { size: 1, type: WidthType.AUTO },
        children: [
            new Paragraph({
                children: [new TextRun({ text: String(text ?? ''), bold: !!opts?.bold })],
                alignment: opts?.align
            })
        ],
        shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
        borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' }
        }
    })

const docxHeaderCell = (text: string) =>
    docxCell(text, { bold: true, shading: 'EAF2FF', align: AlignmentType.CENTER })

const noBorders = () => ({
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
})

const buildBanner = (data: AttendanceReportData) =>
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        shading: { fill: '1677FF', type: ShadingType.CLEAR },
                        borders: noBorders(),
                        margins: { top: 220, bottom: 220, left: 220, right: 220 },
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({ text: '📊 Attendance Report', bold: true, size: 36, color: 'FFFFFF' })
                                ],
                                spacing: { after: 60 }
                            }),
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: data.scopeLabel
                                            ? `${data.scopeLabel} · ${data.rangeLabel}`
                                            : data.rangeLabel,
                                        size: 24,
                                        color: 'E6F0FF'
                                    })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    })

const buildStatCardsTable = (cards: StatCard[]) =>
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: cards.map(
                    (card) =>
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            shading: { fill: card.tintHex, type: ShadingType.CLEAR },
                            margins: { top: 160, bottom: 160, left: 120, right: 120 },
                            borders: {
                                top: { style: BorderStyle.SINGLE, size: 1, color: card.hex },
                                bottom: { style: BorderStyle.SINGLE, size: 1, color: card.hex },
                                left: { style: BorderStyle.SINGLE, size: 1, color: card.hex },
                                right: { style: BorderStyle.SINGLE, size: 1, color: card.hex }
                            },
                            children: [
                                new Paragraph({
                                    children: [new TextRun({ text: card.icon, size: 28 })],
                                    spacing: { after: 40 }
                                }),
                                new Paragraph({
                                    children: [new TextRun({ text: card.value, bold: true, size: 32, color: card.hex })],
                                    spacing: { after: 20 }
                                }),
                                new Paragraph({
                                    children: [new TextRun({ text: card.label, size: 18, color: '595959' })]
                                })
                            ]
                        })
                )
            })
        ]
    })

const chartImage = (dataUrl: string | null, width: number, height: number) => {
    if (!dataUrl) return null
    const buf = dataUrlToArrayBuffer(dataUrl)
    if (!buf) return null

    return new Paragraph({
        children: [new ImageRun({ type: 'png', data: buf, transformation: { width, height } })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
    })
}

const MAX_PHOTO_WIDTH = 380
const MAX_PHOTO_HEIGHT = 260

const photoDisplaySize = (photo: LoadedPhoto) => {
    const aspect = photo.width / photo.height || 1
    let width = MAX_PHOTO_WIDTH
    let height = width / aspect
    if (height > MAX_PHOTO_HEIGHT) {
        height = MAX_PHOTO_HEIGHT
        width = height * aspect
    }
    return { width: Math.round(width), height: Math.round(height) }
}

const buildPhotosBlock = (photos: LoadedPhoto[], totalAvailable: number) => {
    if (!photos.length) return [para('No coverage photos were captured for this range.')]

    const blocks: Paragraph[] = []
    photos.forEach((photo) => {
        const buf = dataUrlToArrayBuffer(photo.dataUrl)
        if (!buf) return
        const { width, height } = photoDisplaySize(photo)

        blocks.push(
            new Paragraph({
                children: [new ImageRun({ type: photo.format, data: buf, transformation: { width, height } })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 40 }
            })
        )

        const caption = [photo.title, photo.date ? dayjs(photo.date).format('YYYY-MM-DD') : '']
            .filter(Boolean)
            .join(' · ')
        if (caption) {
            blocks.push(
                new Paragraph({
                    children: [new TextRun({ text: caption, size: 18, color: '595959', italics: true })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 220 }
                })
            )
        }
    })

    if (totalAvailable > photos.length) {
        blocks.push(para(`+${totalAvailable - photos.length} more photo(s) not included in this report.`))
    }

    return blocks
}

const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer | null => {
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

const buildDeliveryTable = (deliveryCounts: AttendanceReportData['deliveryCounts']) =>
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: [docxHeaderCell('Delivery method'), docxHeaderCell('Sessions')]
            }),
            ...deliveryCounts.map(
                (item, index) =>
                    new TableRow({
                        children: [
                            docxCell(item.name, { shading: index % 2 ? 'F7F9FC' : undefined }),
                            docxCell(String(item.y), {
                                align: AlignmentType.CENTER,
                                shading: index % 2 ? 'F7F9FC' : undefined
                            })
                        ]
                    })
            )
        ]
    })

const buildTopicsTable = (coveredItems: AttendanceReportData['coveredItems']) =>
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: [docxHeaderCell('Topic covered'), docxHeaderCell('Sessions')]
            }),
            ...coveredItems.map(
                (item, index) =>
                    new TableRow({
                        children: [
                            docxCell(item.topic, { shading: index % 2 ? 'F7F9FC' : undefined }),
                            docxCell(String(item.count), {
                                align: AlignmentType.CENTER,
                                shading: index % 2 ? 'F7F9FC' : undefined
                            })
                        ]
                    })
            )
        ]
    })

const buildCoverageTable = (rows: AttendanceReportRow[]) =>
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
            new TableRow({
                children: [
                    docxHeaderCell('Date'),
                    docxHeaderCell('Branch'),
                    docxHeaderCell('Title'),
                    docxHeaderCell('Invited'),
                    docxHeaderCell('Attended'),
                    docxHeaderCell('Delivery')
                ]
            }),
            ...rows.map((row, index) => {
                const shading = index % 2 ? 'F7F9FC' : undefined
                return new TableRow({
                    children: [
                        docxCell(dayjs(row.date).isValid() ? dayjs(row.date).format('YYYY-MM-DD') : row.date, {
                            shading
                        }),
                        docxCell(row.branchName || '—', { shading }),
                        docxCell(row.title || '—', { shading }),
                        docxCell(String(row.invited), { align: AlignmentType.CENTER, shading }),
                        docxCell(String(row.attended), { align: AlignmentType.CENTER, shading }),
                        docxCell(row.delivery || '—', { shading })
                    ]
                })
            })
        ]
    })

export async function exportAttendanceReportDocx(data: AttendanceReportData): Promise<void> {
    const hasDeliveryChart = data.deliveryCounts.some((item) => item.y > 0)
    const hasTopicsChart = data.coveredItems.some((item) => item.count > 0)

    const [deliveryChart, topicsChart, photos] = await Promise.all([
        hasDeliveryChart
            ? renderHighchartsToPngDataUrl(buildDeliveryChartOptions(data.deliveryCounts), {
                  width: 520,
                  height: 320
              }).catch(() => null)
            : Promise.resolve(null),
        hasTopicsChart
            ? renderHighchartsToPngDataUrl(buildTopicsChartOptions(data.coveredItems), {
                  width: 560,
                  height: 320
              }).catch(() => null)
            : Promise.resolve(null),
        loadReportPhotos(data.photos)
    ])

    const doc = new Document({
        sections: [
            {
                properties: {},
                children: [
                    buildBanner(data),
                    para(''),

                    heading('Summary', HeadingLevel.HEADING_1),
                    buildStatCardsTable(buildStatCards(data)),

                    heading('🖥️ Delivery Distribution', HeadingLevel.HEADING_1),
                    ...(data.deliveryCounts.length
                        ? [chartImage(deliveryChart, 380, 230), buildDeliveryTable(data.deliveryCounts)].filter(
                              (n): n is Paragraph | Table => n !== null
                          )
                        : [para('No delivery methods configured.')]),

                    heading('📚 Top Covered Topics', HeadingLevel.HEADING_1),
                    ...(data.coveredItems.length
                        ? [chartImage(topicsChart, 420, 240), buildTopicsTable(data.coveredItems)].filter(
                              (n): n is Paragraph | Table => n !== null
                          )
                        : [para('No covered topics captured for this range.')]),

                    heading('🗓️ Coverage', HeadingLevel.HEADING_1),
                    data.rows.length
                        ? buildCoverageTable(data.rows)
                        : para('No sessions were recorded in this period.'),

                    heading('📷 Coverage Photos', HeadingLevel.HEADING_1),
                    ...buildPhotosBlock(photos, data.photos?.length || 0)
                ]
            }
        ]
    })

    const blob = await Packer.toBlob(doc)
    saveAs(blob, `${buildFilenameBase(data)}.docx`)
}

/** -----------------------------
 * PDF
 * ------------------------------ */

const drawStatCards = (pdf: jsPDF, cards: StatCard[], margin: number, y: number, pageWidth: number) => {
    const gap = 4
    const boxWidth = (pageWidth - 2 * margin - gap * (cards.length - 1)) / cards.length
    const boxHeight = 24

    cards.forEach((card, index) => {
        const x = margin + index * (boxWidth + gap)
        pdf.setFillColor(card.rgb[0], card.rgb[1], card.rgb[2])
        pdf.setDrawColor(card.rgb[0], card.rgb[1], card.rgb[2])
        // Tinted card body with a solid accent bar along the top.
        const [r, g, b] = card.rgb
        pdf.setFillColor(Math.round(r + (255 - r) * 0.9), Math.round(g + (255 - g) * 0.9), Math.round(b + (255 - b) * 0.9))
        pdf.roundedRect(x, y, boxWidth, boxHeight, 2, 2, 'F')
        pdf.setFillColor(r, g, b)
        pdf.roundedRect(x, y, boxWidth, 2.2, 1, 1, 'F')

        pdf.setTextColor(r, g, b)
        pdf.setFontSize(15)
        pdf.setFont('helvetica', 'bold')
        pdf.text(card.value, x + 4, y + 12)

        pdf.setTextColor(80)
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'normal')
        const labelLines = pdf.splitTextToSize(card.label, boxWidth - 8)
        pdf.text(labelLines, x + 4, y + 18)
    })

    pdf.setTextColor(0)
    return y + boxHeight + 10
}

export async function exportAttendanceReportPdf(data: AttendanceReportData): Promise<void> {
    const hasDeliveryChart = data.deliveryCounts.some((item) => item.y > 0)
    const hasTopicsChart = data.coveredItems.some((item) => item.count > 0)

    const [deliveryChart, topicsChart, photos] = await Promise.all([
        hasDeliveryChart
            ? renderHighchartsToPngDataUrl(buildDeliveryChartOptions(data.deliveryCounts), {
                  width: 640,
                  height: 380
              }).catch(() => null)
            : Promise.resolve(null),
        hasTopicsChart
            ? renderHighchartsToPngDataUrl(buildTopicsChartOptions(data.coveredItems), {
                  width: 700,
                  height: 380
              }).catch(() => null)
            : Promise.resolve(null),
        loadReportPhotos(data.photos)
    ])

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 15

    // Banner header.
    pdf.setFillColor(22, 119, 255)
    pdf.rect(0, 0, pageWidth, 26, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(18)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Attendance Report', margin, 14)
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.text(data.scopeLabel ? `${data.scopeLabel} · ${data.rangeLabel}` : data.rangeLabel, margin, 21)
    pdf.setTextColor(0)

    let y = drawStatCards(pdf, buildStatCards(data), margin, 33, pageWidth)

    const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - margin) {
            pdf.addPage()
            y = margin
        }
    }

    const addChartImage = (dataUrl: string | null, aspect: number) => {
        if (!dataUrl) return
        const width = pageWidth - 2 * margin
        const height = width / aspect
        ensureSpace(height + 6)
        pdf.addImage(dataUrl, 'PNG', margin, y, width, height)
        y += height + 8
    }

    if (data.deliveryCounts.length) {
        ensureSpace(14)
        pdf.setFontSize(12)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Delivery Distribution', margin, y + 4)
        y += 8
        addChartImage(deliveryChart, 640 / 380)
        autoTable(pdf, {
            startY: y,
            head: [['Delivery method', 'Sessions']],
            body: data.deliveryCounts.map((item) => [item.name, String(item.y)]),
            theme: 'striped',
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: [22, 119, 255], textColor: 255, fontStyle: 'bold' },
            margin: { left: margin, right: margin }
        })
        y = (pdf as any).lastAutoTable.finalY + 10
    }

    if (data.coveredItems.length) {
        ensureSpace(14)
        pdf.setFontSize(12)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Top Covered Topics', margin, y + 4)
        y += 8
        addChartImage(topicsChart, 700 / 380)
        autoTable(pdf, {
            startY: y,
            head: [['Topic covered', 'Sessions']],
            body: data.coveredItems.map((item) => [item.topic, String(item.count)]),
            theme: 'striped',
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: [114, 46, 209], textColor: 255, fontStyle: 'bold' },
            margin: { left: margin, right: margin }
        })
        y = (pdf as any).lastAutoTable.finalY + 10
    }

    if (data.rows.length) {
        ensureSpace(14)
        pdf.setFontSize(12)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Coverage', margin, y + 4)
        y += 8
        autoTable(pdf, {
            startY: y,
            head: [['Date', 'Branch', 'Title', 'Invited', 'Attended', 'Delivery']],
            body: data.rows.map((row) => [
                dayjs(row.date).isValid() ? dayjs(row.date).format('YYYY-MM-DD') : row.date,
                row.branchName || '—',
                row.title || '—',
                String(row.invited),
                String(row.attended),
                row.delivery || '—'
            ]),
            theme: 'striped',
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [22, 163, 74], textColor: 255, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 28 },
                2: { cellWidth: 62 },
                3: { cellWidth: 18 },
                4: { cellWidth: 20 }
            },
            margin: { left: margin, right: margin }
        })
        y = (pdf as any).lastAutoTable.finalY + 10
    } else {
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'normal')
        pdf.text('No sessions were recorded in this period.', margin, y)
        y += 10
    }

    ensureSpace(14)
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Coverage Photos', margin, y + 4)
    y += 10

    if (!photos.length) {
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'normal')
        pdf.text('No coverage photos were captured for this range.', margin, y)
    } else {
        const maxWidth = pageWidth - 2 * margin
        const maxHeight = 90

        photos.forEach((photo) => {
            const aspect = photo.width / photo.height || 1
            let width = maxWidth
            let height = width / aspect
            if (height > maxHeight) {
                height = maxHeight
                width = height * aspect
            }

            ensureSpace(height + 12)
            const x = margin + (maxWidth - width) / 2
            pdf.addImage(photo.dataUrl, photo.format.toUpperCase(), x, y, width, height)
            y += height + 4

            const caption = [photo.title, photo.date ? dayjs(photo.date).format('YYYY-MM-DD') : '']
                .filter(Boolean)
                .join(' · ')
            if (caption) {
                pdf.setFontSize(9)
                pdf.setFont('helvetica', 'italic')
                pdf.setTextColor(90)
                pdf.text(caption, pageWidth / 2, y, { align: 'center' })
                pdf.setTextColor(0)
                y += 8
            } else {
                y += 4
            }
        })

        const totalAvailable = data.photos?.length || 0
        if (totalAvailable > photos.length) {
            ensureSpace(8)
            pdf.setFontSize(9)
            pdf.setFont('helvetica', 'normal')
            pdf.text(`+${totalAvailable - photos.length} more photo(s) not included in this report.`, margin, y)
        }
    }

    pdf.save(`${buildFilenameBase(data)}.pdf`)
}
