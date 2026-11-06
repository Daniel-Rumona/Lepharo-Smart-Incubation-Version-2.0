// Seeds workflow queries for the Legal Advisory Coordinator
// (legalcoordinator@quantilytix.co.za) on the seeded Legal assignments and MOVs
// (seed-legal-flow.cjs), so every way of answering a query can be tried:
//   - HOD evidence query, open           (Labour Law · Karoo Agri Supplies; MOV becomes "queried")
//   - HOD question, open                 (same MOV; an answer that needs no evidence)
//   - CC query, sent back once           (IP Advisory · Dante Welch)
//   - M&E query, answered, awaiting M&E  (Shareholder Agreement · Karoo Agri Supplies)
//   - SME delivery dispute, open         (Business Law · Rustenburg Mining Services; completion rejected)
//   - HOD query, resolved                (Commercial Law · Rustenburg Mining Services; history)
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-queries.cjs [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-queries.cjs --remove [--apply]
//
// Every query has a fixed `seed_lq_…` id and carries seedTag, dataOrigin: 'synthetic'
// and suppressNotifications: true, so onWorkflowQueryChanged and the daily
// open-query reminder skip them, and re-running overwrites rather than duplicates.
// The MOV and assignment it changes keep their previous values under
// `seedLegalQueriesPrevious`, and --remove puts them back.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { Timestamp, FieldValue } = admin.firestore

const SEED_TAG = 'seed-legal-queries'
const PROGRAM_ID = 'b3qe3WAMAVw3QU64CLIY' // SRMCDT Project
const DEPARTMENT = 'Legal Advisory Services'
const marks = { dataOrigin: 'synthetic', suppressNotifications: true, seedTag: SEED_TAG }

const PEOPLE = {
    facilitator: { uid: 'KD1WPtLLrNcihHGYeWKAFWAKriw2', name: 'Legal Coordinator', email: 'legalcoordinator@quantilytix.co.za', role: 'coordinator', departmentName: DEPARTMENT },
    hod: { uid: 'eacBfsZunOXoYsWPr7JKhO9e3oe2', name: 'Legal Control', email: 'legal@quantilytix.co.za', role: 'operations', departmentName: DEPARTMENT },
    cc: { uid: 'GdOeVMD3NhfsfkPIKhTuCA1fQ0B3', name: 'CC Rusternberg', email: 'ccrusternberg@quantilytix.co.za', role: 'projectadmin', departmentName: null },
    me: { uid: 'pLJF8xBUdaZVZgOYQ48kX2ZaoA02', name: 'Monitoring Control', email: 'monitoring@quantilytix.co.za', role: 'operations', departmentName: 'M&E (Monitoring and Evaluation)' },
    sme: { uid: 'WTsiGqY4C0rlPvndMMtK', name: 'Rustenburg Mining Services', email: 'bongani@quantilytix.co.za', role: 'incubatee', departmentName: null }
}

const MOV = {
    labour: 'mov_seed_ai_nFpTqvOR0gSg3HgsoLMe_8plZb0CPdR3U11PAcBZN_nosub_seed',
    ip: 'mov_seed_ai_SihV5sbqxAIlQ08Dtk29_6KOjejvu2Bs2yVpW2XeM_nosub_seed',
    shareholder: 'mov_seed_ai_nFpTqvOR0gSg3HgsoLMe_lg_shareholder_agreement_sub_seed_lg_shareholder_agreement_1_2026-09_seed',
    business: 'mov_seed_ai_WTsiGqY4C0rlPvndMMtK_Iod2YQ13G1xQxHsKWQDI_nosub_seed',
    commercial: 'mov_seed_ai_WTsiGqY4C0rlPvndMMtK_2rzrrqFV7YnlS9yswk7x_nosub_2026-W39_seed'
}
const DISPUTED_ASSIGNMENT = 'ai_WTsiGqY4C0rlPvndMMtK_Iod2YQ13G1xQxHsKWQDI_nosub_seed'

const daysAgo = n => Timestamp.fromDate(new Date(Date.now() - n * 86400000))
const who = p => ({ name: p.name, email: p.email, role: p.role, departmentName: p.departmentName })
const resolver = { resolverId: PEOPLE.facilitator.uid, resolverProfileId: PEOPLE.facilitator.uid, resolver: who(PEOPLE.facilitator) }

/** The MOV's own context, as raiseQuery() writes it. */
async function movContext(movId) {
    const m = (await db.collection('movDocuments').doc(movId).get()).data()
    if (!m) throw new Error(`MOV ${movId} is missing; run seed-legal-flow.cjs first`)
    return {
        interventionId: m.interventionId || null,
        interventionTitle: m.interventionTitle || null,
        movId,
        participantId: m.beneficiaryId || m.smmeId || m.participantId || null,
        departmentName: m.departmentName || DEPARTMENT,
        lockedInPackAtCreation: false
    }
}

async function buildQueries() {
    const labour = await movContext(MOV.labour)
    const ip = await movContext(MOV.ip)
    const shareholder = await movContext(MOV.shareholder)
    const business = await movContext(MOV.business)
    const commercial = await movContext(MOV.commercial)
    const base = (id, raisedBy, created) => ({
        schemaVersion: 1,
        programId: PROGRAM_ID,
        raisedById: raisedBy.uid,
        raisedBy: who(raisedBy),
        ...resolver,
        assignedAt: created,
        createdAt: created,
        updatedAt: created,
        ...marks,
        seedKey: id
    })

    return {
        seed_lq_hod_register: {
            ...base('hod_register', PEOPLE.hod, daysAgo(2)),
            type: 'poe-request',
            message: 'The signed attendance register for the labour law session isn’t attached. Please upload it so I can approve this MOV.',
            status: 'open',
            target: { type: 'mov', id: MOV.labour },
            context: labour
        },
        seed_lq_hod_question: {
            ...base('hod_question', PEOPLE.hod, daysAgo(1)),
            type: 'general-query',
            message: 'The session is recorded as 3 hours. Was it one sitting, or split over two days?',
            status: 'open',
            target: { type: 'mov', id: MOV.labour },
            context: labour
        },
        seed_lq_cc_sentback: {
            ...base('cc_sentback', PEOPLE.cc, daysAgo(9)),
            type: 'cc-poe-query',
            message: 'The IP search report in the evidence is for a different company name. Please attach the report for Dante Welch.',
            status: 'open',
            target: { type: 'mov', id: MOV.ip },
            context: ip,
            response: { message: 'Attached the search report again.', attachmentUrls: [], noNewEvidence: true, respondedAt: daysAgo(6), respondedById: PEOPLE.facilitator.uid, respondedBy: who(PEOPLE.facilitator) },
            lastSentBack: { notes: 'Still the wrong report. It names “Welch Holdings”, not Dante Welch. Please attach the right one.', at: daysAgo(4), by: who(PEOPLE.cc) },
            sentBackCount: 1,
            thread: [
                { kind: 'answered', message: 'Attached the search report again.', noNewEvidence: true, byId: PEOPLE.facilitator.uid, by: who(PEOPLE.facilitator), at: daysAgo(6) },
                { kind: 'sent-back', message: 'Still the wrong report. It names “Welch Holdings”, not Dante Welch. Please attach the right one.', byId: PEOPLE.cc.uid, by: who(PEOPLE.cc), at: daysAgo(4) }
            ]
        },
        seed_lq_me_answered: {
            ...base('me_answered', PEOPLE.me, daysAgo(7)),
            type: 'me-query',
            message: 'The MOV says two signatories, but the shareholder agreement only has one signature page. Please confirm.',
            status: 'answered',
            target: { type: 'mov', id: MOV.shareholder },
            context: shareholder,
            response: { message: 'The second shareholder signed electronically; the signature is on page 14 of the agreement already on the MOV.', attachmentUrls: [], noNewEvidence: true, respondedAt: daysAgo(3), respondedById: PEOPLE.facilitator.uid, respondedBy: who(PEOPLE.facilitator) },
            thread: [
                { kind: 'answered', message: 'The second shareholder signed electronically; the signature is on page 14 of the agreement already on the MOV.', noNewEvidence: true, byId: PEOPLE.facilitator.uid, by: who(PEOPLE.facilitator), at: daysAgo(3) }
            ]
        },
        seed_lq_sme_dispute: {
            ...base('sme_dispute', PEOPLE.sme, daysAgo(1)),
            type: 'completion-rejected',
            message: 'Only partly delivered: We agreed on a review of both supplier contracts, but only the first one was covered.',
            status: 'open',
            target: { type: 'assigned-intervention', id: DISPUTED_ASSIGNMENT },
            context: { ...business, interventionId: DISPUTED_ASSIGNMENT, disputeCategory: 'partly-delivered' }
        },
        seed_lq_hod_resolved: {
            ...base('hod_resolved', PEOPLE.hod, daysAgo(20)),
            type: 'general-query',
            message: 'Which contract template did you use for the commercial lease review?',
            status: 'resolved',
            target: { type: 'mov', id: MOV.commercial },
            context: commercial,
            response: { message: 'The 2025 Law Society commercial lease template; a copy is in the evidence.', attachmentUrls: [], respondedAt: daysAgo(18), respondedById: PEOPLE.facilitator.uid, respondedBy: who(PEOPLE.facilitator) },
            resolution: { notes: 'Thanks, that’s fine.', resolvedAt: daysAgo(17), resolvedById: PEOPLE.hod.uid, resolvedBy: who(PEOPLE.hod) },
            resolvedAt: daysAgo(17),
            thread: [
                { kind: 'answered', message: 'The 2025 Law Society commercial lease template; a copy is in the evidence.', byId: PEOPLE.facilitator.uid, by: who(PEOPLE.facilitator), at: daysAgo(18) },
                { kind: 'accepted', message: 'Thanks, that’s fine.', byId: PEOPLE.hod.uid, by: who(PEOPLE.hod), at: daysAgo(17) }
            ]
        }
    }
}

/** What the open queries do to their records, as the app would. */
const SIDE_EFFECTS = [
    { collection: 'movDocuments', id: MOV.labour, patch: () => ({ status: 'queried', approvedByHod: false, suppressNotifications: true }) },
    {
        collection: 'assignedInterventions',
        id: DISPUTED_ASSIGNMENT,
        patch: () => ({
            participantCompletionStatus: 'rejected',
            participantCompletionRejectedAt: daysAgo(1),
            participantCompletionRejectionReason: 'We agreed on a review of both supplier contracts, but only the first one was covered.',
            participantCompletionRejectionCategory: 'partly-delivered',
            assignmentStatus: 'in-progress'
        })
    }
]

async function seed() {
    const queries = await buildQueries()
    const refs = Object.keys(queries).map(id => db.collection('workflowQueries').doc(id))
    const existing = await db.getAll(...refs)
    const foreign = existing.filter(s => s.exists && s.data().seedTag !== SEED_TAG)
    if (foreign.length) throw new Error(`Not ours, stopping: ${foreign.map(s => s.id).join(', ')}`)

    for (const [id, q] of Object.entries(queries)) console.log(`  query ${id}: ${q.type} · ${q.status} · by ${q.raisedBy.name}`)
    for (const s of SIDE_EFFECTS) {
        const ref = db.collection(s.collection).doc(s.id)
        const current = (await ref.get()).data()
        if (!current) throw new Error(`${s.collection}/${s.id} is missing`)
        if (current.suppressNotifications !== true && s.collection === 'assignedInterventions') throw new Error(`${s.id} is not a seeded assignment`)
        console.log(`  ${s.collection}/${s.id.slice(0, 48)}…: ${JSON.stringify(s.patch())}`)
    }
    if (!APPLY) return console.log('\nDry run. Add --apply to write.')

    const batch = db.batch()
    for (const [id, q] of Object.entries(queries)) batch.set(db.collection('workflowQueries').doc(id), q)
    for (const s of SIDE_EFFECTS) {
        const ref = db.collection(s.collection).doc(s.id)
        const current = (await ref.get()).data()
        const patch = s.patch()
        // Keep what was there (only the first time), so --remove can put it back.
        const previous = current.seedLegalQueriesPrevious || Object.fromEntries(Object.keys(patch).map(k => [k, current[k] === undefined ? null : current[k]]))
        batch.update(ref, { ...patch, seedLegalQueriesPrevious: previous, updatedAt: Timestamp.now() })
    }
    await batch.commit()
    console.log('\nSeeded.')
}

async function remove() {
    const snap = await db.collection('workflowQueries').where('seedTag', '==', SEED_TAG).get()
    console.log(`  ${snap.size} seeded quer${snap.size === 1 ? 'y' : 'ies'}`)
    const restores = []
    for (const s of SIDE_EFFECTS) {
        const ref = db.collection(s.collection).doc(s.id)
        const previous = (await ref.get()).data()?.seedLegalQueriesPrevious
        if (previous) { restores.push([ref, previous]); console.log(`  restore ${s.collection}/${s.id.slice(0, 48)}…: ${JSON.stringify(previous)}`) }
    }
    if (!APPLY) return console.log('\nDry run. Add --apply to remove.')
    const batch = db.batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    // suppressNotifications stays: restoring the status must not look like a fresh SME confirmation to onMovLateConfirmation.
    for (const [ref, { suppressNotifications, ...previous }] of restores) batch.update(ref, { ...previous, seedLegalQueriesPrevious: FieldValue.delete(), updatedAt: Timestamp.now() })
    await batch.commit()
    console.log('\nRemoved.')
}

;(async () => {
    console.log(`${key.project_id} · ${SEED_TAG} · ${REMOVE ? 'remove' : 'seed'} (${APPLY ? 'APPLY' : 'dry run'})\n`)
    await (REMOVE ? remove() : seed())
    process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
