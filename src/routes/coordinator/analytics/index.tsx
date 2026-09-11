import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    message,
    Result,
    Row,
    Segmented,
    Select,
    DatePicker
} from 'antd'
import { Helmet } from 'react-helmet'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    type QueryConstraint
} from 'firebase/firestore'
import { db } from '@/firebase'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import drilldown from 'highcharts/modules/drilldown'
import dayjs, { Dayjs } from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    assignmentAssignedDate,
    resolveAssignmentLifecycle
} from '@/services/assignmentLifecycleService'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

if (typeof drilldown === 'function') {
    drilldown(Highcharts)
}

const { Option } = Select
const { RangePicker } = DatePicker

type AI = {
    id: string
    participantId: string
    participantName?: string
    status?: string
    computedProgress?: number
    progress?: number
    createdAt?: Date
    updatedAt?: Date

    acceptanceStatus?: string
    confirmationStatus?: string
    participantAccepted?: boolean
    participantConfirmed?: boolean

    raw?: Record<string, any>
}

type ParticipantMeta = {
    id: string
    name?: string
    gender?: string
    sector?: string
    province?: string
}

type DisplayStatus =
    | 'Assigned'
    | 'Awaiting Appointment Response'
    | 'In Delivery'
    | 'Awaiting SME Confirmation'
    | 'Completed'
    | 'Coordinator Declined'
    | 'Appointment Declined'
    | 'SME Rejected Completion'
    | 'Cancelled'

const STATUS_MAP: Record<
    string,
    'Assigned' | 'In Progress' | 'Completed' | 'Declined' | 'Pending'
> = {
    assigned: 'Assigned',
    'in-progress': 'In Progress',
    completed: 'Completed',
    declined: 'Declined',
    pending: 'Pending',
    done: 'Completed',
    unknown: 'Assigned'
}


const DISPLAY_STATUS_COLOR: Record<string, string> = {
    Assigned: '#1677ff',
    'Awaiting Appointment Response': '#fa8c16',
    'In Delivery': '#1677ff',
    'Awaiting SME Confirmation': '#722ed1',
    Completed: '#52c41a',
    'Coordinator Declined': '#f5222d',
    'Appointment Declined': '#ff4d4f',
    'SME Rejected Completion': '#cf1322',
    Cancelled: '#8c8c8c',
    'Assigned Overdue': '#f5222d',
    'In Progress Overdue': '#f5222d',
    'Pending Overdue': '#f5222d'
}

const GENDER_COLOR: Record<string, string> = {
    male: '#2563eb',
    man: '#2563eb',
    female: '#db2777',
    woman: '#db2777',
    'non-binary': '#7c3aed',
    nonbinary: '#7c3aed',
    other: '#0d9488',
    'prefer not to say': '#64748b',
    'not specified': '#94a3b8'
}


const toMonthKey = (d: Date) => dayjs(d).format('YYYY-MM')
const monthLabel = (monthKey: string) =>
    dayjs(`${monthKey}-01`).format('MMM YYYY')

const safeDate = (raw: any): Date | undefined => {
    if (!raw) return undefined
    if (raw instanceof Date) return raw
    if (typeof raw?.toDate === 'function') return raw.toDate()
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? undefined : d
}

const getAssignmentDate = (a: AI): Date | undefined =>
    assignmentAssignedDate(a.raw || {}) ||
    safeDate(a.raw?.assignedAt) ||
    a.createdAt ||
    safeDate(a.raw?.startDate)

const monthKeyIsInRange = (
    monthKey: string,
    range: [Dayjs | null, Dayjs | null] | null
) => {
    if (!range?.[0] && !range?.[1]) return true
    const month = dayjs(`${monthKey}-01`)
    if (range?.[0] && month.isBefore(range[0], 'month')) return false
    if (range?.[1] && month.isAfter(range[1], 'month')) return false
    return true
}

const monthKeysBetween = (
    start: Dayjs | null | undefined,
    end: Dayjs | null | undefined
) => {
    if (!start || !end) return []

    const keys: string[] = []
    let cursor = start.startOf('month')
    const last = end.startOf('month')

    while (cursor.isBefore(last, 'month') || cursor.isSame(last, 'month')) {
        keys.push(cursor.format('YYYY-MM'))
        cursor = cursor.add(1, 'month')
    }

    return keys
}

const toStatus = (raw?: string) => {
    const s =
        String(raw || '')
            .trim()
            .toLowerCase() || 'unknown'

    return STATUS_MAP[s] ?? 'Assigned'
}

const normalizeText = (v?: string) => (v || '').trim()

const getInterventionTitle = (a: AI) =>
    normalizeText(
        a.raw?.interventionTitle ||
        a.raw?.snapshot?.interventionTitle ||
        a.raw?.groupMeta?.interventionTitle ||
        a.raw?.title ||
        a.raw?.interventionName ||
        a.raw?.name
    ) || 'Untitled Intervention'

const getInterventionKey = (a: AI) =>
    normalizeText(a.raw?.interventionId || a.raw?.subInterventionId) ||
    `title:${getInterventionTitle(a).toLowerCase()}`

const getSubInterventionKey = (a: AI) => {
    const subInterventionId = getSubInterventionId(a)
    if (subInterventionId) return subInterventionId

    const subInterventionTitle = getSubInterventionTitle(a)
    return subInterventionTitle
        ? `title:${subInterventionTitle.toLowerCase()}`
        : ''
}


const getSubInterventionTitle = (a: AI) =>
    normalizeText(
        a.raw?.resolvedSubInterventionTitle ||
        a.raw?.subInterventionTitle ||
        a.raw?.subInterventionName ||
        a.raw?.subIntervention ||
        a.raw?.snapshot?.selectedSubIntervention?.title
    )

const getSubInterventionId = (a: AI) =>
    normalizeText(
        a.raw?.subInterventionId ||
        a.raw?.snapshot?.selectedSubIntervention?.subId ||
        a.raw?.snapshot?.selectedSubIntervention?.id
    )

const getInterventionDrillKey = (a: AI) => {
    const interventionId = normalizeText(a.raw?.interventionId)
    const subInterventionId = getSubInterventionId(a)
    const interventionTitle = getInterventionTitle(a)
    const subInterventionTitle = getSubInterventionTitle(a)

    return [
        interventionId || `title:${interventionTitle.toLowerCase()}`,
        subInterventionId || (subInterventionTitle ? `sub:${subInterventionTitle.toLowerCase()}` : 'no-sub')
    ].join('::')
}

const getInterventionDrillLabel = (a: AI) => {
    const interventionTitle = getInterventionTitle(a)
    const subInterventionTitle = getSubInterventionTitle(a)
    const subInterventionId = getSubInterventionId(a)
    const subInterventionLabel = subInterventionTitle || subInterventionId

    return subInterventionLabel
        ? `${interventionTitle} — ${subInterventionLabel}`
        : interventionTitle
}

const aggregateInterventionDrillPoints = (rows: AI[]) => {
    const grouped = new Map<string, { name: string; y: number }>()

    rows.forEach((a) => {
        const key = getInterventionDrillKey(a)
        const current = grouped.get(key)

        if (current) {
            current.y += 1
            return
        }

        grouped.set(key, {
            name: getInterventionDrillLabel(a),
            y: 1
        })
    })

    return Array.from(grouped.values())
        .sort((left, right) => right.y - left.y || left.name.localeCompare(right.name))
        .map(({ name, y }) => ({
            name,
            y
        } satisfies Highcharts.PointOptionsObject))
}

