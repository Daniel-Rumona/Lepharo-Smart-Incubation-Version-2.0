import dayjs, { type Dayjs } from 'dayjs'
import {
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    query as fsQuery,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { normalizeAssignmentGroupKey } from '@/lib/assignmentIdentity'
import { assignmentCanOwnAppointment, distinctAppointmentAssignments } from '@/lib/appointmentAssignments'
import { toAssignedInterventionView } from '@/services/assignedInterventionService'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import { departmentUsesTrainingCoverage, type DepartmentCapabilityRecord } from '@/services/departmentCapabilities'
import {
    AppointmentSessionAlreadyExistsError,
    checkScheduleClash,
    scheduleAppointmentSession
} from '@/services/appointmentSchedulingService'

/*
 * Coordinator appointment scheduling for the chat agent.
 *
 * The rules and payload shapes below deliberately mirror the individual-mode
 * branch of handleAddAppointment in src/routes/shared/appointments/index.tsx
 * (that page keeps its own inline copies). The write itself goes through the
 * shared scheduleAppointmentSession boundary, and firestore.rules enforces the
 * exact key sets, so keep both payloads in step with the page.
 */

export type DeliveryMethod = 'in_person' | 'virtual' | 'telephonically'

export type SchedulableAssignment = Record<string, any> & { id: string }

export type SchedulableSme = {
    participantId: string
    name: string
    companyName: string
    photoUrl: string
    assignments: SchedulableAssignment[]
}

export type AppointmentFormValues = {
    sessionTitle?: string
    plannedCoverage?: string
    plannedTopics?: string[]
    deliveryMethod?: DeliveryMethod
    location?: string
    meetingLink?: string
    startsAt?: Dayjs | null
    endsAt?: Dayjs | null
}

export type BuiltAppointment = {
    session: Record<string, any>
    invitation: Record<string, any>
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const clean = (value: unknown) => String(value ?? '').trim()

export const coverageWordCount = (value: unknown) =>
    String(value || '').trim().split(/\s+/).filter(Boolean).length

const toDateSafe = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value?.seconds) return new Date(value.seconds * 1000)
    if (value instanceof Date) return value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const NON_CYCLE_VALUES = new Set([
    'once', 'one-time', 'one_time', 'single', 'single-cycle', 'single_cycle', 'daily',
    'weekly', 'biweekly', 'bi-weekly', 'monthly', 'quarterly', 'annually', 'annual', 'other'
])

const formatCycleLabel = (value: any) => {
    const dateValue = toDateSafe(value)
    if (dateValue) return dayjs(dateValue).format('MMMM YYYY')
    const raw = clean(value)
    if (!raw || NON_CYCLE_VALUES.has(raw.toLowerCase())) return ''
    const yearMonth = raw.match(/^(\d{4})[-_/](\d{1,2})(?:\D|$)/)
    if (yearMonth && Number(yearMonth[2]) >= 1 && Number(yearMonth[2]) <= 12) {
        return dayjs(`${yearMonth[1]}-${yearMonth[2]}-01`).format('MMMM YYYY')
    }
    const monthYear = raw.match(/^(\d{1,2})[-_/](\d{4})(?:\D|$)/)
    if (monthYear && Number(monthYear[1]) >= 1 && Number(monthYear[1]) <= 12) {
        return dayjs(`${monthYear[2]}-${monthYear[1]}-01`).format('MMMM YYYY')
    }
    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('MMMM YYYY') : raw
}

const cycleKeyOf = (row: any) =>
    clean(row?.cycleKey || row?.recurringCycleKey || row?.seriesCycleKey)

/** The cycle stored on the appointment: the assignment's own, else the month it is due. */
export const assignmentCycleStorageKey = (row: any) => {
    const direct = cycleKeyOf(row)
    if (formatCycleLabel(direct)) return direct
    const source = row?.dueDate || direct
    const dateValue = toDateSafe(source)
    if (dateValue) return dayjs(dateValue).format('YYYY-MM')
    const raw = clean(source)
    return formatCycleLabel(raw) ? raw : ''
}

const isSchedulableStatus = (row: any) =>
    ['assigned', 'in-progress', 'in_progress', 'ongoing', 'active'].includes(norm(row?.assignmentStatus))

export const isSingleSmeAssignment = (row: any) => !normalizeAssignmentGroupKey(row)

/* ------------------------------------------------------------------ */
/* Loading the SMEs this coordinator can schedule                      */
/* ------------------------------------------------------------------ */

type IdentityUser = Record<string, any> | null | undefined

/** Same identity matching the appointments page uses to find a coordinator profile. */
export async function resolveCoordinatorDocId(user: IdentityUser): Promise<string | null> {
    if (!user) return null
    const identityIds = new Set(
        [user.uid, user.id, user.assigneeId, user.coordinatorId, user.coordinatorDocId, user.profileId]
            .map(clean)
            .filter(Boolean)
    )
    const email = norm(user.email)

    const snap = await getDocs(collection(db, 'coordinators'))
    for (const docSnap of snap.docs) {
        const data = docSnap.data() as any
        const migratedFrom = clean(data?.migratedFrom)
        const migratedSource = migratedFrom.includes('/') ? migratedFrom.split('/').filter(Boolean).pop() : migratedFrom
        const linked = [
            docSnap.id, data?.id, data?.uid, data?.userId, data?.authUid,
            data?.assigneeId, data?.coordinatorId, data?.legacyAssigneeId, migratedSource
        ].map(clean).filter(Boolean)
        if (linked.some(id => identityIds.has(id)) || (email && norm(data?.email) === email)) {
            return docSnap.id
        }
    }
    return null
}

const belongsToUser = (row: any, uid: string, email: string, coordinatorDocId: string | null) => {
    const assigneeId = clean(row?.assigneeId)
    return (
        assigneeId === uid ||
        (!!coordinatorDocId && assigneeId === coordinatorDocId) ||
        (!!email && norm(row?.assigneeEmail) === email)
    )
}

export async function loadSchedulableSmes(params: {
    user: IdentityUser
    activeProgramId?: string
}): Promise<SchedulableSme[]> {
    const { user, activeProgramId } = params
    const uid = clean(user?.uid || user?.id)
    if (!uid) return []
    const email = norm(user?.email)
    const coordinatorDocId = await resolveCoordinatorDocId(user)

    const assignedCol = collection(db, 'assignedInterventions')
    const scope = (...constraints: any[]) =>
        fsQuery(assignedCol, ...constraints, ...(activeProgramId ? [where('programId', '==', activeProgramId)] : []))

    const queries = [scope(where('assigneeId', '==', uid))]
    if (email) queries.push(scope(where('assigneeEmail', '==', email)))
    if (coordinatorDocId) queries.push(scope(where('assigneeId', '==', coordinatorDocId)))

    const results = await Promise.all(queries.map(async q => {
        try {
            const snap = await getDocs(q)
            return snap.docs.map(d => toAssignedInterventionView(d.id, d.data() as any))
        } catch (error) {
            console.warn('assignedInterventions query failed', error)
            return []
        }
    }))

    const rows = distinctAppointmentAssignments(
        results.flat()
            .filter(row => belongsToUser(row, uid, email, coordinatorDocId))
            .filter(row => resolveAssignmentLifecycle(row as any).isOpen)
            .filter(isSchedulableStatus)
            .filter(isSingleSmeAssignment)
            .filter(row => clean(row.participantId || (row as any).beneficiaryId))
    ) as SchedulableAssignment[]

    const byParticipant = new Map<string, SchedulableSme>()
    rows.forEach(row => {
        const pid = clean(row.participantId || row.beneficiaryId)
        const existing = byParticipant.get(pid)
        if (existing) {
            existing.assignments.push(row)
            return
        }
        byParticipant.set(pid, {
            participantId: pid,
            name: clean(row.participantName || row.beneficiaryName || pid),
            companyName: '',
            photoUrl: '',
            assignments: [row]
        })
    })

    const smes = Array.from(byParticipant.values()).sort((a, b) => a.name.localeCompare(b.name))
    await enrichSmes(smes, activeProgramId)
    return smes
}

async function enrichSmes(smes: SchedulableSme[], activeProgramId?: string) {
    if (!smes.length) return

    const emailsByParticipant = new Map<string, string>()
    const participantData = new Map<string, any>()

    await Promise.all(smes.map(async sme => {
        try {
            const snap = await getDoc(doc(db, 'participants', sme.participantId))
            const data = snap.data() as any
            if (!data) return
            participantData.set(sme.participantId, data)
            const resolved = norm(data.email || data.participantEmail || data.contactEmail || data.contactInfo?.email)
            if (resolved) emailsByParticipant.set(sme.participantId, resolved)
        } catch {
            // Photo/company are nice-to-have; the card falls back to initials and the SME name.
        }
    }))

    // Company name lives on the application; the participant doc is the fallback.
    const companyByParticipant = new Map<string, string>()
    try {
        const ids = smes.map(sme => sme.participantId)
        for (let i = 0; i < ids.length; i += 10) {
            const snap = await getDocs(fsQuery(
                collection(db, 'applications'),
                where('participantId', 'in', ids.slice(i, i + 10)),
                ...(activeProgramId ? [where('programId', '==', activeProgramId)] : [])
            ))
            snap.docs.forEach(d => {
                const data = d.data() as any
                const name = clean(data.companyName || data.businessName || data.registeredName)
                const pid = clean(data.participantId)
                if (name && pid && !companyByParticipant.has(pid)) companyByParticipant.set(pid, name)
            })
        }
    } catch (error) {
        console.warn('Could not load SME company names', error)
    }

    smes.forEach(sme => {
        const data = participantData.get(sme.participantId)
        sme.companyName =
            companyByParticipant.get(sme.participantId) ||
            clean(data?.beneficiaryName || data?.businessName || data?.companyName)
    })

    // Photos live on users/{uid}; match to SMEs by email.
    try {
        const participantsByEmail = new Map<string, string[]>()
        emailsByParticipant.forEach((email, pid) => {
            participantsByEmail.set(email, [...(participantsByEmail.get(email) || []), pid])
        })
        const emails = Array.from(participantsByEmail.keys())
        const photos = new Map<string, string>()
        for (let i = 0; i < emails.length; i += 10) {
            const snap = await getDocs(fsQuery(collection(db, 'users'), where('email', 'in', emails.slice(i, i + 10))))
            snap.docs.forEach(d => {
                const data = d.data() as any
                const url = clean(data.photoURL)
                if (!url || !data.email) return
                ;(participantsByEmail.get(norm(data.email)) || []).forEach(pid => photos.set(pid, url))
            })
        }
        smes.forEach(sme => { sme.photoUrl = photos.get(sme.participantId) || '' })
    } catch (error) {
        console.warn('Could not load SME photos', error)
    }
}

/** Training departments (or their descendants) must plan topics as well as coverage. */
export async function departmentNeedsPlannedTopics(departmentId: string): Promise<boolean> {
    if (!departmentId) return false
    try {
        const snap = await getDocs(collection(db, 'departments'))
        const departments = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as DepartmentCapabilityRecord[]
        return departmentUsesTrainingCoverage(departmentId, departments)
    } catch {
        return false
    }
}

/* ------------------------------------------------------------------ */
/* Validate + build (pure — no I/O, so it can be checked without login) */
/* ------------------------------------------------------------------ */

const normalizePointList = (value: unknown): string[] => {
    const values = Array.isArray(value) ? value : [value]
    return Array.from(new Set(values.map(item => clean(item)).filter(Boolean)))
}

export function buildSingleAppointment(params: {
    assignment: SchedulableAssignment
    values: AppointmentFormValues
    smeEmail: string
    needsPlannedTopics: boolean
    fallbackProgramId?: string
    fallbackDepartmentId?: string
    now?: Date
}): { error: string } | BuiltAppointment {
    const { assignment, values, smeEmail, needsPlannedTopics } = params

    const startsAt = values.startsAt ? dayjs(values.startsAt) : null
    const endsAt = values.endsAt ? dayjs(values.endsAt) : null
    if (!startsAt?.isValid() || !endsAt?.isValid()) return { error: 'Please select a valid start and end time.' }
    if (!endsAt.isAfter(startsAt)) return { error: 'End time must be after start time.' }
    if (!startsAt.isSame(endsAt, 'day')) return { error: 'Start and end must be on the same day.' }
    if (!startsAt.isAfter(dayjs(params.now ?? new Date()))) return { error: 'The appointment must start in the future.' }

    const hour = startsAt.hour()
    const minute = startsAt.minute()
    if (hour < 6 || hour > 18 || (hour === 18 && minute > 0)) {
        return { error: 'Appointment time must be between 06:00 and 18:00.' }
    }

    const sessionTitle = clean(values.sessionTitle)
    if (!sessionTitle) return { error: 'Please add a session title.' }

    const plannedTopics = needsPlannedTopics ? normalizePointList(values.plannedTopics) : []
    if (needsPlannedTopics && !plannedTopics.length) return { error: 'Please add at least one planned topic.' }

    const plannedCoverage = normalizePointList(values.plannedCoverage)
    if (!plannedCoverage.length || coverageWordCount(plannedCoverage.join(' ')) <= 5) {
        return { error: 'Planned coverage must contain more than 5 words.' }
    }

    const deliveryMethod = values.deliveryMethod
    if (!deliveryMethod) return { error: 'Please select a delivery method.' }
    if (deliveryMethod === 'virtual' && !clean(values.meetingLink)) {
        return { error: 'Please provide a meeting link for virtual appointments.' }
    }
    const location = deliveryMethod === 'in_person' ? clean(values.location) || 'At Center' : ''

    const programId = clean(assignment.programId) || clean(params.fallbackProgramId)
    if (!programId) return { error: 'This assignment has no programme, so it cannot be scheduled from here.' }

    const participantId = clean(assignment.participantId || assignment.beneficiaryId)
    const participantName = clean(assignment.participantName || assignment.beneficiaryName)
    const responsibleId = clean(assignment.assigneeId)
    if (!responsibleId) {
        return { error: 'This intervention has no responsible assignee. Assign it before scheduling an appointment.' }
    }

    const cycleKey = assignmentCycleStorageKey(assignment) || null
    if (!assignmentCanOwnAppointment({
        date: startsAt.toDate(),
        participantId,
        interventionId: assignment.interventionId,
        programId,
        departmentId: assignment.departmentId,
        assigneeId: assignment.assigneeId,
        cycleKey,
        subInterventionId: assignment.subInterventionId || null
    }, assignment)) {
        return { error: 'The appointment date cannot be earlier than the selected assignment date.' }
    }

    const responsibleRole = norm(assignment.assigneeRole) === 'operations' ? 'operations' : 'coordinator'
    const responsibleName = clean(assignment.assigneeName || assignment.assignedToName)
    const responsibleEmail = norm(assignment.assigneeEmail)
    const departmentId = clean(assignment.departmentId) || clean(params.fallbackDepartmentId)
    const interventionId = clean(assignment.interventionId || assignment.id)
    const interventionTitle = clean(assignment.interventionTitle || assignment.title)

    const startAt = Timestamp.fromDate(startsAt.toDate())
    const endAt = Timestamp.fromDate(endsAt.toDate())

    const session = {
        schemaVersion: 5,
        programId,
        departmentId,
        interventionId,
        interventionTitle,
        cycleKey,
        groupKey: null,
        sessionType: 'individual',
        assigneeId: responsibleId,
        assigneeName: responsibleName,
        assigneeEmail: responsibleEmail || null,
        assigneeRole: responsibleRole,
        title: sessionTitle,
        startAt,
        endAt,
        deliveryMethod,
        location: deliveryMethod === 'in_person' ? location || null : null,
        meetingLink: deliveryMethod === 'virtual' ? clean(values.meetingLink) || null : null,
        plannedTopics,
        plannedCoverage,
        coverage: {
            held: null,
            outcomeSummary: null,
            coveredPoints: [],
            reasonNotHeld: null,
            recordedAt: null,
            recordedById: null
        },
        attendanceSession: null,
        attendanceSummary: { invitedCount: 1, attendedCount: 0, checkedInCount: 0, checkedOutCount: 0 },
        foodMenu: [],
        status: 'scheduled',
        completedAt: null
    }

    const invitation = {
        schemaVersion: 5,
        programId,
        departmentId,
        assignedInterventionId: clean(assignment.id),
        smeId: participantId,
        smeName: participantName,
        smeEmail: smeEmail || null,
        interventionId,
        interventionTitle,
        subInterventionId: assignment.subInterventionId || null,
        subInterventionTitle: assignment.subInterventionTitle || null,
        cycleKey,
        assigneeId: responsibleId,
        assigneeName: responsibleName,
        assigneeEmail: responsibleEmail || null,
        assigneeRole: responsibleRole,
        groupKey: null,
        status: 'scheduled',
        smeConfirmation: 'pending',
        smeDeclineReason: null,
        attendance: { status: 'expected', checkedInAt: null, checkedOutAt: null },
        foodSelections: [],
        completedAt: null
    }

    return { session, invitation }
}

/* ------------------------------------------------------------------ */
/* I/O around the pure builder                                         */
/* ------------------------------------------------------------------ */

export async function resolveSmeEmail(participantId: string, fallback = ''): Promise<string> {
    const direct = norm(fallback)
    if (direct) return direct
    if (!participantId) return ''
    try {
        const snap = await getDoc(doc(db, 'participants', participantId))
        const data = snap.data() as any
        return norm(data?.email || data?.participantEmail || data?.contactEmail || data?.contactInfo?.email)
    } catch {
        return ''
    }
}

export type SubmitResult =
    | { ok: true; summary: { title: string; smeName: string; companyName: string; startsAt: Dayjs; endsAt: Dayjs } }
    | { ok: false; error: string }

export async function submitCoordinatorAppointment(params: {
    sme: SchedulableSme
    assignment: SchedulableAssignment
    values: AppointmentFormValues
    needsPlannedTopics: boolean
    fallbackProgramId?: string
    fallbackDepartmentId?: string
}): Promise<SubmitResult> {
    const { sme, assignment, values } = params

    const smeEmail = await resolveSmeEmail(
        sme.participantId,
        assignment.participantEmail || assignment.beneficiaryEmail || assignment.email
    )

    const built = buildSingleAppointment({
        assignment,
        values,
        smeEmail,
        needsPlannedTopics: params.needsPlannedTopics,
        fallbackProgramId: params.fallbackProgramId,
        fallbackDepartmentId: params.fallbackDepartmentId
    })
    if ('error' in built) return { ok: false, error: built.error }

    const clashMessage = await checkScheduleClash({
        assigneeId: clean(assignment.assigneeId),
        startsAt: dayjs(values.startsAt).toDate(),
        endsAt: dayjs(values.endsAt).toDate()
    })
    if (clashMessage) return { ok: false, error: clashMessage }

    try {
        await scheduleAppointmentSession({
            session: built.session as any,
            invitations: [built.invitation as any]
        })
    } catch (error) {
        console.error(error)
        return {
            ok: false,
            error: error instanceof AppointmentSessionAlreadyExistsError
                ? 'This appointment already exists. No duplicate was created.'
                : 'Failed to save the appointment. Please try again.'
        }
    }

    return {
        ok: true,
        summary: {
            title: clean(values.sessionTitle),
            smeName: sme.name,
            companyName: sme.companyName,
            startsAt: dayjs(values.startsAt),
            endsAt: dayjs(values.endsAt)
        }
    }
}
