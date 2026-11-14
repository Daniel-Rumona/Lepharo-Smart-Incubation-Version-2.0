import dayjs, { Dayjs } from 'dayjs'

// The one reader for SME jobs. HSE uploads employment contracts to
// hseJobContracts, one record per document; a person keeps the same job across
// renewals and re-uploads. Every screen counts jobs through this file so
// "Jobs Created" and "Jobs Sustained" mean the same thing everywhere.
//
// Definitions (count-based against the SME's starting headcount):
//   starting headcount = the SME's own headcount just before it joined the
//                        programme (application.jobsBaseline, frozen at
//                        acceptance; else derived from participant.headcountHistory)
//   active(D)          = distinct jobs started on/before D and not ended by D
//   sustained(D)       = min(starting headcount, active(D))
//   created(D)         = max(0, active(D) - starting headcount)
//   created in [S, E]  = created(E) - created(day before S), floored at 0

export type ContractType = 'permanent' | 'temporary'

/** One hseJobContracts document. `contractType` is stored as 'temporal' on older records. */
export type JobContractRecord = {
    id: string
    applicationId: string
    participantId?: string | null
    programId?: string | null
    smmeName?: string
    group?: string
    gender?: string
    sector?: string

    /** Groups renewals of one job. Older records have none; their key is application + name + position. */
    jobId?: string | null
    employeeName: string
    position: string
    contractType: string
    /** When the person started this job. Older records have none; the earliest upload month stands in. */
    startDate?: any
    contractEndDate?: any
    /** Set when the job ends early (resigned, dismissed...) or a permanent job ends. */
    endedAt?: any
    endReason?: string | null

    uploadMonth?: string
    uploadMonthDate?: any
    fileName?: string
    fileUrl?: string
    storagePath?: string
    uploadedByName?: string
    uploadedByEmail?: string | null
    createdAt?: any
    updatedAt?: any
}

export type Job = {
    key: string
    applicationId: string
    participantId?: string | null
    programId?: string | null
    employeeName: string
    position: string
    contractType: ContractType
    /** Start date, or the earliest upload month when none was captured. */
    start: Dayjs | null
    startIsEstimated: boolean
    /** The day the job stops counting: endedAt, else a temporary contract's expiry. Null = open-ended. */
    end: Dayjs | null
    endedAt: Dayjs | null
    endReason: string | null
    /** Temporary contract expiry from the latest document (null for permanent). */
    contractExpiry: Dayjs | null
    /** Newest first. */
    contracts: JobContractRecord[]
    latest: JobContractRecord
}

export type JobsBaseline = {
    permanent: number
    temporary: number
    total: number
    /** The headcount period the numbers come from, e.g. "Aug 2026" or "2025". */
    period: string | null
    source: 'frozen' | 'headcountHistory' | 'none'
}

export const END_REASONS = [
    { value: 'resigned', label: 'Resigned' },
    { value: 'contract-ended', label: 'Contract ended' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: 'retrenched', label: 'Retrenched' },
    { value: 'business-closed', label: 'Business closed' },
    { value: 'other', label: 'Other' }
] as const

// Permanent contracts were saved with this placeholder expiry; it isn't an end.
const PERMANENT_PLACEHOLDER_YEAR = 2030

const MONTH_NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
]

export const toDayjs = (value: any): Dayjs | null => {
    if (value === undefined || value === null || value === '') return null
    if (dayjs.isDayjs(value)) return value.isValid() ? value : null
    if (typeof value?.toDate === 'function') {
        const d = dayjs(value.toDate())
        return d.isValid() ? d : null
    }
    if (typeof value?.seconds === 'number') {
        const d = dayjs(value.seconds * 1000)
        return d.isValid() ? d : null
    }
    const d = dayjs(value)
    return d.isValid() ? d : null
}

const clean = (value: any) => String(value ?? '').trim().toLowerCase()

export const normalizeContractType = (value: any): ContractType =>
    clean(value) === 'permanent' ? 'permanent' : 'temporary'

/** The value stored for a temporary contract; older screens read 'temporal'. */
export const STORED_TEMPORARY = 'temporal'

export const legacyJobKey = (c: Pick<JobContractRecord, 'applicationId' | 'employeeName' | 'position'>) =>
    [c.applicationId || '', clean(c.employeeName), clean(c.position)].join('::')

export const jobKeyOf = (c: JobContractRecord) => c.jobId || legacyJobKey(c)

/** The month a document was uploaded for. */
export const contractMonth = (c: JobContractRecord): Dayjs | null =>
    toDayjs(c.uploadMonthDate)?.startOf('month') ||
    (c.uploadMonth ? toDayjs(`${c.uploadMonth}-01`)?.startOf('month') ?? null : null) ||
    toDayjs(c.createdAt)?.startOf('month') ||
    null

const sortNewestFirst = (a: JobContractRecord, b: JobContractRecord) => {
    const byMonth = (contractMonth(b)?.valueOf() || 0) - (contractMonth(a)?.valueOf() || 0)
    if (byMonth) return byMonth
    return (toDayjs(b.createdAt)?.valueOf() || 0) - (toDayjs(a.createdAt)?.valueOf() || 0)
}