const drillIdPart = (value: string) => encodeURIComponent(value)

const normalizeBoolish = (v: any): boolean | undefined => {
    if (typeof v === 'boolean') return v

    if (typeof v === 'string') {
        const s = v.trim().toLowerCase()

        if (
            [
                'true',
                'yes',
                'accepted',
                'confirmed',
                'completed',
                'done'
            ].includes(s)
        ) {
            return true
        }

        if (
            [
                'false',
                'no',
                'pending',
                'declined',
                'rejected',
                'not accepted',
                'not confirmed',
                'incomplete'
            ].includes(s)
        ) {
            return false
        }
    }

    return undefined
}

const normalizeWorkflowStatus = (value: any) =>
    String(value || '').trim().toLowerCase().replace(/_/g, '-')

const getCoordinatorAcceptanceStatus = (a: AI) =>
    normalizeWorkflowStatus(
        a.raw?.assigneeAcceptanceStatus ||
        a.raw?.assigneeStatus
    )

const getParticipantAcceptanceStatus = (a: AI) =>
    normalizeWorkflowStatus(
        a.raw?.participantAcceptanceStatus ||
        a.raw?.beneficiaryStatus ||
        a.raw?.userStatus ||
        a.acceptanceStatus
    )

const getParticipantCompletionStatus = (a: AI) =>
    normalizeWorkflowStatus(
        a.raw?.participantCompletionStatus ||
        a.raw?.completionStatus ||
        a.raw?.userCompletionStatus ||
        a.confirmationStatus
    )

const getCoordinatorCompletionStatus = (a: AI) =>
    normalizeWorkflowStatus(
        a.raw?.assigneeCompletionStatus ||
        a.raw?.facilitatorCompletionStatus
    )

const isUserAccepted = (a: AI) =>
    ['accepted', 'confirmed', 'completed', 'done'].includes(
        getParticipantAcceptanceStatus(a)
    )

const isUserCompleted = (a: AI) =>
    ['confirmed', 'completed', 'done'].includes(
        getParticipantCompletionStatus(a)
    )

const isCoordinatorDeclined = (a: AI) =>
    ['declined', 'rejected', 'not-accepted'].includes(
        getCoordinatorAcceptanceStatus(a)
    )

const getAssignmentLifecycle = (a: AI) =>
    resolveAssignmentLifecycle({
        ...(a.raw || {}),
        assignmentStatus:
            a.raw?.assignmentStatus ||
            a.raw?.status ||
            a.status,
        assigneeAcceptanceStatus:
            a.raw?.assigneeAcceptanceStatus ||
            a.raw?.assigneeStatus,
        participantAcceptanceStatus:
            a.raw?.participantAcceptanceStatus ||
            a.raw?.beneficiaryStatus ||
            a.raw?.userStatus ||
            a.acceptanceStatus,
        assigneeCompletionStatus:
            a.raw?.assigneeCompletionStatus ||
            a.raw?.facilitatorCompletionStatus,
        participantCompletionStatus:
            a.raw?.participantCompletionStatus ||
            a.raw?.userCompletionStatus ||
            a.raw?.completionStatus ||
            a.confirmationStatus
    })

const isAssignmentCompleted = (a: AI) => getAssignmentLifecycle(a).isCompleted


const getInterventionAgeDays = (a: AI) => {
    const assignedDate = getAssignmentDate(a)
    if (!assignedDate) return 0
    return dayjs().diff(dayjs(assignedDate), 'day')
}

const getBottleneckStage = (a: AI) => {
    const lifecycle = getAssignmentLifecycle(a)

    if (lifecycle.key === 'needs-reassignment') return 'Coordinator Declined'
    if (lifecycle.key === 'awaiting-participant-acceptance') return 'Awaiting Appointment Response'
    if (lifecycle.key === 'participant-declined') return 'Appointment Declined'
    if (lifecycle.key === 'awaiting-participant-confirmation') return 'Awaiting SME Confirmation'
    if (lifecycle.key === 'participant-rejected') return 'SME Rejected Completion'

    return 'Flowing Normally'
}


const getOverdueStage = (a: AI) => {
    const ageDays = getInterventionAgeDays(a)
    const lifecycle = getAssignmentLifecycle(a)

    if (!lifecycle.isOpen) return null

    if (
        ['assigned', 'awaiting-participant-acceptance'].includes(lifecycle.key) &&
        ageDays > 14
    ) return 'Assigned Overdue'

    if (
        ['in-delivery', 'awaiting-participant-confirmation', 'participant-rejected'].includes(lifecycle.key) &&
        ageDays > 30
    ) return 'In Progress Overdue'

    return null
}


const buildCoordinatorScopedAssignedQueries = ({
    assignedCol,
    activeProgramId,
    uid,
    email,
    coordinatorDocId
}: {
    assignedCol: ReturnType<typeof collection>
    activeProgramId?: string
    uid?: string
    email?: string
    coordinatorDocId?: string | null
}) => {
    const querySets: Array<{ label: string; constraints: QueryConstraint[] }> = []

    const withProgram = (constraints: QueryConstraint[]) =>
        activeProgramId
            ? [...constraints, where('programId', '==', activeProgramId)]
            : constraints

    if (uid) {
        querySets.push({
            label: `assigneeId = auth uid (${uid})`,
            constraints: withProgram([where('assigneeId', '==', uid)])
        })
    }

    if (email) {
        querySets.push({
            label: `assigneeEmail = ${email}`,
            constraints: withProgram([where('assigneeEmail', '==', email)])
        })
    }

    if (coordinatorDocId && coordinatorDocId !== uid) {
        querySets.push({
            label: `assigneeId = coordinator doc (${coordinatorDocId})`,
            constraints: withProgram([
                where('assigneeId', '==', coordinatorDocId)
            ])
        })
    }

    return querySets.map(({ label, constraints }) => ({
        label,
        ref: query(assignedCol, ...constraints)
    }))
}

const mapAssignedInterventionToAnalytics = (
    id: string,
    raw: Record<string, any>
): AI => ({
    id,
    participantId: String(raw.participantId || '').trim(),
    participantName:
        raw.participantName ||
        raw.beneficiaryName ||
        raw.companyName ||
        raw.smeName ||
        raw.snapshot?.beneficiaryName,
    status: raw.assignmentStatus || raw.status,
    computedProgress:
        Number.isFinite(Number(raw.computedProgress))
            ? Number(raw.computedProgress)
            : Number.isFinite(Number(raw.progress?.percentage))
                ? Number(raw.progress.percentage)
                : undefined,
    progress: Number.isFinite(Number(raw.progress)) ? Number(raw.progress) : undefined,
    createdAt: safeDate(raw.createdAt),
    updatedAt: safeDate(raw.updatedAt),
    acceptanceStatus:
        raw.acceptanceStatus ||
        raw.participantAcceptanceStatus ||
        raw.beneficiaryStatus ||
        raw.userStatus,
    confirmationStatus:
        raw.confirmationStatus ||
        raw.participantCompletionStatus ||
        raw.completionStatus ||
        raw.userCompletionStatus,
    participantAccepted: normalizeBoolish(
        raw.participantAccepted ??
        raw.accepted ??
        raw.isAccepted ??
        raw.smmeAccepted
    ),
    participantConfirmed: normalizeBoolish(
        raw.participantConfirmed ??
        raw.confirmed ??
        raw.isConfirmed
    ),
    raw
})

