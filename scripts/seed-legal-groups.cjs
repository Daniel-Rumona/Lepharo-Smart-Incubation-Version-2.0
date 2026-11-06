// Seeds three grouped Legal interventions (one delivery to several SMEs) for the
// Legal Advisory Coordinator (legalcoordinator@quantilytix.co.za) in SRMCDT:
//   1. Commercial Law Advisory     in delivery, 60%                     (Dante, Karoo, Test Inc)
//   2. Compliance (PAIA / POPIA)   delivered, awaiting SME sign-off     (Rustenburg, Dante, Karoo; Dante confirmed)
//   3. Business Insurance Law      delivered, one SME disputes it       (Rustenburg disputes; Test Inc, Karoo confirmed)
// Group 3 has an open SME delivery dispute (a completion-rejected query), to try
// "Deliver what's missing" for just that SME (catch-up) or the whole group.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-groups.cjs [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-groups.cjs --remove [--apply]
//
// Every document has a fixed seed_lg_ id and carries seedTag, dataOrigin: 'synthetic'
// and suppressNotifications: true, so no email or in-app notification goes out and
// re-running overwrites rather than duplicates. Each group uses its own cycleKey, so it
// never merges with the SMEs' single Legal assignments.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { Timestamp } = admin.firestore

const SEED_TAG = 'seed-legal-groups'
const PROGRAM = { id: 'b3qe3WAMAVw3QU64CLIY', name: 'SRMCDT Project' }
const DEPARTMENT = { id: '9bu8xeGsQu4O1NVV73Du', name: 'Legal Advisory Services' }
const COORDINATOR_UID = 'KD1WPtLLrNcihHGYeWKAFWAKriw2' // legalcoordinator@quantilytix.co.za
const marks = { dataOrigin: 'synthetic', suppressNotifications: true, seedTag: SEED_TAG }

const SMES = {
    dante: 'SihV5sbqxAIlQ08Dtk29',
    karoo: 'nFpTqvOR0gSg3HgsoLMe',
    testinc: 'kb7kcDbm7bejjR928VN3lHwzFrG2',
    rustenburg: 'WTsiGqY4C0rlPvndMMtK'
}
const IV = {
    commercial: '2rzrrqFV7YnlS9yswk7x',
    compliance: 'LSUNevJ7KUonfir4Hrqy',
    insurance: 'Y19hiSKSTLyw5H1YKfgM'
}

const DAY = 24 * 60 * 60 * 1000
const at = (days, hour = 10) => {
    const d = new Date(Date.now() + days * DAY)
    d.setUTCHours(hour, 0, 0, 0)
    return Timestamp.fromDate(d)
}

// confirmed: SMEs who signed; disputes: SMEs who rejected (with their reason)
const GROUPS = [
    { n: 1, iv: 'commercial', members: ['dante', 'karoo', 'testinc'], progress: [30, 60], startDays: -20 },
    { n: 2, iv: 'compliance', members: ['rustenburg', 'dante', 'karoo'], progress: [50, 100], startDays: -24, confirmed: ['dante'] },
    {
        n: 3, iv: 'insurance', members: ['rustenburg', 'testinc', 'karoo'], progress: [40, 80, 100], startDays: -30,
        confirmed: ['testinc', 'karoo'],
        disputes: { rustenburg: 'We were promised a review of our fleet and public liability cover; only the fleet policy was looked at.' }
    }
]

const ids = {
    group: g => `seed_lg_group_${g.n}`,
    assignment: (g, sme) => `seed_lg_${g.n}_${SMES[sme]}`,
    mov: (g, sme) => `seed_lg_mov_${g.n}_${SMES[sme]}`,
    query: (g, sme) => `seed_lg_dispute_${g.n}_${SMES[sme]}`
}