const realExpiry = (c: JobContractRecord): Dayjs | null => {
    const d = toDayjs(c.contractEndDate)
    if (!d) return null
    if (normalizeContractType(c.contractType) === 'permanent') return null
    if (d.year() >= PERMANENT_PLACEHOLDER_YEAR && d.month() === 11 && d.date() === 31) return null
    return d.endOf('day')
}

/** Groups contract documents into jobs: one per person per position. */
export const groupJobs = (contracts: JobContractRecord[]): Job[] => {
    const byKey = new Map<string, JobContractRecord[]>()
    contracts.forEach(c => {
        if (!c?.applicationId) return
        const key = jobKeyOf(c)
        const list = byKey.get(key)
        if (list) list.push(c)
        else byKey.set(key, [c])
    })

    return Array.from(byKey.entries()).map(([key, list]) => {
        const sorted = [...list].sort(sortNewestFirst)
        const latest = sorted[0]
        const contractType = normalizeContractType(latest.contractType)

        const startDates = sorted.map(c => toDayjs(c.startDate)).filter(Boolean) as Dayjs[]
        const months = sorted.map(contractMonth).filter(Boolean) as Dayjs[]
        const earliest = (dates: Dayjs[]) => dates.reduce<Dayjs | null>((min, d) => (!min || d.isBefore(min) ? d : min), null)
        const captured = earliest(startDates)
        const start = (captured || earliest(months))?.startOf('day') || null

        const endedDates = sorted.map(c => toDayjs(c.endedAt)).filter(Boolean) as Dayjs[]
        const endedAt = endedDates.length
            ? endedDates.reduce((max, d) => (d.isAfter(max) ? d : max)).endOf('day')
            : null
        const endReason = sorted.find(c => c.endReason)?.endReason || null
        const contractExpiry = contractType === 'temporary' ? realExpiry(latest) : null

        let end: Dayjs | null = endedAt
        if (!end && contractExpiry) end = contractExpiry

        return {
            key,
            applicationId: latest.applicationId,
            participantId: latest.participantId ?? null,
            programId: latest.programId ?? null,
            employeeName: latest.employeeName,
            position: latest.position,
            contractType,
            start,
            startIsEstimated: !captured,
            end,
            endedAt,
            endReason,
            contractExpiry,
            contracts: sorted,
            latest
        }
    })
}

export const isJobActiveOn = (job: Job, date: Dayjs) => {
    if (!job.start || job.start.isAfter(date.endOf('day'))) return false
    return !job.end || !job.end.isBefore(date.startOf('day'))
}

export const activeJobsOn = (jobs: Job[], date: Dayjs) => jobs.filter(job => isJobActiveOn(job, date))

/* ===================== starting headcount ===================== */

const n = (value: any) => {
    const v = Number(value)
    return Number.isFinite(v) && v > 0 ? v : 0
}

const totals = (row: any) => {
    const permanent = n(row?.permanent)
    const temporary = n(row?.temporary)
    const total = row?.total !== undefined && row?.total !== null ? n(row.total) || permanent + temporary : permanent + temporary
    return { permanent, temporary, total }
}

/** The date an SME joined the programme, from its accepted application. */
export const programmeStartOf = (application: any): Dayjs | null =>
    toDayjs(application?.acceptedAt) ||
    toDayjs(application?.decision?.decidedAt) ||
    toDayjs(application?.dateAccepted) ||
    toDayjs(application?.submittedAt) ||
    toDayjs(application?.createdAt)

/**
 * The SME's headcount just before `reference` (its programme start), from the
 * headcount history on its participant record. Monthly keys are "YYYY-MM" or,
 * on older records, a month name (taken as its latest occurrence on or before
 * the reference). Falls back to the latest year on or before, then to the
 * earliest entry recorded after (an SME that filled its history in late).
 */
export const baselineFromHeadcountHistory = (participant: any, reference: Dayjs | null): JobsBaseline => {
    const ref = (reference || dayjs()).endOf('month')
    const monthly = participant?.headcountHistory?.monthly || {}
    const annual = participant?.headcountHistory?.annual || {}

    type Entry = { date: Dayjs; label: string; row: any }
    const entries: Entry[] = []
    Object.entries(monthly).forEach(([key, row]) => {
        if (/^\d{4}-\d{2}$/.test(key)) {
            const date = dayjs(`${key}-01`)
            if (date.isValid()) entries.push({ date, label: date.format('MMM YYYY'), row })
            return
        }
        const index = MONTH_NAMES.indexOf(clean(key))
        if (index < 0) return
        let date = ref.startOf('month').month(index)
        if (date.isAfter(ref)) date = date.subtract(1, 'year')
        entries.push({ date, label: date.format('MMM YYYY'), row })
    })
    const withStaff = entries.filter(e => totals(e.row).total > 0)

    const pick = (list: Entry[]) => {
        const before = list.filter(e => !e.date.isAfter(ref)).sort((a, b) => b.date.valueOf() - a.date.valueOf())
        if (before.length) return before[0]
        const after = list.sort((a, b) => a.date.valueOf() - b.date.valueOf())
        return after[0]
    }

    const month = pick(withStaff)
    if (month) return { ...totals(month.row), period: month.label, source: 'headcountHistory' }

    const years = Object.keys(annual).filter(y => /^\d{4}$/.test(y) && totals(annual[y]).total > 0)
    const yearBefore = years.filter(y => Number(y) <= ref.year()).sort().pop()
    const year = yearBefore || years.sort()[0]
    if (year) return { ...totals(annual[year]), period: year, source: 'headcountHistory' }

    return { permanent: 0, temporary: 0, total: 0, period: null, source: 'none' }
}

