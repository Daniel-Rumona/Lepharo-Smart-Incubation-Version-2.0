// Seeds the SRMCDT test SMEs with Legal Advisory Services work so the whole
// flow can be tried: assignments (all delivered by the test coordinator), the
// appointment sessions and invitations for some, and MOVs for the delivered
// ones. Several assignments are left open (assigned, accepted, no appointment)
// so appointments can be set up by hand.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-flow.cjs [--apply] [--overwrite]
//
// Every assignment carries `suppressNotifications: true`, which the deployed
// onAssignedInterventionEmail function honours. Deploy that function BEFORE
// running with --apply, otherwise each assignment emails the assignee and the SME.
// Appointment and MOV documents do not send email in their current shape.
//
// Documents already in the project are skipped unless --overwrite is given.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const OVERWRITE = process.argv.includes('--overwrite')

const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(newKey) }).firestore()
const { Timestamp } = admin.firestore

const PROGRAM = { id: 'b3qe3WAMAVw3QU64CLIY', name: 'SRMCDT Project' }
const LEGAL_DEPARTMENT = { id: '9bu8xeGsQu4O1NVV73Du', name: 'Legal Advisory Services' }
const COORDINATOR_UID = 'KD1WPtLLrNcihHGYeWKAFWAKriw2' // legalcoordinator@quantilytix.co.za
const HOD_EMAIL = 'legal@quantilytix.co.za'

const SMES = {
    dante: 'SihV5sbqxAIlQ08Dtk29',
    testapp: 'nFpTqvOR0gSg3HgsoLMe',
    incubatee: 'kb7kcDbm7bejjR928VN3lHwzFrG2',
    bongani: 'WTsiGqY4C0rlPvndMMtK',
}

const IV = {
    commercial: '2rzrrqFV7YnlS9yswk7x',
    ip: '6KOjejvu2Bs2yVpW2XeM',
    labour: '8plZb0CPdR3U11PAcBZN',
    bizlaw: 'Iod2YQ13G1xQxHsKWQDI',
    compliance: 'LSUNevJ7KUonfir4Hrqy',
    insurance: 'Y19hiSKSTLyw5H1YKfgM',
    debt: 'me8r5jA3H9z3dYgLe80D',
    cross: 'ukxx7ZzY5NflPlDFcpWJ',
}

const DAY = 24 * 60 * 60 * 1000
const at = (offsetDays, hour = 10) => {
    const d = new Date(Date.now() + offsetDays * DAY)
    d.setUTCHours(hour, 0, 0, 0)
    return Timestamp.fromDate(d)
}

// state: approved | awaiting_hod | awaiting_smme | scheduled | open
const PLAN = [
    { sme: 'dante', iv: 'ip', state: 'approved', sessionDays: -21 },
    { sme: 'testapp', iv: 'labour', state: 'awaiting_hod', sessionDays: -10 },
    { sme: 'bongani', iv: 'bizlaw', state: 'awaiting_smme', sessionDays: -5 },
    { sme: 'dante', iv: 'bizlaw', state: 'scheduled', sessionDays: 7 },
    { sme: 'testapp', iv: 'ip', state: 'open' },
    { sme: 'incubatee', iv: 'ip', state: 'open' },
    { sme: 'bongani', iv: 'labour', state: 'open' },
    { sme: 'dante', iv: 'debt', state: 'open' },
    { sme: 'incubatee', iv: 'compliance', state: 'open' },
    { sme: 'testapp', iv: 'insurance', state: 'open' },
    { sme: 'bongani', iv: 'cross', state: 'open' },
    { sme: 'incubatee', iv: 'bizlaw', state: 'open' },
]

const safeKey = (value) => encodeURIComponent(value).replace(/%/g, '_')
const clean = (v) => String(v ?? '').trim()

async function put(ref, data, label) {
    const exists = (await db.doc(ref).get()).exists
    if (exists && !OVERWRITE) return console.log(`  skip  ${label} (already exists)`)
    console.log(`  ${APPLY ? 'write' : 'would write'} ${label}${exists ? ' (overwrite)' : ''}`)
    if (APPLY) await db.doc(ref).set(data)
}