async function build() {
    const coord = (await db.collection('users').doc(COORDINATOR_UID).get()).data()
    if (!coord) throw new Error('legalcoordinator is missing')
    const ivs = {}
    for (const [k, id] of Object.entries(IV)) {
        const d = (await db.collection('interventions').doc(id).get()).data()
        if (!d) throw new Error(`intervention ${id} missing`)
        ivs[k] = { id, ...d }
    }
    const smes = {}
    for (const [k, id] of Object.entries(SMES)) {
        const p = (await db.collection('participants').doc(id).get()).data()
        if (!p) throw new Error(`participant ${id} missing`)
        smes[k] = { id, name: p.beneficiaryName || p.participantName || 'SME', email: String(p.email || '').toLowerCase(), smmeNo: p.smmeNo || null }
    }

    const docs = []
    for (const g of GROUPS) {
        const iv = ivs[g.iv]
        const groupKey = ids.group(g)
        const cycleKey = `group-${g.n}`
        const createdAt = at(g.startDays, 8)
        const updates = g.progress.map((value, i) => ({
            by: COORDINATOR_UID,
            byName: coord.name,
            source: 'facilitator-progress',
            note: value >= 100 ? 'Final group session held; advice pack shared with every SME.' : `Group session ${i + 1} held with all SMEs present.`,
            previousProgress: i ? g.progress[i - 1] : 0,
            computedProgress: value,
            resources: [],
            createdAt: at(g.startDays + 4 * (i + 1), 12)
        }))
        const latest = g.progress[g.progress.length - 1]
        const delivered = latest >= 100
        const completedAt = delivered ? updates[updates.length - 1].createdAt : null
        const confirmedAt = delivered ? Timestamp.fromMillis(completedAt.toMillis() + 2 * DAY) : null

        docs.push({
            path: `groupInterventionDeliveries/${encodeURIComponent(groupKey)}`,
            label: `group ${g.n}: ${iv.interventionTitle} · ${latest}%`,
            data: {
                ...marks,
                schemaVersion: 1,
                groupKey,
                programId: PROGRAM.id,
                departmentId: DEPARTMENT.id,
                interventionId: iv.id,
                interventionTitle: iv.interventionTitle,
                subInterventionId: null,
                subInterventionTitle: null,
                assigneeId: COORDINATOR_UID,
                assigneeName: coord.name,
                assigneeEmail: coord.email,
                progress: latest,
                deliveryStatus: delivered ? 'completed' : 'in_progress',
                evidence: [],
                progressUpdates: updates,
                sessionsCompleted: g.progress.length,
                plannedSessions: g.progress.length + (delivered ? 0 : 1),
                sourceAssignmentIds: g.members.map(m => ids.assignment(g, m)),
                ...(delivered ? { completedAt } : {}),
                createdAt,
                updatedAt: updates[updates.length - 1].createdAt
            }
        })

        for (const m of g.members) {
            const sme = smes[m]
            const assignmentId = ids.assignment(g, m)
            const confirmed = delivered && (g.confirmed || []).includes(m)
            const disputeReason = delivered ? (g.disputes || {})[m] : null
            const movId = delivered ? ids.mov(g, m) : null
            const assignment = {
                ...marks,
                // Complete as written: the denormalisation trigger skips synthetic seeds marked this way.
                seedHydration: true,
                id: assignmentId,
                participantId: sme.id,
                participantName: sme.name,
                participantEmail: sme.email,
                smmeNo: sme.smmeNo,
                interventionId: iv.id,
                interventionTitle: iv.interventionTitle,
                hasSubInterventions: false,
                subInterventionId: null,
                subInterventionTitle: null,
                definitionVersion: Math.max(1, Number(iv.definitionVersion || 1)),
                ...(iv.outcomeDef ? { definitionSnapshot: { version: Math.max(1, Number(iv.definitionVersion || 1)), interventionId: iv.id, interventionTitle: iv.interventionTitle, outcomeDef: iv.outcomeDef, deliverableName: iv.outcomeDef?.deliverable?.name || null, capturedAt: createdAt } } : {}),
                dueDate: at(g.startDays + 30, 22),
                assigneeRole: 'coordinator',
                assigneeId: COORDINATOR_UID,
                assigneeName: coord.name,
                assigneeEmail: coord.email,
                assignmentStatus: confirmed ? 'completed' : 'in-progress',
                assigneeAcceptanceStatus: 'accepted',
                assigneeAcceptedAt: createdAt,
                participantAcceptanceStatus: 'accepted',
                participantAcceptedAt: createdAt,
                assigneeCompletionStatus: delivered ? 'completed' : 'pending',
                participantCompletionStatus: confirmed ? 'confirmed' : disputeReason ? 'rejected' : 'pending',
                areaOfSupport: iv.areaOfSupport || DEPARTMENT.name,
                departmentId: DEPARTMENT.id,
                departmentName: DEPARTMENT.name,
                programId: PROGRAM.id,
                scheduleMode: 'ad-hoc',
                cycleKey,
                recurrence: null,
                plannedSessions: g.progress.length + (delivered ? 0 : 1),
                tracking: { sessionsLogged: g.progress.length },
                computedProgress: latest,
                progressUpdates: [],
                resources: [],
                type: 'group',
                groupKey,
                groupedAt: createdAt,
                schemaVersion: 3,
                createdAt,
                assignedAt: createdAt,
                updatedAt: confirmedAt || updates[updates.length - 1].createdAt,
                ...(delivered ? { assigneeCompletedAt: completedAt, movDocumentId: movId } : {}),
                ...(confirmed ? { participantConfirmedAt: confirmedAt, completedAt: confirmedAt, smmeAccepted: true, smmeAcceptedAt: confirmedAt } : {}),
                ...(disputeReason ? {
                    participantCompletionRejectedAt: confirmedAt,
                    participantCompletionRejectionReason: disputeReason,
                    participantCompletionRejectionCategory: 'partly-delivered'
                } : {})
            }
            docs.push({ path: `assignedInterventions/${assignmentId}`, label: `  ${sme.name}: ${confirmed ? 'confirmed' : disputeReason ? 'DISPUTED' : delivered ? 'awaiting sign-off' : 'in delivery'}`, data: assignment })

            if (delivered) {
                docs.push({
                    path: `movDocuments/${movId}`,
                    label: `  MOV ${confirmed ? 'awaiting_hod' : 'awaiting_smme'}`,
                    data: {
                        ...marks,
                        agreementId: 'mov',
                        sourceType: 'assignedIntervention',
                        assignedInterventionId: assignmentId,
                        programId: PROGRAM.id,
                        programName: PROGRAM.name,
                        departmentId: DEPARTMENT.id,
                        departmentName: DEPARTMENT.name,
                        areaOfSupport: assignment.areaOfSupport,
                        interventionId: iv.id,
                        interventionTitle: iv.interventionTitle,
                        subInterventionId: null,
                        subInterventionTitle: null,
                        deliveryMethod: 'in-person',
                        status: confirmed ? 'awaiting_hod' : 'awaiting_smme',
                        createdAt: completedAt,
                        updatedAt: confirmedAt,
                        completedAt,
                        interventionDate: completedAt,
                        dueDate: assignment.dueDate,
                        periodStart: createdAt,
                        periodEnd: confirmed ? confirmedAt : null,
                        appointmentInterventions: updates.map((u, i) => ({ title: `Group session ${i + 1}`, date: u.createdAt, signature: '', deliveryMethod: 'in-person' })),
                        progressUpdates: updates,
                        resources: [],
                        facilitatorId: COORDINATOR_UID,
                        facilitatorName: coord.name,
                        facilitatorEmail: coord.email,
                        facilitatorSignatureUrl: coord.signatureURL || '',
                        facilitatorSignedAt: completedAt,
                        smmeAccepted: confirmed,
                        smmeAcceptedAt: confirmed ? confirmedAt : null,
                        smmeSignedAt: confirmed ? confirmedAt : null,
                        smmeId: sme.id,
                        participantId: sme.id,
                        smmeCompanyName: sme.name,
                        smmeNo: sme.smmeNo || '',
                        createdByUid: COORDINATOR_UID,
                        createdByName: coord.name,
                        createdByEmail: coord.email
                    }
                })
            }

            if (disputeReason) {
                docs.push({
                    path: `workflowQueries/${ids.query(g, m)}`,
                    label: `  dispute query (open)`,
                    data: {
                        ...marks,
                        schemaVersion: 1,
                        programId: PROGRAM.id,
                        type: 'completion-rejected',
                        message: `Only partly delivered: ${disputeReason}`,
                        status: 'open',
                        raisedById: sme.id,
                        raisedBy: { name: sme.name, email: sme.email, role: 'incubatee', departmentName: null },
                        resolverId: COORDINATOR_UID,
                        resolverProfileId: COORDINATOR_UID,
                        resolver: { name: coord.name, email: coord.email, role: 'coordinator', departmentName: DEPARTMENT.name },
                        target: { type: 'assigned-intervention', id: assignmentId },
                        context: {
                            participantId: sme.id,
                            interventionId: assignmentId,
                            interventionTitle: iv.interventionTitle,
                            movId,
                            departmentName: DEPARTMENT.name,
                            disputeCategory: 'partly-delivered'
                        },
                        assignedAt: confirmedAt,
                        createdAt: confirmedAt,
                        updatedAt: confirmedAt
                    }
                })
            }
        }
    }
    return docs
}

