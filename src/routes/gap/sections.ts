/**
 * Single source of truth for GAP Analysis sections.
 *
 * Both the list (routes/gap/index.tsx) and the detail view (routes/gap/view/*)
 * read from here so the question banks, department access rules and scoring
 * cannot drift apart again.
 */

/** ===== Question banks ===== */
export const financialManagementQ = [
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

export const marketLinkageQ = [
    'Are you registered with Central Supplier Database (CSD)?',
    'Is the competency of the management team and workforce adequate?',
    'Do you have a list of clients you desire to service?',
    'Do you know the net worth of your business?',
    'Do you have current/previous trade references?',
    'Do you have the capacity/equipment to deliver product?'
]

export const qualityManagementQ = [
    'Are you aware of Quality Management Systems (QMS)?',
    'Have you attended ISO 9001:2015 QMS training before? (If yes, where and do you have the certificate?)',
    'Do you have a Quality Management System in place?',
    'Do you have 6-month records of the implemented QMS?'
]

export const labourHSEQ = [
    'UIF Registration (check if company has employees)?',
    'Are you registered for COID/RMA?',
    'Do your employees & directors have contracts of employment?',
    'Is the company registered/affiliated with any industry bodies? (e.g., Plumbing Council, CIDB, NAMC)',
    'Do you have an Occupational Health & Safety System in place?',
    'Have you done statutory OHS trainings (employer and employees)?',
    'Do you have a workshop/office where you operate from? (under lease or owned by the business)'
]

export const marketingCommunicationQ = [
    'Do you have a company profile, logo, domain, brochures, banners, and other Marketing/Advertising materials that are deemed necessary for the business?',
    'Does company have electronic signature software?'
]

export const psychometricQ = [
    'Have you ever done a psychometric assessment?',
    'Have you in the past participated in or completed personal development courses/programmes for business growth (e.g., mentoring/coaching/counselling)?',
    'Does your organisation have a personal development plan in place for all directors that allows for the development of personal insight for business growth of an entrepreneur for each Director?'
]

export const wellnessQ = [
    'Are you aware that Lepharo offers Employee Wellness Services?',
    'Are you aware of your employees’ or your own mental/emotional state that can derail your business?',
    'Do you have employee assistance programmes implemented in your workplace?',
    'Have you or your employees completed a Wellness Health Risk Assessment over the past 6 months?',
    'Are you interested in incorporating Health and Wellness in your company?'
]

export const legalQ = [
    'Are you aware that Lepharo provides business Legal Services?',
    'Do you need assistance with Broad-Based Black Economic Empowerment rating (B-BBEE)?',
    'Do the shareholders have shareholding certificates?',
    'Do you have employment contract templates in place?',
    'Does your company employ illegal immigrants?',
    'Do you have any Legal needs we can assist you with?',
    'Do you have a lease agreement in place?',
    'Does the business have insurance (e.g., public liability)?'
]

export const trainingNeedsYNQ = [
    'Does the business pay Skills Development Levies?',
    'If yes, to which SETA? (enter below)',
    'Does the business prepare a Workplace Skills Plan?',
    'Do you have a Skills Development Facilitator (SDF) in the business?',
    'Do you have training needs of personnel in middle and senior management levels?',
    'Do you have training needs of supervisors in the business?',
    'Do you have training needs for the workforce/staff in the business?',
    'Do you have training needs of support staff (Administrators, Finance, HR)?'
]

export const lepharoDepartments = [
    'ROM (Recruitment, Onboarding and Maintenance)',
    'HSE (Health, Safety & Environment) and Labour Compliance',
    'IHF (InHouse Finance)',
    'M&E (Monitoring and Evaluation',
    'Financial Compliance',
    'PDS (Personal Development Services)',
    'Legal Advisory Services',
    'Wellness Services',
    'Training Academy',
    'Marketing and Communication',
    'Market Linkages',
    'QMS (Quality Management System)',
    'NVC (New Venture Creation)'
] as const

/** ===== Types & helpers ===== */
export type QA = { answer?: string; comment?: string }

export const yes = (a?: string) => (a || '').toLowerCase() === 'yes'

export const getQAArray = (obj: any): QA[] =>
    Array.isArray(obj) ? obj : Array.isArray(obj?.q) ? obj.q : []

export const SECTION_ADAPTERS = {
    marketing: {
        title: 'Marketing & Communication',
        qText: marketingCommunicationQ,
        getQA: (g: any) => getQAArray(g?.sections?.marketingCommunication)
    },
    psychometric: {
        title: 'Psychometric',
        qText: psychometricQ,
        getQA: (g: any) => getQAArray(g?.sections?.psychometric)
    },
    finance: {
        title: 'Financial Management',
        qText: financialManagementQ,
        getQA: (g: any) => getQAArray(g?.sections?.financialManagement?.q)
    },
    hr: {
        title: 'Health, Safety and Environment',
        qText: labourHSEQ,
        getQA: (g: any) => getQAArray(g?.sections?.labourHSE)
    },
    wellness: {
        title: 'Wellness Services',
        qText: wellnessQ,
        getQA: (g: any) => getQAArray(g?.sections?.wellness?.q)
    },
    legal: {
        title: 'Legal Advisory Services',
        qText: legalQ,
        getQA: (g: any) => getQAArray(g?.sections?.legal?.q)
    },
    market: {
        title: 'Market Linkage',
        qText: marketLinkageQ,
        getQA: (g: any) => getQAArray(g?.sections?.marketLinkage)
    },
    quality: {
        title: 'Quality Management',
        qText: qualityManagementQ,
        getQA: (g: any) => getQAArray(g?.sections?.qualityManagement)
    },
    training: {
        title: 'Training Academy',
        qText: trainingNeedsYNQ,
        getQA: (g: any) => getQAArray(g?.sections?.trainingNeeds?.yn)
    },
    nvc: {
        title: 'NVC (New Venture Creation)',
        qText: trainingNeedsYNQ,
        getQA: (g: any) => getQAArray(g?.sections?.trainingNeeds?.yn)
    }
} as const

export type SectionKey = keyof typeof SECTION_ADAPTERS

export const SECTION_ORDER: SectionKey[] = [
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

const DEPT_SECTION_MAP: Record<
    (typeof lepharoDepartments)[number],
    SectionKey[] | 'ALL'
> = {
    'ROM (Recruitment, Onboarding and Maintenance)': 'ALL',
    'HSE (Health, Safety & Environment) and Labour Compliance': ['hr'],
    'IHF (InHouse Finance)': ['finance'],
    'M&E (Monitoring and Evaluation': 'ALL',
    'Financial Compliance': ['finance'],
    'PDS (Personal Development Services)': ['psychometric'],
    'Legal Advisory Services': ['legal'],
    'Wellness Services': ['wellness'],
    'Training Academy': ['training', 'quality'],
    'NVC (New Venture Creation)': ['training'],
    'Marketing and Communication': ['marketing'],
    'Market Linkages': ['market'],
    'QMS (Quality Management System)': ['quality']
}

export function getAllowedSectionsForDept(departmentName?: string): SectionKey[] | 'ALL' {
    if (!departmentName) return []
    const key = lepharoDepartments.find(d => d === departmentName)
    if (!key) return []
    return DEPT_SECTION_MAP[key]
}

/**
 * Which department actually delivers each section.
 *
 * Mirrors GAP_SECTION_OWNER in ai-backend/gap_mapping.py.
 */
export const SECTION_OWNER_DEPARTMENT: Record<SectionKey, string> = {
    marketing: 'Marketing and Communication',
    psychometric: 'PDS (Personal Development Services)',
    finance: 'IHF (InHouse Finance)',
    hr: 'HSE (Health, Safety & Environment) and Labour Compliance',
    wellness: 'Wellness Services',
    legal: 'Legal Advisory Services',
    market: 'Market Linkages',
    quality: 'QMS (Quality Management System)',
    training: 'Training Academy',
    nvc: 'NVC (New Venture Creation)'
}

/**
 * Sections a department *delivers*, as opposed to the ones it may view.
 *
 * ROM and M&E can read every section but deliver none, so they resolve to an
 * empty list here. Use this wherever the answer drives building or assigning
 * work; use getAllowedSectionsForDept for read access.
 */
export function getOwnedSectionsForDept(departmentName?: string): SectionKey[] {
    const name = String(departmentName || '').trim()
    if (!name) return []

    // DEPT_SECTION_MAP already lists what each department is responsible for
    // (Training Academy runs both training and quality). Only 'ALL' — the
    // oversight roles — needs excluding.
    const allowed = getAllowedSectionsForDept(name)
    return allowed === 'ALL' ? [] : allowed
}

/** Answer state for a single question — drives both the gap strip and the rows. */
export type AnswerState = 'yes' | 'no' | 'blank'

export type SectionStats = {
    key: SectionKey
    title: string
    states: AnswerState[]
    yes: number
    no: number
    blank: number
    total: number
    /** % of answered questions that are "Yes". Null when nothing has been answered. */
    yesPct: number | null
}

export function getAnswerStates(gap: any, sec: SectionKey): AnswerState[] {
    const def = SECTION_ADAPTERS[sec]
    const qas = def.getQA(gap)
    return def.qText.map((_, i) => {
        const a = qas?.[i]?.answer
        if (a == null || String(a).trim() === '') return 'blank'
        return yes(a) ? 'yes' : 'no'
    })
}

export function getSectionStats(gap: any, sec: SectionKey): SectionStats {
    const states = getAnswerStates(gap, sec)
    const y = states.filter(s => s === 'yes').length
    const n = states.filter(s => s === 'no').length
    const b = states.filter(s => s === 'blank').length
    const answered = y + n
    return {
        key: sec,
        title: SECTION_ADAPTERS[sec].title,
        states,
        yes: y,
        no: n,
        blank: b,
        total: states.length,
        yesPct: answered ? Math.round((y / answered) * 100) : null
    }
}
