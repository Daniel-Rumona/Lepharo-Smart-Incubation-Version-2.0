import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState
} from 'react'
import {
    collection,
    onSnapshot,
    query,
    where,
    type QueryConstraint
} from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    countJobsInPeriod,
    groupJobs,
    isJobActiveOn,
    jobsBaselineFor,
    jobsByApplication,
    type Job,
    type JobContractRecord,
    type JobsBaseline,
    type JobsPeriodCount
} from '@/lib/jobs'
import { asOfMonthEnd } from '@/lib/jobsData'

export type ContractType = 'permanent' | 'temporary' | 'temporal'

export type SmeApplicationRow = {
    id: string
    /** Starting headcount (src/lib/jobs.ts jobsBaselineFor). */
    jobsBaseline: JobsBaseline
    participantId?: string
    programId?: string
    smmeNo?: string
    smmeName: string
    group: string
    gender: string
    sector: string
    email?: string
    phone?: string

    bbeeeLevel: string
    ownershipCategory: string
    blackOwnedPercent: number
    femaleOwnedPercent: number
    youthOwnedPercent: number
    disabledOwnedPercent: number
}

export type ParticipantRow = {
    id: string
    participantId?: string
    applicationId?: string
    email?: string
    contactEmail?: string
    registrationNumber?: string
    smmeNo?: string
    sector?: string
    industry?: string
    businessSector?: string
    sectorName?: string
}

export type JobContract = {
    id: string
    applicationId: string
    participantId?: string
    jobId?: string | null
    startDate?: any
    endedAt?: any
    endReason?: string | null

    programId?: string

    smmeName?: string
    group?: string
    gender?: string
    sector?: string

    employeeName: string
    position: string
    contractType: ContractType
    contractEndDate?: any

    uploadMonth?: string
    uploadMonthDate?: any

    fileName?: string
    fileUrl?: string
    storagePath?: string

    uploadedByName?: string
    uploadedByEmail?: string
    createdAt?: any
    updatedAt?: any
}

export type SmeJobFilters = {
    searchText?: string
    sector?: string
    gender?: string
    group?: string
    bbeeeLevel?: string
    ownershipCategory?: string
    month?: Dayjs
}

export type BreakdownRow = {
    key: string
    label: string
    smeCount: number
    totalJobs: number
    permanentJobs: number
    temporaryJobs: number
    sustainedJobs: number
    createdJobs: number
}

export type SmeJobDrilldown = {
    sme: SmeApplicationRow
    contracts: JobContract[]
    /** The latest document of each job active in the month. */
    effectiveContracts: JobContract[]
    totalJobs: number
    permanentJobs: number
    temporaryJobs: number
    sustainedJobs: number
    createdJobs: number
    createdInMonth: number
}

type SmeJobsContextValue = {
    loading: boolean
    error: string | null

    month: Dayjs
    setMonth: React.Dispatch<React.SetStateAction<Dayjs>>

    smes: SmeApplicationRow[]
    contracts: JobContract[]
    effectiveContracts: JobContract[]

    filteredSmes: SmeApplicationRow[]
    filteredEffectiveContracts: JobContract[]

    metrics: {
        totalSmes: number
        /** Jobs active at month end (today for the current month). */
        totalJobs: number
        permanentJobs: number
        temporaryJobs: number
        /** min(starting headcount, active), summed per SME. */
        sustainedJobs: number
        /** Active jobs above the starting headcount, summed per SME. */
        createdJobs: number
        /** Net new jobs created during the month, summed per SME. */
        createdInMonth: number
        /** Sum of the SMEs' starting headcounts. */
        startingHeadcount: number
        smesWithJobs: number
        smesWithoutJobs: number
        averageJobsPerSme: number
    }

    breakdowns: {
        sector: BreakdownRow[]
        gender: BreakdownRow[]
        group: BreakdownRow[]
        bbeeeLevel: BreakdownRow[]
        ownershipCategory: BreakdownRow[]
    }

    options: {
        sectorOptions: string[]
        genderOptions: string[]
        groupOptions: string[]
        bbeeeLevelOptions: string[]
        ownershipCategoryOptions: string[]
    }

    getSmeDrilldown: (applicationId: string, selectedMonth?: Dayjs) => SmeJobDrilldown | null
    getSmesByMetric: (
        metric: keyof SmeJobsContextValue['breakdowns'],
        value: string
    ) => SmeApplicationRow[]

    applyFilters: (filters?: SmeJobFilters) => {
        smes: SmeApplicationRow[]
        contracts: JobContract[]
        metrics: SmeJobsContextValue['metrics']
        breakdowns: SmeJobsContextValue['breakdowns']
    }
}

