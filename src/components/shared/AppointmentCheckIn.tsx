import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Descriptions,
    Form,
    Input,
    Result,
    Space,
    Spin,
    Typography,
    message
} from 'antd'
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    LockOutlined,
    LoginOutlined
} from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import {
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    runTransaction
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { Title, Text } = Typography

type AttendanceSessionStatus = 'active' | 'closed'

type FirestoreTimestampLike =
    | Timestamp
    | {
        toDate?: () => Date
        seconds?: number
        nanoseconds?: number
    }
    | string
    | number
    | null
    | undefined

type AttendanceSession = {
    token?: string
    status?: AttendanceSessionStatus
    startedAt?: FirestoreTimestampLike
    expiresAt?: FirestoreTimestampLike
    createdByEmail?: string
    createdByName?: string
    qrUrl?: string
}

type AppointmentRecord = {
    id: string
    title?: string
    status?: string
    programId?: string
    interventionId?: string
    interventionTitle?: string
    location?: string
    meetingLink?: string
    deliveryMethod?: 'in_person' | 'virtual' | 'telephonically'
    sessionType?: 'individual' | 'group'
    startAt?: FirestoreTimestampLike
    endAt?: FirestoreTimestampLike
    attendanceSession?: AttendanceSession | null
    attendanceSummary?: { checkedInCount?: number, checkedOutCount?: number, attendedCount?: number } | null
}

type IdentityShape = {
    uid?: string
    email?: string
    name?: string
    fullName?: string
    displayName?: string
    participantId?: string
    participantDocId?: string
    profileId?: string
    applicationId?: string
}

type ValidationState =
    | 'loading'
    | 'login_required'
    | 'needs_details'
    | 'ready_to_submit'
    | 'success'
    | 'already_checked_in'
    | 'expired'
    | 'invalid'
    | 'not_invited'
    | 'closed'
    | 'error'

const APPOINTMENTS_COLLECTION = 'appointments'
const APPOINTMENT_SESSIONS_COLLECTION = 'appointmentSessions'

const safeString = (value: unknown) => String(value ?? '').trim()

const normalizeEmail = (value: unknown) => safeString(value).toLowerCase()

const invitationMatchesIdentity = (
    invitation: Record<string, any>,
    email: string,
    participantIds: Set<string>
) =>
    normalizeEmail(invitation.smeEmail) === email ||
    participantIds.has(safeString(invitation.smeId))

const resolveViewerParticipantIds = async (
    identity: IdentityShape | undefined,
    email: string
) => {
    const ids = new Set(
        [
            identity?.uid,
            identity?.participantId,
            identity?.participantDocId,
            identity?.profileId,
            identity?.applicationId
        ]
            .map(safeString)
            .filter(Boolean)
    )

    if (!email) return ids

    try {
        const [participants, applications] = await Promise.all([
            getDocs(query(collection(db, 'participants'), where('email', '==', email))),
            getDocs(query(collection(db, 'applications'), where('email', '==', email)))
        ])
            ;[participants, applications].forEach(snapshot => {
                snapshot.docs.forEach(item => {
                    const data = item.data() as any
                        ;[
                            item.id,
                            data?.participantId,
                            data?.participantDocId,
                            data?.userId,
                            data?.uid,
                            data?.applicationId
                        ].map(safeString).filter(Boolean).forEach(id => ids.add(id))
                })
            })
    } catch (error) {
        console.warn('Could not resolve the participant identity for check-in:', error)
    }

    return ids
}

const toDate = (value: FirestoreTimestampLike): Date | null => {
    if (!value) return null

    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
    }

    if (value instanceof Timestamp) {
        return value.toDate()
    }

    if (typeof value === 'object' && typeof value.toDate === 'function') {
        try {
            return value.toDate()
        } catch {
            return null
        }
    }

    if (typeof value === 'object' && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000)
    }

    return null
}

const formatDateTime = (value?: FirestoreTimestampLike | string, fallback = '-') => {
    if (!value) return fallback

    const d = toDate(value as FirestoreTimestampLike)
    if (d) return dayjs(d).format('DD MMM YYYY HH:mm')

    if (typeof value === 'string') {
        const parsed = dayjs(value)
        return parsed.isValid() ? parsed.format('DD MMM YYYY HH:mm') : value
    }

    return fallback
}

