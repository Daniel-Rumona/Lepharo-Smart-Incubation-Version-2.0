import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import {
    Button,
    Descriptions,
    Modal,
    Space,
    Spin,
    Tag,
    Typography
} from 'antd'
import {
    CalendarOutlined,
    FileDoneOutlined,
    TeamOutlined
} from '@ant-design/icons'
import {
    useLocation,
    useNavigate
} from 'react-router-dom'

import {
    checkedInEmails,
    checkedOutEmails,
    fetchAppointments,
    formatAppointmentDate,
    formatAppointmentTime,
    formatDeliveryMethod,
    getAppointmentGroupKey,
    getAppointmentTitle,
    isPastAppointment,
    resolveAppointmentActor,
    type AppointmentRecord
} from '@/services/appointmentService'

import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLoginPrompt } from '@/contexts/LoginPromptContext'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { assignedInterventionService } from '@/services/assignedInterventionService'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import { auth } from '@/firebase'

const { Text, Title } = Typography

const FACILITATOR_ROLES = new Set([
    'operations',
    'coordinator',
    'consultant',
    'projectmanager',
    'employee'
])

const PUBLIC_PATHS = new Set([
    '/',
    '/login',
    '/reset-password'
])

const COVERAGE_LOOKBACK_HOURS = 48

const COVERAGE_LOOKBACK_MS =
    COVERAGE_LOOKBACK_HOURS *
    60 *
    60 *
    1000

type CoveragePromptItem = {
    key: string
    appointment: AppointmentRecord
    members: AppointmentRecord[]
}

/**
 * Attendees who scanned in but never scanned out.
 *
 * A meeting left in this state is not finished from the record's point of view:
 * the attendance rows have an open end, so time-spent cannot be computed and the
 * SME shows as still present long after the session ended. The facilitator has
 * to close it out, which is why it now triggers the same gate as missing
 * coverage.
 */
const openCheckInCount = (
    appointment?: AppointmentRecord | null
) => {
    // Canonical rows belong to one SME. Session summary email lists are
    // shared across all members and would count the same check-in repeatedly.
    if (appointment?.appointmentSessionId) {
        return appointment.attendance?.checkedInAt && !appointment.attendance?.checkedOutAt ? 1 : 0
    }
    const inEmails = checkedInEmails(
        appointment
    )

    if (
        !inEmails.length
    ) {
        return 0
    }

    const outEmails = new Set(
        checkedOutEmails(
            appointment
        )
    )

    return inEmails.filter(
        email =>
            !outEmails.has(
                email
            )
    ).length
}

const hasOpenCheckIns = (
    appointment?: AppointmentRecord | null
) =>
    openCheckInCount(
        appointment
    ) > 0

/**
 * Why this prompt is showing, summed over every member of the group.
 *
 * A prompt item groups the per-SME appointment rows that make up one booking,
 * and `appointment` is only the first of them — reading attendance off that one
 * row would undercount a group whose first SME happened to check out.
 */
const promptReason = (
    members: AppointmentRecord[]
) => {
    const openCheckIns = members.reduce(
        (
            total,
            member
        ) =>
            total +
            openCheckInCount(
                member
            ),
        0
    )

    const missingCoverage = members.some(
        member =>
            !member
                .sessionCoverage
                ?.latest
    )

    return {
        openCheckIns,
        missingCoverage
    }
}

const participantName = (
    appointment: AppointmentRecord
) =>
    String(
        appointment.participantName ||
        appointment.snapshot?.beneficiaryName ||
        'SME'
    ).trim()

