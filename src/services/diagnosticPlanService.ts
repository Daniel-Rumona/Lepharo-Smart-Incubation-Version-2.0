import {
    collection,
    getDocs,
    query,
    where,
    documentId,
} from 'firebase/firestore'
import { db } from '@/firebase'

type IdName = {
    id: string
    name: string
}

export type SMEProfile = {
    participantId: string
    beneficiaryName: string
    gender?: string | null
    sector?: string | null
    age?: number | null
    youth?: boolean
    programId?: string | null
    email?: string | null
}

export type DiagnosticInterventionRecord = {
    participantId: string
    beneficiaryName: string
    departmentId: string
    departmentName: string
    interventionTitle: string
    interventionDescription?: string | null
    status?: string | null
    profile: SMEProfile
}

export type DepartmentInterventionSummary = {
    departmentId: string
    departmentName: string
    totalInterventions: number
    totalSMEs: number
    records: DiagnosticInterventionRecord[]
}

export type SMEInterventionSummary = {
    participantId: string
    beneficiaryName: string
    totalInterventions: number
    departments: Array<{
        departmentId: string
        departmentName: string
        interventionCount: number
        interventions: DiagnosticInterventionRecord[]
    }>
    profile: SMEProfile | null
}

type Filters = {
    programId?: string
    departmentId?: string
    participantId?: string
    gender?: string
    sector?: string
    youth?: boolean
    minAge?: number
    maxAge?: number
}

const normalize = (value: any) =>
    String(value ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const calcAge = (dob: any): number | null => {
    const date = toDate(dob)
    if (!date) return null

    const today = new Date()
    let age = today.getFullYear() - date.getFullYear()
    const monthDiff = today.getMonth() - date.getMonth()

    if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < date.getDate())
    ) {
        age--
    }

    return age >= 0 ? age : null
}

const isYouthAge = (age: number | null | undefined) =>
    typeof age === 'number' ? age >= 18 && age <= 35 : false

