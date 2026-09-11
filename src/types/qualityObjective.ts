// Quality Objectives (LEP-QMS 024 F) Types
// Digital equivalent of the paper "Quality Objectives" form used by each
// department to define its yearly objectives, steps, responsible persons,
// and target/completion dates.

export interface QualityObjectiveStep {
  id: string
  description: string
  responsiblePerson: string
  targetDate: string
  completionDate: string
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
  periodStart: string
  periodEnd: string
  steps: QualityObjectiveStep[]
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
  periodStart: string
  periodEnd: string
  steps: Omit<QualityObjectiveStep, 'id'>[]
  preparedBy: string
  preparedDate: string
  approvedByCEO: string
  acknowledgedByHOD: string
}