const timestampToMillis = (
    value: any
): number | null => {
    if (!value) {
        return null
    }

    if (
        typeof value?.toMillis ===
        'function'
    ) {
        const millis =
            value.toMillis()

        return Number.isFinite(
            millis
        )
            ? millis
            : null
    }

    if (
        typeof value?.toDate ===
        'function'
    ) {
        const date =
            value.toDate()

        const millis =
            date?.getTime?.()

        return Number.isFinite(
            millis
        )
            ? millis
            : null
    }

    if (
        value instanceof Date
    ) {
        const millis =
            value.getTime()

        return Number.isFinite(
            millis
        )
            ? millis
            : null
    }

    if (
        typeof value ===
        'number'
    ) {
        return Number.isFinite(
            value
        )
            ? value
            : null
    }

    /*
     * Do not attempt to parse a time-only
     * string such as "14:30" as a full date.
     */
    if (
        typeof value ===
        'string'
    ) {
        const trimmed =
            value.trim()

        if (
            !trimmed ||
            /^\d{1,2}:\d{2}/.test(
                trimmed
            )
        ) {
            return null
        }

        const millis =
            new Date(
                trimmed
            ).getTime()

        return Number.isFinite(
            millis
        )
            ? millis
            : null
    }

    return null
}

const combineDateAndTime = (
    dateValue: any,
    timeValue: any
): number | null => {
    if (
        !dateValue ||
        !timeValue
    ) {
        return null
    }

    let baseDate:
        Date | null =
        null

    if (
        typeof dateValue?.toDate ===
        'function'
    ) {
        baseDate =
            dateValue.toDate()
    } else if (
        dateValue instanceof Date
    ) {
        baseDate =
            new Date(
                dateValue
            )
    } else if (
        typeof dateValue ===
        'string'
    ) {
        /*
         * YYYY-MM-DD is parsed manually to
         * ensure local calendar semantics.
         */
        const dateMatch =
            dateValue
                .trim()
                .match(
                    /^(\d{4})-(\d{1,2})-(\d{1,2})$/
                )

        if (
            dateMatch
        ) {
            baseDate =
                new Date(
                    Number(
                        dateMatch[1]
                    ),
                    Number(
                        dateMatch[2]
                    ) - 1,
                    Number(
                        dateMatch[3]
                    )
                )
        } else {
            const parsed =
                new Date(
                    dateValue
                )

            if (
                !Number.isNaN(
                    parsed.getTime()
                )
            ) {
                baseDate =
                    parsed
            }
        }
    }

    if (
        !baseDate ||
        Number.isNaN(
            baseDate.getTime()
        )
    ) {
        return null
    }

    /*
     * If timeValue is already a Firestore
     * timestamp or Date, only its clock time
     * is applied to the appointment date.
     */
    if (
        typeof timeValue?.toDate ===
        'function'
    ) {
        const timeDate =
            timeValue.toDate()

        baseDate.setHours(
            timeDate.getHours(),
            timeDate.getMinutes(),
            timeDate.getSeconds(),
            0
        )

        return baseDate.getTime()
    }

    if (
        timeValue instanceof Date
    ) {
        baseDate.setHours(
            timeValue.getHours(),
            timeValue.getMinutes(),
            timeValue.getSeconds(),
            0
        )

        return baseDate.getTime()
    }

    const timeText =
        String(
            timeValue ||
            ''
        ).trim()

    const match =
        timeText.match(
            /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
        )

    if (!match) {
        return null
    }

    let hours =
        Number(
            match[1]
        )

    const minutes =
        Number(
            match[2]
        )

    const seconds =
        Number(
            match[3] ||
            0
        )

    const meridiem =
        match[4]
            ?.toUpperCase()

    if (
        meridiem ===
        'PM' &&
        hours < 12
    ) {
        hours += 12
    }

    if (
        meridiem ===
        'AM' &&
        hours === 12
    ) {
        hours = 0
    }

    if (
        hours > 23 ||
        minutes > 59 ||
        seconds > 59
    ) {
        return null
    }

    baseDate.setHours(
        hours,
        minutes,
        seconds,
        0
    )

    return baseDate.getTime()
}

/*
 * Resolve the most reliable timestamp for
 * when an appointment ended.
 *
 * Supports both newer and legacy appointment
 * structures.
 */
