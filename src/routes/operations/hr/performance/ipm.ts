/**
 * Individual performance management (IPM): cycles, compact structure and
 * weighted scoring. Pure functions only, so they can be unit tested.
 *
 * A compact is one document per employee per cycle. Items (KPAs/KPIs) sit in
 * sections; section weights add to 100, and the item weights inside every
 * weighted section add to 100. Ratings use the 1-5 compact scale.
 */

/** April: the Lepharo financial year runs April to March. */
export const DEFAULT_FY_START_MONTH = 4

export type CycleStatus = 'planning' | 'compacting' | 'active' | 'midYear' | 'yearEnd' | 'closed'
export type PhaseKey = 'midYear' | 'yearEnd'
export type DateWindow = { from: string; to: string }
export type CycleWindows = { compacting: DateWindow; midYear: DateWindow; yearEnd: DateWindow }

export type PerformanceCycle = {
    id: string
    label: string
    startDate: string
    endDate: string
    status: CycleStatus
    windows: CycleWindows
    /** Email and in-app reminders for this cycle; off until HR switches them on. */
    reminders?: boolean
}

export const CYCLE_STATUSES: { value: CycleStatus; label: string; color: string }[] = [
    { value: 'planning', label: 'Planning', color: 'default' },
    { value: 'compacting', label: 'Compacting', color: 'blue' },
    { value: 'active', label: 'In progress', color: 'cyan' },
    { value: 'midYear', label: 'Mid-year review', color: 'gold' },
    { value: 'yearEnd', label: 'Year-end review', color: 'orange' },
    { value: 'closed', label: 'Closed', color: 'green' }
]

export const PHASES: { key: PhaseKey; label: string }[] = [
    { key: 'midYear', label: 'Mid-year review' },
    { key: 'yearEnd', label: 'Year-end review' }
]

export type SectionKey = 'strategic' | 'management' | 'milestones' | 'competencies'
export type StandardType = 'quality' | 'quantity' | 'timeliness' | 'cost'

export const SECTIONS: { key: SectionKey; label: string; description: string }[] = [
    {
        key: 'strategic',
        label: 'Strategic KPAs',
        description: 'Cascaded from the Lepharo strategy and the centre or department operational plan.'
    },
    {
        key: 'management',
        label: 'Management KPAs',
        description: 'Generic, level-specific KPAs that apply to everyone at this level.'
    },
    {
        key: 'milestones',
        label: 'Programme milestones',
        description: 'Milestones from the strategy and operational plans, each linked to a strategic objective.'
    },
    {
        key: 'competencies',
        label: 'Competencies',
        description: 'Leadership, behavioural and functional competencies for the position.'
    }
]

export const STANDARDS: { value: StandardType; label: string }[] = [
    { value: 'quality', label: 'Quality' },
    { value: 'quantity', label: 'Quantity' },
    { value: 'timeliness', label: 'Timeliness' },
    { value: 'cost', label: 'Cost-effectiveness' }
]

export const RATING_SCALE = [
    { value: 1, label: 'Very Unsatisfactory' },
    { value: 2, label: 'Unsatisfactory' },
    { value: 3, label: 'Satisfactory' },
    { value: 4, label: 'More than Satisfactory' },
    { value: 5, label: 'Exceptional' }
]

export type CompetencyCluster = 'leadership' | 'behavioural' | 'functional'

export const COMPETENCY_CLUSTERS: { value: CompetencyCluster; label: string; description: string }[] = [
    {
        value: 'leadership',
        label: 'Leadership',
        description: 'Expected behaviours of leaders; for management grades and above.'
    },
    {
        value: 'behavioural',
        label: 'Behavioural',
        description: 'Non-technical skills for exceptional client service; applies to all employees at all grades.'
    },
    {
        value: 'functional',
        label: 'Functional',
        description: 'Specific knowledge, skills and abilities applied within a job or function.'
    }
]

export type Competency = {
    id: string
    name: string
    cluster: CompetencyCluster
    description?: string
    active?: boolean
}

/** Where an item was cascaded from, so it can be traced back. */
export type ItemSource = {
    type: 'qualityObjective' | 'kpi' | 'competency'
    id: string
    subId?: string
    label?: string
}

export type CompactItem = {
    id: string
    section: SectionKey
    kpa: string
    kpi?: string
    weight: number
    target?: string
    standard?: StandardType
    evidence?: string
    source?: ItemSource
    cluster?: CompetencyCluster
    /** Competencies only: the proficiency (1-5) the position requires. */
    requiredLevel?: number
}