const SmeJobsContext = createContext<SmeJobsContextValue | null>(null)

const safeLower = (value: any) => String(value || '').trim().toLowerCase()

const normalizeKey = (value: any) => String(value || '').trim().toLowerCase()

const pickFirst = (...values: any[]) => {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value
        }
    }

    return ''
}

const toNumber = (value: any) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

const getParticipantSector = (participant: ParticipantRow | undefined) =>
    pickFirst(
        participant?.sector,
        participant?.industry,
        participant?.businessSector,
        participant?.sectorName
    ) || 'Unspecified'

/** The latest document of each job active in the month (src/lib/jobs.ts). */
const effectiveContractsOf = (jobs: Job[], month: Dayjs) => {
    const asOf = asOfMonthEnd(month)
    return jobs
        .filter((job) => isJobActiveOn(job, asOf))
        .map((job) => job.latest as unknown as JobContract)
}

/** Each SME's own count for the month, against its own starting headcount. */
const countsForMonth = (
    smes: SmeApplicationRow[],
    jobsByApp: Map<string, Job[]>,
    month: Dayjs
) => {
    const start = month.startOf('month')
    const asOf = asOfMonthEnd(month)
    const map = new Map<string, JobsPeriodCount>()
    smes.forEach((sme) => {
        map.set(
            sme.id,
            countJobsInPeriod(jobsByApp.get(sme.id) || [], sme.jobsBaseline.total, start, asOf)
        )
    })
    return map
}

const emptyCount = (): JobsPeriodCount => ({
    active: 0,
    permanent: 0,
    temporary: 0,
    sustained: 0,
    created: 0,
    createdInPeriod: 0,
    started: 0,
    lost: 0
})

const buildParticipantIndex = (rows: ParticipantRow[]) => {
    const map = new Map<string, ParticipantRow>()

    const add = (key: any, row: ParticipantRow) => {
        const normalized = normalizeKey(key)
        if (!normalized) return
        if (!map.has(normalized)) map.set(normalized, row)
    }

    rows.forEach((row) => {
        add(row.id, row)
        add(row.participantId, row)
        add(row.applicationId, row)
        add(row.email, row)
        add(row.contactEmail, row)
        add(row.registrationNumber, row)
        add(row.smmeNo, row)
    })

    return map
}

const getOwnershipCategory = (data: any) => {
    const explicit = pickFirst(
        data.ownershipCategory,
        data.ownershipType,
        data.ownership
    )

    if (explicit) return String(explicit)

    const blackOwned = toNumber(
        pickFirst(data.blackOwnedPercent, data.blackOwnership, data.blackOwned)
    )

    const femaleOwned = toNumber(
        pickFirst(data.femaleOwnedPercent, data.femaleOwnership, data.femaleOwned)
    )

    const youthOwned = toNumber(
        pickFirst(data.youthOwnedPercent, data.youthOwnership, data.youthOwned)
    )

    if (blackOwned >= 51 && femaleOwned >= 51) return 'Black Female Owned'
    if (blackOwned >= 51) return 'Black Owned'
    if (femaleOwned >= 51) return 'Female Owned'
    if (youthOwned >= 51) return 'Youth Owned'

    return 'Unspecified'
}

const buildApplicationsFromDocs = (
    docs: any[],
    participantMap: Map<string, ParticipantRow>
): SmeApplicationRow[] =>
    docs.map((snap) => {
        const data = snap.data() || {}

        const participantId =
            pickFirst(data.participantId, data.participantDocId, data.incubateeId) || undefined

        const appEmail = pickFirst(data.email, data.contactEmail, data.companyEmail)
        const appSmmeNo = pickFirst(data.smmeNo, data.registrationNumber)

        const participant =
            participantMap.get(normalizeKey(participantId)) ||
            participantMap.get(normalizeKey(snap.id)) ||
            participantMap.get(normalizeKey(appEmail)) ||
            participantMap.get(normalizeKey(appSmmeNo))

        return {
            id: snap.id,
            jobsBaseline: jobsBaselineFor(data, participant || null),
            participantId,
            programId: data.programId || undefined,
            smmeNo: appSmmeNo || undefined,
            smmeName:
                pickFirst(
                    data.beneficiaryName,
                    data.companyName,
                    data.businessName,
                    data.enterpriseName,
                    data.name
                ) || 'Unnamed SME',
            group:
                pickFirst(
                    data.gapGroup,
                    data.group,
                    data.currentGroup,
                    data.groupStage
                ) || 'Unspecified',
            gender:
                pickFirst(
                    data.gender,
                    data.ownerGender,
                    data.directorGender,
                    data.applicantGender
                ) || 'Unspecified',
            sector: getParticipantSector(participant),
            email: appEmail || undefined,
            phone:
                pickFirst(
                    data.phone,
                    data.contactPhone,
                    data.mobile
                ) || undefined,

            bbeeeLevel:
                pickFirst(
                    data.bbeeeLevel,
                    data.bbbeeLevel,
                    data.beeLevel,
                    data.bbeeeStatus,
                    data.bbbeeStatus
                ) || 'Unspecified',

            ownershipCategory: getOwnershipCategory(data),

            blackOwnedPercent: toNumber(
                pickFirst(data.blackOwnedPercent, data.blackOwnership, data.blackOwned)
            ),
            femaleOwnedPercent: toNumber(
                pickFirst(data.femaleOwnedPercent, data.femaleOwnership, data.femaleOwned)
            ),
            youthOwnedPercent: toNumber(
                pickFirst(data.youthOwnedPercent, data.youthOwnership, data.youthOwned)
            ),
            disabledOwnedPercent: toNumber(
                pickFirst(data.disabledOwnedPercent, data.disabledOwnership, data.disabledOwned)
            )
        }
    })

