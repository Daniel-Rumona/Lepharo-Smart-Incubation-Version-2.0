// KPI candidates drafted by the "Add KPI" assistant from an uploaded letter or
// a conversation. Each candidate is checked against the same live data
// sources the manual KPI builder uses (see SOURCE_CONFIGS in
// src/routes/kpis/index.tsx) - a candidate with a resolved mapping becomes a
// real computed KPI (kpiDefinitions + kpiTargets), one without becomes a
// manually-tracked KPI with reminders instead of a disconnected static number.

export type KpiCandidateSourceType = 'applications' | 'interventions' | 'metrics'
export type KpiCandidateCalculationType = 'count' | 'sum' | 'average'
export type KpiCandidateConfidence = 'high' | 'medium' | 'low'

export interface KpiCandidateMapping {
  sourceType: KpiCandidateSourceType | null
  field: string | null
  calculationType: KpiCandidateCalculationType | null
  unit: string
  interventionTitleMatch: string | null
  confidence: KpiCandidateConfidence
  rationale: string
}

export interface KpiCandidate {
  kpiName: string
  kpiArea: string
  annual: number
  q1: number
  q2: number
  q3: number
  q4: number
  frequency: string
  measurementIndicator: string
  mapping: KpiCandidateMapping | null
}

export interface KpiCandidateDraft {
  serviceName: string
  fyLabel: string
  formNo: string
  revisionNo: string
  effectiveDate: string
  monthlyCapacity: string
  candidates: KpiCandidate[]
  warnings: string[]
}

export interface KpiCandidateChatMessage {
  role: 'user' | 'assistant'
  content: string
}