export type PdpType = 'training' | 'assignment' | 'mentoring' | 'coaching' | 'study' | 'other'
export type PdpStatus = 'planned' | 'in-progress' | 'done' | 'cancelled'

export const PDP_TYPES: { value: PdpType; label: string }[] = [
    { value: 'training', label: 'Training course' },
    { value: 'assignment', label: 'New assignment' },
    { value: 'mentoring', label: 'Mentoring' },
    { value: 'coaching', label: 'Coaching' },
    { value: 'study', label: 'Formal study' },
    { value: 'other', label: 'Other' }
]

export const PDP_STATUSES: { value: PdpStatus; label: string; color: string }[] = [
    { value: 'planned', label: 'Planned', color: 'default' },
    { value: 'in-progress', label: 'In progress', color: 'blue' },
    { value: 'done', label: 'Done', color: 'green' },
    { value: 'cancelled', label: 'Cancelled', color: 'red' }
]

/** One goal of the personal development plan: a living, non-binding plan. */
export type PdpGoal = {
    id: string
    need: string
    competencyItemId?: string
    action: string
    type: PdpType
    support?: string
    dueDate?: string
    status: PdpStatus
    /** How useful the development turned out to be (1-5), once evaluated. */
    effectiveness?: number | null
}

export type Signature = { uid: string; name: string; at: string; signatureURL?: string | null }
export type SignoffRole = 'manager' | 'employee' | 'hr'
export type Signoff = Partial<Record<SignoffRole, Signature>>

export type CompactStatus = 'draft' | 'awaiting-employee' | 'awaiting-manager' | 'agreed' | 'hr-checked'

export const COMPACT_STATUS_META: Record<CompactStatus, { label: string; color: string }> = {
    draft: { label: 'Draft', color: 'default' },
    'awaiting-employee': { label: 'Awaiting employee', color: 'gold' },
    'awaiting-manager': { label: 'Awaiting manager', color: 'gold' },
    agreed: { label: 'Agreed', color: 'blue' },
    'hr-checked': { label: 'HR checked', color: 'green' }
}

/** The status follows the signatures; nobody sets it by hand. */
export function compactStatus(signoff: Signoff = {}): CompactStatus {
    if (signoff.hr && signoff.manager && signoff.employee) return 'hr-checked'
    if (signoff.manager && signoff.employee) return 'agreed'
    if (signoff.manager) return 'awaiting-employee'
    if (signoff.employee) return 'awaiting-manager'
    return 'draft'
}

/** Status label for current and pre-sign-off records alike. */
export function compactStatusMeta(status?: string) {
    if (status && status in COMPACT_STATUS_META) return COMPACT_STATUS_META[status as CompactStatus]
    const legacy: Record<string, { label: string; color: string }> = {
        'manager-reviewed': { label: 'Manager reviewed', color: 'default' },
        'employee-signed': { label: 'Employee signed', color: 'blue' },
        'ceo-assured': { label: 'CEO assured', color: 'green' }
    }
    return legacy[status || ''] || COMPACT_STATUS_META.draft
}

/** The parts both parties sign: what is expected, not how it was rated. */
export function agreementKey(content: Pick<CompactContent, 'sectionWeights' | 'items'>) {
    return JSON.stringify({ weights: content.sectionWeights, items: content.items })
}

/** Spread 100% across items as evenly as whole numbers allow. */
export function balanceWeights<T extends { weight: number }>(items: T[]): T[] {
    if (!items.length) return items
    const base = Math.floor(100 / items.length)
    const remainder = 100 - base * items.length
    return items.map((item, index) => ({ ...item, weight: base + (index < remainder ? 1 : 0) }))
}

export type ItemRating = {
    self?: number | null
    manager?: number | null
    final?: number | null
    selfComment?: string
    managerComment?: string
}

export type PhaseReview = {
    ratings: Record<string, ItemRating>
    overallSelfComment?: string
    overallManagerComment?: string
    score?: number | null
}

export type SectionWeights = Record<SectionKey, number>

export type CompactContent = {
    sectionWeights: SectionWeights
    items: CompactItem[]
    reviews: Partial<Record<PhaseKey, PhaseReview>>
    pdp?: PdpGoal[]
    /** Mid-cycle goal changes to a signed compact, with the toolkit reason for each. */
    revisions?: CompactRevision[]
}

