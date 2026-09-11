// Utility function to create a pre-incubation document for Quant Digital Solutions
// This can be called from the browser console or triggered via a button

import PreIncubationService from '@/services/preIncubationService'
import { PreIncubationDocument, PreIncubationDocumentType, PreIncubationDocumentStatus } from '@/types/preIncubationDocument'

export const createQuantPreIncubationDocument = async (): Promise<string> => {
  try {
    console.log('🚀 Creating pre-incubation document for Quant Digital Solutions...')

    // Document dates
    const startDate = new Date('2024-04-01')
    const endDate = new Date('2024-07-01')

    console.log('📅 Document dates:', { startDate, endDate })

    // Document data structure
    const documentData: Omit<PreIncubationDocument, 'id' | 'documentNumber' | 'createdAt' | 'updatedAt'> = {
      documentType: 'pre_incubation_agreement' as PreIncubationDocumentType,
      title: 'Pre-Incubation Agreement - Quant Digital Solutions',
      description: 'Pre-incubation assessment agreement for Quant Digital Solutions to evaluate business viability and incubation potential.',
      version: '1.0',
      templateId: 'template-pre-incubation-v1',

      // Parties array
      parties: [
        {
          name: 'Lepharo Consulting',
          registrationNumber: 'REG-LPH-001',
          type: 'incubator' as const,
          representativeName: 'Dr. Sarah Mthembu',
          representativeTitle: 'Managing Director',
          representativeId: 'ID001234567',
          physicalAddress: '123 Innovation Hub, Johannesburg, 2001, South Africa',
          postalAddress: 'PO Box 1234, Johannesburg, 2000, South Africa',
          emailAddress: 'legal@lepharo.co.za',
          phoneNumber: '+27 11 123 4567',
          authorizedSignatory: true,
          witnessRequired: false
        },
        {
          name: 'Quant Digital Solutions',
          registrationNumber: 'REG-QDS-2024',
          type: 'incubatee' as const,
          representativeName: 'Alex Thompson',
          representativeTitle: 'Founder & CEO',
          representativeId: 'ID987654321',
          physicalAddress: '45 Tech Park Avenue, Cape Town, 8001, South Africa',
          postalAddress: '45 Tech Park Avenue, Cape Town, 8001, South Africa',
          emailAddress: 'alex@quantdigital.co.za',
          phoneNumber: '+27 21 456 7890',
          authorizedSignatory: true,
          witnessRequired: false,
          participantId: 'participant-quant-001',
          userId: 'user-quant-001'
        }
      ],

      // Incubator Party (reference)
      incubatorParty: {
        name: 'Lepharo Consulting',
        registrationNumber: 'REG-LPH-001',
        type: 'incubator' as const,
        representativeName: 'Dr. Sarah Mthembu',
        representativeTitle: 'Managing Director',
        representativeId: 'ID001234567',
        physicalAddress: '123 Innovation Hub, Johannesburg, 2001, South Africa',
        postalAddress: 'PO Box 1234, Johannesburg, 2000, South Africa',
        emailAddress: 'legal@lepharo.co.za',
        phoneNumber: '+27 11 123 4567',
        authorizedSignatory: true,
        witnessRequired: false
      },

      // Incubatee Party (reference)
      incubateeParty: {
        name: 'Quant Digital Solutions',
        registrationNumber: 'REG-QDS-2024',
        type: 'incubatee' as const,
        representativeName: 'Alex Thompson',
        representativeTitle: 'Founder & CEO',
        representativeId: 'ID987654321',
        physicalAddress: '45 Tech Park Avenue, Cape Town, 8001, South Africa',
        postalAddress: '45 Tech Park Avenue, Cape Town, 8001, South Africa',
        emailAddress: 'alex@quantdigital.co.za',
        phoneNumber: '+27 21 456 7890',
        authorizedSignatory: true,
        witnessRequired: false,
        participantId: 'participant-quant-001',
        userId: 'user-quant-001'
      },

      // Agreement Terms
      terms: {
        startDate,
        endDate,
        durationMonths: 3,
        purpose: 'To conduct a comprehensive pre-incubation assessment of Quant Digital Solutions to determine the viability and potential for business incubation support.',
        scopeDescription: 'The assessment will cover business model validation, market analysis, technical feasibility, financial projections, team capabilities, and scalability potential. This includes workshops, mentoring sessions, and business plan refinement.',
        assessmentCriteria: [
          'Business Model Viability',
          'Market Opportunity and Size',
          'Technical Innovation and Feasibility',
          'Team Capability and Experience',
          'Financial Projections and Sustainability',
          'Scalability and Growth Potential',
          'Competitive Advantage',
          'Customer Validation and Traction'
        ],
        businessSector: 'Information Technology & Data Analytics',
        businessStage: 'Early Stage / Prototype',
        productsServices: 'AI-powered data analytics platform providing automated insights for small and medium enterprises, including predictive analytics, business intelligence dashboards, and custom reporting solutions.',
        confidentialityPeriod: 24,
        nonCircumventionPeriod: 12,
        governingLaw: 'South African Law',
        disputeResolution: 'Mediation followed by arbitration in Johannesburg, South Africa',
        specialConditions: [
          'All proprietary algorithms and intellectual property remain with Quant Digital Solutions',
          'Lepharo Consulting may request demonstration of technology capabilities',
          'Regular progress meetings scheduled bi-weekly',
          'Access to Lepharo business networks and mentoring resources'
        ],
        terminationConditions: [
          'Either party may terminate with 30 days written notice',
          'Immediate termination for material breach of confidentiality',
          'Automatic termination upon completion of assessment period',
          'Termination does not affect confidentiality obligations'
        ]
      },

      // Signature information
      signatures: [],
      requiredSignatures: 2,
      status: 'pending_signature' as PreIncubationDocumentStatus,
      isActive: true,
      isExpired: false,
      legalBinding: true,

      // Metadata
      createdBy: 'system-admin',
      lastModifiedBy: 'system-admin',
      participantId: 'participant-quant-001',

      // Notification tracking
      expirationNotificationSent: false,
      remindersSent: 0,
      lastReminderDate: undefined,

      // Additional fields
      notes: 'Initial pre-incubation agreement for Quant Digital Solutions. Focused on AI/ML data analytics platform assessment.',
      internalReference: 'PRE-INC-QUANT-2024-001'
    }

    console.log('💾 About to create document with data:', {
      title: documentData.title,
      documentType: documentData.documentType,
      partiesCount: documentData.parties.length,
      termsStartDate: documentData.terms.startDate,
      termsEndDate: documentData.terms.endDate
    })

    // Create the document using the service
    const documentId = await PreIncubationService.createDocument(documentData)

    console.log('✅ Pre-incubation document created successfully!')
    console.log(`📄 Document ID: ${documentId}`)
    console.log(`🏢 Company: Quant Digital Solutions`)
    console.log(`📅 Duration: ${startDate.toDateString()} - ${endDate.toDateString()}`)
    console.log(`📊 Status: pending_signature`)

    return documentId

  } catch (error) {
    console.error('❌ Error creating pre-incubation document:', error)

    // Type-safe error logging
    if (error instanceof Error) {
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
    } else {
      console.error('❌ Unknown error type:', typeof error)
    }

    throw error
  }
}

// Expose to global scope for easy access from browser console
declare global {
  interface Window {
    createQuantDocument: () => Promise<string>
  }
}

// Make function available globally
if (typeof window !== 'undefined') {
  window.createQuantDocument = createQuantPreIncubationDocument
}

export default createQuantPreIncubationDocument
