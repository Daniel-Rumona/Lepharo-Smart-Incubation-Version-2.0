import { inquiryService } from '@/services/inquiryService'
import { InquiryFormData } from '@/types/inquiry'

export const initializeTestInquiries = async (branchId: string, submittedBy: string) => {
  console.log('Initializing test inquiries for branch:', branchId)

  const testInquiries: InquiryFormData[] = [
    {
      contactInfo: {
        firstName: 'John',
        lastName: 'Smith',
        email: 'john.smith@example.com',
        phone: '+27 11 123 4567',
        company: 'Tech Innovations SA',
        position: 'CEO'
      },
      inquiryDetails: {
        inquiryType: 'Incubation Program',
        businessStage: 'Startup',
        industry: 'FinTech',
        servicesOfInterest: ['Business Incubation', 'Funding Support', 'Mentorship'],
        description: 'Looking to develop our fintech startup into a scalable business with proper mentorship and funding guidance.',
        budget: 'R50k - R100k',
        timeline: '3-6 months'
      },
      priority: 'High',
      source: 'Website',
      tags: ['fintech', 'high-potential']
    },
    {
      contactInfo: {
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: 'sarah.johnson@greentech.co.za',
        phone: '+27 82 456 7890',
        company: 'GreenTech Solutions',
        position: 'Founder'
      },
      inquiryDetails: {
        inquiryType: 'Funding',
        businessStage: 'Early Stage',
        industry: 'Clean Energy',
        servicesOfInterest: ['Funding Support', 'Legal Support'],
        description: 'Seeking funding and legal guidance for our clean energy solutions focused on solar panel manufacturing.',
        budget: 'R100k - R500k',
        timeline: '1-3 months'
      },
      priority: 'Urgent',
      source: 'Referral',
      tags: ['clean-energy', 'urgent']
    },
    {
      contactInfo: {
        firstName: 'Michael',
        lastName: 'Brown',
        email: 'michael.brown@gmail.com',
        phone: '+27 73 789 0123',
        company: '',
        position: ''
      },
      inquiryDetails: {
        inquiryType: 'General Information',
        businessStage: 'Idea Stage',
        industry: 'E-commerce',
        servicesOfInterest: ['Business Incubation'],
        description: 'I have an idea for an e-commerce platform and would like to know more about your incubation programs.',
        budget: 'Under R10k',
        timeline: 'Flexible'
      },
      priority: 'Medium',
      source: 'Walk-in',
      tags: ['e-commerce', 'idea-stage']
    },
    {
      contactInfo: {
        firstName: 'Lisa',
        lastName: 'Williams',
        email: 'lisa@healthtech.co.za',
        phone: '+27 61 234 5678',
        company: 'HealthTech Innovations',
        position: 'CTO'
      },
      inquiryDetails: {
        inquiryType: 'Mentorship',
        businessStage: 'Growth Stage',
        industry: 'HealthTech',
        servicesOfInterest: ['Technical Support', 'Mentorship', 'Networking'],
        description: 'Looking for technical mentorship to scale our health monitoring platform.',
        budget: 'R10k - R50k',
        timeline: '6-12 months'
      },
      priority: 'Medium',
      source: 'Social Media',
      tags: ['healthtech', 'scaling']
    },
    {
      contactInfo: {
        firstName: 'David',
        lastName: 'Wilson',
        email: 'david.wilson@agritech.co.za',
        phone: '+27 84 567 8901',
        company: 'AgriTech Solutions',
        position: 'Managing Director'
      },
      inquiryDetails: {
        inquiryType: 'Partnership',
        businessStage: 'Established',
        industry: 'AgriTech',
        servicesOfInterest: ['Networking'],
        description: 'Exploring partnership opportunities with other tech companies in the agricultural space.',
        budget: 'To be discussed',
        timeline: 'Within 1 month'
      },
      priority: 'Low',
      source: 'Event',
      tags: ['agritech', 'partnership']
    },
    {
      contactInfo: {
        firstName: 'Dr. Priya',
        lastName: 'Patel',
        email: 'priya.patel@example.com',
        phone: '+27 71 345 6789',
        company: 'Internal SME',
        position: 'Senior Business Advisor'
      },
      inquiryDetails: {
        inquiryType: 'General Information',
        businessStage: 'Not Applicable',
        industry: 'Cross-sector',
        servicesOfInterest: ['Business Incubation'],
        description: 'SME inquiry: Need guidance on best practices for incubatee onboarding processes. Several clients have asked about standardization.',
        budget: 'To be discussed',
        timeline: 'Within 1 month'
      },
      priority: 'Medium',
      source: 'SME',
      tags: ['sme-inquiry', 'process-improvement']
    },
    {
      contactInfo: {
        firstName: 'James',
        lastName: 'Okafor',
        email: 'james.okafor@example.com',
        phone: '+27 82 987 6543',
        company: 'Internal SME',
        position: 'Technical Consultant'
      },
      inquiryDetails: {
        inquiryType: 'Other',
        businessStage: 'Not Applicable',
        industry: 'Technology',
        servicesOfInterest: ['Technical Support'],
        description: 'SME inquiry: Client requesting information about cloud infrastructure options for their EdTech startup. Need branch-specific pricing.',
        budget: 'R100k - R500k',
        timeline: '1-3 months'
      },
      priority: 'High',
      source: 'SME',
      tags: ['sme-inquiry', 'technical', 'edtech']
    }
  ]

  try {
    for (const inquiry of testInquiries) {
      const inquiryId = await inquiryService.createInquiry(
        inquiry,
        branchId,
        submittedBy,
      )
      console.log('Created test inquiry:', inquiryId)
    }
    console.log('Test inquiries initialized successfully!')
    return true
  } catch (error) {
    console.error('Error creating test inquiries:', error)
    throw error
  }
}