async function main() {
    console.log(`${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'}${OVERWRITE ? ', overwrite' : ''})`)

    const coordSnap = await db.collection('users').doc(COORDINATOR_UID).get()
    if (!coordSnap.exists) throw new Error('test coordinator is not in the new project, run migrate-legal.cjs first')
    const coord = coordSnap.data()
    const hodSnap = await db.collection('users').where('email', '==', HOD_EMAIL).limit(1).get()
    const hod = hodSnap.empty ? null : { id: hodSnap.docs[0].id, ...hodSnap.docs[0].data() }
    if (!hod) console.log(`  note: ${HOD_EMAIL} not found, MOV approvals will not name a HOD`)

    const ivDocs = {}
    for (const [k, id] of Object.entries(IV)) {
        const s = await db.collection('interventions').doc(id).get()
        if (!s.exists) throw new Error(`intervention ${id} missing in new project`)
        ivDocs[k] = { id, ...s.data() }
        if (!ivDocs[k].outcomeDef) throw new Error(`intervention ${id} has no outcomeDef, run migrate-legal.cjs first`)
    }

    const smeDocs = {}
    for (const [k, pid] of Object.entries(SMES)) {
        const p = await db.collection('participants').doc(pid).get()
        if (!p.exists) throw new Error(`participant ${pid} missing, run migrate-srmcdt.cjs first`)
        const email = clean(p.data().email).toLowerCase()
        const u = await db.collection('users').where('email', '==', email).limit(1).get()
        smeDocs[k] = { id: pid, ...p.data(), user: u.empty ? {} : u.docs[0].data() }
    }

    const counts = {}
    for (const item of PLAN) {
        const sme = smeDocs[item.sme]
        const iv = ivDocs[item.iv]
        const assignmentId = `ai_${sme.id}_${iv.id}_nosub_seed`
        const done = ['approved', 'awaiting_hod', 'awaiting_smme'].includes(item.state)
        const confirmed = item.state === 'approved' || item.state === 'awaiting_hod'
        const hasSession = item.state !== 'open'
        const sessionStart = hasSession ? at(item.sessionDays, 10) : null
        const sessionEnd = hasSession ? Timestamp.fromMillis(sessionStart.toMillis() + 60 * 60 * 1000) : null
        const createdAt = at(hasSession && item.sessionDays < 0 ? item.sessionDays - 14 : -2, 8)
        const completedAt = done ? sessionEnd : null
        const confirmedAt = confirmed ? Timestamp.fromMillis(sessionEnd.toMillis() + 2 * DAY) : null
        const movId = done ? `mov_seed_${assignmentId}` : null

        console.log(`\n[${item.sme} x ${iv.interventionTitle}] ${item.state}`)

        const assignment = {
            id: assignmentId,
            participantId: sme.id,
            participantName: sme.beneficiaryName || sme.participantName || 'Participant',
            smmeNo: sme.smmeNo || null,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            hasSubInterventions: false,
            subInterventionId: null,
            subInterventionTitle: null,
            definitionVersion: Math.max(1, Number(iv.definitionVersion || 1)),
            definitionSnapshot: {
                version: Math.max(1, Number(iv.definitionVersion || 1)),
                interventionId: iv.id,
                interventionTitle: iv.interventionTitle,
                subInterventionId: null,
                subInterventionTitle: null,
                outcomeDef: iv.outcomeDef,
                deliverableName: iv.outcomeDef.deliverable.name,
                capturedAt: createdAt,
            },
            dueDate: at(14, 22),
            assigneeRole: 'coordinator',
            assigneeId: COORDINATOR_UID,
            assigneeName: coord.name,
            assigneeEmail: coord.email,
            assignmentStatus: confirmed ? 'completed' : done ? 'in-progress' : 'assigned',
            assigneeAcceptanceStatus: 'accepted',
            assigneeAcceptedAt: createdAt,
            participantAcceptanceStatus: done ? 'accepted' : 'pending',
            assigneeCompletionStatus: done ? 'completed' : 'pending',
            participantCompletionStatus: confirmed ? 'confirmed' : 'pending',
            areaOfSupport: iv.areaOfSupport || LEGAL_DEPARTMENT.name,
            departmentId: LEGAL_DEPARTMENT.id,
            programId: PROGRAM.id,
            scheduleMode: iv.assignmentMode || 'ad-hoc',
            cycleKey: new Date(createdAt.toMillis()).toISOString().slice(0, 7),
            recurrence: null,
            priorOpenCycleRisk: null,
            plannedSessions: 1,
            tracking: { sessionsLogged: done ? 1 : 0 },
            computedProgress: done ? 100 : 0,
            type: 'singular',
            groupKey: null,
            groupedAt: null,
            schemaVersion: 3,
            progressUpdates: done
                ? [{ note: 'Session held and advice documented with the SME.', createdAt: completedAt, by: COORDINATOR_UID, resources: [] }]
                : [],
            resources: [],
            reassignmentHistory: [],
            createdAt,
            updatedAt: createdAt,
            suppressNotifications: true,
        }
        if (done) {
            assignment.assigneeCompletedAt = completedAt
            assignment.completedAt = completedAt
            assignment.movDocumentId = movId
        }
        if (confirmed) {
            assignment.participantConfirmedAt = confirmedAt
            assignment.smmeAccepted = true
            assignment.smmeAcceptedAt = confirmedAt
            assignment.smmeDigitalSignature = sme.user.digitalSignature || ''
            assignment.smmeSignatureUrl = sme.user.signatureURL || ''
        }
        await put(`assignedInterventions/${assignmentId}`, assignment, `assignedInterventions/${assignmentId}`)
        counts.assignments = (counts.assignments || 0) + 1

        if (!hasSession) continue

        const sessionId = `session_${safeKey([PROGRAM.id, LEGAL_DEPARTMENT.id, iv.id, assignmentId, sessionStart.toMillis(), COORDINATOR_UID].join('__'))}`
        const appointmentId = `appointment_${safeKey(`${sessionId}__${sme.id}`)}`
        const held = done
        const session = {
            schemaVersion: 5,
            programId: PROGRAM.id,
            departmentId: LEGAL_DEPARTMENT.id,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            cycleKey: assignment.cycleKey,
            groupKey: null,
            sessionType: 'individual',
            assigneeId: COORDINATOR_UID,
            assigneeName: coord.name,
            assigneeEmail: coord.email,
            assigneeRole: 'coordinator',
            title: `${iv.interventionTitle} advisory session`,
            startAt: sessionStart,
            endAt: sessionEnd,
            deliveryMethod: 'in_person',
            location: 'Rustenburg Hub',
            meetingLink: null,
            plannedTopics: [],
            plannedCoverage: [],
            coverage: held
                ? {
                    held: true,
                    outcomeSummary: `Advised the SME on ${iv.interventionTitle.toLowerCase()} and agreed next steps.`,
                    coveredPoints: ['Current position and gaps', 'Recommended actions', 'Documents the SME must prepare'],
                    reasonNotHeld: null,
                    recordedAt: sessionEnd,
                    recordedById: COORDINATOR_UID,
                }
                : { held: null, outcomeSummary: null, coveredPoints: [], reasonNotHeld: null, recordedAt: null, recordedById: null },
            attendanceSession: null,
            attendanceSummary: { invitedCount: 1, attendedCount: held ? 1 : 0, checkedInCount: held ? 1 : 0, checkedOutCount: held ? 1 : 0 },
            foodMenu: [],
            status: held ? 'completed' : 'scheduled',
            createdAt,
            updatedAt: createdAt,
            completedAt: held ? sessionEnd : null,
        }
        const appointment = {
            schemaVersion: 5,
            programId: PROGRAM.id,
            departmentId: LEGAL_DEPARTMENT.id,
            assignedInterventionId: assignmentId,
            appointmentSessionId: sessionId,
            smeId: sme.id,
            smeName: assignment.participantName,
            smeEmail: clean(sme.email).toLowerCase() || null,
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            subInterventionId: null,
            subInterventionTitle: null,
            cycleKey: assignment.cycleKey,
            assigneeId: COORDINATOR_UID,
            assigneeName: coord.name,
            assigneeEmail: coord.email,
            assigneeRole: 'coordinator',
            groupKey: null,
            status: held ? 'completed' : 'scheduled',
            smeConfirmation: held ? 'confirmed' : 'pending',
            smeDeclineReason: null,
            attendance: held
                ? { status: 'attended', checkedInAt: sessionStart, checkedOutAt: sessionEnd }
                : { status: 'expected', checkedInAt: null, checkedOutAt: null },
            foodSelections: [],
            createdAt,
            updatedAt: createdAt,
            completedAt: held ? sessionEnd : null,
        }
        await put(`appointmentSessions/${sessionId}`, session, `appointmentSessions/${sessionId}`)
        await put(`appointments/${appointmentId}`, appointment, `appointments/${appointmentId}`)
        counts.sessions = (counts.sessions || 0) + 1

        if (!done) continue

        const mov = {
            agreementId: 'mov',
            sourceType: 'assignedIntervention',
            assignedInterventionId: assignmentId,
            diagnosticPlanId: null,
            programId: PROGRAM.id,
            programName: PROGRAM.name,
            departmentId: LEGAL_DEPARTMENT.id,
            departmentName: LEGAL_DEPARTMENT.name,
            areaOfSupport: assignment.areaOfSupport,
            kpiServiced: '',
            interventionId: iv.id,
            interventionTitle: iv.interventionTitle,
            subInterventionId: null,
            subInterventionTitle: null,
            deliveryMethod: 'in-person',
            frequency: null,
            status: confirmed ? (item.state === 'approved' ? 'approved' : 'awaiting_hod') : 'awaiting_smme',
            createdAt: completedAt,
            updatedAt: confirmed ? confirmedAt : completedAt,
            completedAt,
            interventionDate: sessionEnd,
            periodStart: createdAt,
            periodEnd: confirmedAt,
            appointmentInterventions: [{ title: session.title, date: sessionStart, signature: '', deliveryMethod: 'in-person' }],
            progressUpdates: assignment.progressUpdates,
            resources: [],
            facilitatorId: COORDINATOR_UID,
            facilitatorName: coord.name,
            facilitatorEmail: coord.email,
            facilitatorDigitalSignature: coord.digitalSignature || '',
            facilitatorSignatureUrl: coord.signatureURL || '',
            facilitatorSignedAt: completedAt,
            needsFacilitatorRepair: !coord.signatureURL,
            smmeAccepted: confirmed,
            smmeAcceptedAt: confirmedAt,
            smmeSignedAt: confirmedAt,
            smmeSignatureUrl: sme.user.signatureURL || '',
            smmeDigitalSignature: sme.user.digitalSignature || '',
            needsSmmeSignatureRepair: confirmed && !sme.user.signatureURL,
            smmeId: sme.id,
            participantId: sme.id,
            smmeName: '',
            smmeCompanyName: assignment.participantName,
            smmeNo: sme.smmeNo || '',
            createdByUid: COORDINATOR_UID,
            createdByName: coord.name,
            createdByEmail: coord.email,
        }
        if (item.state === 'approved') {
            mov.approvedByHod = true
            if (hod) {
                mov.approvedByUid = hod.id
                mov.approvedByName = hod.name || ''
                mov.approvedByEmail = hod.email
            }
        }
        await put(`movDocuments/${movId}`, mov, `movDocuments/${movId} (${mov.status})`)
        counts.movs = (counts.movs || 0) + 1
    }

    console.log(`\n${APPLY ? 'Done' : 'Dry run'}: ${JSON.stringify(counts)} (counts include skipped existing documents)`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
