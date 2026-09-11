import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { assignedInterventionService } from '@/services/assignedInterventionService'

export type IncubateePeerComparisonDimension = 'gender' | 'gapGroup' | 'sector' | 'program'

export type IncubateePerformanceDateRange = [Date | null, Date | null] | null

export type IncubateePerformanceFilters = {
    department: string | 'all'
    programId: string | 'all'
    consultant: string | 'all'
    dateRange: IncubateePerformanceDateRange
}

export type IncubateePerformanceIntervention = {
    id?: string
    participantId?: string
    interventionId?: string
    title?: string
    interventionTitle?: string
    area?: string
    areaOfSupport?: string
    department?: string
    departmentName?: string
    assigneeEmail?: string
    assigneeName?: string
    status?: string
    assignmentStatus?: string
    date?: unknown
    completedAt?: unknown
    interventionDate?: unknown
    programId?: string
}

export type IncubateePeerComparisonResult = {
    peerCount: number
    revenueAverage: {
        categories: string[]
        data: number[]
    }
    headcountAverage: {
        categories: string[]
        data: number[]
    }
    completedInterventionsByDepartment: Array<{ name: string; y: number }>
    complianceStatus: Array<{ name: string; y: number }>
}

export const DEFAULT_INCUBATEE_PERFORMANCE_FILTERS: IncubateePerformanceFilters = {
    department: 'all',
    programId: 'all',
    consultant: 'all',
    dateRange: null
}

