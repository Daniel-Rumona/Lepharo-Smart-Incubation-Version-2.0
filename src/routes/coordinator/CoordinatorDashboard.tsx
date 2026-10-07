import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    List,
    Col,
    Button,
    Tag,
    Table,
    Space,
    Empty,
    Result,
    Skeleton,
    Progress,
    Modal,
    Rate,
    Typography
} from 'antd'
import {
    MessageOutlined,
    BarChartOutlined,
    CheckCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import {
    collection,
    getDocs,
    doc,
    query,
    where,
    getDoc
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'

import { workflowQueryService } from '@/services/workflowQueryService'
import {
    dedupeAssignedInterventionViews,
    getAssignedInterventionLifecycle,
    toAssignedInterventionView
} from '@/services/assignedInterventionService'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    fetchAppointments,
    resolveAppointmentActor
} from '@/services/appointmentService'
import ResolveQueryModal from '@/components/modals/ResolveQueryModal'
import InterventionCompletionModal, {
    type InterventionCompletionTarget
} from '@/components/interventions/InterventionCompletionModal'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'

const { Text } = Typography

const HealthGauge = ({ percent }: { percent: number }) => {
    const color =
        percent >= 75 ? '#52c41a' : percent >= 50 ? '#faad14' : '#ff4d4f'

    const arcLength = Math.PI * 80

    return (
        <div style={{ width: 200, textAlign: 'center' }}>
            <svg viewBox='0 0 200 110' width='100%'>
                <path
                    d='M 20 100 A 80 80 0 0 1 180 100'
                    fill='none'
                    stroke='#f0f0f0'
                    strokeWidth={16}
                    strokeLinecap='round'
                />

                <path
                    d='M 20 100 A 80 80 0 0 1 180 100'
                    fill='none'
                    stroke={color}
                    strokeWidth={16}
                    strokeLinecap='round'
                    strokeDasharray={`${(arcLength * percent) / 100} ${arcLength}`}
                />

                <text
                    x='100'
                    y='92'
                    textAnchor='middle'
                    fontSize='30'
                    fontWeight='600'
                    fill={color}
                >
                    {percent}%
                </text>
            </svg>

            <Text type='secondary'>Health</Text>
        </div>
    )
}

type ReadyForCompletion = {
    key: string
    assignmentIds: string[]
    beneficiaryNames: string[]
    interventionTitle: string
    sessionsCompleted: number
    plannedSessions: number
}

/*
 * Mirrors the Assigned-to-me rule: progress has reached 100%, the
 * intervention is not yet completed, and the facilitator has not
 * already submitted completion.
 */
const getRowProgress = (
    row: Intervention
) => {
    const raw = row.raw || {}

    const planned = Math.max(
        1,
        Number(raw.plannedSessions) || 1
    )

    const sessionProgress =
        (Number(
            raw.tracking?.sessionsLogged || 0
        ) /
            planned) *
        100

    const computed = Number(
        raw.computedProgress
    )

    const history = Math.max(
        0,
        ...(raw.progressUpdates || []).map(
            (update: any) =>
                Number(
                    update?.computedProgress || 0
                )
        )
    )

    const progress = Math.min(
        100,
        Math.max(
            Number.isFinite(computed)
                ? computed
                : 0,
            sessionProgress,
            history
        )
    )

    return ['pending', 'deferred'].includes(
        String(raw.completionStatus || '')
    )
        ? Math.min(progress, 99)
        : progress
}

const isReadyForCompletion = (
    row: Intervention
) => {
    const raw = row.raw || {}

    const facilitatorDone =
        String(
            raw.assigneeCompletionStatus || ''
        ).toLowerCase() === 'completed' ||
        String(
            raw.assignmentStatus || ''
        ).toLowerCase() === 'completed'

    return (
        ![
            'completed',
            'declined',
            'cancelled',
            'needs-reassignment'
        ].includes(
            String(row.lifecycle || '')
        ) &&
        !facilitatorDone &&
        getRowProgress(row) >= 100
    )
}

const CoordinatorDashboardSkeleton = () => (
    <Row gutter={[16, 16]}>
        {[1, 2, 3].map(item => (
            <Col
                xs={24}
                sm={12}
                lg={8}
                key={item}
            >
                <MotionCard>
                    <Skeleton
                        active
                        title={{ width: '55%' }}
                        paragraph={{ rows: 2 }}
                    />
                </MotionCard>
            </Col>
        ))}

        <Col xs={24}>
            <MotionCard>
                <Skeleton
                    active
                    paragraph={{ rows: 4 }}
                />
            </MotionCard>
        </Col>

        <Col xs={24} lg={10}>
            <MotionCard>
                <Skeleton
                    active
                    paragraph={{ rows: 6 }}
                />
            </MotionCard>
        </Col>

        <Col xs={24} lg={14}>
            <MotionCard>
                <Skeleton
                    active
                    paragraph={{ rows: 6 }}
                />
            </MotionCard>
        </Col>
    </Row>
)

type IdentityMatch = {
    docId: string
    data: Record<string, any>
}

interface Intervention {
    id: string

    participantId?: string
    interventionId?: string

    subInterventionId?: string | null
    subInterventionTitle?: string | null

    beneficiaryName: string
    intervention: string

    sector: string
    stage: string
    location: string

    status: string
    declineReason: string

    assignedAt?: Date | null

    participantCompletionStatus?:
    | 'pending'
    | 'confirmed'
    | 'rejected'

    lifecycle?: ReturnType<
        typeof getAssignedInterventionLifecycle
    >

    raw?: Record<string, any>
}

interface CQ {
    id: string

    assignedInterventionId?: string | null

    interventionId?: string
    interventionTitle?: string

    subInterventionId?: string | null
    subInterventionTitle?: string | null

    participantId?: string
    beneficiaryName?: string

    queryType?: string
    queryMessage?: string

    raisedAt?: Date

    status?:
    | 'open'
    | 'resolved'

    raisedByDept?: string

    resolutionNotes?: string
    uploadedFileUrl?: string

    targetType?: string | null

    target?: {
        type?: string | null
        id?: string | null

        parentType?: string | null
        parentId?: string | null
    } | null

    movId?: string | null
    movRowId?: string | null

    programId?: string
}

type AssignmentContext = {
    id: string

    participantId?: string
    interventionId?: string

    subInterventionId?: string | null
    subInterventionTitle?: string | null

    beneficiaryName?: string
    interventionTitle?: string
}

const QUERY_TYPE_LABELS: Record<string, string> = {
    'completion-rejection':
        'Completion Rejection',

    'completion-rejected':
        'Completion Rejection',

    'mov-request':
        'Request for Means of Verification (MOV)',

    'mov-issue':
        'MOV Issue',

    'poe-request':
        'Proof of Expenditure (POE)',

    'general-query':
        'General Query'
}

const getQueryLabel = (
    type?: string
) => {
    if (!type) {
        return 'Query'
    }

    return (
        QUERY_TYPE_LABELS[type] ||
        type
            .replace(/-/g, ' ')
            .replace(
                /\b\w/g,
                character =>
                    character.toUpperCase()
            )
    )
}

const parseAssignedAt = (
    value: any
): Date | null => {
    if (!value) {
        return null
    }

    if (
        typeof value?.toDate ===
        'function'
    ) {
        return value.toDate()
    }

    if (
        typeof value?.seconds ===
        'number'
    ) {
        return new Date(
            value.seconds * 1000
        )
    }

    const parsed =
        dayjs(value)

    return parsed.isValid()
        ? parsed.toDate()
        : null
}

const queryRaisedAt = (
    queryRecord: any
): Date | undefined => {
    const created =
        queryRecord.createdAt?.toDate?.()

    if (created) {
        return created
    }

    const updated =
        queryRecord.updatedAt?.toDate?.()

    if (updated) {
        return updated
    }

    if (
        typeof queryRecord.createdAt?.seconds ===
        'number'
    ) {
        return new Date(
            queryRecord.createdAt.seconds *
            1000
        )
    }

    if (
        typeof queryRecord.updatedAt?.seconds ===
        'number'
    ) {
        return new Date(
            queryRecord.updatedAt.seconds *
            1000
        )
    }

    return undefined
}

const findIdentityRecord = async (
    collectionName:
        | 'coordinators'
        | 'users',
    uid: string,
    email: string
): Promise<IdentityMatch | null> => {
    const directSnap =
        await getDoc(
            doc(
                db,
                collectionName,
                uid
            )
        )

    if (directSnap.exists()) {
        return {
            docId:
                directSnap.id,

            data:
                directSnap.data()
        }
    }

    const uidSnap =
        await getDocs(
            query(
                collection(
                    db,
                    collectionName
                ),
                where(
                    'uid',
                    '==',
                    uid
                )
            )
        )

    if (!uidSnap.empty) {
        const matchedDoc =
            uidSnap.docs[0]

        return {
            docId:
                matchedDoc.id,

            data:
                matchedDoc.data()
        }
    }

    if (email) {
        const emailSnap =
            await getDocs(
                query(
                    collection(
                        db,
                        collectionName
                    ),
                    where(
                        'email',
                        '==',
                        email
                    )
                )
            )

        if (!emailSnap.empty) {
            const matchedDoc =
                emailSnap.docs[0]

            return {
                docId:
                    matchedDoc.id,

                data:
                    matchedDoc.data()
            }
        }
    }

    return null
}

const getDashboardQueryMovId = (
    queryRecord: CQ
): string => {
    if (queryRecord.movId) {
        return String(
            queryRecord.movId
        )
    }

    if (queryRecord.movRowId) {
        return String(
            queryRecord.movRowId
        )
    }

    if (
        queryRecord.targetType ===
        'mov' &&
        queryRecord.target?.id
    ) {
        return String(
            queryRecord.target.id
        )
    }

    if (
        queryRecord.target
            ?.parentType ===
        'mov' &&
        queryRecord.target
            ?.parentId
    ) {
        return String(
            queryRecord.target
                .parentId
        )
    }

    return ''
}

const getAssignmentPairKey = (
    participantId?: string | null,
    interventionId?: string | null
) => {
    const participant =
        String(
            participantId || ''
        ).trim()

    const intervention =
        String(
            interventionId || ''
        ).trim()

    if (
        !participant ||
        !intervention
    ) {
        return ''
    }

    return `${participant}::${intervention}`
}

const hydrateDashboardQueryContext =
    async (
        queryRecords: CQ[],
        interventionRows:
            Intervention[]
    ): Promise<CQ[]> => {
        if (!queryRecords.length) {
            return []
        }

        const participantNames =
            new Map<string, string>()

        const interventionNames =
            new Map<string, string>()

        const assignmentById =
            new Map<
                string,
                AssignmentContext
            >()

        const assignmentByPair =
            new Map<
                string,
                AssignmentContext
            >()

        interventionRows.forEach(
            row => {
                if (
                    row.participantId &&
                    row.beneficiaryName &&
                    row.beneficiaryName !==
                    '—'
                ) {
                    participantNames.set(
                        row.participantId,
                        row.beneficiaryName
                    )
                }

                if (
                    row.interventionId &&
                    row.intervention &&
                    row.intervention !==
                    '—'
                ) {
                    interventionNames.set(
                        row.interventionId,
                        row.intervention
                    )
                }

                const context:
                    AssignmentContext =
                {
                    id:
                        row.id,

                    participantId:
                        row.participantId,

                    interventionId:
                        row.interventionId,

                    subInterventionId:
                        row.subInterventionId ||
                        null,

                    subInterventionTitle:
                        row.subInterventionTitle ||
                        null,

                    beneficiaryName:
                        row.beneficiaryName,

                    interventionTitle:
                        row.intervention
                }

                assignmentById.set(
                    row.id,
                    context
                )

                const pairKey =
                    getAssignmentPairKey(
                        row.participantId,
                        row.interventionId
                    )

                if (pairKey) {
                    assignmentByPair.set(
                        pairKey,
                        context
                    )
                }
            }
        )

        const missingAssignmentIds =
            Array.from(
                new Set(
                    queryRecords
                        .map(
                            queryRecord =>
                                String(
                                    queryRecord.assignedInterventionId ||
                                    ''
                                ).trim()
                        )
                        .filter(
                            assignmentId =>
                                assignmentId &&
                                !assignmentById.has(
                                    assignmentId
                                )
                        )
                )
            )

        await Promise.all(
            missingAssignmentIds.map(
                async assignmentId => {
                    try {
                        const assignmentSnap =
                            await getDoc(
                                doc(
                                    db,
                                    'assignedInterventions',
                                    assignmentId
                                )
                            )

                        if (
                            !assignmentSnap.exists()
                        ) {
                            return
                        }

                        const data =
                            assignmentSnap.data() as any

                        const context:
                            AssignmentContext =
                        {
                            id:
                                assignmentSnap.id,

                            participantId:
                                data.participantId ||
                                '',

                            interventionId:
                                data.interventionId ||
                                '',

                            subInterventionId:
                                data.subInterventionId ||
                                null,

                            subInterventionTitle:
                                data.subInterventionTitle ||
                                data.subInterventionName ||
                                null,

                            beneficiaryName:
                                data.participantName ||
                                data.beneficiaryName ||
                                '',

                            interventionTitle:
                                data.interventionTitle ||
                                ''
                        }

                        assignmentById.set(
                            assignmentId,
                            context
                        )

                        const pairKey =
                            getAssignmentPairKey(
                                context.participantId,
                                context.interventionId
                            )

                        if (pairKey) {
                            assignmentByPair.set(
                                pairKey,
                                context
                            )
                        }

                        if (
                            context.participantId &&
                            context.beneficiaryName
                        ) {
                            participantNames.set(
                                context.participantId,
                                context.beneficiaryName
                            )
                        }

                        if (
                            context.interventionId &&
                            context.interventionTitle
                        ) {
                            interventionNames.set(
                                context.interventionId,
                                context.interventionTitle
                            )
                        }
                    } catch (error) {
                        console.warn(
                            `Could not resolve assigned intervention ${assignmentId}`,
                            error
                        )
                    }
                }
            )
        )

        const movIds =
            Array.from(
                new Set(
                    queryRecords
                        .map(
                            getDashboardQueryMovId
                        )
                        .filter(Boolean)
                )
            )

        const movById =
            new Map<string, any>()

        await Promise.all(
            movIds.map(
                async movId => {
                    try {
                        const movSnap =
                            await getDoc(
                                doc(
                                    db,
                                    'movDocuments',
                                    movId
                                )
                            )

                        if (
                            movSnap.exists()
                        ) {
                            movById.set(
                                movId,
                                {
                                    id:
                                        movSnap.id,

                                    ...movSnap.data()
                                }
                            )
                        }
                    } catch (error) {
                        console.warn(
                            `Could not resolve MOV ${movId} for dashboard query`,
                            error
                        )
                    }
                }
            )
        )

        const participantIds =
            new Set<string>()

        const interventionIds =
            new Set<string>()

        queryRecords.forEach(
            queryRecord => {
                const mov =
                    movById.get(
                        getDashboardQueryMovId(
                            queryRecord
                        )
                    )

                const directAssignment =
                    queryRecord.assignedInterventionId
                        ? assignmentById.get(
                            String(
                                queryRecord.assignedInterventionId
                            )
                        )
                        : undefined

                const participantId =
                    String(
                        queryRecord.participantId ||
                        directAssignment
                            ?.participantId ||
                        mov?.beneficiaryId ||
                        mov?.participantId ||
                        mov?.smmeId ||
                        ''
                    ).trim()

                const interventionId =
                    String(
                        queryRecord.interventionId ||
                        directAssignment
                            ?.interventionId ||
                        mov?.interventionId ||
                        ''
                    ).trim()

                if (participantId) {
                    participantIds.add(
                        participantId
                    )

                    if (
                        !participantNames.has(
                            participantId
                        )
                    ) {
                        const name =
                            String(
                                directAssignment
                                    ?.beneficiaryName ||
                                mov?.smmeCompanyName ||
                                mov?.smmeName ||
                                mov?.beneficiaryName ||
                                mov?.snapshot
                                    ?.beneficiaryName ||
                                mov?.participantName ||
                                ''
                            ).trim()

                        if (name) {
                            participantNames.set(
                                participantId,
                                name
                            )
                        }
                    }
                }

                if (interventionId) {
                    interventionIds.add(
                        interventionId
                    )

                    if (
                        !interventionNames.has(
                            interventionId
                        )
                    ) {
                        const title =
                            String(
                                queryRecord.interventionTitle ||
                                directAssignment
                                    ?.interventionTitle ||
                                mov?.interventionTitle ||
                                mov?.snapshot
                                    ?.interventionTitle ||
                                ''
                            ).trim()

                        if (title) {
                            interventionNames.set(
                                interventionId,
                                title
                            )
                        }
                    }
                }
            }
        )

        await Promise.all(
            Array.from(
                participantIds
            )
                .filter(
                    participantId =>
                        !participantNames.has(
                            participantId
                        )
                )
                .map(
                    async participantId => {
                        try {
                            const participantSnap =
                                await getDoc(
                                    doc(
                                        db,
                                        'participants',
                                        participantId
                                    )
                                )

                            if (
                                !participantSnap.exists()
                            ) {
                                return
                            }

                            const participant =
                                participantSnap.data()

                            const name =
                                String(
                                    participant.beneficiaryName ||
                                    participant.companyName ||
                                    participant.businessName ||
                                    participant.participantName ||
                                    participant.name ||
                                    ''
                                ).trim()

                            if (name) {
                                participantNames.set(
                                    participantId,
                                    name
                                )
                            }
                        } catch (error) {
                            console.warn(
                                `Could not resolve participant ${participantId}`,
                                error
                            )
                        }
                    }
                )
        )

        await Promise.all(
            Array.from(
                interventionIds
            )
                .filter(
                    interventionId =>
                        !interventionNames.has(
                            interventionId
                        )
                )
                .map(
                    async interventionId => {
                        try {
                            const interventionSnap =
                                await getDoc(
                                    doc(
                                        db,
                                        'interventions',
                                        interventionId
                                    )
                                )

                            if (
                                !interventionSnap.exists()
                            ) {
                                return
                            }

                            const intervention =
                                interventionSnap.data()

                            const title =
                                String(
                                    intervention.interventionTitle ||
                                    intervention.title ||
                                    ''
                                ).trim()

                            if (title) {
                                interventionNames.set(
                                    interventionId,
                                    title
                                )
                            }
                        } catch (error) {
                            console.warn(
                                `Could not resolve intervention ${interventionId}`,
                                error
                            )
                        }
                    }
                )
        )

        return queryRecords.map(
            queryRecord => {
                const mov =
                    movById.get(
                        getDashboardQueryMovId(
                            queryRecord
                        )
                    )

                const directAssignment =
                    queryRecord.assignedInterventionId
                        ? assignmentById.get(
                            String(
                                queryRecord.assignedInterventionId
                            )
                        )
                        : undefined

                const participantId =
                    String(
                        queryRecord.participantId ||
                        directAssignment
                            ?.participantId ||
                        mov?.beneficiaryId ||
                        mov?.participantId ||
                        mov?.smmeId ||
                        ''
                    ).trim()

                const interventionId =
                    String(
                        queryRecord.interventionId ||
                        directAssignment
                            ?.interventionId ||
                        mov?.interventionId ||
                        ''
                    ).trim()

                const pairAssignment =
                    assignmentByPair.get(
                        getAssignmentPairKey(
                            participantId,
                            interventionId
                        )
                    )

                const assignmentContext =
                    directAssignment ||
                    pairAssignment

                const beneficiaryName =
                    queryRecord.beneficiaryName ||
                    assignmentContext
                        ?.beneficiaryName ||
                    (
                        participantId
                            ? participantNames.get(
                                participantId
                            )
                            : ''
                    ) ||
                    String(
                        mov?.smmeCompanyName ||
                        mov?.smmeName ||
                        mov?.beneficiaryName ||
                        mov?.snapshot
                            ?.beneficiaryName ||
                        mov?.participantName ||
                        ''
                    ).trim() ||
                    '—'

                const interventionTitle =
                    queryRecord.interventionTitle ||
                    assignmentContext
                        ?.interventionTitle ||
                    (
                        interventionId
                            ? interventionNames.get(
                                interventionId
                            )
                            : ''
                    ) ||
                    mov?.interventionTitle ||
                    mov?.snapshot
                        ?.interventionTitle ||
                    '—'

                const subInterventionId =
                    queryRecord.subInterventionId ||
                    mov?.subInterventionId ||
                    assignmentContext
                        ?.subInterventionId ||
                    null

                const subInterventionTitle =
                    queryRecord.subInterventionTitle ||
                    mov?.subInterventionTitle ||
                    mov?.subInterventionName ||
                    assignmentContext
                        ?.subInterventionTitle ||
                    null

                return {
                    ...queryRecord,

                    participantId:
                        participantId ||
                        queryRecord.participantId,

                    interventionId:
                        interventionId ||
                        queryRecord.interventionId,

                    beneficiaryName,

                    interventionTitle,

                    subInterventionId,

                    subInterventionTitle
                }
            }
        )
    }

export const CoordinatorDashboard:
    React.FC = () => {
        const navigate =
            useNavigate()

        const {
            activeProgramId
        } =
            useActiveProgramId()

        const {
            user,
            loading:
            identityLoading
        } =
            useFullIdentity()

        const [
            dashboardReady,
            setDashboardReady
        ] = useState(false)

        const [
            noProgramSelected,
            setNoProgramSelected
        ] = useState(false)

        const [
            allInterventions,
            setAllInterventions
        ] =
            useState<
                Intervention[]
            >([])

        const [
            assigneeId,
            setAssigneeId
        ] =
            useState<
                string | null
            >(null)

        const [
            assigneeProfileDocId,
            setAssigneeProfileDocId
        ] =
            useState<
                string | null
            >(null)

        const [
            identityReady,
            setIdentityReady
        ] = useState(false)

        const [
            identityError,
            setIdentityError
        ] =
            useState<
                string | null
            >(null)

        const [
            appointments,
            setAppointments
        ] =
            useState<
                any[]
            >([])

        const [
            queries,
            setQueries
        ] =
            useState<
                CQ[]
            >([])

        const [
            resolvingDashboardQuery,
            setResolvingDashboardQuery
        ] =
            useState<
                CQ | null
            >(null)

        /*
         * -----------------------------------------------------
         * IDENTITY
         * -----------------------------------------------------
         */
        useEffect(() => {
            const resolveIdentity =
                async () => {
                    setIdentityReady(
                        false
                    )

                    setIdentityError(
                        null
                    )

                    setAssigneeId(
                        null
                    )

                    setAssigneeProfileDocId(
                        null
                    )

                    if (
                        identityLoading
                    ) {
                        return
                    }

                    if (!user) {
                        setIdentityError(
                            'No authenticated user was found.'
                        )

                        setIdentityReady(
                            true
                        )

                        return
                    }

                    try {
                        const uid =
                            String(
                                user.uid ||
                                user.id
                            )

                        const email =
                            String(
                                user.email ||
                                ''
                            )
                                .trim()
                                .toLowerCase()

                        const [
                            coordinatorRecord,
                            userRecord
                        ] =
                            await Promise.all(
                                [
                                    findIdentityRecord(
                                        'coordinators',
                                        uid,
                                        email
                                    ),

                                    findIdentityRecord(
                                        'users',
                                        uid,
                                        email
                                    )
                                ]
                            )

                        const userRole =
                            String(
                                userRecord
                                    ?.data
                                    ?.role ||
                                ''
                            )
                                .trim()
                                .toLowerCase()

                        const canUseUsersFallback =
                            userRole ===
                            'coordinator'

                        if (
                            !coordinatorRecord &&
                            !canUseUsersFallback
                        ) {
                            setIdentityError(
                                'Your account is not linked to a coordinator profile.'
                            )

                            return
                        }

                        const resolvedAssigneeId =
                            coordinatorRecord
                                ?.data
                                ?.id ||
                            coordinatorRecord
                                ?.docId ||
                            (
                                canUseUsersFallback
                                    ? uid
                                    : null
                            )

                        const resolvedProfileDocId =
                            coordinatorRecord
                                ?.docId ||
                            userRecord
                                ?.docId ||
                            uid

                        setAssigneeId(
                            resolvedAssigneeId
                        )

                        setAssigneeProfileDocId(
                            resolvedProfileDocId
                        )
                    } catch (error) {
                        console.error(
                            'Failed to resolve coordinator identity:',
                            error
                        )

                        setIdentityError(
                            'The coordinator profile could not be loaded.'
                        )
                    } finally {
                        setIdentityReady(
                            true
                        )
                    }
                }

            void resolveIdentity()
        }, [
            identityLoading,
            user?.email,
            user?.id,
            user?.uid
        ])

        /*
         * -----------------------------------------------------
         * CORE DATA
         * -----------------------------------------------------
         */
        useEffect(() => {
            const fetchData =
                async () => {
                    if (
                        !identityReady
                    ) {
                        return
                    }

                    if (
                        !assigneeId
                    ) {
                        setDashboardReady(
                            true
                        )

                        return
                    }

                    setNoProgramSelected(
                        false
                    )

                    setDashboardReady(
                        false
                    )

                    try {
                        const getOwnedDocuments =
                            async (
                                collectionName:
                                    | 'assignedInterventions'
                                    | 'appointments',
                                includeProgram =
                                    true
                            ) => {
                                const ownerIds =
                                    Array.from(
                                        new Set(
                                            [
                                                assigneeId,
                                                assigneeProfileDocId
                                            ].filter(
                                                (
                                                    value
                                                ): value is string =>
                                                    Boolean(
                                                        value
                                                    )
                                            )
                                        )
                                    )

                                if (
                                    !ownerIds.length
                                ) {
                                    return []
                                }

                                const requests =
                                    ownerIds.map(
                                        ownerId => {
                                            const constraints:
                                                any[] =
                                                [
                                                    where(
                                                        'assigneeId',
                                                        '==',
                                                        ownerId
                                                    )
                                                ]

                                            if (
                                                includeProgram &&
                                                activeProgramId
                                            ) {
                                                constraints.push(
                                                    where(
                                                        'programId',
                                                        '==',
                                                        activeProgramId
                                                    )
                                                )
                                            }

                                            return getDocs(
                                                query(
                                                    collection(
                                                        db,
                                                        collectionName
                                                    ),
                                                    ...constraints
                                                )
                                            )
                                        }
                                    )

                                const snapshots =
                                    await Promise.all(
                                        requests
                                    )

                                const documents =
                                    new Map<
                                        string,
                                        any
                                    >()

                                snapshots.forEach(
                                    snapshot => {
                                        snapshot.docs.forEach(
                                            documentSnapshot => {
                                                documents.set(
                                                    documentSnapshot.id,
                                                    documentSnapshot
                                                )
                                            }
                                        )
                                    }
                                )

                                return Array.from(
                                    documents.values()
                                )
                            }

                        /*
                         * Assigned interventions.
                         */
                        const assignmentDocs =
                            await getOwnedDocuments(
                                'assignedInterventions'
                            )

                        const canonicalAssignmentDocs =
                            dedupeAssignedInterventionViews(
                                assignmentDocs.map(
                                    docSnap =>
                                        toAssignedInterventionView(
                                            docSnap.id,
                                            docSnap.data()
                                        )
                                )
                            )

                        const all:
                            Intervention[] =
                            await Promise.all(
                                canonicalAssignmentDocs.map(
                                    async data => {
                                        let sector =
                                            'Unknown'

                                        let stage =
                                            'Unknown'

                                        let location =
                                            'Unknown'

                                        let beneficiaryName =
                                            data.participantName ||
                                            '—'

                                        if (
                                            data.participantId
                                        ) {
                                            try {
                                                const participantSnap =
                                                    await getDoc(
                                                        doc(
                                                            db,
                                                            'participants',
                                                            data.participantId
                                                        )
                                                    )

                                                if (
                                                    participantSnap.exists()
                                                ) {
                                                    const participant =
                                                        participantSnap.data() as any

                                                    sector =
                                                        participant.sector ||
                                                        sector

                                                    stage =
                                                        participant.stage ||
                                                        stage

                                                    location =
                                                        participant.location ||
                                                        participant.city ||
                                                        location

                                                    beneficiaryName =
                                                        participant.beneficiaryName ||
                                                        participant.companyName ||
                                                        participant.businessName ||
                                                        data.participantName ||
                                                        beneficiaryName
                                                }
                                            } catch (error) {
                                                console.warn(
                                                    `Could not resolve participant ${data.participantId}`,
                                                    error
                                                )
                                            }
                                        }

                                        return {
                                            id:
                                                data.id,

                                            participantId:
                                                data.participantId ||
                                                '',

                                            interventionId:
                                                data.interventionId ||
                                                '',

                                            subInterventionId:
                                                data.subInterventionId ||
                                                null,

                                            subInterventionTitle:
                                                data.subInterventionTitle ||
                                                data.subInterventionName ||
                                                null,

                                            beneficiaryName,

                                            intervention:
                                                data.interventionTitle ||
                                                '—',

                                            sector,
                                            stage,
                                            location,

                                            status:
                                                data.assignmentStatus ||
                                                'assigned',

                                            lifecycle:
                                                getAssignedInterventionLifecycle(
                                                    data
                                                ),

                                            declineReason:
                                                data.assigneeDeclineReason ||
                                                '',

                                            assignedAt:
                                                parseAssignedAt(
                                                    data.createdAt
                                                ),

                                            participantCompletionStatus:
                                                data.participantCompletionStatus ||
                                                'pending',

                                            raw: data
                                        }
                                    }
                                )
                            )

                        setAllInterventions(
                            all
                        )

                        /*
                         * Upcoming appointments.
                         */
                        const appointmentActor =
                            await resolveAppointmentActor(
                                user
                            )

                        const appointmentRows =
                            await fetchAppointments(
                                {
                                    assigneeIds:
                                        appointmentActor.ids,

                                    assigneeEmail:
                                        appointmentActor.email,

                                    programId:
                                        activeProgramId ||
                                        null
                                }
                            )

                        setAppointments(
                            appointmentRows as any[]
                        )

                        /*
                         * Queries.
                         */
                        if (
                            assigneeProfileDocId
                        ) {
                            const queryDocs =
                                await workflowQueryService.list(
                                    {
                                        resolverIds:
                                            [
                                                assigneeId,
                                                assigneeProfileDocId
                                            ].filter(
                                                (
                                                    value
                                                ): value is string =>
                                                    Boolean(
                                                        value
                                                    )
                                            )
                                    }
                                )

                            const baseQueries =
                                queryDocs
                                    .filter(
                                        queryRecord =>
                                            !activeProgramId ||
                                            !queryRecord.programId ||
                                            queryRecord.programId ===
                                            activeProgramId
                                    )
                                    .map(
                                        queryRecord => ({
                                            ...queryRecord,

                                            raisedAt:
                                                queryRaisedAt(
                                                    queryRecord
                                                )
                                        })
                                    ) as CQ[]

                            const hydratedQueries =
                                await hydrateDashboardQueryContext(
                                    baseQueries,
                                    all
                                )

                            setQueries(
                                hydratedQueries
                            )
                        } else {
                            setQueries(
                                []
                            )
                        }
                    } catch (error) {
                        console.error(
                            'Error fetching dashboard data:',
                            error
                        )
                    } finally {
                        setDashboardReady(
                            true
                        )
                    }
                }

            void fetchData()
        }, [
            identityReady,
            assigneeId,
            assigneeProfileDocId,
            activeProgramId,
            user
        ])

        /*
         * -----------------------------------------------------
         * OPEN QUERIES
         * -----------------------------------------------------
         */
        const [
            completionTarget,
            setCompletionTarget
        ] =
            useState<InterventionCompletionTarget | null>(
                null
            )

        const [
            queriesModalOpen,
            setQueriesModalOpen
        ] = useState(false)

        const readyForCompletion =
            useMemo(() => {
                const groups =
                    new Map<
                        string,
                        ReadyForCompletion
                    >()

                allInterventions
                    .filter(
                        isReadyForCompletion
                    )
                    .forEach(row => {
                        const raw =
                            row.raw || {}

                        const groupKey =
                            raw.groupKey ||
                            raw.groupId ||
                            raw.groupAssignmentId

                        const key = groupKey
                            ? `group:${groupKey}`
                            : `single:${row.id}`

                        const existing =
                            groups.get(key)

                        const logged =
                            Number(
                                raw.tracking
                                    ?.sessionsLogged ||
                                0
                            )

                        if (existing) {
                            existing.assignmentIds.push(
                                row.id
                            )

                            existing.beneficiaryNames.push(
                                row.beneficiaryName
                            )

                            existing.sessionsCompleted =
                                Math.max(
                                    existing.sessionsCompleted,
                                    logged
                                )

                            return
                        }

                        groups.set(key, {
                            key,

                            assignmentIds: [
                                row.id
                            ],

                            beneficiaryNames: [
                                row.beneficiaryName
                            ],

                            interventionTitle:
                                row.subInterventionTitle
                                    ? `${row.intervention} — ${row.subInterventionTitle}`
                                    : row.intervention,

                            sessionsCompleted:
                                logged,

                            plannedSessions:
                                Math.max(
                                    1,
                                    Number(
                                        raw.plannedSessions
                                    ) || 1
                                )
                        })
                    })

                return Array.from(
                    groups.values()
                )
            }, [allInterventions])

        const deriveDeliveryMethod = (
            assignmentIds: string[]
        ) => {
            const ids = new Set(
                assignmentIds
            )

            const methods =
                new Set<string>()

            appointments.forEach(
                (appointment: any) => {
                    if (
                        ids.has(
                            String(
                                appointment.assignedInterventionId ||
                                ''
                            )
                        ) &&
                        !['cancelled', 'postponed'].includes(
                            appointment.status
                        ) &&
                        appointment.deliveryMethod
                    ) {
                        methods.add(
                            appointment.deliveryMethod
                        )
                    }
                }
            )

            if (
                methods.has('in_person') &&
                methods.has('virtual')
            ) {
                return 'hybrid'
            }

            return methods.size === 1
                ? Array.from(methods)[0]
                : undefined
        }

        const ratingSummary =
            useMemo(() => {
                const ratings =
                    allInterventions
                        .map(row =>
                            Number(
                                row.raw?.feedback
                                    ?.rating
                            )
                        )
                        .filter(
                            value =>
                                Number.isFinite(
                                    value
                                ) && value > 0
                        )

                return {
                    count: ratings.length,

                    average:
                        ratings.length
                            ? ratings.reduce(
                                (sum, value) =>
                                    sum + value,
                                0
                            ) / ratings.length
                            : 0
                }
            }, [allInterventions])

        const openQueries =
            useMemo(
                () =>
                    queries.filter(
                        queryRecord =>
                            (
                                queryRecord.status?.toLowerCase?.() ??
                                'open'
                            ) ===
                            'open'
                    ),
                [queries]
            )

        /*
         * -----------------------------------------------------
         * QUERY REFRESH
         * -----------------------------------------------------
         */
        const refetchQueries =
            async () => {
                if (
                    !assigneeProfileDocId
                ) {
                    setQueries(
                        []
                    )

                    return
                }

                try {
                    const queryDocs =
                        await workflowQueryService.list(
                            {
                                resolverIds:
                                    [
                                        assigneeId,
                                        assigneeProfileDocId
                                    ].filter(
                                        (
                                            value
                                        ): value is string =>
                                            Boolean(
                                                value
                                            )
                                    )
                            }
                        )

                    const baseQueries =
                        queryDocs
                            .filter(
                                queryRecord =>
                                    !activeProgramId ||
                                    !queryRecord.programId ||
                                    queryRecord.programId ===
                                    activeProgramId
                            )
                            .map(
                                queryRecord => ({
                                    ...queryRecord,

                                    raisedAt:
                                        queryRaisedAt(
                                            queryRecord
                                        )
                                })
                            ) as CQ[]

                    const hydratedQueries =
                        await hydrateDashboardQueryContext(
                            baseQueries,
                            allInterventions
                        )

                    setQueries(
                        hydratedQueries
                    )
                } catch (error) {
                    console.error(
                        'Failed to refresh queries',
                        error
                    )
                }
            }

        /*
         * -----------------------------------------------------
         * QUERY COLUMNS
         * -----------------------------------------------------
         */
        const queryColumns =
            [
                {
                    title:
                        'SME / Intervention',

                    key:
                        'context',

                    width:
                        330,

                    render:
                        (
                            _:
                                any,
                            record:
                                CQ
                        ) => (
                            <Space
                                direction='vertical'
                                size={3}
                                style={{
                                    width:
                                        '100%',

                                    minWidth:
                                        0
                                }}
                            >
                                <Text
                                    strong
                                    ellipsis={{
                                        tooltip:
                                            record.beneficiaryName ||
                                            '—'
                                    }}
                                >
                                    {record.beneficiaryName ||
                                        '—'}
                                </Text>

                                <Text
                                    type='secondary'
                                    ellipsis={{
                                        tooltip:
                                            record.interventionTitle ||
                                            '—'
                                    }}
                                    style={{
                                        fontSize:
                                            12
                                    }}
                                >
                                    {record.interventionTitle ||
                                        '—'}
                                </Text>

                                {record.subInterventionTitle ? (
                                    <Tag
                                        color='blue'
                                        title={
                                            record.subInterventionTitle
                                        }
                                        style={{
                                            width:
                                                'fit-content',

                                            maxWidth:
                                                '100%',

                                            overflow:
                                                'hidden',

                                            textOverflow:
                                                'ellipsis',

                                            whiteSpace:
                                                'nowrap',

                                            marginInlineEnd:
                                                0,

                                            borderRadius:
                                                999,

                                            fontSize:
                                                11
                                        }}
                                    >
                                        {
                                            record.subInterventionTitle
                                        }
                                    </Tag>
                                ) : null}
                            </Space>
                        )
                },

                {
                    title:
                        'Query',

                    key:
                        'query',

                    width:
                        320,

                    render:
                        (
                            _:
                                any,
                            record:
                                CQ
                        ) => (
                            <Space
                                direction='vertical'
                                size={3}
                                style={{
                                    width:
                                        '100%',

                                    minWidth:
                                        0
                                }}
                            >
                                <Tag
                                    color='orange'
                                    style={{
                                        width:
                                            'fit-content',

                                        marginInlineEnd:
                                            0,

                                        borderRadius:
                                            999
                                    }}
                                >
                                    {getQueryLabel(
                                        record.queryType
                                    )}
                                </Tag>

                                <Text
                                    ellipsis={{
                                        tooltip:
                                            record.queryMessage ||
                                            '—'
                                    }}
                                >
                                    {record.queryMessage ||
                                        '—'}
                                </Text>
                            </Space>
                        )
                },

                {
                    title:
                        'Raised By',

                    dataIndex:
                        'raisedByDept',

                    key:
                        'raisedByDept',

                    width:
                        150,

                    render:
                        (
                            department:
                                string
                        ) => {
                            const value =
                                String(
                                    department ||
                                    ''
                                )
                                    .trim()
                                    .toLowerCase()

                            return value ===
                                'beneficiary'
                                ? 'SME'
                                : department ||
                                'Unknown'
                        }
                },

                {
                    title:
                        'Raised',

                    dataIndex:
                        'raisedAt',

                    key:
                        'raisedAt',

                    width:
                        125,

                    render:
                        (
                            _:
                                any,
                            record:
                                CQ
                        ) =>
                            record.raisedAt
                                ? dayjs(
                                    record.raisedAt
                                ).format(
                                    'DD MMM YYYY'
                                )
                                : '—'
                },

                {
                    title:
                        'Status',

                    dataIndex:
                        'status',

                    key:
                        'status',

                    width:
                        105,

                    render:
                        (
                            status:
                                string
                        ) => {
                            const resolved =
                                String(
                                    status ||
                                    'open'
                                ).toLowerCase() ===
                                'resolved'

                            return (
                                <Tag
                                    color={
                                        resolved
                                            ? 'green'
                                            : 'orange'
                                    }
                                    style={{
                                        borderRadius:
                                            999
                                    }}
                                >
                                    {(
                                        status ||
                                        'open'
                                    ).toUpperCase()}
                                </Tag>
                            )
                        }
                },

                {
                    title:
                        'Action',

                    key:
                        'action',

                    width:
                        100,

                    fixed:
                        'right' as const,

                    render:
                        (
                            _:
                                any,
                            record:
                                CQ
                        ) =>
                            (
                                record.status?.toLowerCase?.() ??
                                'open'
                            ) ===
                                'open' ? (
                                <Button
                                    type='link'
                                    onClick={() =>
                                        setResolvingDashboardQuery(
                                            record
                                        )
                                    }
                                >
                                    Resolve
                                </Button>
                            ) : null
                }
            ]

        /*
         * -----------------------------------------------------
         * METRICS
         * -----------------------------------------------------
         */
        const perfCounts =
            useMemo(() => {
                const normalizedStatus =
                    (
                        intervention:
                            Intervention
                    ) =>
                        String(
                            intervention.status ||
                            ''
                        )
                            .trim()
                            .toLowerCase()
                            .replace(
                                /[\s_]+/g,
                                '-'
                            )

                const inProgress =
                    allInterventions.filter(
                        intervention => {
                            const status =
                                normalizedStatus(
                                    intervention
                                )

                            return (
                                [
                                    'in-progress',
                                    'ongoing',
                                    'active'
                                ].includes(
                                    status
                                ) ||
                                (
                                    intervention.lifecycle ===
                                    'in-progress' &&
                                    ![
                                        'assigned',
                                        'pending'
                                    ].includes(
                                        status
                                    )
                                )
                            )
                        }
                    ).length

                const completed =
                    allInterventions.filter(
                        intervention =>
                            intervention.lifecycle ===
                            'completed'
                    ).length

                const rejectedOrDeclined =
                    allInterventions.filter(
                        intervention =>
                            intervention.participantCompletionStatus ===
                            'rejected' ||
                            intervention.lifecycle ===
                            'declined' ||
                            intervention.lifecycle ===
                            'needs-reassignment'
                    ).length

                return {
                    inProgress,
                    completed,
                    rejectedOrDeclined
                }
            }, [
                allInterventions
            ])

        const totalInterventions = allInterventions.length

        const toPercent = (value: number) =>
            totalInterventions
                ? Math.round((value / totalInterventions) * 100)
                : 0

        /*
         * Health = share of interventions that are not
         * rejected, declined or awaiting reassignment.
         */
        const healthPercent = toPercent(
            totalInterventions - perfCounts.rejectedOrDeclined
        )

        const performanceRows = [
            {
                label: 'Completed',
                value: perfCounts.completed,
                percent: toPercent(perfCounts.completed),
                color: '#52c41a'
            },
            {
                label: 'In Progress',
                value: perfCounts.inProgress,
                percent: toPercent(perfCounts.inProgress),
                color: '#faad14'
            },
            {
                label: 'Rejected/Declined',
                value: perfCounts.rejectedOrDeclined,
                percent: toPercent(perfCounts.rejectedOrDeclined),
                color: '#ff4d4f'
            }
        ]

        /*
         * -----------------------------------------------------
         * RENDER
         * -----------------------------------------------------
         */
        return (
            <div
                style={{
                    padding:
                        24,

                    minHeight:
                        '100vh',

                    width:
                        '100%',

                    maxWidth:
                        '100%',

                    overflowX:
                        'hidden'
                }}
            >
                {!identityReady ? (
                    <CoordinatorDashboardSkeleton />
                ) : identityError ? (
                    <Result
                        status='warning'
                        title='Coordinator profile unavailable'
                        subTitle={
                            identityError
                        }
                    />
                ) : noProgramSelected ? (
                    <div
                        style={{
                            padding:
                                24,

                            minHeight:
                                '60vh',

                            display:
                                'flex',

                            alignItems:
                                'center',

                            justifyContent:
                                'center'
                        }}
                    >
                        <Result
                            status='info'
                            title='No Program Selected'
                            subTitle='Please select a program to view your dashboard data.'
                        />
                    </div>
                ) : !dashboardReady ? (
                    <CoordinatorDashboardSkeleton />
                ) : (
                    <div
                        style={{
                            width:
                                '100%',

                            minWidth:
                                0
                        }}
                    >
                        <Helmet>
                            <title>
                                Coordinator Workspace | Smart Incubation
                            </title>
                        </Helmet>

                        <Row
                            gutter={[
                                16,
                                16
                            ]}
                            style={{
                                width:
                                    '100%',

                                minWidth:
                                    0
                            }}
                        >
                            {/*
                              Metrics
                            */}
                            <Col
                                xs={24}
                                md={6}
                            >
                                <MotionCard.Metric
                                    icon={
                                        <MessageOutlined
                                            style={{
                                                fontSize:
                                                    18,

                                                color:
                                                    '#1677ff'
                                            }}
                                        />
                                    }
                                    iconBg='rgba(22,119,255,0.12)'
                                    title='Total Required'
                                    value={
                                        allInterventions.length
                                    }
                                    subtitle='Required in coordinator scope'
                                />
                            </Col>

                            <Col
                                xs={24}
                                md={6}
                            >
                                <MotionCard.Metric
                                    icon={
                                        <BarChartOutlined
                                            style={{
                                                fontSize:
                                                    18,

                                                color:
                                                    '#13c2c2'
                                            }}
                                        />
                                    }
                                    iconBg='rgba(19,194,194,0.12)'
                                    title='In Progress'
                                    value={
                                        perfCounts.inProgress
                                    }
                                    subtitle='Currently active'
                                />
                            </Col>

                            <Col
                                xs={24}
                                md={6}
                            >
                                <MotionCard.Metric
                                    icon={
                                        <CheckCircleOutlined
                                            style={{
                                                fontSize:
                                                    18,

                                                color:
                                                    '#52c41a'
                                            }}
                                        />
                                    }
                                    iconBg='rgba(82,196,26,0.12)'
                                    title='Completed'
                                    value={
                                        perfCounts.completed
                                    }
                                    subtitle='Successfully delivered'
                                />
                            </Col>

                            <Col xs={24} md={6}>
                                <MotionCard.Metric
                                    icon={
                                        <MessageOutlined
                                            style={{ fontSize: 18, color: '#d48806' }}
                                        />
                                    }
                                    iconBg='rgba(250,173,20,0.14)'
                                    title='Open Queries'
                                    value={openQueries.length}
                                    subtitle='Click to view and resolve'
                                    onClick={() => setQueriesModalOpen(true)}
                                />
                            </Col>

                            {readyForCompletion.length > 0 ? (
                                <Col xs={24} lg={18}>
                                    <MotionCard
                                        title={
                                            <Space size={8}>
                                                <CheckCircleOutlined style={{ color: '#52c41a' }} />

                                                <Text strong>Ready for completion</Text>

                                                <Tag
                                                    color='green'
                                                    style={{ borderRadius: 999, marginInlineEnd: 0 }}
                                                >
                                                    {readyForCompletion.length}
                                                </Tag>
                                            </Space>
                                        }
                                    >
                                        <List
                                            dataSource={readyForCompletion}
                                            renderItem={item => (
                                                <List.Item
                                                    key={item.key}
                                                    actions={[
                                                        <Button
                                                            key='complete'
                                                            type='primary'
                                                            shape='round'
                                                            icon={<CheckCircleOutlined />}
                                                            onClick={() =>
                                                                setCompletionTarget({
                                                                    assignmentIds: item.assignmentIds,
                                                                    interventionTitle: item.interventionTitle,
                                                                    sessionsCompleted: item.sessionsCompleted,
                                                                    plannedSessions: item.plannedSessions,
                                                                    deliveryMethod: deriveDeliveryMethod(
                                                                        item.assignmentIds
                                                                    )
                                                                })
                                                            }
                                                        >
                                                            Complete
                                                        </Button>
                                                    ]}
                                                >
                                                    <List.Item.Meta
                                                        title={item.interventionTitle}
                                                        description={
                                                            item.beneficiaryNames.length > 1
                                                                ? `${item.beneficiaryNames.length} SMEs (grouped)`
                                                                : item.beneficiaryNames[0]
                                                        }
                                                    />
                                                </List.Item>
                                            )}
                                        />
                                    </MotionCard>
                                </Col>
                            ) : null}

                            <Col
                                xs={24}
                                lg={6}
                                order={readyForCompletion.length > 0 ? 0 : 1}
                            >
                                <MotionCard title='My review rating'>
                                    {ratingSummary.count > 0 ? (
                                        <div style={{ textAlign: 'center' }}>
                                            <Progress
                                                type='dashboard'
                                                gapDegree={75}
                                                percent={(ratingSummary.average / 5) * 100}
                                                strokeColor='#1677ff'
                                                size={140}
                                                format={() => (
                                                    <div>
                                                        <div style={{ fontSize: 22, fontWeight: 600 }}>
                                                            {ratingSummary.average.toFixed(1)}/5
                                                        </div>

                                                        <Rate
                                                            disabled
                                                            allowHalf
                                                            value={ratingSummary.average}
                                                            style={{ fontSize: 14 }}
                                                        />

                                                        <div style={{ fontSize: 12, color: '#1677ff' }}>
                                                            {ratingSummary.count} review
                                                            {ratingSummary.count === 1 ? '' : 's'}
                                                        </div>
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    ) : (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description='No reviews yet'
                                            style={{ padding: '25px 0' }}
                                        />
                                    )}
                                </MotionCard>
                            </Col>

                            {/*
                              Secondary dashboard information
                            */}
                            <Col
                                xs={24}
                                lg={readyForCompletion.length > 0 ? 12 : 18}
                            >
                                <MotionCard
                                    title='Intervention Performance'
                                >
                                    {allInterventions.length > 0 ? (
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 24,
                                                flexWrap: 'wrap'
                                            }}
                                        >
                                            <HealthGauge
                                                percent={healthPercent}
                                            />

                                            <div
                                                style={{
                                                    flex: 1,
                                                    minWidth: 200
                                                }}
                                            >
                                                {performanceRows.map(row => (
                                                    <div
                                                        key={row.label}
                                                        style={{
                                                            marginBottom: 12
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between'
                                                            }}
                                                        >
                                                            <Text>
                                                                {row.label}
                                                            </Text>

                                                            <Text strong>
                                                                {row.value}
                                                            </Text>
                                                        </div>

                                                        <Progress
                                                            percent={row.percent}
                                                            strokeColor={row.color}
                                                            showInfo={false}
                                                            size='small'
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description='No performance data yet'
                                            style={{
                                                padding: '25px 0'
                                            }}
                                        />
                                    )}
                                </MotionCard>
                            </Col>

                            <Col
                                xs={24}
                                lg={readyForCompletion.length > 0 ? 12 : 24}
                                order={readyForCompletion.length > 0 ? 0 : 2}
                            >
                                <UpcomingAppointmentsCard
                                    appointments={
                                        appointments
                                    }
                                    programId={
                                        activeProgramId
                                    }
                                    daysAhead={7}
                                    limit={8}
                                    onViewCalendar={() =>
                                        navigate(
                                            '/calendar'
                                        )
                                    }
                                />
                            </Col>
                        </Row>
                    </div>
                )}

                <Modal
                    open={queriesModalOpen}
                    title={`My Queries (${openQueries.length} open)`}
                    footer={null}
                    width={1100}
                    onCancel={() => setQueriesModalOpen(false)}
                    destroyOnClose
                >
                                        <Table
                                            size='small'
                                            rowKey='id'
                                            dataSource={
                                                openQueries
                                            }
                                            columns={
                                                queryColumns as any
                                            }
                                            pagination={
                                                openQueries.length >
                                                    3
                                                    ? {
                                                        pageSize:
                                                            3,

                                                        showSizeChanger:
                                                            false,

                                                        position:
                                                            [
                                                                'bottomCenter'
                                                            ]
                                                    }
                                                    : false
                                            }
                                            scroll={{
                                                x:
                                                    1050
                                            }}
                                            locale={{
                                                emptyText:
                                                    <Empty description='No queries' />
                                            }}
                                        />
                </Modal>

                <InterventionCompletionModal
                    target={completionTarget}
                    user={
                        user
                            ? {
                                uid: user.uid || user.id,
                                name: user.name || user.displayName,
                                email: user.email,
                                departmentName: user.departmentName
                            }
                            : null
                    }
                    onClose={() => setCompletionTarget(null)}
                    onCompleted={ids => {
                        setCompletionTarget(null)

                        setAllInterventions(previous =>
                            previous.map(row =>
                                ids.includes(row.id)
                                    ? {
                                        ...row,
                                        lifecycle: 'completed',
                                        raw: {
                                            ...row.raw,
                                            assigneeCompletionStatus: 'completed'
                                        }
                                    }
                                    : row
                            )
                        )
                    }}
                />

                <ResolveQueryModal
                    open={
                        !!resolvingDashboardQuery
                    }
                    query={
                        resolvingDashboardQuery
                    }
                    actor={{
                        id:
                            user?.uid ||
                            assigneeId ||
                            '',

                        name:
                            user?.name ||
                            user?.displayName ||
                            null,

                        email:
                            user?.email ||
                            null,

                        role:
                            user?.role ||
                            'coordinator',

                        departmentName:
                            user?.departmentName ||
                            null
                    }}
                    onClose={() =>
                        setResolvingDashboardQuery(
                            null
                        )
                    }
                    onResolved={
                        async () => {
                            setResolvingDashboardQuery(
                                null
                            )

                            await refetchQueries()
                        }
                    }
                />
            </div>
        )
    }

export default CoordinatorDashboard
