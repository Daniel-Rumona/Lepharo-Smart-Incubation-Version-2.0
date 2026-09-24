import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'

/* ================= TYPES ================= */

type SourceType = 'interventions' | 'applications' | 'metrics'

type CalculationType = 'count' | 'sum' | 'average' | 'ratio'

type CountMode = 'records' | 'distinct'

type PeriodType = 'monthly' | 'quarterly'

type KpiFilter = {
  field: string
  op: '==' | '!=' | 'in'
  value: any
}

type RatioPartConfig = {
  calculationType: 'count_records' | 'sum_field' | 'avg_field'
  field?: string | null
  filters?: KpiFilter[]
}

export interface KPI {
  id: string
  sourceType: SourceType
  calculationType: CalculationType

  field?: string | null
  filters?: KpiFilter[]
  numerator?: RatioPartConfig | null
  denominator?: RatioPartConfig | null

  interventionIds?: string[]

  countMode?: CountMode
  entityKey?: string

  appliesToAllPrograms?: boolean
}

export interface ComputeParams {
  kpi: KPI
  programId?: string | null
  isAllPrograms?: boolean
  periodType: PeriodType
  periodKey: string // e.g. "2026-01" or "2026-Q1"
  target?: number | null
}

export interface ComputeResult {
  kpiId: string
  actual: number
  target: number | null
  variance: number | null
  achievementPercent: number | null
  matchedCount: number
  periodType: PeriodType
  periodKey: string
}

/* ================= MAIN ================= */

export async function computeKpi(params: ComputeParams): Promise<ComputeResult> {
  const { kpi, programId, isAllPrograms, periodType, periodKey, target } = params

  // "Jobs Created"/"Jobs Sustained" live under the Business Metrics source in
  // the UI (so they share its normal field-picking flow, no separate source
  // card and no confusing count-mode prompt), but they're real HSE employment
  // contracts, not self-reported monthly numbers - so they read from
  // hseJobContracts and are always counted, regardless of whatever
  // calculationType the wizard attached (it maps metrics+total_number to
  // 'sum', which is right for every other metrics field, just not these two).
  const isJobsField = kpi.sourceType === 'metrics' && (kpi.field === 'jobsCreated' || kpi.field === 'jobsSustained')

  let data: any[] = []

  /* ================= FETCH ================= */

  if (kpi.sourceType === 'interventions') {
    data = await fetchInterventions(programId, isAllPrograms)
  }

  if (kpi.sourceType === 'applications') {
    data = await fetchApplications(programId, isAllPrograms)
  }

  if (kpi.sourceType === 'metrics') {
    data = isJobsField
      ? await fetchJobContracts(programId, isAllPrograms)
      : await fetchMetrics(programId, isAllPrograms)
  }

  /* ================= HARD RULES ================= */

  if (kpi.sourceType === 'interventions') {
    data = data.filter(d => d.status === 'completed')

    if (kpi.interventionIds?.length) {
      data = data.filter(d => kpi.interventionIds!.includes(d.interventionId))
    }
  }

  if (kpi.sourceType === 'applications') {
    data = data.filter(d => d.applicationStatus === 'accepted')
  }

  /* ================= PERIOD FILTER ================= */

  const { start, end } = resolvePeriod(periodType, periodKey)

  if (isJobsField && kpi.field === 'jobsSustained') {
    // "Sustained" isn't "happened during this period" like every other
    // source - it's "already existed by the period's end, and hadn't
    // expired yet": permanent contracts always count, temporal ones only
    // while their end date is still on or after the period.
    data = data.filter(d => {
      const created = normalizeDate(d.createdAt || d.uploadMonthDate)
      if (!created || created.isAfter(end)) return false
      if (d.contractType === 'permanent') return true
      const expiry = normalizeDate(d.contractEndDate)
      return expiry ? !expiry.isBefore(end) : true
    })
  } else {
    data = data.filter(d => {
      const rawDate =
        kpi.sourceType === 'interventions'
          ? (d.completedAt || d.createdAt || d.updatedAt)
          : isJobsField
            ? (d.uploadMonthDate || d.createdAt)
            : (d.createdAt || d.date || d.updatedAt)

      const date = normalizeDate(rawDate)
      if (!date) return false
      // A reporting period includes both its first and last day. Strict comparisons
      // dropped records stamped exactly at either boundary.
      return !date.isBefore(start) && !date.isAfter(end)
    })
  }

  /* ================= USER FILTERS ================= */

  if (kpi.filters?.length) {
    data = applyFilters(data, kpi.filters)
  }

  /* ================= CALCULATION ================= */

  let actual = 0

  if (isJobsField) {
    actual = data.length
  } else if (kpi.calculationType === 'count') {
    if (kpi.countMode === 'distinct') {
      const set = new Set(data.map(d => {
        if (kpi.entityKey && d[kpi.entityKey] !== undefined && d[kpi.entityKey] !== null) {
          return d[kpi.entityKey]
        }

        // Record IDs are not an SME identity. Use the stored canonical identity
        // when available, with the document ID as the legacy fallback.
        return d.participantId || d.smmeId || d.applicantId || d.businessId || d.id
      }))
      actual = set.size
    } else {
      actual = data.length
    }
  }

  if (!isJobsField && kpi.calculationType === 'sum') {
    actual = data.reduce((sum, d) => sum + Number(d[kpi.field || ''] || 0), 0)
  }

  if (!isJobsField && kpi.calculationType === 'average') {
    const total = data.reduce((sum, d) => sum + Number(d[kpi.field || ''] || 0), 0)
    actual = data.length ? total / data.length : 0
  }

  if (!isJobsField && kpi.calculationType === 'ratio') {
    const calculatePart = (part?: RatioPartConfig | null) => {
      if (!part) return 0
      const partData = part.filters?.length ? applyFilters(data, part.filters) : data
      if (part.calculationType === 'sum_field') {
        return partData.reduce((sum, item) => sum + Number(item[part.field || ''] || 0), 0)
      }
      if (part.calculationType === 'avg_field') {
        const total = partData.reduce((sum, item) => sum + Number(item[part.field || ''] || 0), 0)
        return partData.length ? total / partData.length : 0
      }
      return partData.length
    }

    const numerator = calculatePart(kpi.numerator)
    const denominator = calculatePart(kpi.denominator)
    actual = denominator > 0 ? (numerator / denominator) * 100 : 0
  }

  /* ================= TARGET ================= */

  const variance =
    target != null ? actual - target : null

  const achievementPercent =
    target && target !== 0
      ? (actual / target) * 100
      : null

  return {
    kpiId: kpi.id,
    actual,
    target: target ?? null,
    variance,
    achievementPercent,
    matchedCount: data.length,
    periodType,
    periodKey
  }
}

