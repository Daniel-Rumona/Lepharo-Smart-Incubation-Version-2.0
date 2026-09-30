import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Alert,
    Col,
    Row,
    Skeleton,
    Space,
    Tag,
    Typography
} from 'antd'
import {
    DollarOutlined,
    FallOutlined,
    MinusOutlined,
    RiseOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import axios from 'axios'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs, { Dayjs } from 'dayjs'

import { db } from '@/firebase'
import { MotionCard, useMetricPalette } from '@/components/dashboards/metrics/Header'

const { Text } = Typography

const API_BASE_URL = 'https://quantnow-sa1e.onrender.com'
const QX_FINANCE_EMAIL =
    import.meta.env.VITE_QX_FINANCE_EMAIL ||
    import.meta.env.VITE_FINANCE_EMAIL ||
    ''
const QX_FINANCE_PASSWORD =
    import.meta.env.VITE_QX_FINANCE_PASSWORD ||
    import.meta.env.VITE_FINANCE_PASSWORD ||
    ''
const FINANCE_SESSION_KEY = 'qx_finance_session'

export type DateRangeValue = [Dayjs | null, Dayjs | null] | null

type Props = {
    programId?: string | null
    dateRange?: DateRangeValue
}

type FirestoreParticipant = {
    id: string
    beneficiaryName?: string
    participantName?: string
    companyName?: string
    businessName?: string
    email?: string
}

type FirestoreApplication = {
    id: string
    email?: string
    applicantEmail?: string
    participantId?: string
    beneficiaryName?: string
    applicationStatus?: string
    decision?: {
        status?: string
    }
    programId?: string
}

export type MonthlyRevenueRow = {
    month: string
    label: string
    revenue: number
}

export type FinanceCompanySeries = {
    months: MonthlyRevenueRow[]
}


export type JobContract = {
    id: string
    applicationId: string
    participantId?: string
    programId?: string
    employeeName: string
    position: string
    contractType: 'permanent' | 'temporal'
    contractEndDate?: any
    uploadMonth?: string
    uploadMonthDate?: any
    createdAt?: any
    updatedAt?: any
}

export const moneyCompact = (value: number) =>
    `R ${Intl.NumberFormat('en-ZA', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(Number(value || 0))}`

export const signedPercent = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0
    return Number((((current - previous) / previous) * 100).toFixed(1))
}

export const formatSignedPercent = (value: number) =>
    `${value > 0 ? '+' : ''}${value}%`

const normaliseMonthlyFinance = (rows: any[]): MonthlyRevenueRow[] => {
    if (!Array.isArray(rows)) return []

    return rows.map(row => ({
        month: String(row.month || row.monthLabel || row.month_label || ''),
        label: String(row.monthLabel || row.month_label || row.month || ''),
        revenue: Number(row.revenue || 0)
    }))
}

const parseReportingMonth = (row: Pick<MonthlyRevenueRow, 'month' | 'label'>) => {
    const raw = String(row.month || '').trim()
    const label = String(row.label || '').trim()

    const candidates = [
        /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw,
        label
    ]

    for (const candidate of candidates) {
        if (!candidate) continue
        const parsed = dayjs(candidate)
        if (parsed.isValid()) return parsed.startOf('month')
    }

    return null
}

const monthKey = (value: Dayjs) => value.format('YYYY-MM')

export const getFullReportingMonths = (range?: DateRangeValue) => {
    const [rawStart, rawEnd] = range || []
    if (!rawStart || !rawEnd) return []

    const start = rawStart.startOf('day')
    const end = rawEnd.endOf('day')

    const months: Dayjs[] = []
    let cursor = start.startOf('month')
    const finalMonth = end.startOf('month')

    while (
        cursor.isBefore(finalMonth, 'month') ||
        cursor.isSame(finalMonth, 'month')
    ) {
        const fullMonthInsideRange =
            !cursor.startOf('month').isBefore(start) &&
            !cursor.endOf('month').isAfter(end)

        if (fullMonthInsideRange) months.push(cursor.startOf('month'))
        cursor = cursor.add(1, 'month')
    }

    return months
}

export const getPreviousReportingMonths = (months: Dayjs[]) => {
    if (!months.length) return []

    const count = months.length
    const first = months[0]

    return Array.from({ length: count }, (_, index) =>
        first.subtract(count - index, 'month').startOf('month')
    )
}

const isCalendarQuarter = (months: Dayjs[]) => {
    if (months.length !== 3) return false

    const expectedStartMonths = [0, 3, 6, 9]
    const first = months[0]

    if (!expectedStartMonths.includes(first.month())) return false

    return months.every((month, index) =>
        month.isSame(first.add(index, 'month'), 'month')
    )
}

export const periodLabel = (months: Dayjs[]) => {
    if (!months.length) return 'No monthly period'

    if (months.length === 1) {
        return months[0].format('MMM YYYY')
    }

    if (isCalendarQuarter(months)) {
        return `Q${Math.floor(months[0].month() / 3) + 1} ${months[0].year()}`
    }

    const first = months[0]
    const last = months[months.length - 1]

    if (first.year() === last.year()) {
        return `${first.format('MMM')}–${last.format('MMM YYYY')}`
    }

    return `${first.format('MMM YYYY')}–${last.format('MMM YYYY')}`
}

