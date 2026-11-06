// Pure planning for scripts/backfill-training-attendees.cjs: given the current
// trainingEnrollments, users, training appointment invitations and any
// trainingAttendees already present, work out what the backfill would write.
// No Firestore access here, so it can be tested with plain fixtures
// (training-attendees-plan.test.cjs).
//
// What it plans (docs/training-academy-certification-and-employees-plan.md, section 8):
//   1. trainingAttendees/{enrollmentId}_director for every enrollment: the
//      enrollment's own person becomes the SME's director. attends = true when
//      they already have training invitations, otherwise false.
//   2. users/{enrollment.userId}: trainingRole 'director', trainingAttendeeId,
//      and trainingId when missing.
//   3. appointments with groupKey 'training:...' for that enrollment and no
//      attendeeId: attendeeId / attendeeName / attendeeKind, so past attendance
//      is attributed to the director. Doc ids are not changed.
// Existing attendee docs are never overwritten, and values already in place are
// not rewritten, so a re-run plans nothing new.

const SYNTHETIC_ID_PREFIX = 'dtseed_'

// Must match directorAttendeeId() in src/components/trainings/trainingStorage.ts.
const directorAttendeeId = (enrollmentId) => `${enrollmentId}_director`

const str = (v) => (typeof v === 'string' ? v.trim() : '')

const isTrainingInvitation = (inv) => str(inv.groupKey).startsWith('training:')

const isSynthetic = (id, data) =>
    data.dataOrigin === 'synthetic' || data.synthetic === true || data.suppressNotifications === true ||
    String(id).startsWith(SYNTHETIC_ID_PREFIX)

// The ID copy from the labelled documents list, or (older records) the fixed slot.
function idDocumentOf(enrollment) {
    const listed = (Array.isArray(enrollment.documents) ? enrollment.documents : [])
        .find((d) => str(d && d.label).toLowerCase() === 'id copy' && str(d.url))
    const doc = listed || (enrollment.idDocument && str(enrollment.idDocument.url) ? enrollment.idDocument : null)
    return doc ? { url: doc.url, name: str(doc.name) || 'ID copy' } : null
}

/**
 * @param {{
 *   enrollments: {id: string, data: object}[],
 *   users: Map<string, object> | Record<string, object>,
 *   invitations: {id: string, data: object}[],
 *   existingAttendeeIds: Iterable<string>,
 *   now: string,
 * }} input
 */
function planTrainingAttendees({ enrollments, users, invitations, existingAttendeeIds, now }) {
    const userOf = users instanceof Map ? (uid) => users.get(uid) : (uid) => users[uid]
    const existing = new Set(existingAttendeeIds || [])
    const plan = { attendees: [], userPatches: [], invitationPatches: [], warnings: [], skipped: { attendeesPresent: 0 } }

    const invitationsBySme = new Map()
    for (const inv of invitations) {
        if (!isTrainingInvitation(inv.data)) continue
        const smeId = str(inv.data.smeId)
        if (!invitationsBySme.has(smeId)) invitationsBySme.set(smeId, [])
        invitationsBySme.get(smeId).push(inv)
    }
    const enrollmentIds = new Set(enrollments.map((e) => e.id))
    for (const [smeId, list] of invitationsBySme) {
        if (!enrollmentIds.has(smeId)) {
            plan.warnings.push(`${list.length} training invitation(s) point at smeId "${smeId}", which is not a trainingEnrollments id; left unchanged.`)
        }
    }

    for (const { id, data } of enrollments) {
        const attendeeId = directorAttendeeId(id)
        const name = str(data.name)
        const email = str(data.email).toLowerCase()
        const userId = str(data.userId)
        const ownInvitations = invitationsBySme.get(id) || []
        const synthetic = isSynthetic(id, data)

        if (existing.has(attendeeId)) {
            plan.skipped.attendeesPresent++
        } else {
            if (!email) plan.warnings.push(`Enrollment ${id} (${name || 'no name'}) has no email; its director record is created without one and must be completed before staff can edit it.`)
            plan.attendees.push({
                id: attendeeId,
                data: {
                    enrollmentId: id,
                    trainingId: str(data.trainingId),
                    kind: 'director',
                    attends: ownInvitations.length > 0,
                    name: name || str(data.companyName),
                    email,
                    phone: str(data.details && data.details.phone) || null,
                    idNumber: str(data.details && data.details.idNumber) || null,
                    idDocument: idDocumentOf(data),
                    categories: Array.isArray(data.categories) ? data.categories.filter((c) => typeof c === 'string') : [],
                    ...(userId ? { userId } : {}),
                    status: 'active',
                    addedBy: { uid: 'migration', role: 'migration' },
                    ...(synthetic ? { dataOrigin: 'synthetic', suppressNotifications: true } : {}),
                    createdAt: now,
                    updatedAt: now,
                },
            })
        }

        if (userId) {
            const user = userOf(userId)
            if (!user) {
                plan.warnings.push(`Enrollment ${id}: login ${userId} has no users doc; not patched.`)
            } else if (str(user.role) !== 'training_sme') {
                plan.warnings.push(`Enrollment ${id}: login ${userId} has role "${user.role}", not training_sme; not patched.`)
            } else if (str(user.participantId) && str(user.participantId) !== id) {
                plan.warnings.push(`Enrollment ${id}: login ${userId} points at participantId "${user.participantId}"; not patched.`)
            } else {
                const patch = {}
                if (user.trainingRole !== 'director') patch.trainingRole = 'director'
                if (user.trainingAttendeeId !== attendeeId) patch.trainingAttendeeId = attendeeId
                if (!str(user.participantId)) patch.participantId = id
                if (!str(user.trainingId) && str(data.trainingId)) patch.trainingId = str(data.trainingId)
                if (Object.keys(patch).length) plan.userPatches.push({ uid: userId, enrollmentId: id, patch })
            }
        }

        for (const inv of ownInvitations) {
            if (str(inv.data.attendeeId)) continue
            plan.invitationPatches.push({
                id: inv.id,
                enrollmentId: id,
                // Only these keys: the appointment email trigger ignores them, so
                // no SME is emailed (functions/src/emailHelpers.ts coreChanged).
                patch: { attendeeId, attendeeName: name || null, attendeeKind: 'director' },
            })
        }
    }

    return plan
}

module.exports = { planTrainingAttendees, directorAttendeeId, isTrainingInvitation, idDocumentOf }
