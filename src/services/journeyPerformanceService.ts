import dayjs, { type Dayjs } from 'dayjs'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { getDepartmentRole, loadDepartmentRoles } from '@/services/departmentRoles'
import { loadSyntheticFinanceAccounts } from '@/services/syntheticFinance'
import { loadProgramFinanceSeries } from '@/components/dashboards/projectadmin/ProjectAdminProgramPulse'
import { activeJobsOn, contractMonth, groupJobs, type Job, type JobContractRecord } from '@/lib/jobs'
import { asOfMonthEnd, loadJobContracts } from '@/lib/jobsData'

/**
 * Department-specific chapters for the milestone journey: revenue the SMEs
 * reported (Financial Compliance) and jobs they reported (HSE), month by month.
 * A department only gets the chapter for its own role.
 *
 * Each month answers the same three questions: how many SMEs reported (out of
 * how many expected), who moved most, and who did not report.
 */

export type JourneySmeRef = { id: string; name: string }

export type JourneyMover = JourneySmeRef & {
    /** Revenue: percentage change. Jobs: change in the number of jobs. */
    change: number
    /** The figure for the month, e.g. revenue in rand or jobs in place. */
    value: number
}

export type JourneyRevenueMonth = {
    /** SMEs with a revenue figure for the month. */
    reported: number
    /** SMEs in the programme's finance population. */
    expected: number
    total: number
    /** Total for the month before, across all SMEs; null when nothing was reported then. */
    previousTotal: number | null
    changePercent: number | null
    /** Up to five biggest rises and falls in percentage terms. */
    risers: JourneyMover[]
    fallers: JourneyMover[]
    /** SMEs with no revenue figure for the month. */
    missing: JourneySmeRef[]
}

export type JourneyJobsMonth = {
    /** Jobs in place at month end (today for the current month), each job counted once. */
    total: number
    permanent: number
    temporary: number
    /** Jobs in place that started this month. */
    added: number
    /** SMEs that uploaded job contracts this month. */
    reported: number
    /** SMEs that had reported jobs at any point up to this month. */
    expected: number
    /** Up to five biggest gains and losses in jobs on the month before. */
    risers: JourneyMover[]
    fallers: JourneyMover[]
    /** SMEs that had reported jobs before but uploaded nothing this month. */
    missing: JourneySmeRef[]
}

export type JourneyPerformance = {
    revenue?: Record<string, JourneyRevenueMonth>
    jobs?: Record<string, JourneyJobsMonth>
}