const periodMonthsLabel = (months: Dayjs[]) => {
    if (!months.length) return ''

    return months
        .map(month => month.format('MMM'))
        .join(' · ')
}

export const sumPeriodRevenue = (
    rows: MonthlyRevenueRow[],
    months: Dayjs[]
) => {
    const keys = new Set(months.map(monthKey))

    return rows.reduce((sum, row) => {
        const parsed = parseReportingMonth(row)
        if (!parsed || !keys.has(monthKey(parsed))) return sum
        return sum + Number(row.revenue || 0)
    }, 0)
}

export const hasPeriodRevenueData = (
    rows: MonthlyRevenueRow[],
    months: Dayjs[]
) => {
    const keys = new Set(months.map(monthKey))

    return rows.some(row => {
        const parsed = parseReportingMonth(row)
        return Boolean(parsed && keys.has(monthKey(parsed)))
    })
}

const getCompanyName = (company: any) =>
    String(company.name || company.company || company.companyName || 'Unknown')

const getCompanyEmail = (company: any) =>
    String(company.email || '')

const normalizeEmail = (value?: string | null) =>
    String(value || '')
        .trim()
        .toLowerCase()

// Placeholder and internal accounts are never part of a programme population.
// Kept in sync with the operations finance page.
const isExcludedScopedCompanyEmail = (value?: string | null) => {
    const email = normalizeEmail(value)

    if (!email) return false

    return (
        email.endsWith('@example.com') ||
        email.endsWith('@lepharo.co.za') ||
        email.endsWith('@quantilytix.co.za') ||
        email === 'lepharo@gmail.com'
    )
}

const getApplicationEmail = (application: FirestoreApplication) =>
    normalizeEmail(application.email || application.applicantEmail)

const isAcceptedApplication = (application: FirestoreApplication) => {
    const status = String(
        application.applicationStatus ||
        application.decision?.status ||
        ''
    )
        .trim()
        .toLowerCase()

    return status === 'accepted'
}

const findMatchingParticipant = (
    client: { name?: string; email?: string },
    participants: FirestoreParticipant[]
) => {
    const email = normalizeEmail(client.email)
    const emailMatches = email
        ? participants.filter(
            participant => normalizeEmail(participant.email) === email
        )
        : []

    if (emailMatches.length > 0) {
        return emailMatches.length === 1 ? emailMatches[0] : null
    }

    const name = String(client.name || '').trim().toLowerCase()
    if (!name) return null

    const nameMatches = participants.filter(
        participant =>
            String(participant.beneficiaryName || '').trim().toLowerCase() ===
            name
    )

    // A shared name must not link an account to an arbitrary participant.
    return nameMatches.length === 1 ? nameMatches[0] : null
}

// Programme membership comes from accepted applications, exactly as the
// operations finance page resolves it. participants.programId is never used:
// most finance accounts do not carry it, and reading it here dropped SMEs
// that the finance page reports on.
const isCompanyOutsideProgram = (
    company: any,
    programId: string | null | undefined,
    participants: FirestoreParticipant[],
    acceptedApplications: FirestoreApplication[]
) => {
    if (!programId) return false

    const identity = {
        name: getCompanyName(company),
        email: getCompanyEmail(company)
    }

    const companyEmail = normalizeEmail(identity.email)
    const matchedParticipant = findMatchingParticipant(identity, participants)
    const participantEmail = normalizeEmail(matchedParticipant?.email)

    const directApplications = companyEmail
        ? acceptedApplications.filter(
            application => getApplicationEmail(application) === companyEmail
        )
        : []

    const matchingApplications = directApplications.length > 0
        ? directApplications
        : matchedParticipant
            ? acceptedApplications.filter(
                application =>
                    application.participantId === matchedParticipant.id ||
                    (!!participantEmail &&
                        getApplicationEmail(application) === participantEmail)
            )
            : []

    const applicationProgramIds = new Set(
        matchingApplications
            .map(application => String(application.programId || '').trim())
            .filter(Boolean)
    )

    // Only accounts with an accepted application in this programme belong to
    // it. Unassigned or unmatched accounts used to be kept "just in case",
    // which leaked their revenue into every programme.
    return !applicationProgramIds.has(programId)
}


const safeLower = (value: any) =>
    String(value || '').trim().toLowerCase()

export const toDayjs = (value: any): Dayjs | null => {
    if (!value) return null
    if (dayjs.isDayjs(value)) return value

    if (value?.toDate) {
        const parsed = dayjs(value.toDate())
        return parsed.isValid() ? parsed : null
    }

    if (value?.seconds) {
        const parsed = dayjs(value.seconds * 1000)
        return parsed.isValid() ? parsed : null
    }

    const parsed = dayjs(value)
    return parsed.isValid() ? parsed : null
}

export const buildEmployeeKey = (contract: Partial<JobContract>) =>
    [
        contract.applicationId || '',
        safeLower(contract.employeeName),
        safeLower(contract.position)
    ].join('::')

export const getContractMonthStart = (contract: Partial<JobContract>) =>
(
    toDayjs(contract.uploadMonthDate)?.startOf('month') ||
    (contract.uploadMonth
        ? dayjs(`${contract.uploadMonth}-01`).startOf('month')
        : null) ||
    toDayjs(contract.createdAt)?.startOf('month') ||
    toDayjs(contract.updatedAt)?.startOf('month') ||
    null
)

