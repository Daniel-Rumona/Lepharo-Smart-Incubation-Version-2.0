// Seeds in-app notifications for every project admin (about the active
// projects in their branch) and every HOD (operations users with a
// department), using only the types the live system sends each role, so the notification panel can be tried with realistic data.
// Dry run by default: it prints who would get what and writes nothing.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-notifications.cjs [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-notifications.cjs --remove [--apply]
//
// Every document uses a fixed `seed-notif-…` id and carries `seedTag`, so
// re-running overwrites the same documents instead of duplicating them, and
// --remove deletes exactly what this script created.
//
// Each doc is addressed by uid (never by role) and sets suppressNotifications,
// which onNotificationCreatedPush and onNotificationCreatedEmail both honour
// (functions/src/syntheticData.ts): real people see them in the bell but get
// no push or email. None of the types are in NOTIFICATION_REGISTRY either.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')
const SEED_TAG = 'seed-notifications'
const MAX_PROGRAMS_PER_ADMIN = 3

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { Timestamp } = admin.firestore

/** Spread over the last week so "2 hours ago" and "5 days ago" both show. */
const hoursAgo = hours => Timestamp.fromMillis(Date.now() - hours * 60 * 60 * 1000)
const clean = value => String(value ?? '').trim()
const isActive = program => !clean(program.status) || clean(program.status).toLowerCase() === 'active'

async function smeNamesFor(programId) {
    const snap = await db.collection('applications').where('programId', '==', programId).limit(40).get()
    const accepted = snap.docs
        .map(d => d.data())
        .filter(a => clean(a.applicationStatus).toLowerCase() === 'accepted')
    const pool = accepted.length ? accepted : snap.docs.map(d => d.data())
    const names = pool
        .map(a => clean(a.beneficiaryName || a.businessName || a.applicantName))
        .filter(Boolean)
    return names.length ? [...new Set(names)] : ['an SME']
}

/**
 * Only types the live system really sends to a project admin (see
 * functions/src): inquiry_received (emailInquiries, branch project admins),
 * MOV stage/manual reminders at the "awaiting CC" stage (CC = project admin),
 * and the system-wide notice. Roadmap escalations are left out: their link,
 * /plan-roadmaps/:id, has no page in the app yet.
 */
function projectAdminNotices(program, smes, inquiry) {
    const sme = i => smes[i % smes.length]
    const name = program.name || 'your project'
    return [
        {
            type: 'inquiry_received',
            message: inquiry
                ? `New inquiry from ${inquiry.from}: ${inquiry.subject}.`
                : `New inquiry from ${sme(1)} about ${name}.`,
            link: inquiry ? `/projectadmin/inquiries/${inquiry.id}` : '/receptionist/inquiries', // the "Inquiries → All" list project admins use
            inquiryId: inquiry?.id,
            hours: 2,
            read: false,
        },
        {
            type: 'mov_stage_reminder',
            message: `The ${name} MOV pack for ${sme(0)} has been awaiting your confirmation (CC) for 6 days.`,
            link: '/projectadmin/movs',
            hours: 9,
            read: false,
        },
        {
            type: 'mov_manual_reminder',
            message: `Reminder from the Control Tower: please confirm the ${name} MOV pack for ${sme(2)}.`,
            link: '/projectadmin/movs',
            hours: 50,
            read: true,
        },
    ]
}

/** Only types sent to HODs: MOV stage/manual reminders at "awaiting HOD", KPI and challenge reminders. */
function hodNotices(departmentName, programName, smes) {
    const sme = i => smes[i % smes.length]
    const dept = departmentName || 'your department'
    return [
        {
            type: 'mov_stage_reminder',
            message: `3 MOVs from ${dept} have been awaiting HOD approval for more than 5 days.`,
            link: '/operations/movs',
            hours: 1,
            read: false,
        },
        {
            type: 'kpi_manual_update_reminder',
            message: `Update needed: a ${dept} KPI has no recorded actual for this month.`,
            link: '/kpis/track',
            hours: 7,
            read: false,
        },
        {
            type: 'challenge_due_reminder',
            message: `"Delayed supplier onboarding for ${sme(1)}" is due tomorrow. Has it been mitigated?`,
            link: '/operations/success-challenges',
            hours: 30,
            read: false,
        },
        {
            type: 'mov_manual_reminder',
            message: `Reminder from the Control Tower: please approve the ${programName} MOV for ${sme(0)}.`,
            link: '/operations/movs',
            hours: 75,
            read: true,
        },
    ]
}

/** Everyone gets the one system-wide notice, as queueSystemStatusBroadcast would send. */
const SYSTEM_NOTICE = {
    type: 'system_upgrade',
    message: 'Scheduled upgrade: Smart Incubation will be briefly unavailable on Saturday from 06:00 to 08:00.',
    hours: 120,
    read: true,
}

/** Newest inquiry in a branch, for a link that opens a real record. */
async function latestInquiry(branchId) {
    if (!branchId) return null
    const snap = await db.collection('inquiries').where('branchId', '==', branchId).limit(50).get()
    const millis = d => d.createdAt?.toMillis?.() ?? (d.createdAt ? new Date(d.createdAt).getTime() : 0)
    const newest = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.contactInfo && d.inquiryDetails)
        .sort((a, b) => millis(b) - millis(a))[0]
    if (!newest) return null
    const c = newest.contactInfo || {}
    return {
        id: newest.id,
        from: clean(`${c.firstName || ''} ${c.lastName || ''}`) || clean(c.businessName) || 'an SME',
        subject: clean(newest.inquiryDetails?.inquiryType) || 'General inquiry',
    }
}

