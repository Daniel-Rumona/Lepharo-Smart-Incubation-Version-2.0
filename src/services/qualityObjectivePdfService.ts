// PDF export for Quality Objectives (LEP-QMS 024 F)
// Reproduces the paper form layout: letterhead with logo/form info,
// department/period block, objective statement, steps table, and the
// Prepared by / Approved by CEO / Acknowledged by HOD sign-off block.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { QualityObjective } from '@/types/types'

const LOGO_PATH = '/assets/images/lepharo.png'

async function loadLogoAsBase64(): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch (error) {
        console.warn('Failed to convert Lepharo logo to base64:', error)
        resolve(null)
      }
    }

    img.onerror = () => {
      console.warn(`Failed to load Lepharo logo from ${LOGO_PATH}`)
      resolve(null)
    }

    img.src = LOGO_PATH
  })
}

function addLogoFallback(pdf: jsPDF, margin: number): void {
  pdf.rect(margin + 2, 12, 35, 16)
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Lepharo', margin + 19.5, 20, { align: 'center' })
  pdf.text('Logo', margin + 19.5, 24, { align: 'center' })
}

async function addHeader(pdf: jsPDF, pageWidth: number, margin: number, objective: QualityObjective): Promise<void> {
  pdf.setLineWidth(0.5)
  pdf.rect(margin, 10, pageWidth - 2 * margin, 20)

  const logoDataURL = await loadLogoAsBase64()
  if (logoDataURL) {
    try {
      pdf.addImage(logoDataURL, 'PNG', margin + 2, 12, 35, 16)
    } catch (error) {
      console.warn('Failed to add logo to PDF:', error)
      addLogoFallback(pdf, margin)
    }
  } else {
    addLogoFallback(pdf, margin)
  }

  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.text('QUALITY OBJECTIVES', pageWidth / 2, 22, { align: 'center' })

  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  const formInfo = [
    `Form No: ${objective.formNo}`,
    `Revision No: ${objective.revisionNo}`,
    `Effective date: ${objective.effectiveDate}`
  ]
  let yPos = 14
  formInfo.forEach(info => {
    pdf.text(info, pageWidth - margin - 2, yPos, { align: 'right' })
    yPos += 4
  })
}

function formatDate(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

function addDepartmentPeriodBlock(pdf: jsPDF, pageWidth: number, margin: number, objective: QualityObjective, startY: number): number {
  const boxHeight = 16
  pdf.setLineWidth(0.3)
  pdf.rect(margin, startY, pageWidth - 2 * margin, boxHeight)
  pdf.line(pageWidth / 2, startY, pageWidth / 2, startY + boxHeight)

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.text(`DEPARTMENT: ${objective.departmentName}`, margin + 2, startY + 9)

  pdf.setFont('helvetica', 'normal')
  pdf.text(`Start date: ${formatDate(objective.periodStart)}`, pageWidth / 2 + 2, startY + 6)
  pdf.text(`End date: ${formatDate(objective.periodEnd)}`, pageWidth / 2 + 2, startY + 12)

  return startY + boxHeight
}

function addObjectiveStatement(pdf: jsPDF, pageWidth: number, margin: number, objective: QualityObjective, startY: number): number {
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  const text = `Quality Objective ${String(objective.objectiveNumber).padStart(2, '0')}: ${objective.objectiveText}`
  const lines = pdf.splitTextToSize(text, pageWidth - 2 * margin - 4)
  let y = startY + 6
  lines.forEach((line: string) => {
    pdf.text(line, margin + 2, y)
    y += 5
  })
  return y + 3
}

function addSignOffTable(pdf: jsPDF, margin: number, startY: number, objective: QualityObjective): void {
  autoTable(pdf, {
    startY,
    body: [
      ['Prepared by', objective.preparedBy, 'Date', formatDate(objective.preparedDate)],
      ['Approved by CEO', objective.approvedByCEO, '', ''],
      ['Sign', '', '', ''],
      ['Acknowledged by HOD', objective.acknowledgedByHOD, '', ''],
      ['Sign', '', '', '']
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 45 },
      1: { cellWidth: 65 },
      2: { fontStyle: 'bold', cellWidth: 25 },
      3: { cellWidth: 35 }
    },
    margin: { left: margin, right: margin }
  })
}

export async function generateQualityObjectivePDF(objective: QualityObjective): Promise<jsPDF> {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 15

  await addHeader(pdf, pageWidth, margin, objective)
  let y = addDepartmentPeriodBlock(pdf, pageWidth, margin, objective, 32)
  y = addObjectiveStatement(pdf, pageWidth, margin, objective, y)

  autoTable(pdf, {
    startY: y + 2,
    head: [['Reference Number', 'Means/Steps', 'Responsible Person', 'Target date', 'Completion date']],
    body: objective.steps.map((step, index) => [
      index === 0 ? objective.referenceNumber : '',
      `• ${step.description}`,
      step.responsiblePerson,
      step.targetDate,
      step.completionDate
    ]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, valign: 'top' },
    headStyles: { fillColor: [200, 200, 200], textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 65 },
      2: { cellWidth: 35 },
      3: { cellWidth: 25 },
      4: { cellWidth: 28 }
    },
    margin: { left: margin, right: margin }
  })

  const afterTableY = (pdf as any).lastAutoTable.finalY + 10
  addSignOffTable(pdf, margin, afterTableY, objective)

  return pdf
}

export async function downloadQualityObjectivePDF(objective: QualityObjective): Promise<void> {
  const pdf = await generateQualityObjectivePDF(objective)
  const filename = `Quality-Objective-${objective.departmentName}-${objective.referenceNumber || objective.objectiveNumber}.pdf`
    .replace(/[\\/:*?"<>|]/g, '-')
  pdf.save(filename)
}
