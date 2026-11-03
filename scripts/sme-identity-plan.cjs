// Pure planning for scripts/backfill-sme-identity.cjs: given the SME logins and
// participant records, work out which login belongs to which participant.
// No Firestore access here, so it can be tested with plain fixtures
// (sme-identity-plan.test.cjs).
//
// Phase 1 of docs/sme-identity-migration-plan.md. An SME (role incubatee) is
// linked to its participant both ways:
//   users/{uid}.participantId = participantId
//   participants/{participantId}.uid = uid
// A login is matched, in order, by an existing users.participantId, then by a
// participant already carrying its uid, then by email (the login's auth email,
// else its users doc email) against participants.email.
//
// Nothing is guessed: a login matching no participant, or several, and a
// participant claimed by two logins or already linked to another, is reported
// and left alone. Values already in place are never rewritten, so a re-run
// plans nothing new.

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const normEmail = (v) => str(v).toLowerCase()
const normRole = (v) => str(v).toLowerCase().replace(/\s+/g, '_')

const SME_ROLES = new Set(['incubatee'])

const pushTo = (map, key, value) => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
}

/**
 * @param {object} input
 * @param {{ uid: string, data: object }[]} input.users        users docs
 * @param {{ id: string, data: object }[]} input.participants  participants docs
 * @param {Map<string, string>} [input.authEmails]             uid -> Firebase Auth email
 */
function planSmeIdentity({ users, participants, authEmails = new Map() }) {
    const participantsById = new Map(participants.map((p) => [p.id, p]))
    const participantsByEmail = new Map()
    const participantsByUid = new Map()
    participants.forEach((p) => {
        pushTo(participantsByEmail, normEmail(p.data.email), p)
        pushTo(participantsByUid, str(p.data.uid), p)
    })

    const smeUsers = users.filter((u) => SME_ROLES.has(normRole(u.data.role)))

    // Outcomes per login; issues carry ids only (no emails or names).
    const outcomes = {
        alreadyLinked: [],      // users.participantId and participants.uid both in place
        toLink: [],             // { uid, participantId, source, userPatch, participantPatch }
        noEmail: [],            // { uid }
        noParticipant: [],      // { uid } -- usually an applicant who has not saved a profile yet
        ambiguous: [],          // { uid, participantIds, source }
        linkedToMissingParticipant: [], // { uid, participantId }
        participantLinkedToOtherUser: [], // { uid, participantId, otherUid }
        participantClaimedByMultipleUsers: [], // { participantId, uids }
    }
    const emailMismatches = [] // { uid } -- auth email and users doc email differ

    const claims = new Map() // participantId -> [{ uid, source, user }]

    for (const user of smeUsers) {
        const uid = user.uid
        const authEmail = normEmail(authEmails.get(uid))
        const docEmail = normEmail(user.data.email)
        if (authEmail && docEmail && authEmail !== docEmail) emailMismatches.push({ uid })
        const email = authEmail || docEmail

        let participant = null
        let source = ''
        const existingId = str(user.data.participantId)

        if (existingId) {
            participant = participantsById.get(existingId) || null
            if (!participant) {
                outcomes.linkedToMissingParticipant.push({ uid, participantId: existingId })
                continue
            }
            source = 'usersParticipantId'
        } else {
            const byUid = participantsByUid.get(uid) || []
            if (byUid.length > 1) {
                outcomes.ambiguous.push({ uid, participantIds: byUid.map((p) => p.id), source: 'participantUid' })
                continue
            }
            if (byUid.length === 1) {
                participant = byUid[0]
                source = 'participantUid'
            } else {
                if (!email) {
                    outcomes.noEmail.push({ uid })
                    continue
                }
                const byEmail = participantsByEmail.get(email) || []
                if (byEmail.length === 0) {
                    outcomes.noParticipant.push({ uid })
                    continue
                }
                if (byEmail.length > 1) {
                    outcomes.ambiguous.push({ uid, participantIds: byEmail.map((p) => p.id), source: 'email' })
                    continue
                }
                participant = byEmail[0]
                source = 'email'
            }
        }

        const otherUid = str(participant.data.uid)
        if (otherUid && otherUid !== uid) {
            outcomes.participantLinkedToOtherUser.push({ uid, participantId: participant.id, otherUid })
            continue
        }
        pushTo(claims, participant.id, { uid, source, user })
    }

    for (const [participantId, claimants] of claims) {
        if (claimants.length > 1) {
            outcomes.participantClaimedByMultipleUsers.push({ participantId, uids: claimants.map((c) => c.uid) })
            continue
        }
        const { uid, source, user } = claimants[0]
        const participant = participantsById.get(participantId)
        const userPatch = str(user.data.participantId) ? null : { participantId }
        const participantPatch = str(participant.data.uid) ? null : { uid }
        if (!userPatch && !participantPatch) {
            outcomes.alreadyLinked.push({ uid, participantId })
            continue
        }
        outcomes.toLink.push({ uid, participantId, source, userPatch, participantPatch })
    }

    return { smeUserCount: smeUsers.length, outcomes, emailMismatches }
}

