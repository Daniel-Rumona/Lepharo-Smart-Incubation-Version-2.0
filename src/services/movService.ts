import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    updateDoc,
    where,
    writeBatch,
    type Firestore
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'

export type MovSourceType = 'assignedIntervention' | 'diagnosticPlan' | 'custom'
export type MovActorRole = 'coordinator' | 'consultant' | 'operations' | 'unknown'
export type MovStatus =
    | 'awaiting_smme'
    | 'awaiting_hod'
    | 'approved'
    | 'draft'
    | string

export type MovUserContext = {
    uid?: string
    name?: string
    email?: string
    departmentName?: string
    signatureUrl?: string
    signatureURL?: string
    digitalSignature?: string
}

export type MovAssignmentInput = {
    id: string
    participantId?: string | null
    beneficiaryName?: string
    smmeNo?: string
    movDocumentId?: string | null

    interventionId?: string | null
    interventionTitle?: string
    subInterventionId?: string | null
    subInterventionTitle?: string | null

    programId?: string | null
    programName?: string

    departmentId?: string
    departmentName?: string
    areaOfSupport?: string

    deliveryMethod?: string
    recurrencePreset?: string | null
    recurrence?: { every: number; unit: string } | null
    frequency?: string | null

    assigneeId?: string
    assigneeName?: string
    assigneeEmail?: string | null
    assigneeRole?: string

    smmeEmail?: string
    smmeAccepted?: boolean
    smmeSignatureUrl?: string
    smmeDigitalSignature?: string
    participantCompletionStatus?: string
    participantConfirmedAt?: any
    assigneeCompletedAt?: any
    completedAt?: any
    createdAt?: any
    periodStart?: any
    periodEnd?: any
    progressUpdates?: any[]
    resources?: any[]
    sessionAttendanceByAppointment?: Record<string, any>
}

const stripUndefined = <T extends Record<string, any>>(obj: T): Partial<T> =>
    Object.fromEntries(
        Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as Partial<T>

// Shared by CoordinatorMOVs and OperationsMOVs so their MOV lists agree on
// which documents count as SME-confirmed. `smmeAccepted` is sometimes left
// false/undefined even when the SME has clearly confirmed (smmeAcceptedAt/
// smmeSignedAt set, or participantCompletionStatus already confirmed) -
// checking only the boolean flag silently drops those MOVs from a list.
export const isSmeConfirmedMov = (mov: any): boolean =>
    mov?.smmeAccepted === true ||
    ['confirmed', 'accepted', 'complete', 'completed'].includes(
        String(mov?.participantCompletionStatus || '').toLowerCase()
    ) ||
    !!mov?.smmeAcceptedAt ||
    !!mov?.smmeSignedAt

const normalizeMovText = (value: any) =>
    String(value ?? '').trim().toLowerCase()

// Shared by every MOV list view (Operations, ProjectAdmin, Coordinator) so
// they classify onboarding/Pre-Incubation-Agreement MOVs the same way. A
// participant having a signed Pre-Incubation Agreement does not make every
// MOV for that participant a Pre-Inc MOV - classification must come from the
// intervention itself.
export const isOnboardingMov = (mov?: any): boolean => {
    if (!mov) return false

    const title = normalizeMovText(
        mov.interventionTitle ||
        mov.snapshot?.interventionTitle ||
        mov.intervention?.title ||
        mov.intervention?.name ||
        ''
    )

    const explicitlyOnboarding =
        mov.isOnboarding === true ||
        mov.onboarding === true ||
        mov.intervention?.isOnboarding === true ||
        mov.snapshot?.isOnboarding === true

    return (
        explicitlyOnboarding ||
        title.includes('onboarding') ||
        title.includes('pre-incubation') ||
        title.includes('pre incubation')
    )
}

export const getPreIncAgreementMeta = (mov?: any) =>
    mov?.preIncubationAgreementMeta ||
    mov?.signedAgreements?.['pre-incubation-contract'] ||
    mov?.application?.signedAgreements?.['pre-incubation-contract'] ||
    mov?.participant?.signedAgreements?.['pre-incubation-contract'] ||
    null

export const getPreIncAgreementUrl = (mov?: any): string => {
    const meta = getPreIncAgreementMeta(mov)

    return String(
        meta?.signedFileURL ||
        meta?.signedFileUrl ||
        meta?.downloadURL ||
        meta?.fileURL ||
        meta?.fileUrl ||
        meta?.pdfUrl ||
        meta?.pdfURL ||
        meta?.url ||
        ''
    ).trim()
}

export const hasPreIncAgreementEvidence = (mov?: any): boolean => {
    if (!isOnboardingMov(mov)) return false

    const meta = getPreIncAgreementMeta(mov)

    return (
        mov?.preIncubationAgreement === true ||
        normalizeMovText(mov?.verificationMethod) === 'signed_preinc_agreement' ||
        meta === true ||
        meta?.signed === true ||
        meta?.participantSigned === true ||
        !!meta?.participantSignatureURL ||
        !!meta?.userSignatureURL ||
        !!meta?.signer ||
        !!meta?.acceptedAt ||
        !!getPreIncAgreementUrl(mov) ||
        (Array.isArray(mov?.resources) &&
            mov.resources.some((resource: any) =>
                normalizeMovText(resource?.type) === 'signed_agreement' ||
                normalizeMovText(resource?.label).includes('pre-incubation')
            ))
    )
}

const getUserSignatureUrl = (user: MovUserContext) =>
    user.signatureUrl || user.signatureURL || ''

const getSavedSmmeSignatureUrl = (application: any, participant: any) => {
    const signedAgreements = application?.signedAgreements
    const agreementSignature = signedAgreements && typeof signedAgreements === 'object'
        ? Object.values(signedAgreements).map((agreement: any) =>
            agreement?.participantSignatureURL ||
            agreement?.participantSignatureUrl ||
            agreement?.signer?.signatureURL ||
            agreement?.signer?.signatureUrl ||
            ''
        ).find(Boolean)
        : ''

    return application?.signatureUrl ||
        application?.signatureURL ||
        application?.participantSignatureURL ||
        application?.participantSignatureUrl ||
        participant?.signatureUrl ||
        participant?.signatureURL ||
        agreementSignature ||
        ''
}

const cleanText = (value: any) => String(value || '').trim()

const normalizeMovDeliveryMethod = (value: any) => {
    const raw = cleanText(value).toLowerCase().replace(/[_-]+/g, ' ')
    if (!raw) return ''
    if (raw.includes('in person') || raw === 'inperson') return 'in-person'
    if (raw.includes('online') || raw.includes('virtual')) return 'online'
    if (raw.includes('telephon')) return 'telephonic'
    return raw
}

const deriveMovDeliveryMethod = (rows: any[], fallback = '') => {
    const methods = Array.from(new Set(
        (rows || []).map(row => normalizeMovDeliveryMethod(row?.deliveryMethod)).filter(Boolean)
    ))
    if (methods.length > 1) return 'hybrid'
    return methods[0] || normalizeMovDeliveryMethod(fallback) || fallback || ''
}

const getKpiId = (value: any) => {
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value).trim()
    }
    return cleanText(value?.id || value?.kpiId || value?.value)
}

