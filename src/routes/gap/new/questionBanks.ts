import type { StepMeta } from './types'

/* ──────────────────────────────────────────────────────────────
   STEP META
────────────────────────────────────────────────────────────── */
export const STEP_META: StepMeta[] = [
    {
        short: 'Marketing & Psychometric',
        description: 'Confirm marketing assets and leadership development posture.',
        subpoints: [
            'Brand assets, e-signature readiness',
            'Psychometric assessments & personal development plan'
        ]
    },
    {
        short: 'Finance & Labour/HSE',
        description: 'Verify statutory registrations, accounts, and OHS basics.',
        subpoints: [
            'Tax/VAT/PAYE, AFS/management accounts, fixed assets',
            'Accounting system/legacy issues; UIF/COID, contracts, OHS'
        ]
    },
    {
        short: 'Wellness & Legal',
        description: 'Capture wellness interest and legal support needs.',
        subpoints: [
            'EAP options & HRA status',
            'B-BBEE, contracts/templates, insurance; legal areas as needed'
        ]
    },
    {
        short: 'Market Linkage & Quality',
        description: 'Assess market access readiness and QMS status.',
        subpoints: ['CSD, target clients/refs, capacity', 'QMS/ISO readiness']
    },
    {
        short: 'Training Needs',
        description: 'Record SDL/SETA context and role-based training needs',
        subpoints: [
            'SETA/WSP/SDF status',
            'Needs: management, supervisors, workforce, support'
        ]
    },
    {
        short: 'Review & Submit',
        description: 'Verify entries and submit; digital signature notice applies.',
        subpoints: ['Final review summary', 'Submission notices & confirmations']
    }
]
export const TOTAL_STEPS = STEP_META.length

/* ──────────────────────────────────────────────────────────────
   Question banks
────────────────────────────────────────────────────────────── */
export const marketingCommunication = [
    'Do you have a company profile, logo, domain, brochures, banners, and other Marketing/Advertising materials that are deemed necessary for the business?',
    'Does company have electronic signature software?'
]
export const psychometric = [
    'Have you ever done a psychometric assessment?',
    'Have you in the past participated in or completed personal development courses/programmes for business growth (e.g., mentoring/coaching/counselling)?',
    'Does your organisation have a personal development plan in place for all directors that allows for the development of personal insight for business growth of an entrepreneur for each Director?'
]
export const financialManagement = [
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
export const labourHSE = [
    'UIF Registration (check if company has employees)?',
    'Are you registered for COID/RMA?',
    'Do your employees & directors have contracts of employment?',
    'Is the company registered/affiliated with any industry bodies? (e.g., Plumbing Council, CIDB, NAMC)',
    'Do you have an Occupational Health & Safety System in place?',
    'Have you done statutory OHS trainings (employer and employees)?',
    'Do you have a workshop/office where you operate from? (under lease or owned by the business)'
]
export const wellness = [
    'Are you aware that Lepharo offers Employee Wellness Services?',
    'Are you aware of your employees’ or your own mental/emotional state that can derail your business?',
    'Do you have employee assistance programmes implemented in your workplace?',
    'Have you or your employees completed a Wellness Health Risk Assessment over the past 6 months?',
    'Are you interested in incorporating Health and Wellness in your company?'
]
export const wellnessProgrammes = [
    'Alcohol/substance abuse and GBV support',
    'Coaching programmes to keep employees motivated and productive',
    'Healthy diet and physical wellbeing'
]
export const legal = [
    'Are you aware that Lepharo provides business Legal Services?',
    'Do you need assistance with Broad-Based Black Economic Empowerment rating (B-BBEE)?',
    'Do the shareholders have shareholding certificates?',
    'Do you have employment contract templates in place?',
    'Does your company employ illegal immigrants?',
    'Do you have any Legal needs we can assist you with?',
    'Do you have a lease agreement in place?',
    'Does the business have insurance (e.g., public liability)?'
]
export const legalAreas = [
    'Commercial Law',
    'Corporate Law',
    'Labour Laws',
    'Business Insurance Law',
    'Elementary Services to Fiduciary Services',
    'Elementary Services to Debt Agreements (e.g., AOD/settlement)'
]
export const marketLinkage = [
    'Are you registered with Central Supplier Database (CSD)?',
    'Is the competency of the management team and workforce adequate?',
    'Do you have a list of clients you desire to service?',
    'Do you know the net worth of your business?',
    'Do you have current/previous trade references?',
    'Do you have the capacity/equipment to deliver product?'
]
export const qualityManagement = [
    'Are you aware of Quality Management Systems (QMS)?',
    'Have you attended ISO 9001:2015 QMS training before? (If yes, where and do you have the certificate?)',
    'Do you have a Quality Management System in place?',
    'Do you have 6-month records of the implemented QMS?'
]
export const trainingNeedsYN = [
    'Does the business pay Skills Development Levies?',
    'If yes, to which SETA? (enter below)',
    'Does the business prepare a Workplace Skills Plan?',
    'Do you have a Skills Development Facilitator (SDF) in the business?',
    'Do you have training needs of personnel in middle and senior management levels?',
    'Do you have training needs of supervisors in the business?',
    'Do you have training needs for the workforce/staff in the business?',
    'Do you have training needs of support staff (Administrators, Finance, HR)?'
]