// Programme figures are the sum of each SME's own count, never pooled.
const calculateMetrics = (
    smes: SmeApplicationRow[],
    counts: Map<string, JobsPeriodCount>
): SmeJobsContextValue['metrics'] => {
    let totalJobs = 0
    let permanentJobs = 0
    let temporaryJobs = 0
    let sustainedJobs = 0
    let createdJobs = 0
    let createdInMonth = 0
    let startingHeadcount = 0
    let smesWithJobs = 0

    smes.forEach((sme) => {
        const count = counts.get(sme.id) || emptyCount()
        totalJobs += count.active
        permanentJobs += count.permanent
        temporaryJobs += count.temporary
        sustainedJobs += count.sustained
        createdJobs += count.created
        createdInMonth += count.createdInPeriod
        startingHeadcount += sme.jobsBaseline.total
        if (count.active > 0) smesWithJobs += 1
    })

    return {
        totalSmes: smes.length,
        totalJobs,
        permanentJobs,
        temporaryJobs,
        sustainedJobs,
        createdJobs,
        createdInMonth,
        startingHeadcount,
        smesWithJobs,
        smesWithoutJobs: smes.length - smesWithJobs,
        averageJobsPerSme:
            smes.length > 0
                ? Math.round((totalJobs / smes.length) * 10) / 10
                : 0
    }
}

const buildBreakdown = (
    smes: SmeApplicationRow[],
    counts: Map<string, JobsPeriodCount>,
    key: keyof Pick<
        SmeApplicationRow,
        'sector' | 'gender' | 'group' | 'bbeeeLevel' | 'ownershipCategory'
    >
): BreakdownRow[] => {
    const map = new Map<string, BreakdownRow>()

    smes.forEach((sme) => {
        const label = String(sme[key] || 'Unspecified')
        const count = counts.get(sme.id) || emptyCount()

        const current =
            map.get(label) || {
                key: label,
                label,
                smeCount: 0,
                totalJobs: 0,
                permanentJobs: 0,
                temporaryJobs: 0,
                sustainedJobs: 0,
                createdJobs: 0
            }

        current.smeCount += 1
        current.totalJobs += count.active
        current.permanentJobs += count.permanent
        current.temporaryJobs += count.temporary
        current.sustainedJobs += count.sustained
        current.createdJobs += count.created

        map.set(label, current)
    })

    return Array.from(map.values()).sort((a, b) => b.totalJobs - a.totalJobs)
}

const buildBreakdowns = (
    smes: SmeApplicationRow[],
    counts: Map<string, JobsPeriodCount>
): SmeJobsContextValue['breakdowns'] => ({
    sector: buildBreakdown(smes, counts, 'sector'),
    gender: buildBreakdown(smes, counts, 'gender'),
    group: buildBreakdown(smes, counts, 'group'),
    bbeeeLevel: buildBreakdown(smes, counts, 'bbeeeLevel'),
    ownershipCategory: buildBreakdown(smes, counts, 'ownershipCategory')
})

