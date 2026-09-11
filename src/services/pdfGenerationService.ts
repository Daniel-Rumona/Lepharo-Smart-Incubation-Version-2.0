// PDF Generation Service for Pre-Incubation Documents
// Generates PDFs that match the exact legal document format

import jsPDF from 'jspdf'
import { PreIncubationDocument } from '@/types/preIncubationDocument'

export class PDFGenerationService {
  
  /**
   * Load logo as base64 data URL
   */
  private static async loadLogoAsBase64(): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      
      img.onload = () => {
        try {
          console.log('✅ Lepharo logo loaded successfully')
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          
          if (!ctx) {
            console.warn('⚠️ Could not get canvas context for logo')
            resolve(null)
            return
          }
          
          canvas.width = img.width
          canvas.height = img.height
          ctx.drawImage(img, 0, 0)
          
          const dataURL = canvas.toDataURL('image/png')
          console.log('🖼️ Logo converted to base64 successfully')
          resolve(dataURL)
        } catch (error) {
          console.warn('Failed to convert logo to base64:', error)
          resolve(null)
        }
      }
      
      img.onerror = () => {
        console.warn('Failed to load Lepharo logo from /assets/images/lepharo.png')
        resolve(null)
      }
      
      // Try multiple potential paths for the logo
      const logoPaths = [
        '/assets/images/lepharo.png',
        '/assets/images/lepharologo.png',
        './assets/images/lepharo.png',
        './public/assets/images/lepharo.png'
      ]
      