/** The FY2026/27 model's five management KPAs, kept as the default template. */
export const DEFAULT_MANAGEMENT_ITEMS: CompactItem[] = [
    {
        id: 'scorecard',
        section: 'management',
        kpa: 'Company or department scorecard',
        kpi: 'Contribution towards the company or department scorecard cascaded from organisational KPIs.',
        weight: 20
    },
    {
        id: 'grc',
        section: 'management',
        kpa: 'Governance, risk and compliance',
        kpi: 'Contribution to governance, risk, compliance, audit findings and internal controls.',
        weight: 20
    },
    {
        id: 'procurement',
        section: 'management',
        kpa: 'Procurement and financial management',
        kpi: 'Contribution to procurement, financial controls and effective supply chain management.',
        weight: 20
    },
    {
        id: 'people',
        section: 'management',
        kpa: 'People management',
        kpi: 'Contribution to people management processes and adherence to IPM timelines.',
        weight: 20
    },
    {
        id: 'deliverables',
        section: 'management',
        kpa: 'Key deliverables',
        kpi: 'Contribution towards key deliverables assigned by the CEO or line manager.',
        weight: 20
    }
]

export function defaultCompactContent(): CompactContent {
    return {
        sectionWeights: { strategic: 0, management: 100, milestones: 0, competencies: 0 },
        items: DEFAULT_MANAGEMENT_ITEMS.map(item => ({ ...item })),
        reviews: {}
    }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD for a (possibly overflowing) year, 1-based month and day. */
function ymd(year: number, month: number, day: number) {
    const d = new Date(Date.UTC(year, month - 1, day))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Last day of a 1-based month (overflowing months roll into later years). */
function monthEnd(year: number, month: number) {
    return ymd(year, month + 1, 0)
}

export function cycleLabel(startYear: number, startMonth = DEFAULT_FY_START_MONTH) {
    return startMonth === 1 ? `FY${startYear}` : `FY${startYear}/${pad((startYear + 1) % 100)}`
}

export function cycleIdFromLabel(label: string) {
    return label.replace(/[^A-Za-z0-9]+/g, '-')
}

/**
 * The cycle starting in `startYear`, with the toolkit's default windows:
 * compacting mid-March to mid-April, the mid-year review in the sixth month
 * (September), and the year-end review from the last month to the first month
 * of the next year (March to April).
 */
export function buildCycle(startYear: number, startMonth = DEFAULT_FY_START_MONTH): Omit<PerformanceCycle, 'status'> {
    const label = cycleLabel(startYear, startMonth)
    return {
        id: cycleIdFromLabel(label),
        label,
        startDate: ymd(startYear, startMonth, 1),
        endDate: monthEnd(startYear, startMonth + 11),
        windows: {
            compacting: { from: ymd(startYear, startMonth - 1, 15), to: ymd(startYear, startMonth, 15) },
            midYear: { from: ymd(startYear, startMonth + 5, 1), to: monthEnd(startYear, startMonth + 5) },
            yearEnd: { from: ymd(startYear, startMonth + 11, 1), to: monthEnd(startYear, startMonth + 12) }
        }
    }
}

/** The cycle that contains `date` (a Date or YYYY-MM-DD). */
export function cycleForDate(date: Date | string, startMonth = DEFAULT_FY_START_MONTH) {
    const d = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date
    const year = typeof date === 'string' ? d.getUTCFullYear() : d.getFullYear()
    const month = (typeof date === 'string' ? d.getUTCMonth() : d.getMonth()) + 1
    return buildCycle(month >= startMonth ? year : year - 1, startMonth)
}

export function compactDocId(cycleId: string, employeeUid: string) {
    return `${cycleId}_${employeeUid}`
}

const isRating = (value: unknown): value is number =>
    typeof value === 'number' && value >= 1 && value <= 5

/** Sections that carry weight, in display order. */
export function weightedSections(weights: SectionWeights) {
    return SECTIONS.filter(section => Number(weights[section.key] || 0) > 0)
}

/** Every reason the weights cannot be scored yet; empty when they are valid. */
export function weightProblems(weights: SectionWeights, items: CompactItem[]): string[] {
    const problems: string[] = []
    const sectionTotal = SECTIONS.reduce((sum, section) => sum + Number(weights[section.key] || 0), 0)
    if (sectionTotal !== 100) problems.push(`Section weights add up to ${sectionTotal}%, not 100%.`)

    for (const section of SECTIONS) {
        const sectionItems = items.filter(item => item.section === section.key)
        const weight = Number(weights[section.key] || 0)
        if (weight <= 0) {
            if (sectionItems.length) problems.push(`${section.label} has items but no section weight.`)
            continue
        }
        if (!sectionItems.length) {
            problems.push(`${section.label} is weighted ${weight}% but has no items.`)
            continue
        }
        const itemTotal = sectionItems.reduce((sum, item) => sum + Number(item.weight || 0), 0)
        if (itemTotal !== 100) problems.push(`${section.label} item weights add up to ${itemTotal}%, not 100%.`)
        if (sectionItems.some(item => !String(item.kpa || '').trim())) problems.push(`${section.label} has an item without a KPA.`)
    }
    return problems
}

export type ScoreResult = {
    /** Weighted 1-5 score once every weighted item has a final rating, else null. */
    score: number | null
    /** Weighted score over the items rated so far, for progress display. */
    partial: number | null
    rated: number
    total: number
}

/** Weighted score of one phase's final ratings. */
export function weightedScore(
    weights: SectionWeights,
    items: CompactItem[],
    ratings: Record<string, ItemRating> = {}
): ScoreResult {
    const scored = items.filter(item => Number(weights[item.section] || 0) > 0)
    const total = scored.length
    if (weightProblems(weights, items).length) return { score: null, partial: null, rated: 0, total }

    let weightedSum = 0
    let ratedWeight = 0
    let rated = 0
    for (const item of scored) {
        const share = (Number(weights[item.section]) / 100) * (Number(item.weight) / 100)
        const final = ratings[item.id]?.final
        if (!isRating(final)) continue
        weightedSum += share * final
        ratedWeight += share
        rated += 1
    }

    const round = (value: number) => Math.round(value * 100) / 100
    return {
        score: rated === total && total > 0 ? round(weightedSum) : null,
        partial: ratedWeight > 0 ? round(weightedSum / ratedWeight) : null,
        rated,
        total
    }
}

export function ratingLabel(score?: number | null) {
    if (!score) return 'Not Rated'
    if (score < 1.5) return 'Very Unsatisfactory'
    if (score < 2.5) return 'Unsatisfactory'
    if (score < 3.5) return 'Satisfactory'
    if (score < 4.5) return 'More than Satisfactory'
    return 'Exceptional'
}

export function ratingColor(score?: number | null) {
    if (!score) return 'default'
    if (score < 2.5) return 'red'
    if (score < 3.5) return 'gold'
    if (score < 4.5) return 'blue'
    return 'green'
}

/** The rating that represents a compact: year-end once it exists, else mid-year. */
export function headlineScore(reviews: Partial<Record<PhaseKey, PhaseReview>> = {}) {
    if (typeof reviews.yearEnd?.score === 'number') return { score: reviews.yearEnd.score, phase: 'yearEnd' as const }
    if (typeof reviews.midYear?.score === 'number') return { score: reviews.midYear.score, phase: 'midYear' as const }
    return { score: null, phase: null }
}

/**
 * Pre-cycle compacts were saved as a new document per save, with one rating
 * per default dimension. Seed a new compact from the latest of each phase.
 */
export function compactFromLegacy(
    legacy: { phase?: string; ratings?: Record<string, ItemRating>; overallSelfComment?: string; overallManagerComment?: string; createdAtText?: string }[]
): CompactContent {
    const content = defaultCompactContent()
    const newestFirst = [...legacy].sort((a, b) => String(b.createdAtText || '').localeCompare(String(a.createdAtText || '')))
    for (const phase of PHASES) {
        const record = newestFirst.find(entry => (entry.phase || 'midYear') === phase.key)
        if (!record) continue
        const ratings: Record<string, ItemRating> = {}
        for (const item of content.items) {
            const old = record.ratings?.[item.id]
            if (!old) continue
            ratings[item.id] = {
                self: old.self ?? null,
                manager: old.manager ?? null,
                final: old.final ?? null,
                selfComment: old.selfComment || '',
                managerComment: old.managerComment || ''
            }
        }
        content.reviews[phase.key] = {
            ratings,
            overallSelfComment: record.overallSelfComment || '',
            overallManagerComment: record.overallManagerComment || '',
            score: weightedScore(content.sectionWeights, content.items, ratings).score
        }
    }
    return content
}

// ---- Session 3: check-ins, coaching and performance enhancement ----

/** Check-ins happen at least twice a month, so one is due after 14 days. */
export const CHECK_IN_DUE_DAYS = 14

export type CheckInKind = 'check-in' | 'coaching'
export type GoalStatus = 'on-track' | 'at-risk' | 'off-track' | 'done'

export const GOAL_STATUSES: { value: GoalStatus; label: string; color: string }[] = [
    { value: 'on-track', label: 'On track', color: 'green' },
    { value: 'at-risk', label: 'At risk', color: 'gold' },
    { value: 'off-track', label: 'Off track', color: 'red' },
    { value: 'done', label: 'Done', color: 'blue' }
]

export type ActionItem = { id: string; text: string; owner: 'employee' | 'manager'; due?: string; done?: boolean }

export type CheckIn = {
    id: string
    employeeAuthUid: string
    lineManagerId?: string | null
    cycleId?: string | null
    date: string
    kind: CheckInKind
    goalUpdates: { itemId: string; kpa: string; status: GoalStatus; note?: string }[]
    roadblocks?: string
    updates?: string
    careerNotes?: string
    employeeNotes?: string
    managerFeedback?: string
    actionItems: ActionItem[]
    createdBy?: string
    createdByRole?: 'employee' | 'manager'
}

export type CheckInCadence = { lastDate: string | null; daysSince: number | null; due: boolean }

const DAY_MS = 24 * 60 * 60 * 1000
const dayStart = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`)

/** How long since the last check-in, and whether the next one is due. */
export function checkInCadence(dates: string[], today: string): CheckInCadence {
    const past = dates
        .filter(Boolean)
        .map(d => d.slice(0, 10))
        .filter(d => d <= today.slice(0, 10))
        .sort()
    const lastDate = past.length ? past[past.length - 1] : null
    if (!lastDate) return { lastDate: null, daysSince: null, due: true }
    const daysSince = Math.round((dayStart(today) - dayStart(lastDate)) / DAY_MS)
    return { lastDate, daysSince, due: daysSince >= CHECK_IN_DUE_DAYS }
}

/** Action items still open from earlier check-ins, oldest first, so they get followed up. */
export function openActionItems(checkIns: Pick<CheckIn, 'id' | 'date' | 'actionItems'>[]) {
    return [...checkIns]
        .sort((a, b) => a.date.localeCompare(b.date))
        .flatMap(checkIn =>
            (checkIn.actionItems || [])
                .filter(item => !item.done)
                .map(item => ({ ...item, checkInId: checkIn.id, date: checkIn.date }))
        )
}

export type PerformanceBand = 'under' | 'consistent' | 'excelling'

/** The toolkit's three ways of managing performance, by rating band. */
export const PERFORMANCE_GUIDANCE: Record<PerformanceBand, { title: string; tips: string[] }> = {
    under: {
        title: 'Managing underperformance',
        tips: [
            'Offer on-the-job coaching during regular check-ins.',
            'Restate the work plan and performance requirements.',
            'Look for factors in the work environment that affect performance.',
            'Arrange formal training or retraining where skills are the gap.',
            'Develop a detailed Performance Enhancement Plan.'
        ]
    },
    consistent: {
        title: 'Managing good, consistent performance',
        tips: [
            'Recognise day-to-day contributions.',
            'Give regular feedback about achievements.',
            'Set objectives that challenge and stretch their thinking.',
            'Offer training and development where available.'
        ]
    },
    excelling: {
        title: 'Acknowledging excellent performance',
        tips: [
            'Recognise and reward good practice.',
            'Offer opportunities that stretch and challenge them.',
            'Show interest in their career goals and make clear what opportunities exist to retain them.'
        ]
    }
}

export function performanceBand(score?: number | null): PerformanceBand | null {
    if (typeof score !== 'number' || score <= 0) return null
    if (score < 2.5) return 'under'
    if (score < 4.5) return 'consistent'
    return 'excelling'
}

export type PepStatus = 'draft' | 'active' | 'completed' | 'closed'
export type PepOutcome = 'improved' | 'extended' | 'training' | 'counselling' | 'disciplinary'

export const PEP_STATUSES: { value: PepStatus; label: string; color: string }[] = [
    { value: 'draft', label: 'Draft', color: 'default' },
    { value: 'active', label: 'Active', color: 'red' },
    { value: 'completed', label: 'Completed', color: 'green' },
    { value: 'closed', label: 'Closed', color: 'default' }
]

/** Linking to consequences: how a plan ends. */
export const PEP_OUTCOMES: { value: PepOutcome; label: string }[] = [
    { value: 'improved', label: 'Performance improved' },
    { value: 'extended', label: 'Plan extended' },
    { value: 'training', label: 'Referred to training' },
    { value: 'counselling', label: 'Counselling' },
    { value: 'disciplinary', label: 'Disciplinary process' }
]

export type PepDeficiency = { id: string; area: string; expected: string; actual: string }
export type PepAction = { id: string; action: string; support?: string; owner: 'employee' | 'manager'; due?: string; done?: boolean }
export type PepReview = { id: string; date: string; progress: string; onTrack: boolean }

export type EnhancementPlan = {
    id: string
    employeeAuthUid: string
    lineManagerId?: string | null
    cycleId?: string | null
    status: PepStatus
    startDate: string
    endDate: string
    deficiencies: PepDeficiency[]
    actions: PepAction[]
    reviews: PepReview[]
    outcome?: PepOutcome | null
    outcomeNotes?: string
    employeeComment?: string
    signoff?: Signoff
}

/** A plan goes live only once it says what is wrong and what will be done about it. */
export function pepProblems(
    plan: Pick<EnhancementPlan, 'startDate' | 'endDate' | 'deficiencies' | 'actions' | 'status' | 'outcome'>
): string[] {
    const problems: string[] = []
    if (!plan.deficiencies.some(d => d.area.trim())) problems.push('Describe at least one performance deficiency.')
    if (!plan.actions.some(a => a.action.trim())) problems.push('Add at least one improvement action.')
    if (!plan.startDate || !plan.endDate) problems.push('Set the plan period.')
    else if (plan.endDate < plan.startDate) problems.push('The plan ends before it starts.')
    if ((plan.status === 'completed' || plan.status === 'closed') && !plan.outcome) {
        problems.push('Record the outcome before completing the plan.')
    }
    return problems
}

// ---- Session 4: mid-year and year-end reviews ----

/**
 * One record per employee, cycle and phase (performanceReviews/{cycle}_{uid}_{phase}).
 * The employee owns the self-assessment; the line manager's ratings stay on the
 * compact. Then the gaps are discussed, both sign (or the employee disputes and HR
 * mediates), HR calibrates across departments, and the CEO validates.
 */
export type SelfRating = { rating?: number | null; comment?: string; evidence?: string }

export type ReviewDispute = {
    raisedBy: string
    raisedAt: string
    reason: string
    resolution?: string
    resolvedBy?: string
    resolvedAt?: string
}

export type ReviewCalibration = {
    score: number
    originalScore: number | null
    reason: string
    by: string
    byName?: string
    at: string
}

export type ReviewValidation = { by: string; byName?: string; at: string }

export type ReviewRecord = {
    id: string
    employeeAuthUid: string
    lineManagerId?: string | null
    cycleId: string
    phase: PhaseKey
    self?: Record<string, SelfRating>
    overallSelfComment?: string
    selfSubmittedAt?: string | null
    managerSubmittedAt?: string | null
    dispute?: ReviewDispute | null
    signoff?: Signoff
    calibration?: ReviewCalibration | null
    validation?: ReviewValidation | null
}

export type ReviewStage = 'self' | 'manager' | 'discussion' | 'disputed' | 'calibration' | 'validation' | 'validated'

export const REVIEW_STAGES: { key: ReviewStage; label: string; owner: string }[] = [
    { key: 'self', label: 'Self-assessment', owner: 'Employee' },
    { key: 'manager', label: 'Manager assessment', owner: 'Line manager' },
    { key: 'discussion', label: 'Discuss and sign', owner: 'Both' },
    { key: 'calibration', label: 'Calibration', owner: 'HR' },
    { key: 'validation', label: 'CEO validation', owner: 'CEO' }
]

export const reviewDocId = (cycleId: string, employeeUid: string, phase: PhaseKey) => `${cycleId}_${employeeUid}_${phase}`

/** Where a review stands; like the compact status, it follows what has been recorded. */
export function reviewStage(review?: Partial<ReviewRecord> | null): ReviewStage {
    if (!review) return 'self'
    if (review.validation) return 'validated'
    if (review.dispute && !review.dispute.resolution) return 'disputed'
    if (review.signoff?.manager && review.signoff?.employee) return review.calibration ? 'validation' : 'calibration'
    if (review.managerSubmittedAt) return 'discussion'
    if (review.selfSubmittedAt) return 'manager'
    return 'self'
}

export type RatingGap = { itemId: string; kpa: string; self: number; manager: number; gap: number }

/** Items where the employee's view and the line manager's final rating differ, biggest first. */
export function ratingGaps(
    items: Pick<CompactItem, 'id' | 'kpa'>[],
    self: Record<string, SelfRating> = {},
    managerRatings: Record<string, ItemRating> = {}
): RatingGap[] {
    return items
        .map(item => {
            const s = self[item.id]?.rating
            const m = managerRatings[item.id]?.final
            if (!isRating(s) || !isRating(m)) return null
            return { itemId: item.id, kpa: item.kpa, self: s, manager: m, gap: s - m }
        })
        .filter((gap): gap is RatingGap => !!gap && gap.gap !== 0)
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
}

/** A phase's rating after calibration: HR's calibrated score wins over the compact score. */
export function phaseScore(compactScore: number | null | undefined, review?: Partial<ReviewRecord> | null) {
    if (review?.calibration && typeof review.calibration.score === 'number') return review.calibration.score
    return typeof compactScore === 'number' ? compactScore : null
}

/**
 * The year-end rating "includes the mid-year performance scores". Until a policy
 * says otherwise, the two count equally; change this share to weight them differently.
 */
export const MID_YEAR_SHARE = 0.5

/** The annual rating once the year-end is in; before that, the mid-year stands alone. */
export function annualScore(midYear: number | null, yearEnd: number | null) {
    if (yearEnd === null) return midYear
    if (midYear === null) return yearEnd
    return Math.round((midYear * MID_YEAR_SHARE + yearEnd * (1 - MID_YEAR_SHARE)) * 100) / 100
}

/** Toolkit ground rules for adjusting goals mid-cycle. */
export const RECALIBRATION_REASONS = [
    { value: 'priorities', label: 'Business priorities changed' },
    { value: 'resources', label: 'Available resources changed' },
    { value: 'customers', label: 'Customer expectations changed' },
    { value: 'completed', label: 'Goal completed; room for more contribution' }
] as const

export const RECALIBRATION_NOT_REASONS = [
    'To let someone off the hook for not doing their job.',
    'Because time or resources were not planned accurately.',
    'Just because other goals came up; review all goals and re-prioritise instead.'
]

export type CompactRevision = {
    at: string
    by: string
    byName?: string
    reason: (typeof RECALIBRATION_REASONS)[number]['value']
    note?: string
}

// ---- Session 5: automation and reporting ----

export type ActionOwner = 'employee' | 'manager' | 'hr' | 'ceo'
export type ActionKind =
    | 'assign-manager'
    | 'compact-manager'
    | 'compact-employee'
    | 'compact-hr'
    | 'check-in'
    | 'book-review'
    | 'self-assessment'
    | 'manager-assessment'
    | 'sign-review'
    | 'dispute'
    | 'calibrate'
    | 'validate'

export type OutstandingAction = { kind: ActionKind; owner: ActionOwner; employeeUid: string; phase?: PhaseKey; overdue?: boolean }

export const ACTION_LABELS: Record<ActionKind, string> = {
    'assign-manager': 'Assign a line manager',
    'compact-manager': 'Agree and sign the compact',
    'compact-employee': 'Sign the compact',
    'compact-hr': 'HR compliance check of the compact',
    'check-in': 'Check-in overdue',
    'book-review': 'Book the review meeting',
    'self-assessment': 'Complete the self-assessment',
    'manager-assessment': 'Complete the manager assessment',
    'sign-review': 'Sign the review',
    dispute: 'Mediate the dispute',
    calibrate: 'Calibrate the rating',
    validate: 'Validate the rating'
}

/** Reviews are booked at least a week before the window opens. */
export const BOOK_REVIEW_DAYS = 7

export type EmployeeIpmState = {
    uid: string
    lineManagerId?: string | null
    compact?: { signoff?: Signoff } | null
    checkInDates: string[]
    reviews: Partial<Record<PhaseKey, Partial<ReviewRecord>>>
}

const daysBetween = (from: string, to: string) => Math.round((dayStart(to) - dayStart(from)) / DAY_MS)

/**
 * What is outstanding for one employee in a cycle, and whose move it is. The
 * HR dashboard lists these and the reminder job (functions/src/ipmReminderLogic.ts,
 * which mirrors this) sends them.
 */
export function outstandingActions(cycle: Pick<PerformanceCycle, 'status' | 'endDate' | 'windows'>, today: string, state: EmployeeIpmState): OutstandingAction[] {
    const day = today.slice(0, 10)
    const uid = state.uid
    if (cycle.status === 'closed' || day < cycle.windows.compacting.from) return []
    if (!state.lineManagerId) return [{ kind: 'assign-manager', owner: 'hr', employeeUid: uid }]

    const actions: OutstandingAction[] = []
    const signoff = state.compact?.signoff || {}
    const status = compactStatus(signoff)
    const compactOverdue = day > cycle.windows.compacting.to
    if (status === 'draft' || status === 'awaiting-manager') {
        return [{ kind: 'compact-manager', owner: 'manager', employeeUid: uid, overdue: compactOverdue }]
    }
    if (status === 'awaiting-employee') {
        return [{ kind: 'compact-employee', owner: 'employee', employeeUid: uid, overdue: compactOverdue }]
    }
    if (status === 'agreed') actions.push({ kind: 'compact-hr', owner: 'hr', employeeUid: uid })

    // Check-ins run from the day the compact was agreed until the cycle ends.
    if (day <= cycle.endDate) {
        const agreedOn = [signoff.manager?.at, signoff.employee?.at].filter(Boolean).map(at => String(at).slice(0, 10)).sort().pop()
        const cadence = checkInCadence([...state.checkInDates, ...(agreedOn ? [agreedOn] : [])], day)
        if (cadence.due) {
            actions.push({ kind: 'check-in', owner: 'employee', employeeUid: uid })
            actions.push({ kind: 'check-in', owner: 'manager', employeeUid: uid })
        }
    }

    PHASES.forEach(({ key: phase }) => {
        const window = cycle.windows[phase]
        const record = state.reviews[phase] || null
        const stage = reviewStage(record)
        const until = daysBetween(day, window.from)
        if (until > 0) {
            if (until <= BOOK_REVIEW_DAYS && stage === 'self') actions.push({ kind: 'book-review', owner: 'manager', employeeUid: uid, phase })
            return
        }
        const overdue = day > window.to
        const add = (kind: ActionKind, owner: ActionOwner) => actions.push({ kind, owner, employeeUid: uid, phase, overdue })
        if (stage === 'self') {
            add('self-assessment', 'employee')
            // Once the window has closed the manager goes ahead without it.
            if (overdue) add('manager-assessment', 'manager')
        } else if (stage === 'manager') add('manager-assessment', 'manager')
        else if (stage === 'discussion') {
            if (!record?.signoff?.manager) add('sign-review', 'manager')
            if (!record?.signoff?.employee) add('sign-review', 'employee')
        } else if (stage === 'disputed') add('dispute', 'hr')
        else if (stage === 'calibration') add('calibrate', 'hr')
        else if (stage === 'validation') add('validate', 'ceo')
    })
    return actions
}

export type ScoreRollUp = { key: string; label: string; count: number; rated: number; average: number | null }

/** Average rating per group (department, centre), plus the company as a whole. */
export function rollUpScores<T extends { score: number | null }>(
    rows: T[],
    groupOf: (row: T) => { key: string; label: string } | null
): { company: ScoreRollUp; groups: ScoreRollUp[] } {
    const summarise = (key: string, label: string, list: T[]): ScoreRollUp => {
        const scores = list.map(r => r.score).filter((s): s is number => typeof s === 'number' && s > 0)
        const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null
        return { key, label, count: list.length, rated: scores.length, average }
    }
    const groups = new Map<string, { label: string; rows: T[] }>()
    rows.forEach(row => {
        const group = groupOf(row) || { key: '', label: 'Unassigned' }
        const current = groups.get(group.key) || { label: group.label, rows: [] }
        current.rows.push(row)
        groups.set(group.key, current)
    })
    return {
        company: summarise('company', 'Company', rows),
        groups: [...groups.entries()]
            .map(([key, g]) => summarise(key, g.label, g.rows))
            .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.label.localeCompare(b.label))
    }
}