const getAppointmentEndMillis = (
    appointment:
        AppointmentRecord
): number | null => {
    const record =
        appointment as any

    /*
     * Prefer actual date/time timestamps.
     */
    const directEndCandidates =
        [
            record.endAt,
            record.end,
            record.schedule?.endAt,
            record.schedule?.endDateTime
        ]

    for (
        const candidate
        of directEndCandidates
    ) {
        const millis =
            timestampToMillis(
                candidate
            )

        if (
            millis !== null
        ) {
            return millis
        }
    }

    /*
     * Some appointments store endTime as a
     * Firestore Timestamp rather than a
     * clock string.
     */
    const directEndTime =
        timestampToMillis(
            record.endTime
        )

    if (
        directEndTime !==
        null
    ) {
        return directEndTime
    }

    const directScheduleEndTime =
        timestampToMillis(
            record.schedule
                ?.endTime
        )

    if (
        directScheduleEndTime !==
        null
    ) {
        return directScheduleEndTime
    }

    /*
     * Legacy structure:
     * date: "2026-08-18"
     * endTime: "14:30"
     */
    const dateValue =
        record.date ||
        record.schedule?.dateKey ||
        record.schedule?.date

    const timeValue =
        record.endTime ||
        record.schedule?.endTime

    const combinedEnd =
        combineDateAndTime(
            dateValue,
            timeValue
        )

    if (
        combinedEnd !==
        null
    ) {
        return combinedEnd
    }

    /*
     * If an explicit end time is unavailable,
     * use the appointment start as the fallback.
     * This still allows a recent historical
     * appointment to request coverage without
     * allowing very old appointments through.
     */
    const directStartCandidates =
        [
            record.startAt,
            record.start,
            record.schedule?.startAt,
            record.schedule
                ?.startDateTime
        ]

    for (
        const candidate
        of directStartCandidates
    ) {
        const millis =
            timestampToMillis(
                candidate
            )

        if (
            millis !== null
        ) {
            return millis
        }
    }

    const directStartTime =
        timestampToMillis(
            record.startTime
        )

    if (
        directStartTime !==
        null
    ) {
        return directStartTime
    }

    const combinedStart =
        combineDateAndTime(
            dateValue,
            record.startTime ||
            record.schedule
                ?.startTime
        )

    if (
        combinedStart !==
        null
    ) {
        return combinedStart
    }

    /*
     * If the appointment date/time cannot be
     * safely resolved, do not allow it to
     * block the workspace.
     */
    return null
}

const isWithinCoverageWindow = (
    appointment:
        AppointmentRecord,
    nowMs: number
) => {
    const endedAt =
        getAppointmentEndMillis(
            appointment
        )

    if (
        endedAt === null
    ) {
        return false
    }

    const cutoff =
        nowMs -
        COVERAGE_LOOKBACK_MS

    return (
        endedAt <=
        nowMs &&
        endedAt >=
        cutoff
    )
}

