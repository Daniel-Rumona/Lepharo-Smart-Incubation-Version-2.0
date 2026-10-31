// PDF export for an IPM performance compact: letterhead, employee block,
// the weighted KPAs per section, competencies, the personal development
// plan, review scores, and the line manager / employee / HR sign-off.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
    PDP_STATUSES,
    PDP_TYPES,
    SECTIONS,
    STANDARDS,
    compactStatus,
    COMPACT_STATUS_META,
    ratingLabel,
    type CompactContent,
    type PerformanceCycle,
    type Signoff
} from './ipm'

const LOGO_PATH = '/assets/images/lepharo.png'
const HEAD_FILL: [number, number, number] = [220, 230, 245]

/** Draws a same-origin or CORS-enabled image to a data URL; null if it cannot. */
function loadImage(src: string): Promise<string | null> {
    return new Promise(resolve => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas')
                canvas.width = img.width
                canvas.height = img.height
                canvas.getContext('2d')?.drawImage(img, 0, 0)
                resolve(canvas.toDataURL('image/png'))
            } catch {
                resolve(null)
            }
        }
        img.onerror = () => resolve(null)
        img.src = src
    })
}

const formatDate = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

const lastY = (pdf: jsPDF) => (pdf as any).lastAutoTable.finalY as number

export async function downloadCompactPdf(args: {
    cycle: PerformanceCycle
    employee: { name: string; position?: string; department?: string }
    lineManagerName?: string
    content: CompactContent
    signoff: Signoff
    scores: { midYear: number | null; yearEnd: number | null }
}) {
    const { cycle, employee, lineManagerName, content, signoff, scores } = args
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const margin = 15

    // Letterhead
    pdf.setLineWidth(0.5)
    pdf.rect(margin, 10, pageWidth - 2 * margin, 20)
    const logo = await loadImage(LOGO_PATH)
    if (logo) pdf.addImage(logo, 'PNG', margin + 2, 12, 35, 16)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text('PERFORMANCE COMPACT', pageWidth / 2, 20, { align: 'center' })
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Individual performance management · ${cycle.label}`, pageWidth / 2, 25, { align: 'center' })
    pdf.text(`Status: ${COMPACT_STATUS_META[compactStatus(signoff)].label}`, pageWidth - margin - 2, 14, { align: 'right' })

    autoTable(pdf, {
        startY: 34,
        body: [
            ['Employee', employee.name, 'Period', `${formatDate(cycle.startDate)} – ${formatDate(cycle.endDate)}`],
            ['Position', employee.position || '-', 'Department', employee.department || '-'],
            ['Line manager', lineManagerName || '-', 'Rating scale', '1 Very unsatisfactory – 5 Exceptional']
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 }, 2: { fontStyle: 'bold', cellWidth: 28 } },
        margin: { left: margin, right: margin }
    })
    let y = lastY(pdf) + 6

    for (const section of SECTIONS) {
        const weight = content.sectionWeights[section.key]
        const items = content.items.filter(item => item.section === section.key)
        if (!weight && !items.length) continue
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10)
        pdf.text(`${section.label} (${weight}% of compact)`, margin, y)
        const isCompetency = section.key === 'competencies'
        autoTable(pdf, {
            startY: y + 2,
            head: [
                isCompetency
                    ? ['Competency', 'Expected behaviours', 'Required proficiency', 'Weight']
                    : ['KPA', 'KPI', 'Standard', 'Target', 'Evidence', 'Weight']
            ],
            body: items.map(item =>
                isCompetency
                    ? [item.kpa, item.kpi || '', item.requiredLevel ? `Level ${item.requiredLevel}` : '-', `${item.weight}%`]
                    : [
                          item.kpa,
                          item.kpi || '',
                          STANDARDS.find(s => s.value === item.standard)?.label || '-',
                          item.target || '-',
                          item.evidence || '-',
                          `${item.weight}%`
                      ]
            ),
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 1.8, valign: 'top' },
            headStyles: { fillColor: HEAD_FILL, textColor: 20, fontStyle: 'bold' },
            columnStyles: isCompetency ? { 3: { cellWidth: 16 } } : { 0: { cellWidth: 32 }, 2: { cellWidth: 22 }, 5: { cellWidth: 14 } },
            margin: { left: margin, right: margin }
        })
        y = lastY(pdf) + 6
    }

    const pdp = content.pdp || []
    if (pdp.length) {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10)
        pdf.text('Personal development plan', margin, y)
        autoTable(pdf, {
            startY: y + 2,
            head: [['Development need', 'Action', 'Support', 'Due', 'Progress']],
            body: pdp.map(goal => [
                goal.need,
                `${PDP_TYPES.find(t => t.value === goal.type)?.label || ''}: ${goal.action}`,
                goal.support || '-',
                formatDate(goal.dueDate) || '-',
                PDP_STATUSES.find(s => s.value === goal.status)?.label || ''
            ]),
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 1.8, valign: 'top' },
            headStyles: { fillColor: HEAD_FILL, textColor: 20, fontStyle: 'bold' },
            margin: { left: margin, right: margin }
        })
        y = lastY(pdf) + 6
    }

    const score = (value: number | null) => (value === null ? 'Not complete' : `${value.toFixed(2)} – ${ratingLabel(value)}`)
    autoTable(pdf, {
        startY: y,
        head: [['Review', 'Weighted rating']],
        body: [
            ['Mid-year review', score(scores.midYear)],
            ['Year-end review', score(scores.yearEnd)]
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: HEAD_FILL, textColor: 20, fontStyle: 'bold' },
        margin: { left: margin, right: margin }
    })
    y = lastY(pdf) + 8

    // Sign-off: signature images where the browser may read them, else names.
    const roles = [
        ['manager', 'Line manager'],
        ['employee', 'Employee'],
        ['hr', 'HR compliance']
    ] as const
    const images = await Promise.all(
        roles.map(([role]) => (signoff[role]?.signatureURL ? loadImage(signoff[role]!.signatureURL!) : Promise.resolve(null)))
    )
    if (y > pdf.internal.pageSize.getHeight() - 50) {
        pdf.addPage()
        y = 20
    }
    autoTable(pdf, {
        startY: y,
        head: [['Sign-off', 'Name', 'Signature', 'Date']],
        body: roles.map(([role, label]) => [
            label,
            signoff[role]?.name || '',
            signoff[role] && !images[roles.findIndex(([r]) => r === role)] ? 'Signed electronically' : '',
            signoff[role] ? formatDate(signoff[role]!.at) : ''
        ]),
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, minCellHeight: 14, valign: 'middle' },
        headStyles: { fillColor: [200, 200, 200], textColor: 20, fontStyle: 'bold' },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 }, 2: { cellWidth: 50 } },
        margin: { left: margin, right: margin },
        didDrawCell: data => {
            if (data.section !== 'body' || data.column.index !== 2) return
            const image = images[data.row.index]
            if (image) pdf.addImage(image, 'PNG', data.cell.x + 2, data.cell.y + 1, 40, data.cell.height - 2)
        }
    })

    pdf.save(`Performance-Compact-${cycle.label}-${employee.name}.pdf`.replace(/[\\/:*?"<>|\s]+/g, '-'))
}