const getMeetingStart = (record?: AppointmentRecord | null) => {
    if (!record) return null

    const direct = toDate(record.startAt as FirestoreTimestampLike)
    if (direct) return dayjs(direct)
    return null
}

const getMeetingEnd = (record?: AppointmentRecord | null) => {
    if (!record) return null

    const direct = toDate(record.endAt as FirestoreTimestampLike)
    if (direct) return dayjs(direct)
    return null
}

const normalizeError = (
    error: unknown,
    fallback = 'Something went wrong. Please try again.'
) => {
    const raw =
        typeof error === 'string'
            ? error
            : error && typeof error === 'object' && 'message' in error
                ? String((error as { message?: string }).message || '')
                : ''

    const text = raw.toLowerCase()

    if (text.includes('permission') || text.includes('insufficient permissions')) {
        return 'You do not have permission to complete check-in.'
    }

    if (text.includes('network')) {
        return 'Network error. Check your connection and try again.'
    }

    if (text.includes('not found') || text.includes('no document')) {
        return 'This meeting could not be found.'
    }

    return raw || fallback
}

const MeetingCheckInPage: React.FC = () => {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const { user, loading: identityLoading } = useFullIdentity() as {
        user?: IdentityShape
        loading: boolean
    }

    const meetingId = safeString(searchParams.get('meetingId'))
    const token = safeString(searchParams.get('token'))
    const [activeMeetingId, setActiveMeetingId] = useState('')

    const [viewerEmail, setViewerEmail] = useState('')
    const [viewerName, setViewerName] = useState('')
    const [invitedCount, setInvitedCount] = useState(0)
    const [viewerParticipantIds, setViewerParticipantIds] = useState<string[]>([])

    const [form] = Form.useForm()

    const [loadingMeeting, setLoadingMeeting] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [state, setState] = useState<ValidationState>('loading')
    const [appointment, setAppointment] = useState<AppointmentRecord | null>(null)
    const [statusMessage, setStatusMessage] = useState('')
    const [checkedInEmail, setCheckedInEmail] = useState('')

    const authEmail = normalizeEmail(user?.email)
    const authName = safeString(user?.name || user?.fullName || user?.displayName)

    const meetingRef = useMemo(() => {
        const id = activeMeetingId || meetingId
        if (!id) return null
        return doc(db, APPOINTMENT_SESSIONS_COLLECTION, id)
    }, [activeMeetingId, meetingId])

    const applyReadyState = (
        record: AppointmentRecord
    ) => {
        const nextName = authName

        setViewerEmail(authEmail)
        setViewerName(nextName)
        form.setFieldsValue({
            email: authEmail,
            fullName: nextName
        })

        if (!authName) {
            setState('needs_details')
            setStatusMessage('Confirm your details to complete check-in.')
        } else {
            setState('ready_to_submit')
            setStatusMessage('You are invited. Complete check-in below.')
        }
    }

    const loadAndValidateMeeting = async () => {
        if (!token) {
            setState('invalid')
            setStatusMessage('The QR token is missing.')
            setLoadingMeeting(false)
            return
        }

        // Appointment sessions are intentionally protected by Firestore
        // rules. With tab-scoped auth an opened QR tab starts unsigned, so do
        // not attempt a protected meeting lookup before routing that tab
        // through login.
        if (!authEmail) {
            setState('login_required')
            setStatusMessage('Please sign in to continue with check-in.')
            setLoadingMeeting(false)
            return
        }

        setLoadingMeeting(true)

        try {
            // New compact QR links carry only a random token. Historic links
            // carry both the session ID and token, so retain that direct read
            // while falling back to the token lookup when an ID is absent or
            // stale.
            let snap = meetingId
                ? await getDoc(doc(db, APPOINTMENT_SESSIONS_COLLECTION, meetingId))
                : null

            if (!snap?.exists()) {
                const matchingSessions = await getDocs(query(
                    collection(db, APPOINTMENT_SESSIONS_COLLECTION),
                    where('attendanceSession.token', '==', token)
                ))
                snap = matchingSessions.docs.length === 1
                    ? matchingSessions.docs[0]
                    : null
            }

            if (!snap?.exists()) {
                setState('invalid')
                setStatusMessage('This meeting was not found.')
                setLoadingMeeting(false)
                return
            }

            const resolvedMeetingId = snap.id
            setActiveMeetingId(resolvedMeetingId)

            const data: AppointmentRecord = {
                ...(snap.data() as AppointmentRecord),
                id: snap.id
            }

            setAppointment(data)

            const session = data.attendanceSession
            const expectedToken = safeString(session?.token)
            const sessionStatus = safeString(session?.status).toLowerCase()
            const expiresAt = toDate(session?.expiresAt)
            const attendanceSnapshot = await getDocs(query(
                collection(db, APPOINTMENTS_COLLECTION),
                where('appointmentSessionId', '==', resolvedMeetingId)
            ))
            const participantIds = await resolveViewerParticipantIds(user, authEmail)
            setViewerParticipantIds(Array.from(participantIds))
            setInvitedCount(attendanceSnapshot.docs.length)
            const matchingInvitation = attendanceSnapshot.docs.find(item =>
                invitationMatchesIdentity(item.data(), authEmail, participantIds)
            )

            if (!session || !expectedToken || expectedToken !== token) {
                setState('invalid')
                setStatusMessage('This QR code is invalid.')
                setLoadingMeeting(false)
                return
            }

            if (sessionStatus === 'closed') {
                setState('closed')
                setStatusMessage('This meeting is no longer open for check-in.')
                setLoadingMeeting(false)
                return
            }

            if (expiresAt && dayjs(expiresAt).isBefore(dayjs())) {
                setState('expired')
                setStatusMessage('This check-in link has expired.')
                setLoadingMeeting(false)
                return
            }

            if (!attendanceSnapshot.docs.length) {
                setState('error')
                setStatusMessage('This meeting does not have an attendance list yet.')
                setLoadingMeeting(false)
                return
            }

            if (identityLoading) {
                setState('loading')
                setLoadingMeeting(true)
                return
            }

            if (matchingInvitation &&
                ['attended', 'checked-in', 'checked-out'].includes(String(matchingInvitation.data().attendance?.status || ''))) {
                setCheckedInEmail(authEmail)
                setViewerEmail(authEmail)
                setViewerName(authName || '')
                setState('already_checked_in')
                setStatusMessage('You are already checked in for this meeting.')
                setLoadingMeeting(false)
                return
            }

            if (!matchingInvitation) {
                setState('not_invited')
                setStatusMessage('You are not part of this meeting attendance list.')
                setLoadingMeeting(false)
                return
            }

            applyReadyState(data)
            setLoadingMeeting(false)
        } catch (error) {
            console.error('Failed to validate meeting check-in:', error)
            setState('error')
            setStatusMessage(normalizeError(error, 'Failed to validate this meeting.'))
            setLoadingMeeting(false)
        }
    }

    useEffect(() => {
        if (identityLoading) return
        loadAndValidateMeeting()
    }, [identityLoading, authEmail, authName, meetingId, token])

    useEffect(() => {
        setActiveMeetingId('')
    }, [meetingId, token])

    // A QR scan is often the first entry into the system. Preserve the signed
    // check-in link and take an unauthenticated SME through login immediately;
    // LoginPage returns them to this exact URL after authentication.
    useEffect(() => {
        if (state !== 'login_required') return

        const redirect = encodeURIComponent(
            window.location.pathname + window.location.search
        )
        navigate(`/login?redirect=${redirect}`, { replace: true })
    }, [navigate, state])

    const submitCheckIn = async (values: { fullName?: string; email?: string }) => {
        if (!meetingRef || !appointment) {
            message.error('Meeting reference is missing.')
            return
        }

        const submittedEmail = normalizeEmail(values.email || authEmail)
        const submittedName = safeString(
            values.fullName ||
            authName ||
            ''
        )

        if (!submittedEmail || !authEmail) {
            message.error('The participant email could not be verified.')
            return
        }

        if (!invitedCount || submittedEmail !== authEmail) {
            message.error('You are not authorized to check in for this meeting.')
            return
        }

        if (!submittedName) {
            message.error('Full name is required to complete check-in.')
            return
        }

        setSubmitting(true)

        try {
            const now = Timestamp.now()
            // Firestore transactions can read document references, but not a query.
            // Resolve this SME's invitation first, then re-read that exact document
            // inside the transaction before recording attendance.
            const linkedAppointments = await getDocs(query(
                collection(db, APPOINTMENTS_COLLECTION),
                where('appointmentSessionId', '==', activeMeetingId || meetingId)
            ))
            const matchingAppointmentRef = linkedAppointments.docs.find(item =>
                invitationMatchesIdentity(
                    item.data(),
                    submittedEmail,
                    new Set(viewerParticipantIds)
                )
            )?.ref

            if (!matchingAppointmentRef) {
                throw new Error('You are not authorized to check in for this meeting.')
            }

            const result = await runTransaction(db, async transaction => {
                const [snap, matchingAppointment] = await Promise.all([
                    transaction.get(meetingRef),
                    transaction.get(matchingAppointmentRef)
                ])

                if (!snap.exists()) {
                    throw new Error('Meeting not found.')
                }

                if (!matchingAppointment.exists() ||
                    !invitationMatchesIdentity(
                        matchingAppointment.data(),
                        submittedEmail,
                        new Set(viewerParticipantIds)
                    )) {
                    throw new Error('You are not authorized to check in for this meeting.')
                }

                const latest: AppointmentRecord = {
                    ...(snap.data() as AppointmentRecord),
                    id: snap.id
                }

                const session = latest.attendanceSession
                const expectedToken = safeString(session?.token)
                const sessionStatus = safeString(session?.status).toLowerCase()
                const expiresAt = toDate(session?.expiresAt)
                if (!session || expectedToken !== token) {
                    throw new Error('Invalid QR code.')
                }

                if (sessionStatus === 'closed') {
                    throw new Error('This check-in session has closed.')
                }

                if (expiresAt && dayjs(expiresAt).isBefore(dayjs())) {
                    throw new Error('This check-in link has expired.')
                }

                if (['attended', 'checked-in', 'checked-out'].includes(String(matchingAppointment.data().attendance?.status || ''))) {
                    return {
                        alreadyCheckedIn: true,
                        updatedRecord: latest
                    }
                }

                const currentSummary = latest.attendanceSummary || {}
                const nextCount = Number(currentSummary.checkedInCount || 0) + 1
                transaction.update(matchingAppointmentRef, {
                    attendance: { status: 'attended', checkedInAt: now, checkedOutAt: null },
                    smeConfirmation: 'confirmed',
                    updatedAt: now
                })
                transaction.update(meetingRef, {
                    attendanceSummary: {
                        ...currentSummary,
                        checkedInCount: nextCount,
                        attendedCount: Math.max(Number(currentSummary.attendedCount || 0), nextCount)
                    },
                    updatedAt: now
                })

                return {
                    alreadyCheckedIn: false,
                    updatedRecord: {
                        ...latest,
                        attendanceSummary: { ...currentSummary, checkedInCount: nextCount }
                    } as AppointmentRecord
                }
            })

            setCheckedInEmail(submittedEmail)
            setViewerEmail(submittedEmail)
            setViewerName(submittedName)

            if (result?.updatedRecord) {
                setAppointment(result.updatedRecord)
            }

            if (result?.alreadyCheckedIn) {
                setState('already_checked_in')
                setStatusMessage('You were already checked in for this meeting.')
                message.success('Already checked in.')
            } else {
                setState('success')
                setStatusMessage('Attendance confirmed successfully.')
                message.success('Attendance confirmed.')
            }
        } catch (error) {
            console.error('Check-in failed:', error)
            message.error(normalizeError(error, 'Failed to complete check-in.'))
        } finally {
            setSubmitting(false)
        }
    }

    const renderMeetingMeta = () => {
        if (!appointment) return null

        const isGroupedMeeting = appointment.sessionType === 'group'

        const venueText =
            appointment.deliveryMethod === 'virtual' || appointment.meetingLink
                ? 'Online meeting'
                : safeString(appointment.location || 'Not specified')

        return (
            <Card
                style={{
                    borderRadius: 14,
                    border: '1px solid #e6efff',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.08)',
                    width: '100%'
                }}
            >
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div>
                        <Title level={4} style={{ marginBottom: 4 }}>
                            {safeString(
                                appointment.title || 'Meeting Check-in'
                            )}
                        </Title>
                        <Text type="secondary">
                            {safeString(
                                appointment.interventionTitle || 'Intervention Meeting'
                            )}
                        </Text>
                    </div>

                    <Descriptions bordered size="small" column={1}>
                        {isGroupedMeeting ? (
                            <Descriptions.Item label="Meeting">
                                {safeString(
                                    appointment.interventionTitle || 'Group Meeting'
                                )}
                            </Descriptions.Item>
                        ) : (
                            <Descriptions.Item label="Participant">
                                {safeString(viewerName || '-')}
                            </Descriptions.Item>
                        )}

                        <Descriptions.Item label="Meeting Time">
                            {getMeetingStart(appointment)
                                ? getMeetingStart(appointment)?.format('DD MMM YYYY HH:mm')
                                : formatDateTime(appointment.startAt)}
                        </Descriptions.Item>

                        <Descriptions.Item label="Venue">
                            {venueText}
                        </Descriptions.Item>

                        <Descriptions.Item label="Attendance list">
                            {invitedCount
                                ? `${invitedCount} invited ${invitedCount === 1 ? 'participant' : 'participants'}`
                                : 'Loading attendance list'}
                        </Descriptions.Item>
                    </Descriptions>
                </Space>
            </Card>
        )
    }

    if (loadingMeeting || state === 'loading') {
        return (
            <div
                style={{
                    minHeight: '100vh',
                    display: 'grid',
                    placeItems: 'center',
                    padding: 16,
                    background: '#f5f8ff'
                }}
            >
                <Card
                    style={{
                        width: '100%',
                        maxWidth: 720,
                        borderRadius: 16,
                        border: '1px solid #e6efff',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.08)'
                    }}
                >
                    <Space
                        direction="vertical"
                        size={16}
                        style={{ width: '100%', alignItems: 'center' }}
                    >
                        <Spin size="large" />
                        <Title level={4} style={{ margin: 0 }}>
                            Validating check-in
                        </Title>
                        <Text type="secondary">
                            Please wait while we verify this meeting link.
                        </Text>
                    </Space>
                </Card>
            </div>
        )
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                padding: 16,
                background: 'linear-gradient(180deg, #f5f8ff 0%, #ffffff 100%)'
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 980,
                    margin: '0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '0 16px'
                }}
            >
                <Space
                    direction="vertical"
                    size={16}
                    style={{
                        width: '100%',
                        maxWidth: 980,
                        alignItems: 'center'
                    }}
                >
                    {renderMeetingMeta()}

                    {state === 'login_required' && (
                        <Result
                            status="info"
                            title="Taking you to sign in"
                            subTitle="Sign in to continue your check-in. You will return to this QR session automatically."
                            icon={<LockOutlined />}
                        />
                    )}

                    {state === 'needs_details' && (
                        <Card
                            style={{
                                borderRadius: 14,
                                border: '1px solid #e6efff',
                                boxShadow: '0 12px 32px rgba(0,0,0,0.08)',
                                width: '100%'
                            }}
                        >
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                <Alert type="info" showIcon message={statusMessage} />

                                <Form layout="vertical" form={form} onFinish={submitCheckIn}>
                                    <Form.Item
                                        label="Full Name"
                                        name="fullName"
                                        rules={[
                                            { required: true, message: 'Full name is required.' }
                                        ]}
                                    >
                                        <Input placeholder="Enter your full name" />
                                    </Form.Item>

                                    <Space>
                                        <Button
                                            shape="round"
                                            variant="filled"
                                            color="geekblue"
                                            style={{ border: '1px solid dodgerblue' }}
                                            htmlType="submit"
                                            loading={submitting}
                                        >
                                            Confirm Attendance
                                        </Button>

                                        <Button
                                            danger
                                            shape="round"
                                            variant="filled"
                                            onClick={() => navigate(-1)}
                                        >
                                            Cancel
                                        </Button>
                                    </Space>
                                </Form>
                            </Space>
                        </Card>
                    )}

                    {state === 'ready_to_submit' && (
                        <Card
                            style={{
                                borderRadius: 14,
                                border: '1px solid #e6efff',
                                boxShadow: '0 12px 32px rgba(0,0,0,0.08)',
                                width: '100%'
                            }}
                        >
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                <Alert type="success" showIcon message={statusMessage} />

                                <Form layout="vertical" form={form} onFinish={submitCheckIn}>
                                    <Text type="secondary">
                                        Your identity has been verified. Confirm when you are ready.
                                    </Text>

                                    <Space>
                                        <Button
                                            shape="round"
                                            variant="filled"
                                            color="geekblue"
                                            style={{ border: '1px solid dodgerblue' }}
                                            htmlType="submit"
                                            loading={submitting}
                                        >
                                            Confirm Attendance
                                        </Button>

                                        <Button
                                            danger
                                            shape="round"
                                            variant="filled"
                                            style={{ border: '1px solid red' }}
                                            onClick={() => navigate(-1)}
                                        >
                                            Cancel
                                        </Button>
                                    </Space>
                                </Form>
                            </Space>
                        </Card>
                    )}

                    {state === 'success' && (
                        <Result
                            status="success"
                            title="Attendance confirmed"
                            subTitle={statusMessage}
                            icon={<CheckCircleOutlined />}
                            extra={
                                <Space direction="vertical" size={12}>
                                    <Space wrap>
                                        <Button
                                            type="primary"
                                            onClick={() => navigate('/incubatee')}
                                        >
                                            Continue
                                        </Button>

                                        <Button
                                            danger
                                            onClick={() => {
                                                window.location.href = '/login'
                                            }}
                                        >
                                            Log out
                                        </Button>

                                        <Button onClick={() => window.close()}>
                                            Close
                                        </Button>
                                    </Space>
                                </Space>
                            }
                        />
                    )}

                    {state === 'already_checked_in' && (
                        <Result
                            status="success"
                            title="Already checked in"
                            subTitle={statusMessage}
                            icon={<CheckCircleOutlined />}
                            extra={
                                <Space direction="vertical" size={12}>
                                    <Space wrap>
                                        <Button
                                            shape="round"
                                            variant="filled"
                                            color="geekblue"
                                            style={{ border: '1px solid dodgerblue' }}
                                            onClick={() => navigate('/incubatee')}
                                        >
                                            Continue
                                        </Button>

                                        <Button
                                            danger
                                            variant="filled"
                                            shape="round"
                                            style={{ border: '1px solid red' }}
                                            onClick={() => {
                                                window.location.href = '/login'
                                            }}
                                        >
                                            Log out
                                        </Button>
                                    </Space>
                                </Space>
                            }
                        />
                    )}

                    {state === 'not_invited' && (
                        <Result
                            status="error"
                            title="You are not part of this meeting"
                            subTitle={statusMessage}
                            icon={<CloseCircleOutlined />}
                            extra={
                                <Space wrap>
                                    <Button
                                        type="primary"
                                        icon={<LoginOutlined />}
                                        onClick={() => navigate('/login')}
                                    >
                                        Continue to System
                                    </Button>
                                </Space>
                            }
                        />
                    )}

                    {state === 'expired' && (
                        <Result
                            status="warning"
                            title="Check-in expired"
                            subTitle={statusMessage}
                        />
                    )}

                    {state === 'closed' && (
                        <Result
                            status="warning"
                            title="Check-in closed"
                            subTitle={statusMessage}
                        />
                    )}

                    {state === 'invalid' && (
                        <Result
                            status="404"
                            title="Invalid check-in link"
                            subTitle={statusMessage}
                        />
                    )}

                    {state === 'error' && (
                        <Result
                            status="error"
                            title="Check-in failed"
                            subTitle={statusMessage}
                        />
                    )}
                </Space>
            </div>
        </div>
    )
}

export default MeetingCheckInPage