export const EMPTY_INCUBATEE_PEER_COMPARISON: IncubateePeerComparisonResult = {
    peerCount: 0,
    revenueAverage: { categories: [], data: [] },
    headcountAverage: { categories: [], data: [] },
    completedInterventionsByDepartment: [],
    complianceStatus: []
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const chunks = <T,>(items: T[], size = 10): T[][] => {
    const output: T[][] = []
    for (let index = 0; index < items.length; index += size) {
        output.push(items.slice(index, index + size))
    }
    return output
}

export const performanceValueAsDate = (value: unknown): Date | null => {
    if (!value) return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

    if (typeof (value as any)?.toDate === 'function') {
        try {
            const date = (value as any).toDate()
            return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
        } catch {
            return null
        }
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? null : date
    }

    return null
}

const monthLabelAsDate = (value: unknown): Date | null => {
    const label = String(value || '').trim()
    if (!label) return null

    const direct = performanceValueAsDate(label)
    if (direct) return direct

    const date = new Date(`${label} 01`)
    return Number.isNaN(date.getTime()) ? null : date
}

const monthKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const isWithinRange = (date: Date | null, range: IncubateePerformanceDateRange) => {
    if (!range?.[0] || !range?.[1]) return true
    if (!date) return false

    const time = date.getTime()
    return time >= range[0].getTime() && time <= range[1].getTime()
}

export const filterIncubateePerformanceInterventions = (
    interventions: IncubateePerformanceIntervention[],
    filters: IncubateePerformanceFilters,
    fallbackProgramId?: string | null
) =>
    interventions.filter(intervention => {
        if (filters.department !== 'all') {
            const department = normalize(
                intervention.department ||
                intervention.departmentName ||
                intervention.area ||
                intervention.areaOfSupport
            )
            if (department !== normalize(filters.department)) return false
        }

        if (filters.programId !== 'all') {
            const programId = String(intervention.programId || fallbackProgramId || '')
            if (programId !== filters.programId) return false
        }

        if (filters.consultant !== 'all') {
            const consultant = normalize(intervention.assigneeEmail || intervention.assigneeName)
            if (!consultant.includes(normalize(filters.consultant))) return false
        }

        const activityDate =
            performanceValueAsDate(intervention.completedAt) ||
            performanceValueAsDate(intervention.interventionDate) ||
            performanceValueAsDate(intervention.date)

        return isWithinRange(activityDate, filters.dateRange)
    })

const resolvePeerIds = async (args: {
    participantId: string
    dimension: IncubateePeerComparisonDimension
    participant?: Record<string, any> | null
    application?: Record<string, any> | null
    filters: IncubateePerformanceFilters
}) => {
    const { participantId, dimension, participant, application, filters } = args
    let ids: string[] = []

    if (dimension === 'gender' || dimension === 'sector') {
        const fieldName = dimension === 'gender' ? 'gender' : 'sector'
        const fieldValue =
            dimension === 'gender'
                ? participant?.gender || participant?.sex
                : participant?.sector

        if (!fieldValue) return []

        const snapshot = await getDocs(
            query(collection(db, 'participants'), where(fieldName, '==', fieldValue))
        )
        ids = snapshot.docs.map(item => item.id)
    } else {
        const fieldName = dimension === 'gapGroup' ? 'gapGroup' : 'programId'
        const fieldValue =
            dimension === 'gapGroup'
                ? application?.gapGroup
                : application?.programId ||
                (filters.programId !== 'all' ? filters.programId : null)

        if (!fieldValue) return []

        const snapshot = await getDocs(
            query(collection(db, 'applications'), where(fieldName, '==', fieldValue))
        )
        ids = snapshot.docs
            .map(item => String((item.data() as any)?.participantId || ''))
            .filter(Boolean)
    }

    return Array.from(new Set(ids)).filter(id => id !== participantId)
}

const loadParticipantPrograms = async (participantIds: string[]) => {
    const programsByParticipant = new Map<string, Set<string>>()

    for (const participantChunk of chunks(participantIds, 10)) {
        const snapshot = await getDocs(
            query(collection(db, 'applications'), where('participantId', 'in', participantChunk))
        )

        snapshot.docs.forEach(item => {
            const application = item.data() as any
            const participantId = String(application?.participantId || '')
            const programId = String(application?.programId || '')
            if (!participantId || !programId) return

            const programs = programsByParticipant.get(participantId) || new Set<string>()
            programs.add(programId)
            programsByParticipant.set(participantId, programs)
        })
    }

    return programsByParticipant
}

export const loadIncubateePeerComparison = async (args: {
    participantId: string
    dimension: IncubateePeerComparisonDimension
    participant?: Record<string, any> | null
    application?: Record<string, any> | null
    filters?: Partial<IncubateePerformanceFilters>
    maxPeers?: number
}): Promise<IncubateePeerComparisonResult> => {
    const filters: IncubateePerformanceFilters = {
        ...DEFAULT_INCUBATEE_PERFORMANCE_FILTERS,
        ...(args.filters || {})
    }

    let peerIds = await resolvePeerIds({
        participantId: args.participantId,
        dimension: args.dimension,
        participant: args.participant,
        application: args.application,
        filters
    })

    const maxPeers = Math.max(1, args.maxPeers || 25)
    peerIds = peerIds.slice(0, maxPeers)
    if (!peerIds.length) return EMPTY_INCUBATEE_PEER_COMPARISON

    const programsByParticipant = await loadParticipantPrograms(peerIds)
    if (filters.programId !== 'all') {
        peerIds = peerIds.filter(id => programsByParticipant.get(id)?.has(filters.programId))
    }
    if (!peerIds.length) return EMPTY_INCUBATEE_PEER_COMPARISON

    const revenue = new Map<string, { sum: number; count: number }>()
    const headcount = new Map<string, { sum: number; count: number }>()
    const compliance: Record<string, number> = {
        Valid: 0,
        Missing: 0,
        Expired: 0,
        'Other/Unknown': 0
    }
    const completedByDepartment = new Map<string, number>()

    for (const peerId of peerIds) {
        try {
            const historySnapshot = await getDocs(
                collection(db, 'monthlyPerformance', peerId, 'history')
            )

            historySnapshot.docs.forEach(item => {
                const row = item.data() as any
                const date =
                    performanceValueAsDate(row?.createdAt) ||
                    monthLabelAsDate(row?.month)
                if (!date || !isWithinRange(date, filters.dateRange)) return

                const key = monthKey(date)
                const revenuePoint = revenue.get(key) || { sum: 0, count: 0 }
                revenuePoint.sum += Number(row?.revenue || 0)
                revenuePoint.count += 1
                revenue.set(key, revenuePoint)

                const headcountPoint = headcount.get(key) || { sum: 0, count: 0 }
                headcountPoint.sum +=
                    Number(row?.headPermanent || 0) +
                    Number(row?.headTemporary || 0)
                headcountPoint.count += 1
                headcount.set(key, headcountPoint)
            })
        } catch {
            // A missing peer history should not invalidate the remaining comparison.
        }

        try {
            const participantSnapshot = await getDoc(doc(db, 'participants', peerId))
            let documents = Array.isArray(participantSnapshot.data()?.complianceDocuments)
                ? participantSnapshot.data()!.complianceDocuments
                : []

            if (!documents.length) {
                const applicationSnapshot = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('participantId', '==', peerId),
                        limit(1)
                    )
                )
                const application = applicationSnapshot.docs[0]?.data() as any
                documents = Array.isArray(application?.complianceDocuments)
                    ? application.complianceDocuments
                    : []
            }

            documents.forEach((document: any) => {
                const status = normalize(document?.status)
                if (status === 'valid') compliance.Valid += 1
                else if (status === 'missing') compliance.Missing += 1
                else if (status === 'expired') compliance.Expired += 1
                else compliance['Other/Unknown'] += 1
            })
        } catch {
            // Compliance is optional peer data.
        }
    }

    for (const peerChunk of chunks(peerIds, 10)) {
        const interventions = await assignedInterventionService.listCompleted({
            participantIds: peerChunk
        }) as IncubateePerformanceIntervention[]

        filterIncubateePerformanceInterventions(interventions, filters).forEach(intervention => {
            const status = normalize(intervention.assignmentStatus || intervention.status)
            if (status !== 'completed') return

            const department =
                String(
                    intervention.department ||
                    intervention.departmentName ||
                    intervention.area ||
                    intervention.areaOfSupport ||
                    'Unknown'
                ).trim() || 'Unknown'

            completedByDepartment.set(
                department,
                (completedByDepartment.get(department) || 0) + 1
            )
        })
    }

    const categories = Array.from(
        new Set([...revenue.keys(), ...headcount.keys()])
    ).sort()

    const average = (
        values: Map<string, { sum: number; count: number }>,
        category: string
    ) => {
        const value = values.get(category)
        return value ? Number((value.sum / value.count).toFixed(2)) : 0
    }

    return {
        peerCount: peerIds.length,
        revenueAverage: {
            categories,
            data: categories.map(category => average(revenue, category))
        },
        headcountAverage: {
            categories,
            data: categories.map(category => average(headcount, category))
        },
        completedInterventionsByDepartment: Array.from(completedByDepartment)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([name, y]) => ({ name, y })),
        complianceStatus: Object.entries(compliance)
            .filter(([, count]) => count > 0)
            .map(([name, y]) => ({ name, y }))
    }
}
