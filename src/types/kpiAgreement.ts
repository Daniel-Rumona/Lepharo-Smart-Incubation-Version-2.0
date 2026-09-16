// KPI Agreements (LEP-QMS 054 F) Types
// Digital record of a signed funder/stakeholder "Key Performance Indicator
// Agreement" letter - the annual/quarterly targets (or qualitative
// deliverables) a department has agreed to for a funded programme, plus the
// HOD / Center Manager / CEO sign-off. These are distinct from the internal
// computed KPIs tracked in kpiDefinitions/kpiTargets: an agreement is the
// signed commitment itself, not a live-calculated metric.

export interface KpiNumericTarget {
  id: string
  kpiName: string
  annual: number
  q1: number
  q2: number
  q3: number
  q4: number
}

export interface KpiDeliverable {
  id: string
  kpiArea: string
  deliverable: string
  measurementIndicator: string
  frequency: string
}

export interface KpiAgreementSignOffEntry {
  name: string
  date: string
}

export interface KpiAgreementSignOff {
  hod: KpiAgreementSignOffEntry
  centerManager: KpiAgreementSignOffEntry
  ceo: KpiAgreementSignOffEntry
}

export const makeEmptySignOff = (): KpiAgreementSignOff => ({
  hod: { name: '', date: '' },
  centerManager: { name: '', date: '' },
  ceo: { name: '', date: '' }
})

export interface KpiAgreementSource {
  fileName: string
  extractedAt: string
}

export interface KpiAgreement {
  id: string
  departmentId: string
  departmentName: string
  serviceName: string
  formNo: string
  revisionNo: string
  effectiveDate: string
  fyLabel: string
  monthlyCapacity: string
  numericTargets: KpiNumericTarget[]
  deliverables: KpiDeliverable[]
  signOff: KpiAgreementSignOff
  source?: KpiAgreementSource | null
  isActive?: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

export interface KpiAgreementFormData {
  departmentId: string
  departmentName: string
  serviceName: string
  formNo: string
  revisionNo: string
  effectiveDate: string
  fyLabel: string
  monthlyCapacity: string
  numericTargets: Omit<KpiNumericTarget, 'id'>[]
  deliverables: Omit<KpiDeliverable, 'id'>[]
  signOff: KpiAgreementSignOff
  source?: KpiAgreementSource | null
}