/** The starting headcount: frozen on the application at acceptance, else derived. */
export const jobsBaselineFor = (application: any, participant: any): JobsBaseline => {
    const frozen = application?.jobsBaseline
    if (frozen && (frozen.total !== undefined || frozen.permanent !== undefined)) {
        return { ...totals(frozen), period: frozen.period ?? null, source: 'frozen' }
    }
    return baselineFromHeadcountHistory(participant, programmeStartOf(application))
}

/** What to store on the application when it is accepted. */
export const captureJobsBaseline = (participant: any, reference: Dayjs | null) => {
    const b = baselineFromHeadcountHistory(participant, reference)
    return {
        permanent: b.permanent,
        temporary: b.temporary,
        total: b.total,
        period: b.period,
        source: b.source,
        capturedAt: new Date()
    }
}

/* ===================== counting ===================== */

export type JobsCount = {
    active: number
    permanent: number
    temporary: number
    sustained: number
    created: number
}

export const splitCount = (active: number, baseline: number) => ({
    sustained: Math.min(baseline, active),
    created: Math.max(0, active - baseline)
})

/** One SME's jobs on a date. `jobs` must belong to that SME. */
export const countJobsOn = (jobs: Job[], baseline: number, date: Dayjs): JobsCount => {
    const active = activeJobsOn(jobs, date)
    const permanent = active.filter(j => j.contractType === 'permanent').length
    return {
        active: active.length,
        permanent,
        temporary: active.length - permanent,
        ...splitCount(active.length, baseline)
    }
}

export type JobsPeriodCount = JobsCount & {
    /** Net new jobs created during the period. */
    createdInPeriod: number
    /** Jobs that started during the period (hires, before netting against the baseline). */
    started: number
    /** Jobs that ended during the period. */
    lost: number
}

/** One SME over [start, end]: the position at `end` plus what changed during the period. */
export const countJobsInPeriod = (jobs: Job[], baseline: number, start: Dayjs, end: Dayjs): JobsPeriodCount => {
    const atEnd = countJobsOn(jobs, baseline, end)
    const before = countJobsOn(jobs, baseline, start.subtract(1, 'day'))
    const s = start.startOf('day')
    const e = end.endOf('day')
    const within = (d: Dayjs | null) => !!d && !d.isBefore(s) && !d.isAfter(e)
    return {
        ...atEnd,
        createdInPeriod: Math.max(0, atEnd.created - before.created),
        started: jobs.filter(j => within(j.start)).length,
        lost: jobs.filter(j => within(j.end)).length
    }
}

/** Groups jobs by applicationId. */
export const jobsByApplication = (jobs: Job[]) => {
    const map = new Map<string, Job[]>()
    jobs.forEach(job => {
        const list = map.get(job.applicationId)
        if (list) list.push(job)
        else map.set(job.applicationId, [job])
    })
    return map
}

/**
 * Programme totals: the sum of each SME's own count, so one SME's growth never
 * offsets another's losses. `baselines` maps applicationId → starting headcount.
 */
export const countProgrammeInPeriod = (
    jobs: Job[],
    baselines: Map<string, number>,
    start: Dayjs,
    end: Dayjs,
    applicationIds?: Iterable<string>
): JobsPeriodCount => {
    const byApp = jobsByApplication(jobs)
    const ids = new Set<string>(applicationIds ? Array.from(applicationIds) : byApp.keys())
    const sum: JobsPeriodCount = { active: 0, permanent: 0, temporary: 0, sustained: 0, created: 0, createdInPeriod: 0, started: 0, lost: 0 }
    ids.forEach(id => {
        const c = countJobsInPeriod(byApp.get(id) || [], baselines.get(id) || 0, start, end)
        ;(Object.keys(sum) as (keyof JobsPeriodCount)[]).forEach(k => { sum[k] += c[k] })
    })
    return sum
}

/** Temporary jobs active on `date` whose contract runs out within `days` after it. */
export const expiringWithin = (jobs: Job[], date: Dayjs, days = 30) =>
    jobs.filter(job => {
        if (!job.contractExpiry || job.endedAt || !isJobActiveOn(job, date)) return false
        const diff = job.contractExpiry.diff(date.startOf('day'), 'day')
        return diff >= 0 && diff <= days
    })

/** Newest document first, by upload month then save time. */
export const compareContractsNewestFirst = sortNewestFirst
