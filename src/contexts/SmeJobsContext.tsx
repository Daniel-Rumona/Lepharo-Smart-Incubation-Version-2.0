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

export type ContractType = 'permanent' | 'temporary' | 'temporal'

export type SmeApplicationRow = {
    id: string
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
}

export type SmeJobDrilldown = {
    sme: SmeApplicationRow
    contracts: JobContract[]
    effectiveContracts: JobContract[]
    totalJobs: number
    permanentJobs: number
    temporaryJobs: number
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
        totalJobs: number
        permanentJobs: number
        temporaryJobs: number
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

const toDayjs = (value: any): Dayjs | null => {
    if (!value) return null
    if (dayjs.isDayjs(value)) return value

    if (typeof value?.toDate === 'function') {
        const parsed = dayjs(value.toDate())
        return parsed.isValid() ? parsed : null
    }

    const parsed = dayjs(value)
    return parsed.isValid() ? parsed : null
}

const toNumber = (value: any) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

const normalizeContractType = (value: any): 'permanent' | 'temporary' => {
    const normalized = safeLower(value)

    if (normalized === 'permanent') return 'permanent'

    return 'temporary'
}

const getParticipantSector = (participant: ParticipantRow | undefined) =>
    pickFirst(
        participant?.sector,
        participant?.industry,
        participant?.businessSector,
        participant?.sectorName
    ) || 'Unspecified'

const getContractMonthStart = (contract: Partial<JobContract>) => {
    return (
        toDayjs(contract.uploadMonthDate)?.startOf('month') ||
        (contract.uploadMonth ? dayjs(`${contract.uploadMonth}-01`).startOf('month') : null) ||
        toDayjs(contract.createdAt)?.startOf('month') ||
        toDayjs(contract.updatedAt)?.startOf('month') ||
        null
    )
}

const getContractEffectiveTime = (contract: Partial<JobContract>) => {
    return (
        getContractMonthStart(contract)?.valueOf() ||
        toDayjs(contract.updatedAt)?.valueOf() ||
        toDayjs(contract.createdAt)?.valueOf() ||
        0
    )
}

const buildEmployeeKey = (contract: Partial<JobContract>) =>
    [
        contract.applicationId || '',
        safeLower(contract.employeeName),
        safeLower(contract.position)
    ].join('::')

const isContractActiveInMonth = (contract: JobContract, month: Dayjs) => {
    const monthStart = month.startOf('month')
    const monthEnd = month.endOf('month')
    const uploadedMonth = getContractMonthStart(contract)

    if (!uploadedMonth) return false
    if (uploadedMonth.isAfter(monthEnd)) return false

    if (normalizeContractType(contract.contractType) === 'permanent') {
        return true
    }

    const end = toDayjs(contract.contractEndDate)

    if (!end) return true

    return !end.endOf('day').isBefore(monthStart)
}

const getEffectiveContractsForMonth = (contracts: JobContract[], month: Dayjs) => {
    const map = new Map<string, JobContract>()
    const monthEnd = month.endOf('month')

    contracts.forEach((contract) => {
        const employeeKey = buildEmployeeKey(contract)
        const uploadedMonth = getContractMonthStart(contract)

        if (!uploadedMonth || uploadedMonth.isAfter(monthEnd)) return
        if (!isContractActiveInMonth(contract, month)) return

        const current = map.get(employeeKey)

        if (!current) {
            map.set(employeeKey, contract)
            return
        }

        if (getContractEffectiveTime(contract) >= getContractEffectiveTime(current)) {
            map.set(employeeKey, contract)
        }
    })

    return Array.from(map.values())
}

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

const calculateMetrics = (
    smes: SmeApplicationRow[],
    effectiveContracts: JobContract[]
): SmeJobsContextValue['metrics'] => {
    const applicationIdsWithJobs = new Set(
        effectiveContracts.map((contract) => contract.applicationId).filter(Boolean)
    )

    const permanentJobs = effectiveContracts.filter(
        (contract) => normalizeContractType(contract.contractType) === 'permanent'
    ).length

    const temporaryJobs = effectiveContracts.filter(
        (contract) => normalizeContractType(contract.contractType) === 'temporary'
    ).length

    return {
        totalSmes: smes.length,
        totalJobs: effectiveContracts.length,
        permanentJobs,
        temporaryJobs,
        smesWithJobs: smes.filter((sme) => applicationIdsWithJobs.has(sme.id)).length,
        smesWithoutJobs: smes.filter((sme) => !applicationIdsWithJobs.has(sme.id)).length,
        averageJobsPerSme:
            smes.length > 0
                ? Math.round((effectiveContracts.length / smes.length) * 10) / 10
                : 0
    }
}

const buildBreakdown = (
    smes: SmeApplicationRow[],
    effectiveContracts: JobContract[],
    key: keyof Pick<
        SmeApplicationRow,
        'sector' | 'gender' | 'group' | 'bbeeeLevel' | 'ownershipCategory'
    >
): BreakdownRow[] => {
    const contractsByApplication = new Map<string, JobContract[]>()

    effectiveContracts.forEach((contract) => {
        const existing = contractsByApplication.get(contract.applicationId) || []
        contractsByApplication.set(contract.applicationId, [...existing, contract])
    })

    const map = new Map<string, BreakdownRow>()

    smes.forEach((sme) => {
        const label = String(sme[key] || 'Unspecified')
        const smeContracts = contractsByApplication.get(sme.id) || []

        const current =
            map.get(label) || {
                key: label,
                label,
                smeCount: 0,
                totalJobs: 0,
                permanentJobs: 0,
                temporaryJobs: 0
            }

        current.smeCount += 1
        current.totalJobs += smeContracts.length
        current.permanentJobs += smeContracts.filter(
            (contract) => normalizeContractType(contract.contractType) === 'permanent'
        ).length
        current.temporaryJobs += smeContracts.filter(
            (contract) => normalizeContractType(contract.contractType) === 'temporary'
        ).length

        map.set(label, current)
    })

    return Array.from(map.values()).sort((a, b) => b.totalJobs - a.totalJobs)
}

const buildBreakdowns = (
    smes: SmeApplicationRow[],
    effectiveContracts: JobContract[]
): SmeJobsContextValue['breakdowns'] => ({
    sector: buildBreakdown(smes, effectiveContracts, 'sector'),
    gender: buildBreakdown(smes, effectiveContracts, 'gender'),
    group: buildBreakdown(smes, effectiveContracts, 'group'),
    bbeeeLevel: buildBreakdown(smes, effectiveContracts, 'bbeeeLevel'),
    ownershipCategory: buildBreakdown(smes, effectiveContracts, 'ownershipCategory')
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

    const effectiveContracts = useMemo(
        () => getEffectiveContractsForMonth(contracts, month),
        [contracts, month]
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

    const metrics = useMemo(
        () => calculateMetrics(filteredSmes, filteredEffectiveContracts),
        [filteredSmes, filteredEffectiveContracts]
    )

    const breakdowns = useMemo(
        () => buildBreakdowns(filteredSmes, filteredEffectiveContracts),
        [filteredSmes, filteredEffectiveContracts]
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

            const effectiveSmeContracts = getEffectiveContractsForMonth(
                allSmeContracts,
                (selectedMonth || month).startOf('month')
            )

            const permanentJobs = effectiveSmeContracts.filter(
                (contract) => normalizeContractType(contract.contractType) === 'permanent'
            ).length

            const temporaryJobs = effectiveSmeContracts.filter(
                (contract) => normalizeContractType(contract.contractType) === 'temporary'
            ).length

            return {
                sme,
                contracts: allSmeContracts,
                effectiveContracts: effectiveSmeContracts,
                totalJobs: effectiveSmeContracts.length,
                permanentJobs,
                temporaryJobs
            }
        },
        [contracts, month, smes]
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

            const nextEffectiveContracts = getEffectiveContractsForMonth(
                contracts,
                selectedMonth
            ).filter((contract) => nextIds.has(contract.applicationId))

            return {
                smes: nextSmes,
                contracts: nextEffectiveContracts,
                metrics: calculateMetrics(nextSmes, nextEffectiveContracts),
                breakdowns: buildBreakdowns(nextSmes, nextEffectiveContracts)
            }
        },
        [contracts, month, smes]
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