const MandatoryMeetingCoverage:
    React.FC = () => {
        const {
            user,
            loading:
            identityLoading,
            isViewingAs
        } =
            useFullIdentity()

        const {
            clockGateState,
            setCoverageGateState
        } =
            useLoginPrompt()

        const {
            activeProgramId
        } =
            useActiveProgramId()

        const location =
            useLocation()

        const navigate =
            useNavigate()

        const [
            checking,
            setChecking
        ] =
            useState(false)

        const [
            appointments,
            setAppointments
        ] =
            useState<
                AppointmentRecord[]
            >([])

        const [
            handoff,
            setHandoff
        ] =
            useState(false)

        const requestId =
            useRef(0)

        const role =
            String(
                user?.role ||
                ''
            )
                .trim()
                .toLowerCase()

        const isPublicRoute =
            PUBLIC_PATHS.has(
                location.pathname
            ) ||
            location.pathname.startsWith(
                '/registration'
            )

        const applies =
            !identityLoading &&
            !isViewingAs &&
            !isPublicRoute &&
            Boolean(
                user?.uid &&
                auth.currentUser?.uid
            ) &&
            FACILITATOR_ROLES.has(
                role
            )

        const checkCoverage =
            useCallback(
                async () => {
                    if (
                        !applies ||
                        !user
                    ) {
                        setAppointments(
                            []
                        )

                        setHandoff(
                            false
                        )

                        setCoverageGateState(
                            'complete'
                        )

                        return
                    }

                    const currentRequest =
                        ++requestId.current

                    setChecking(
                        true
                    )

                    setCoverageGateState(
                        'checking'
                    )

                    try {
                        const appointmentActor =
                            await resolveAppointmentActor(
                                user
                            )

                        const rows =
                            await fetchAppointments(
                                {
                                    assigneeIds:
                                        appointmentActor.ids,

                                    assigneeEmail:
                                        appointmentActor.email,

                                    programId:
                                        activeProgramId
                                }
                            )

                        if (
                            currentRequest !==
                            requestId.current
                        ) {
                            return
                        }

                        /*
                         * Coverage is only relevant for
                         * appointments belonging to an
                         * assignment that is still open.
                         */
                        const assignmentIds =
                            Array.from(
                                new Set(
                                    rows
                                        .map(
                                            row =>
                                                String(
                                                    row.assignedInterventionId ||
                                                    ''
                                                ).trim()
                                        )
                                        .filter(
                                            Boolean
                                        )
                                )
                            )

                        const assignmentEntries =
                            await Promise.all(
                                assignmentIds.map(
                                    async id =>
                                        [
                                            id,
                                            await assignedInterventionService.getById(
                                                id
                                            )
                                        ] as const
                                )
                            )

                        if (
                            currentRequest !==
                            requestId.current
                        ) {
                            return
                        }

                        const openAssignmentIds =
                            new Set(
                                assignmentEntries
                                    .filter(
                                        ([
                                            ,
                                            assignment
                                        ]) =>
                                            assignment &&
                                            resolveAssignmentLifecycle(
                                                assignment
                                            ).isOpen
                                    )
                                    .map(
                                        ([
                                            id
                                        ]) =>
                                            id
                                    )
                            )

                        const nowMs =
                            Date.now()

                        /*
                         * Only appointments ending within
                         * the previous 48 hours may trigger
                         * the mandatory coverage gate.
                         *
                         * Older historical appointments are
                         * deliberately ignored even when
                         * coverage was never recorded.
                         */
                        const pending =
                            rows
                                .filter(
                                    row =>
                                        openAssignmentIds.has(
                                            String(
                                                row.assignedInterventionId ||
                                                ''
                                            ).trim()
                                        )
                                )
                                .filter(
                                    row =>
                                        isPastAppointment(
                                            row
                                        )
                                )
                                .filter(
                                    row =>
                                        isWithinCoverageWindow(
                                            row,
                                            nowMs
                                        )
                                )
                                /*
                                 * Two ways a past meeting is still unfinished:
                                 * coverage was never recorded, or attendees are
                                 * still checked in. The second case used to slip
                                 * through whenever coverage happened to be filed
                                 * first, leaving SMEs marked present indefinitely.
                                 */
                                .filter(
                                    row =>
                                        !row
                                            .sessionCoverage
                                            ?.latest ||
                                        hasOpenCheckIns(
                                            row
                                        )
                                )
                                .filter(
                                    row => {
                                        const status =
                                            String(
                                                row.status ||
                                                ''
                                            )
                                                .trim()
                                                .toLowerCase()

                                        return ![
                                            'cancelled',
                                            'canceled',
                                            'postponed'
                                        ].includes(
                                            status
                                        )
                                    }
                                )
                                .sort(
                                    (
                                        left,
                                        right
                                    ) =>
                                        (
                                            getAppointmentEndMillis(
                                                left
                                            ) ||
                                            nowMs
                                        ) -
                                        (
                                            getAppointmentEndMillis(
                                                right
                                            ) ||
                                            nowMs
                                        )
                                )

                        setAppointments(
                            pending
                        )

                        setHandoff(
                            false
                        )

                        setCoverageGateState(
                            pending.length
                                ? 'open'
                                : 'complete'
                        )
                    } catch (
                    error
                    ) {
                        console.error(
                            '[MandatoryMeetingCoverage] Coverage check failed:',
                            error
                        )

                        /*
                         * Reminder failures must never
                         * block the user's workspace.
                         */
                        setAppointments(
                            []
                        )

                        setCoverageGateState(
                            'complete'
                        )
                    } finally {
                        if (
                            currentRequest ===
                            requestId.current
                        ) {
                            setChecking(
                                false
                            )
                        }
                    }
                },
                [
                    activeProgramId,
                    applies,
                    setCoverageGateState,
                    user
                ]
            )

        useEffect(() => {
            if (
                clockGateState !==
                'complete'
            ) {
                setCoverageGateState(
                    'checking'
                )

                return
            }

            void checkCoverage()
        }, [
            checkCoverage,
            clockGateState,
            setCoverageGateState
        ])

        useEffect(() => {
            if (
                clockGateState !==
                'complete'
            ) {
                return
            }

            const recheck =
                () => {
                    if (
                        location.pathname.startsWith(
                            '/interventions/appointments'
                        )
                    ) {
                        return
                    }

                    if (
                        document.visibilityState ===
                        'visible'
                    ) {
                        void checkCoverage()
                    }
                }

            window.addEventListener(
                'focus',
                recheck
            )

            document.addEventListener(
                'visibilitychange',
                recheck
            )

            return () => {
                window.removeEventListener(
                    'focus',
                    recheck
                )

                document.removeEventListener(
                    'visibilitychange',
                    recheck
                )
            }
        }, [
            checkCoverage,
            clockGateState,
            location.pathname
        ])

        useEffect(() => {
            if (
                !handoff ||
                location.pathname.startsWith(
                    '/interventions/appointments'
                )
            ) {
                return
            }

            void checkCoverage()
        }, [
            checkCoverage,
            handoff,
            location.pathname
        ])

        const promptItems =
            useMemo(
                () => {
                    const groups =
                        new Map<
                            string,
                            AppointmentRecord[]
                        >()

                    appointments.forEach(
                        appointment => {
                            const groupKey =
                                getAppointmentGroupKey(
                                    appointment
                                )

                            const key =
                                groupKey
                                    ? `group:${groupKey}`
                                    : `single:${appointment.id}`

                            groups.set(
                                key,
                                [
                                    ...(
                                        groups.get(
                                            key
                                        ) ||
                                        []
                                    ),
                                    appointment
                                ]
                            )
                        }
                    )

                    return Array.from(
                        groups.entries()
                    ).map<CoveragePromptItem>(
                        ([
                            key,
                            members
                        ]) => ({
                            key,
                            appointment:
                                members[0],
                            members
                        })
                    )
                },
                [
                    appointments
                ]
            )

        const current =
            promptItems[0]

        const open =
            clockGateState ===
            'complete' &&
            Boolean(
                current
            ) &&
            !checking &&
            !handoff &&
            applies

        const openCoverage =
            () => {
                if (
                    !current
                ) {
                    return
                }

                setHandoff(
                    true
                )

                setCoverageGateState(
                    'open'
                )

                navigate(
                    `/interventions/appointments?${promptReason(current.members).missingCoverage ? 'coverage' : 'checkout'}=${encodeURIComponent(
                        current.appointment.id
                    )}`
                )
            }

        return (
            <Modal
                open={
                    open
                }
                closable={
                    false
                }
                maskClosable={
                    false
                }
                keyboard={
                    false
                }
                footer={
                    null
                }
                width={
                    520
                }
                centered
                destroyOnClose={
                    false
                }
                styles={{
                    mask: {
                        background:
                            'rgba(15, 23, 42, .44)',

                        backdropFilter:
                            'blur(10px)',

                        WebkitBackdropFilter:
                            'blur(10px)'
                    }
                }}
            >
                {current && (
                    <Space
                        direction='vertical'
                        size={
                            18
                        }
                        style={{
                            width:
                                '100%'
                        }}
                    >
                        <div
                            style={{
                                textAlign:
                                    'center'
                            }}
                        >
                            <FileDoneOutlined
                                style={{
                                    color:
                                        '#d48806',

                                    fontSize:
                                        36
                                }}
                            />

                            <Title
                                level={
                                    3
                                }
                                style={{
                                    margin:
                                        '10px 0 4px'
                                }}
                            >
                                {
                                    promptReason(
                                        current.members
                                    ).missingCoverage
                                        ? 'Meeting coverage required'
                                        : 'Attendees still checked in'
                                }
                            </Title>

                            {/*
                              The gate fires for two different reasons now, and
                              telling someone to "record whether it took place"
                              when they already did is how a prompt gets
                              dismissed without being read.
                            */}
                            <Text type='secondary'>
                                {(() => {
                                    const {
                                        openCheckIns,
                                        missingCoverage
                                    } = promptReason(
                                        current.members
                                    )

                                    const people = `${openCheckIns} attendee${openCheckIns === 1 ? '' : 's'}`

                                    if (
                                        !missingCoverage
                                    ) {
                                        return `${people} from this meeting never checked out, so ${openCheckIns === 1 ? 'that SME is' : 'those SMEs are'} still recorded as present. Check them out to close the session.`
                                    }

                                    return openCheckIns
                                        ? `This meeting ended within the last 48 hours and ${people} ${openCheckIns === 1 ? 'is' : 'are'} still checked in. Record whether it took place, the SME attendance outcome, and check the remaining attendees out.`
                                        : 'This meeting ended within the last 48 hours. Record whether it took place and the SME attendance outcome.'
                                })()}
                            </Text>
                        </div>

                        <Descriptions
                            bordered
                            size='small'
                            column={
                                1
                            }
                        >
                            <Descriptions.Item label='Meeting'>
                                {getAppointmentTitle(
                                    current.appointment
                                )}
                            </Descriptions.Item>

                            <Descriptions.Item label='When'>
                                <Space>
                                    <CalendarOutlined />

                                    {formatAppointmentDate(
                                        current.appointment
                                    )}
                                    ,{' '}
                                    {formatAppointmentTime(
                                        current.appointment
                                    )}
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item
                                label={
                                    current.members.length >
                                        1
                                        ? 'SMEs'
                                        : 'SME'
                                }
                            >
                                <Space
                                    wrap
                                >
                                    <TeamOutlined />

                                    {current.members.length >
                                        1
                                        ? current.members.map(
                                            member => (
                                                <Tag
                                                    key={
                                                        member.id
                                                    }
                                                >
                                                    {participantName(
                                                        member
                                                    )}
                                                </Tag>
                                            )
                                        )
                                        : participantName(
                                            current.appointment
                                        )}
                                </Space>
                            </Descriptions.Item>

                            <Descriptions.Item label='Delivery'>
                                {formatDeliveryMethod(
                                    current.appointment
                                )}
                            </Descriptions.Item>
                        </Descriptions>

                        {promptItems.length >
                            1 && (
                                <Text
                                    type='secondary'
                                    style={{
                                        textAlign:
                                            'center'
                                    }}
                                >
                                    {promptItems.length -
                                        1}{' '}
                                    more recent
                                    meeting
                                    {promptItems.length ===
                                        2
                                        ? ''
                                        : 's'}{' '}
                                    will remain after
                                    this one.
                                </Text>
                            )}

                        <Button
                            type='primary'
                            size='large'
                            block
                            icon={
                                checking ? (
                                    <Spin size='small' />
                                ) : (
                                    <FileDoneOutlined />
                                )
                            }
                            onClick={
                                openCoverage
                            }
                        >
                            {promptReason(current.members).missingCoverage
                                ? 'Record meeting outcome and SME attendance'
                                : 'Review attendance and check out'}
                        </Button>
                    </Space>
                )}
            </Modal>
        )
    }

export default MandatoryMeetingCoverage