/* ================= FETCH HELPERS ================= */

async function fetchInterventions(programId?: string | null, isAllPrograms?: boolean) {
  const reference = collection(db, 'assignedInterventions')
  const qRef = !isAllPrograms && programId
    ? query(reference, where('programId', '==', programId))
    : query(reference)

  const snap = await getDocs(qRef)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function fetchApplications(programId?: string | null, isAllPrograms?: boolean) {
  const reference = collection(db, 'applications')
  const qRef = !isAllPrograms && programId
    ? query(reference, where('programId', '==', programId))
    : query(reference)

  const snap = await getDocs(qRef)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function fetchMetrics(programId?: string | null, isAllPrograms?: boolean) {
  const reference = collection(db, 'participantMonthlyMetrics')
  const qRef = !isAllPrograms && programId
    ? query(reference, where('programId', '==', programId))
    : query(reference)

  const snap = await getDocs(qRef)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function fetchJobContracts(programId?: string | null, isAllPrograms?: boolean) {
  const reference = collection(db, 'hseJobContracts')
  const qRef = !isAllPrograms && programId
    ? query(reference, where('programId', '==', programId))
    : query(reference)

  const snap = await getDocs(qRef)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/* ================= FILTERS ================= */

function applyFilters(data: any[], filters: KpiFilter[]) {
  return data.filter(item =>
    filters.every(f => {
      const val = item[f.field]

      if (f.op === '==') return val === f.value
      if (f.op === '!=') return val !== f.value
      if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val)

      return true
    })
  )
}

/* ================= PERIOD ================= */

function resolvePeriod(periodType: PeriodType, periodKey: string) {
  if (periodType === 'monthly') {
    const start = dayjs(periodKey).startOf('month')
    const end = dayjs(periodKey).endOf('month')
    return { start, end }
  }

  if (periodType === 'quarterly') {
    const [year, q] = periodKey.split('-Q')
    const start = dayjs(`${year}-01-01`)
      .add((Number(q) - 1) * 3, 'month')
      .startOf('month')

    const end = start.add(2, 'month').endOf('month')

    return { start, end }
  }

  return { start: dayjs().startOf('month'), end: dayjs().endOf('month') }
}

/* ================= DATE ================= */

function normalizeDate(value: any) {
  if (!value) return null

  if (value.seconds) {
    return dayjs(value.seconds * 1000)
  }

  if (value instanceof Date) {
    return dayjs(value)
  }

  if (typeof value === 'string') {
    return dayjs(value)
  }

  return null
}