const getContractEffectiveTime = (contract: Partial<JobContract>) =>
(
    getContractMonthStart(contract)?.valueOf() ||
    toDayjs(contract.updatedAt)?.valueOf() ||
    toDayjs(contract.createdAt)?.valueOf() ||
    0
)

const isContractActiveInMonth = (
    contract: JobContract,
    month: Dayjs
) => {
    const monthStart = month.startOf('month')
    const monthEnd = month.endOf('month')
    const uploadedMonth = getContractMonthStart(contract)

    if (!uploadedMonth) return false
    if (uploadedMonth.isAfter(monthEnd)) return false

    if (contract.contractType === 'permanent') return true

    const end = toDayjs(contract.contractEndDate)
    if (!end) return true

    return !end.endOf('day').isBefore(monthStart)
}

export const getEffectiveContractsForMonth = (
    contracts: JobContract[],
    month: Dayjs
) => {
    const map = new Map<string, JobContract>()
    const monthEnd = month.endOf('month')

    contracts.forEach(contract => {
        const employeeKey = buildEmployeeKey(contract)
        const uploadedMonth = getContractMonthStart(contract)

        if (!uploadedMonth || uploadedMonth.isAfter(monthEnd)) return
        if (!isContractActiveInMonth(contract, month)) return

        const current = map.get(employeeKey)

        if (!current) {
            map.set(employeeKey, contract)
            return
        }

        if (
            getContractEffectiveTime(contract) >=
            getContractEffectiveTime(current)
        ) {
            map.set(employeeKey, contract)
        }
    })

    return Array.from(map.values())
}

export const getUniqueJobsForPeriod = (
    contracts: JobContract[],
    months: Dayjs[]
) => {
    const unique = new Map<string, JobContract>()

    months.forEach(month => {
        getEffectiveContractsForMonth(contracts, month).forEach(contract => {
            const key = buildEmployeeKey(contract)
            const current = unique.get(key)

            // A job counts once across the whole reporting period.
            // If its contract was updated during the period, classify it
            // using the latest effective contract seen in that period.
            if (
                !current ||
                getContractEffectiveTime(contract) >=
                getContractEffectiveTime(current)
            ) {
                unique.set(key, contract)
            }
        })
    })

    return Array.from(unique.values())
}

const fetchMonthlyRevenue = async (email: string, months: number) => {
    const response = await axios.get(
        `${API_BASE_URL}/api/stats/public/revenue-monthly`,
        {
            params: { email, months }
        }
    )

    return normaliseMonthlyFinance(
        response.data?.months || response.data || []
    )
}

// A selected period plus its previous comparison period needs up to 24 months
// of history. The finance page only ever asks for 12, so fall back to that
// window rather than losing an SME entirely when the wider one is refused.
const fetchCompanyMonthlyRevenue = async (email: string) => {
    try {
        return await fetchMonthlyRevenue(email, 24)
    } catch (error) {
        console.warn(
            '[ProjectAdminProgramPulse] 24-month revenue failed, retrying with 12',
            error
        )

        return await fetchMonthlyRevenue(email, 12)
    }
}

const getFinanceToken = async () => {
    if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(FINANCE_SESSION_KEY)

        if (raw) {
            try {
                const stored = JSON.parse(raw)

                if (
                    stored?.token &&
                    (!stored.expiresAt || stored.expiresAt > Date.now())
                ) {
                    return stored.token as string
                }
            } catch {
                window.localStorage.removeItem(FINANCE_SESSION_KEY)
            }
        }

        const legacyToken = window.sessionStorage.getItem('qx_token')
        if (legacyToken) return legacyToken
    }

    if (!QX_FINANCE_EMAIL || !QX_FINANCE_PASSWORD) {
        throw new Error('Finance credentials are not configured.')
    }

    const response = await axios.post(`${API_BASE_URL}/login`, {
        email: QX_FINANCE_EMAIL,
        password: QX_FINANCE_PASSWORD
    })

    const token = response.data?.token

    if (!token) {
        throw new Error('Finance API did not return an access token.')
    }

    if (typeof window !== 'undefined') {
        window.localStorage.setItem(
            FINANCE_SESSION_KEY,
            JSON.stringify({
                token,
                user: response.data?.user,
                email: response.data?.user?.email,
                savedAt: Date.now(),
                expiresAt: Date.now() + 8 * 60 * 60 * 1000
            })
        )
    }

    return token as string
}