async function seed() {
    const docs = await build()
    const existing = await db.getAll(...docs.map(d => db.doc(d.path)))
    const foreign = existing.filter(s => s.exists && s.data().seedTag !== SEED_TAG)
    if (foreign.length) throw new Error(`Not ours, stopping: ${foreign.map(s => s.ref.path).join(', ')}`)
    docs.forEach(d => console.log(`${d.label}`))
    if (!APPLY) return console.log(`\n${docs.length} documents. Dry run; add --apply to write.`)
    const batch = db.batch()
    docs.forEach(d => batch.set(db.doc(d.path), d.data))
    await batch.commit()
    console.log(`\nSeeded ${docs.length} documents.`)
}

async function remove() {
    const refs = []
    // Follow-ups the server creates for confirmed members use the assignment id as theirs.
    const followUps = await db.getAll(...GROUPS.flatMap(g => g.members.map(m => db.collection('outcomeFollowUps').doc(ids.assignment(g, m)))))
    followUps.filter(s => s.exists).forEach(s => refs.push(s.ref))
    console.log(`  outcomeFollowUps: ${followUps.filter(s => s.exists).length}`)
    for (const c of ['assignedInterventions', 'groupInterventionDeliveries', 'movDocuments', 'workflowQueries']) {
        const snap = await db.collection(c).where('seedTag', '==', SEED_TAG).get()
        console.log(`  ${c}: ${snap.size}`)
        snap.docs.forEach(d => refs.push(d.ref))
    }
    if (!APPLY) return console.log('\nDry run; add --apply to remove.')
    const batch = db.batch()
    refs.forEach(r => batch.delete(r))
    await batch.commit()
    console.log(`\nRemoved ${refs.length} documents.`)
}

;(async () => {
    console.log(`${key.project_id} · ${SEED_TAG} · ${REMOVE ? 'remove' : 'seed'} (${APPLY ? 'APPLY' : 'dry run'})\n`)
    await (REMOVE ? remove() : seed())
    process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
