import { collection, documentId, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { db } from '@/firebase'
import {
    groupJobs,
    jobsBaselineFor,
    type Job,
    type JobContractRecord,
    type JobsBaseline
} from '@/lib/jobs'

// Firestore loading and small period helpers shared by the screens that count
// jobs through src/lib/jobs.ts. The counting rules themselves live in jobs.ts.

const lower = (value: any) => String(value ?? '').trim().toLowerCase()

export const isAcceptedApplication = (application: any) =>
    lower(application?.applicationStatus ?? application?.status) === 'accepted'

const programConstraint = (programId?: string | null): QueryConstraint[] =>
    programId ? [where('programId', '==', programId)] : []

/** Every hseJobContracts document for a programme (all programmes when none). */
export async function loadJobContracts(programId?: string | null): Promise<JobContractRecord[]> {
    const snap = await getDocs(query(collection(db, 'hseJobContracts'), ...programConstraint(programId)))
    return snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as JobContractRecord[]
}

/** Participants by document id, read 30 at a time. Ids that can't be read are left out. */
export async function loadParticipantsById(ids: string[]): Promise<Map<string, any>> {
    const map = new Map<string, any>()
    const unique = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)))
    for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30)
        try {
            const snap = await getDocs(query(collection(db, 'participants'), where(documentId(), 'in', chunk)))
            snap.docs.forEach(item => map.set(item.id, { id: item.id, ...(item.data() as any) }))
        } catch (error) {
            console.warn('[jobs] participants unavailable for starting headcount', error)
        }
    }
    return map
}

/** Starting headcount per accepted application, keyed by applicationId. */
export const baselinesFor = (applications: any[], participants: Map<string, any>) => {
    const map = new Map<string, JobsBaseline>()
    applications.forEach(app => {
        if (!app?.id) return
        map.set(app.id, jobsBaselineFor(app, participants.get(String(app.participantId || '').trim()) || null))
    })
    return map
}

/** Accepted applications for a programme (all programmes when none) and each one's starting headcount. */
export async function loadJobsBaselines(programId?: string | null): Promise<{ applications: any[]; baselines: Map<string, JobsBaseline> }> {
    const snap = await getDocs(query(
        collection(db, 'applications'),
        ...programConstraint(programId),
        where('applicationStatus', 'in', ['accepted', 'Accepted'])
    ))
    const applications = snap.docs
        .map(item => ({ id: item.id, ...(item.data() as any) }))
        .filter(isAcceptedApplication)
    const participants = await loadParticipantsById(applications.map(app => app.participantId))
    return { applications, baselines: baselinesFor(applications, participants) }
}

/** Contracts grouped into jobs, plus the starting headcount of each accepted SME. */
export async function loadProgrammeJobs(programId?: string | null): Promise<{
    contracts: JobContractRecord[]
    jobs: Job[]
    applications: any[]
    baselines: Map<string, JobsBaseline>
}> {
    const [contracts, { applications, baselines }] = await Promise.all([
        loadJobContracts(programId),
        loadJobsBaselines(programId)
    ])
    return { contracts, jobs: groupJobs(contracts), applications, baselines }
}

export type BaselinePart = 'total' | 'permanent' | 'temporary'

/** applicationId → one part of the starting headcount, as countProgrammeInPeriod takes it. */
export const baselineNumbers = (baselines: Map<string, JobsBaseline>, part: BaselinePart = 'total') => {
    const map = new Map<string, number>()
    baselines.forEach((baseline, id) => map.set(id, baseline[part] || 0))
    return map
}

/** Jobs active at any point in [start, end]. */
export const activeDuring = (jobs: Job[], start: Dayjs, end: Dayjs) => {
    const s = start.startOf('day')
    const e = end.endOf('day')
    return jobs.filter(job => !!job.start && !job.start.isAfter(e) && (!job.end || !job.end.isBefore(s)))
}

/**
 * The day a period is counted on: its last day, or today while the period is
 * still running (so a contract running out later this month still counts).
 */
export const asOfPeriodEnd = (start: Dayjs, end: Dayjs, now: Dayjs = dayjs()) => {
    const today = now.endOf('day')
    return !start.isAfter(today) && end.isAfter(today) ? today : end.endOf('day')
}

/** asOfPeriodEnd for a calendar month. */
export const asOfMonthEnd = (month: Dayjs, now: Dayjs = dayjs()) =>
    asOfPeriodEnd(month.startOf('month'), month.endOf('month'), now)

/** The first day and the counting day of a run of reporting months (null when empty). */
export const periodOfMonths = (months: Dayjs[], now: Dayjs = dayjs()) => {
    if (!months.length) return null
    const start = months[0].startOf('month')
    return { start, asOf: asOfPeriodEnd(start, months[months.length - 1].endOf('month'), now) }
}

/** Jobs active at any point during a run of reporting months; each job counts once. */
export const activeInMonths = (jobs: Job[], months: Dayjs[]) => {
    const period = periodOfMonths(months)
    return period ? activeDuring(jobs, period.start, period.asOf) : []
}
