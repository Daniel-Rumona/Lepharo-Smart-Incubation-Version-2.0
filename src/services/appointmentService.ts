import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import {
    collection,
    doc,
    getDocs,
    query,
    Timestamp,
    type QueryConstraint,
    where,
    writeBatch,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'

dayjs.extend(customParseFormat)

export type AppointmentRecord = {
    id: string
    [key: string]: any
}

export type AppointmentMember = {
    id?: string
    assignedInterventionId?: string
    participantId?: string
    participantName?: string
    participantEmail?: string
    smeId?: string
    smeName?: string
    smeEmail?: string
    beneficiaryName?: string
    email?: string
    smeConfirmation?: string
    userConfirmation?: string
    beneficiaryConfirmation?: string
    confirmationStatus?: string
    appointmentResponseStatus?: AppointmentResponseStatus
    status?: string
    smeDeclineReason?: string | null
    declineReason?: string | null
    userRejectionReason?: string | null
    foodSelections?: any[]
    checkedIn?: boolean
    checkedOut?: boolean
    attendanceStatus?: AttendanceStatus
    [key: string]: any
}

export type AppointmentResponseStatus = 'pending' | 'confirmed' | 'declined' | 'unknown'
export type AttendanceStatus = 'checked-in' | 'checked-out' | 'absent' | 'expected' | 'declined'
export type AppointmentStatus = 'scheduled' | 'in-progress' | 'completed' | 'cancelled' | string
export type DeliveryMethod = 'virtual' | 'in_person' | 'telephonically' | 'hybrid' | string

export type AppointmentQuery = {
    departmentId?: string | null
    departmentIds?: string[]
    programId?: string | null
    assigneeId?: string | null
    assigneeIds?: string[]
    assigneeEmail?: string | null
    coordinatorId?: string | null
    participantId?: string | null
}

export type AppointmentActor = {
    ids: string[]
    email: string
    role: string
    preferredId: string
}

const lower = (value: any) =>
    String(value || '')
        .trim()
        .toLowerCase()
const compact = (values: unknown[]) =>
    Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))

export const getAppointmentAssigneeId = (appointment?: AppointmentRecord | null) =>
    String(appointment?.assigneeId || '').trim()

export const getAppointmentAssigneeName = (appointment?: AppointmentRecord | null) =>
    String(appointment?.assigneeName || '').trim()

export const getAppointmentAssigneeEmail = (appointment?: AppointmentRecord | null) =>
    lower(appointment?.assigneeEmail)

export const getAppointmentDeclineReason = (
    appointment?: AppointmentRecord | AppointmentMember | null
) =>
    String(
        appointment?.smeDeclineReason ||
            appointment?.declineReason ||
            appointment?.userRejectionReason ||
            appointment?.smeRescheduleRequest?.reasonText ||
            appointment?.rescheduleRequest?.reasonText ||
            appointment?.declineReasonDetails ||
            appointment?.declineReasonLabel ||
            ''
    ).trim()

export const getAppointmentAssigneeRole = (appointment?: AppointmentRecord | null) => {
    const role = normalizeStatus(appointment?.assigneeRole || '')
    if (['consultant', 'project-manager', 'projectmanager'].includes(role)) return 'coordinator'
    return role || 'coordinator'
}

export const getAppointmentParticipantId = (
    appointment?: AppointmentRecord | AppointmentMember | null
) => String(appointment?.smeId || appointment?.participantId || '').trim()

export const getAppointmentParticipantName = (
    appointment?: AppointmentRecord | AppointmentMember | null
) =>
    String(
        appointment?.smeName ||
            appointment?.participantName ||
            appointment?.beneficiaryName ||
            appointment?.snapshot?.beneficiaryName ||
            ''
    ).trim()

export const getAppointmentParticipantEmail = (
    appointment?: AppointmentRecord | AppointmentMember | null
) => lower(appointment?.smeEmail || appointment?.participantEmail || appointment?.email)

