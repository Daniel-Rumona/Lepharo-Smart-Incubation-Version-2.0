// Seeds leave requests for active staff so the HR Leave page and its Calendar
// tab can be tried with realistic data (approved, pending and rejected leave
// spread over last month to two months ahead), plus one blackout date.
// Dry run by default: it prints what it would write and writes nothing.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-leave-requests.cjs [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-leave-requests.cjs --remove [--apply]
//
// Every document uses a fixed `seed-leave-…` id and carries `seedTag`, so
// re-running overwrites the same documents and --remove deletes exactly what
// this script created.
//
// The docs carry employeeId/employeeEmail only, never userId/userEmail/email:
// onLeaveRequestDecisionEmail looks recipients up through those fields, so a
// seeded decision (or one made later on a seeded request) sends no email.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')
const SEED_TAG = 'seed-leave-requests'
const MAX_STAFF = 10

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()

// Mirrors STAFF_ROLE_KEYS in src/lib/roleLabels.ts.
const STAFF_ROLE_KEYS = new Set([
    'director', 'operations', 'headofdepartment', 'headsofdepartment', 'hod', 'projectadmin',
    'centercoordinator', 'coordinator', 'hr', 'employee',
    'receptionist', 'receiptionist'
])
const isStaffRole = role => STAFF_ROLE_KEYS.has(String(role || '').trim().toLowerCase().replace(/[\s_-]+/g, ''))
const clean = value => String(value ?? '').trim()

const iso = date => date.toISOString().slice(0, 10)
const addDays = (date, days) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
/** Weekdays only; public holidays are close enough to ignore for seed data. */
const weekdays = (from, to) => {
    let count = 0
    for (let d = from; d <= to; d = addDays(d, 1)) if (d.getUTCDay() % 6 !== 0) count += 1
    return count
}

// [start offset from today, length in calendar days, type, status, reason]
const PLAN = [
    [-24, 5, 'annual', 'approved', 'Family holiday'],
    [-10, 1, 'sick', 'approved', 'Flu'],
    [-3, 7, 'annual', 'approved', 'Year-end trip'],
    [0, 2, 'family', 'approved', 'Child unwell'],
    [2, 3, 'study', 'approved', 'Exams'],
    [5, 1, 'sick', 'pending', 'Medical appointment'],
    [7, 5, 'annual', 'pending', 'Visiting family'],
    [9, 2, 'annual', 'rejected', 'Long weekend', 'Clashes with the programme review week'],
    [14, 10, 'annual', 'approved', 'December break'],
    [16, 4, 'family', 'pending', 'Moving house'],
    [21, 3, 'annual', 'approved', 'Wedding'],
    [27, 12, 'annual', 'pending', 'Holiday season'],
    [35, 14, 'annual', 'approved', 'Holiday season'],
    [44, 5, 'study', 'pending', 'Course block']
]

async function remove() {
    const [requests, blackouts] = await Promise.all([
        db.collection('leaveRequests').where('seedTag', '==', SEED_TAG).get(),
        db.collection('leaveBlackoutDates').where('seedTag', '==', SEED_TAG).get()
    ])
    const docs = [...requests.docs, ...blackouts.docs]
    console.log(`${docs.length} seeded document(s) to remove.`)
    if (!APPLY || !docs.length) return
    const batch = db.batch()
    docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    console.log('Removed.')
}

async function seed() {
    const usersSnap = await db.collection('users').get()
    const staff = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => isStaffRole(u.role) && clean(u.status) !== 'Inactive' && !u.accountDisabledAt && clean(u.name || u.displayName))
        .sort((a, b) => clean(a.name || a.displayName).localeCompare(clean(b.name || b.displayName)))
        .slice(0, MAX_STAFF)
    if (!staff.length) throw new Error('No active staff found.')

    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))
    const writes = PLAN.map(([offset, length, type, status, reason, rejectionReason], index) => {
        const person = staff[index % staff.length]
        // Leave starts on a weekday: a Saturday start would count 0 days for a 1-day request.
        let from = addDays(today, offset)
        while (from.getUTCDay() % 6 === 0) from = addDays(from, 1)
        const to = addDays(from, length - 1)
        const applied = addDays(from, -7)
        const decided = status === 'pending' ? null : iso(addDays(applied, 1))
        return {
            id: `seed-leave-${String(index + 1).padStart(2, '0')}`,
            data: {
                employeeId: person.id,
                employeeEmail: clean(person.email).toLowerCase() || null,
                employeeName: clean(person.name || person.displayName),
                type,
                reason,
                from: iso(from),
                to: iso(to),
                days: weekdays(from, to),
                status,
                appliedDate: iso(applied),
                ...(status === 'approved' ? { approvedBy: 'seed', approvedDate: decided } : {}),
                ...(status === 'rejected' ? { rejectionReason, approvedBy: 'seed', approvedDate: decided } : {}),
                seedTag: SEED_TAG,
                dataOrigin: 'synthetic'
            }
        }
    })

    writes.forEach(w =>
        console.log(`${w.id}  ${w.data.from} → ${w.data.to}  ${w.data.type.padEnd(7)} ${w.data.status.padEnd(8)} ${w.data.employeeName}`)
    )
    const blackout = { id: 'seed-leave-blackout', data: { date: iso(addDays(today, 30)), reason: 'Programme review week (seed)', seedTag: SEED_TAG } }
    console.log(`${blackout.id}  ${blackout.data.date}  blackout`)

    if (!APPLY) return console.log('\nDry run. Re-run with --apply to write.')
    const batch = db.batch()
    writes.forEach(w => batch.set(db.collection('leaveRequests').doc(w.id), w.data))
    batch.set(db.collection('leaveBlackoutDates').doc(blackout.id), blackout.data)
    await batch.commit()
    console.log(`\nWrote ${writes.length} leave requests and 1 blackout date to ${key.project_id}.`)
}

;(REMOVE ? remove() : seed()).catch(error => {
    console.error(error)
    process.exit(1)
})