const filterSmes = (smes: SmeApplicationRow[], filters?: SmeJobFilters) => {
    if (!filters) return smes

    const search = safeLower(filters.searchText)

    return smes.filter((sme) => {
        const haystack = [
            sme.smmeName,
            sme.smmeNo,
            sme.group,
            sme.gender,
            sme.sector,
            sme.bbeeeLevel,
            sme.ownershipCategory,
            sme.email,
            sme.phone
        ]
            .join(' ')
            .toLowerCase()

        const matchesSearch = !search || haystack.includes(search)
        const matchesSector = !filters.sector || sme.sector === filters.sector
        const matchesGender = !filters.gender || sme.gender === filters.gender
        const matchesGroup = !filters.group || sme.group === filters.group
        const matchesBbeee = !filters.bbeeeLevel || sme.bbeeeLevel === filters.bbeeeLevel
        const matchesOwnership =
            !filters.ownershipCategory || sme.ownershipCategory === filters.ownershipCategory

        return (
            matchesSearch &&
            matchesSector &&
            matchesGender &&
            matchesGroup &&
            matchesBbeee &&
            matchesOwnership
        )
    })
}

const getUniqueOptions = (rows: SmeApplicationRow[], field: keyof SmeApplicationRow) =>
    Array.from(
        new Set(
            rows
                .map((row) => String(row[field] || '').trim())
                .filter(Boolean)
        )
    ).sort((a, b) => a.localeCompare(b))