export const normalizeAppointmentRecord = (
    id: string,
    data: Record<string, any>
): AppointmentRecord => {
    const source = data as AppointmentRecord
    const response = getAppointmentResponseStatus(source)

    return {
        ...data,
        id,
        participantId: getAppointmentParticipantId(source),
        participantName: getAppointmentParticipantName(source),
        participantEmail: getAppointmentParticipantEmail(source),
        assigneeId: getAppointmentAssigneeId(source),
        assigneeName: getAppointmentAssigneeName(source),
        assigneeEmail: getAppointmentAssigneeEmail(source),
        assigneeRole: getAppointmentAssigneeRole(source),
        status: getAppointmentStatus(source),
        appointmentResponseStatus: response,
        // Read-only compatibility aliases for components that still expect the
        // pre-v5 appointment shape. Canonical Firestore v5 remains smeConfirmation.
        userConfirmation: response === 'unknown' ? source.userConfirmation : response,
        beneficiaryConfirmation: response === 'unknown' ? source.beneficiaryConfirmation : response,
        deliveryMethod: getDeliveryMethod(source),
        meetingLink: getMeetingLink(source),
        location: getLocation(source),
        declineReason: getAppointmentDeclineReason(source),
    }
}

export const appointmentBelongsToAssignee = (
    appointment: AppointmentRecord,
    actor: Pick<AppointmentActor, 'ids' | 'email'>
) => {
    const ids = new Set(compact(actor.ids))
    const appointmentIds = compact([appointment.assigneeId])
    if (appointmentIds.some((id) => ids.has(id))) return true
    return Boolean(actor.email && getAppointmentAssigneeEmail(appointment) === lower(actor.email))
}

export async function resolveAppointmentActor(
    user: Record<string, any>
): Promise<AppointmentActor> {
    const email = lower(user?.email)
    const role = normalizeStatus(user?.role)
    const ids = compact([
        user?.uid,
        user?.id,
        user?.profileId,
        user?.assigneeId,
        user?.coordinatorDocId,
        user?.operationsDocId,
    ])

    if (email) {
        const collections = role === 'operations' ? ['operationsStaff'] : ['coordinators']
        const results = await Promise.allSettled(
            collections.map((name) => getDocs(collection(db, name)))
        )
        results.forEach((result) => {
            if (result.status !== 'fulfilled') return
            result.value.forEach((item) => {
                if (lower(item.data()?.email) === email) ids.push(item.id)
            })
        })
    }

    const uniqueIds = compact(ids)
    return {
        ids: uniqueIds,
        email,
        role,
        preferredId:
            uniqueIds.find((id) => id !== user?.uid && id !== user?.id) || uniqueIds[0] || '',
    }
}

export const titleCase = (value?: string) => {
    const text = String(value || '').trim()
    if (!text) return '-'
    return text
        .replace(/[-_]/g, ' ')
        .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
}

export const normalizeStatus = (value?: string) => lower(value).replace(/\s|_/g, '-')

export const getConfirmationStatus = (value?: string): AppointmentResponseStatus => {
    const status = normalizeStatus(value)
    if (['confirmed', 'accepted', 'approved', 'yes', 'attended'].includes(status))
        return 'confirmed'
    if (['pending', 'awaiting', 'invited', 'requested', 'scheduled'].includes(status))
        return 'pending'
    if (['declined', 'rejected', 'no', 'cancelled', 'canceled'].includes(status)) return 'declined'
    return 'unknown'
}

/**
 * Canonical appointment-response resolver.
 *
 * v5 appointments store the SME's response in `smeConfirmation`. Older
 * appointment documents used `userConfirmation` / `beneficiaryConfirmation`.
 * Consumers should use this helper instead of reading those fields directly.
 */
export const getAppointmentResponseStatus = (
    appointment?: AppointmentRecord | AppointmentMember | null
): AppointmentResponseStatus => {
    if (!appointment) return 'unknown'

    return getConfirmationStatus(
        appointment.smeConfirmation ||
            appointment.appointmentResponseStatus ||
            appointment.userConfirmation ||
            appointment.beneficiaryConfirmation ||
            appointment.confirmationStatus
    )
}

export const getAppointmentStatus = (
    appointmentOrStatus?: AppointmentRecord | string | null
): AppointmentStatus => {
    const raw =
        typeof appointmentOrStatus === 'string' ? appointmentOrStatus : appointmentOrStatus?.status
    const status = normalizeStatus(raw)
    if (status === 'in_progress') return 'in-progress'
    return status || 'scheduled'
}

const dateKey = (appointment?: AppointmentRecord | null) => {
    const raw =
        appointment?.date ||
        appointment?.schedule?.dateKey ||
        appointment?.sessionDate ||
        appointment?.startAt ||
        appointment?.schedule?.startAt ||
        appointment?.startTime

    if (!raw) return ''

    const fromFirestore = firestoreDate(raw)
    if (fromFirestore) return dayjs(fromFirestore).format('YYYY-MM-DD')

    const strict = dayjs(String(raw), ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY'], true)
    const parsed = strict.isValid() ? strict : dayjs(raw)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : String(raw)
}

const firestoreDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    if (typeof value === 'object' && typeof value.seconds === 'number')
        return new Date(value.seconds * 1000)
    return null
}

