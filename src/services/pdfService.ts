import jsPDF from 'jspdf'
import { MOVDocument } from '@/types/mov'
import { getAgreementTemplate } from '@/services/complianceResolver'

/**
 * Generate a simplified PDF MOV document
 */
export const generateMOVPDF = async (movData: MOVDocument): Promise<void> => {
  const template = await getAgreementTemplate('mov')
  const doc = new jsPDF('portrait', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.width
  
  // Header section
  doc.setFillColor(255, 165, 0) // Orange header
  doc.rect(10, 10, pageWidth - 20, 25, 'F')
  
  // Lepharo logo area
  doc.setFillColor(255, 255, 255)
  doc.rect(15, 12, 40, 21, 'F')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text('Lepharo', 18, 20)
  doc.text('Smart Incubation', 18, 25)
  
  // Client name area
  doc.setFillColor(255, 255, 255)
  doc.rect(60, 12, 80, 21, 'F')
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(movData.beneficiaryName || 'Client Name', 65, 25)
  
  // Title section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('CONFIRMATION SHEET FOR RECEIVING BDS (MOV)', 10, 45)
  
  // Form details
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Form No: ${template?.formNo || '—'}`, 10, 55)
  doc.text(`Revision No: ${template?.revisionNo || '—'}`, 10, 60)
  doc.text(`Effective date: ${template?.effectiveDate || '—'}`, 10, 65)
  
  let yPos = 80
  
  // SMME Details section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('SMME Details', 10, yPos)
  yPos += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Company Name: ${movData.beneficiaryName || 'N/A'}`, 10, yPos)
  yPos += 8
  doc.text(`Contact Person: ${movData.beneficiaryName || 'N/A'}`, 10, yPos)
  yPos += 8
  doc.text(`Contact Number: N/A`, 10, yPos)
  yPos += 8
  doc.text(`Email Address: N/A`, 10, yPos)
  yPos += 15
  
  // Group Stage section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Group Stage (Please tick applicable box)', 10, yPos)
  yPos += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('☐ Group Stage A', 10, yPos)
  doc.text('☐ Group Stage B', 60, yPos)
  doc.text('☐ Group Stage C', 110, yPos)
  yPos += 15
  
  // Intervention Methods section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Intervention Methods (Please tick applicable box)', 10, yPos)
  yPos += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('☐ In-person', 10, yPos)
  doc.text('☐ Online', 60, yPos)
  doc.text('☐ Telephonic', 110, yPos)
  yPos += 15
  
  // Frequency section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Frequency (Please tick applicable box)', 10, yPos)
  yPos += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('☐ Once a month', 10, yPos)
  doc.text('☐ Every two weeks', 60, yPos)
  doc.text('☐ Weekly', 130, yPos)
  yPos += 15
  
  // Interventions section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Interventions Received', 10, yPos)
  yPos += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  
  // Simple table headers
  doc.setFont('helvetica', 'bold')
  doc.text('Date', 10, yPos)
  doc.text('Intervention Type', 40, yPos)
  doc.text('Facilitator', 120, yPos)
  yPos += 8
  
  // Add line under headers
  doc.line(10, yPos - 2, pageWidth - 10, yPos - 2)
  yPos += 5
  
  doc.setFont('helvetica', 'normal')
  
  // Add intervention data
  if (movData.interventionDetails && movData.interventionDetails.length > 0) {
    movData.interventionDetails.forEach((intervention) => {
      if (yPos > 250) { // Start new page if needed
        doc.addPage()
        yPos = 20
      }
      
      const date = intervention.dateCompleted?.toLocaleDateString('en-GB') || 'N/A'
      doc.text(date, 10, yPos)
      doc.text(intervention.type || 'N/A', 40, yPos)
      doc.text(intervention.facilitator || 'N/A', 120, yPos)
      yPos += 8
    })
  } else {
    doc.text('No interventions recorded', 10, yPos)
    yPos += 8
  }
  
  yPos += 15
  
  // Signature section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Signatures', 10, yPos)
  yPos += 15
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Facilitator Name: _____________________', 10, yPos)
  doc.text('Signature: _____________________', 110, yPos)
  yPos += 15
  
  doc.text('Client Name: _____________________', 10, yPos)
  doc.text('Signature: _____________________', 110, yPos)
  yPos += 15
  
  doc.text('Final Checker Name: _____________________', 10, yPos)
  doc.text('Signature: _____________________', 110, yPos)
  yPos += 10
  
  doc.text('Date Checked: _____________________', 10, yPos)
  
  // Generate filename and download
  const filename = `MOV_${movData.beneficiaryName}_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(filename)
}

/**
 * Download MOV as PDF
 */
export const downloadMOVPDF = async (movData: MOVDocument): Promise<void> => {
  try {
    await generateMOVPDF(movData)
  } catch (error) {
    console.error('Error downloading MOV PDF:', error)
    throw error
  }
} 