function toDoc(uid, notice, extra) {
    return {
        type: notice.type,
        message: notice.message,
        recipientIds: [uid],
        ...(notice.link ? { link: notice.link } : {}),
        ...(notice.inquiryId ? { inquiryId: notice.inquiryId } : {}),
        createdAt: notice.hours != null ? hoursAgo(notice.hours) : Timestamp.now(),
        readBy: notice.read ? { [uid]: true } : {},
        suppressNotifications: true,
        dataOrigin: 'synthetic',
        seedTag: SEED_TAG,
        ...extra,
    }
}

async function build() {
    const [programsSnap, adminsSnap, opsSnap, deptSnap] = await Promise.all([
        db.collection('programs').get(),
        db.collection('users').where('role', '==', 'projectadmin').get(),
        db.collection('users').where('role', '==', 'operations').get(),
        db.collection('departments').get(),
    ])

    const programs = programsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isActive)
    if (!programs.length) throw new Error('No active programs found.')
    const deptName = new Map(deptSnap.docs.map(d => [d.id, clean(d.data().name || d.data().departmentName)]))

    const smeCache = new Map()
    const smes = async programId => {
        if (!smeCache.has(programId)) smeCache.set(programId, await smeNamesFor(programId))
        return smeCache.get(programId)
    }

    const docs = []

    for (const userDoc of adminsSnap.docs) {
        const user = userDoc.data()
        const branch = clean(user.assignedBranch)
        const inBranch = programs.filter(p => branch && clean(p.branchId) === branch)
        // No branch match -> fall back to all active projects so the admin still sees something.
        const theirs = (inBranch.length ? inBranch : programs).slice(0, MAX_PROGRAMS_PER_ADMIN)
        const inquiry = await latestInquiry(branch)
        for (const [pIndex, program] of theirs.entries()) {
            // One inquiry is one notice, not one per project.
            const notices = projectAdminNotices(program, await smes(program.id), inquiry)
                .filter(n => pIndex === 0 || n.type !== 'inquiry_received')
            notices.forEach((notice, nIndex) => {
                // Stagger per project so several projects don't stack at identical times.
                const shifted = { ...notice, hours: notice.hours + pIndex * 3 }
                docs.push({
                    id: `seed-notif-${userDoc.id}-${program.id}-${nIndex}`,
                    who: `projectadmin ${clean(user.name) || userDoc.id}`,
                    data: toDoc(userDoc.id, shifted, { programId: program.id, programName: program.name || null }),
                })
            })
        }
    }

    const hods = opsSnap.docs.filter(d => clean(d.data().departmentId))
    for (const [hIndex, userDoc] of hods.entries()) {
        const user = userDoc.data()
        const program = programs[hIndex % programs.length]
        const department = deptName.get(clean(user.departmentId)) || clean(user.departmentName)
        const notices = hodNotices(department, program.name || 'the current project', await smes(program.id))
        notices.forEach((notice, nIndex) => {
            docs.push({
                id: `seed-notif-${userDoc.id}-hod-${nIndex}`,
                who: `HOD ${clean(user.name) || userDoc.id} (${department || 'no dept name'})`,
                data: toDoc(userDoc.id, notice, {
                    programId: program.id,
                    programName: program.name || null,
                    departmentId: clean(user.departmentId),
                }),
            })
        })
    }

    for (const userDoc of [...adminsSnap.docs, ...hods]) {
        docs.push({
            id: `seed-notif-${userDoc.id}-system`,
            who: `${userDoc.data().role === 'projectadmin' ? 'projectadmin' : 'HOD'} ${clean(userDoc.data().name) || userDoc.id}`,
            data: toDoc(userDoc.id, SYSTEM_NOTICE, {}),
        })
    }

    return { docs, programs, admins: adminsSnap.size, hods: hods.length }
}

async function commit(writes) {
    for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch()
        writes.slice(i, i + 400).forEach(fn => fn(batch))
        await batch.commit()
    }
}

async function main() {
    console.log(APPLY ? 'APPLY mode — writing to Firestore.' : 'Dry run — nothing will be written. Pass --apply to write.')

    if (REMOVE) {
        const snap = await db.collection('notifications').where('seedTag', '==', SEED_TAG).get()
        console.log(`${snap.size} seeded notifications to remove.`)
        if (APPLY) await commit(snap.docs.map(d => batch => batch.delete(d.ref)))
        return
    }

    const { docs, programs, admins, hods } = await build()
    console.log(`Active projects: ${programs.map(p => p.name || p.id).join(', ')}`)
    console.log(`Project admins: ${admins}, HODs: ${hods}, notifications: ${docs.length}`)
    const perPerson = new Map()
    docs.forEach(d => perPerson.set(d.who, (perPerson.get(d.who) || 0) + 1))
    perPerson.forEach((count, who) => console.log(`  ${who}: ${count}`))
    if (docs[0]) console.log('Sample:', JSON.stringify({ id: docs[0].id, ...docs[0].data, createdAt: docs[0].data.createdAt.toDate() }, null, 2))

    // Earlier runs may have written ids this version no longer produces.
    const keep = new Set(docs.map(d => d.id))
    const existing = await db.collection('notifications').where('seedTag', '==', SEED_TAG).get()
    const stale = existing.docs.filter(d => !keep.has(d.id))
    console.log(`Stale seeded notifications to delete: ${stale.length}`)

    if (APPLY) {
        await commit([
            ...docs.map(d => batch => batch.set(db.collection('notifications').doc(d.id), d.data)),
            ...stale.map(d => batch => batch.delete(d.ref)),
        ])
        console.log(`Wrote ${docs.length} notifications, deleted ${stale.length} stale ones.`)
    }
}

main().then(() => process.exit(0)).catch(error => {
    console.error(error)
    process.exit(1)
})