const parseDateTime = (value: any, key: string): { date: Dayjs | null; hasTime: boolean } => {
    if (!value) return { date: null, hasTime: false }
    const raw = typeof value === 'string' ? value.trim() : ''
    if (raw && /^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i.test(raw) && key) {
        const time = dayjs(
            raw.toUpperCase(),
            ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'hh:mm A'],
            true
        )
        const combined = dayjs(`${key} ${time.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
        return { date: combined.isValid() ? combined : null, hasTime: combined.isValid() }
    }
    const fromFirestore = firestoreDate(value)
    const parsed = fromFirestore ? dayjs(fromFirestore) : dayjs(value)
    if (!parsed.isValid()) return { date: null, hasTime: false }
    const hasTime = parsed.hour() !== 0 || parsed.minute() !== 0 || parsed.second() !== 0
    if (key && hasTime) {
        const combined = dayjs(`${key} ${parsed.format('HH:mm')}`, 'YYYY-MM-DD HH:mm', true)
        return { date: combined.isValid() ? combined : parsed, hasTime: true }
    }
    return { date: parsed, hasTime }
}

const resolveFirst = (appointment: AppointmentRecord, candidates: any[]) => {
    const key = dateKey(appointment)
    for (const value of candidates) {
        const resolved = parseDateTime(value, key)
        if (resolved.date?.isValid() && resolved.hasTime) return resolved
    }
    for (const value of candidates) {
        const resolved = parseDateTime(value, key)
        if (resolved.date?.isValid()) return resolved
    }
    const fallback = key ? dayjs(key, 'YYYY-MM-DD', true) : null
    return { date: fallback?.isValid() ? fallback : null, hasTime: false }
}

export const resolveAppointmentStart = (appointment: AppointmentRecord) =>
    resolveFirst(appointment, [
        appointment.startTime,
        appointment.startAt,
        appointment.schedule?.startTime,
        appointment.schedule?.startAt,
        appointment.sessionStartTime,
    ])

export const resolveAppointmentEnd = (appointment: AppointmentRecord) =>
    resolveFirst(appointment, [
        appointment.endTime,
        appointment.endAt,
        appointment.schedule?.endTime,
        appointment.schedule?.endAt,
        appointment.sessionEndTime,
    ])

export const getAppointmentDate = (appointment: AppointmentRecord) => {
    const key = dateKey(appointment)
    const parsed = key ? dayjs(key, 'YYYY-MM-DD', true) : resolveAppointmentStart(appointment).date
    return parsed?.isValid() ? parsed : null
}

export async function acceptAppointmentRescheduleProposal(input: {
    appointment: AppointmentRecord
    proposal: Record<string, any>
    actor: { id?: string; name?: string; email?: string }
}) {
    const appointmentId = String(input.appointment?.id || '').trim()
    const start = firestoreDate(input.proposal?.startTime)
    const end = firestoreDate(input.proposal?.endTime)
    const sessionId = String(input.appointment?.appointmentSessionId || '').trim()

    if (!appointmentId || !sessionId || !start || !end) {
        throw new Error('The selected proposed time is incomplete.')
    }
    if (end.getTime() <= start.getTime()) {
        throw new Error('The proposed end time must be after its start time.')
    }

    const acceptedAt = Timestamp.now()
    const batch = writeBatch(db)

    batch.update(doc(db, 'appointments', appointmentId), {
        smeConfirmation: 'pending',
        smeDeclineReason: null,
        smeRescheduleRequest: {
            ...(input.appointment?.smeRescheduleRequest || {}),
            status: 'accepted',
            acceptedProposalId: String(input.proposal?.id || '') || null,
            decidedAt: acceptedAt,
        },
        attendance: { status: 'expected', checkedInAt: null, checkedOutAt: null },
        updatedAt: acceptedAt,
    })
    batch.update(doc(db, 'appointmentSessions', sessionId), {
        startAt: Timestamp.fromDate(start),
        endAt: Timestamp.fromDate(end),
        updatedAt: acceptedAt,
    })

    await batch.commit()
}

export const formatAppointmentDate = (appointment?: AppointmentRecord | null) =>
    appointment ? getAppointmentDate(appointment)?.format('DD MMM YYYY') || '-' : '-'

export const formatAppointmentTime = (appointment?: AppointmentRecord | null) => {
    if (!appointment) return 'Time not set'
    const start = resolveAppointmentStart(appointment)
    const end = resolveAppointmentEnd(appointment)
    if (!start.date?.isValid() || !start.hasTime) return 'Time not set'
    return end.date?.isValid() && end.hasTime
        ? `${start.date.format('HH:mm')} - ${end.date.format('HH:mm')}`
        : start.date.format('HH:mm')
}

export const getAppointmentTitle = (appointment?: AppointmentRecord | null) =>
    String(
        appointment?.sessionTitle ||
            appointment?.groupTitle ||
            appointment?.interventionTitle ||
            appointment?.title ||
            appointment?.snapshot?.interventionTitle ||
            'Appointment'
    )

export const getDeliveryMethod = (appointment?: AppointmentRecord | null): DeliveryMethod => {
    const raw = lower(appointment?.deliveryMethod || appointment?.delivery?.mode)
    if (raw === 'online') return 'virtual'
    if (raw === 'in-person' || raw === 'in person') return 'in_person'
    if (raw === 'telephonic' || raw === 'telephone') return 'telephonically'
    return raw
}

export const formatDeliveryMethod = (appointmentOrMethod?: AppointmentRecord | string | null) => {
    const method =
        typeof appointmentOrMethod === 'string'
            ? getDeliveryMethod({ id: 'display', deliveryMethod: appointmentOrMethod })
            : getDeliveryMethod(appointmentOrMethod)
    if (method === 'in_person') return 'In Person'
    if (method === 'telephonically') return 'Telephonic'
    if (method === 'virtual') return 'Virtual'
    if (method === 'hybrid') return 'Hybrid'
    return titleCase(method) || '-'
}

export const formatAppointmentStatus = (
    appointmentOrStatus?: AppointmentRecord | string | null
) => {
    const status = getAppointmentStatus(appointmentOrStatus)
    if (status === 'in-progress') return 'In Progress'
    return titleCase(status)
}

export const getMeetingLink = (appointment?: AppointmentRecord | null) =>
    String(appointment?.meetingLink || appointment?.delivery?.meeting?.link || '').trim()

export const getLocation = (appointment?: AppointmentRecord | null) =>
    String(
        appointment?.location ||
            appointment?.delivery?.location?.venue ||
            appointment?.delivery?.location?.address ||
            ''
    ).trim()

const emails = (
    appointment: AppointmentRecord | null | undefined,
    kind: 'checkedInEmails' | 'checkedOutEmails'
) =>
    Array.from(
        new Set(
            [
                ...((appointment?.attendance?.summary?.[kind] as string[]) || []),
                ...((appointment?.attendanceSummary?.[kind] as string[]) || []),
            ]
                .map((value) => lower(value))
                .filter(Boolean)
        )
    )

export const checkedInEmails = (appointment?: AppointmentRecord | null) =>
    emails(appointment, 'checkedInEmails')
export const checkedOutEmails = (appointment?: AppointmentRecord | null) =>
    emails(appointment, 'checkedOutEmails')

export const isPastAppointment = (appointment?: AppointmentRecord | null, now = dayjs()) => {
    if (!appointment) return false
    const end = resolveAppointmentEnd(appointment)
    const start = resolveAppointmentStart(appointment)
    const boundary = end.date?.isValid() && end.hasTime ? end.date : start.date
    return Boolean(boundary?.isValid() && boundary.isBefore(now))
}

export const getAttendanceStatus = (
    member: AppointmentMember,
    appointment: AppointmentRecord,
    now = dayjs()
): AttendanceStatus => {
    const email = getAppointmentParticipantEmail(member)
    const checkedIn =
        Boolean(member.checkedIn) ||
        member.attendance?.status === 'attended' ||
        (!!email && checkedInEmails(appointment).includes(email))
    const checkedOut =
        Boolean(member.checkedOut) ||
        member.attendance?.status === 'checked-out' ||
        (!!email && checkedOutEmails(appointment).includes(email))
    if (checkedOut) return 'checked-out'
    if (checkedIn) return 'checked-in'
    if (getAppointmentResponseStatus(member) === 'declined') return 'declined'
    // A past invite with neither confirmation nor a check-in is a no-show.
    if (isPastAppointment(appointment, now)) return 'absent'
    return 'expected'
}

export const getAppointmentMembers = (
    appointment?: AppointmentRecord | null
): AppointmentMember[] => {
    if (!appointment) return []

    const stored = appointment._groupMembers?.length
        ? appointment._groupMembers
        : appointment.groupMembers

    const members: AppointmentMember[] =
        Array.isArray(stored) && stored.length
            ? stored
            : getAppointmentParticipantId(appointment) || getAppointmentParticipantName(appointment)
            ? [
                  {
                      id: appointment.id,
                      assignedInterventionId: appointment.assignedInterventionId,
                      participantId: getAppointmentParticipantId(appointment),
                      participantName: getAppointmentParticipantName(appointment),
                      participantEmail: getAppointmentParticipantEmail(appointment),
                      smeId: appointment.smeId,
                      smeName: appointment.smeName,
                      smeEmail: appointment.smeEmail,
                      smeConfirmation: appointment.smeConfirmation,
                      userConfirmation: appointment.userConfirmation,
                      beneficiaryConfirmation: appointment.beneficiaryConfirmation,
                      appointmentResponseStatus: getAppointmentResponseStatus(appointment),
                      smeDeclineReason: appointment.smeDeclineReason,
                      declineReason: getAppointmentDeclineReason(appointment),
                      status: appointment.status,
                      attendance: appointment.attendance,
                      foodSelections: appointment.foodSelections || [],
                  },
              ]
            : []

    return members.map((member) => {
        const normalized: AppointmentMember = {
            ...member,
            participantId: getAppointmentParticipantId(member),
            participantName: getAppointmentParticipantName(member),
            participantEmail: getAppointmentParticipantEmail(member),
            appointmentResponseStatus: getAppointmentResponseStatus(member),
            declineReason: getAppointmentDeclineReason(member),
        }

        return {
            ...normalized,
            attendanceStatus: getAttendanceStatus(normalized, appointment),
        }
    })
}

export const isGroupAppointment = (appointment?: AppointmentRecord | null) =>
    Boolean(
        appointment?._displayType === 'group' ||
            appointment?.isGroupAppointment ||
            appointment?.allocationType === 'group' ||
            getAppointmentMembers(appointment).length > 1
    )

export const getMemberCount = (appointment?: AppointmentRecord | null) =>
    Number(
        appointment?.groupParticipantCount ||
            appointment?.groupMemberCount ||
            getAppointmentMembers(appointment).length ||
            0
    )

const appointmentTimeKey = (value: any) => {
    const date = firestoreDate(value) || (value ? new Date(value) : null)
    return date && !Number.isNaN(date.getTime()) ? String(date.getTime()) : String(value || '')
}

export const buildAppointmentGroupKey = (input: {
    groupKey?: string | null
    date?: string | null
    startTime?: any
    endTime?: any
    assigneeId?: string | null
    coordinatorId?: string | null
}) =>
    [
        String(input.groupKey || 'adhoc').trim(),
        String(input.date || '').trim(),
        appointmentTimeKey(input.startTime),
        appointmentTimeKey(input.endTime),
        String(input.assigneeId || input.coordinatorId || '').trim(),
    ].join('__')

/** The intervention-assignment group. Empty for ad-hoc appointment groups. */
export const getInterventionGroupKey = (appointment?: AppointmentRecord | null) =>
    String(appointment?.groupKey || '').trim()

/** The scheduled session identity used to roll per-SME documents into one appointment. */
export const getAppointmentGroupKey = (appointment: AppointmentRecord) => {
    // Canonical v5 records are grouped by their actual session document. Two
    // separately-created sessions can legitimately share a group, date and
    // time; merging them makes every SME appear twice.
    const memberCount = Number(
        appointment.groupParticipantCount || appointment.groupMemberCount || 0
    )
    const hasMultipleMembers =
        Array.isArray(appointment.groupMembers) && appointment.groupMembers.length > 1
    const isGroup = Boolean(
        appointment.appointmentGroupKey ||
            appointment.groupKey ||
            appointment.groupId ||
            appointment.sessionGroupId ||
            appointment.isGroupAppointment ||
            appointment.allocationType === 'group' ||
            memberCount > 1 ||
            hasMultipleMembers
    )
    if (!isGroup) return ''
    if (appointment.appointmentSessionId) {
        return `session-${String(appointment.appointmentSessionId).trim()}`
    }
    return String(
        appointment.appointmentGroupKey ||
            buildAppointmentGroupKey({
                groupKey: appointment.groupKey || appointment.groupId || appointment.sessionGroupId,
                date: dateKey(appointment),
                startTime: resolveAppointmentStart(appointment).date?.toDate(),
                endTime: resolveAppointmentEnd(appointment).date?.toDate(),
                assigneeId: getAppointmentAssigneeId(appointment),
            })
    ).trim()
}

// Backwards-compatible export name; its meaning is now unambiguously the session key.
export const getGroupKey = getAppointmentGroupKey

export const groupAppointments = (appointments: AppointmentRecord[]) => {
    const output: AppointmentRecord[] = []
    const groups = new Map<string, AppointmentRecord[]>()
    appointments.forEach((appointment) => {
        const key = getGroupKey(appointment)
        if (!key) output.push(appointment)
        else groups.set(key, [...(groups.get(key) || []), appointment])
    })
    groups.forEach((rows) => {
        const first = rows[0]
        const members = rows.flatMap((row) => getAppointmentMembers(row))
        const merged = {
            ...first,
            _displayType: 'group',
            _groupMembers: members,
            isGroupAppointment: true,
            allocationType: 'group',
            groupMemberCount: members.length,
            // Attendance is collected from every per-SME appointment document.
            attendanceSummary: {
                ...(first.attendanceSummary || {}),
                checkedInEmails: Array.from(new Set(rows.flatMap(checkedInEmails))),
                checkedOutEmails: Array.from(new Set(rows.flatMap(checkedOutEmails))),
            },
        }
        merged._groupMembers = members.map((member, index) => ({
            ...member,
            attendanceStatus: getAttendanceStatus(member, rows[index] || merged),
        }))
        output.push(merged)
    })
    return output
}

export const getAppointmentTopics = (appointment?: AppointmentRecord | null) => {
    if (!appointment)
        return {
            planned: [] as string[],
            covered: [] as string[],
            held: undefined as boolean | undefined,
            notes: '',
            reason: '',
        }
    const latest = appointment.sessionCoverage?.latest
    const meeting = appointment.meetingNotes?.latest
    return {
        planned: (
            appointment.plannedCoverage ||
            appointment.sessionCoverage?.plannedCoverage ||
            []
        ).filter(Boolean),
        covered: (latest?.coveredPoints || []).filter(Boolean),
        held: latest?.held ?? meeting?.held,
        notes: String(meeting?.discussed || appointment.description || '').trim(),
        reason: String(latest?.reasonNotHeld || meeting?.reasonNotHeld || '').trim(),
    }
}

export const getAppointmentMetrics = (appointment?: AppointmentRecord | null) => {
    const members = getAppointmentMembers(appointment)
    return {
        total: getMemberCount(appointment),
        confirmed: members.filter((member) => getAppointmentResponseStatus(member) === 'confirmed')
            .length,
        checkedIn: members.filter((member) =>
            ['checked-in', 'checked-out'].includes(member.attendanceStatus || '')
        ).length,
        absent: members.filter((member) => member.attendanceStatus === 'absent').length,
    }
}

export async function fetchAppointments(filters: AppointmentQuery): Promise<AppointmentRecord[]> {
    const requestedAssigneeIds = compact([
        ...(filters.assigneeIds || []),
        filters.assigneeId,
        filters.coordinatorId,
    ])
    if (
        !filters.departmentId &&
        !filters.departmentIds?.length &&
        !requestedAssigneeIds.length &&
        !filters.assigneeEmail &&
        !filters.participantId &&
        !filters.programId
    )
        return []
    const constraints: QueryConstraint[] = []
    if (filters.departmentId) constraints.push(where('departmentId', '==', filters.departmentId))
    const snap = await getDocs(query(collection(db, 'appointments'), ...constraints))
    const canonicalViews = await hydrateAppointmentViews(
        snap.docs.map((item) => ({ id: item.id, data: item.data() as any }))
    )
    return canonicalViews
        .map((item) => normalizeAppointmentRecord(item.id, item))
        .filter(
            (item) =>
                !filters.departmentId || String(item.departmentId || '') === filters.departmentId
        )
        .filter(
            (item) =>
                !filters.departmentIds?.length ||
                filters.departmentIds.includes(String(item.departmentId || ''))
        )
        .filter((item) => !filters.programId || String(item.programId || '') === filters.programId)
        .filter(
            (item) =>
                (!requestedAssigneeIds.length && !filters.assigneeEmail) ||
                appointmentBelongsToAssignee(item, {
                    ids: requestedAssigneeIds,
                    email: String(filters.assigneeEmail || ''),
                })
        )
        .filter(
            (item) =>
                !filters.participantId || String(item.participantId || '') === filters.participantId
        )
}