const MOVER_LIMIT = 5
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "2026-03" for rows keyed "2026-03", "2026-3" or labelled "Mar 2026". */
const monthKeyOf = (row: { month?: string; label?: string; monthLabel?: string }) => {
    const raw = String(row.month || '').trim()
    const iso = raw.match(/^(\d{4})-(\d{1,2})/)
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`
    const text = String(row.monthLabel || row.label || row.month || '').trim().toLowerCase()
    const named = text.match(/^([a-z]{3})[a-z]*\s+(\d{4})$/)
    if (named && MONTH_NAMES.includes(named[1])) {
        return `${named[2]}-${String(MONTH_NAMES.indexOf(named[1]) + 1).padStart(2, '0')}`
    }
    const parsed = dayjs(text)
    return parsed.isValid() ? parsed.format('YYYY-MM') : null
}

const percent = (current: number, previous: number | null | undefined) =>
    previous && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null

const previousKey = (key: string) => dayjs(`${key}-01`).subtract(1, 'month').format('YYYY-MM')

const byName = (a: JourneySmeRef, b: JourneySmeRef) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** The biggest rises and falls, largest first. */
const splitMovers = (movers: JourneyMover[]) => ({
    risers: movers.filter(m => m.change > 0).sort((a, b) => b.change - a.change).slice(0, MOVER_LIMIT),
    fallers: movers.filter(m => m.change < 0).sort((a, b) => a.change - b.change).slice(0, MOVER_LIMIT)
})

type CompanySeries = { id: string; name: string; months: Map<string, number> }

async function loadRevenue(programId: string | null | undefined): Promise<Record<string, JourneyRevenueMonth>> {
    const companies: CompanySeries[] = []

    try {
        const { series } = await loadProgramFinanceSeries(programId)
        series.forEach((company, index) => {
            const months = new Map<string, number>()
            company.months.forEach(row => {
                const key = monthKeyOf(row)
                if (key) months.set(key, (months.get(key) || 0) + Number(row.revenue || 0))
            })
            companies.push({ id: `qx-${index}`, name: company.name || 'SME', months })
        })
    } catch (error) {
        // Qx unavailable: the demo accounts (test project) can still show.
        console.warn('[journeyPerformance] finance system revenue unavailable', error)
    }

    const demo = await loadSyntheticFinanceAccounts(programId)
    demo.forEach(account => {
        const months = new Map<string, number>()
        account.months.forEach(row => {
            const key = monthKeyOf(row)
            if (key) months.set(key, Number(row.revenue || 0))
        })
        companies.push({ id: account.id, name: account.name, months })
    })

    const keys = new Set<string>()
    companies.forEach(company => company.months.forEach((_, key) => keys.add(key)))

    const totalFor = (key: string) => {
        let total = 0
        let any = false
        companies.forEach(company => {
            if (company.months.has(key)) {
                any = true
                total += company.months.get(key) || 0
            }
        })
        return any ? total : null
    }

    const result: Record<string, JourneyRevenueMonth> = {}
    keys.forEach(key => {
        const prior = previousKey(key)
        const reporting = companies.filter(company => company.months.has(key))
        const total = reporting.reduce((sum, company) => sum + (company.months.get(key) || 0), 0)
        const previousTotal = totalFor(prior)

        const movers: JourneyMover[] = []
        reporting.forEach(company => {
            const value = company.months.get(key) || 0
            const change = percent(value, company.months.get(prior))
            if (change !== null) movers.push({ id: company.id, name: company.name, change, value })
        })

        result[key] = {
            reported: reporting.length,
            expected: companies.length,
            total,
            previousTotal,
            changePercent: percent(total, previousTotal),
            ...splitMovers(movers),
            missing: companies
                .filter(company => !company.months.has(key))
                .map(company => ({ id: company.id, name: company.name }))
                .sort(byName)
        }
    })
    return result
}

async function namesForApplications(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>()
    const unique = Array.from(new Set(ids.filter(Boolean)))
    for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30)
        try {
            const snap = await getDocs(query(collection(db, 'applications'), where(documentId(), 'in', chunk)))
            snap.docs.forEach(d => {
                const data = d.data() as any
                const name = data.beneficiaryName || data.companyName || data.businessName || data.name
                if (name) names.set(d.id, String(name))
            })
        } catch (error) {
            console.warn('[journeyPerformance] SME names unavailable', error)
        }
    }
    return names
}

const smeIdOf = (item: JobContractRecord | Job) => item.applicationId || item.participantId || 'unknown'

async function loadJobs(
    programId: string | null | undefined,
    range: [Dayjs, Dayjs]
): Promise<Record<string, JourneyJobsMonth>> {
    const contracts = await loadJobContracts(programId)
    if (!contracts.length) return {}
    // One job per person per position, renewals and re-uploads included (src/lib/jobs.ts).
    const jobs = groupJobs(contracts)

    const names = await namesForApplications(contracts.map(contract => contract.applicationId))
    const nameOf = (id: string) => names.get(id) || 'SME'

    const activeIn = (month: Dayjs) => activeJobsOn(jobs, asOfMonthEnd(month))

    const jobsBySme = (month: Dayjs) => {
        const counts = new Map<string, number>()
        activeIn(month).forEach(job => {
            const id = smeIdOf(job)
            counts.set(id, (counts.get(id) || 0) + 1)
        })
        return counts
    }

    const result: Record<string, JourneyJobsMonth> = {}
    let month = range[0].startOf('month')
    const last = range[1].startOf('month')
    while (!month.isAfter(last)) {
        const effective = activeIn(month)
        // Reporting is about uploads: an SME reported when it uploaded a contract this month.
        const uploadedThisMonth = contracts.filter(contract => contractMonth(contract)?.isSame(month, 'month'))
        const reportedIds = new Set(uploadedThisMonth.map(smeIdOf))
        const expectedIds = new Set(
            contracts
                .filter(contract => {
                    const start = contractMonth(contract)
                    return start && !start.isAfter(month, 'month')
                })
                .map(smeIdOf)
        )

        const now = jobsBySme(month)
        const before = jobsBySme(month.subtract(1, 'month'))
        const movers: JourneyMover[] = []
        new Set([...now.keys(), ...before.keys()]).forEach(id => {
            const change = (now.get(id) || 0) - (before.get(id) || 0)
            if (change !== 0) movers.push({ id, name: nameOf(id), change, value: now.get(id) || 0 })
        })

        const permanent = effective.filter(job => job.contractType === 'permanent').length
        if (effective.length || reportedIds.size) {
            result[month.format('YYYY-MM')] = {
                total: effective.length,
                permanent,
                temporary: effective.length - permanent,
                added: effective.filter(job => job.start?.isSame(month, 'month')).length,
                reported: reportedIds.size,
                expected: expectedIds.size,
                ...splitMovers(movers),
                missing: Array.from(expectedIds)
                    .filter(id => !reportedIds.has(id))
                    .map(id => ({ id, name: nameOf(id) }))
                    .sort(byName)
            }
        }
        month = month.add(1, 'month')
    }
    return result
}

export async function loadJourneyPerformance({
    departmentIds,
    programId,
    range
}: {
    departmentIds: string[]
    programId?: string | null
    range: [Dayjs, Dayjs]
}): Promise<JourneyPerformance> {
    if (!departmentIds.length) return {}

    const { roles, departments } = await loadDepartmentRoles()
    const departmentRoles = new Set(
        departmentIds.map(id => getDepartmentRole(id, roles, departments)).filter(Boolean)
    )

    const [revenue, jobs] = await Promise.all([
        departmentRoles.has('financialCompliance')
            ? loadRevenue(programId).catch(error => {
                console.warn('[journeyPerformance] revenue chapter unavailable', error)
                return undefined
            })
            : Promise.resolve(undefined),
        departmentRoles.has('hse')
            ? loadJobs(programId, range).catch(error => {
                console.warn('[journeyPerformance] jobs chapter unavailable', error)
                return undefined
            })
            : Promise.resolve(undefined)
    ])

    return { revenue, jobs }
}