/**
 * resourceRequests the SME made before they carried its login (Phase 4 drops the
 * email rule): requestedByUid for each request without one whose requestedByEmail
 * belongs to exactly one SME login. Others are counted, not guessed.
 */
function planRequestOwners({ requests, users, authEmails = new Map() }) {
    const loginsByEmail = new Map()
    users.filter((u) => SME_ROLES.has(normRole(u.data.role))).forEach((u) => {
        const email = normEmail(authEmails.get(u.uid)) || normEmail(u.data.email)
        pushTo(loginsByEmail, email, u.uid)
    })
    const patches = []
    let unmatched = 0
    requests.forEach((r) => {
        if (str(r.data.requestedByUid)) return
        const logins = loginsByEmail.get(normEmail(r.data.requestedByEmail)) || []
        if (logins.length === 1) patches.push({ id: r.id, patch: { requestedByUid: logins[0] } })
        else unmatched += 1
    })
    return { patches, unmatched }
}

// Must match normalizeLoginPhone in functions/src/phoneLoginLogic.ts.
function normalizeLoginPhone(input) {
    const raw = String(input ?? '').trim()
    if (!raw) return null
    let digits = raw.replace(/[^0-9]/g, '')
    if (raw.startsWith('00') || (digits.startsWith('00') && !raw.startsWith('+'))) digits = digits.replace(/^00/, '')
    else if (!raw.startsWith('+') && digits.startsWith('0')) digits = `27${digits.slice(1)}`
    if (digits.startsWith('270')) digits = `27${digits.slice(3)}`
    if (digits.startsWith('27')) return digits.length === 11 ? digits : null
    return digits.length >= 10 && digits.length <= 15 && !digits.startsWith('0') ? digits : null
}

/**
 * phoneIndex entries for SMEs that confirmed a WhatsApp number (Phase 5: that number signs
 * them in). A number already indexed, or confirmed by several SME logins, is reported and
 * left alone; so is a login that already has an index entry.
 */
function planPhoneIndex({ users, index = [] }) {
    const indexed = new Map(index.map((e) => [e.id, str(e.data.uid)]))
    const indexedUids = new Set(indexed.values())
    const byNumber = new Map()
    users.filter((u) => SME_ROLES.has(normRole(u.data.role))).forEach((u) => {
        const consent = u.data.whatsappConsent || {}
        const digits = consent.status === 'granted' ? normalizeLoginPhone(consent.number) : null
        if (digits) pushTo(byNumber, digits, u.uid)
    })
    const entries = []
    const shared = []
    const taken = []
    for (const [digits, uids] of byNumber) {
        if (uids.length > 1) { shared.push({ number: digits, uids }); continue }
        const uid = uids[0]
        if (indexed.has(digits)) { if (indexed.get(digits) !== uid) taken.push({ uid }); continue }
        if (indexedUids.has(uid)) continue
        entries.push({ id: digits, data: { uid, source: 'whatsappConsent' } })
    }
    return { entries, shared, taken }
}

module.exports = { planSmeIdentity, planRequestOwners, planPhoneIndex, normalizeLoginPhone, normEmail, normRole }
