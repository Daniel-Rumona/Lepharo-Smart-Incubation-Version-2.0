// Adds two stepped Legal interventions (interventions broken into sub-interventions)
// and seeds one stepped and one recurring example for the Legal coordinator:
//
//   testapplication@  Shareholder Agreement Development (stepped)
//       step 1 "Fact-finding and requirements"  completed, MOV approved, rated
//       step 2 "Drafting the agreement"         in delivery, 1 of 2 sessions held, next one booked
//       step 3 is not assigned yet
//   bongani@          Commercial Law Advisory (recurring weekly)
//       previous cycle                          completed, MOV approved, rated
//       current cycle                           in delivery, 1 of 2 sessions held, next one booked
//
// "Contract Management Setup" is created as a second stepped intervention but not assigned.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-stepped-recurring.cjs [--apply] [--overwrite]
//
// Assignments carry suppressNotifications: true (no assignment email). Documents already
// in the project are skipped unless --overwrite is given.
const path = require('path')
const admin = require('firebase-admin')
const dayjs = require('dayjs')
dayjs.extend(require('dayjs/plugin/weekOfYear'))

const APPLY = process.argv.includes('--apply')
const OVERWRITE = process.argv.includes('--overwrite')

const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(newKey) }).firestore()
const { Timestamp } = admin.firestore

const PROGRAM = { id: 'b3qe3WAMAVw3QU64CLIY', name: 'SRMCDT Project' }
const LEGAL = { id: '9bu8xeGsQu4O1NVV73Du', name: 'Legal Advisory Services' }
const COORDINATOR_UID = 'KD1WPtLLrNcihHGYeWKAFWAKriw2' // legalcoordinator@quantilytix.co.za
const HOD_EMAIL = 'legal@quantilytix.co.za'
const SME = { testapp: 'nFpTqvOR0gSg3HgsoLMe', bongani: 'WTsiGqY4C0rlPvndMMtK' }
const COMMERCIAL_ID = '2rzrrqFV7YnlS9yswk7x' // Commercial Law Advisory, weekly

const DAY = 24 * 60 * 60 * 1000
const at = (days, hour = 10) => {
    const d = new Date(Date.now() + days * DAY)
    d.setUTCHours(hour, 0, 0, 0)
    return Timestamp.fromDate(d)
}
const safeKey = (v) => encodeURIComponent(v).replace(/%/g, '_')
const weekKey = (ts) => { const d = dayjs(ts.toDate()); return `${d.year()}-W${String(d.week()).padStart(2, '0')}` }

async function put(ref, data, label) {
    const exists = (await db.doc(ref).get()).exists
    if (exists && !OVERWRITE) return console.log(`  skip  ${label} (already exists)`)
    console.log(`  ${APPLY ? 'write' : 'would write'} ${label}${exists ? ' (overwrite)' : ''}`)
    if (APPLY) await db.doc(ref).set(data)
}

// ── the two stepped interventions ─────────────────────────────────────────────
const steppedDef = (id, title, steps, outcome) => {
    const now = Timestamp.now()
    return {
        id,
        interventionTitle: title,
        areaOfSupport: LEGAL.name,
        departmentId: LEGAL.id,
        compulsory: false,
        assignmentMode: 'once-off',
        recurring: false,
        recurrencePreset: 'as-needed',
        recurrence: null,
        recurrenceStrict: false,
        recurrenceEnd: null,
        frequency: 'as-needed',
        recurrenceFrequency: 'other',
        hasSubInterventions: true,
        subInterventions: steps.map((s, i) => ({
            subId: `sub_seed_${id}_${i + 1}`,
            title: s.title,
            description: s.description,
            active: true,
            archivedAt: null,
            defaultPlannedSessions: s.sessions,
        })),
        subInterventionRotationMode: 'rotate',
        definitionVersion: 1,
        outcomeDef: {
            origin: 'ai_suggested',
            deliverable: { name: outcome.deliverable, description: outcome.deliverableDescription, required: true },
            intendedOutcome: outcome.intended,
            outcomeType: 'process_implemented',
            acceptedMechanisms: ['deliverable', 'facilitator_observation', 'sme_self_report'],
            checkAdoption: true,
            followUp: { required: true, smeCheckIn: true },
            followUpAfterDays: 60,
        },
        createdAt: now,
        updatedAt: now,
    }
}

