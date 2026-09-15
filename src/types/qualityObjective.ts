// Quality Objectives (LEP-QMS 024 F) Types
// Digital equivalent of the paper "Quality Objectives" form used by each
// department to define its yearly objectives, steps, responsible persons,
// and target/completion dates. Extended with the Key Performance Area /
// KPI / weighting / SMART / rating-scale concepts from the Lepharo
// Individual Performance Management (IPM) Toolkit so that each quality
// objective can be tracked the same way individual performance is.

export interface QualityObjectiveStep {
  id: string
  description: string
  responsiblePerson: string
  targetDate: string
  completionDate: string
}

// The 5-point rating scale used throughout the IPM Toolkit to assess
// achievement against an objective or KPI.
export type RatingLevel =
  | 'exceptional'
  | 'more_than_satisfactory'
  | 'satisfactory'
  | 'unsatisfactory'
  | 'very_unsatisfactory'

export interface RatingLevelMeta {
  value: RatingLevel
  label: string
  shortLabel: string
  description: string
  color: string
  score: number
}

export const RATING_LEVELS: RatingLevelMeta[] = [
  {
    value: 'exceptional',
    label: 'Exceptional performance',
    shortLabel: 'Exceptional',
    description: 'Significantly exceeds expectations. Constantly exceeds requirements. Quality of contributions is of a superior standard.',
    color: 'purple',
    score: 5
  },
  {
    value: 'more_than_satisfactory',
    label: 'More than satisfactory performance',
    shortLabel: 'More than satisfactory',
    description: 'Exceeds expectations. Always meets requirements and occasionally exceeds expectations. Quality of contributions is more than expected.',
    color: 'green',
    score: 4
  },
  {
    value: 'satisfactory',
    label: 'Satisfactory performance',
    shortLabel: 'Satisfactory',
    description: 'Meets expectations. Does what is expected. Quality of contributions meets expectations.',
    color: 'blue',
    score: 3
  },
  {
    value: 'unsatisfactory',
    label: 'Unsatisfactory performance',
    shortLabel: 'Unsatisfactory',
    description: 'Occasionally meets expectations. Misses requirements and deadlines on occasion. Areas for improvement are evident.',
    color: 'orange',
    score: 2
  },
  {
    value: 'very_unsatisfactory',
    label: 'Very unsatisfactory performance',
    shortLabel: 'Very unsatisfactory',
    description: 'Consistently falls short of expectations. Does not achieve the requirements most of the time. Needs to improve performance significantly.',
    color: 'red',
    score: 1
  }
]

export const getRatingMeta = (rating?: RatingLevel | null): RatingLevelMeta | undefined =>
  rating ? RATING_LEVELS.find(r => r.value === rating) : undefined

// SMART criteria (Specific, Measurable, Achievable, Realistic, Time-bound)
// self-assessed by the department when setting the objective.
export interface SmartCriteria {
  specific: boolean
  measurable: boolean
  achievable: boolean
  realistic: boolean
  timeBound: boolean
}

export const SMART_CRITERIA_META: { key: keyof SmartCriteria; label: string; description: string }[] = [
  {
    key: 'specific',
    label: 'Specific',
    description: 'The activities listed in the objective need to be clearly defined.'
  },
  {
    key: 'measurable',
    label: 'Measurable',
    description: 'The reviewer and department should be able to easily measure the results against the agreed objective.'
  },
  {
    key: 'achievable',
    label: 'Achievable',
    description: 'Sufficiently challenging but possible to achieve.'
  },
  {
    key: 'realistic',
    label: 'Realistic',
    description: 'Within limits of resource, time and knowledge availability.'
  },
  {
    key: 'timeBound',
    label: 'Time-bound',
    description: 'Has a clear deadline within the performance year.'
  }
]

export const makeDefaultSmartCriteria = (): SmartCriteria => ({
  specific: false,
  measurable: false,
  achievable: false,
  realistic: false,
  timeBound: false
})

// A measurable Key Performance Indicator under the objective's Key
// Performance Area, with its own weighting and target/actual tracking.
export interface QualityObjectiveKPI {
  id: string
  description: string
  targetValue: string
  actualValue: string
  weighting: number
  rating?: RatingLevel
}

export interface QualityObjective {
  id: string
  departmentId: string
  departmentName: string
  formNo: string
  revisionNo: string
  effectiveDate: string
  referenceNumber: string
  objectiveNumber: number
  objectiveText: string
  kpaName: string
  weighting: number
  smart: SmartCriteria
  kpis: QualityObjectiveKPI[]
  periodStart: string
  periodEnd: string
  steps: QualityObjectiveStep[]
  overallRating?: RatingLevel
  ratingComments?: string
  preparedBy: string
  preparedDate: string
  approvedByCEO: string
  acknowledgedByHOD: string
  isActive?: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

// Simplified quality objective form data for creating/editing
export interface QualityObjectiveFormData {
  departmentId: string
  departmentName: string
  formNo: string
  revisionNo: string
  effectiveDate: string
  referenceNumber: string
  objectiveNumber: number
  objectiveText: string
  kpaName: string
  weighting: number
  smart: SmartCriteria
  kpis: Omit<QualityObjectiveKPI, 'id'>[]
  periodStart: string
  periodEnd: string
  steps: Omit<QualityObjectiveStep, 'id'>[]
  overallRating?: RatingLevel
  ratingComments?: string
  preparedBy: string
  preparedDate: string
  approvedByCEO: string
  acknowledgedByHOD: string
}