export const resolveMovKpiNames = async (
    db: Firestore,
    interventionId?: string | null
) => {
    const id = cleanText(interventionId)
    if (!id) return ''

    const kpiIds = new Set<string>()
    const kpiNames = new Set<string>()

    for (const collectionName of ['interventions']) {
        try {
            const interventionSnap = await getDoc(doc(db, collectionName, id))
            if (!interventionSnap.exists()) continue

            const data = interventionSnap.data() as any
            const linkedKpis = [
                data?.kpiIds,
                data?.kpiIDs,
                data?.kpis,
                data?.kpiDefinitions
            ].find(Array.isArray) || []

            linkedKpis.forEach((item: any) => {
                const kpiId = getKpiId(item)
                if (kpiId) kpiIds.add(kpiId)

                const inlineName = cleanText(
                    item?.kpiLabel ||
                    item?.label ||
                    item?.name ||
                    item?.title ||
                    item?.kpiName
                )
                if (inlineName) kpiNames.add(inlineName)
            })
        } catch {
            // Continue with any reverse KPI links below.
        }
    }

    try {
        const reverseLinkedSnap = await getDocs(
            query(
                collection(db, 'kpiDefinitions'),
                where('interventionIds', 'array-contains', id)
            )
        )
        reverseLinkedSnap.docs.forEach(kpiDoc => {
            const data = kpiDoc.data() as any
            kpiIds.add(kpiDoc.id)
            const name = cleanText(
                data?.kpiLabel ||
                data?.label ||
                data?.name ||
                data?.title ||
                data?.kpiName
            )
            if (name) kpiNames.add(name)
        })
    } catch {
        // Direct KPI links below still provide a fallback.
    }

    for (const kpiId of kpiIds) {
        try {
            const kpiSnap = await getDoc(doc(db, 'kpiDefinitions', kpiId))
            if (!kpiSnap.exists()) continue
            const data = kpiSnap.data() as any
            const name = cleanText(
                data?.kpiLabel ||
                data?.label ||
                data?.name ||
                data?.title ||
                data?.kpiName
            )
            if (name) kpiNames.add(name)
        } catch {
            // A missing KPI should not prevent the MOV from rendering.
        }
    }

    return Array.from(kpiNames).join(', ')
}

/**
 * Resolve the actual appointment/session rows that belong on an MOV.
 *
 * This deliberately mirrors CoordinatorMOVs:
 * - discover appointments by interventionId (plus exact assignment links)
 * - hydrate appointmentSessions before reading sessionCoverage
 * - include only held sessions
 * - for group appointments require proof that this SME attended
 * - build the row from session title + covered points
 * - never fall back to progressUpdates
 */