const SHAREHOLDER_ID = 'lg_shareholder_agreement'
const CONTRACTS_ID = 'lg_contract_management'
const DEFS = [
    steppedDef(SHAREHOLDER_ID, 'Shareholder Agreement Development', [
        { title: 'Fact-finding and requirements', description: 'Meet the shareholders and capture ownership, roles and exit expectations.', sessions: 1 },
        { title: 'Drafting the agreement', description: 'Draft the shareholder agreement and walk the shareholders through it.', sessions: 2 },
        { title: 'Review, finalisation and signing', description: 'Incorporate comments and support the signing.', sessions: 1 },
    ], {
        deliverable: 'Signed Shareholder Agreement',
        deliverableDescription: 'The final shareholder agreement signed by all shareholders.',
        intended: 'The SME’s shareholders operate under a signed agreement covering ownership, decision-making and exit terms.',
    }),
    steppedDef(CONTRACTS_ID, 'Contract Management Setup', [
        { title: 'Contract audit', description: 'Review the contracts the SME currently relies on.', sessions: 1 },
        { title: 'Standard contract templates', description: 'Prepare approved templates for the SME’s common agreements.', sessions: 1 },
        { title: 'Contract register and approval process', description: 'Set up a contract register and a simple approval process.', sessions: 1 },
    ], {
        deliverable: 'Contract Management Pack',
        deliverableDescription: 'Contract register, approved templates and the approval process.',
        intended: 'The SME manages its contracts through a register and approved templates.',
    }),
]