      img.src = logoPaths[0] // Start with the primary path
    })
  }

  /**
   * Add logo fallback placeholder
   */
  private static addLogoFallback(pdf: jsPDF, margin: number): void {
    pdf.rect(margin + 2, 12, 35, 16)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text('Lepharo', margin + 19.5, 20, { align: 'center' })
    pdf.text('Logo', margin + 19.5, 24, { align: 'center' })
  }

  /**
   * Generate Pre-Incubation Agreement PDF matching the legal format
   */
  static async generatePreIncubationAgreementPDF(document: PreIncubationDocument): Promise<jsPDF> {
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 20
    let yPosition = 30

    // Header with Lepharo logo and form info
    await this.addHeader(pdf, pageWidth, margin)
    yPosition = 50

    // Main title
    pdf.setFontSize(16)
    pdf.setFont('helvetica', 'bold')
    const mainTitle = 'PRE-INCUBATION, CONFIDENTIALITY NON-DISCLOSURE, AND NON-CIRCUMVENTION AGREEMENT'
    const titleLines = pdf.splitTextToSize(mainTitle, pageWidth - 2 * margin)
    titleLines.forEach((line: string) => {
      pdf.text(line, pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 8
    })
    yPosition += 10

    // "Entered into by and between"
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'normal')
    pdf.text('Entered into by and between', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 15

    // Incubator details
    pdf.setFont('helvetica', 'bold')
    pdf.text(document.incubatorParty.name, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6
    pdf.setFont('helvetica', 'normal')
    pdf.text(`(REG. NO: ${document.incubatorParty.registrationNumber})`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 10
    pdf.text('("The Disclosing Party")', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 15

    // "And"
    pdf.text('And', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 15

    // Incubatee details
    pdf.setFont('helvetica', 'bold')
    pdf.text(document.incubateeParty.name, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Reg number: ${document.incubateeParty.registrationNumber}`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 10
    pdf.text('("The Receiving Party")', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 15

    // Representative details
    pdf.text('Represented by the following Director', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 10
    pdf.setFont('helvetica', 'bold')
    pdf.text(document.incubateeParty.representativeName, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Identity No: ${document.incubateeParty.representativeId || 'To be provided'}`, pageWidth / 2, yPosition, { align: 'center' })

    // Check if we need a new page
    if (yPosition > pageHeight - 50) {
      pdf.addPage()
      yPosition = 30
    } else {
      yPosition += 20
    }

    // THE AGREEMENT section
    pdf.setFontSize(14)
    pdf.setFont('helvetica', 'bold')
    pdf.text('THE AGREEMENT', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 15

    // Agreement content
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    
    // Section 1
    this.addNumberedSection(pdf, '1.', document.terms.purpose, margin, pageWidth, yPosition)
    yPosition += this.calculateTextHeight(pdf, document.terms.purpose, pageWidth - 2 * margin) + 10

    // Section 2
    const section2Text = `Save the provisions above in paragraph 1, the Pre-Incubation shall commence on the ${this.formatDate(document.terms.startDate)} and terminate on the ${this.formatDate(document.terms.endDate)} understand that this period will be anything from 4 (four) weeks to 12 (twelve) weeks; starting from ${this.formatDate(document.terms.startDate)}.`
    this.addNumberedSection(pdf, '2.', section2Text, margin, pageWidth, yPosition)
    yPosition += this.calculateTextHeight(pdf, section2Text, pageWidth - 2 * margin) + 10

    // Check if we need a new page
    if (yPosition > pageHeight - 100) {
      pdf.addPage()
      yPosition = 30
    }

    // Section 3 - Assessment details
    const section3Text = `During this period ${document.incubateeParty.name} and its Directors and/or Members will be assessed for potential to become members of PROGRAMME and allow Directors and/or Members and/or Members to make an informed decision before signing on as members. ${document.incubateeParty.name} shall mean during this period Products & Services, ${document.terms.productsServices}.`
    this.addNumberedSection(pdf, '3.', section3Text, margin, pageWidth, yPosition)
    yPosition += this.calculateTextHeight(pdf, section3Text, pageWidth - 2 * margin) + 10

    // Section 4 - Confidentiality
    const section4Text = 'AND WHEREAS pursuant to the intention and the Purpose alone and for no other reason or purpose, the parties may have exchanged and may further exchange confidential information and wish to protect their proprietary and commercial interests in respect of the Confidential Information;'
    this.addNumberedSection(pdf, '4.', section4Text, margin, pageWidth, yPosition)
    yPosition += this.calculateTextHeight(pdf, section4Text, pageWidth - 2 * margin) + 15

    // "NOW THEREFORE IT IS AGREED AS FOLLOWS:"
    pdf.setFont('helvetica', 'bold')
    pdf.text('NOW THEREFORE IT IS AGREED AS FOLLOWS:', margin, yPosition)
    yPosition += 15

    // PURPOSE section
    pdf.setFont('helvetica', 'bold')
    pdf.text('1. PURPOSE OF THE PRE-INCUBATION', margin, yPosition)
    yPosition += 10

    pdf.setFont('helvetica', 'normal')
    const purposeText = `The PURPOSE shall mean during this period ${document.incubateeParty.name} and/or its Directors and/or Members will be assessed to become member in the program and allow Directors and/or Members to make an informed decision before signing on as members of the INCUBATEE.`
    const purposeLines = pdf.splitTextToSize(purposeText, pageWidth - 2 * margin)
    purposeLines.forEach((line: string) => {
      pdf.text(line, margin, yPosition)
      yPosition += 5
    })
    yPosition += 10

    const directorText = `The Director/s must fully complete and sign the Assessment Registration Form and return it to Lepharo within 5 working days.`
    const directorLines = pdf.splitTextToSize(directorText, pageWidth - 2 * margin)
    directorLines.forEach((line: string) => {
      pdf.text(line, margin, yPosition)
      yPosition += 5
    })

    // Check if we need more pages for additional content
    if (yPosition > pageHeight - 80) {
      pdf.addPage()
      yPosition = 30
    }

    // Add INTERPRETATION section (Page 2)
    this.addInterpretationSection(pdf, margin, pageWidth, yPosition)
    
    // Add new page for signatures
    pdf.addPage()
    this.addSignatureSection(pdf, document, margin, pageWidth, 30)

    // Add footer to all pages
    const pageCount = pdf.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i)
      this.addFooter(pdf, pageWidth, pageHeight, 'Ref No.24LEPQ1-01', `Page ${i}`)
    }

    return pdf
  }

  /**
   * Add document header with Lepharo logo
   */
  private static async addHeader(pdf: jsPDF, pageWidth: number, margin: number): Promise<void> {
    // Draw header border
    pdf.setLineWidth(0.5)
    pdf.rect(margin, 10, pageWidth - 2 * margin, 20)

    // Add Lepharo logo
    const logoDataURL = await this.loadLogoAsBase64()
    
    if (logoDataURL) {
      try {
        // Add logo to PDF (x, y, width, height)
        pdf.addImage(logoDataURL, 'PNG', margin + 2, 12, 35, 16)
      } catch (error) {
        console.warn('Failed to add logo to PDF:', error)
        // Fallback to text placeholder
        this.addLogoFallback(pdf, margin)
      }
    } else {
      // Fallback: draw placeholder box with text
      this.addLogoFallback(pdf, margin)
    }

    // Title
    pdf.setFontSize(14)
    pdf.setFont('helvetica', 'bold')
    pdf.text('PRE-INCUBATION AGREEMENT', pageWidth / 2, 22, { align: 'center' })

    // Form info
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    const formInfo = [
      'Form No: LEP QMS 074 F',
      'Revision No: 0',
      'Effective date: 28 July 2021'
    ]
    let yPos = 14
    formInfo.forEach(info => {
      pdf.text(info, pageWidth - margin - 2, yPos, { align: 'right' })
      yPos += 4
    })
  }

  /**
   * Add footer
   */
  private static addFooter(pdf: jsPDF, pageWidth: number, pageHeight: number, refNo: string, pageNo: string): void {
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text(refNo, 20, pageHeight - 10)
    pdf.text(pageNo, pageWidth / 2, pageHeight - 10, { align: 'center' })
  }

  /**
   * Add numbered section
   */
  private static addNumberedSection(pdf: jsPDF, number: string, text: string, margin: number, pageWidth: number, yPosition: number): void {
    pdf.setFont('helvetica', 'normal')
    pdf.text(number, margin, yPosition)
    
    const textLines = pdf.splitTextToSize(text, pageWidth - 2 * margin - 10)
    let lineY = yPosition
    textLines.forEach((line: string) => {
      pdf.text(line, margin + 8, lineY)
      lineY += 5
    })
  }

  /**
   * Calculate text height
   */
  private static calculateTextHeight(pdf: jsPDF, text: string, maxWidth: number): number {
    const lines = pdf.splitTextToSize(text, maxWidth)
    return lines.length * 5
  }

  /**
   * Format date for document
   */
  private static formatDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = { 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    }
    return date.toLocaleDateString('en-GB', options).toUpperCase()
  }

  /**
   * Add interpretation section (page 2 content)
   */
  private static addInterpretationSection(pdf: jsPDF, margin: number, pageWidth: number, startY: number): void {
    let yPosition = startY

    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('1    INTERPRETATION', margin, yPosition)
    yPosition += 10

    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.text('In this Agreement the following expressions bear the meanings assigned to them below and', margin, yPosition)
    yPosition += 5
    pdf.text('cognate expressions bear corresponding meanings:-', margin, yPosition)
    yPosition += 10

    // Define interpretation terms
    const interpretations = [
      { term: '"Confidential Information"', definition: 'means information or data, whether disclosed orally or in writing and whether, upon disclosure, is identified as confidential, including, without limitation, any information relating to a Party;' },
      { term: '"Disclosing Purpose"', definition: 'means the purpose or reason for which the Parties have entered or will enter into discussions resulting in the disclosure of Confidential Information to each other, as specified on the cover page of this Agreement;' },
      { term: '"Parties"', definition: 'means the Parties to this Agreement, and "Party" means either one of the Parties (as the context may require); and' }
    ]

    interpretations.forEach((item, index) => {
      pdf.text(`1.${index + 1}`, margin, yPosition)
      pdf.setFont('helvetica', 'bold')
      pdf.text(item.term, margin + 15, yPosition)
      yPosition += 8
      
      pdf.setFont('helvetica', 'normal')
      const defLines = pdf.splitTextToSize(item.definition, pageWidth - 2 * margin - 20)
      defLines.forEach((line: string) => {
        pdf.text(line, margin + 15, yPosition)
        yPosition += 5
      })
      yPosition += 5
    })
  }

  /**
   * Add signature section (final page)
   */
  private static addSignatureSection(pdf: jsPDF, document: PreIncubationDocument, margin: number, pageWidth: number, startY: number): void {
    let yPosition = startY

    pdf.setFontSize(14)
    pdf.setFont('helvetica', 'bold')
    pdf.text('12.    SIGNATURES', margin, yPosition)
    yPosition += 20

    // The Incubatee or SMME section
    pdf.setFont('helvetica', 'bold')
    pdf.text('The Incubatee or SMME', margin, yPosition)
    yPosition += 15

    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`SIGNED AT _________________ on this __________ day of _________________ 2024.`, margin, yPosition)
    yPosition += 20

    pdf.text(`Name & surname: ${document.incubateeParty.representativeName}`, margin, yPosition)
    pdf.text(`Position in the company: ${document.incubateeParty.representativeTitle}`, margin + 100, yPosition)
    yPosition += 15

    // Signature line
    pdf.text('Signature: ____________________', margin, yPosition)
    yPosition += 5
    pdf.setFontSize(8)
    pdf.text('[For and on behalf of the INCUBATEE, duly authorized]', margin, yPosition)
    yPosition += 20

    // Witness section for incubatee
    pdf.setFontSize(10)
    pdf.text('Witness:', margin, yPosition)
    yPosition += 15

    pdf.text('___________________________', margin, yPosition)
    pdf.text('___________________________', margin + 100, yPosition)
    yPosition += 5
    pdf.text('Full Name & Surname', margin, yPosition)
    pdf.text('Signature', margin + 100, yPosition)
    yPosition += 30

    // The Incubator section
    pdf.setFont('helvetica', 'bold')
    pdf.text('The Incubator', margin, yPosition)
    yPosition += 15

    pdf.setFont('helvetica', 'normal')
    pdf.text(`SIGNED AT _________________ on this __________ day of _________________ 2024.`, margin, yPosition)
    yPosition += 20

    pdf.text(`Name & surname: _________________`, margin, yPosition)
    pdf.text(`Position in the company: _________________`, margin + 100, yPosition)
    yPosition += 15

    // Signature line
    pdf.text('Signature: ____________________', margin, yPosition)
    yPosition += 5
    pdf.setFontSize(8)
    pdf.text('[For and on behalf of the INCUBATOR, duly authorized]', margin, yPosition)
    yPosition += 20

    // Witness section for incubator
    pdf.setFontSize(10)
    pdf.text('Witness:', margin, yPosition)
    yPosition += 15

    pdf.text('___________________________', margin, yPosition)
    pdf.text('___________________________', margin + 100, yPosition)
    yPosition += 5
    pdf.text('Full Name & Surname', margin, yPosition)
    pdf.text('Signature', margin + 100, yPosition)
  }

  /**
   * Download PDF
   */
  static async downloadDocument(document: PreIncubationDocument): Promise<void> {
    const pdf = await this.generatePreIncubationAgreementPDF(document)
    const filename = `Pre-Incubation-Agreement-${document.incubateeParty.name}-${document.documentNumber}.pdf`
    pdf.save(filename)
  }
}

export default PDFGenerationService 