const uniqueBy = <T,>(arr: T[], keyFn: (item: T) => string) => {
    const seen = new Set<string>()
    return arr.filter(item => {
        const key = keyFn(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}


export const extractInterventionsFromDiagnosticPlan = (
    plan: any,
    departmentsById: Record<string, IdName>,
    profile: SMEProfile
): DiagnosticInterventionRecord[] => {
    const participantId = String(plan?.participantId || profile.participantId || '').trim()
    const beneficiaryName = String(
        profile.beneficiaryName || plan?.beneficiaryName || ''
    ).trim()

    if (!participantId) return []

    const rows: DiagnosticInterventionRecord[] = []

    /**
     * Expected flexible plan shapes:
     * - plan.interventionsByDepartment[deptId] = [...]
     * - plan.departmentPlans[deptId].interventions = [...]
     * - plan.interventions = [{ departmentId, title, ... }]
     */

    const byDept = plan?.interventionsByDepartment
    if (byDept && typeof byDept === 'object') {
        Object.entries(byDept).forEach(([deptId, items]: [string, any]) => {
            const deptMeta = departmentsById[deptId]
            const list = Array.isArray(items) ? items : []

            list.forEach((item: any, index: number) => {
                const title = String(
                    item?.title || item?.interventionTitle || item?.name || `Intervention ${index + 1}`
                ).trim()

                if (!title) return

                rows.push({
                    participantId,
                    beneficiaryName,
                    departmentId: deptId,
                    departmentName: deptMeta?.name || deptId,
                    interventionTitle: title,
                    interventionDescription: item?.description || item?.details || null,
                    status: item?.status || null,
                    profile,
                })
            })
        })
    }

    const deptPlans = plan?.departmentPlans
    if (deptPlans && typeof deptPlans === 'object') {
        Object.entries(deptPlans).forEach(([deptId, deptPlan]: [string, any]) => {
            const deptMeta = departmentsById[deptId]
            const list = Array.isArray(deptPlan?.interventions)
                ? deptPlan.interventions
                : []

            list.forEach((item: any, index: number) => {
                const title = String(
                    item?.title || item?.interventionTitle || item?.name || `Intervention ${index + 1}`
                ).trim()

                if (!title) return

                rows.push({
                    participantId,
                    beneficiaryName,
                    departmentId: deptId,
                    departmentName: deptMeta?.name || deptId,
                    interventionTitle: title,
                    interventionDescription: item?.description || item?.details || null,
                    status: item?.status || null,
                    profile,
                })
            })
        })
    }

    if (Array.isArray(plan?.interventions)) {
        plan.interventions.forEach((item: any, index: number) => {
            const deptId = String(item?.departmentId || item?.deptId || '').trim()
            if (!deptId) return

            const deptMeta = departmentsById[deptId]
            const title = String(
                item?.title || item?.interventionTitle || item?.name || `Intervention ${index + 1}`
            ).trim()

            if (!title) return

            rows.push({
                participantId,
                beneficiaryName,
                departmentId: deptId,
                departmentName: deptMeta?.name || item?.departmentName || deptId,
                interventionTitle: title,
                interventionDescription: item?.description || item?.details || null,
                status: item?.status || null,
                profile,
            })
        })
    }

    return uniqueBy(
        rows,
        row =>
            [
                row.participantId,
                row.departmentId,
                normalize(row.interventionTitle),
            ].join('::')
    )
}

export const loadDepartmentMap = async () => {
    const snap = await getDocs(
        query(collection(db, 'departments'))
    )

    const byId: Record<string, IdName> = {}

    snap.docs.forEach(docSnap => {
        const data = docSnap.data() as any
        byId[docSnap.id] = {
            id: docSnap.id,
            name: String(data?.name || docSnap.id),
        }
    })

    return byId
}

export const loadParticipantProfiles = async (
    programId?: string
): Promise<Record<string, SMEProfile>> => {
    const appConstraints: any[] = [
        where('applicationStatus', '==', 'accepted'),
    ]

    if (programId) {
        appConstraints.push(where('programId', '==', programId))
    }

    const appSnap = await getDocs(query(collection(db, 'applications'), ...appConstraints))

    const profiles: Record<string, SMEProfile> = {}

    appSnap.docs.forEach(docSnap => {
        const data = docSnap.data() as any
        const participantId = String(data?.participantId || '').trim()
        if (!participantId) return

        const age =
            typeof data?.age === 'number'
                ? data.age
                : calcAge(data?.dateOfBirth || data?.dob || null)

        profiles[participantId] = {
            participantId,
            beneficiaryName: String(
                data?.beneficiaryName || data?.participantName || ''
            ).trim(),
            gender: data?.gender || null,
            sector: data?.sector || data?.businessSector || null,
            age,
            youth:
                typeof data?.youth === 'boolean'
                    ? data.youth
                    : isYouthAge(age),
            programId: data?.programId || null,
            email:
                data?.email || data?.participantEmail || data?.applicantEmail || null,
        }
    })

    return profiles
}

export const loadDiagnosticInterventionRecords = async (
    programId?: string
): Promise<DiagnosticInterventionRecord[]> => {
    const [departmentsById, profiles] = await Promise.all([
        loadDepartmentMap(),
        loadParticipantProfiles( programId),
    ])

    const constraints: any[] = []
    if (programId) {
        constraints.push(where('programId', '==', programId))
    }

    const planSnap = await getDocs(
        constraints.length
            ? query(collection(db, 'diagnosticPlans'), ...constraints)
            : collection(db, 'diagnosticPlans')
    )

    const rows: DiagnosticInterventionRecord[] = []

    planSnap.docs.forEach(docSnap => {
        const plan = docSnap.data() as any
        const participantId = String(plan?.participantId || '').trim()
        if (!participantId) return

        const profile = profiles[participantId]
        if (!profile) return

        rows.push(
            ...extractInterventionsFromDiagnosticPlan(
                plan,
                departmentsById,
                profile
            )
        )
    })

    return rows
}

const applyFilters = (
    rows: DiagnosticInterventionRecord[],
    filters: Filters
) => {
    return rows.filter(row => {
        if (filters.programId && row.profile.programId !== filters.programId) return false
        if (filters.departmentId && row.departmentId !== filters.departmentId) return false
        if (filters.participantId && row.participantId !== filters.participantId) return false

        if (filters.gender) {
            if (normalize(row.profile.gender) !== normalize(filters.gender)) return false
        }

        if (filters.sector) {
            if (normalize(row.profile.sector) !== normalize(filters.sector)) return false
        }

        if (typeof filters.youth === 'boolean') {
            if (row.profile.youth !== filters.youth) return false
        }

        if (typeof filters.minAge === 'number') {
            if (typeof row.profile.age !== 'number' || row.profile.age < filters.minAge) return false
        }

        if (typeof filters.maxAge === 'number') {
            if (typeof row.profile.age !== 'number' || row.profile.age > filters.maxAge) return false
        }

        return true
    })
}

export const getDepartmentInterventionSummary = async (
    filters: Filters & { departmentId: string }
): Promise<DepartmentInterventionSummary> => {
    const rows = await loadDiagnosticInterventionRecords(
               filters.programId
    )

    const filtered = applyFilters(rows, filters)
    const deptRows = filtered.filter(row => row.departmentId === filters.departmentId)

    return {
        departmentId: filters.departmentId,
        departmentName: deptRows[0]?.departmentName || filters.departmentId,
        totalInterventions: deptRows.length,
        totalSMEs: uniqueBy(deptRows, row => row.participantId).length,
        records: deptRows,
    }
}

export const getSMEInterventionSummary = async (
    filters: Filters & { participantId: string }
): Promise<SMEInterventionSummary> => {
    const rows = await loadDiagnosticInterventionRecords(
        filters.programId
    )

    const filtered = applyFilters(rows, filters)
    const smeRows = filtered.filter(row => row.participantId === filters.participantId)

    const grouped = Object.values(
        smeRows.reduce<Record<string, SMEInterventionSummary['departments'][number]>>(
            (acc, row) => {
                const key = row.departmentId
                if (!acc[key]) {
                    acc[key] = {
                        departmentId: row.departmentId,
                        departmentName: row.departmentName,
                        interventionCount: 0,
                        interventions: [],
                    }
                }

                acc[key].interventionCount += 1
                acc[key].interventions.push(row)
                return acc
            },
            {}
        )
    ).sort((a, b) => b.interventionCount - a.interventionCount)

    return {
        participantId: filters.participantId,
        beneficiaryName: smeRows[0]?.beneficiaryName || '',
        totalInterventions: smeRows.length,
        departments: grouped,
        profile: smeRows[0]?.profile || null,
    }
}

export const getTotalInterventionsForDepartment = async (
    departmentId: string,
    extra?: Omit<Filters, 'departmentId'>
) => {
    return getDepartmentInterventionSummary({
        departmentId,
        ...(extra || {}),
    })
}

export const getTotalInterventionsForSME = async (
    participantId: string,
    extra?: Omit<Filters, 'participantId'>
) => {
    return getSMEInterventionSummary({
        participantId,
        ...(extra || {}),
    })
}
