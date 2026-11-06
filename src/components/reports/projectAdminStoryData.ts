import dayjs, { type Dayjs } from 'dayjs'
import {
    collection,
    documentId,
    getDocs,
    query,
    where,
    type QueryConstraint
} from 'firebase/firestore'
import { db } from '@/firebase'
import { departmentNameOf, loadDepartmentRoles } from '@/services/departmentRoles'
import { getCanonicalInterventionStatus } from '@/routes/operations/reports/monitoring/interventionStatus'
import { resolveInquiryAudience, resolveInquiryChannel } from '@/utils/inquirySource'
import {
    getFullReportingMonths,
    getPreviousReportingMonths,
    getUniqueJobsForPeriod,
    hasPeriodRevenueData,
    loadProgramFinanceSeries,
    periodLabel,
    signedPercent,
    sumPeriodRevenue,
    type JobContract
} from '@/components/dashboards/projectadmin/ProjectAdminProgramPulse'

/*
  Everything the project admin report player tells, gathered in one pass. Each
  section is independent: one that fails or has no data is left out of the story
  instead of failing the whole thing.
*/

export type StoryParams = {
    programId?: string | null
    branchId?: string | null
    range: [Dayjs, Dayjs]
}

export type Count = { name: string; count: number }

export type ProjectAdminStory = {
    periodLabel: string
    sections: string[]
    smes?: {
        total: number
        months: { label: string; submitted: number; accepted: number }[]
        submittedInPeriod: number
        acceptedInPeriod: number
    }
    demographics?: {
        total: number
        gender: Count[]
        bee: Count[]
        sector: Count[]
        ward: Count[]
    }
    walkIns?: {
        total: number
        incubated: number
        nonIncubated: number
        topTypes: Count[]
    }
    interventions?: {
        total: number
        smesReached: number
        averagePerSme: number
        byDepartment: Count[]
    }
    appointments?: {
        sessions: number
        held: number
        byMethod: Count[]
        invited: number
        attended: number
        attendanceRate: number
        photos: string[]
    }
    performance?: {
        /** The period the figures are for; an earlier one when the requested period had none. */
        periodLabel: string
        isEarlierPeriod: boolean
        /** True when the finance service could not be reached, as opposed to nothing being reported. */
        revenueUnavailable: boolean
        jobs?: { total: number; permanent: number; temporary: number }
        revenue?: {
            current: number
            changePercent: number | null
            smesUp: number
            smesDown: number
        }
    }
    stories?: {
        title: string
        sme: string
        summary: string
        image?: string
    }[]
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const lower = (value: unknown) => clean(value).toLowerCase()

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value.toDate === 'function') return value.toDate()
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000)
    if (value instanceof Date) return value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const firstValue = (value: unknown): string => {
    const first = Array.isArray(value) ? value.find(item => clean(item)) : value
    return clean(first)
}

const chunk = <T,>(items: T[], size: number) => {
    const out: T[][] = []
    for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
    return out
}

const tally = (values: string[], fallback = 'Unspecified', top = 6): Count[] => {
    const counts = new Map<string, number>()
    values.forEach(value => {
        const key = clean(value) || fallback
        counts.set(key, (counts.get(key) || 0) + 1)
    })
    const sorted = Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    if (sorted.length <= top + 1) return sorted
    const rest = sorted.slice(top).reduce((total, item) => total + item.count, 0)
    return [...sorted.slice(0, top), { name: 'Other', count: rest }]
}

const normaliseGender = (value: unknown) => {
    const text = lower(value)
    if (text.startsWith('f')) return 'Female'
    if (text.startsWith('m')) return 'Male'
    return text ? clean(value) : 'Unspecified'
}

const beeLabel = (participant: any) => {
    const raw = clean(participant?.beeLevel ?? participant?.bbeeeLevel)
    if (!raw) return 'Unspecified'
    return /^\d+$/.test(raw) ? `Level ${raw}` : raw
}

const inRange = (date: Date | null, [start, end]: [Dayjs, Dayjs]) =>
    Boolean(date) && !dayjs(date).isBefore(start.startOf('day')) && !dayjs(date).isAfter(end.endOf('day'))

const programConstraint = (programId?: string | null): QueryConstraint[] =>
    programId ? [where('programId', '==', programId)] : []

const safely = async <T,>(label: string, run: () => Promise<T | undefined>): Promise<T | undefined> => {
    try {
        return await run()
    } catch (error) {
        console.warn(`[ProjectAdminStory] ${label} unavailable`, error)
        return undefined
    }
}