async function main() {
    console.log(`${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'}${OVERWRITE ? ', overwrite' : ''})`)
    const coordSnap = await db.collection('users').doc(COORDINATOR_UID).get()
    if (!coordSnap.exists) throw new Error('legal coordinator missing, run migrate-legal.cjs first')
    const coord = coordSnap.data()
    const hodSnap = await db.collection('users').where('email', '==', HOD_EMAIL).limit(1).get()
    const hod = hodSnap.empty ? null : { id: hodSnap.docs[0].id, ...hodSnap.docs[0].data() }

    console.log('\n[stepped interventions]')
    for (const def of DEFS) await put(`interventions/${def.id}`, def, `interventions/${def.id} ${def.interventionTitle} (${def.subInterventions.length} steps)`)
    const shareholder = DEFS[0]
    const commercial = { id: COMMERCIAL_ID, ...(await db.collection('interventions').doc(COMMERCIAL_ID).get()).data() }
    if (!commercial.interventionTitle) throw new Error('Commercial Law Advisory missing')

    const sme = {}
    for (const [k, pid] of Object.entries(SME)) {
        const p = await db.collection('participants').doc(pid).get()
        const email = String(p.data().email || '').toLowerCase()
        const u = await db.collection('users').where('email', '==', email).limit(1).get()
        sme[k] = { id: pid, ...p.data(), user: u.empty ? {} : u.docs[0].data() }
    }

    // ── make sure each SME's confirmed Legal plan lists the intervention ──
    console.log('\n[diagnostic plans]')
    const addToPlan = async (pid, iv) => {
        const snap = await db.collection('diagnosticPlans').where('participantId', '==', pid).where('programId', '==', PROGRAM.id).get()
        const plan = snap.docs[0]
        if (!plan) return console.log(`  no plan for ${pid}, skipped`)
        const items = plan.data().interventions || []
        if (items.some((i) => (i.id || i.interventionId) === iv.id)) return console.log(`  ${iv.interventionTitle} already in plan ${plan.id.slice(-12)}`)
        console.log(`  ${APPLY ? 'add' : 'would add'} ${iv.interventionTitle} to plan ${plan.id.slice(-12)}`)
        if (APPLY) await plan.ref.update({ interventions: [...items, { source: 'Required', area: LEGAL.name, id: iv.id, title: iv.interventionTitle, departmentId: LEGAL.id }], updatedAt: Timestamp.now() })
    }
    await addToPlan(sme.testapp.id, shareholder)
    await addToPlan(sme.bongani.id, commercial)

    // ── assignment / session / MOV builders ──
    const counts = { assignments: 0, sessions: 0, movs: 0 }
    const seed = async (spec) => {
        const { smeKey, iv, step, cycleDate, state, sessions, feedback } = spec
        const s = sme[smeKey]
        const sub = step ? iv.subInterventions[step - 1] : null
        const assignedAt = at(cycleDate, 8)
        const recurring = iv.recurring === true && iv.recurrence
        const cycleKey = recurring ? weekKey(assignedAt) : dayjs(assignedAt.toDate()).format('YYYY-MM')
        const assignmentId = `ai_${s.id}_${iv.id}_${sub ? sub.subId : 'nosub'}_${cycleKey}_seed`
        const done = state === 'approved'
        const planned = spec.planned
        const heldCount = sessions.filter((x) => x.held).length
        const lastHeld = sessions.filter((x) => x.held).map((x) => x.end).sort((a, b) => b.toMillis() - a.toMillis())[0]
        const completedAt = done ? lastHeld : null
        const confirmedAt = done ? Timestamp.fromMillis(lastHeld.toMillis() + 2 * DAY) : null
        const movId = done ? `mov_seed_${assignmentId}` : null
        const title = sub ? `${iv.interventionTitle} - ${sub.title}` : iv.interventionTitle
        console.log(`\n[${smeKey}] ${title}${recurring ? ` (cycle ${cycleKey})` : ''}: ${state}`)

        const assignment = {
            id: assignmentId,
            participantId: s.id,
            participantName: s.beneficiaryName || s.participantName,
            smmeNo: s.smmeNo || null,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            hasSubInterventions: !!sub,
            subInterventionId: sub ? sub.subId : null,
            subInterventionTitle: sub ? sub.title : null,
            definitionVersion: Math.max(1, Number(iv.definitionVersion || 1)),
            definitionSnapshot: {
                version: Math.max(1, Number(iv.definitionVersion || 1)),
                interventionId: iv.id,
                interventionTitle: iv.interventionTitle,
                subInterventionId: sub ? sub.subId : null,
                subInterventionTitle: sub ? sub.title : null,
                ...(iv.outcomeDef ? { outcomeDef: iv.outcomeDef, deliverableName: iv.outcomeDef.deliverable?.name } : {}),
                capturedAt: assignedAt,
            },
            dueDate: at(cycleDate + 14, 22),
            assigneeRole: 'coordinator',
            assigneeId: COORDINATOR_UID,
            assigneeName: coord.name,
            assigneeEmail: coord.email,
            assignmentStatus: done ? 'completed' : 'in-progress',
            assigneeAcceptanceStatus: 'accepted',
            assigneeAcceptedAt: assignedAt,
            participantAcceptanceStatus: 'accepted',
            assigneeCompletionStatus: done ? 'completed' : 'pending',
            participantCompletionStatus: done ? 'confirmed' : 'pending',
            areaOfSupport: LEGAL.name,
            departmentId: LEGAL.id,
            programId: PROGRAM.id,
            scheduleMode: recurring ? 'recurring' : 'once-off',
            cycleKey,
            recurrence: recurring ? { ...iv.recurrence, strict: false } : null,
            priorOpenCycleRisk: null,
            plannedSessions: planned,
            tracking: { sessionsLogged: heldCount },
            computedProgress: done ? 100 : Math.round((heldCount / planned) * 100),
            type: 'singular',
            groupKey: null,
            groupedAt: null,
            schemaVersion: 3,
            progressUpdates: sessions.filter((x) => x.held).map((x) => ({ note: x.note, createdAt: x.end, by: COORDINATOR_UID, resources: [] })),
            resources: [],
            reassignmentHistory: [],
            createdAt: assignedAt,
            updatedAt: assignedAt,
            suppressNotifications: true,
        }
        if (done) {
            assignment.assigneeCompletedAt = completedAt
            assignment.completedAt = completedAt
            assignment.movDocumentId = movId
            assignment.participantConfirmedAt = confirmedAt
            assignment.smmeAccepted = true
            assignment.smmeAcceptedAt = confirmedAt
            assignment.smmeDigitalSignature = s.user.digitalSignature || ''
            assignment.smmeSignatureUrl = s.user.signatureURL || ''
            assignment.feedback = feedback
        }

        const apptIds = []
        for (const x of sessions) {
            const sessionId = `session_${safeKey([PROGRAM.id, LEGAL.id, iv.id, assignmentId, x.start.toMillis(), COORDINATOR_UID].join('__'))}`
            const appointmentId = `appointment_${safeKey(`${sessionId}__${s.id}`)}`
            apptIds.push({ appointmentId, held: x.held, start: x.start, end: x.end })
            const base = {
                schemaVersion: 5, programId: PROGRAM.id, departmentId: LEGAL.id, interventionId: iv.id,
                interventionTitle: iv.interventionTitle, cycleKey, groupKey: null,
                assigneeId: COORDINATOR_UID, assigneeName: coord.name, assigneeEmail: coord.email, assigneeRole: 'coordinator',
                status: x.held ? 'completed' : 'scheduled', createdAt: assignedAt, updatedAt: assignedAt,
                completedAt: x.held ? x.end : null,
            }
            const session = {
                ...base,
                sessionType: 'individual',
                title: `${title} session`,
                startAt: x.start, endAt: x.end,
                deliveryMethod: 'in_person', location: 'Rustenburg Hub', meetingLink: null,
                plannedTopics: [], plannedCoverage: [],
                coverage: x.held
                    ? { held: true, outcomeSummary: x.note, coveredPoints: x.points, reasonNotHeld: null, recordedAt: x.end, recordedById: COORDINATOR_UID }
                    : { held: null, outcomeSummary: null, coveredPoints: [], reasonNotHeld: null, recordedAt: null, recordedById: null },
                attendanceSession: null,
                attendanceSummary: { invitedCount: 1, attendedCount: x.held ? 1 : 0, checkedInCount: x.held ? 1 : 0, checkedOutCount: x.held ? 1 : 0 },
                foodMenu: [],
            }
            const appointment = {
                ...base,
                assignedInterventionId: assignmentId, appointmentSessionId: sessionId,
                smeId: s.id, smeName: assignment.participantName, smeEmail: String(s.email || '').toLowerCase() || null,
                subInterventionId: sub ? sub.subId : null, subInterventionTitle: sub ? sub.title : null,
                smeConfirmation: 'confirmed', smeDeclineReason: null,
                attendance: x.held ? { status: 'attended', checkedInAt: x.start, checkedOutAt: x.end } : { status: 'expected', checkedInAt: null, checkedOutAt: null },
                foodSelections: [],
            }
            await put(`appointmentSessions/${sessionId}`, session, `appointmentSessions/${sessionId.slice(-22)}  ${x.held ? 'held' : 'UPCOMING'} ${x.start.toDate().toISOString().slice(0, 10)}`)
            await put(`appointments/${appointmentId}`, appointment, `appointments/${appointmentId.slice(-22)}`)
            counts.sessions++
        }
        if (!done) {
            // Recorded attendance for the held sessions, as the app stores it.
            assignment.sessionAttendanceByAppointment = Object.fromEntries(
                apptIds.filter((a) => a.held).map((a) => [a.appointmentId, { held: true, outcome: 'attended', recordedAt: a.end }])
            )
        }
        await put(`assignedInterventions/${assignmentId}`, assignment, `assignedInterventions/${assignmentId.slice(0, 60)}`)
        counts.assignments++

        if (done) {
            const mov = {
                agreementId: 'mov', sourceType: 'assignedIntervention', assignedInterventionId: assignmentId, diagnosticPlanId: null,
                programId: PROGRAM.id, programName: PROGRAM.name, departmentId: LEGAL.id, departmentName: LEGAL.name,
                areaOfSupport: LEGAL.name, kpiServiced: '',
                interventionId: iv.id, interventionTitle: iv.interventionTitle,
                subInterventionId: sub ? sub.subId : null, subInterventionTitle: sub ? sub.title : null,
                deliveryMethod: 'in-person', frequency: recurring ? 'weekly' : null,
                status: 'approved', approvedByHod: true,
                ...(hod ? { approvedByUid: hod.id, approvedByName: hod.name || '', approvedByEmail: hod.email } : {}),
                createdAt: completedAt, updatedAt: confirmedAt, completedAt, interventionDate: completedAt,
                periodStart: assignedAt, periodEnd: confirmedAt,
                appointmentInterventions: sessions.filter((x) => x.held).map((x) => ({ title: `${title} session`, date: x.start, signature: '', deliveryMethod: 'in-person' })),
                progressUpdates: assignment.progressUpdates, resources: [],
                facilitatorId: COORDINATOR_UID, facilitatorName: coord.name, facilitatorEmail: coord.email,
                facilitatorDigitalSignature: coord.digitalSignature || '', facilitatorSignatureUrl: coord.signatureURL || '',
                facilitatorSignedAt: completedAt, needsFacilitatorRepair: !coord.signatureURL,
                smmeAccepted: true, smmeAcceptedAt: confirmedAt, smmeSignedAt: confirmedAt,
                smmeSignatureUrl: s.user.signatureURL || '', smmeDigitalSignature: s.user.digitalSignature || '',
                needsSmmeSignatureRepair: !s.user.signatureURL,
                smmeId: s.id, participantId: s.id, smmeName: '', smmeCompanyName: assignment.participantName, smmeNo: s.smmeNo || '',
                smmeFeedback: feedback,
                createdByUid: COORDINATOR_UID, createdByName: coord.name, createdByEmail: coord.email,
            }
            await put(`movDocuments/${movId}`, mov, `movDocuments/${movId.slice(0, 50)} (approved)`)
            counts.movs++
        }
    }

    const sess = (heldDays, note, points) => ({ held: true, start: at(heldDays, 10), end: at(heldDays, 11), note, points })
    const upcoming = (days) => ({ held: false, start: at(days, 10), end: at(days, 11) })

    console.log('\n[stepped: Shareholder Agreement Development for testapplication@]')
    await seed({
        smeKey: 'testapp', iv: shareholder, step: 1, cycleDate: -30, state: 'approved', planned: 1,
        sessions: [sess(-24, 'Met the shareholders and captured ownership split, roles and exit expectations.', ['Ownership split', 'Roles and decision rights', 'Exit expectations'])],
        feedback: { rating: 5, comments: 'The fact-finding session was thorough. Everyone got to say what they expect, and it exposed two points we had never agreed on.' },
    })
    await seed({
        smeKey: 'testapp', iv: shareholder, step: 2, cycleDate: -12, state: 'in_delivery', planned: 2,
        sessions: [
            sess(-4, 'First drafting session: walked through the draft clauses on ownership and decision-making.', ['Ownership clauses', 'Decision-making and voting']),
            upcoming(5),
        ],
    })

    console.log('\n[recurring: Commercial Law Advisory (weekly) for bongani@]')
    await seed({
        smeKey: 'bongani', iv: commercial, step: 0, cycleDate: -15, state: 'approved', planned: 1,
        sessions: [sess(-13, 'Reviewed the supplier contract and the standard customer terms.', ['Supplier contract risks', 'Customer terms of trade'])],
        feedback: { rating: 4, comments: 'Good review of our supplier contract. The advice on payment terms was the most useful part.' },
    })
    await seed({
        smeKey: 'bongani', iv: commercial, step: 0, cycleDate: -4, state: 'in_delivery', planned: 2,
        sessions: [
            sess(-2, 'Weekly advisory: reviewed the new framework agreement draft from the client.', ['Framework agreement draft', 'Liability and termination clauses']),
            upcoming(2),
        ],
    })

    console.log(`\n${APPLY ? 'Done' : 'Dry run'}: ${JSON.stringify(counts)} (counts include skipped existing documents)`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