export const loadProgramFinanceSeries = async (
    programId: string | null | undefined
) => {
    const token = await getFinanceToken()

    const [participantsSnap, applicationsSnap, membershipsResponse] =
        await Promise.all([
            getDocs(collection(db, 'participants')),
            getDocs(collection(db, 'applications')),
            axios.get(`${API_BASE_URL}/admin/all-memberships`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            })
        ])

    const participants = participantsSnap.docs.map(item => ({
        id: item.id,
        ...item.data()
    }) as FirestoreParticipant)

    const acceptedApplications = applicationsSnap.docs
        .map(item => ({
            id: item.id,
            ...item.data()
        }) as FirestoreApplication)
        .filter(isAcceptedApplication)

    const companies = Array.isArray(
        membershipsResponse.data?.companies
    )
        ? membershipsResponse.data.companies
        : []

    const scopedCompanies = companies.filter((company: any) => {
        if (isExcludedScopedCompanyEmail(getCompanyEmail(company))) {
            return false
        }

        return !isCompanyOutsideProgram(
            company,
            programId,
            participants,
            acceptedApplications
        )
    })

    const results = await Promise.allSettled(
        scopedCompanies.map(async (company: any) => {
            const email = getCompanyEmail(company)

            if (!email) {
                return {
                    months: [] as MonthlyRevenueRow[]
                }
            }

            const months = await fetchCompanyMonthlyRevenue(email)

            return { months }
        })
    )

    const failed = results.filter(
        result => result.status === 'rejected'
    )

    failed.forEach(result => {
        console.error(
            '[ProjectAdminProgramPulse] monthly revenue failed',
            (result as PromiseRejectedResult).reason
        )
    })

    return {
        series: results
            .filter(
                (result): result is PromiseFulfilledResult<FinanceCompanySeries> =>
                    result.status === 'fulfilled'
            )
            .map(result => result.value),
        failed: failed.length,
        total: results.length
    }
}