export const SmeJobsProvider: React.FC<{
    children: React.ReactNode
    defaultMonth?: Dayjs
}> = ({ children, defaultMonth }) => {
    const {
        actor,
        loading: identityLoading
    } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [month, setMonth] = useState<Dayjs>(
        (defaultMonth || dayjs()).startOf('month')
    )

    const [smes, setSmes] = useState<SmeApplicationRow[]>([])
    const [contracts, setContracts] = useState<JobContract[]>([])

    useEffect(() => {
        // This provider used to mount its listeners while Firebase Auth was
        // still restoring the browser session. A permission-denied listener
        // is terminal, and the old dependency list never re-subscribed after
        // identity loading completed.
        if (identityLoading) {
            setLoading(true)
            return
        }

        if (!actor?.uid) {
            setSmes([])
            setContracts([])
            setError(null)
            setLoading(false)
            return
        }

        setLoading(true)
        setError(null)

        const appConstraints: QueryConstraint[] = [
            where('applicationStatus', 'in', ['Accepted', 'accepted'])
        ]

        const contractConstraints: QueryConstraint[] = []

        if (!isAllPrograms && activeProgramId) {
            appConstraints.push(where('programId', '==', activeProgramId))
            contractConstraints.push(where('programId', '==', activeProgramId))
        }

        const participantsQuery = query(collection(db, 'participants'))
        const applicationsQuery = query(collection(db, 'applications'), ...appConstraints)
        const contractsQuery = query(collection(db, 'hseJobContracts'), ...contractConstraints)

        let participantsLoaded = false
        let applicationsLoaded = false
        let contractsLoaded = false

        let latestApplicationDocs: any[] = []
        let latestParticipantMap = new Map<string, ParticipantRow>()

        const finishLoading = () => {
            if (participantsLoaded && applicationsLoaded && contractsLoaded) {
                setLoading(false)
            }
        }

        const rebuildApplications = () => {
            setSmes(buildApplicationsFromDocs(latestApplicationDocs, latestParticipantMap))
        }

        const unsubParticipants = onSnapshot(
            participantsQuery,
            (snap) => {
                const rows: ParticipantRow[] = snap.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...(docSnap.data() as any)
                }))

                latestParticipantMap = buildParticipantIndex(rows)
                participantsLoaded = true
                rebuildApplications()
                finishLoading()
            },
            (err) => {
                console.error('Failed to load participants:', err)
                participantsLoaded = true
                setError('Failed to load participant data.')
                finishLoading()
            }
        )

        const unsubApplications = onSnapshot(
            applicationsQuery,
            (snap) => {
                latestApplicationDocs = snap.docs
                applicationsLoaded = true
                rebuildApplications()
                finishLoading()
            },
            (err) => {
                console.error('Failed to load applications:', err)
                applicationsLoaded = true
                setError('Failed to load SME applications.')
                finishLoading()
            }
        )

        const unsubContracts = onSnapshot(
            contractsQuery,
            (snap) => {
                const rows: JobContract[] = snap.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...(docSnap.data() as any)
                }))

                contractsLoaded = true
                setContracts(rows)
                finishLoading()
            },
            (err) => {
                console.error('Failed to load job contracts:', err)
                contractsLoaded = true
                setError('Failed to load job contracts.')
                finishLoading()
            }
        )

        return () => {
            unsubParticipants()
            unsubApplications()
            unsubContracts()
        }
    }, [actor?.uid, activeProgramId, identityLoading, isAllPrograms])

    // One job per person per position, renewals and re-uploads included (src/lib/jobs.ts).
    const jobs = useMemo(
        () => groupJobs(contracts as unknown as JobContractRecord[]),
        [contracts]
    )

    const jobsByApp = useMemo(() => jobsByApplication(jobs), [jobs])

    const effectiveContracts = useMemo(
        () => effectiveContractsOf(jobs, month),
        [jobs, month]
    )

    const filteredSmes = smes

    const visibleApplicationIds = useMemo(
        () => new Set(filteredSmes.map((sme) => sme.id)),
        [filteredSmes]
    )

    const filteredEffectiveContracts = useMemo(
        () =>
            effectiveContracts.filter((contract) =>
                visibleApplicationIds.has(contract.applicationId)
            ),
        [effectiveContracts, visibleApplicationIds]
    )

    const monthCounts = useMemo(
        () => countsForMonth(filteredSmes, jobsByApp, month),
        [filteredSmes, jobsByApp, month]
    )

    const metrics = useMemo(
        () => calculateMetrics(filteredSmes, monthCounts),
        [filteredSmes, monthCounts]
    )

    const breakdowns = useMemo(
        () => buildBreakdowns(filteredSmes, monthCounts),
        [filteredSmes, monthCounts]
    )

    const options = useMemo(
        () => ({
            sectorOptions: getUniqueOptions(smes, 'sector'),
            genderOptions: getUniqueOptions(smes, 'gender'),
            groupOptions: getUniqueOptions(smes, 'group'),
            bbeeeLevelOptions: getUniqueOptions(smes, 'bbeeeLevel'),
            ownershipCategoryOptions: getUniqueOptions(smes, 'ownershipCategory')
        }),
        [smes]
    )

    const getSmeDrilldown = useCallback(
        (applicationId: string, selectedMonth?: Dayjs): SmeJobDrilldown | null => {
            const sme = smes.find((row) => row.id === applicationId)
            if (!sme) return null

            const allSmeContracts = contracts.filter(
                (contract) => contract.applicationId === applicationId
            )

            const smeJobs = jobsByApp.get(applicationId) || []
            const drillMonth = (selectedMonth || month).startOf('month')
            const count = countJobsInPeriod(
                smeJobs,
                sme.jobsBaseline.total,
                drillMonth,
                asOfMonthEnd(drillMonth)
            )

            return {
                sme,
                contracts: allSmeContracts,
                effectiveContracts: effectiveContractsOf(smeJobs, drillMonth),
                totalJobs: count.active,
                permanentJobs: count.permanent,
                temporaryJobs: count.temporary,
                sustainedJobs: count.sustained,
                createdJobs: count.created,
                createdInMonth: count.createdInPeriod
            }
        },
        [contracts, jobsByApp, month, smes]
    )

    const getSmesByMetric = useCallback(
        (
            metric: keyof SmeJobsContextValue['breakdowns'],
            value: string
        ): SmeApplicationRow[] => {
            const fieldMap: Record<keyof SmeJobsContextValue['breakdowns'], keyof SmeApplicationRow> = {
                sector: 'sector',
                gender: 'gender',
                group: 'group',
                bbeeeLevel: 'bbeeeLevel',
                ownershipCategory: 'ownershipCategory'
            }

            const field = fieldMap[metric]

            return smes.filter((sme) => String(sme[field] || 'Unspecified') === value)
        },
        [smes]
    )

    const applyFilters = useCallback(
        (filters?: SmeJobFilters) => {
            const selectedMonth = (filters?.month || month).startOf('month')
            const nextSmes = filterSmes(smes, filters)
            const nextIds = new Set(nextSmes.map((sme) => sme.id))

            const nextEffectiveContracts = effectiveContractsOf(jobs, selectedMonth)
                .filter((contract) => nextIds.has(contract.applicationId))
            const counts = countsForMonth(nextSmes, jobsByApp, selectedMonth)

            return {
                smes: nextSmes,
                contracts: nextEffectiveContracts,
                metrics: calculateMetrics(nextSmes, counts),
                breakdowns: buildBreakdowns(nextSmes, counts)
            }
        },
        [jobs, jobsByApp, month, smes]
    )

    const value: SmeJobsContextValue = {
        loading,
        error,

        month,
        setMonth,

        smes,
        contracts,
        effectiveContracts,

        filteredSmes,
        filteredEffectiveContracts,

        metrics,
        breakdowns,
        options,

        getSmeDrilldown,
        getSmesByMetric,
        applyFilters
    }

    return (
        <SmeJobsContext.Provider value={value}>
            {children}
        </SmeJobsContext.Provider>
    )
}

export const useSmeJobs = () => {
    const context = useContext(SmeJobsContext)

    if (!context) {
        throw new Error('useSmeJobs must be used inside SmeJobsProvider.')
    }

    return context
}