export const resolveMovAppointmentInterventions = async (
    db: Firestore,
    assignment: MovAssignmentInput
) => {
    type MovAppointmentRow = {
        title: string
        date: any
        signature: string
        deliveryMethod?: string
    }

    const assignmentId = cleanText(assignment.id)
    const participantId = cleanText(assignment.participantId)
    const interventionId = cleanText(assignment.interventionId)
    const programId = cleanText(assignment.programId)

    const toMillis = (value: any) => {
        if (!value) return 0
        if (typeof value?.toMillis === 'function') return value.toMillis()
        if (typeof value?.toDate === 'function') return value.toDate().getTime()
        if (typeof value?.seconds === 'number') {
            return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000)
        }
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
    }

    const getAppointmentDate = (appointment: any) =>
        appointment?.date ||
        appointment?.startTime ||
        appointment?.completedAt ||
        appointment?.schedule?.dateKey ||
        appointment?.schedule?.startTime ||
        appointment?.schedule?.startAt ||
        null

    const appointmentDocs = new Map<string, { id: string; data: any }>()

    const addSnapshotDocs = (snapshot: any) => {
        snapshot?.docs?.forEach((appointmentDoc: any) => {
            appointmentDocs.set(appointmentDoc.id, {
                id: appointmentDoc.id,
                data: appointmentDoc.data()
            })
        })
    }

    try {
        const requests: Promise<any>[] = []

        // This is the discovery path used by CoordinatorMOVs and is necessary
        // for group/legacy appointments that do not carry assignedInterventionId.
        if (interventionId) {
            requests.push(
                getDocs(
                    query(
                        collection(db, 'appointments'),
                        where('interventionId', '==', interventionId)
                    )
                )
            )
        }

        // Keep exact assignment discovery too, particularly for old appointments
        // that may be missing interventionId but do have the assignment link.
        if (assignmentId) {
            requests.push(
                getDocs(
                    query(
                        collection(db, 'appointments'),
                        where('assignedInterventionId', '==', assignmentId)
                    )
                )
            )
        }

        const snapshots = await Promise.all(requests)
        snapshots.forEach(addSnapshotDocs)
    } catch (error) {
        console.warn('[MOV] Could not load appointments for MOV', error)
    }

    if (!appointmentDocs.size) return []

    let appointmentViews: any[] = []

    try {
        appointmentViews = await hydrateAppointmentViews(
            Array.from(appointmentDocs.values())
        )
    } catch (error) {
        console.warn('[MOV] Could not hydrate appointment session data', error)
        appointmentViews = Array.from(appointmentDocs.values()).map(item => ({
            id: item.id,
            ...item.data
        }))
    }

    // Resolve the same participant email CoordinatorMOVs uses for historical
    // group QR/check-in attendance matching.
    let participantEmail = cleanText(assignment.smmeEmail).toLowerCase()

    if (!participantEmail && participantId) {
        try {
            const participantSnap = await getDoc(doc(db, 'participants', participantId))
            if (participantSnap.exists()) {
                const participant = participantSnap.data() as any
                participantEmail = cleanText(
                    participant?.email ||
                    participant?.participantEmail ||
                    participant?.contactEmail ||
                    participant?.contactInfo?.email
                ).toLowerCase()
            }
        } catch (error) {
            console.warn('[MOV] Could not resolve participant email', error)
        }

        if (!participantEmail) {
            try {
                const applicationSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('participantId', '==', participantId),
                        limit(1)
                    )
                )

                if (!applicationSnap.empty) {
                    const application = applicationSnap.docs[0].data() as any
                    participantEmail = cleanText(
                        application?.email ||
                        application?.participantEmail ||
                        application?.contactEmail
                    ).toLowerCase()
                }
            } catch (error) {
                console.warn('[MOV] Could not resolve application email', error)
            }
        }
    }

    // Compare at day granularity, not exact millis: a session's `date` is often
    // just a "YYYY-MM-DD" string (parsed as UTC midnight), which can look
    // "earlier" than a same-day periodStart timestamp that has a time-of-day
    // component (e.g. the assignment was created at 08:46 on the same date the
    // session happened) - and would otherwise be wrongly excluded.
    const rawPeriodStartMillis = toMillis(
        assignment.periodStart || assignment.createdAt
    )
    const rawPeriodEndMillis = toMillis(
        assignment.periodEnd ||
        assignment.participantConfirmedAt ||
        assignment.assigneeCompletedAt ||
        assignment.completedAt
    )
    const periodStartMillis = rawPeriodStartMillis
        ? dayjs(rawPeriodStartMillis).startOf('day').valueOf()
        : 0
    const periodEndMillis = rawPeriodEndMillis
        ? dayjs(rawPeriodEndMillis).endOf('day').valueOf()
        : 0

    const rows: MovAppointmentRow[] = appointmentViews
        .filter(appointment => {
            // Keep the resolver inside the same programme/intervention scope.
            if (
                programId &&
                appointment?.programId &&
                cleanText(appointment.programId) !== programId
            ) {
                return false
            }

            const directAssignmentMatch =
                !!assignmentId &&
                cleanText(appointment?.assignedInterventionId) === assignmentId

            if (
                interventionId &&
                appointment?.interventionId &&
                cleanText(appointment.interventionId) !== interventionId &&
                !directAssignmentMatch
            ) {
                return false
            }

            const latest = appointment?.sessionCoverage?.latest
            const held =
                latest?.held === true ||
                String(appointment?.status || '').toLowerCase() === 'completed'

            if (!held) return false

            const appointmentDate = getAppointmentDate(appointment)
            const appointmentMillis = toMillis(appointmentDate)

            if (
                periodStartMillis &&
                appointmentMillis &&
                appointmentMillis < periodStartMillis
            ) {
                return false
            }

            if (
                periodEndMillis &&
                appointmentMillis &&
                appointmentMillis > periodEndMillis
            ) {
                return false
            }

            const isGroupAppointment =
                appointment?.isGroupAppointment === true ||
                appointment?.allocationType === 'group' ||
                !!appointment?.groupKey

            if (!isGroupAppointment) {
                return (
                    directAssignmentMatch ||
                    (!!participantId && cleanText(appointment?.participantId) === participantId)
                )
            }

            const recordedAttendance = Array.isArray(latest?.attendanceByParticipant)
                ? latest.attendanceByParticipant.find(
                    (entry: any) => cleanText(entry?.participantId) === participantId
                )
                : null

            // Same rule as CoordinatorMOVs: when the participant has an explicit
            // session outcome, that outcome is authoritative.
            if (recordedAttendance) {
                return cleanText(recordedAttendance.outcome).toLowerCase() === 'attended'
            }

            const checkedInEmails = [
                ...(appointment?.attendanceSummary?.checkedInEmails || []),
                ...(appointment?.attendance?.summary?.checkedInEmails || [])
            ].map((email: any) => cleanText(email).toLowerCase())

            const checkIns = [
                ...(appointment?.attendance?.checkIns || []),
                ...(appointment?.attendeeCheckIns || [])
            ]

            return Boolean(
                participantEmail && checkedInEmails.includes(participantEmail) ||
                checkIns.some((entry: any) =>
                    participantEmail && cleanText(entry?.email).toLowerCase() === participantEmail
                )
            )
        })
        .map(appointment => {
            const latest = appointment?.sessionCoverage?.latest
            const coveredPoints = Array.isArray(latest?.coveredPoints)
                ? latest.coveredPoints.map((point: any) => cleanText(point)).filter(Boolean).join('; ')
                : ''

            const sessionHeading = cleanText(
                latest?.title ||
                appointment?.sessionTitle ||
                appointment?.interventionTitle ||
                assignment.interventionTitle ||
                'Intervention'
            )

            const fullDetails =
                coveredPoints && coveredPoints.toLowerCase() !== sessionHeading.toLowerCase()
                    ? `${sessionHeading} — ${coveredPoints}`
                    : sessionHeading

            return {
                title: fullDetails,
                // Match CoordinatorMOVs. Prefer the scheduled appointment date,
                // never a later progress-update timestamp.
                date:
                    appointment?.date ||
                    appointment?.startTime ||
                    appointment?.completedAt ||
                    assignment.completedAt,
                signature: '',
                deliveryMethod:
                    appointment?.deliveryMethod ||
                    appointment?.delivery?.mode ||
                    appointment?.method ||
                    ''
            }
        })
        .filter(row => cleanText(row.title) && row.date)

    const seen = new Set<string>()

    return rows
        .filter(row => {
            const millis = toMillis(row.date)
            const dateKey = millis
                ? new Date(millis).toISOString().slice(0, 10)
                : cleanText(row.date)
            const key = `${cleanText(row.title).toLowerCase()}__${dateKey}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .sort((a, b) => toMillis(a.date) - toMillis(b.date))
}

export const resolveMovFacilitatorByEmail = async ({
    db,
    email,
    user,
    preferredRole = 'unknown'
}: {
    db: Firestore
    email: string
    user: MovUserContext
    preferredRole?: MovActorRole
}) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()

    const tryCollection = async (
        collectionName: 'operationsStaff' | 'coordinators'
    ) => {
        if (!normalizedEmail) return null

        const snap = await getDocs(
            query(
                collection(db, collectionName),
                where('email', '==', normalizedEmail),
                limit(1)
            )
        )

        if (snap.empty) return null

        const foundDoc = snap.docs[0]
        const data = foundDoc.data() as any

        return {
            id: foundDoc.id,
            name: data.name || data.fullName || user.name || '',
            email: data.email || normalizedEmail,
            role:
                collectionName === 'operationsStaff'
                    ? 'operations'
                    : 'coordinator',
            digitalSignature:
                data.digitalSignature ||
                data.facilitatorDigitalSignature ||
                user.digitalSignature ||
                '',
            signatureUrl:
                data.signatureUrl ||
                data.signatureURL ||
                data.facilitatorSignatureUrl ||
                getUserSignatureUrl(user)
        }
    }

    const order =
        preferredRole === 'operations'
            ? ['operationsStaff', 'coordinators']
            : ['coordinators', 'operationsStaff']

    for (const collectionName of order as (
        | 'operationsStaff'
        | 'coordinators'
    )[]) {
        const result = await tryCollection(collectionName)
        if (result) return result
    }

    const userFallback = await resolveUserSignatureByEmail({
        db,
        email: normalizedEmail
    })

    if (userFallback) {
        return {
            id: userFallback.id,
            name: userFallback.name || user.name || '',
            email: userFallback.email,
            role: 'unknown',
            digitalSignature:
                userFallback.digitalSignature ||
                user.digitalSignature ||
                '',
            signatureUrl:
                userFallback.signatureUrl ||
                getUserSignatureUrl(user)
        }
    }

    return {
        id: user.uid || normalizedEmail || 'unknown',
        name: user.name || '',
        email: normalizedEmail,
        role: 'unknown',
        digitalSignature: user.digitalSignature || '',
        signatureUrl: getUserSignatureUrl(user)
    }
}

export const resolveMovFacilitatorById = async ({
    db,
    facilitatorId,
    email,
    preferredRole = 'unknown'
}: {
    db: Firestore
    facilitatorId: string
    email?: string | null
    preferredRole?: MovActorRole
}) => {
    const id = String(facilitatorId || '').trim()
    if (!id) return null

    const order = preferredRole === 'operations'
        ? ['operationsStaff', 'coordinators', 'users']
        : ['coordinators', 'operationsStaff', 'users']
    const resolved = {
        id,
        name: '',
        email: String(email || '').trim().toLowerCase(),
        signatureUrl: '',
        digitalSignature: ''
    }

    for (const collectionName of order) {
        try {
            const profileSnap = await getDoc(doc(db, collectionName, id))
            if (!profileSnap.exists()) continue

            const data = profileSnap.data() as any
            resolved.name = resolved.name || data.name || data.fullName || data.displayName || ''
            resolved.email = resolved.email || String(data.email || '').trim().toLowerCase()
            resolved.signatureUrl = resolved.signatureUrl ||
                data.signatureUrl ||
                data.signatureURL ||
                data.facilitatorSignatureUrl ||
                ''
            resolved.digitalSignature = resolved.digitalSignature ||
                data.digitalSignature ||
                data.facilitatorDigitalSignature ||
                ''
        } catch (error) {
            console.warn(`Could not resolve facilitator ${id} from ${collectionName}`, error)
        }
    }

    if (resolved.email && !resolved.signatureUrl) {
        try {
            const emailProfile = await resolveUserSignatureByEmail({ db, email: resolved.email })
            if (emailProfile) {
                resolved.name = resolved.name || emailProfile.name || ''
                resolved.signatureUrl = emailProfile.signatureUrl || ''
                resolved.digitalSignature = resolved.digitalSignature || emailProfile.digitalSignature || ''
            }
        } catch (error) {
            console.warn('Could not resolve optional facilitator profile for MOV', {
                facilitatorId: id,
                error
            })
        }
    }

    return resolved
}

export const findMovForAssignment = async (
    db: Firestore,
    assignedInterventionId: string
) => {
    const assignmentSnap = await getDoc(
        doc(db, 'assignedInterventions', assignedInterventionId)
    )

    if (assignmentSnap.exists()) {
        const data = assignmentSnap.data() as any
        if (data.movDocumentId) {
            const linkedMovSnap = await getDoc(
                doc(db, 'movDocuments', String(data.movDocumentId))
            )
            if (linkedMovSnap.exists()) {
                return {
                    movDocumentId: linkedMovSnap.id,
                    movData: linkedMovSnap.data()
                }
            }
        }
    }

    const movSnap = await getDocs(
        query(
            collection(db, 'movDocuments'),
            where('assignedInterventionId', '==', assignedInterventionId),
            limit(1)
        )
    )

    if (movSnap.empty) {
        return {
            movDocumentId: null,
            movData: null
        }
    }

    return {
        movDocumentId: movSnap.docs[0].id,
        movData: movSnap.docs[0].data()
    }
}

export const createMovDraftFromAssignment = async ({
    db,
    user,
    assigneeRole = 'unknown',
    assignment,
    status = 'awaiting_smme',
    markAssignmentCompleted = true
}: {
    db: Firestore
    user: MovUserContext
    assigneeRole?: MovActorRole
    assignment: MovAssignmentInput
    status?: MovStatus
    markAssignmentCompleted?: boolean
}) => {
    if (!assignment.id) throw new Error('Missing assigned intervention id.')

    const existing = await findMovForAssignment(db, assignment.id)

    if (existing.movDocumentId) {
        return {
            movDocumentId: existing.movDocumentId,
            created: false
        }
    }

    const assignmentSnap = await getDoc(
        doc(db, 'assignedInterventions', assignment.id)
    )
    const storedAssignment: Partial<MovAssignmentInput> = assignmentSnap.exists()
        ? (assignmentSnap.data() as MovAssignmentInput)
        : {}
    const resolvedAssignment: MovAssignmentInput = {
        ...storedAssignment,
        ...assignment,
        id: assignment.id,
        progressUpdates:
            assignment.progressUpdates || storedAssignment.progressUpdates,
        sessionAttendanceByAppointment:
            assignment.sessionAttendanceByAppointment ||
            storedAssignment.sessionAttendanceByAppointment
    }

    const facilitatorId = resolvedAssignment.assigneeId || ''
    const facilitatorName = resolvedAssignment.assigneeName || ''

    const facilitatorProfile = facilitatorId
        ? await resolveMovFacilitatorById({
            db,
            facilitatorId,
            email: resolvedAssignment.assigneeEmail,
            preferredRole: resolvedAssignment.assigneeRole === 'operations' ? 'operations' : 'coordinator'
        })
        : null
    const facilitatorSignatureUrl = facilitatorProfile?.signatureUrl || ''
    const facilitatorDigitalSignature = facilitatorProfile?.digitalSignature || ''
    const facilitatorEmail = facilitatorProfile?.email || resolvedAssignment.assigneeEmail || ''

    const now = new Date()

    const smeAlreadyConfirmed =
        resolvedAssignment.participantCompletionStatus === 'confirmed' ||
        resolvedAssignment.smmeAccepted === true

    const finalStatus = smeAlreadyConfirmed ? 'awaiting_hod' : status
    const facilitatorCompletedAt =
        resolvedAssignment.assigneeCompletedAt ||
        resolvedAssignment.completedAt ||
        now
    const smmeConfirmedAt = smeAlreadyConfirmed
        ? resolvedAssignment.participantConfirmedAt || now
        : null

    const appointmentInterventions = await resolveMovAppointmentInterventions(
        db,
        resolvedAssignment
    )
    const appointmentInterventionDate =
        appointmentInterventions[0]?.date || facilitatorCompletedAt

    const kpiServiced = await resolveMovKpiNames(
        db,
        resolvedAssignment.interventionId
    )

    const payload = stripUndefined({
        agreementId: 'mov',
        sourceType: 'assignedIntervention',

        assignedInterventionId: assignment.id,
        diagnosticPlanId: null,

        programId: assignment.programId || null,
        programName: assignment.programName || '',

        departmentId: assignment.departmentId || null,
        // Prefer the assignment's own department data before ever falling back
        // to the acting user's department - completion is often done by an
        // ops/admin user on a facilitator's behalf (e.g. from the shared
        // Appointments department view), and their own departmentName is not
        // the right value for someone else's assignment.
        departmentName:
            assignment.departmentName || assignment.areaOfSupport || user.departmentName || '',
        areaOfSupport: assignment.areaOfSupport || assignment.departmentName || '',
        kpiServiced,

        interventionId: assignment.interventionId || null,
        interventionTitle: assignment.interventionTitle || 'Intervention',
        subInterventionId: assignment.subInterventionId || null,
        subInterventionTitle: assignment.subInterventionTitle || null,

        deliveryMethod: deriveMovDeliveryMethod(appointmentInterventions, assignment.deliveryMethod),
        frequency:
            assignment.frequency ||
            assignment.recurrencePreset ||
            (assignment.recurrence?.unit === 'week' && assignment.recurrence?.every === 2
                ? 'bi-weekly'
                : assignment.recurrence?.unit === 'week'
                    ? 'weekly'
                    : assignment.recurrence?.unit === 'month'
                        ? 'monthly'
                        : null),

        status: finalStatus,
        createdAt: now,
        needsSmmeSignatureRepair:
            smeAlreadyConfirmed && !assignment.smmeSignatureUrl,
        updatedAt: now,
        completedAt: facilitatorCompletedAt,
        interventionDate: appointmentInterventionDate,
        periodStart: resolvedAssignment.createdAt || null,
        periodEnd: smmeConfirmedAt,
        appointmentInterventions,
        progressUpdates: resolvedAssignment.progressUpdates || [],
        resources: Array.isArray(resolvedAssignment.resources)
            ? resolvedAssignment.resources
            : [],

        facilitatorId,
        facilitatorName,
        facilitatorEmail,
        facilitatorDigitalSignature,
        facilitatorSignatureUrl,
        facilitatorSignedAt: facilitatorCompletedAt,
        needsFacilitatorRepair: !facilitatorId || !facilitatorSignatureUrl,

        smmeAccepted: smeAlreadyConfirmed,
        smmeAcceptedAt: smmeConfirmedAt,
        smmeSignedAt: smmeConfirmedAt,
        smmeSignatureUrl: assignment.smmeSignatureUrl || '',
        smmeDigitalSignature: assignment.smmeDigitalSignature || '',
        smmeId: assignment.participantId || null,
        participantId: assignment.participantId || null,
        smmeName: '',
        smmeCompanyName: assignment.beneficiaryName || '',
        smmeNo: resolvedAssignment.smmeNo || '',

        createdByUid: user.uid || '',
        createdByName: user.name || '',
        createdByEmail: user.email || ''
    })

    const movRef = await addDoc(collection(db, 'movDocuments'), payload)

    if (markAssignmentCompleted) {
        await updateDoc(doc(db, 'assignedInterventions', assignment.id), {
            movDocumentId: movRef.id,
            assigneeCompletionStatus: 'completed',
            assignmentStatus: 'in-progress',
            assigneeCompletedAt: now,
            completedAt: now,
            updatedAt: now
        })
    }

    return {
        movDocumentId: movRef.id,
        created: true,
        payload
    }
}

const resolveUserSignatureByEmail = async ({
    db,
    email
}: {
    db: Firestore
    email?: string
}) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail) return null

    const snap = await getDocs(
        query(
            collection(db, 'users'),
            where('email', '==', normalizedEmail),
            limit(1)
        )
    )

    if (snap.empty) return null

    const data = snap.docs[0].data() as any

    return {
        id: snap.docs[0].id,
        name: data.name || data.fullName || data.displayName || '',
        email: data.email || normalizedEmail,
        signatureUrl: data.signatureUrl || data.signatureURL || '',
        digitalSignature: data.digitalSignature || ''
    }
}

export const createOrUpdateDiagnosticPlanMovDraft = async ({
    db,
    user,
    assigneeRole = 'operations',
    diagnosticPlanId,
    participantId,
    programId,
    programName = '',
    departmentId,
    departmentName,
    beneficiaryName = '',
    deliveryMethod = '',
    status = 'awaiting_smme'
}: {
    db: Firestore
    user: MovUserContext
    assigneeRole?: MovActorRole
    diagnosticPlanId: string
    participantId: string
    programId: string
    programName?: string
    departmentId: string
    departmentName: string
    beneficiaryName?: string
    deliveryMethod?: string
    status?: MovStatus
}) => {
    if (!diagnosticPlanId) throw new Error('Missing diagnosticPlanId.')
    if (!participantId) throw new Error('Missing participantId.')
    if (!programId) throw new Error('Missing programId.')
    if (!departmentId) throw new Error('Missing departmentId.')

    const existingSnap = await getDocs(
        query(
            collection(db, 'movDocuments'),
            where('sourceType', '==', 'diagnosticPlan'),
            where('diagnosticPlanId', '==', diagnosticPlanId),
            where('departmentId', '==', departmentId),
            limit(1)
        )
    )

    const planSnap = await getDoc(doc(db, 'diagnosticPlans', diagnosticPlanId))
    const planData = planSnap.exists() ? (planSnap.data() as any) : {}

    const deptConfirmationRaw = planData?.confirmedByDeptId?.[departmentId]
    const deptConfirmation =
        deptConfirmationRaw && typeof deptConfirmationRaw === 'object'
            ? deptConfirmationRaw
            : {}

    const facilitatorEmail = String(deptConfirmation.confirmedByEmail || '').trim()
    const facilitatorUid = String(deptConfirmation.confirmedBy || '').trim()

    let resolvedDpFacilitator: any = null

    if (facilitatorEmail) {
        resolvedDpFacilitator = await resolveMovFacilitatorByEmail({
            db,
            email: facilitatorEmail,
            user,
            preferredRole: 'operations'
        })
    } else if (facilitatorUid) {
        const userSnap = await getDoc(doc(db, 'users', facilitatorUid))

        if (userSnap.exists()) {
            const data = userSnap.data() as any

            resolvedDpFacilitator = {
                id: facilitatorUid,
                name: data.name || data.fullName || data.displayName || '',
                email: data.email || '',
                digitalSignature: data.digitalSignature || '',
                signatureUrl:
                    data.signatureUrl ||
                    data.signatureURL ||
                    deptConfirmation.signatureUrl ||
                    deptConfirmation.signedUrl ||
                    ''
            }
        }
    }

    const facilitator = {
        id: facilitatorUid || resolvedDpFacilitator?.id || '',
        name: resolvedDpFacilitator?.name || facilitatorEmail || '',
        email: facilitatorEmail || resolvedDpFacilitator?.email || '',
        signatureUrl:
            deptConfirmation.signatureUrl ||
            deptConfirmation.signedUrl ||
            resolvedDpFacilitator?.signatureUrl ||
            '',
        digitalSignature:
            deptConfirmation.digitalSignature ||
            deptConfirmation.facilitatorDigitalSignature ||
            resolvedDpFacilitator?.digitalSignature ||
            ''
    }

    const needsFacilitatorRepair =
        !facilitator.id ||
        !facilitator.name ||
        !facilitator.email ||
        !facilitator.signatureUrl

    const now = new Date()

    const smeDeptConfirmation =
        planData?.incubateeDepartmentConfirmationsByDeptId?.[departmentId] ||
        planData?.smmeConfirmedByDeptId?.[departmentId]

    const smeAlreadyConfirmed = smeDeptConfirmation?.confirmed === true
    const finalStatus = smeAlreadyConfirmed ? 'approved' : status

    let resolvedSmmeName = ''
    let resolvedSmmeCompanyName = beneficiaryName || ''
    let resolvedSmmeNo = ''
    let resolvedSmmeDigitalSignature = ''
    let resolvedSmmeSignatureUrl = ''

    if (smeAlreadyConfirmed) {
        const participantSnap = await getDoc(doc(db, 'participants', participantId))
        const participant = participantSnap.exists()
            ? (participantSnap.data() as any)
            : {}

        const appsSnap = await getDocs(
            query(
                collection(db, 'applications'),
                where('participantId', '==', participantId),
                where('programId', '==', programId),
                limit(1)
            )
        )

        const application = !appsSnap.empty ? (appsSnap.docs[0].data() as any) : {}

        resolvedSmmeName =
            participant.participantName ||
            participant.name ||
            application.participantName ||
            application.name ||
            ''

        resolvedSmmeCompanyName =
            participant.beneficiaryName ||
            application.beneficiaryName ||
            application.businessName ||
            beneficiaryName ||
            ''
        resolvedSmmeNo = participant.smmeNo || application.smmeNo || ''

        resolvedSmmeSignatureUrl =
            smeDeptConfirmation.signatureUrl ||
            smeDeptConfirmation.signedUrl ||
            getSavedSmmeSignatureUrl(application, participant)

        resolvedSmmeDigitalSignature = application.digitalSignature || ''
    }

    const payload = stripUndefined({
        agreementId: 'mov',
        sourceType: 'diagnosticPlan',

        diagnosticPlanId,
        assignedInterventionId: null,

        programId,
        programName,

        departmentId,
        departmentName,
        areaOfSupport: departmentName,

        interventionId: null,
        interventionTitle: 'Developmental Plan',

        deliveryMethod,

        status: finalStatus,
        smmeAccepted: smeAlreadyConfirmed,
        smmeAcceptedAt: smeAlreadyConfirmed
            ? smeDeptConfirmation?.confirmedAt || now
            : null,
        smmeSignedAt: smeAlreadyConfirmed
            ? smeDeptConfirmation?.confirmedAt || now
            : null,
        periodEnd: smeAlreadyConfirmed
            ? smeDeptConfirmation?.confirmedAt || now
            : null,
        smmeId: participantId,
        participantId,
        smmeName: resolvedSmmeName,
        smmeCompanyName: resolvedSmmeCompanyName,
        smmeNo: resolvedSmmeNo,
        smmeSignatureUrl: resolvedSmmeSignatureUrl,
        smmeDigitalSignature: resolvedSmmeDigitalSignature,
        needsSmmeSignatureRepair: smeAlreadyConfirmed && !resolvedSmmeSignatureUrl,
        updatedAt: now,
        completedAt: now,
        interventionDate: now,

        facilitatorId: facilitator.id,
        facilitatorName: facilitator.name,
        facilitatorEmail: facilitator.email,
        facilitatorDigitalSignature: facilitator.digitalSignature,
        facilitatorSignatureUrl: facilitator.signatureUrl,
        facilitatorSignedAt: now,
        needsFacilitatorRepair,

        createdByUid: user.uid || '',
        createdByName: user.name || '',
        createdByEmail: user.email || ''
    })

    if (!existingSnap.empty) {
        await updateDoc(existingSnap.docs[0].ref, payload)

        return {
            movDocumentId: existingSnap.docs[0].id,
            created: false,
            updated: true
        }
    }

    const movRef = await addDoc(collection(db, 'movDocuments'), {
        ...payload,
        createdAt: now
    })

    return {
        movDocumentId: movRef.id,
        created: true,
        updated: false
    }
}

export const approveDiagnosticPlanMovBySmme = async ({
    db,
    diagnosticPlanId,
    departmentId,
    smmeId,
    signerSignatureUrl = '',
    feedback = {}
}: {
    db: Firestore
    diagnosticPlanId: string
    departmentId: string
    smmeId: string
    signerSignatureUrl?: string
    feedback?: {
        rating?: number
        comments?: string
    }
}) => {
    const movSnap = await getDocs(
        query(
            collection(db, 'movDocuments'),
            where('sourceType', '==', 'diagnosticPlan'),
            where('diagnosticPlanId', '==', diagnosticPlanId),
            where('departmentId', '==', departmentId),
            limit(1)
        )
    )

    if (movSnap.empty) {
        throw new Error('Developmental Plan MOV not found.')
    }

    const participantSnap = await getDoc(doc(db, 'participants', smmeId))
    const participant = participantSnap.exists()
        ? (participantSnap.data() as any)
        : {}

    const appsSnap = await getDocs(
        query(
            collection(db, 'applications'),
            where('participantId', '==', smmeId),
            limit(1)
        )
    )

    const application = !appsSnap.empty ? (appsSnap.docs[0].data() as any) : {}
    const confirmedAt = new Date()

    await updateDoc(movSnap.docs[0].ref, {
        smmeAccepted: true,
        smmeAcceptedAt: confirmedAt,
        smmeSignedAt: confirmedAt,
        periodEnd: confirmedAt,
        smmeId,
        participantId: smmeId,
        smmeName:
            participant.participantName ||
            participant.name ||
            application.participantName ||
            application.name ||
            '',
        smmeCompanyName:
            participant.beneficiaryName ||
            application.beneficiaryName ||
            application.businessName ||
            '',
        smmeNo: participant.smmeNo || application.smmeNo || '',
        smmeSignatureUrl:
            signerSignatureUrl ||
            getSavedSmmeSignatureUrl(application, participant),
        smmeDigitalSignature: application.digitalSignature || '',
        smmeFeedback: {
            rating: feedback.rating || 0,
            comments: feedback.comments || ''
        },
        status: 'awaiting_hod',
        updatedAt: confirmedAt
    })

    return {
        movDocumentId: movSnap.docs[0].id,
        approved: false
    }
}

export const createBulkMovBatchId = () => {
    return `bulk_mov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const createBulkAssignedInterventionMovs = async ({
    db,
    user,
    assigneeRole = 'operations',
    assignments,
    bulkBatchId
}: {
    db: Firestore
    user: MovUserContext
    assigneeRole?: MovActorRole
    assignments: MovAssignmentInput[]
    bulkBatchId: string
}) => {
    const results = []

    for (const assignment of assignments) {
        try {
            const result = await createMovDraftFromAssignment({
                db,
                user,
                assigneeRole,
                assignment,
                status: 'awaiting_smme',
                markAssignmentCompleted: true
            })

            if (result.created && result.movDocumentId) {
                await updateDoc(doc(db, 'movDocuments', result.movDocumentId), {
                    createdByBulkTool: true,
                    bulkBatchId,
                    bulkCreatedAt: new Date(),
                    bulkCreatedByUid: user.uid || '',
                    bulkCreatedByEmail: user.email || ''
                })
            }

            results.push({
                sourceId: assignment.id,
                success: true,
                ...result
            })
        } catch (error) {
            results.push({
                sourceId: assignment.id,
                success: false,
                error
            })
        }
    }

    return results
}

export const bulkDeleteMovsByBatchId = async ({
    db,
    bulkBatchId
}: {
    db: Firestore
    bulkBatchId: string
}) => {
    if (!bulkBatchId) throw new Error('Missing bulkBatchId.')

    const snap = await getDocs(
        query(
            collection(db, 'movDocuments'),
            where('createdByBulkTool', '==', true),
            where('bulkBatchId', '==', bulkBatchId)
        )
    )

    const batch = writeBatch(db)

    snap.docs.forEach(d => {
        batch.delete(d.ref)
    })

    await batch.commit()

    return {
        deleted: snap.size
    }
}