export async function buildProjectAdminStory({ programId, branchId, range }: StoryParams): Promise<ProjectAdminStory> {
    const story: ProjectAdminStory = {
        periodLabel: `${range[0].format('D MMM YYYY')} – ${range[1].format('D MMM YYYY')}`,
        sections: []
    }

    // ---- applications, SMEs and demographics ----
    const appRows = await safely('applications', async () => {
        const snap = await getDocs(query(
            collection(db, 'applications'),
            ...programConstraint(programId),
            ...(branchId ? [where('branchId', '==', branchId)] : [])
        ))
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as any[]
    })

    if (appRows) {
        const accepted = appRows.filter(app => lower(app.applicationStatus ?? app.status) === 'accepted')
        const participantIds = Array.from(new Set(accepted.map(app => clean(app.participantId)).filter(Boolean)))

        const monthStart = range[0].startOf('month')
        const monthCount = Math.min(range[1].startOf('month').diff(monthStart, 'month') + 1, 24)
        const firstMonth = range[1].startOf('month').subtract(monthCount - 1, 'month')
        const months = Array.from({ length: monthCount }, (_, index) => firstMonth.add(index, 'month'))
        const submittedBy = new Map<string, number>()
        const acceptedBy = new Map<string, number>()

        appRows.forEach(app => {
            const submitted = toDate(app.submittedAt ?? app.createdAt)
            if (submitted) {
                const key = dayjs(submitted).format('YYYY-MM')
                submittedBy.set(key, (submittedBy.get(key) || 0) + 1)
            }
        })
        accepted.forEach(app => {
            const decided = toDate(app.acceptedAt ?? app.decision?.decidedAt ?? app.submittedAt ?? app.createdAt)
            if (decided) {
                const key = dayjs(decided).format('YYYY-MM')
                acceptedBy.set(key, (acceptedBy.get(key) || 0) + 1)
            }
        })

        story.smes = {
            total: participantIds.length || accepted.length,
            months: months.map(month => ({
                label: month.format('MMM YY'),
                submitted: submittedBy.get(month.format('YYYY-MM')) || 0,
                accepted: acceptedBy.get(month.format('YYYY-MM')) || 0
            })),
            submittedInPeriod: appRows.filter(app => inRange(toDate(app.submittedAt ?? app.createdAt), range)).length,
            acceptedInPeriod: accepted.filter(app => inRange(toDate(app.acceptedAt ?? app.decision?.decidedAt ?? app.submittedAt), range)).length
        }
        story.sections.push('smes')

        if (participantIds.length) {
            const participants: any[] = []
            for (const ids of chunk(participantIds, 30)) {
                const snap = await getDocs(query(collection(db, 'participants'), where(documentId(), 'in', ids)))
                snap.forEach(item => participants.push({ id: item.id, ...(item.data() as any) }))
            }
            story.demographics = {
                total: participants.length,
                gender: tally(participants.map(item => normaliseGender(item.gender)), 'Unspecified'),
                bee: tally(participants.map(beeLabel), 'Unspecified'),
                sector: tally(participants.map(item => firstValue(item.sector)), 'Unspecified'),
                ward: tally(participants.map(item => firstValue(item.ward) || firstValue(item.hub)), 'Unspecified')
            }
            story.sections.push('demographics')
        }
    }

    // ---- walk-ins ----
    const inquiries = await safely('walk-ins', async () => {
        const snap = await getDocs(query(
            collection(db, 'inquiries'),
            ...(branchId ? [where('branchId', '==', branchId)] : [])
        ))
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as any[]
    })
    if (inquiries) {
        const walkIns = inquiries.filter(item =>
            resolveInquiryChannel(item.source) === 'Walk-in' &&
            (!programId || !clean(item.programId) || clean(item.programId) === programId) &&
            inRange(toDate(item.submittedAt ?? item.createdAt), range)
        )
        const incubated = walkIns.filter(item => resolveInquiryAudience(item) === 'Incubatee').length
        story.walkIns = {
            total: walkIns.length,
            incubated,
            nonIncubated: walkIns.length - incubated,
            topTypes: tally(walkIns.map(item => clean(item.inquiryDetails?.inquiryType)), 'Other', 4)
        }
        story.sections.push('walkIns')
    }

    // ---- interventions completed in the period ----
    const assigned = await safely('interventions', async () => {
        const snap = await getDocs(query(collection(db, 'assignedInterventions'), ...programConstraint(programId)))
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as any[]
    })
    if (assigned) {
        const completed = assigned.filter(row =>
            getCanonicalInterventionStatus(row) === 'completed' &&
            inRange(toDate(row.completedAt ?? row.assigneeCompletedAt ?? row.updatedAt), range)
        )
        const smeKeys = new Set(completed.map(row => clean(row.participantId || row.beneficiaryId || row.beneficiaryName)).filter(Boolean))
        const { departments } = await loadDepartmentRoles()
        story.interventions = {
            total: completed.length,
            smesReached: smeKeys.size,
            averagePerSme: smeKeys.size ? Math.round((completed.length / smeKeys.size) * 10) / 10 : 0,
            byDepartment: tally(
                completed.map(row => departmentNameOf(row.departmentId, departments, '')),
                'Unassigned',
                7
            )
        }
        story.sections.push('interventions')
    }

    // ---- appointments ----
    const sessions = await safely('appointments', async () => {
        const snap = await getDocs(query(collection(db, 'appointmentSessions'), ...programConstraint(programId)))
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as any[]
    })
    if (sessions) {
        const inPeriod = sessions.filter(item => inRange(toDate(item.startAt), range) && lower(item.status) !== 'cancelled')
        const held = inPeriod.filter(item => lower(item.status) === 'completed' || item.coverage?.held === true)
        // Attendance only counts sessions that took place (as on the report's Engagement tab).
        const invited = held.reduce((total, item) => total + Number(item.attendanceSummary?.invitedCount || 0), 0)
        const attended = held.reduce((total, item) => total + Number(item.attendanceSummary?.attendedCount || 0), 0)
        const methodLabel: Record<string, string> = { in_person: 'In person', virtual: 'Online', telephonically: 'Phone call' }
        story.appointments = {
            sessions: inPeriod.length,
            held: held.length,
            byMethod: tally(inPeriod.map(item => methodLabel[lower(item.deliveryMethod)] || 'Other'), 'Other', 5),
            invited,
            attended,
            attendanceRate: invited ? Math.round((attended / invited) * 100) : 0,
            photos: inPeriod.flatMap(item => (Array.isArray(item.coverage?.photos) ? item.coverage.photos : []))
                .filter((url: unknown) => typeof url === 'string' && url)
                .slice(0, 6)
        }
        story.sections.push('appointments')
    }

    // ---- SME performance: jobs and revenue ----
    // Jobs and revenue are reported monthly and trail the calendar, so the month in progress
    // (or a range with no full month) is usually empty. When the asked-for period has nothing,
    // fall back to the most recent earlier period that does, and say which one is shown.
    const requested = getFullReportingMonths(range)
    const baseMonths = requested.length ? requested : [dayjs().subtract(1, 'month').startOf('month')]
    if (requested.length) story.periodLabel = periodLabel(requested)

    const contracts = await safely('jobs', async () => {
        const snap = await getDocs(query(collection(db, 'hseJobContracts'), ...programConstraint(programId)))
        return snap.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as JobContract[]
    })
    const finance = await safely('revenue', async () => (await loadProgramFinanceSeries(programId)).series)

    const measure = (months: Dayjs[]) => {
        const previous = getPreviousReportingMonths(months)
        const jobs = contracts ? getUniqueJobsForPeriod(contracts, months) : undefined
        let revenue: NonNullable<NonNullable<ProjectAdminStory['performance']>['revenue']> | undefined
        if (finance) {
            let current = 0
            let before = 0
            let hasCurrent = false
            let hasBefore = false
            let up = 0
            let down = 0
            finance.forEach(company => {
                const hasNow = hasPeriodRevenueData(company.months, months)
                const hasPrior = hasPeriodRevenueData(company.months, previous)
                const now = sumPeriodRevenue(company.months, months)
                const prior = sumPeriodRevenue(company.months, previous)
                if (hasNow) { hasCurrent = true; current += now }
                if (hasPrior) { hasBefore = true; before += prior }
                if (hasNow && hasPrior) {
                    if (now > prior) up += 1
                    else if (now < prior) down += 1
                }
            })
            if (hasCurrent) {
                revenue = {
                    current,
                    changePercent: hasBefore ? signedPercent(current, before) : null,
                    smesUp: up,
                    smesDown: down
                }
            }
        }
        return { jobs, revenue }
    }

    if (contracts || finance) {
        let window = baseMonths
        let found = measure(window)
        for (let step = 0; step < 6 && !found.revenue && !(found.jobs && found.jobs.length); step += 1) {
            window = getPreviousReportingMonths(window)
            found = measure(window)
        }
        const usable = Boolean(found.revenue || (found.jobs && found.jobs.length))
        if (!usable) {
            window = baseMonths
            found = measure(window)
        }

        story.performance = {
            periodLabel: periodLabel(window),
            isEarlierPeriod: window[0].valueOf() !== baseMonths[0].valueOf(),
            jobs: found.jobs
                ? {
                    total: found.jobs.length,
                    permanent: found.jobs.filter(job => job.contractType === 'permanent').length,
                    temporary: found.jobs.filter(job => job.contractType === 'temporal').length
                }
                : undefined,
            revenue: found.revenue,
            revenueUnavailable: !finance
        }
        story.sections.push('performance')
    }

    // ---- success stories ----
    const storyRows = await safely('success stories', async () => {
        const [stories, feedback] = await Promise.all([
            getDocs(collection(db, 'successStories')),
            getDocs(query(collection(db, 'smeFeedback'), where('type', '==', 'success_story')))
        ])
        return [
            ...stories.docs.map(item => item.data() as any),
            ...feedback.docs.map(item => item.data() as any)
        ]
    })
    if (storyRows) {
        const picked = storyRows
            .filter(row =>
                (!programId || !clean(row.programId) || clean(row.programId) === programId) &&
                inRange(toDate(row.createdAt), range))
            .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
            .slice(0, 3)
            .map(row => ({
                title: clean(row.title) || clean(row.interventionTitle) || 'A story worth sharing',
                sme: clean(row.smeName) || clean(row.eventTitle),
                summary: clean(row.achievement || row.summary || row.message || row.background),
                image: clean(row.coverImageUrl) || undefined
            }))
            .filter(item => item.summary)
        if (picked.length) {
            story.stories = picked
            story.sections.push('stories')
        }
    }

    return story
}