export const CoordinatorAnalytics: React.FC = () => {
    const { activeProgramId } = useActiveProgramId()
    const { user, loading: identityLoading } = useFullIdentity()
    const [loading, setLoading] = useState(true)
    const [assigned, setAssigned] = useState<AI[]>([])
    const [participantMetaById, setParticipantMetaById] = useState<
        Record<string, ParticipantMeta>
    >({})

    const [genderFilter, setGenderFilter] = useState<string | undefined>()
    const [sectorFilter, setSectorFilter] = useState<string | undefined>()
    const [dateRange, setDateRange] = useState<
        [Dayjs | null, Dayjs | null] | null
    >([
        dayjs().subtract(5, 'month').startOf('month'),
        dayjs().endOf('month')
    ])
    const [chartGroup, setChartGroup] = useState<
        'interventions' | 'risk' | 'reach'
    >('interventions')
    const [selectedReachIntervention, setSelectedReachIntervention] = useState<
        string | undefined
    >()
    const [selectedReachSubIntervention, setSelectedReachSubIntervention] = useState<
        string | undefined
    >()

    useEffect(() => {
        const loadAnalytics = async () => {
            if (identityLoading) return

            const uid = String(user?.uid || user?.id || '').trim()
            const email = String(user?.email || '').trim()

            if (!uid && !email) {
                setAssigned([])
                setParticipantMetaById({})
                setLoading(false)
                return
            }

            setLoading(true)

            try {
                let coordinatorDocId: string | null = null

                if (email) {
                    try {
                        const coordinatorSnap = await getDocs(
                            query(
                                collection(db, 'coordinators'),
                                where('email', '==', email)
                            )
                        )

                        if (!coordinatorSnap.empty) {
                            coordinatorDocId = coordinatorSnap.docs[0].id
                        }
                    } catch (error) {
                        console.warn(
                            'Coordinator profile lookup failed; continuing with UID/email assignment queries.',
                            error
                        )
                    }
                }

                const assignedCol = collection(db, 'assignedInterventions')
                const queriesToTry = buildCoordinatorScopedAssignedQueries({
                    assignedCol,
                    activeProgramId,
                    uid: uid || undefined,
                    email: email || undefined,
                    coordinatorDocId
                })

                const byId = new Map<string, AI>()

                for (const queryEntry of queriesToTry) {
                    try {
                        const snap = await getDocs(queryEntry.ref)

                        snap.docs.forEach((assignmentDoc) => {
                            const raw = assignmentDoc.data() as Record<string, any>
                            byId.set(
                                assignmentDoc.id,
                                mapAssignedInterventionToAnalytics(
                                    assignmentDoc.id,
                                    raw
                                )
                            )
                        })
                    } catch (error) {
                        console.warn(
                            `Coordinator analytics assignment query failed: ${queryEntry.label}`,
                            error
                        )
                    }
                }

                const list = Array.from(byId.values()).filter(
                    (item) => !!item.participantId
                )

                // Some assignment records only persist subInterventionId. Resolve
                // the display title from the canonical intervention definition so
                // chart drilldowns never lose the sub-intervention dimension.
                const interventionIds = Array.from(
                    new Set(
                        list
                            .map((item) => normalizeText(item.raw?.interventionId))
                            .filter(Boolean)
                    )
                )

                const interventionDefinitions = new Map<string, Record<string, any>>()

                await Promise.all(
                    interventionIds.map(async (interventionId) => {
                        try {
                            const definitionSnap = await getDoc(
                                doc(db, 'interventions', interventionId)
                            )
                            if (definitionSnap.exists()) {
                                interventionDefinitions.set(
                                    interventionId,
                                    definitionSnap.data() as Record<string, any>
                                )
                            }
                        } catch (error) {
                            console.warn(
                                `Could not resolve intervention definition ${interventionId}:`,
                                error
                            )
                        }
                    })
                )

                const enrichedList = list.map((item) => {
                    const interventionId = normalizeText(item.raw?.interventionId)
                    const subInterventionId = getSubInterventionId(item)
                    const definition = interventionDefinitions.get(interventionId)

                    if (!definition) return item

                    const subInterventions = Array.isArray(definition.subInterventions)
                        ? definition.subInterventions
                        : []

                    const matchingSub = subInterventionId
                        ? subInterventions.find((sub: any) => {
                            const candidateId = normalizeText(
                                sub?.subId || sub?.id || sub?.title
                            )
                            return candidateId === subInterventionId
                        })
                        : null

                    const resolvedSubInterventionTitle = normalizeText(
                        matchingSub?.title ||
                        matchingSub?.name ||
                        matchingSub?.label
                    )

                    return {
                        ...item,
                        raw: {
                            ...item.raw,
                            interventionTitle:
                                normalizeText(item.raw?.interventionTitle) ||
                                normalizeText(definition.interventionTitle || definition.title || definition.name),
                            ...(resolvedSubInterventionTitle
                                ? { resolvedSubInterventionTitle }
                                : {})
                        }
                    }
                })

                setAssigned(enrichedList)

                const uniqueParticipantIds = Array.from(
                    new Set(enrichedList.map((item) => item.participantId).filter(Boolean))
                )

                const metaEntries = await Promise.all(
                    uniqueParticipantIds.map(async (pid) => {
                        try {
                            const directSnap = await getDoc(
                                doc(db, 'participants', pid)
                            )

                            if (directSnap.exists()) {
                                const p = directSnap.data() as Record<string, any>
                                return [
                                    pid,
                                    {
                                        id: pid,
                                        name:
                                            p.name ||
                                            p.participantName ||
                                            p.businessName ||
                                            p.companyName,
                                        gender: normalizeText(p.gender),
                                        sector: normalizeText(p.sector),
                                        province: normalizeText(
                                            p.province || p.region || p.state
                                        )
                                    } satisfies ParticipantMeta
                                ] as const
                            }

                            const qSnap = await getDocs(
                                query(
                                    collection(db, 'participants'),
                                    where('participantId', '==', pid)
                                )
                            )

                            if (!qSnap.empty) {
                                const p = qSnap.docs[0].data() as Record<string, any>
                                return [
                                    pid,
                                    {
                                        id: pid,
                                        name:
                                            p.name ||
                                            p.participantName ||
                                            p.businessName ||
                                            p.companyName,
                                        gender: normalizeText(p.gender),
                                        sector: normalizeText(p.sector),
                                        province: normalizeText(
                                            p.province || p.region || p.state
                                        )
                                    } satisfies ParticipantMeta
                                ] as const
                            }
                        } catch (error) {
                            console.warn(`Participant metadata lookup failed for ${pid}:`, error)
                        }

                        return [
                            pid,
                            {
                                id: pid,
                                name: undefined,
                                gender: undefined,
                                sector: undefined,
                                province: undefined
                            } satisfies ParticipantMeta
                        ] as const
                    })
                )

                setParticipantMetaById(Object.fromEntries(metaEntries))
            } catch (error) {
                console.error(error)
                setAssigned([])
                setParticipantMetaById({})
                message.error('Failed to load coordinator analytics')
            } finally {
                setLoading(false)
            }
        }

        void loadAnalytics()
    }, [activeProgramId, identityLoading, user?.email, user?.id, user?.uid])

    const genderOptions = useMemo(() => {
        const set = new Set<string>()
        Object.values(participantMetaById).forEach((p) => {
            if (p.gender) set.add(p.gender)
        })
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [participantMetaById])

    const sectorOptions = useMemo(() => {
        const set = new Set<string>()
        Object.values(participantMetaById).forEach((p) => {
            if (p.sector) set.add(p.sector)
        })
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [participantMetaById])

    const visibleAIs = useMemo(() => {
        return assigned.filter((a) => {
            const meta = participantMetaById[a.participantId]

            const okGender = !genderFilter || meta?.gender === genderFilter
            const okSector = !sectorFilter || meta?.sector === sectorFilter

            const assignedDate = getAssignmentDate(a)
            const okDate = !dateRange?.[0] && !dateRange?.[1]
                ? true
                : assignedDate
                    ? monthKeyIsInRange(toMonthKey(assignedDate), dateRange)
                    : false

            return okGender && okSector && okDate
        })
    }, [
        assigned,
        participantMetaById,
        genderFilter,
        sectorFilter,
        dateRange
    ])

    const reachInterventionOptions = useMemo(() => {
        const options = new Map<string, string>()

        visibleAIs.forEach((a) => {
            options.set(getInterventionKey(a), getInterventionTitle(a))
        })

        return Array.from(options, ([value, label]) => ({ value, label })).sort(
            (a, b) => a.label.localeCompare(b.label)
        )
    }, [visibleAIs])

    const activeReachIntervention = reachInterventionOptions.some(
        (option) => option.value === selectedReachIntervention
    )
        ? selectedReachIntervention
        : undefined

    const reachSubInterventionOptions = useMemo(() => {
        if (!activeReachIntervention) return []

        const options = new Map<string, string>()

        visibleAIs
            .filter((a) => getInterventionKey(a) === activeReachIntervention)
            .forEach((a) => {
                const value = getSubInterventionKey(a)
                if (!value) return

                const label = getSubInterventionTitle(a) || getSubInterventionId(a)
                if (label) options.set(value, label)
            })

        return Array.from(options, ([value, label]) => ({ value, label })).sort(
            (a, b) => a.label.localeCompare(b.label)
        )
    }, [activeReachIntervention, visibleAIs])

    const hasReachSubInterventions = reachSubInterventionOptions.length > 0

    const activeReachSubIntervention = reachSubInterventionOptions.some(
        (option) => option.value === selectedReachSubIntervention
    )
        ? selectedReachSubIntervention
        : undefined

    useEffect(() => {
        setSelectedReachSubIntervention(undefined)
    }, [activeReachIntervention])

    const reachData = useMemo(() => {
        const uniqueParticipants = new Map<string, ParticipantMeta>()

        if (activeReachIntervention) {
            visibleAIs
                .filter((a) => {
                    if (getInterventionKey(a) !== activeReachIntervention) {
                        return false
                    }

                    if (
                        hasReachSubInterventions &&
                        activeReachSubIntervention &&
                        getSubInterventionKey(a) !== activeReachSubIntervention
                    ) {
                        return false
                    }

                    return true
                })
                .forEach((a) => {
                    uniqueParticipants.set(
                        a.participantId,
                        participantMetaById[a.participantId] || {
                            id: a.participantId
                        }
                    )
                })
        }

        const countBy = (field: 'sector' | 'gender' | 'province') => {
            const counts: Record<string, number> = {}

            uniqueParticipants.forEach((participant) => {
                const bucket =
                    normalizeText(participant[field]) || 'Not specified'
                counts[bucket] = (counts[bucket] || 0) + 1
            })

            return Object.entries(counts)
                .map(([name, y]) => ({ name, y }))
                .sort((a, b) => b.y - a.y || a.name.localeCompare(b.name))
        }

        return {
            total: uniqueParticipants.size,
            sectors: countBy('sector'),
            genders: countBy('gender'),
            provinces: countBy('province')
        }
    }, [
        activeReachIntervention,
        activeReachSubIntervention,
        hasReachSubInterventions,
        visibleAIs,
        participantMetaById
    ])

    const total = visibleAIs.length

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'coordinator-analytics',
            pageTitle: 'Coordinator Analytics',
            guides: [
                {
                    id: 'coordinator-analytics-overview',
                    title: 'Quick tour',
                    description:
                        'Understand the filters, analytics sections and charts for your assigned interventions.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('coordinator-analytics-filters'),
                            popover: {
                                title: 'Analytics filters',
                                description:
                                    'Filter by SME gender, sector and assignment month. Every analytics view below responds to these filters.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('coordinator-analytics-sections'),
                            popover: {
                                title: 'Analytics sections',
                                description:
                                    'Switch between Interventions, Risk and Reach depending on what you want to analyse.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('coordinator-analytics-content'),
                            waitForElement: 1500,
                            popover: {
                                title: 'Analytics workspace',
                                description:
                                    'The charts here update from the selected filters and analytics section. Empty states explain when no assignments match.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'coordinator-analytics-interventions',
                    title: 'Interventions',
                    description:
                        'Review intervention status and month-on-month delivery activity.',
                    kind: 'task',
                    order: 2,
                    steps: () => {
                        const steps: any[] = [
                            {
                                element: guideTarget('coordinator-analytics-interventions-tab'),
                                advanceOnClick: true,
                                popover: {
                                    title: 'Interventions',
                                    description:
                                        'Open the Interventions view to analyse workflow status and assignment activity over time.',
                                    side: 'bottom',
                                    align: 'center',
                                    showButtons: ['close']
                                }
                            }
                        ]

                        if (total === 0) {
                            steps.push({
                                element: guideTarget('coordinator-analytics-empty'),
                                waitForElement: 3000,
                                popover: {
                                    title: 'No matching interventions',
                                    description:
                                        'No assignments match the current filters. Adjust or clear the filters to populate the intervention charts.',
                                    side: 'top',
                                    align: 'start'
                                }
                            })
                            return steps
                        }

                        steps.push(
                            {
                                element: guideTarget('coordinator-interventions-status'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'Interventions by status',
                                    description:
                                        'This chart shows how the visible assignments are distributed across the current workflow stages.',
                                    side: 'right',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('coordinator-interventions-monthly'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Month-on-month interventions',
                                    description:
                                        'Select a month to drill into workflow status, then select a status to see the affected intervention or sub-intervention.',
                                    side: 'left',
                                    align: 'start'
                                }
                            }
                        )

                        return steps
                    }
                },
                {
                    id: 'coordinator-analytics-risk',
                    title: 'Risk',
                    description:
                        'Identify unresponsive SMEs, bottlenecks, overdue work and sector-level delays.',
                    kind: 'task',
                    order: 3,
                    steps: () => {
                        const steps: any[] = [
                            {
                                element: guideTarget('coordinator-analytics-risk-tab'),
                                advanceOnClick: true,
                                popover: {
                                    title: 'Risk',
                                    description:
                                        'Open Risk to focus on assignments that may need follow-up.',
                                    side: 'bottom',
                                    align: 'center',
                                    showButtons: ['close']
                                }
                            }
                        ]

                        if (total === 0) {
                            steps.push({
                                element: guideTarget('coordinator-analytics-empty'),
                                waitForElement: 3000,
                                popover: {
                                    title: 'No risk data in view',
                                    description:
                                        'There are no assignments matching the current filters, so no risk indicators can be calculated.',
                                    side: 'top',
                                    align: 'start'
                                }
                            })
                            return steps
                        }

                        steps.push(
                            {
                                element: guideTarget('coordinator-risk-unresponsive'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'Top unresponsive SMEs',
                                    description:
                                        'See SMEs with appointments awaiting a response or completed work still waiting for SME confirmation.',
                                    side: 'right',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('coordinator-risk-bottlenecks'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Intervention bottlenecks',
                                    description:
                                        'See where assignments are getting stuck. Select a bottleneck column to drill down to affected interventions and sub-interventions.',
                                    side: 'left',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('coordinator-risk-overdue'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Overdue interventions',
                                    description:
                                        'See open assignments that have remained too long in Assigned or In Delivery stages. Select a column to drill down.',
                                    side: 'right',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('coordinator-risk-sector'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Delays by sector',
                                    description:
                                        'Compare appointment-response delays, SME-confirmation delays and overdue work across SME sectors.',
                                    side: 'left',
                                    align: 'start'
                                }
                            }
                        )

                        return steps
                    }
                },
                {
                    id: 'coordinator-analytics-reach',
                    title: 'Reach',
                    description:
                        'Analyse the unique SMEs reached by an intervention or one of its sub-interventions.',
                    kind: 'task',
                    order: 4,
                    steps: () => {
                        const steps: any[] = [
                            {
                                element: guideTarget('coordinator-analytics-reach-tab'),
                                advanceOnClick: true,
                                popover: {
                                    title: 'Reach',
                                    description:
                                        'Open Reach to analyse the unique SMEs touched by a specific intervention.',
                                    side: 'bottom',
                                    align: 'center',
                                    showButtons: ['close']
                                }
                            }
                        ]

                        if (total === 0) {
                            steps.push({
                                element: guideTarget('coordinator-analytics-empty'),
                                waitForElement: 3000,
                                popover: {
                                    title: 'No reach data in view',
                                    description:
                                        'No assignments match the current filters. Adjust the filters before analysing reach.',
                                    side: 'top',
                                    align: 'start'
                                }
                            })
                            return steps
                        }

                        steps.push({
                            element: guideTarget('coordinator-reach-intervention-selector'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Choose an intervention',
                                description:
                                    'Select the intervention whose reach you want to analyse. Reach is calculated using unique SMEs, not assignment count.',
                                side: 'bottom',
                                align: 'start'
                            }
                        })

                        if (!activeReachIntervention) {
                            steps.push({
                                element: guideTarget('coordinator-reach-empty'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Select an intervention',
                                    description:
                                        'The reach charts appear after you select an intervention above.',
                                    side: 'top',
                                    align: 'start'
                                }
                            })
                            return steps
                        }

                        if (hasReachSubInterventions) {
                            steps.push({
                                element: guideTarget('coordinator-reach-subintervention-selector'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Sub-intervention filter',
                                    description:
                                        'This intervention has sub-interventions. Leave this clear to analyse the whole intervention, or select one sub-intervention to narrow the reach.',
                                    side: 'bottom',
                                    align: 'end'
                                }
                            })
                        }

                        steps.push(
                            {
                                element: guideTarget('coordinator-reach-sector'),
                                waitForElement: 3000,
                                popover: {
                                    title: 'Reach by sector',
                                    description:
                                        'See how the unique SMEs reached by the current intervention selection are distributed across business sectors.',
                                    side: 'right',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('coordinator-reach-gender'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Reach by gender',
                                    description:
                                        'See the gender distribution of the unique SMEs reached by the current intervention selection.',
                                    side: 'left',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('coordinator-reach-province'),
                                waitForElement: 1500,
                                popover: {
                                    title: 'Reach by province',
                                    description:
                                        'See where the reached SMEs are located by province.',
                                    side: 'top',
                                    align: 'start'
                                }
                            }
                        )

                        return steps
                    }
                }
            ]
        }),
        [
            activeReachIntervention,
            activeReachSubIntervention,
            hasReachSubInterventions,
            total
        ]
    )

    usePageGuides(guideRegistration)

    const getDisplayStatus = (a: AI): DisplayStatus => {
        const lifecycle = getAssignmentLifecycle(a)

        switch (lifecycle.key) {
            case 'completed':
                return 'Completed'
            case 'awaiting-participant-acceptance':
                return 'Awaiting Appointment Response'
            case 'in-delivery':
                return 'In Delivery'
            case 'awaiting-participant-confirmation':
                return 'Awaiting SME Confirmation'
            case 'needs-reassignment':
                return 'Coordinator Declined'
            case 'participant-declined':
                return 'Appointment Declined'
            case 'participant-rejected':
                return 'SME Rejected Completion'
            case 'cancelled':
                return 'Cancelled'
            case 'assigned':
            default:
                return 'Assigned'
        }
    }


    const statusCounts = useMemo(() => {
        const c: Record<DisplayStatus, number> = {
            Assigned: 0,
            'Awaiting Appointment Response': 0,
            'In Delivery': 0,
            'Awaiting SME Confirmation': 0,
            Completed: 0,
            'Coordinator Declined': 0,
            'Appointment Declined': 0,
            'SME Rejected Completion': 0,
            Cancelled: 0
        }

        visibleAIs.forEach((a) => {
            const displayStatus = getDisplayStatus(a)
            c[displayStatus] += 1
        })

        return c
    }, [visibleAIs])


    const donutOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 360 },
        title: { text: 'Interventions by Status' },
        credits: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: '62%',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        const y = Number(this.y || 0)
                        return y > 0 ? `${this.name}: ${y}` : null
                    }
                },
                showInLegend: true
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Interventions',
                data: Object.entries(statusCounts)
                    .filter(([, y]) => y > 0)
                    .map(([display, y]) => ({
                        name: display,
                        y,
                        color: DISPLAY_STATUS_COLOR[display]
                    }))
            }
        ]
    }

    const monthSeries = useMemo(() => {
        const byMonth: Record<
            string,
            {
                total: number
                rows: AI[]
                byStatus: Record<string, AI[]>
            }
        > = {}

        // Keep the selected range continuous, including months with zero
        // assignments, so Jan -> Aug always renders the full timeline.
        monthKeysBetween(dateRange?.[0], dateRange?.[1]).forEach((monthKey) => {
            byMonth[monthKey] = { total: 0, rows: [], byStatus: {} }
        })

        visibleAIs.forEach((a) => {
            const assignedDate = getAssignmentDate(a)
            if (!assignedDate) return

            const monthKey = toMonthKey(assignedDate)
            if (!monthKeyIsInRange(monthKey, dateRange)) return

            const status = getDisplayStatus(a)
            if (!byMonth[monthKey]) {
                byMonth[monthKey] = { total: 0, rows: [], byStatus: {} }
            }

            byMonth[monthKey].total += 1
            byMonth[monthKey].rows.push(a)

            if (!byMonth[monthKey].byStatus[status]) {
                byMonth[monthKey].byStatus[status] = []
            }
            byMonth[monthKey].byStatus[status].push(a)
        })

        const months = Object.keys(byMonth).sort()
        const drillSeries: Highcharts.SeriesOptionsType[] = []

        const top: Highcharts.PointOptionsObject[] = months.map((monthKey) => {
            const monthData = byMonth[monthKey]
            const monthDrillId = `month:${monthKey}`

            if (monthData.total > 0) {
                const statusPoints = Object.entries(monthData.byStatus)
                    .filter(([, rows]) => rows.length > 0)
                    .sort((left, right) => right[1].length - left[1].length)
                    .map(([displayStatus, rows]) => {
                        const statusDrillId =
                            `${monthDrillId}:status:${drillIdPart(displayStatus)}`

                        drillSeries.push({
                            id: statusDrillId,
                            name: `${displayStatus} — ${monthLabel(monthKey)}`,
                            type: 'bar',
                            data: aggregateInterventionDrillPoints(rows)
                        } as Highcharts.SeriesBarOptions)

                        return {
                            name: displayStatus,
                            y: rows.length,
                            color: DISPLAY_STATUS_COLOR[displayStatus] ?? '#888',
                            drilldown: statusDrillId
                        } satisfies Highcharts.PointOptionsObject
                    })

                drillSeries.push({
                    id: monthDrillId,
                    name: `Status — ${monthLabel(monthKey)}`,
                    type: 'column',
                    data: statusPoints
                } as Highcharts.SeriesColumnOptions)
            }

            return {
                name: monthLabel(monthKey),
                y: monthData.total,
                drilldown: monthData.total > 0 ? monthDrillId : undefined
            }
        })

        return { top, drills: drillSeries }
    }, [visibleAIs, dateRange])

    const momOptions: Highcharts.Options = {
        chart: { type: 'spline', height: 360 },
        title: { text: 'Month-on-Month Interventions' },
        subtitle: {
            text: 'Month → workflow status → intervention / sub-intervention'
        },
        credits: { enabled: false },
        xAxis: { type: 'category' },
        yAxis: { title: { text: 'Count' } },
        legend: { enabled: false },
        plotOptions: {
            series: {
                borderWidth: 0,
                cursor: 'pointer',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return Number(this.y || 0) > 0 ? this.y : null
                    }
                }
            }
        },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        series: [
            {
                type: 'spline',
                name: 'Interventions',
                color: '#7c3aed',
                lineWidth: 3,
                marker: {
                    enabled: true,
                    radius: 5,
                    fillColor: '#ffffff',
                    lineColor: '#7c3aed',
                    lineWidth: 3
                },
                data: monthSeries.top
            }
        ],
        drilldown: {
            series: monthSeries.drills
        }
    }



    const unresponsiveData = useMemo(() => {
        const map: Record<
            string,
            {
                participantId: string
                name: string
                awaitingAcceptance: number
                awaitingConfirmation: number
                total: number
            }
        > = {}

        visibleAIs.forEach((a) => {
            const userAccepted = isUserAccepted(a)
            const userCompleted = isUserCompleted(a)

            if (userAccepted && userCompleted) return

            const meta = participantMetaById[a.participantId]
            const name =
                meta?.name ||
                a.participantName ||
                a.participantId ||
                'Unknown Participant'

            if (!map[a.participantId]) {
                map[a.participantId] = {
                    participantId: a.participantId,
                    name,
                    awaitingAcceptance: 0,
                    awaitingConfirmation: 0,
                    total: 0
                }
            }

            if (!userAccepted) map[a.participantId].awaitingAcceptance += 1
            else if (!userCompleted)
                map[a.participantId].awaitingConfirmation += 1

            map[a.participantId].total += 1
        })

        return Object.values(map)
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
    }, [visibleAIs, participantMetaById])

    const unresponsiveOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 420 },
        title: { text: 'Top Unresponsive SMEs' },
        subtitle: {
            text: 'SMEs with appointments awaiting a response or completion awaiting confirmation'
        },
        credits: { enabled: false },
        xAxis: {
            categories: unresponsiveData.map((x) => x.name),
            title: { text: null }
        },
        yAxis: {
            min: 0,
            title: { text: 'Interventions', align: 'high' }
        },
        legend: { reversed: true },
        plotOptions: {
            series: {
                stacking: 'normal',
                dataLabels: { enabled: true }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Awaiting Confirmation',
                color: '#dc2626',
                data: unresponsiveData.map((x) => x.awaitingConfirmation)
            },
            {
                type: 'bar',
                name: 'Awaiting Appointment Response',
                color: '#f97316',
                data: unresponsiveData.map((x) => x.awaitingAcceptance)
            }
        ]
    }

    const bottleneckDrilldown = useMemo(() => {
        const stages = [
            'Coordinator Declined',
            'Awaiting Appointment Response',
            'Appointment Declined',
            'Awaiting SME Confirmation',
            'SME Rejected Completion'
        ]

        const byStage: Record<string, AI[]> = Object.fromEntries(
            stages.map((stage) => [stage, []])
        )

        visibleAIs.forEach((a) => {
            const stage = getBottleneckStage(a)
            if (byStage[stage]) {
                byStage[stage].push(a)
            }
        })

        const top = stages.map((stage) => ({
            name: stage,
            y: byStage[stage].length,
            color: {
                'Coordinator Declined': '#991b1b',
                'Awaiting Appointment Response': '#f97316',
                'Appointment Declined': '#ff4d4f',
                'Awaiting SME Confirmation': '#722ed1',
                'SME Rejected Completion': '#cf1322'
            }[stage],
            drilldown:
                byStage[stage].length > 0
                    ? `bottleneck:${drillIdPart(stage)}`
                    : undefined
        } satisfies Highcharts.PointOptionsObject))

        const drills: Highcharts.SeriesBarOptions[] = stages
            .filter((stage) => byStage[stage].length > 0)
            .map((stage) => ({
                id: `bottleneck:${drillIdPart(stage)}`,
                name: `${stage} — Interventions`,
                type: 'bar',
                data: aggregateInterventionDrillPoints(byStage[stage])
            }))

        return { top, drills }
    }, [visibleAIs])

    const bottleneckOptions: Highcharts.Options = {
        chart: { type: 'column', height: 380 },
        title: { text: 'Intervention Bottlenecks' },
        subtitle: {
            text: 'Select a bottleneck to drill down to the affected interventions'
        },
        credits: { enabled: false },
        xAxis: {
            type: 'category',
            crosshair: true
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: 'Count' }
        },
        legend: { enabled: false },
        plotOptions: {
            series: {
                cursor: 'pointer',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return Number(this.y || 0) > 0 ? this.y : null
                    }
                }
            },
            column: {
                borderRadius: 6
            },
            bar: {
                borderRadius: 6
            }
        },
        tooltip: {
            pointFormat: '<b>{point.y}</b>'
        },
        series: [
            {
                type: 'column',
                name: 'Count',
                data: bottleneckDrilldown.top
            }
        ],
        drilldown: {
            series: bottleneckDrilldown.drills
        }
    }

    const overdueDrilldown = useMemo(() => {
        const stages = ['Assigned Overdue', 'In Progress Overdue']
        const byStage: Record<string, AI[]> = Object.fromEntries(
            stages.map((stage) => [stage, []])
        )

        visibleAIs.forEach((a) => {
            const overdue = getOverdueStage(a)
            if (overdue && byStage[overdue]) {
                byStage[overdue].push(a)
            }
        })

        const top = stages.map((stage) => ({
            name: stage,
            y: byStage[stage].length,
            color: '#f5222d',
            drilldown:
                byStage[stage].length > 0
                    ? `overdue:${drillIdPart(stage)}`
                    : undefined
        } satisfies Highcharts.PointOptionsObject))

        const drills: Highcharts.SeriesBarOptions[] = stages
            .filter((stage) => byStage[stage].length > 0)
            .map((stage) => ({
                id: `overdue:${drillIdPart(stage)}`,
                name: `${stage} — Interventions`,
                type: 'bar',
                data: aggregateInterventionDrillPoints(byStage[stage])
            }))

        return { top, drills }
    }, [visibleAIs])

    const overdueOptions: Highcharts.Options = {
        chart: { type: 'column', height: 380 },
        title: { text: 'Overdue Interventions' },
        subtitle: {
            text: 'Select an overdue stage to drill down to the affected interventions'
        },
        credits: { enabled: false },
        xAxis: {
            type: 'category',
            crosshair: true
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: 'Count' }
        },
        legend: { enabled: false },
        plotOptions: {
            series: {
                cursor: 'pointer',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return Number(this.y || 0) > 0 ? this.y : null
                    }
                }
            },
            column: {
                borderRadius: 6
            },
            bar: {
                borderRadius: 6
            }
        },
        tooltip: {
            pointFormat: '<b>{point.y}</b>'
        },
        series: [
            {
                type: 'column',
                name: 'Count',
                data: overdueDrilldown.top
            }
        ],
        drilldown: {
            series: overdueDrilldown.drills
        }
    }

    const sectorBottleneckData = useMemo(() => {
        const bySector: Record<
            string,
            {
                awaitingSmeAcceptance: number
                awaitingSmeConfirmation: number
                overdue: number
            }
        > = {}

        visibleAIs.forEach((a) => {
            const meta = participantMetaById[a.participantId]
            const sector = meta?.sector || 'Unknown'

            if (!bySector[sector]) {
                bySector[sector] = {
                    awaitingSmeAcceptance: 0,
                    awaitingSmeConfirmation: 0,
                    overdue: 0
                }
            }

            const userAccepted = isUserAccepted(a)
            const userCompleted = isUserCompleted(a)
            const overdue = getOverdueStage(a)

            if (!userAccepted) bySector[sector].awaitingSmeAcceptance += 1
            else if (!userCompleted)
                bySector[sector].awaitingSmeConfirmation += 1

            if (overdue) bySector[sector].overdue += 1
        })

        const rows = Object.entries(bySector)
            .map(([sector, stats]) => ({ sector, ...stats }))
            .sort(
                (a, b) =>
                    b.awaitingSmeAcceptance +
                    b.awaitingSmeConfirmation +
                    b.overdue -
                    (a.awaitingSmeAcceptance +
                        a.awaitingSmeConfirmation +
                        a.overdue)
            )
            .slice(0, 8)

        return rows
    }, [visibleAIs, participantMetaById])

    const sectorBottleneckOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 420 },
        title: { text: 'Delays by Sector' },
        credits: { enabled: false },
        xAxis: {
            categories: sectorBottleneckData.map((x) => x.sector),
            title: { text: null }
        },
        yAxis: {
            min: 0,
            title: { text: 'Count' }
        },
        plotOptions: {
            series: {
                stacking: 'normal',
                dataLabels: { enabled: true }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Awaiting Appointment Response',
                color: '#faad14',
                data: sectorBottleneckData.map((x) => x.awaitingSmeAcceptance)
            },
            {
                type: 'bar',
                name: 'Awaiting SME Confirmation',
                color: '#dc2626',
                data: sectorBottleneckData.map((x) => x.awaitingSmeConfirmation)
            },
            {
                type: 'bar',
                name: 'Overdue',
                color: '#f5222d',
                data: sectorBottleneckData.map((x) => x.overdue)
            }
        ]
    }

    const reachSectorOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 380 },
        title: { text: 'SMEs Reached by Sector' },
        subtitle: { text: `${reachData.total} unique SMEs reached` },
        credits: { enabled: false },
        xAxis: {
            categories: reachData.sectors.map((item) => item.name),
            title: { text: null }
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: 'SMEs' }
        },
        legend: { enabled: false },
        plotOptions: {
            bar: {
                borderRadius: 6,
                dataLabels: { enabled: true }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'SMEs',
                color: '#7c3aed',
                data: reachData.sectors.map((item) => item.y)
            }
        ]
    }

    const reachGenderOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 380 },
        title: { text: 'SMEs Reached by Gender' },
        subtitle: { text: `${reachData.total} unique SMEs reached` },
        credits: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: '58%',
                showInLegend: true,
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}'
                }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'SMEs',
                data: reachData.genders.map((item) => ({
                    ...item,
                    color:
                        GENDER_COLOR[item.name.trim().toLowerCase()] ||
                        '#0d9488'
                }))
            }
        ]
    }

    const reachProvinceOptions: Highcharts.Options = {
        chart: { type: 'column', height: 380 },
        title: { text: 'SMEs Reached by Province' },
        subtitle: { text: `${reachData.total} unique SMEs reached` },
        credits: { enabled: false },
        xAxis: {
            categories: reachData.provinces.map((item) => item.name),
            crosshair: true
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: { text: 'SMEs' }
        },
        legend: { enabled: false },
        plotOptions: {
            column: {
                borderRadius: 6,
                dataLabels: { enabled: true }
            }
        },
        series: [
            {
                type: 'column',
                name: 'SMEs',
                color: '#0891b2',
                data: reachData.provinces.map((item) => item.y)
            }
        ]
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Coordinator Analytics | Smart Incubation</title>
            </Helmet>

            {loading ? (
                <div
                    style={{
                        display: 'flex',
                        height: '100vh',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    <LoadingOverlay tip="Loading analytics..." />
                </div>
            ) : (
                <>
                    <MotionCard filterBar={<Row
                        data-guide="coordinator-analytics-filters"
                        gutter={[16, 16]}
                        align="middle"
                    >
                        <Col xs={24} sm={12} xl={4}>
                            <Select
                                allowClear
                                placeholder="All genders"
                                style={{ width: '100%' }}
                                value={genderFilter}
                                onChange={setGenderFilter}
                            >
                                {genderOptions.map((g) => (
                                    <Option key={g} value={g}>
                                        {g}
                                    </Option>
                                ))}
                            </Select>
                        </Col>

                        <Col xs={24} sm={12} xl={6}>
                            <Select
                                allowClear
                                placeholder="All sectors"
                                style={{ width: '100%' }}
                                value={sectorFilter}
                                onChange={setSectorFilter}
                            >
                                {sectorOptions.map((s) => (
                                    <Option key={s} value={s}>
                                        {s}
                                    </Option>
                                ))}
                            </Select>
                        </Col>

                        <Col xs={24} sm={12} xl={6}>
                            <RangePicker
                                style={{ width: '100%' }}
                                value={dateRange}
                                onChange={(value) => {
                                    if (!value) {
                                        setDateRange(null)
                                        return
                                    }

                                    const [start, end] = value

                                    setDateRange([
                                        start ? start.startOf('month') : null,
                                        end ? end.endOf('month') : null
                                    ])
                                }}
                                allowEmpty={[true, true]}
                                picker="month"
                            />
                        </Col>

                        <Col xs={24} sm={12} xl={8}>
                            <div data-guide="coordinator-analytics-sections">
                                <Segmented
                                    block
                                    options={[
                                        {
                                            label: (
                                                <span data-guide="coordinator-analytics-interventions-tab">
                                                    Interventions
                                                </span>
                                            ),
                                            value: 'interventions'
                                        },
                                        {
                                            label: (
                                                <span data-guide="coordinator-analytics-risk-tab">
                                                    Risk
                                                </span>
                                            ),
                                            value: 'risk'
                                        },
                                        {
                                            label: (
                                                <span data-guide="coordinator-analytics-reach-tab">
                                                    Reach
                                                </span>
                                            ),
                                            value: 'reach'
                                        }
                                    ]}
                                    value={chartGroup}
                                    onChange={(value) =>
                                        setChartGroup(
                                            value as
                                            | 'interventions'
                                            | 'risk'
                                            | 'reach'
                                        )
                                    }
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </Col>
                    </Row>
                    }
                        filterBarProps={{ marginBottom: 0 }}
                        style={{ marginBottom: 15, width: '100%' }}>
                    </MotionCard>

                    <div data-guide="coordinator-analytics-content">
                        {total === 0 ? (
                            <Card
                                data-guide="coordinator-analytics-empty"
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.08)',
                                    borderRadius: 12,
                                    border: '1px solid #e5e7eb'
                                }}
                            >
                                <Result
                                    status="info"
                                    title={
                                        assigned.length === 0
                                            ? 'No interventions to analyse yet'
                                            : 'No matching interventions'
                                    }
                                    subTitle={
                                        assigned.length === 0
                                            ? 'Intervention analytics will appear here once interventions are assigned.'
                                            : 'No interventions match the selected filters. Change the filters or clear them to see all results.'
                                    }
                                    extra={
                                        assigned.length > 0 ? (
                                            <Button
                                                type="primary"
                                                onClick={() => {
                                                    setGenderFilter(undefined)
                                                    setSectorFilter(undefined)
                                                    setDateRange(null)
                                                }}
                                            >
                                                Clear filters
                                            </Button>
                                        ) : undefined
                                    }
                                />
                            </Card>
                        ) : chartGroup === 'interventions' ? (
                            <Row gutter={[24, 24]}>
                                <Col xs={24} lg={10}>
                                    <Card
                                        data-guide="coordinator-interventions-status"
                                        style={{
                                            boxShadow:
                                                '0 12px 32px rgba(0,0,0,0.12)',
                                            borderRadius: 12,
                                            border: '1px solid #d6e4ff'
                                        }}
                                    >
                                        <HighchartsReact
                                            key="interventions-status"
                                            highcharts={Highcharts}
                                            options={donutOptions}
                                            immutable
                                        />
                                    </Card>
                                </Col>

                                <Col xs={24} lg={14}>
                                    <Card
                                        data-guide="coordinator-interventions-monthly"
                                        style={{
                                            boxShadow:
                                                '0 12px 32px rgba(0,0,0,0.12)',
                                            borderRadius: 12,
                                            border: '1px solid #d6e4ff'
                                        }}
                                    >
                                        <HighchartsReact
                                            key="interventions-monthly"
                                            highcharts={Highcharts}
                                            options={momOptions}
                                        />
                                    </Card>
                                </Col>

                            </Row>
                        ) : chartGroup === 'risk' ? (
                            <Row gutter={[24, 24]}>
                                <Col xs={24} lg={12}>
                                    <Card
                                        data-guide="coordinator-risk-unresponsive"
                                        style={{
                                            boxShadow:
                                                '0 12px 32px rgba(127,29,29,0.14)',
                                            borderRadius: 12,
                                            border: '1px solid #fecaca'
                                        }}
                                    >
                                        <HighchartsReact
                                            key="risk-unresponsive"
                                            highcharts={Highcharts}
                                            options={unresponsiveOptions}
                                        />
                                    </Card>
                                </Col>

                                <Col xs={24} lg={12}>
                                    <Card
                                        data-guide="coordinator-risk-bottlenecks"
                                        style={{
                                            boxShadow:
                                                '0 12px 32px rgba(127,29,29,0.14)',
                                            borderRadius: 12,
                                            border: '1px solid #fecaca'
                                        }}
                                    >
                                        <HighchartsReact
                                            key="risk-bottlenecks"
                                            highcharts={Highcharts}
                                            options={bottleneckOptions}
                                        />
                                    </Card>
                                </Col>

                                <Col xs={24} lg={12}>
                                    <Card
                                        data-guide="coordinator-risk-overdue"
                                        style={{
                                            boxShadow:
                                                '0 12px 32px rgba(127,29,29,0.14)',
                                            borderRadius: 12,
                                            border: '1px solid #fecaca'
                                        }}
                                    >
                                        <HighchartsReact
                                            key="risk-overdue"
                                            highcharts={Highcharts}
                                            options={overdueOptions}
                                        />
                                    </Card>
                                </Col>

                                <Col xs={24} lg={12}>
                                    <Card
                                        data-guide="coordinator-risk-sector"
                                        style={{
                                            boxShadow:
                                                '0 12px 32px rgba(127,29,29,0.14)',
                                            borderRadius: 12,
                                            border: '1px solid #fecaca'
                                        }}
                                    >
                                        <HighchartsReact
                                            key="risk-sector-delays"
                                            highcharts={Highcharts}
                                            options={sectorBottleneckOptions}
                                        />
                                    </Card>
                                </Col>
                            </Row>
                        ) : (
                            <>
                                <Card
                                    data-guide="coordinator-reach-selector"
                                    style={{
                                        marginBottom: 24,
                                        boxShadow:
                                            '0 12px 32px rgba(76,29,149,0.10)',
                                        borderRadius: 12,
                                        border: '1px solid #ddd6fe'
                                    }}
                                >
                                    <Row gutter={[16, 16]}>
                                        <Col
                                            xs={24}
                                            md={hasReachSubInterventions ? 12 : 24}
                                        >
                                            <div data-guide="coordinator-reach-intervention-selector">
                                                <Select
                                                    allowClear
                                                    showSearch
                                                    optionFilterProp="label"
                                                    placeholder="Select an intervention"
                                                    options={reachInterventionOptions}
                                                    value={activeReachIntervention}
                                                    onChange={(value) => {
                                                        setSelectedReachIntervention(value)
                                                        setSelectedReachSubIntervention(undefined)
                                                    }}
                                                    style={{ width: '100%' }}
                                                />
                                            </div>
                                        </Col>

                                        {hasReachSubInterventions ? (
                                            <Col xs={24} md={12}>
                                                <div data-guide="coordinator-reach-subintervention-selector">
                                                    <Select
                                                        allowClear
                                                        showSearch
                                                        optionFilterProp="label"
                                                        placeholder="All sub-interventions"
                                                        options={reachSubInterventionOptions}
                                                        value={activeReachSubIntervention}
                                                        onChange={setSelectedReachSubIntervention}
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                            </Col>
                                        ) : null}
                                    </Row>
                                </Card>

                                {!activeReachIntervention ? (
                                    <Card
                                        data-guide="coordinator-reach-empty"
                                        style={{
                                            borderRadius: 12,
                                            border: '1px solid #e5e7eb'
                                        }}
                                    >
                                        <Result
                                            status="info"
                                            title="Select an intervention"
                                            subTitle="Choose an intervention above to see the sectors, genders and provinces of the SMEs it reached."
                                        />
                                    </Card>
                                ) : (
                                    <Row gutter={[24, 24]}>
                                        <Col xs={24} lg={12}>
                                            <Card
                                                data-guide="coordinator-reach-sector"
                                                style={{
                                                    borderRadius: 12,
                                                    border: '1px solid #ddd6fe'
                                                }}
                                            >
                                                <HighchartsReact
                                                    key="reach-sectors"
                                                    highcharts={Highcharts}
                                                    options={reachSectorOptions}
                                                />
                                            </Card>
                                        </Col>

                                        <Col xs={24} lg={12}>
                                            <Card
                                                data-guide="coordinator-reach-gender"
                                                style={{
                                                    borderRadius: 12,
                                                    border: '1px solid #fbcfe8'
                                                }}
                                            >
                                                <HighchartsReact
                                                    key="reach-genders"
                                                    highcharts={Highcharts}
                                                    options={reachGenderOptions}
                                                />
                                            </Card>
                                        </Col>

                                        <Col xs={24}>
                                            <Card
                                                data-guide="coordinator-reach-province"
                                                style={{
                                                    borderRadius: 12,
                                                    border: '1px solid #a5f3fc'
                                                }}
                                            >
                                                <HighchartsReact
                                                    key="reach-provinces"
                                                    highcharts={Highcharts}
                                                    options={reachProvinceOptions}
                                                />
                                            </Card>
                                        </Col>
                                    </Row>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