const ProjectAdminProgramPulse: React.FC<Props> = ({
    programId,
    dateRange
}) => {
    const palette = useMetricPalette()
    const { isDark } = palette
    const pulse = {
        panel: isDark ? 'rgba(255, 255, 255, 0.03)' : '#fbfdff',
        panelBorder: palette.border,
        inner: palette.surface,
        innerBorder: isDark ? 'rgba(255, 255, 255, 0.10)' : '#edf2f7',
        divider: isDark ? 'rgba(255, 255, 255, 0.10)' : '#edf2f7',
        jobsBorder: palette.filterBarBorder,
        track: isDark ? 'rgba(255, 255, 255, 0.10)' : '#f0f0f0',
        emptyBg: palette.filterBarBg,
        emptyBorder: palette.chipBorder,
        axisLine: isDark ? 'rgba(255, 255, 255, 0.18)' : '#e5e7eb',
        axisLabel: isDark ? 'rgba(255, 255, 255, 0.62)' : '#6b7280',
        axisLabelSoft: isDark ? 'rgba(255, 255, 255, 0.45)' : '#9ca3af',
        grid: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f3f4f6',
        previousBar: isDark ? '#5b6675' : '#cbd5e1',
        currentBar: isDark ? '#4096ff' : '#1677ff'
    }

    const reportingMonths = useMemo(
        () => getFullReportingMonths(dateRange),
        [dateRange]
    )

    const previousReportingMonths = useMemo(
        () => getPreviousReportingMonths(reportingMonths),
        [reportingMonths]
    )

    const hasMonthlyReportingPeriod = reportingMonths.length > 0

    const selectedPeriodLabel = useMemo(
        () => periodLabel(reportingMonths),
        [reportingMonths]
    )

    const previousPeriodLabel = useMemo(
        () => periodLabel(previousReportingMonths),
        [previousReportingMonths]
    )

    const selectedEndMonth =
        reportingMonths[reportingMonths.length - 1] || null

    const previousEndMonth =
        previousReportingMonths[previousReportingMonths.length - 1] || null

    const [jobsLoading, setJobsLoading] = useState(true)
    const [jobsError, setJobsError] = useState('')
    const [jobContracts, setJobContracts] = useState<JobContract[]>([])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            setJobsLoading(true)
            setJobsError('')

            try {
                const jobsQuery = programId
                    ? query(
                        collection(db, 'hseJobContracts'),
                        where('programId', '==', programId)
                    )
                    : query(collection(db, 'hseJobContracts'))

                const snap = await getDocs(jobsQuery)

                if (cancelled) return

                setJobContracts(
                    snap.docs.map(docSnap => ({
                        id: docSnap.id,
                        ...(docSnap.data() as any)
                    })) as JobContract[]
                )
            } catch (error) {
                console.error(
                    '[ProjectAdminProgramPulse] jobs summary failed',
                    error
                )

                if (!cancelled) {
                    setJobContracts([])
                    setJobsError(
                        'Jobs reporting is temporarily unavailable.'
                    )
                }
            } finally {
                if (!cancelled) {
                    setJobsLoading(false)
                }
            }
        }

        void run()

        return () => {
            cancelled = true
        }
    }, [programId])

    const selectedPeriodJobs = useMemo(
        () =>
            hasMonthlyReportingPeriod
                ? getUniqueJobsForPeriod(jobContracts, reportingMonths)
                : [],
        [
            jobContracts,
            hasMonthlyReportingPeriod,
            reportingMonths
        ]
    )

    const previousPeriodJobs = useMemo(
        () =>
            previousReportingMonths.length
                ? getUniqueJobsForPeriod(
                    jobContracts,
                    previousReportingMonths
                )
                : [],
        [jobContracts, previousReportingMonths]
    )

    const periodEndJobs = useMemo(
        () =>
            selectedEndMonth
                ? getEffectiveContractsForMonth(
                    jobContracts,
                    selectedEndMonth
                )
                : [],
        [jobContracts, selectedEndMonth?.format('YYYY-MM')]
    )

    const previousPeriodEndJobs = useMemo(
        () =>
            previousEndMonth
                ? getEffectiveContractsForMonth(
                    jobContracts,
                    previousEndMonth
                )
                : [],
        [jobContracts, previousEndMonth?.format('YYYY-MM')]
    )

    const jobs = useMemo(() => {
        const permanentJobs = selectedPeriodJobs.filter(
            contract => contract.contractType === 'permanent'
        ).length

        const temporaryJobs = selectedPeriodJobs.filter(
            contract => contract.contractType === 'temporal'
        ).length

        return {
            totalJobs: selectedPeriodJobs.length,
            permanentJobs,
            temporaryJobs,
            periodEndJobs: periodEndJobs.length
        }
    }, [selectedPeriodJobs, periodEndJobs])

    const previousJobs = useMemo(
        () => ({
            totalJobs: previousPeriodJobs.length,
            periodEndJobs: previousPeriodEndJobs.length
        }),
        [previousPeriodJobs, previousPeriodEndJobs]
    )

    const permanentPercent = jobs.totalJobs
        ? Math.round((jobs.permanentJobs / jobs.totalJobs) * 100)
        : 0

    const temporaryPercent = jobs.totalJobs
        ? Math.round((jobs.temporaryJobs / jobs.totalJobs) * 100)
        : 0

    const jobsChange =
        jobs.totalJobs - previousJobs.totalJobs

    const jobsChangePercent = signedPercent(
        jobs.totalJobs,
        previousJobs.totalJobs
    )

    const [financeLoading, setFinanceLoading] = useState(true)
    const [financeError, setFinanceError] = useState('')
    const [financeCompanies, setFinanceCompanies] =
        useState<FinanceCompanySeries[]>([])

    const loadTokenRef = useRef(0)

    useEffect(() => {
        let cancelled = false
        const tokenId = ++loadTokenRef.current

        const run = async () => {
            setFinanceLoading(true)
            setFinanceError('')

            try {
                const { series, failed, total } =
                    await loadProgramFinanceSeries(programId)

                if (cancelled || tokenId !== loadTokenRef.current) return

                setFinanceCompanies(series)

                // A silent partial failure looks identical to an SME that
                // simply has not reported, so say when figures are missing.
                setFinanceError(
                    failed
                        ? `Monthly revenue could not be loaded for ${failed} of ${total} SMEs.`
                        : ''
                )
            } catch (error) {
                console.error(
                    '[ProjectAdminProgramPulse] finance summary failed',
                    error
                )

                if (!cancelled) {
                    setFinanceCompanies([])
                    setFinanceError(
                        'Finance reporting is temporarily unavailable.'
                    )
                }
            } finally {
                if (!cancelled && tokenId === loadTokenRef.current) {
                    setFinanceLoading(false)
                }
            }
        }

        void run()

        return () => {
            cancelled = true
        }
    }, [programId])

    const financePeriod = useMemo(() => {
        if (!hasMonthlyReportingPeriod) {
            return {
                currentRevenue: 0,
                previousRevenue: 0,
                revenueChangePercent: 0,
                up: 0,
                unchanged: 0,
                down: 0,
                comparableSmes: 0,
                hasCurrentData: false,
                hasPreviousData: false
            }
        }

        let currentRevenue = 0
        let previousRevenue = 0
        let up = 0
        let unchanged = 0
        let down = 0
        let comparableSmes = 0
        let hasCurrentData = false
        let hasPreviousData = false

        financeCompanies.forEach(company => {
            const companyHasCurrent = hasPeriodRevenueData(
                company.months,
                reportingMonths
            )
            const companyHasPrevious = hasPeriodRevenueData(
                company.months,
                previousReportingMonths
            )

            if (companyHasCurrent) hasCurrentData = true
            if (companyHasPrevious) hasPreviousData = true

            const current = sumPeriodRevenue(
                company.months,
                reportingMonths
            )
            const previous = sumPeriodRevenue(
                company.months,
                previousReportingMonths
            )

            if (companyHasCurrent) currentRevenue += current
            if (companyHasPrevious) previousRevenue += previous

            // Only classify movement where both periods actually contain
            // reported monthly data for that SME.
            if (!companyHasCurrent || !companyHasPrevious) return

            comparableSmes += 1

            if (current > previous) up += 1
            else if (current < previous) down += 1
            else unchanged += 1
        })

        return {
            currentRevenue,
            previousRevenue,
            revenueChangePercent: signedPercent(
                currentRevenue,
                previousRevenue
            ),
            up,
            unchanged,
            down,
            comparableSmes,
            hasCurrentData,
            hasPreviousData
        }
    }, [
        financeCompanies,
        hasMonthlyReportingPeriod,
        reportingMonths,
        previousReportingMonths
    ])

    const revenueChartMonths = useMemo(() => {
        const MAX_MONTHS_PER_PERIOD = 4

        const previous =
            previousReportingMonths.length > MAX_MONTHS_PER_PERIOD
                ? previousReportingMonths.slice(-MAX_MONTHS_PER_PERIOD)
                : previousReportingMonths

        const selected =
            reportingMonths.length > MAX_MONTHS_PER_PERIOD
                ? reportingMonths.slice(-MAX_MONTHS_PER_PERIOD)
                : reportingMonths

        return {
            previous,
            selected,
            capped:
                previousReportingMonths.length > MAX_MONTHS_PER_PERIOD ||
                reportingMonths.length > MAX_MONTHS_PER_PERIOD
        }
    }, [previousReportingMonths, reportingMonths])

    const getProgramRevenueForMonth = React.useCallback(
        (month: Dayjs) =>
            financeCompanies.reduce(
                (sum, company) =>
                    sum + sumPeriodRevenue(company.months, [month]),
                0
            ),
        [financeCompanies]
    )

    const revenueBarOptions = useMemo<Highcharts.Options>(() => {
        const previousMonths = revenueChartMonths.previous
        const selectedMonths = revenueChartMonths.selected
        const months = [...previousMonths, ...selectedMonths]

        // A month nobody reported is a gap, not a fall to zero.
        const valueForMonth = (month: Dayjs) =>
            financeCompanies.some(company =>
                hasPeriodRevenueData(company.months, [month])
            )
                ? getProgramRevenueForMonth(month)
                : null

        const previousValues = previousMonths.map(valueForMonth)
        const selectedValues = selectedMonths.map(valueForMonth)

        const visibleValues = [...previousValues, ...selectedValues]
        const highestVisibleRevenue = Math.max(
            0,
            ...visibleValues.map(value => Number(value || 0))
        )

        // Headroom above the highest point so its figure is not clipped.
        const yAxisMax =
            highestVisibleRevenue > 0
                ? Math.ceil((highestVisibleRevenue * 1.3) / 10000) * 10000
                : undefined

        return {
            chart: {
                type: 'spline',
                height: 130,
                backgroundColor: 'transparent',
                spacing: [4, 8, 0, 8]
            },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            legend: {
                enabled: false
            },
            xAxis: {
                categories: months.map(month => month.format('MMM')),
                lineColor: pulse.axisLine,
                tickLength: 0,
                labels: {
                    style: {
                        color: pulse.axisLabel,
                        fontSize: '9px'
                    }
                }
            },
            yAxis: {
                min: 0,
                max: yAxisMax,
                endOnTick: false,
                maxPadding: 0,
                title: { text: undefined },
                gridLineColor: pulse.grid,
                tickAmount: 2,
                labels: {
                    style: {
                        color: pulse.axisLabelSoft,
                        fontSize: '8px'
                    },
                    formatter: function () {
                        return Intl.NumberFormat('en-ZA', {
                            notation: 'compact',
                            maximumFractionDigits: 1
                        }).format(Number(this.value || 0))
                    }
                }
            },
            tooltip: {
                shared: false,
                formatter: function () {
                    const point = this as any
                    const value = Number(point.y || 0)

                    return `
                        <b>${point.key}</b><br/>
                        ${point.series.name}: <b>R ${value.toLocaleString()}</b>
                    `
                }
            },
            plotOptions: {
                spline: {
                    lineWidth: 2.5,
                    marker: { enabled: true, radius: 3 },
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: 'allow',
                        y: -6,
                        style: {
                            fontSize: '9px',
                            fontWeight: '600',
                            textOutline: 'none'
                        },
                        formatter: function () {
                            return moneyCompact(Number(this.y || 0))
                        }
                    }
                },
                series: {
                    animation: false,
                    states: {
                        inactive: {
                            opacity: 0.65
                        }
                    }
                }
            },
            series: [
                {
                    type: 'spline',
                    name: previousPeriodLabel,
                    color: pulse.previousBar,
                    data: months.map((_month, index) =>
                        index < previousMonths.length
                            ? previousValues[index]
                            : null
                    )
                },
                {
                    type: 'spline',
                    name: selectedPeriodLabel,
                    color: pulse.currentBar,
                    data: months.map((_month, index) =>
                        index >= previousMonths.length
                            ? selectedValues[
                            index - previousMonths.length
                            ]
                            : null
                    )
                }
            ]
        }
    }, [
        revenueChartMonths,
        selectedPeriodLabel,
        previousPeriodLabel,
        getProgramRevenueForMonth,
        financeCompanies,
        pulse.axisLine,
        pulse.axisLabel,
        pulse.axisLabelSoft,
        pulse.grid,
        pulse.previousBar,
        pulse.currentBar
    ])

    const isLoading = jobsLoading || financeLoading

    return (
        <div data-guide="project-metrics-overview">
            <MotionCard
                title={
                    <Space size={7}>
                        <span>Program Pulse</span>
                        {hasMonthlyReportingPeriod ? (
                            <Tag color='blue'>
                                {selectedPeriodLabel}
                            </Tag>
                        ) : null}
                    </Space>
                }
                styles={{
                    body: {
                        padding: 10
                    }
                }}
            >
                {isLoading ? (
                    <Space
                        direction='vertical'
                        size={8}
                        style={{ width: '100%' }}
                    >
                        <Skeleton
                            active
                            title={false}
                            paragraph={{
                                rows: 3,
                                width: ['55%', '100%', '75%']
                            }}
                        />
                        <Skeleton
                            active
                            title={false}
                            paragraph={{
                                rows: 3,
                                width: ['45%', '100%', '70%']
                            }}
                        />
                    </Space>
                ) : !hasMonthlyReportingPeriod ? (
                    <div
                        style={{
                            padding: '24px 14px',
                            borderRadius: 12,
                            border: `1px dashed ${pulse.emptyBorder}`,
                            background: pulse.emptyBg,
                            textAlign: 'center'
                        }}
                    >
                        <Space direction='vertical' size={4}>
                            <Text strong>
                                No monthly reporting data for this period
                            </Text>
                            <Text
                                type='secondary'
                                style={{ fontSize: 12 }}
                            >
                                Finance and jobs are reported monthly. Choose a full
                                month, quarter, or a custom range containing at least
                                one complete month.
                            </Text>
                        </Space>
                    </div>
                ) : (
                    <Space
                        direction='vertical'
                        size={12}
                        style={{ width: '100%' }}
                    >
                        {(jobsError || financeError) ? (
                            <Alert
                                type='warning'
                                showIcon
                                message={jobsError || financeError}
                            />
                        ) : null}

                        <div
                            data-guide="project-metrics-revenue"
                            style={{
                                padding: 10,
                                borderRadius: 10,
                                border: `1px solid ${pulse.panelBorder}`,
                                background: pulse.panel
                            }}
                        >
                            <Space
                                direction='vertical'
                                size={6}
                                style={{ width: '100%' }}
                            >
                                <Row
                                    justify='space-between'
                                    align='top'
                                    gutter={[10, 8]}
                                >
                                    <Col flex='auto'>
                                        <Space
                                            direction='vertical'
                                            size={1}
                                        >
                                            <Space size={6}>
                                                <DollarOutlined />
                                                <Text strong>
                                                    Reported Revenue
                                                </Text>
                                            </Space>

                                            <Text
                                                strong
                                                style={{
                                                    fontSize: 21,
                                                    lineHeight: 1.1
                                                }}
                                            >
                                                {financePeriod.hasCurrentData
                                                    ? moneyCompact(
                                                        financePeriod.currentRevenue
                                                    )
                                                    : '—'}
                                            </Text>

                                            <Text
                                                type='secondary'
                                                style={{ fontSize: 11 }}
                                            >
                                                Combined SME revenue ·{' '}
                                                {periodMonthsLabel(reportingMonths)}
                                            </Text>
                                        </Space>
                                    </Col>

                                    <Col>
                                        {financePeriod.hasPreviousData ? (
                                            <Space
                                                direction='vertical'
                                                size={1}
                                                align='end'
                                            >
                                                <Tag
                                                    color={
                                                        financePeriod.revenueChangePercent > 0
                                                            ? 'green'
                                                            : financePeriod.revenueChangePercent < 0
                                                                ? 'red'
                                                                : 'default'
                                                    }
                                                    icon={
                                                        financePeriod.revenueChangePercent > 0
                                                            ? <RiseOutlined />
                                                            : financePeriod.revenueChangePercent < 0
                                                                ? <FallOutlined />
                                                                : <MinusOutlined />
                                                    }
                                                    style={{ marginInlineEnd: 0 }}
                                                >
                                                    {formatSignedPercent(
                                                        financePeriod.revenueChangePercent
                                                    )}
                                                </Tag>

                                                <Text
                                                    type='secondary'
                                                    style={{ fontSize: 10 }}
                                                >
                                                    vs {previousPeriodLabel}
                                                </Text>
                                            </Space>
                                        ) : null}
                                    </Col>
                                </Row>

                                {financePeriod.hasCurrentData ? (
                                    <div
                                        data-guide="project-metrics-revenue-chart"
                                        style={{
                                            padding: '4px 7px 0',
                                            borderRadius: 8,
                                            border: `1px solid ${pulse.innerBorder}`,
                                            background: pulse.inner
                                        }}
                                    >
                                        <Row
                                            justify='space-between'
                                            align='middle'
                                            style={{ marginBottom: 0 }}
                                        >
                                            <Col>
                                                <Text
                                                    strong
                                                    style={{ fontSize: 10 }}
                                                >
                                                    Monthly revenue
                                                </Text>
                                            </Col>

                                            <Col>
                                                <Text
                                                    type='secondary'
                                                    style={{ fontSize: 9 }}
                                                >
                                                    {previousPeriodLabel} → {selectedPeriodLabel}
                                                </Text>
                                            </Col>
                                        </Row>

                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={revenueBarOptions}
                                        />
                                    </div>
                                ) : null}

                                {financePeriod.hasPreviousData ? (
                                    <Row
                                        justify='space-between'
                                        align='middle'
                                    >
                                        <Col>
                                            <Text
                                                type='secondary'
                                                style={{ fontSize: 10 }}
                                            >
                                                {previousPeriodLabel}: {moneyCompact(financePeriod.previousRevenue)}
                                            </Text>
                                        </Col>
                                        <Col>
                                            <Text
                                                type='secondary'
                                                style={{ fontSize: 10 }}
                                            >
                                                comparison period
                                            </Text>
                                        </Col>
                                    </Row>
                                ) : null}

                                <div
                                    data-guide="project-metrics-sme-movement"
                                    style={{
                                        paddingTop: 5,
                                        borderTop: `1px solid ${pulse.divider}`
                                    }}
                                >
                                    <Space
                                        direction='vertical'
                                        size={5}
                                        style={{ width: '100%' }}
                                    >
                                        <Text
                                            type='secondary'
                                            style={{ fontSize: 11 }}
                                        >
                                            SME movement
                                        </Text>

                                        {financePeriod.comparableSmes > 0 ? (
                                            <Space size={[4, 4]} wrap>
                                                {financePeriod.up > 0 ? (
                                                    <Tag
                                                        color='green'
                                                        icon={<RiseOutlined />}
                                                    >
                                                        Revenue up: {financePeriod.up}
                                                    </Tag>
                                                ) : null}

                                                {financePeriod.unchanged > 0 ? (
                                                    <Tag
                                                        color='blue'
                                                        icon={<MinusOutlined />}
                                                    >
                                                        Unchanged: {financePeriod.unchanged}
                                                    </Tag>
                                                ) : null}

                                                {financePeriod.down > 0 ? (
                                                    <Tag
                                                        color='red'
                                                        icon={<FallOutlined />}
                                                    >
                                                        Revenue down: {financePeriod.down}
                                                    </Tag>
                                                ) : null}
                                            </Space>
                                        ) : (
                                            <Text
                                                type='secondary'
                                                style={{ fontSize: 11 }}
                                            >
                                                No SMEs have reported revenue in both
                                                comparison periods yet.
                                            </Text>
                                        )}
                                    </Space>
                                </div>
                            </Space>
                        </div>

                        <div
                            data-guide="project-metrics-jobs"
                            style={{
                                padding: 9,
                                borderRadius: 10,
                                border: `1px solid ${pulse.jobsBorder}`,
                                background: pulse.inner
                            }}
                        >
                            <Space
                                direction='vertical'
                                size={8}
                                style={{ width: '100%' }}
                            >
                                <Row
                                    justify='space-between'
                                    align='middle'
                                >
                                    <Col>
                                        <Space size={6}>
                                            <TeamOutlined />
                                            <Text strong>
                                                Jobs Active During Period
                                            </Text>
                                        </Space>
                                    </Col>

                                    <Col>
                                        <Text
                                            strong
                                            style={{ fontSize: 20 }}
                                        >
                                            {jobs.totalJobs}
                                        </Text>
                                    </Col>
                                </Row>

                                <Row
                                    justify='space-between'
                                    align='middle'
                                    gutter={[8, 4]}
                                >
                                    <Col>
                                        <Text
                                            type='secondary'
                                            style={{ fontSize: 10 }}
                                        >
                                            Unique active jobs · {selectedPeriodLabel}
                                        </Text>
                                    </Col>

                                    <Col>
                                        <Tag
                                            color={
                                                jobsChange > 0
                                                    ? 'green'
                                                    : jobsChange < 0
                                                        ? 'red'
                                                        : 'default'
                                            }
                                            style={{ marginInlineEnd: 0 }}
                                        >
                                            {jobsChange > 0 ? '+' : ''}
                                            {jobsChange} · {formatSignedPercent(jobsChangePercent)}
                                        </Tag>
                                    </Col>
                                </Row>

                                {jobs.totalJobs > 0 ? (
                                    <>
                                        <div
                                            aria-label='Job type distribution'
                                            style={{
                                                display: 'flex',
                                                width: '100%',
                                                height: 6,
                                                borderRadius: 999,
                                                overflow: 'hidden',
                                                background: pulse.track
                                            }}
                                        >
                                            {jobs.permanentJobs > 0 ? (
                                                <div
                                                    title={`Permanent ${permanentPercent}%`}
                                                    style={{
                                                        width: `${permanentPercent}%`,
                                                        background: '#52c41a'
                                                    }}
                                                />
                                            ) : null}

                                            {jobs.temporaryJobs > 0 ? (
                                                <div
                                                    title={`Temporary ${temporaryPercent}%`}
                                                    style={{
                                                        width: `${temporaryPercent}%`,
                                                        background: '#fa8c16'
                                                    }}
                                                />
                                            ) : null}
                                        </div>

                                        <Space size={[4, 4]} wrap>
                                            {jobs.permanentJobs > 0 ? (
                                                <Tag color='green'>
                                                    Permanent: {jobs.permanentJobs} ({permanentPercent}%)
                                                </Tag>
                                            ) : null}

                                            {jobs.temporaryJobs > 0 ? (
                                                <Tag color='orange'>
                                                    Temporary: {jobs.temporaryJobs} ({temporaryPercent}%)
                                                </Tag>
                                            ) : null}
                                        </Space>
                                    </>
                                ) : (
                                    <div
                                        style={{
                                            padding: '10px 12px',
                                            borderRadius: 8,
                                            border: `1px dashed ${pulse.emptyBorder}`,
                                            background: pulse.emptyBg
                                        }}
                                    >
                                        <Text type='secondary'>
                                            No employee jobs were active during{' '}
                                            {selectedPeriodLabel}.
                                        </Text>
                                    </div>
                                )}

                                <Row
                                    justify='space-between'
                                    align='middle'
                                    style={{
                                        paddingTop: 4,
                                        borderTop: `1px solid ${pulse.jobsBorder}`
                                    }}
                                >
                                    <Col>
                                        <Text
                                            type='secondary'
                                            style={{ fontSize: 10 }}
                                        >
                                            Still active at {selectedEndMonth?.format('MMM YYYY')} month-end
                                        </Text>
                                    </Col>
                                    <Col>
                                        <Text strong>
                                            {jobs.periodEndJobs}
                                        </Text>
                                    </Col>
                                </Row>
                            </Space>
                        </div>
                    </Space>
                )}
            </MotionCard>
        </div>
    )
}

export default ProjectAdminProgramPulse
